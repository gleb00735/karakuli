// Контроллер приложения: экраны, цикл синхронизации с сервером, действия.

import { call } from './api.js';
import { setup, setBack, confirm, closingGuard, launchCode, haptic } from './tg.js';
import { h, toast } from './ui.js';
import { HomeScreen } from './screens/home.js';
import { LobbyScreen } from './screens/lobby.js';
import { GameScreen } from './screens/game.js';
import { FinalScreen } from './screens/final.js';
import { MafiaScreen } from './screens/mafia.js';
import { CheckersScreen } from './screens/checkers.js';
import { RaceScreen } from './screens/race.js';
import { WhoScreen } from './screens/who.js';
import { TttScreen } from './screens/ttt.js';
import { G2048Screen } from './screens/g2048.js';
import { Voice } from './voice.js';

setup();

const root = document.getElementById('app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const room = {
  code: null,
  state: null,
  strokesSince: 0,
  strokesRound: 0,
  msgSince: 0,
  messages: [],
  clockOffset: 0,
  loopId: 0,
  screen: null,
  screenKind: null,
  offline: null,
  sigSince: null,
};

const voice = new Voice();

export const serverNow = () => Date.now() + room.clockOffset;

// ─── Экраны ────────────────────────────────────────────────────────────────

function mount(screen, kind) {
  if (room.screen && room.screen.destroy) room.screen.destroy();
  root.replaceChildren(screen.el);
  room.screen = screen;
  room.screenKind = kind;
}

function showHome() {
  stopLoop();
  room.code = null;
  room.state = null;
  voice.reset();
  closingGuard(false);
  setBack(null);
  mount(new HomeScreen({ create, join, solo: showSolo }), 'home');
}

// Одиночные игры: без комнаты и опросов сервера.
function showSolo(game) {
  stopLoop();
  setBack(showHome);
  if (game === '2048') mount(new G2048Screen({ back: showHome }), 'solo');
}

function showLoading() {
  root.replaceChildren(h('div.loading', null, h('div.spinner')));
}

function screenKindFor(s) {
  if (s.phase === 'lobby') return 'lobby';
  if (s.phase.startsWith('m_') || (s.phase === 'final' && s.mode === 'mafia')) return 'mafia';
  if (s.phase.startsWith('c_') || (s.phase === 'final' && s.mode === 'checkers')) return 'checkers';
  if (s.phase.startsWith('r_') || (s.phase === 'final' && s.mode === 'race')) return 'race';
  if (s.phase.startsWith('w_') || (s.phase === 'final' && s.mode === 'who')) return 'who';
  if (s.phase.startsWith('t_') || (s.phase === 'final' && s.mode === 'ttt')) return 'ttt';
  if (s.phase === 'final') return 'final';
  return 'game';
}

function render() {
  const s = room.state;
  if (!s) return;
  const kind = screenKindFor(s);
  if (kind !== room.screenKind || (kind === 'game' && room.screen.roundNo !== s.roundNo)) {
    const ctx = { room, actions, serverNow, voice };
    const Screen = { lobby: LobbyScreen, final: FinalScreen, mafia: MafiaScreen, checkers: CheckersScreen, race: RaceScreen, who: WhoScreen, ttt: TttScreen, game: GameScreen }[kind];
    mount(new Screen(ctx), kind);
  }
  closingGuard(kind === 'game' || (['mafia', 'checkers', 'race', 'who', 'ttt'].includes(kind) && s.phase !== 'final'));
  room.screen.update(s);
}

// ─── Синхронизация ─────────────────────────────────────────────────────────

function cursors() {
  return { code: room.code, strokesSince: room.strokesSince, strokesRound: room.strokesRound, msgSince: room.msgSince, sigSince: room.sigSince };
}

function absorb(res, sentAt) {
  if (!res || !res.state) return;
  if (sentAt) {
    const rtt = Date.now() - sentAt;
    const offset = res.state.serverNow - (sentAt + rtt / 2);
    room.clockOffset = room.clockOffset ? room.clockOffset * 0.7 + offset * 0.3 : offset;
  }
  // Ответы могут прийти не по порядку — старые версии состояния игнорируем.
  if (room.state && res.state.version < room.state.version && res.state.code === room.state.code) return;
  room.state = res.state;

  let fresh = [];
  if (res.strokesRound !== room.strokesRound) {
    room.strokesRound = res.strokesRound;
    room.strokesSince = 0;
  }
  for (const b of res.strokes || []) {
    if (b.id <= room.strokesSince) continue;
    room.strokesSince = b.id;
    fresh.push(...b.ops);
  }
  const newMsgs = [];
  const initial = room.msgSince === 0;
  for (const m of res.messages || []) {
    if (m.id <= room.msgSince) continue;
    room.msgSince = m.id;
    room.messages.push(m);
    newMsgs.push(m);
  }
  if (room.messages.length > 80) room.messages.splice(0, room.messages.length - 80);

  const sigs = (res.signals || []).filter((sg) => room.sigSince == null || sg.id > room.sigSince);
  if (res.sigCursor != null && (room.sigSince == null || res.sigCursor > room.sigSince)) room.sigSince = res.sigCursor;

  render();
  if (room.screen && room.screen.absorb) room.screen.absorb(fresh, newMsgs);
  voice.sync(room.state);
  if (sigs.length) voice.onSignals(sigs);
  if (!initial) for (const m of newMsgs) presenceToast(m);
}

// Уведомления о том, кто зашёл, отключился, вернулся или вышел.
function presenceToast(m) {
  if (m.userId === room.state.me && m.kind !== 'abort') return;
  const n = m.name;
  if (m.kind === 'join') toast(`${n} в комнате`, 'ok', 2000);
  else if (m.kind === 'away') toast(`${n} не в сети`, 'warn');
  else if (m.kind === 'back') toast(`${n} снова в сети`, 'ok', 2000);
  else if (m.kind === 'left') toast(`${n} покидает комнату`, 'warn');
  else if (m.kind === 'abort') haptic.err();
}

function interval() {
  const s = room.state;
  if (s && s.phase === 'r_race') return 300;
  if (s && s.phase === 'r_countdown') return 500;
  if (voice.mode && voice.negotiating) return 450;
  if (document.hidden) return 4000;
  if (!s) return 1500;
  if (s.phase === 'draw') return s.drawerId === s.me ? 350 : 650;
  if (s.phase === 'pick' || s.phase === 'reveal') return 900;
  if (s.phase === 'w_play') return 800;
  return 1500;
}

function stopLoop() { room.loopId++; setOffline(false); }

async function loop() {
  const id = ++room.loopId;
  let failures = 0;
  while (id === room.loopId) {
    const payload = cursors();
    const pen = room.screen && room.screen.pen;
    const ops = pen && room.state && room.state.phase === 'draw' && room.state.drawerId === room.state.me ? pen.take() : [];
    if (ops.length) payload.ops = ops;
    const signals = voice.takeOutbox();
    if (signals.length) payload.signals = signals;
    const racePos = room.screen && room.screen.racePos;
    if (racePos) payload.race = racePos;
    const sentAt = Date.now();
    try {
      const res = await call('sync', payload);
      if (id !== room.loopId) return;
      failures = 0;
      setOffline(false);
      if (racePos && racePos.fin != null && room.screen.confirmFinish) room.screen.confirmFinish();
      absorb(res, sentAt);
    } catch (e) {
      if (ops.length && pen) pen.giveBack(ops);
      if (signals.length) voice.giveBack(signals);
      if (id !== room.loopId) return;
      if (await handleError(e)) return;
      failures++;
      if (failures > 1) setOffline(true);
      await sleep(Math.min(3000, 500 * failures));
      continue;
    }
    await sleep(interval());
  }
}

// Ускоряет следующий опрос (после действия игрока).
let kickTimer = 0;
function kick() {
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => { if (room.code) { room.loopId++; loop(); } }, 50);
}

function setOffline(on) {
  if (on && !room.offline) {
    room.offline = h('div.offline', null, h('div.spinner'), 'Переподключаемся…');
    document.body.append(room.offline);
  } else if (!on && room.offline) {
    room.offline.remove();
    room.offline = null;
  }
}

// true — ошибка фатальная для комнаты, цикл надо остановить.
async function handleError(e) {
  if (e.code === 'NOT_IN_LOBBY') {
    const was = room.state && room.state.phase;
    if (was === 'lobby' || was === 'final') {
      try { await call('joinLobby', { code: room.code }); return false; } catch {}
    }
    toast('Вы долго были не в сети и выбыли из комнаты', 'warn', 3500);
    showHome();
    return true;
  }
  if (e.code === 'NOT_FOUND') {
    toast('Комната закрыта', 'warn');
    showHome();
    return true;
  }
  return false;
}

function enterRoom(res) {
  stopLoop();
  room.code = res.state.code;
  room.state = null;
  room.strokesSince = 0;
  room.strokesRound = 0;
  room.msgSince = 0;
  room.sigSince = null;
  room.messages = [];
  room.screenKind = null;
  setBack(leaveRoom);
  absorb(res, 0);
  loop();
}

async function leaveRoom() {
  const inGame = room.state && (/^[mcrwt]_/.test(room.state.phase) || screenKindFor(room.state) === 'game');
  if (inGame && !(await confirm('Выйти из игры? Партия продолжится без вас.'))) return;
  const code = room.code;
  showHome();
  call('leaveLobby', { code }).catch(() => {});
}

// ─── Действия ──────────────────────────────────────────────────────────────

async function create(mode) {
  haptic.tap();
  showLoading();
  try {
    enterRoom(await call('createLobby', { mode }));
  } catch (e) {
    toast(e.message, 'err');
    showHome();
  }
}

async function join(code, { silent } = {}) {
  showLoading();
  try {
    const res = await call('joinLobby', { code });
    haptic.ok();
    enterRoom(res);
    return true;
  } catch (e) {
    if (!silent) { toast(e.message, 'err'); haptic.err(); }
    showHome();
    return false;
  }
}

// Действие в комнате: ответ сразу применяется, а цикл опроса ускоряется.
async function act(name, input = {}) {
  const sentAt = Date.now();
  try {
    const res = await call(name, { ...cursors(), ...input });
    absorb(res, sentAt);
    kick();
    return res;
  } catch (e) {
    if (!(await handleError(e))) toast(e.message, 'err');
    return null;
  }
}

const actions = {
  leave: leaveRoom,
  start: () => act('startGame'),
  settings: (changes) => act('settings', changes),
  mafia: (kind, target) => act('mafiaAct', { kind, target }),
  chat: (text) => act('chat', { text }),
  toLobby: () => act('toLobby'),
  checkers: (kind, path) => act('checkersAct', { kind, path }),
  who: (kind, args = {}) => act('whoAct', { kind, ...args }),
  ttt: (kind, cell) => act('tttAct', { kind, cell }),
  pick: (index) => act('pickWord', { index }),
  guess: (text) => act('guess', { text }),
  flush: kick,
};

// ─── Запуск ────────────────────────────────────────────────────────────────

async function boot() {
  const code = launchCode();
  if (code) return join(code);
  showLoading();
  try {
    const { code: current } = await call('resume');
    if (current) {
      const res = await call('sync', { code: current });
      return enterRoom(res);
    }
  } catch {}
  showHome();
}

voice.kick = () => kick();
window.__voice = voice;

document.addEventListener('visibilitychange', () => { if (!document.hidden && room.code) kick(); });

// Закрытие Mini App вне партии — сразу выходим из комнаты, чтобы остальные
// не ждали. Запрос может не успеть уйти; тогда сработает таймаут присутствия.
window.addEventListener('pagehide', () => {
  const phase = room.state && room.state.phase;
  if (room.code && (phase === 'lobby' || phase === 'final')) call('leaveLobby', { code: room.code }).catch(() => {});
});

boot();

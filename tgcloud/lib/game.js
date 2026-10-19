// Ядро игры «Каракули».
//
// У платформы нет таймеров и push-канала, поэтому время партии «ленивое»:
// каждая фаза хранит дедлайн, а любой запрос любого игрока сначала вызывает
// advance(), который доводит комнату до актуального состояния. Переход фазы
// выполняется условным UPDATE по полю version — если два запроса пришли
// одновременно, переход сделает только один из них.

import { one, many, exec } from './sql.js';
import { TIERS, TIER_MULT } from './words.js';
import {
  STALE_MS, LOBBY_DROP_MS, now, begin, fail, caller, loadLobby, loadLobbyById, loadPlayers,
  isActive, isGone, parse, addMessage, transition, dropPlayers,
} from './core.js';
import { MAFIA_MIN, MAFIA_MAX, startMafia, mafiaAdvance, mafiaAct, mafiaChat, mafiaView } from './mafia.js';
import { startCheckers, checkersAdvance, checkersAct, checkersView } from './checkers.js';

export { begin, caller, fail, loadLobby };

export const MAX_PLAYERS = 3;
export const MIN_PLAYERS = 2;
const MODES = ['draw', 'mafia', 'checkers'];
const LIMITS = { draw: [MIN_PLAYERS, MAX_PLAYERS], mafia: [MAFIA_MIN, MAFIA_MAX], checkers: [2, 2] };
const GAME_TITLES = { draw: '«Каракули»', mafia: '«Мафию»', checkers: '«Шашки»' };
const minPlayers = (lobby) => (LIMITS[lobby.mode] || LIMITS.draw)[0];
const maxPlayers = (lobby) => (LIMITS[lobby.mode] || LIMITS.draw)[1];
export const PICK_MS = 15_000;
export const REVEAL_MS = 6_000;
const LOBBY_TTL_MS = 6 * 3600_000;
const ROUND_OPTIONS = [1, 2, 3];
const DRAW_TIME_OPTIONS = [60, 80, 100];

// ─── Слова ─────────────────────────────────────────────────────────────────

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function isClose(guess, word) {
  if (Math.abs(guess.length - word.length) > 2) return false;
  return levenshtein(guess, word) <= (word.length <= 5 ? 1 : 2);
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isLetter = (ch) => /[a-zа-яё0-9]/i.test(ch);

// Маска слова для угадывающих: буквы скрыты, пробелы и дефисы видны.
// После половины времени открывается одна буква, после 3/4 — вторая
// (если в слове больше четырёх букв).
export function maskWord(lobby, t = now()) {
  const word = lobby.word || '';
  const letters = [...word].map((ch, i) => (isLetter(ch) ? i : -1)).filter((i) => i >= 0);
  const total = lobby.draw_time * 1000;
  const frac = Math.min(1, Math.max(0, (t - lobby.phase_start) / total));
  let reveal = frac >= 0.75 ? 2 : frac >= 0.5 ? 1 : 0;
  if (letters.length <= 4) reveal = Math.min(reveal, 1);
  if (letters.length <= 2) reveal = 0;
  const rand = mulberry32(lobby.id * 7919 + lobby.round_no);
  const pool = letters.slice();
  const shown = new Set();
  for (let k = 0; k < reveal && pool.length; k++) shown.add(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return [...word].map((ch, i) => (!isLetter(ch) ? ch : shown.has(i) ? ch : '_')).join('');
}

function pickChoices(used) {
  const usedSet = new Set(used);
  return TIERS.map((tier, diff) => {
    const fresh = tier.filter((w) => !usedSet.has(w));
    const src = fresh.length ? fresh : tier;
    return { word: src[Math.floor(Math.random() * src.length)], diff };
  });
}

// ─── Загрузка ──────────────────────────────────────────────────────────────

// ─── Переходы фаз ──────────────────────────────────────────────────────────

async function startTurn(lobby, players, turn) {
  const order = parse(lobby.turn_order, []);
  const t = now();
  // Пропускаем ходы игроков, которые вышли или пропали.
  while (turn < lobby.turn_total) {
    const drawer = players.find((p) => p.user_id === order[turn % order.length]);
    if (drawer && !isGone(drawer, t)) break;
    turn++;
  }
  if (turn >= lobby.turn_total) return finish(lobby);

  const drawerId = order[turn % order.length];
  const choices = pickChoices(parse(lobby.used_words, []));
  const next = await transition(lobby, {
    phase: 'pick', turn, drawer_id: drawerId, round_no: lobby.round_no + 1,
    choices: JSON.stringify(choices), word: null, word_diff: null,
    phase_start: t, deadline: t + PICK_MS, last_result: null,
  });
  if (!next) return null;
  await exec('UPDATE players SET guessed_at = NULL, gained = 0 WHERE lobby_id = :id', { id: lobby.id });
  await exec('DELETE FROM strokes WHERE lobby_id = :id AND round_no < :r', { id: lobby.id, r: next.round_no });
  await exec('DELETE FROM messages WHERE lobby_id = :id AND round_no < :r', { id: lobby.id, r: next.round_no - 1 });
  return next;
}

async function startDraw(lobby, choice) {
  const t = now();
  const used = parse(lobby.used_words, []);
  used.push(choice.word);
  const next = await transition(lobby, {
    phase: 'draw', word: choice.word, word_diff: choice.diff, choices: null,
    used_words: JSON.stringify(used.slice(-200)),
    phase_start: t, deadline: t + lobby.draw_time * 1000,
  });
  if (next) {
    const drawer = await one('SELECT name FROM players WHERE lobby_id = :id AND user_id = :u', { id: lobby.id, u: lobby.drawer_id });
    await addMessage(next, 'turn', { userId: lobby.drawer_id, name: drawer ? drawer.name : '' });
  }
  return next;
}

async function endRound(lobby, players) {
  const t = now();
  const result = {
    word: lobby.word,
    drawerId: lobby.drawer_id,
    gains: players.map((p) => ({ userId: p.user_id, gained: p.gained, guessed: !!p.guessed_at })),
  };
  const next = await transition(lobby, {
    phase: 'reveal', last_result: JSON.stringify(result), phase_start: t, deadline: t + REVEAL_MS,
  });
  if (next) await addMessage(next, 'word', { body: lobby.word });
  return next;
}

// Партия прервана: игроков осталось меньше двух. Комната возвращается в лобби
// с пометкой, кто ушёл.
async function abort(lobby, players, t) {
  const gone = players.filter((p) => isGone(p, t));
  const names = gone.map((p) => p.name);
  const next = await transition(lobby, {
    phase: 'lobby', drawer_id: null, word: null, choices: null, phase_start: t, deadline: null,
    last_result: JSON.stringify({ aborted: true, names, ids: gone.map((p) => p.user_id) }),
  });
  if (next) await addMessage(next, 'abort', { body: names.join(', ') });
  return next;
}

// Отмечает переходы «отключился» / «вернулся» — по одному сообщению на переход.
async function trackPresence(lobby, players, t) {
  for (const p of players) {
    const active = isActive(p, t);
    if (active === !p.away) continue;
    const res = await exec('UPDATE players SET away = :a WHERE id = :pid AND away = :was', { a: active ? 0 : 1, pid: p.id, was: p.away });
    if (res.rowsAffected) {
      p.away = active ? 0 : 1;
      await addMessage(lobby, active ? 'back' : 'away', { userId: p.user_id, name: p.name });
    }
  }
}

async function finish(lobby) {
  const t = now();
  return transition(lobby, { phase: 'final', drawer_id: null, word: null, choices: null, phase_start: t, deadline: null });
}

// Доводит комнату до текущего момента. Возвращает { lobby, players }.
export async function advance(lobby) {
  for (let i = 0; i < 8; i++) {
    const t = now();
    const players = await loadPlayers(lobby.id);
    const active = players.filter((p) => isActive(p, t));
    await trackPresence(lobby, players, t);

    // Хозяин пропал — передаём роль самому раннему активному игроку.
    const host = players.find((p) => p.user_id === lobby.host_id);
    if ((!host || !isActive(host, t)) && active.length) {
      const next = await transition(lobby, { host_id: active[0].user_id });
      lobby = next || (await loadLobbyById(lobby.id));
      continue;
    }

    let next;
    const inGame = lobby.phase === 'pick' || lobby.phase === 'draw' || lobby.phase === 'reveal';

    if (lobby.phase === 'lobby' || lobby.phase === 'final') {
      const gone = players.filter((p) => p.last_seen < t - LOBBY_DROP_MS);
      if (gone.length) {
        await dropPlayers(lobby, gone);
        continue;
      }
      return { lobby, players };
    }

    if (lobby.phase.startsWith('m_') || lobby.phase.startsWith('c_')) {
      next = await (lobby.phase.startsWith('m_') ? mafiaAdvance : checkersAdvance)(lobby, players, t);
      if (next === undefined) return { lobby, players };
    } else if (inGame && players.filter((p) => !isGone(p, t)).length < MIN_PLAYERS) {
      next = await abort(lobby, players, t);
    } else if (lobby.phase === 'pick') {
      const drawer = players.find((p) => p.user_id === lobby.drawer_id);
      if (!drawer || isGone(drawer, t)) next = await startTurn(lobby, players, lobby.turn + 1);
      else if (t >= lobby.deadline) {
        const choices = parse(lobby.choices, []);
        next = await startDraw(lobby, choices[Math.floor(Math.random() * choices.length)] || pickChoices([])[0]);
      } else return { lobby, players };
    } else if (lobby.phase === 'draw') {
      const drawer = players.find((p) => p.user_id === lobby.drawer_id);
      const guessers = active.filter((p) => p.user_id !== lobby.drawer_id);
      const allGuessed = guessers.length > 0 && guessers.every((p) => p.guessed_at);
      if (t >= lobby.deadline || allGuessed || !drawer || isGone(drawer, t)) next = await endRound(lobby, players);
      else return { lobby, players };
    } else if (lobby.phase === 'reveal') {
      if (t >= lobby.deadline) next = await startTurn(lobby, players, lobby.turn + 1);
      else return { lobby, players };
    } else {
      return { lobby, players };
    }

    lobby = next || (await loadLobbyById(lobby.id));
  }
  return { lobby, players: await loadPlayers(lobby.id) };
}

// ─── Действия игроков ──────────────────────────────────────────────────────

async function cleanupOld() {
  const old = await many('SELECT id FROM lobbies WHERE updated_at < :cut LIMIT 20', { cut: now() - LOBBY_TTL_MS });
  for (const { id } of old) await purgeLobby(id);
}

async function purgeLobby(id) {
  await exec('DELETE FROM signals WHERE lobby_id = :id', { id });
  await exec('DELETE FROM strokes WHERE lobby_id = :id', { id });
  await exec('DELETE FROM messages WHERE lobby_id = :id', { id });
  await exec('DELETE FROM players WHERE lobby_id = :id', { id });
  await exec('DELETE FROM lobbies WHERE id = :id', { id });
}

// Игрок может состоять только в одной комнате.
export async function leaveAll(userId, exceptLobbyId = 0) {
  const rows = await many('SELECT lobby_id FROM players WHERE user_id = :u AND lobby_id != :ex', { u: userId, ex: exceptLobbyId });
  for (const { lobby_id } of rows) await leave(lobby_id, userId);
}

export async function leave(lobbyId, userId) {
  const me = await one('SELECT name FROM players WHERE lobby_id = :id AND user_id = :u', { id: lobbyId, u: userId });
  await exec('DELETE FROM players WHERE lobby_id = :id AND user_id = :u', { id: lobbyId, u: userId });
  const left = await one('SELECT count(*) AS n FROM players WHERE lobby_id = :id', { id: lobbyId });
  if (!left || !left.n) return purgeLobby(lobbyId);
  const lobby = await loadLobbyById(lobbyId);
  if (lobby && me) await addMessage(lobby, 'left', { userId, name: me.name });
  if (lobby && lobby.host_id === userId) {
    const heir = await one('SELECT user_id FROM players WHERE lobby_id = :id ORDER BY seat LIMIT 1', { id: lobbyId });
    await transition(lobby, { host_id: heir.user_id });
  }
}

async function newCode() {
  for (let i = 0; i < 30; i++) {
    const len = i < 20 ? 4 : 5;
    const code = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0');
    if (!(await loadLobby(code))) return code;
  }
  fail('NO_CODE', 'Не удалось создать комнату, попробуйте ещё раз');
}

export async function createLobby(user, mode) {
  await cleanupOld();
  await leaveAll(user.id);
  const t = now();
  const code = await newCode();
  const res = await exec(
    `INSERT INTO lobbies (code, host_id, phase, version, rounds, draw_time, mode, created_at, updated_at)
     VALUES (:code, :host, 'lobby', 0, 2, 80, :mode, :t, :t)`,
    { code, host: user.id, mode: MODES.includes(mode) ? mode : 'draw', t },
  );
  await exec(
    `INSERT INTO players (lobby_id, user_id, name, photo, seat, score, gained, last_seen, joined_at)
     VALUES (:lobbyId, :u, :name, :photo, 0, 0, 0, :t, :t)`,
    { lobbyId: res.lastInsertRowid, u: user.id, name: user.name, photo: user.photo, t },
  );
  return code;
}

export async function joinLobby(user, code) {
  const lobby = await loadLobby(code);
  if (!lobby) fail('NOT_FOUND', 'Комната не найдена. Проверьте код');
  const t = now();
  const me = await one('SELECT id FROM players WHERE lobby_id = :id AND user_id = :u', { id: lobby.id, u: user.id });
  if (me) {
    await exec('UPDATE players SET last_seen = :t, name = :name, photo = :photo WHERE id = :pid', { t, name: user.name, photo: user.photo, pid: me.id });
    return lobby;
  }
  const { lobby: cur, players } = await advance(lobby);
  if (cur.phase !== 'lobby' && cur.phase !== 'final') fail('IN_PROGRESS', 'Игра уже идёт. Дождитесь конца партии');
  if (players.length >= maxPlayers(cur)) fail('FULL', `В комнате уже ${maxPlayers(cur)} игроков — мест нет`);
  await leaveAll(user.id, lobby.id);
  const seat = players.reduce((m, p) => Math.max(m, p.seat), -1) + 1;
  await exec(
    `INSERT INTO players (lobby_id, user_id, name, photo, seat, score, gained, last_seen, joined_at)
     VALUES (:lobbyId, :u, :name, :photo, :seat, 0, 0, :t, :t)
     ON CONFLICT (lobby_id, user_id) DO UPDATE SET last_seen = :t, away = 0`,
    { lobbyId: lobby.id, u: user.id, name: user.name, photo: user.photo, seat, t },
  );
  await addMessage(cur, 'join', { userId: user.id, name: user.name });
  return cur;
}

// Комната + запись игрока. Каждое обращение продлевает «присутствие».
export async function enter(user, code) {
  const lobby = await loadLobby(code);
  if (!lobby) fail('NOT_FOUND', 'Комната закрыта');
  const res = await exec('UPDATE players SET last_seen = :t WHERE lobby_id = :id AND user_id = :u', { t: now(), id: lobby.id, u: user.id });
  if (!res.rowsAffected) fail('NOT_IN_LOBBY', 'Вы не в этой комнате');
  return advance(lobby);
}

export async function updateSettings(user, code, { rounds, drawTime, mode }) {
  const { lobby } = await enter(user, code);
  if (lobby.host_id !== user.id) fail('NOT_HOST', 'Настройки меняет хозяин комнаты');
  if (lobby.phase !== 'lobby' && lobby.phase !== 'final') fail('IN_PROGRESS', 'Игра уже идёт');
  const changes = {};
  if (ROUND_OPTIONS.includes(rounds)) changes.rounds = rounds;
  if (DRAW_TIME_OPTIONS.includes(drawTime)) changes.draw_time = drawTime;
  if (MODES.includes(mode) && mode !== lobby.mode) {
    const n = (await loadPlayers(lobby.id)).length;
    if (n > LIMITS[mode][1]) fail('TOO_MANY', `В ${GAME_TITLES[mode]} играют до ${LIMITS[mode][1]} человек, а в комнате ${n}`);
    changes.mode = mode;
    changes.last_result = null;
  }
  if (Object.keys(changes).length) await transition(lobby, changes);
}

export async function startGame(user, code) {
  const { lobby, players } = await enter(user, code);
  if (lobby.host_id !== user.id) fail('NOT_HOST', 'Начать игру может только хозяин комнаты');
  if (lobby.phase !== 'lobby' && lobby.phase !== 'final') fail('IN_PROGRESS', 'Игра уже идёт');
  const t = now();
  const active = players.filter((p) => isActive(p, t));
  if (active.length < minPlayers(lobby)) fail('NOT_ENOUGH', `Нужно хотя бы ${minPlayers(lobby)} игрока в сети`);
  // Кто не в сети в момент старта — выбывает из комнаты.
  await dropPlayers(lobby, players.filter((p) => !isActive(p, t)));
  if (lobby.mode === 'mafia' || lobby.mode === 'checkers') {
    if (active.length > maxPlayers(lobby)) fail('TOO_MANY', `Здесь играют не больше ${maxPlayers(lobby)} человек`);
    const start = lobby.mode === 'mafia' ? startMafia : startCheckers;
    if (!(await start(lobby, active.map((p) => p.user_id)))) fail('CONFLICT', 'Попробуйте ещё раз');
    return;
  }
  const order = active.map((p) => p.user_id);
  const started = await transition(lobby, {
    phase: 'lobby', game: lobby.game + 1, turn: 0,
    turn_order: JSON.stringify(order), turn_total: order.length * lobby.rounds,
  });
  if (!started) fail('CONFLICT', 'Попробуйте ещё раз');
  await exec('UPDATE players SET score = 0, gained = 0, guessed_at = NULL, away = 0 WHERE lobby_id = :id', { id: lobby.id });
  await startTurn(started, await loadPlayers(lobby.id), 0);
}

export async function pickWord(user, code, index) {
  const { lobby } = await enter(user, code);
  if (lobby.phase !== 'pick' || lobby.drawer_id !== user.id) return;
  const choice = parse(lobby.choices, [])[index];
  if (choice) await startDraw(lobby, choice);
}

export async function guess(user, code, text) {
  const { lobby, players } = await enter(user, code);
  const raw = String(text || '').trim().slice(0, 40);
  const g = normalize(raw);
  if (!g) return { result: 'empty' };
  if (lobby.phase !== 'draw') return { result: 'late' };
  const me = players.find((p) => p.user_id === user.id);
  if (!me || lobby.drawer_id === user.id) return { result: 'drawer' };
  if (me.guessed_at) return { result: 'done' };

  const word = normalize(lobby.word);
  const t = now();
  if (g === word) {
    const res = await exec('UPDATE players SET guessed_at = :t WHERE id = :pid AND guessed_at IS NULL', { t, pid: me.id });
    if (!res.rowsAffected) return { result: 'done' };
    const before = players.filter((p) => p.guessed_at && p.user_id !== user.id).length;
    const mult = TIER_MULT[lobby.word_diff] || 1;
    const left = Math.max(0, lobby.deadline - t) / (lobby.draw_time * 1000);
    const points = Math.round((50 + 100 * left + (before === 0 ? 25 : 0)) * mult);
    const drawerPoints = Math.round(30 * mult);
    await exec('UPDATE players SET score = score + :p, gained = gained + :p WHERE id = :pid', { p: points, pid: me.id });
    await exec('UPDATE players SET score = score + :p, gained = gained + :p WHERE lobby_id = :id AND user_id = :u', { p: drawerPoints, id: lobby.id, u: lobby.drawer_id });
    await addMessage(lobby, 'correct', { userId: user.id, name: me.name, body: String(points) });
    await advance(await loadLobbyById(lobby.id));
    return { result: 'correct', points, word: lobby.word };
  }
  if (isClose(g, word)) {
    await addMessage(lobby, 'close', { userId: user.id, name: me.name, body: raw, toUser: user.id });
    return { result: 'close' };
  }
  // Догадка, в которой слово спрятано внутри («это же кот!»), не должна его выдать.
  if (word.length >= 3 && g.includes(word)) return { result: 'wrong' };
  await addMessage(lobby, 'guess', { userId: user.id, name: me.name, body: raw });
  return { result: 'wrong' };
}

// ─── Мафия ─────────────────────────────────────────────────────────────────

// Хозяин возвращает всех из итогов в лобби (например, чтобы сменить игру).
export async function backToLobby(user, code) {
  const { lobby } = await enter(user, code);
  if (lobby.host_id !== user.id) fail('NOT_HOST', 'Это может сделать хозяин комнаты');
  if (lobby.phase !== 'final') return;
  await transition(lobby, { phase: 'lobby', last_result: null, deadline: null });
}

export async function mafiaAction(user, code, kind, target) {
  const { lobby } = await enter(user, code);
  await mafiaAct(lobby, user, kind, target);
}

export async function checkersAction(user, code, kind, path) {
  const { lobby, players } = await enter(user, code);
  await checkersAct(lobby, players, user, kind, path);
}

export async function chat(user, code, text) {
  const { lobby } = await enter(user, code);
  await mafiaChat(lobby, user, user.name, text);
}

// ─── Голосовой чат ─────────────────────────────────────────────────────────

const SIGNAL_KINDS = ['offer', 'answer', 'hello', 'bye'];
const MAX_SIGNAL = 16_000;
const SIGNAL_TTL_MS = 120_000;

export async function setVoice(user, code, voice) {
  const v = [0, 1, 2].includes(voice) ? voice : 0;
  const lobby = await loadLobby(code);
  if (!lobby) fail('NOT_FOUND', 'Комната закрыта');
  const res = await exec('UPDATE players SET voice = :v, last_seen = :t WHERE lobby_id = :id AND user_id = :u', { v, t: now(), id: lobby.id, u: user.id });
  if (!res.rowsAffected) fail('NOT_IN_LOBBY', 'Вы не в этой комнате');
}

export async function pushSignals(lobby, players, user, list) {
  if (!Array.isArray(list) || !list.length) return;
  const t = now();
  await exec('DELETE FROM signals WHERE lobby_id = :id AND created_at < :cut', { id: lobby.id, cut: t - SIGNAL_TTL_MS });
  for (const sg of list.slice(0, 8)) {
    if (!sg || !SIGNAL_KINDS.includes(sg.kind)) continue;
    if (!players.some((p) => p.user_id === sg.to) || sg.to === user.id) continue;
    const body = JSON.stringify(sg.body ?? null);
    if (body.length > MAX_SIGNAL) continue;
    await exec(
      'INSERT INTO signals (lobby_id, from_user, to_user, kind, body, created_at) VALUES (:id, :f, :to, :k, :b, :t)',
      { id: lobby.id, f: user.id, to: sg.to, k: sg.kind, b: body, t },
    );
  }
}

async function incomingSignals(lobby, userId, since) {
  const t = now();
  const rows = await many(
    `SELECT id, from_user, kind, body FROM signals
     WHERE lobby_id = :id AND to_user = :u AND id > :since AND created_at > :cut ORDER BY id LIMIT 30`,
    { id: lobby.id, u: userId, since: Number(since) || 0, cut: t - SIGNAL_TTL_MS },
  );
  return rows.map((r) => ({ id: r.id, from: r.from_user, kind: r.kind, body: parse(r.body, null) }));
}

const MAX_OPS_JSON = 64_000;

export async function pushOps(lobby, user, ops) {
  if (!Array.isArray(ops) || !ops.length) return;
  if (lobby.phase !== 'draw' || lobby.drawer_id !== user.id) return;
  const json = JSON.stringify(ops);
  if (json.length > MAX_OPS_JSON) fail('TOO_BIG', 'Слишком большой рисунок');
  await exec('INSERT INTO strokes (lobby_id, round_no, ops) VALUES (:id, :r, :ops)', { id: lobby.id, r: lobby.round_no, ops: json });
}

// ─── Состояние для клиента ─────────────────────────────────────────────────

export async function view(lobby, players, userId) {
  const t = now();
  const isDrawer = lobby.drawer_id === userId;
  const state = {
    code: lobby.code,
    mode: lobby.mode,
    minPlayers: minPlayers(lobby),
    maxPlayers: maxPlayers(lobby),
    phase: lobby.phase,
    version: lobby.version,
    hostId: lobby.host_id,
    me: userId,
    rounds: lobby.rounds,
    drawTime: lobby.draw_time,
    turn: lobby.turn,
    turnTotal: lobby.turn_total,
    roundNo: lobby.round_no,
    drawerId: lobby.drawer_id,
    deadline: lobby.deadline,
    phaseStart: lobby.phase_start,
    serverNow: t,
    players: players.map((p) => ({
      id: p.user_id,
      name: p.name,
      photo: p.photo,
      score: p.score,
      gained: p.gained,
      guessed: !!p.guessed_at,
      active: isActive(p, t),
      voice: isActive(p, t) ? p.voice : 0,
    })),
  };
  if (lobby.phase === 'pick' && isDrawer) state.choices = parse(lobby.choices, []).map((c) => ({ ...c, mult: TIER_MULT[c.diff] }));
  if (lobby.phase === 'draw') {
    state.wordDiff = lobby.word_diff;
    const me = players.find((p) => p.user_id === userId);
    if (isDrawer || (me && me.guessed_at)) state.word = lobby.word;
    state.mask = maskWord(lobby, t);
  }
  if (lobby.phase === 'reveal') state.result = parse(lobby.last_result, null);
  if (lobby.mode === 'mafia' && (lobby.phase.startsWith('m_') || lobby.phase === 'final')) state.mafia = await mafiaView(lobby, userId);
  if (lobby.mode === 'checkers' && (lobby.phase.startsWith('c_') || lobby.phase === 'final')) state.checkers = checkersView(lobby, userId);
  if (lobby.phase === 'lobby') {
    const last = parse(lobby.last_result, null);
    if (last && last.aborted) state.notice = { aborted: true, names: last.names || [], ids: last.ids || [] };
  }
  return state;
}

export async function feed(lobby, userId, { strokesSince = 0, strokesRound = 0, msgSince = 0, sigSince = null } = {}) {
  let strokes = [];
  if (lobby.phase === 'draw' || lobby.phase === 'reveal') {
    const since = strokesRound === lobby.round_no ? Number(strokesSince) || 0 : 0;
    strokes = await many(
      'SELECT id, ops FROM strokes WHERE lobby_id = :id AND round_no = :r AND id > :since ORDER BY id LIMIT 300',
      { id: lobby.id, r: lobby.round_no, since },
    );
    strokes = strokes.map((s) => ({ id: s.id, ops: parse(s.ops, []) }));
  }
  const msgQuery = msgSince
    ? `SELECT * FROM messages WHERE lobby_id = :id AND id > :since AND (to_user IS NULL OR to_user = :u) ORDER BY id LIMIT 60`
    : `SELECT * FROM (SELECT * FROM messages WHERE lobby_id = :id AND (to_user IS NULL OR to_user = :u) ORDER BY id DESC LIMIT 30) ORDER BY id`;
  const rows = await many(msgQuery, { id: lobby.id, since: Number(msgSince) || 0, u: userId });
  const messages = rows.map((m) => ({ id: m.id, kind: m.kind, userId: m.user_id, name: m.name, body: m.body, roundNo: m.round_no }));
  // Первый запрос (sigSince = null) только узнаёт текущий курсор: старые
  // сигналы от прошлых подключений не нужны.
  let signals = [];
  let sigCursor;
  if (sigSince != null) {
    sigCursor = Number(sigSince) || 0;
    signals = await incomingSignals(lobby, userId, sigCursor);
    if (signals.length) sigCursor = signals[signals.length - 1].id;
  } else {
    const last = await one('SELECT max(id) AS m FROM signals WHERE lobby_id = :id', { id: lobby.id });
    sigCursor = (last && last.m) || 0;
  }
  return { strokes, strokesRound: lobby.round_no, messages, signals, sigCursor };
}

// Общий ответ всех эндпоинтов: состояние комнаты + новые штрихи и сообщения.
export async function snapshot(user, code, input = {}) {
  const lobby = await loadLobby(code);
  if (!lobby) fail('NOT_FOUND', 'Комната закрыта');
  const { lobby: cur, players } = await advance(lobby);
  if (!players.some((p) => p.user_id === user.id)) fail('NOT_IN_LOBBY', 'Вы не в этой комнате');
  return { state: await view(cur, players, user.id), ...(await feed(cur, user.id, input)) };
}

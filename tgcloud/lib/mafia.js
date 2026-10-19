// «Мафия» на 4–8 игроков. Ведущий — сама игра.
//
// Партия — цикл фаз (поле lobbies.phase):
//   m_roles → m_night → m_morning → m_day → m_vote → m_verdict → m_night …
// и в конце final. Как и в «Каракулях», фазы двигает advance() при любом
// запросе: по дедлайну или раньше, когда все нужные игроки сделали ход.
// Ходы лежат в таблице mafia_moves (один ход игрока на шаг), а итоги —
// роли, живые, проверки комиссара, события — в JSON-поле lobbies.mstate.

import { many, exec } from './sql.js';
import { now, fail, parse, transition, addMessage, isGone } from './core.js';

export const MAFIA_MIN = 4;
export const MAFIA_MAX = 8;

const ROLES_MS = 15_000;
const NIGHT_MS = 40_000;
const MORNING_MS = 9_000;
const VOTE_MS = 35_000;
const VERDICT_MS = 9_000;
// На обсуждение — больше времени, когда живых больше.
const dayMs = (alive) => Math.min(150, 45 + 15 * alive) * 1000;

export const ROLE_NAMES = { mafia: 'Мафия', com: 'Комиссар', doc: 'Доктор', civ: 'Мирный житель' };
const NIGHT_ROLES = ['mafia', 'com', 'doc'];

const stateOf = (lobby) => parse(lobby.mstate, null);

// Ключ шага, к которому относятся ходы игроков в текущей фазе.
function stepKey(phase, round) {
  if (phase === 'm_roles') return 'r0';
  if (phase === 'm_night') return 'n' + round;
  if (phase === 'm_day') return 'd' + round;
  if (phase === 'm_vote') return 'v' + round;
  return null;
}

const movesOf = (lobby, key) => many(
  'SELECT user_id, target, created_at FROM mafia_moves WHERE lobby_id = :id AND key = :key ORDER BY created_at, id',
  { id: lobby.id, key },
);

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Состав ролей: одна мафия на 4–5 игроков, две — на 6–8; всегда комиссар и доктор.
function deal(ids) {
  const roles = [...Array(ids.length >= 6 ? 2 : 1).fill('mafia'), 'com', 'doc'];
  while (roles.length < ids.length) roles.push('civ');
  const shuffled = shuffle(roles);
  return Object.fromEntries(ids.map((id, i) => [id, shuffled[i]]));
}

function winnerOf(state) {
  const mafia = state.alive.filter((id) => state.roles[id] === 'mafia').length;
  if (!mafia) return 'town';
  if (mafia >= state.alive.length - mafia) return 'mafia';
  return null;
}

const nameOf = (players, id) => (players.find((p) => p.user_id === id) || {}).name || 'Игрок';
const say = (lobby, text) => addMessage(lobby, 'm', { body: text });

function go(lobby, phase, ms, state) {
  const t = now();
  return transition(lobby, { phase, phase_start: t, deadline: ms ? t + ms : null, mstate: JSON.stringify(state) });
}

// ─── Начало партии ─────────────────────────────────────────────────────────

export async function startMafia(lobby, ids) {
  const state = {
    roles: deal(ids), alive: ids.slice(), round: 1,
    lastHeal: null, checks: {}, night: null, vote: null, winner: null, left: [],
  };
  await exec('DELETE FROM mafia_moves WHERE lobby_id = :id', { id: lobby.id });
  await exec('DELETE FROM messages WHERE lobby_id = :id', { id: lobby.id });
  const t = now();
  const next = await transition(lobby, {
    phase: 'm_roles', round_no: lobby.round_no + 1, last_result: null,
    phase_start: t, deadline: t + ROLES_MS, mstate: JSON.stringify(state),
  });
  if (next) await say(next, 'Ведущий раздал роли. Запомните свою и никому не показывайте.');
  return next;
}

async function finishMafia(lobby, players, state, winner) {
  state.winner = winner;
  const next = await go(lobby, 'final', 0, state);
  if (next) {
    const mafia = Object.keys(state.roles).filter((id) => state.roles[id] === 'mafia').map((id) => nameOf(players, Number(id)));
    await say(next, winner === 'town'
      ? `Мирные жители победили! Мафия: ${mafia.join(', ')}.`
      : `Мафия захватила город. Мафия: ${mafia.join(', ')}.`);
  }
  return next;
}

// ─── Ход партии ────────────────────────────────────────────────────────────

// Один шаг автомата. Возвращает новую версию комнаты или undefined, если
// сейчас делать нечего.
export async function mafiaAdvance(lobby, players, t) {
  const state = stateOf(lobby);
  if (!state) return undefined;

  // Пропавшие посреди партии выбывают, их роль раскрывается.
  const gone = state.alive.filter((id) => {
    const p = players.find((x) => x.user_id === id);
    return !p || isGone(p, t);
  });
  if (gone.length) {
    state.alive = state.alive.filter((id) => !gone.includes(id));
    state.left.push(...gone);
    const next = await transition(lobby, { mstate: JSON.stringify(state) });
    if (!next) return null;
    for (const id of gone) await say(next, `${nameOf(players, id)} покидает город. Роль: ${ROLE_NAMES[state.roles[id]]}.`);
    const w = winnerOf(state);
    return w ? finishMafia(next, players, state, w) : next;
  }

  const key = stepKey(lobby.phase, state.round);
  const due = lobby.deadline && t >= lobby.deadline;

  if (lobby.phase === 'm_roles') {
    const acks = await movesOf(lobby, key);
    if (!due && acks.length < state.alive.length) return undefined;
    const next = await go(lobby, 'm_night', NIGHT_MS, state);
    if (next) await say(next, 'Наступает ночь. Город засыпает…');
    return next;
  }

  if (lobby.phase === 'm_night') {
    const moves = await movesOf(lobby, key);
    const required = state.alive.filter((id) => NIGHT_ROLES.includes(state.roles[id]));
    if (!due && !required.every((id) => moves.some((m) => m.user_id === id))) return undefined;
    return resolveNight(lobby, players, state, moves);
  }

  if (lobby.phase === 'm_morning') {
    if (!due) return undefined;
    const w = winnerOf(state);
    if (w) return finishMafia(lobby, players, state, w);
    const next = await go(lobby, 'm_day', dayMs(state.alive.length), state);
    if (next) await say(next, `День ${state.round}. Обсудите, кто из вас мафия.`);
    return next;
  }

  if (lobby.phase === 'm_day') {
    const ready = await movesOf(lobby, key);
    if (!due && ready.length < state.alive.length) return undefined;
    const next = await go(lobby, 'm_vote', VOTE_MS, state);
    if (next) await say(next, 'Голосование: кого город выгонит сегодня?');
    return next;
  }

  if (lobby.phase === 'm_vote') {
    const votes = (await movesOf(lobby, key)).filter((m) => state.alive.includes(m.user_id));
    if (!due && votes.length < state.alive.length) return undefined;
    return resolveVote(lobby, players, state, votes);
  }

  if (lobby.phase === 'm_verdict') {
    if (!due) return undefined;
    const w = winnerOf(state);
    if (w) return finishMafia(lobby, players, state, w);
    state.round += 1;
    state.night = null;
    state.vote = null;
    const next = await go(lobby, 'm_night', NIGHT_MS, state);
    if (next) await say(next, `Ночь ${state.round}. Город засыпает…`);
    return next;
  }
  return undefined;
}

async function resolveNight(lobby, players, state, moves) {
  const by = (role) => moves.filter((m) => state.alive.includes(m.user_id) && state.roles[m.user_id] === role && m.target);
  // Цель мафии — за кого больше голосов; при равенстве — кого выбрали раньше.
  const tally = new Map();
  for (const m of by('mafia')) tally.set(m.target, (tally.get(m.target) || 0) + 1);
  let target = null;
  for (const [id, n] of tally) if (target === null || n > tally.get(target)) target = id;
  const heal = (by('doc')[0] || {}).target || null;
  const check = (by('com')[0] || {}).target || null;

  if (check) state.checks[check] = state.roles[check] === 'mafia' ? 'mafia' : 'town';
  state.lastHeal = heal;
  const killed = target && target !== heal ? target : null;
  if (killed) state.alive = state.alive.filter((id) => id !== killed);
  state.night = { round: state.round, killed, saved: !!target && target === heal };

  const next = await go(lobby, 'm_morning', MORNING_MS, state);
  if (next) {
    await say(next, killed
      ? `Утро. Этой ночью погиб ${nameOf(players, killed)}. Роль: ${ROLE_NAMES[state.roles[killed]]}.`
      : state.night.saved ? 'Утро. Мафия выбрала жертву, но доктор успел её спасти!' : 'Утро. Ночь прошла спокойно.');
  }
  return next;
}

async function resolveVote(lobby, players, state, votes) {
  const tally = {};
  let skip = 0;
  for (const v of votes) {
    if (v.target && state.alive.includes(v.target)) tally[v.target] = (tally[v.target] || 0) + 1;
    else skip++;
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const tie = ranked[1] && ranked[1][1] === top[1];
  const out = top && !tie && top[1] > skip ? Number(top[0]) : null;
  if (out) state.alive = state.alive.filter((id) => id !== out);
  state.vote = { round: state.round, out, tally, skip };

  const next = await go(lobby, 'm_verdict', VERDICT_MS, state);
  if (next) {
    await say(next, out
      ? `Город выгнал ${nameOf(players, out)}. Роль: ${ROLE_NAMES[state.roles[out]]}.`
      : tie ? 'Голоса разделились — сегодня никого не выгнали.' : 'Город решил никого не выгонять.');
  }
  return next;
}

// ─── Действия игроков ──────────────────────────────────────────────────────

// kind: 'ack' — ознакомился с ролью, 'night' — ночное действие,
// 'ready' — готов к голосованию, 'vote' — голос (target 0 — воздержаться).
export async function mafiaAct(lobby, user, kind, target) {
  const state = stateOf(lobby);
  if (!state || !lobby.phase.startsWith('m_')) fail('NOT_NOW', 'Сейчас этого сделать нельзя');
  if (!state.alive.includes(user.id)) fail('DEAD', 'Вы выбыли из игры и можете только наблюдать');
  const role = state.roles[user.id];
  const tgt = Number(target) || 0;
  const alive = (id) => state.alive.includes(id);

  const want = { ack: 'm_roles', night: 'm_night', ready: 'm_day', vote: 'm_vote' }[kind];
  if (!want || lobby.phase !== want) fail('NOT_NOW', 'Эта фаза уже закончилась');

  if (kind === 'night') {
    if (!NIGHT_ROLES.includes(role)) fail('NO_ROLE', 'Ночью у вас нет действия — спите спокойно');
    if (!alive(tgt)) fail('BAD_TARGET', 'Выберите живого игрока');
    if (role === 'mafia' && state.roles[tgt] === 'mafia') fail('BAD_TARGET', 'Нельзя выбрать своего');
    if (role === 'com' && tgt === user.id) fail('BAD_TARGET', 'Себя проверять незачем');
    if (role === 'doc' && tgt === state.lastHeal) fail('BAD_TARGET', 'Одного и того же нельзя лечить две ночи подряд');
  }
  if (kind === 'vote' && tgt && (!alive(tgt) || tgt === user.id)) fail('BAD_TARGET', 'За этого игрока голосовать нельзя');

  await exec(
    `INSERT INTO mafia_moves (lobby_id, key, user_id, target, created_at) VALUES (:id, :key, :u, :tgt, :t)
     ON CONFLICT (lobby_id, key, user_id) DO UPDATE SET target = :tgt, created_at = :t`,
    { id: lobby.id, key: stepKey(lobby.phase, state.round), u: user.id, tgt: kind === 'night' || kind === 'vote' ? tgt : 0, t: now() },
  );
}

// Сообщение в чат: днём — всем, ночью — только мафии между собой.
export async function mafiaChat(lobby, user, name, text) {
  const state = stateOf(lobby);
  const body = String(text || '').trim().slice(0, 200);
  if (!body) return;
  if (state && lobby.phase.startsWith('m_') && !state.alive.includes(user.id)) fail('DEAD', 'Выбывшие игроки молчат');
  if (lobby.phase === 'm_night' || lobby.phase === 'm_roles') {
    if (state.roles[user.id] !== 'mafia') fail('NIGHT', 'Ночью город спит');
    for (const id of state.alive.filter((x) => state.roles[x] === 'mafia')) {
      await addMessage(lobby, 'mchat', { userId: user.id, name, body, toUser: id });
    }
    return;
  }
  await addMessage(lobby, 'chat', { userId: user.id, name, body });
}

// ─── Состояние для клиента ─────────────────────────────────────────────────

// Каждый видит свою роль, роли выбывших и (мафия) своих сообщников;
// после финала — все роли.
export async function mafiaView(lobby, userId) {
  const state = stateOf(lobby);
  if (!state) return null;
  const role = state.roles[userId] || null;
  const final = lobby.phase === 'final';
  const roles = {};
  for (const id of Object.keys(state.roles)) {
    const n = Number(id);
    if (final || n === userId || !state.alive.includes(n) || (role === 'mafia' && state.roles[id] === 'mafia')) roles[id] = state.roles[id];
  }
  const out = {
    role, alive: state.alive, round: state.round, roles,
    night: state.night, vote: state.vote, winner: state.winner, left: state.left,
    ids: Object.keys(state.roles).map(Number),
    total: Object.keys(state.roles).length,
    mafiaCount: Object.values(state.roles).filter((r) => r === 'mafia').length,
  };
  if (role === 'com') out.checks = state.checks;
  if (role === 'doc') out.lastHeal = state.lastHeal;

  const key = stepKey(lobby.phase, state.round);
  if (key) {
    const moves = await movesOf(lobby, key);
    const mine = moves.find((m) => m.user_id === userId);
    out.myMove = mine ? mine.target : null;
    out.done = mine ? true : false;
    if (lobby.phase === 'm_roles' || lobby.phase === 'm_day') out.readyIds = moves.map((m) => m.user_id);
    if (lobby.phase === 'm_vote') out.votes = Object.fromEntries(moves.map((m) => [m.user_id, m.target]));
    if (lobby.phase === 'm_night' && role === 'mafia') {
      out.picks = Object.fromEntries(moves.filter((m) => state.roles[m.user_id] === 'mafia').map((m) => [m.user_id, m.target]));
    }
  }
  return out;
}

// «Гонки» на 2–8 игроков: вид сверху, три круга.
//
// Постоянного соединения у платформы нет, поэтому физика машины считается
// на телефоне игрока, а сервер только собирает позиции (клиент присылает их
// с каждым опросом) и раздаёт остальным — соперники видны «призраками»
// с небольшой задержкой. Сервер ведёт фазы (r_countdown → r_race → final),
// принимает финиш и определяет места.

import { many, exec } from './sql.js';
import { now, parse, transition, addMessage, isGone } from './core.js';

export const RACE_MIN = 2;
export const RACE_MAX = 8;
export const TRACKS = ['ring', 'canyon', 'city'];
const LAPS = 3;
const COUNTDOWN_MS = 4_000;
const RACE_MS = 5 * 60_000;
// После первого финиша остальным даётся столько времени.
const AFTER_FIRST_MS = 30_000;
// Быстрее этого круг проехать невозможно — защита от явной ошибки клиента.
const MIN_LAP_MS = 8_000;

const stateOf = (lobby) => parse(lobby.mstate, null);
const nameOf = (players, id) => (players.find((p) => p.user_id === id) || {}).name || 'Игрок';

export async function startRace(lobby, ids, track) {
  const state = { track: TRACKS.includes(track) ? track : TRACKS[0], laps: LAPS, ids, grid: shuffle(ids), firstFinish: null, results: null };
  await exec('DELETE FROM race_pos WHERE lobby_id = :id', { id: lobby.id });
  const t = now();
  const next = await transition(lobby, {
    phase: 'r_countdown', round_no: lobby.round_no + 1, last_result: null,
    phase_start: t, deadline: t + COUNTDOWN_MS, mstate: JSON.stringify(state),
  });
  if (next) await addMessage(next, 'm', { body: 'На старт! Внимание…' });
  return next;
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const positions = (lobby) => many('SELECT user_id, data, finish_ms, updated_at FROM race_pos WHERE lobby_id = :id', { id: lobby.id });

// Позиция машины: { x, y, a, v, lap, s } — круг, путь по трассе и т. д.;
// fin — время финиша в мс от старта (присылается один раз).
export async function pushRacePos(lobby, user, pos) {
  // Позиции на решётке тоже показываем — соперников видно ещё до старта.
  if (!pos || (lobby.phase !== 'r_race' && lobby.phase !== 'r_countdown')) return;
  const state = stateOf(lobby);
  if (!state || !state.ids.includes(user.id)) return;
  const data = JSON.stringify({
    x: +pos.x || 0, y: +pos.y || 0, a: +pos.a || 0, v: +pos.v || 0,
    lap: Math.max(0, Math.min(LAPS, pos.lap | 0)), s: +pos.s || 0,
  });
  const elapsed = now() - lobby.phase_start;
  let fin = null;
  if (pos.fin != null && lobby.phase === 'r_race') {
    const ms = Math.round(+pos.fin);
    // Время с телефона точнее серверного, но не может быть больше прошедшего.
    if (ms >= MIN_LAP_MS * LAPS && ms <= elapsed + 2_000) fin = ms;
  }
  await exec(
    `INSERT INTO race_pos (lobby_id, user_id, data, finish_ms, updated_at) VALUES (:id, :u, :d, :fin, :t)
     ON CONFLICT (lobby_id, user_id) DO UPDATE SET data = :d, updated_at = :t,
       finish_ms = COALESCE(race_pos.finish_ms, :fin)`,
    { id: lobby.id, u: user.id, d: data, fin, t: now() },
  );
  if (fin && !state.firstFinish) {
    state.firstFinish = now();
    const next = await transition(lobby, { mstate: JSON.stringify(state), deadline: Math.min(lobby.deadline, now() + AFTER_FIRST_MS) });
    if (next) await addMessage(next, 'm', { body: `${user.name} финиширует первым! У остальных 30 секунд.` });
  }
}

// Итоги: финишировавшие по времени, остальные — по пройденному пути.
function rank(state, rows) {
  const by = new Map(rows.map((r) => [r.user_id, r]));
  return state.ids.map((id) => {
    const r = by.get(id);
    const d = r ? parse(r.data, {}) : {};
    return { id, fin: r && r.finish_ms != null ? r.finish_ms : null, progress: (d.lap || 0) * 1e6 + (d.s || 0) };
  }).sort((a, b) => (a.fin != null && b.fin != null ? a.fin - b.fin : a.fin != null ? -1 : b.fin != null ? 1 : b.progress - a.progress));
}

async function finishRace(lobby, players, state, rows) {
  state.results = rank(state, rows).map((r) => [r.id, r.fin]);
  const next = await transition(lobby, { phase: 'final', deadline: null, mstate: JSON.stringify(state) });
  if (next) await addMessage(next, 'm', { body: `Гонка окончена! Победитель — ${nameOf(players, state.results[0][0])}.` });
  return next;
}

export async function raceAdvance(lobby, players, t) {
  const state = stateOf(lobby);
  if (!state) return undefined;
  if (lobby.phase === 'r_countdown') {
    if (t < lobby.deadline) return undefined;
    const next = await transition(lobby, { phase: 'r_race', phase_start: t, deadline: t + RACE_MS });
    if (next) await addMessage(next, 'm', { body: 'Марш!' });
    return next;
  }
  if (lobby.phase !== 'r_race') return undefined;
  const rows = await positions(lobby);
  const racing = state.ids.filter((id) => {
    const p = players.find((x) => x.user_id === id);
    return p && !isGone(p, t);
  });
  const done = racing.every((id) => rows.some((r) => r.user_id === id && r.finish_ms != null));
  if (t >= lobby.deadline || done || racing.length === 0) return finishRace(lobby, players, state, rows);
  return undefined;
}

export async function raceView(lobby, userId) {
  const state = stateOf(lobby);
  if (!state || !state.track) return null;
  const rows = await positions(lobby);
  const out = {
    track: state.track, laps: state.laps, ids: state.ids, grid: state.grid,
    // Списки, а не объекты с ключами-id: платформа не сериализует ключи-числа.
    cars: rows.filter((r) => r.user_id !== userId).map((r) => [r.user_id, parse(r.data, {}), r.finish_ms, r.updated_at]),
    order: lobby.phase === 'r_race' ? rank(state, rows).map((r) => r.id) : null,
    firstFinish: state.firstFinish,
    results: state.results,
  };
  const mine = rows.find((r) => r.user_id === userId);
  if (mine) out.myFinish = mine.finish_ms;
  return out;
}

// «Крестики-нолики» на двоих: классика 3×3 (три в ряд) или большое поле
// 10×10 (пять в ряд). Крестики ходят первыми; в реванше игроки меняются
// знаками, счёт серии копится между партиями.
//
// Доска — строка size×size из '.', 'x', 'o'.

import { now, fail, parse, transition, addMessage, isGone } from './core.js';

export const VARIANTS = { 3: { size: 3, need: 3 }, 10: { size: 10, need: 5 } };

const stateOf = (lobby) => parse(lobby.mstate, null);
const nameOf = (players, id) => (players.find((p) => p.user_id === id) || {}).name || 'Игрок';
const other = (m) => (m === 'x' ? 'o' : 'x');

// Линия из need одинаковых знаков через клетку i, или null.
export function winLine(board, size, need, i) {
  const mark = board[i];
  if (mark === '.') return null;
  const r = Math.floor(i / size), c = i % size;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [i];
    for (const sgn of [1, -1]) {
      let rr = r + dr * sgn, cc = c + dc * sgn;
      while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] === mark) {
        line.push(rr * size + cc);
        rr += dr * sgn; cc += dc * sgn;
      }
    }
    if (line.length >= need) return line.sort((a, b) => a - b);
  }
  return null;
}

export async function startTtt(lobby, ids, variant) {
  const v = VARIANTS[variant] || VARIANTS[3];
  const prev = stateOf(lobby);
  const same = prev && prev.x && ids.includes(prev.x) && ids.includes(prev.o);
  // Счёт серии сохраняется, пока играют те же двое.
  const score = same && prev.score ? prev.score : ids.map((id) => [id, 0]);
  const [x, o] = same ? [prev.o, prev.x] : Math.random() < 0.5 ? ids : [ids[1], ids[0]];
  const state = { size: v.size, need: v.need, board: '.'.repeat(v.size * v.size), turn: 'x', x, o, last: null, line: null, winner: null, reason: null, score };
  const t = now();
  const next = await transition(lobby, {
    phase: 't_play', round_no: lobby.round_no + 1, last_result: null,
    phase_start: t, deadline: null, mstate: JSON.stringify(state),
  });
  if (next) await addMessage(next, 'm', { body: 'Партия началась. Крестики ходят первыми.' });
  return next;
}

async function finish(lobby, players, state, winner, reason) {
  state.winner = winner;
  state.reason = reason;
  if (winner === 'x' || winner === 'o') {
    const id = state[winner];
    state.score = state.score.map(([u, n]) => [u, u === id ? n + 1 : n]);
  }
  const next = await transition(lobby, { phase: 'final', deadline: null, mstate: JSON.stringify(state) });
  if (next) await addMessage(next, 'm', { body: winner === 'draw' ? 'Ничья!' : `Победа: ${nameOf(players, state[winner])}. ${reason}` });
  return next;
}

export async function tttAdvance(lobby, players, t) {
  const state = stateOf(lobby);
  if (!state || lobby.phase !== 't_play') return undefined;
  for (const m of ['x', 'o']) {
    const p = players.find((x) => x.user_id === state[m]);
    if (!p || isGone(p, t)) return finish(lobby, players, state, other(m), `${nameOf(players, state[m])} покидает игру.`);
  }
  return undefined;
}

// kind: 'move' (cell) или 'resign'.
export async function tttAct(lobby, players, user, kind, cell) {
  const state = stateOf(lobby);
  if (!state || lobby.phase !== 't_play') fail('NOT_NOW', 'Партия уже закончилась');
  const mark = user.id === state.x ? 'x' : user.id === state.o ? 'o' : null;
  if (!mark) fail('NOT_PLAYER', 'Вы не играете в этой партии');
  if (kind === 'resign') return finish(lobby, players, state, other(mark), `${nameOf(players, user.id)} сдаётся.`);
  if (kind !== 'move') fail('BAD', 'Неизвестное действие');
  if (state.turn !== mark) fail('NOT_YOUR_TURN', 'Сейчас ход соперника');
  const i = Number(cell);
  if (!Number.isInteger(i) || i < 0 || i >= state.board.length || state.board[i] !== '.') fail('TAKEN', 'Клетка занята');

  state.board = state.board.slice(0, i) + mark + state.board.slice(i + 1);
  state.last = i;
  state.turn = other(mark);
  const line = winLine(state.board, state.size, state.need, i);
  if (line) {
    state.line = line;
    const next = await transition(lobby, { mstate: JSON.stringify(state) });
    if (!next) fail('CONFLICT', 'Доска изменилась — попробуйте ещё раз');
    return finish(next, players, state, mark, `${state.need} в ряд!`);
  }
  if (!state.board.includes('.')) {
    const next = await transition(lobby, { mstate: JSON.stringify(state) });
    if (!next) fail('CONFLICT', 'Доска изменилась — попробуйте ещё раз');
    return finish(next, players, state, 'draw', 'Поле заполнено.');
  }
  const next = await transition(lobby, { mstate: JSON.stringify(state) });
  if (!next) fail('CONFLICT', 'Доска изменилась — попробуйте ещё раз');
  return next;
}

export function tttView(lobby, userId) {
  const state = stateOf(lobby);
  if (!state || state.board == null || !state.need) return null;
  return {
    size: state.size, need: state.need, board: state.board, turn: state.turn, x: state.x, o: state.o,
    myMark: userId === state.x ? 'x' : userId === state.o ? 'o' : null,
    last: state.last, line: state.line, winner: state.winner, reason: state.reason,
    score: state.score,
  };
}

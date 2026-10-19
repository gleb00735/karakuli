// «Шашки» (русские) для двоих.
//
// Правила: доска 8×8, игра на тёмных полях, белые внизу и ходят первыми.
// Простая шашка ходит вперёд по диагонали на одно поле, а бьёт в любую
// сторону. Бить обязательно, за ход можно бить несколько шашек подряд;
// путь взятия выбирает игрок, но начатое взятие нужно довести до конца.
// Дошедшая до последнего ряда шашка становится дамкой — даже посреди
// взятия, и продолжает бить уже как дамка. Дамка ходит и бьёт на любое
// расстояние по диагонали. Сбитые шашки снимаются после хода, и дважды
// через одну шашку перепрыгивать нельзя («турецкий удар»).
//
// Доска — строка из 64 символов: '.' пусто, 'w'/'b' — шашки, 'W'/'B' — дамки.
// Ход — путь [откуда, куда, (куда дальше)…]. Сервер сам считает все
// допустимые ходы и отдаёт их игроку, чей ход, поэтому клиенту не нужен
// свой движок правил.

import { now, fail, parse, transition, addMessage, isGone } from './core.js';

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const at = (r, c) => r * 8 + c;
const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const colorOf = (ch) => (ch === '.' ? null : ch.toLowerCase());
const isKing = (ch) => ch === 'W' || ch === 'B';
const promoRow = (color) => (color === 'w' ? 0 : 7);
const other = (color) => (color === 'w' ? 'b' : 'w');
// После стольких ходов дамками без взятий и ходов простыми шашками — ничья.
const DRAW_PLIES = 30;

export function initialBoard() {
  let b = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) b += (r + c) % 2 === 0 ? '.' : r < 3 ? 'b' : r > 4 ? 'w' : '.';
  }
  return b;
}

// Все цепочки взятий из pos. taken — уже сбитые за этот ход (они стоят на
// доске до конца хода и загораживают путь).
function captureChains(board, pos, king, color, taken) {
  const out = [];
  const r = pos >> 3, c = pos & 7;
  for (const [dr, dc] of DIRS) {
    let mid = -1;
    const landings = [];
    if (!king) {
      const r2 = r + 2 * dr, c2 = c + 2 * dc;
      if (!inside(r2, c2)) continue;
      const m = at(r + dr, c + dc);
      if (colorOf(board[m]) === other(color) && !taken.includes(m) && board[at(r2, c2)] === '.') {
        mid = m;
        landings.push(at(r2, c2));
      }
    } else {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc) && board[at(rr, cc)] === '.') { rr += dr; cc += dc; }
      if (!inside(rr, cc)) continue;
      const m = at(rr, cc);
      if (colorOf(board[m]) !== other(color) || taken.includes(m)) continue;
      mid = m;
      rr += dr; cc += dc;
      while (inside(rr, cc) && board[at(rr, cc)] === '.') { landings.push(at(rr, cc)); rr += dr; cc += dc; }
    }
    if (mid < 0 || !landings.length) continue;
    const options = landings.map((land) => {
      const k = king || land >> 3 === promoRow(color);
      return { land, rest: captureChains(board, land, k, color, [...taken, mid]) };
    });
    // Если с какого-то поля приземления можно бить дальше — приземляться можно только туда.
    const cont = options.filter((o) => o.rest.length);
    for (const o of cont.length ? cont : options) {
      if (!o.rest.length) out.push({ path: [o.land], caps: [mid] });
      else for (const s of o.rest) out.push({ path: [o.land, ...s.path], caps: [mid, ...s.caps] });
    }
  }
  return out;
}

// Все допустимые ходы стороны color: [{ path: [from, …], caps: [...] }].
export function legalMoves(board, color) {
  const caps = [];
  const quiet = [];
  for (let i = 0; i < 64; i++) {
    if (colorOf(board[i]) !== color) continue;
    const king = isKing(board[i]);
    // Своё исходное поле на время хода свободно.
    const b = board.slice(0, i) + '.' + board.slice(i + 1);
    for (const s of captureChains(b, i, king, color, [])) caps.push({ path: [i, ...s.path], caps: s.caps });
    if (caps.length) continue;
    const r = i >> 3, c = i & 7;
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== (color === 'w' ? -1 : 1)) continue;
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc) && board[at(rr, cc)] === '.') {
        quiet.push({ path: [i, at(rr, cc)], caps: [] });
        if (!king) break;
        rr += dr; cc += dc;
      }
    }
  }
  return caps.length ? caps : quiet;
}

export function applyMove(board, move) {
  const b = board.split('');
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  let piece = b[from];
  const color = colorOf(piece);
  b[from] = '.';
  for (const c of move.caps) b[c] = '.';
  if (!isKing(piece) && move.path.slice(1).some((sq) => sq >> 3 === promoRow(color))) piece = piece.toUpperCase();
  b[to] = piece;
  return b.join('');
}

const count = (board, color) => [...board].filter((ch) => colorOf(ch) === color).length;

// ─── Партия ────────────────────────────────────────────────────────────────

const stateOf = (lobby) => parse(lobby.mstate, null);
const nameOf = (players, id) => (players.find((p) => p.user_id === id) || {}).name || 'Игрок';

// Цвета случайные; в реванше меняются местами.
export async function startCheckers(lobby, ids) {
  const prev = stateOf(lobby);
  let white, black;
  if (prev && prev.white && ids.includes(prev.white) && ids.includes(prev.black)) [white, black] = [prev.black, prev.white];
  else [white, black] = Math.random() < 0.5 ? ids : [ids[1], ids[0]];
  const state = { board: initialBoard(), turn: 'w', white, black, last: null, plies: 0, quiet: 0, winner: null, reason: null, drawOffer: null };
  const t = now();
  const next = await transition(lobby, {
    phase: 'c_play', round_no: lobby.round_no + 1, last_result: null,
    phase_start: t, deadline: null, mstate: JSON.stringify(state),
  });
  if (next) await addMessage(next, 'm', { body: 'Партия началась. Белые ходят первыми.' });
  return next;
}

async function finish(lobby, players, state, winner, reason) {
  state.winner = winner;
  state.reason = reason;
  state.drawOffer = null;
  const next = await transition(lobby, { phase: 'final', deadline: null, mstate: JSON.stringify(state) });
  if (next) {
    const who = winner === 'draw' ? 'Ничья' : `Победа: ${nameOf(players, winner === 'w' ? state.white : state.black)}`;
    await addMessage(next, 'm', { body: `${who}. ${reason}` });
  }
  return next;
}

// Соперник пропал дольше чем на GAME_GONE_MS — победа оставшемуся.
export async function checkersAdvance(lobby, players, t) {
  const state = stateOf(lobby);
  if (!state || lobby.phase !== 'c_play') return undefined;
  for (const color of ['w', 'b']) {
    const id = color === 'w' ? state.white : state.black;
    const p = players.find((x) => x.user_id === id);
    if (!p || isGone(p, t)) return finish(lobby, players, state, other(color), `${nameOf(players, id)} покидает игру.`);
  }
  return undefined;
}

// kind: 'move' (path), 'resign', 'draw' (предложить), 'accept', 'decline'.
export async function checkersAct(lobby, players, user, kind, path) {
  const state = stateOf(lobby);
  if (!state || lobby.phase !== 'c_play') fail('NOT_NOW', 'Партия уже закончилась');
  const color = user.id === state.white ? 'w' : user.id === state.black ? 'b' : null;
  if (!color) fail('NOT_PLAYER', 'Вы не играете в этой партии');

  if (kind === 'resign') return finish(lobby, players, state, other(color), `${nameOf(players, user.id)} сдаётся.`);

  if (kind === 'draw') {
    if (state.drawOffer) return;
    state.drawOffer = user.id;
    const next = await transition(lobby, { mstate: JSON.stringify(state) });
    if (next) await addMessage(next, 'm', { body: `${nameOf(players, user.id)} предлагает ничью.` });
    return next;
  }
  if (kind === 'accept' || kind === 'decline') {
    if (!state.drawOffer || state.drawOffer === user.id) return;
    if (kind === 'accept') return finish(lobby, players, state, 'draw', 'Игроки договорились о ничьей.');
    state.drawOffer = null;
    const next = await transition(lobby, { mstate: JSON.stringify(state) });
    if (next) await addMessage(next, 'm', { body: 'Ничья отклонена — играем дальше.' });
    return next;
  }

  if (kind !== 'move') fail('BAD', 'Неизвестное действие');
  if (state.turn !== color) fail('NOT_YOUR_TURN', 'Сейчас ход соперника');
  const want = Array.isArray(path) ? path.map(Number).join(',') : '';
  const move = legalMoves(state.board, color).find((m) => m.path.join(',') === want);
  if (!move) fail('ILLEGAL', 'Так ходить нельзя');

  const kingMove = isKing(state.board[move.path[0]]);
  state.board = applyMove(state.board, move);
  state.last = { path: move.path, caps: move.caps, color };
  state.plies += 1;
  state.quiet = !move.caps.length && kingMove ? state.quiet + 1 : 0;
  state.turn = other(color);
  state.drawOffer = null;

  if (!legalMoves(state.board, state.turn).length) {
    const reason = count(state.board, state.turn) ? 'У соперника не осталось ходов.' : 'Все шашки соперника сбиты.';
    const next = await transitionOrFail(lobby, state);
    return finish(next, players, state, color, reason);
  }
  if (state.quiet >= DRAW_PLIES) {
    const next = await transitionOrFail(lobby, state);
    return finish(next, players, state, 'draw', '15 ходов дамками без взятий.');
  }
  return transitionOrFail(lobby, state);
}

async function transitionOrFail(lobby, state) {
  const next = await transition(lobby, { mstate: JSON.stringify(state) });
  if (!next) fail('CONFLICT', 'Доска изменилась — попробуйте ещё раз');
  return next;
}

export function checkersView(lobby, userId) {
  const state = stateOf(lobby);
  if (!state || !state.board) return null;
  const myColor = userId === state.white ? 'w' : userId === state.black ? 'b' : null;
  const out = {
    board: state.board, turn: state.turn, white: state.white, black: state.black, myColor,
    last: state.last, winner: state.winner, reason: state.reason, drawOffer: state.drawOffer,
    left: { w: count(state.board, 'w'), b: count(state.board, 'b') },
  };
  if (lobby.phase === 'c_play' && myColor === state.turn) {
    const moves = legalMoves(state.board, myColor);
    out.moves = moves.map((m) => m.path);
    out.mustCapture = moves.length > 0 && moves[0].caps.length > 0;
  }
  return out;
}

// «Кто я?» на 3–8 игроков.
//
// Каждому загадан персонаж: его видят все, кроме самого игрока. Игроки
// ходят по кругу. В свой ход игрок задаёт вопрос с ответом «да/нет»
// (текстом или голосом), остальные отвечают кнопками. Большинство «да» —
// игрок спрашивает дальше, иначе ход переходит. Угадать себя можно в любой
// момент своего хода; ошибка тоже передаёт ход. Места — по порядку угадывания.
//
// Состояние партии — в lobbies.mstate, ответы на вопрос — в mafia_moves
// (ключ q<номер вопроса>, target: 1 — да, 2 — нет, 3 — не знаю).

import { many, exec } from './sql.js';
import { now, fail, parse, transition, addMessage, isGone } from './core.js';
import { normalize, isClose } from './text.js';
import { DECKS, DECK_KEYS, deckItems } from './who-decks.js';

export const WHO_MIN = 3;
export const WHO_MAX = 8;
export { DECK_KEYS };

const ASK_MS = 75_000;     // на вопрос (или догадку) в свой ход
const ANSWER_MS = 30_000;  // остальным на ответ
const YES = 1, NO = 2, DUNNO = 3;

const stateOf = (lobby) => parse(lobby.mstate, null);
const nameOf = (players, id) => (players.find((p) => p.user_id === id) || {}).name || 'Игрок';
const isDone = (state, id) => state.done.some((d) => d.id === id);

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const save = (lobby, state, extra = {}) => transition(lobby, { mstate: JSON.stringify(state), ...extra });

export async function startWho(lobby, ids, deck) {
  const items = shuffle(deckItems(deck)).slice(0, ids.length);
  const state = {
    deck: DECKS[deck] ? deck : 'mix',
    chars: Object.fromEntries(ids.map((id, i) => [id, items[i]])),
    order: shuffle(ids), turn: 0, q: null, qn: 0, done: [], last: null,
  };
  state.asker = state.order[0];
  await exec('DELETE FROM mafia_moves WHERE lobby_id = :id', { id: lobby.id });
  const t = now();
  const next = await transition(lobby, {
    phase: 'w_play', round_no: lobby.round_no + 1, last_result: null,
    phase_start: t, deadline: t + ASK_MS, mstate: JSON.stringify(state),
  });
  if (next) await addMessage(next, 'm', { body: 'Персонажи розданы. Узнайте, кто вы, задавая вопросы «да или нет».' });
  return next;
}

// Следующий игрок по кругу из тех, кто ещё не угадал и на связи.
function passTurn(state, players, t) {
  const n = state.order.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.turn + k) % n;
    const id = state.order[i];
    const p = players.find((x) => x.user_id === id);
    if (!isDone(state, id) && p && !isGone(p, t)) {
      state.turn = i;
      state.asker = id;
      state.q = null;
      return true;
    }
  }
  return false;
}

// Игроки, которые ещё в игре и на связи.
const remaining = (state, players, t) => state.order.filter((id) => {
  const p = players.find((x) => x.user_id === id);
  return !isDone(state, id) && p && !isGone(p, t);
});

async function finishWho(lobby, players, state, note) {
  for (const id of state.order) if (!isDone(state, id)) state.done.push({ id, ok: false, left: true });
  state.q = null;
  const next = await transition(lobby, { phase: 'final', deadline: null, mstate: JSON.stringify(state) });
  if (next) {
    const first = state.done.find((d) => d.ok);
    if (note) await addMessage(next, 'm', { body: note });
    await addMessage(next, 'm', { body: first ? `Игра окончена! Первое место — ${nameOf(players, first.id)}.` : 'Игра окончена!' });
  }
  return next;
}

async function nextTurn(lobby, players, state, t, note) {
  if (remaining(state, players, t).length <= 1 || !passTurn(state, players, t)) return finishWho(lobby, players, state, note);
  const next = await save(lobby, state, { phase_start: t, deadline: t + ASK_MS });
  // «Теперь ходит Аня» — без падежей, имена не склоняются.
  if (next) await addMessage(next, 'm', { body: `${note ? note + ' ' : ''}Теперь ходит ${nameOf(players, state.asker)}.` });
  return next;
}

export async function whoAdvance(lobby, players, t) {
  const state = stateOf(lobby);
  if (!state || lobby.phase !== 'w_play') return undefined;
  if (remaining(state, players, t).length <= 1) return finishWho(lobby, players, state);

  const askerP = players.find((p) => p.user_id === state.asker);
  if (!askerP || isGone(askerP, t)) return nextTurn(lobby, players, state, t, `${nameOf(players, state.asker)} не на связи.`);

  if (state.q) {
    const voters = state.order.filter((id) => {
      const p = players.find((x) => x.user_id === id);
      return id !== state.asker && p && !isGone(p, t);
    });
    const answers = (await many('SELECT user_id, target FROM mafia_moves WHERE lobby_id = :id AND key = :key', { id: lobby.id, key: 'q' + state.q.id }))
      .filter((a) => voters.includes(a.user_id));
    if (answers.length < voters.length && t < lobby.deadline) return undefined;
    const yes = answers.filter((a) => a.target === YES).length;
    const no = answers.filter((a) => a.target === NO).length;
    state.last = { kind: 'answer', q: state.q.text, by: state.asker, yes, no, dunno: answers.length - yes - no };
    if (yes > no) {
      state.q = null;
      const next = await save(lobby, state, { phase_start: t, deadline: t + ASK_MS });
      if (next) await addMessage(next, 'm', { body: `Большинство ответило «да» (${yes}:${no}) — ${nameOf(players, state.asker)} спрашивает ещё.` });
      return next;
    }
    return nextTurn(lobby, players, state, t, `Ответ — «нет» (${yes}:${no}).`);
  }

  if (t >= lobby.deadline) return nextTurn(lobby, players, state, t, `Время ${nameOf(players, state.asker)} вышло.`);
  return undefined;
}

// Совпадает ли догадка с персонажем: любое из имён, с небольшой опечаткой
// (в длинных именах) или внутри фразы («я — гагарин»).
export function matches(guess, names) {
  const g = normalize(guess);
  if (!g) return false;
  return names.some((n) => {
    const w = normalize(n);
    // Опечатку прощаем только в длинных именах: «кот» и «крот» — разные звери.
    return g === w || (w.length >= 6 && isClose(g, w)) || (w.length >= 4 && ` ${g} `.includes(` ${w} `));
  });
}

// kind: 'ask' (text), 'answer' (value 1/2/3), 'guess' (text), 'giveup'.
export async function whoAct(lobby, players, user, kind, { text, value } = {}) {
  const state = stateOf(lobby);
  if (!state || lobby.phase !== 'w_play') fail('NOT_NOW', 'Игра уже закончилась');
  if (!state.order.includes(user.id)) fail('NOT_PLAYER', 'Вы не участвуете в этой партии');
  const t = now();
  const mine = user.id === state.asker;

  if (kind === 'answer') {
    if (!state.q || mine) return;
    const v = [YES, NO, DUNNO].includes(Number(value)) ? Number(value) : DUNNO;
    await exec(
      `INSERT INTO mafia_moves (lobby_id, key, user_id, target, created_at) VALUES (:id, :key, :u, :v, :t)
       ON CONFLICT (lobby_id, key, user_id) DO UPDATE SET target = :v, created_at = :t`,
      { id: lobby.id, key: 'q' + state.q.id, u: user.id, v, t },
    );
    return;
  }

  if (!mine) fail('NOT_YOUR_TURN', 'Сейчас не ваш ход');

  if (kind === 'ask') {
    if (state.q) fail('WAIT', 'Дождитесь ответов на прошлый вопрос');
    const q = String(text || '').trim().slice(0, 120) || '🎙 Вопрос голосом';
    state.qn += 1;
    state.q = { id: state.qn, text: q };
    const next = await save(lobby, state, { phase_start: t, deadline: t + ANSWER_MS });
    if (next) await addMessage(next, 'wq', { userId: user.id, name: user.name, body: q });
    return next;
  }

  if (kind === 'guess') {
    const names = state.chars[user.id];
    const g = String(text || '').trim().slice(0, 60);
    if (!g) return;
    if (matches(g, names)) {
      const place = state.done.filter((d) => d.ok).length + 1;
      state.done.push({ id: user.id, ok: true, place });
      state.last = { kind: 'right', by: user.id, guess: g, name: names[0] };
      return nextTurn(lobby, players, state, t, `${user.name} угадывает: «${names[0]}»! Это ${place}-е место.`);
    }
    state.last = { kind: 'wrong', by: user.id, guess: g };
    return nextTurn(lobby, players, state, t, `${user.name} думает, что это «${g}», — мимо.`);
  }

  if (kind === 'giveup') {
    state.done.push({ id: user.id, ok: false });
    state.last = { kind: 'giveup', by: user.id, name: state.chars[user.id][0] };
    return nextTurn(lobby, players, state, t, `${user.name} сдаётся. Это был персонаж «${state.chars[user.id][0]}».`);
  }
  fail('BAD', 'Неизвестное действие');
}

// Своего персонажа игрок видит, только когда угадал, сдался или игра окончена.
export async function whoView(lobby, userId) {
  const state = stateOf(lobby);
  if (!state || !state.chars || !state.order) return null;
  const final = lobby.phase === 'final';
  const iKnow = final || isDone(state, userId);
  const out = {
    deck: state.deck, deckName: DECKS[state.deck] ? DECKS[state.deck].name : 'Всё вперемешку',
    order: state.order, asker: state.asker, q: state.q, done: state.done, last: state.last,
    // Списки пар, а не объекты с ключами-id: платформа не сериализует ключи-числа.
    chars: state.order.filter((id) => id !== userId || iKnow).map((id) => [id, state.chars[id][0]]),
  };
  if (state.q) {
    const rows = await many('SELECT user_id, target FROM mafia_moves WHERE lobby_id = :id AND key = :key', { id: lobby.id, key: 'q' + state.q.id });
    out.answers = rows.map((r) => [r.user_id, r.target]);
  }
  return out;
}

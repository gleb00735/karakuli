// Прогон партии на троих без интерфейса: node --import ./dev/loader.mjs dev/sim.mjs
import assert from 'node:assert/strict';
import { applySchema } from './sdk/db.mjs';

const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
const skip = (ms) => { shift += ms; };
let everyone = async () => {};
const wait = async (ms) => { while (ms > 0) { const d = Math.min(ms, 5_000); skip(d); ms -= d; await everyone(); } };

applySchema(await import('../tgcloud/schema.js'));
const ep = async (name, input, uid) => {
  const mod = await import(`../tgcloud/endpoints/${name}.js`);
  try {
    return await mod.default(input, { initData: { user: { id: uid, first_name: 'U' + uid } } });
  } catch (e) {
    if (e.parameters) return { error: e.parameters.code, msg: e.description };
    throw e;
  }
};

const A = 1, B = 2, C = 3, D = 4;
const created = await ep('createLobby', {}, A);
const code = created.state.code;
console.log('code', code, created.state.phase);
assert.equal((await ep('joinLobby', { code: '9999x' }, B)).error, 'NOT_FOUND');
await ep('joinLobby', { code }, B);
await ep('joinLobby', { code }, C);
assert.equal((await ep('joinLobby', { code }, D)).error, 'FULL');
assert.equal((await ep('startGame', { code }, B)).error, 'NOT_HOST');
await ep('settings', { code, rounds: 1, drawTime: 60 }, A);

everyone = async () => { for (const u of [A, B, C]) await ep('sync', { code }, u); };
let s = await ep('startGame', { code }, A);
assert.equal(s.state.phase, 'pick');
const drawer = s.state.drawerId;
console.log('drawer', drawer, 'choices', s.state.choices);
s = await ep('pickWord', { code, index: 0 }, drawer);
assert.equal(s.state.phase, 'draw');
const word = s.state.word;
console.log('word', word, 'mask', s.state.mask);
await ep('sync', { code, ops: [{ t: 's', id: 1, c: 0, w: 1, p: [10, 10, 20, 20] }] }, drawer);
const others = [A, B, C].filter((u) => u !== drawer);
let g = await ep('sync', { code }, others[0]);
assert.equal(g.state.word, undefined);
assert.equal(g.strokes.length, 1);
console.log('guesser mask', g.state.mask);

let v = await ep('guess', { code, text: 'абракадабра' }, others[0]);
assert.equal(v.verdict.result, 'wrong');
const typo = word.length > 3 ? word.slice(0, -1) + (word.at(-1) === 'я' ? 'ю' : 'я') : null;
if (typo) console.log('typo verdict', (await ep('guess', { code, text: typo }, others[0])).verdict);
v = await ep('guess', { code, text: word.toUpperCase().replace(/е/g, 'ё') }, others[0]);
assert.equal(v.verdict.result, 'correct');
console.log('points', v.verdict.points);
await wait(31_000);
console.log('half-time mask', (await ep('sync', { code }, others[1])).state.mask);
v = await ep('guess', { code, text: word }, others[1]);
assert.equal(v.verdict.result, 'correct');
assert.equal(v.state.phase, 'reveal');
console.log('result', JSON.stringify(v.state.result));

// Следующие ходы: пусть время выбора и рисования истекает.
for (let i = 0; i < 6; i++) {
  await wait(16_000);
  s = await ep('sync', { code }, A);
  console.log('t+', i, s.state.phase, 'turn', s.state.turn, 'drawer', s.state.drawerId);
  if (s.state.phase === 'final') break;
  if (s.state.phase === 'draw') await wait(61_000);
}
s = await ep('sync', { code }, A);
assert.equal(s.state.phase, 'final');
console.log('final', s.state.players.map((p) => `${p.name}:${p.score}`).join(' '));
console.log('messages', s.messages.map((m) => m.kind + (m.body ? ':' + m.body : '')).join(' | '));

// Хозяин ушёл — роль переходит дальше.
await ep('leaveLobby', { code }, A);
s = await ep('sync', { code }, B);
assert.equal(s.state.hostId, B);
assert.equal((await ep('resume', {}, C)).code, code);
console.log('ALL OK');

// ─── Присутствие ───────────────────────────────────────────────────────────
{
  const X = 11, Y = 12, Z = 13;
  const r = await ep('createLobby', {}, X);
  const code = r.state.code;
  await ep('joinLobby', { code }, Y);
  await ep('joinLobby', { code }, Z);
  // Z закрыл приложение: через 10 с — «не в сети», через 30 с — выбыл.
  await wait0(12_000, [X, Y], code);
  let s = await ep('sync', { code }, X);
  assert.equal(s.state.players.find((p) => p.id === Z).active, false);
  assert.ok(s.messages.some((m) => m.kind === 'away' && m.userId === Z));
  await wait0(20_000, [X, Y], code);
  s = await ep('sync', { code }, X);
  assert.equal(s.state.players.length, 2);
  assert.ok(s.messages.some((m) => m.kind === 'left' && m.userId === Z));
  // Партия на двоих: Y пропадает посреди хода — игра прерывается.
  await ep('startGame', { code }, X);
  await wait0(12_000, [X], code);
  s = await ep('sync', { code }, X);
  assert.notEqual(s.state.phase, 'lobby', 'короткий обрыв связи не прерывает игру');
  await wait0(15_000, [X], code);
  s = await ep('sync', { code }, X);
  assert.equal(s.state.phase, 'lobby');
  assert.deepEqual(s.state.notice, { aborted: true, names: ['U12'], ids: [Y] });
  assert.ok(s.messages.some((m) => m.kind === 'abort'));
  // Y вернулся — снова в сети, сообщение «вернулся».
  s = await ep('sync', { code }, Y);
  assert.equal(s.state.players.find((p) => p.id === Y).active, true);
  assert.ok(s.messages.some((m) => m.kind === 'back' && m.userId === Y));
  console.log('PRESENCE OK', s.messages.map((m) => m.kind).join(' '));
}

async function wait0(ms, who, code) {
  while (ms > 0) { const d = Math.min(ms, 3_000); skip(d); ms -= d; for (const u of who) await ep('sync', { code }, u); }
}

// ─── Голос: сигналы доходят адресату ───────────────────────────────────────
{
  const P = 21, Q = 22;
  const code = (await ep('createLobby', {}, P)).state.code;
  let q = await ep('joinLobby', { code }, Q);
  assert.equal(q.sigCursor, 0);
  await ep('voice', { code, voice: 1 }, P);
  q = await ep('voice', { code, voice: 2 }, Q);
  assert.deepEqual(q.state.players.map((p) => p.voice), [1, 2]);
  await ep('sync', { code, signals: [{ to: Q, kind: 'offer', body: { sid: 'x', sdp: 'v=0' } }, { to: 999, kind: 'offer', body: 1 }] }, P);
  q = await ep('sync', { code, sigSince: 0 }, Q);
  assert.equal(q.signals.length, 1);
  assert.equal(q.signals[0].from, P);
  assert.equal(q.signals[0].body.sdp, 'v=0');
  const again = await ep('sync', { code, sigSince: q.sigCursor }, Q);
  assert.equal(again.signals.length, 0);
  console.log('VOICE SIGNALING OK');
}

// ─── Мафия ─────────────────────────────────────────────────────────────────
{
  const ids = [31, 32, 33, 34, 35];
  const code = (await ep('createLobby', { mode: 'mafia' }, 31)).state.code;
  for (const u of ids.slice(1)) await ep('joinLobby', { code }, u);
  let s = await ep('sync', { code }, 31);
  assert.equal(s.state.mode, 'mafia');
  assert.equal(s.state.maxPlayers, 8);
  assert.equal((await ep('settings', { code, mode: 'draw' }, 31)).error, 'TOO_MANY');
  const all = async () => { for (const u of ids) await ep('sync', { code }, u); };
  const wait1 = async (ms) => { while (ms > 0) { const d = Math.min(ms, 5000); skip(d); ms -= d; await all(); } };

  s = await ep('startGame', { code }, 31);
  assert.equal(s.state.phase, 'm_roles');
  const role = {};
  for (const u of ids) role[u] = (await ep('sync', { code }, u)).state.mafia.role;
  console.log('roles', JSON.stringify(role));
  const by = (r) => ids.filter((u) => role[u] === r);
  assert.equal(by('mafia').length, 1);
  // Мирный не видит чужих ролей.
  const civ = by('civ')[0];
  assert.deepEqual((await ep('sync', { code }, civ)).state.mafia.roles.map(([id]) => id), [String(civ)]);
  for (const u of ids) await ep('mafiaAct', { code, kind: 'ack' }, u);
  s = await ep('sync', { code }, 31);
  assert.equal(s.state.phase, 'm_night');

  // Ночь 1: мафия бьёт мирного, доктор лечит его же → спасён; комиссар проверяет мафию.
  const [maf] = by('mafia'), [com] = by('com'), [doc] = by('doc');
  assert.equal((await ep('mafiaAct', { code, kind: 'night', target: maf }, maf)).error, 'BAD_TARGET');
  assert.equal((await ep('mafiaAct', { code, kind: 'night', target: maf }, civ)).error, 'NO_ROLE');
  assert.equal((await ep('chat', { code, text: 'привет' }, civ)).error, 'NIGHT');
  await ep('chat', { code, text: 'кого бьём?' }, maf);
  await ep('mafiaAct', { code, kind: 'night', target: civ }, maf);
  await ep('mafiaAct', { code, kind: 'night', target: maf }, com);
  s = await ep('mafiaAct', { code, kind: 'night', target: civ }, doc);
  assert.equal(s.state.phase, 'm_morning');
  assert.deepEqual(s.state.mafia.night, { round: 1, killed: null, saved: true });
  s = await ep('sync', { code }, com);
  assert.deepEqual(s.state.mafia.checks, [[String(maf), 'mafia']]);
  assert.ok(!(await ep('sync', { code }, civ)).messages.some((m) => m.kind === 'mchat'), 'мирный не видит чат мафии');

  await wait1(10_000);
  s = await ep('sync', { code }, civ);
  assert.equal(s.state.phase, 'm_day');
  await ep('chat', { code, text: 'это он!' }, com);
  for (const u of ids) await ep('mafiaAct', { code, kind: 'ready' }, u);
  s = await ep('sync', { code }, civ);
  assert.equal(s.state.phase, 'm_vote');
  for (const u of ids) await ep('mafiaAct', { code, kind: 'vote', target: u === maf ? com : maf }, u);
  s = await ep('sync', { code }, civ);
  assert.equal(s.state.phase, 'm_verdict');
  assert.equal(s.state.mafia.vote.out, maf);
  await wait1(10_000);
  s = await ep('sync', { code }, civ);
  assert.equal(s.state.phase, 'final');
  assert.equal(s.state.mafia.winner, 'town');
  assert.equal(s.state.mafia.roles.length, 5);
  console.log('MAFIA OK', s.messages.filter((m) => m.kind === 'm').map((m) => m.body).join(' | '));

  // Повтор партии: мафия побеждает, когда сравнялась с мирными (дисконнект тоже выбывает).
  s = await ep('startGame', { code }, 31);
  assert.equal(s.state.phase, 'm_roles');
}

// ─── Шашки ─────────────────────────────────────────────────────────────────
{
  const [X, Y, Z] = [41, 42, 43];
  const code = (await ep('createLobby', { mode: 'checkers' }, X)).state.code;
  await ep('joinLobby', { code }, Y);
  assert.equal((await ep('joinLobby', { code }, Z)).error, 'FULL');
  let s = await ep('startGame', { code }, X);
  assert.equal(s.state.phase, 'c_play');
  const c = s.state.checkers;
  const white = c.white, black = c.black;
  const ws = await ep('sync', { code }, white);
  assert.equal(ws.state.checkers.moves.length, 7);
  assert.equal((await ep('sync', { code }, black)).state.checkers.moves, undefined);
  assert.equal((await ep('checkersAct', { code, kind: 'move', path: [40, 33] }, black)).error, 'NOT_YOUR_TURN');
  assert.equal((await ep('checkersAct', { code, kind: 'move', path: [40, 0] }, white)).error, 'ILLEGAL');
  // Несколько ходов первыми допустимыми вариантами.
  for (let i = 0; i < 6; i++) {
    const who = i % 2 ? black : white;
    const mv = (await ep('sync', { code }, who)).state.checkers.moves[0];
    s = await ep('checkersAct', { code, kind: 'move', path: mv }, who);
  }
  assert.equal(s.state.checkers.turn, 'w');
  await ep('checkersAct', { code, kind: 'draw' }, white);
  s = await ep('checkersAct', { code, kind: 'accept' }, black);
  assert.equal(s.state.phase, 'final');
  assert.equal(s.state.checkers.winner, 'draw');
  // Реванш: цвета меняются.
  s = await ep('startGame', { code }, X);
  assert.equal(s.state.checkers.white, black);
  s = await ep('checkersAct', { code, kind: 'resign' }, black);
  assert.equal(s.state.checkers.winner, 'b');
  console.log('CHECKERS GAME OK', s.messages.filter((m) => m.kind === 'm').map((m) => m.body).join(' | '));
}

// ─── Гонки ─────────────────────────────────────────────────────────────────
{
  const ids = [51, 52, 53];
  const code = (await ep('createLobby', { mode: 'race' }, 51)).state.code;
  for (const u of ids.slice(1)) await ep('joinLobby', { code }, u);
  await ep('settings', { code, track: 'canyon' }, 51);
  let s = await ep('startGame', { code }, 51);
  assert.equal(s.state.phase, 'r_countdown');
  assert.equal(s.state.race.track, 'canyon');
  const all = async (extra = () => ({})) => { for (const u of ids) await ep('sync', { code, ...extra(u) }, u); };
  skip(4_500); await all();
  s = await ep('sync', { code }, 51);
  assert.equal(s.state.phase, 'r_race');
  // Едем: позиции видны соперникам.
  skip(1000);
  await all((u) => ({ race: { x: u, y: 2, a: 0, v: 100, lap: 0, s: u * 10 } }));
  s = await ep('sync', { code }, 51);
  assert.deepEqual(s.state.race.cars.map((c) => c[0]).sort(), [52, 53]);
  assert.deepEqual(s.state.race.order, [53, 52, 51]);
  // Невозможно быстрый финиш не засчитывается.
  await ep('sync', { code, race: { x: 0, y: 0, lap: 3, s: 0, fin: 5000 } }, 52);
  assert.equal((await ep('sync', { code }, 52)).state.race.myFinish, null);
  // Честный финиш 52 → у остальных 30 с.
  for (let i = 0; i < 9; i++) { skip(5000); await all((u) => ({ race: { x: 0, y: 0, lap: 1, s: u } })); }
  await ep('sync', { code, race: { x: 0, y: 0, lap: 3, s: 0, fin: 44_000 } }, 52);
  s = await ep('sync', { code }, 51);
  assert.ok(s.state.deadline - s.state.serverNow <= 30_000);
  await ep('sync', { code, race: { x: 0, y: 0, lap: 3, s: 0, fin: 46_000 } }, 51);
  for (let i = 0; i < 7; i++) { skip(5000); await all((u) => (u === 53 ? { race: { x: 0, y: 0, lap: 2, s: 5 } } : {})); }
  s = await ep('sync', { code }, 51);
  assert.equal(s.state.phase, 'final');
  assert.deepEqual(s.state.race.results, [[52, 44000], [51, 46000], [53, null]]);
  console.log('RACE OK', s.messages.filter((m) => m.kind === 'm').map((m) => m.body).join(' | '));
}

// ─── Кто я? ────────────────────────────────────────────────────────────────
{
  const { matches } = await import('../tgcloud/lib/who.js');
  assert.ok(matches('гагарин', ['Юрий Гагарин', 'Гагарин']));
  assert.ok(matches('Я — Юрий Гагарин!', ['Юрий Гагарин', 'Гагарин']));
  assert.ok(matches('человек паук', ['Человек-паук', 'Спайдермен']));
  assert.ok(matches('Чебурашкаа', ['Чебурашка']));
  assert.ok(!matches('кот', ['Крот']));
  assert.ok(!matches('слон', ['Шрек']));

  const ids = [61, 62, 63];
  const code = (await ep('createLobby', { mode: 'who' }, 61)).state.code;
  for (const u of ids.slice(1)) await ep('joinLobby', { code }, u);
  assert.equal((await ep('startGame', { code }, 61)).error, undefined);
  let s = await ep('settings', { code, deck: 'animals' }, 61);
  assert.equal(s.error, 'IN_PROGRESS', 'колоду меняют только в лобби');
  s = await ep('sync', { code }, 61);
  assert.equal(s.state.phase, 'w_play');
  const w = s.state.who;
  assert.ok(!w.chars.some(([id]) => id === 61), 'своего персонажа не видно');
  assert.equal(w.chars.length, 2);
  const order = w.order;
  let asker = w.asker;
  const others = (a) => ids.filter((x) => x !== a);
  // Вопрос и ответы: «да» большинством → спрашивает снова.
  assert.equal((await ep('whoAct', { code, kind: 'ask', text: 'Я человек?' }, others(asker)[0])).error, 'NOT_YOUR_TURN');
  await ep('whoAct', { code, kind: 'ask', text: 'Я человек?' }, asker);
  for (const u of others(asker)) await ep('whoAct', { code, kind: 'answer', value: 1 }, u);
  s = await ep('sync', { code }, asker);
  assert.equal(s.state.who.asker, asker);
  assert.equal(s.state.who.q, null);
  // «Нет» → ход дальше.
  await ep('whoAct', { code, kind: 'ask', text: 'Я животное?' }, asker);
  for (const u of others(asker)) await ep('whoAct', { code, kind: 'answer', value: 2 }, u);
  s = await ep('sync', { code }, asker);
  assert.notEqual(s.state.who.asker, asker);
  asker = s.state.who.asker;
  // Правильная догадка: узнаём персонажа глазами соседа.
  const name = (await ep('sync', { code }, others(asker)[0])).state.who.chars.find(([id]) => id === asker)[1];
  s = await ep('whoAct', { code, kind: 'guess', text: name.toLowerCase() }, asker);
  assert.deepEqual(s.state.who.done[0], { id: asker, ok: true, place: 1 });
  assert.ok(s.state.who.chars.some(([id]) => id === asker), 'угадавший видит своего персонажа');
  // Следующий сдаётся → остаётся один → конец.
  asker = s.state.who.asker;
  s = await ep('whoAct', { code, kind: 'giveup' }, asker);
  assert.equal(s.state.phase, 'final');
  assert.equal(s.state.who.chars.length, 3);
  void order;
  console.log('WHO OK', s.messages.filter((m) => m.kind === 'm').map((m) => m.body).join(' | '));
}

// ─── Крестики-нолики ───────────────────────────────────────────────────────
{
  const { winLine } = await import('../tgcloud/lib/ttt.js');
  assert.deepEqual(winLine('xxx......', 3, 3, 1), [0, 1, 2]);
  assert.deepEqual(winLine('x...x...x', 3, 3, 4), [0, 4, 8]);
  assert.deepEqual(winLine('..x.x.x..', 3, 3, 6), [2, 4, 6]);
  assert.equal(winLine('xx.o.....', 3, 3, 0), null);

  const [X, Y] = [71, 72];
  const code = (await ep('createLobby', { mode: 'ttt' }, X)).state.code;
  await ep('joinLobby', { code }, Y);
  let s = await ep('startGame', { code }, X);
  assert.equal(s.state.phase, 't_play');
  let t = s.state.ttt;
  const px = t.x, po = t.o;
  assert.equal((await ep('tttAct', { code, kind: 'move', cell: 4 }, po)).error, 'NOT_YOUR_TURN');
  // Крестики собирают диагональ.
  for (const [who, c] of [[px, 0], [po, 1], [px, 4], [po, 2]]) await ep('tttAct', { code, kind: 'move', cell: c }, who);
  assert.equal((await ep('tttAct', { code, kind: 'move', cell: 4 }, px)).error, 'TAKEN');
  s = await ep('tttAct', { code, kind: 'move', cell: 8 }, px);
  assert.equal(s.state.phase, 'final');
  assert.equal(s.state.ttt.winner, 'x');
  assert.deepEqual(s.state.ttt.line, [0, 4, 8]);
  assert.deepEqual(s.state.ttt.score.find(([u]) => u === px), [px, 1]);
  // Реванш на большом поле: знаки меняются, счёт сохраняется.
  await ep('settings', { code, variant: 10 }, X);
  s = await ep('startGame', { code }, X);
  t = s.state.ttt;
  assert.equal(t.size, 10);
  assert.equal(t.x, po);
  assert.deepEqual(t.score.find(([u]) => u === px), [px, 1]);
  // Ничья на 3×3: x o x / x o o / o x x
  s = await ep('tttAct', { code, kind: 'resign' }, po);
  await ep('settings', { code, variant: 3 }, X);
  s = await ep('startGame', { code }, X);
  t = s.state.ttt;
  const seq = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  for (let k = 0; k < seq.length; k++) { s = await ep('tttAct', { code, kind: 'move', cell: seq[k] }, k % 2 ? t.o : t.x); if (s.error) console.log('move', k, s.error, s.msg); }
  assert.equal(s.state.ttt.winner, 'draw');
  console.log('TTT OK', s.messages.filter((m) => m.kind === 'm').map((m) => m.body).join(' | '));
}

// ─── Рекорды ───────────────────────────────────────────────────────────────
{
  let r = await ep('score', { game: '2048', score: 2000, extra: 256 }, 81);
  assert.equal(r.me.best, 2000);
  r = await ep('score', { game: '2048', score: 1500, extra: 128 }, 81);
  assert.equal(r.me.best, 2000, 'худший результат не затирает рекорд');
  assert.equal(r.top[0].extra, 256);
  await ep('score', { game: '2048', score: 5000, extra: 512 }, 82);
  r = await ep('score', { game: '2048' }, 81);
  assert.equal(r.me.rank, 2);
  assert.deepEqual(r.top.map((x) => x.id), [82, 81]);
  assert.equal((await ep('score', { game: '2048', score: 999999, extra: 8 }, 83)).error, 'BAD_SCORE');
  assert.equal((await ep('score', { game: '2048', score: 100, extra: 100 }, 83)).error, 'BAD_SCORE');
  console.log('SCORES OK');
}

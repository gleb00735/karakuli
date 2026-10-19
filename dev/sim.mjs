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

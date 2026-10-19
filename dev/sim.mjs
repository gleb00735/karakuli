// Прогон партии на троих без интерфейса: node --import ./dev/loader.mjs dev/sim.mjs
import assert from 'node:assert/strict';
import { applySchema } from './sdk/db.mjs';

const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
const skip = (ms) => { shift += ms; };
let everyone = async () => {};
const wait = async (ms) => { while (ms > 0) { const d = Math.min(ms, 10_000); skip(d); ms -= d; await everyone(); } };

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

// Правила 2048: node dev/test-2048.mjs
import assert from 'node:assert/strict';
import { move, newTile, canMove } from '../web/js/solo/engine2048.js';

const fromRows = (rows) => rows.flatMap((row, r) => row.map((v, c) => (v ? newTile(v, r, c) : null))).filter(Boolean);
const toRows = (tiles) => { const g = Array.from({ length: 4 }, () => [0, 0, 0, 0]); for (const t of tiles) g[t.r][t.c] = t.v; return g; };
const run = (rows, dir) => { const res = move(fromRows(rows), dir); return { rows: toRows(res.tiles), gained: res.gained, moved: res.moved }; };

// «2 2 2 2» влево → «4 4», а не «8».
assert.deepEqual(run([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'left').rows[0], [4, 4, 0, 0]);
// «2 2 2» влево → «4 2»; вправо → «2 4».
assert.deepEqual(run([[2, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'left').rows[0], [4, 2, 0, 0]);
assert.deepEqual(run([[2, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'right').rows[0], [0, 0, 2, 4]);
// Новая плитка за ход сливается один раз: «4 4 8» влево → «8 8».
assert.deepEqual(run([[4, 4, 8, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'left').rows[0], [8, 8, 0, 0]);
// Вертикаль: столбец 2/2/4/4 вверх → 4/8/0/0, очки 12.
const up = run([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]], 'up');
assert.deepEqual(up.rows.map((r) => r[0]), [4, 8, 0, 0]);
assert.equal(up.gained, 12);
// Вниз и с пробелами: 2/0/2/0 вниз → 0/0/0/4.
assert.deepEqual(run([[2, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0]], 'down').rows.map((r) => r[0]), [0, 0, 0, 4]);
// Ничего не сдвинулось — ход не засчитывается.
assert.equal(run([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 'left').moved, false);
// Конец игры: всё заполнено, соседних одинаковых нет.
assert.equal(canMove(fromRows([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]])), false);
assert.equal(canMove(fromRows([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]])), true);
console.log('2048 RULES OK');

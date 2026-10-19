// Проверка правил русских шашек: node --import ./dev/loader.mjs dev/checkers-test.mjs
import assert from 'node:assert/strict';
import { initialBoard, legalMoves, applyMove } from '../tgcloud/lib/checkers.js';

// Позиция из записи вида { a1: 'w', … } (буква — столбец a–h слева направо, цифра — ряд 1–8 снизу).
const sq = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
const nm = (i) => String.fromCharCode(97 + (i & 7)) + (8 - (i >> 3));
const pos = (pieces) => { const b = Array(64).fill('.'); for (const [k, v] of Object.entries(pieces)) b[sq(k)] = v; return b.join(''); };
const paths = (board, color) => legalMoves(board, color).map((m) => m.path.map(nm).join('-')).sort();

// 1. Начальная позиция: у белых 7 ходов, у чёрных тоже.
assert.equal(legalMoves(initialBoard(), 'w').length, 7);
assert.equal(legalMoves(initialBoard(), 'b').length, 7);

// 2. Бить обязательно: тихие ходы запрещены, если есть взятие.
assert.deepEqual(paths(pos({ c3: 'w', g3: 'w', d4: 'b' }), 'w'), ['c3-e5']);

// 3. Простая шашка бьёт назад и серией.
assert.deepEqual(paths(pos({ e5: 'w', d4: 'b', d2: 'b' }), 'w'), ['e5-c3-e1']);

// 4. Шашка, дошедшая до последнего ряда во время взятия, бьёт дальше как дамка:
//    b6×c7 → d8 (дамка) и сразу бьёт f6 по диагонали d8–h4.
assert.deepEqual(paths(pos({ e5: 'w', d6: 'b' }), 'w'), ['e5-c7']);
{
  const b = pos({ b6: 'w', c7: 'b', f6: 'b' });
  assert.deepEqual(paths(b, 'w'), ['b6-d8-g5', 'b6-d8-h4']);
  assert.equal(applyMove(b, legalMoves(b, 'w')[0])[sq('g5')], 'W', 'превратилась в дамку');
}

// 5. Дамка бьёт издалека; если после одного из полей приземления можно бить дальше — только туда.
{
  // Дамка a1, чёрная c3; за ней поля d4, e5, f6. С e5 можно бить g3? Нет — ставим чёрную на f4: с e5 бьём f4 → g3/h2.
  const b = pos({ a1: 'W', c3: 'b', f4: 'b' });
  assert.deepEqual(paths(b, 'w'), ['a1-e5-g3', 'a1-e5-h2']);
}

// 6. Турецкий удар: одну шашку дважды не бьют. Шашка обходит кольцо из
//    четырёх чёрных и возвращается на своё поле, но снова бить c5 не может.
{
  const b = pos({ b4: 'w', c5: 'b', e5: 'b', e3: 'b', c3: 'b' });
  const ms = legalMoves(b, 'w');
  assert.ok(ms.length > 0);
  for (const m of ms) assert.equal(new Set(m.caps).size, m.caps.length, 'шашка сбита дважды');
  assert.ok(ms.some((m) => m.caps.length === 4), 'кольцо можно снять целиком');
}

// 7. Нет ходов — проигрыш: белая шашка заперта.
assert.deepEqual(paths(pos({ a1: 'w', b2: 'b', c3: 'b' }), 'w'), []);

console.log('CHECKERS RULES OK');

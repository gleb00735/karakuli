// Правила 2048. Поле 4×4, плитки — объекты { id, v, r, c }. Ход сдвигает
// плитки к стороне свайпа; две одинаковые сливаются в одну (за ход — один раз),
// очки — значение новой плитки. Модуль без DOM: его проверяет dev/test-2048.mjs.

export const N = 4;
export const DIRS = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };

let nextId = 1;
export const newTile = (v, r, c) => ({ id: nextId++, v, r, c });
export const restoreIds = (tiles) => { for (const t of tiles) nextId = Math.max(nextId, t.id + 1); };

export function grid(tiles) {
  const g = Array.from({ length: N }, () => Array(N).fill(null));
  for (const t of tiles) g[t.r][t.c] = t;
  return g;
}

export function emptyCells(tiles) {
  const g = grid(tiles);
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!g[r][c]) out.push([r, c]);
  return out;
}

// Новая плитка: 2 с вероятностью 90 %, иначе 4.
export function spawn(tiles, rand = Math.random) {
  const free = emptyCells(tiles);
  if (!free.length) return null;
  const [r, c] = free[Math.floor(rand() * free.length)];
  const t = newTile(rand() < 0.9 ? 2 : 4, r, c);
  tiles.push(t);
  return t;
}

export function start(rand = Math.random) {
  const tiles = [];
  spawn(tiles, rand);
  spawn(tiles, rand);
  return tiles;
}

// Ход. Возвращает { tiles, moved, gained, merges: [{ into, from }] } —
// from — плитка, которая «въехала» в into и исчезнет после анимации.
export function move(tiles, dir) {
  const g = grid(tiles);
  const out = [];
  const merges = [];
  let moved = false, gained = 0;
  for (let line = 0; line < N; line++) {
    // Клетки линии, начиная со стороны, куда сдвигаем.
    const cells = [];
    for (let k = 0; k < N; k++) {
      if (dir === 'left') cells.push([line, k]);
      else if (dir === 'right') cells.push([line, N - 1 - k]);
      else if (dir === 'up') cells.push([k, line]);
      else cells.push([N - 1 - k, line]);
    }
    const row = cells.map(([r, c]) => g[r][c]).filter(Boolean);
    let slot = 0;
    for (let i = 0; i < row.length; i++) {
      const t = { ...row[i] };
      const prev = out.length && out[out.length - 1];
      if (prev && prev.line === line && !prev.merged && prev.v === t.v) {
        prev.v *= 2;
        prev.merged = true;
        gained += prev.v;
        merges.push({ into: prev.id, from: t.id, r: prev.r, c: prev.c });
        moved = true;
        continue;
      }
      const [nr, nc] = cells[slot++];
      if (nr !== t.r || nc !== t.c) moved = true;
      out.push({ ...t, r: nr, c: nc, line, merged: false });
    }
  }
  return { tiles: out.map(({ line, merged, ...t }) => t), moved, gained, merges };
}

export const canMove = (tiles) => Object.keys(DIRS).some((d) => move(tiles, d).moved);
export const maxTile = (tiles) => tiles.reduce((m, t) => Math.max(m, t.v), 0);

// Трассы гонок. Каждая задана опорными точками замкнутой кривой (в мировых
// единицах) и шириной дороги; гладкая осевая линия строится сплайном
// Катмулла — Рома. Старт/финиш — в первой точке, движение по порядку точек.

export const TRACKS = {
  ring: {
    name: 'Кольцо',
    width: 150,
    points: [[0, 0], [700, -60], [1250, 40], [1550, 380], [1450, 820], [1000, 1000], [450, 940], [-80, 1020], [-480, 760], [-520, 300], [-330, 40]],
  },
  canyon: {
    name: 'Каньон',
    width: 135,
    points: [[0, 0], [600, 0], [900, -250], [1300, -200], [1450, 150], [1150, 420], [1300, 750], [1700, 820], [1800, 1200], [1400, 1450], [900, 1300], [650, 950], [300, 1150], [-150, 1050], [-300, 650], [-50, 450], [-300, 200]],
  },
  city: {
    name: 'Город',
    width: 140,
    points: [[0, 0], [900, 0], [1100, 60], [1160, 260], [1160, 700], [1100, 900], [900, 960], [600, 960], [520, 900], [500, 700], [440, 560], [260, 560], [140, 640], [120, 900], [40, 1060], [-200, 1080], [-380, 1000], [-420, 700], [-420, 200], [-340, 40], [-180, 0]],
  },
};

const SAMPLES_PER_SEG = 24;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

// Готовая трасса: точки осевой линии, накопленная длина, общая длина, рамка.
export function buildTrack(key) {
  const def = TRACKS[key] || TRACKS.ring;
  const P = def.points;
  const n = P.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < SAMPLES_PER_SEG; k++) {
      pts.push(catmull(P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n], k / SAMPLES_PER_SEG));
    }
  }
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[pts.length];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const path = new Path2D();
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return { key, name: def.name, width: def.width, pts, cum, length, path, box: { minX, minY, maxX, maxY } };
}

// Ближайшая точка осевой линии около подсказки hint (окно поиска ± win).
export function nearest(track, x, y, hint = -1, win = 60) {
  const { pts } = track;
  const n = pts.length;
  let best = 0, bestD = Infinity;
  const from = hint < 0 ? 0 : hint - win;
  const to = hint < 0 ? n - 1 : hint + win;
  for (let j = from; j <= to; j++) {
    const i = ((j % n) + n) % n;
    const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { i: best, dist: Math.sqrt(bestD) };
}

// Направление трассы в точке i (угол в радианах, 0 — вправо).
export function heading(track, i) {
  const { pts } = track;
  const a = pts[i], b = pts[(i + 2) % pts.length];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

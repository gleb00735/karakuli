// Холст. Рисунок хранится в логических координатах 0…1000 по обеим осям,
// поэтому одинаково выглядит на любом экране. Изменения передаются
// операциями:
//   { t: 's', i, c, w, p: [x, y, …] } — новый штрих (цвет, толщина, точки)
//   { t: 'a', i, p: [x, y, …] }       — продолжение штриха i
//   { t: 'u', i }                     — отмена штриха i
//   { t: 'x' }                        — очистить холст

export const COLORS = [
  '#23203a', '#ff5d5d', '#ff9f43', '#ffc23d', '#22c3a6', '#10ac84', '#3fa7ff',
  '#2e5bff', '#7a5cff', '#e056fd', '#ff8fb1', '#8d5a3b', '#f7c6a3', '#9a95ad', '#ffffff',
];
export const ERASER = COLORS.length - 1;
export const SIZES = [5, 12, 26];
const ERASER_MULT = 2.2;
const LOGICAL = 1000;

export class Board {
  constructor(el) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.strokes = [];
    this.byId = new Map();
    this.scale = 1;
    this.onChange = null;
  }

  resize(cssSize) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.el.style.width = this.el.style.height = cssSize + 'px';
    this.canvas.width = this.canvas.height = Math.round(cssSize * dpr);
    this.scale = (cssSize * dpr) / LOGICAL;
    this.cssSize = cssSize;
    this.redraw();
  }

  toLogical(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.round(((clientX - r.left) / r.width) * LOGICAL);
    const y = Math.round(((clientY - r.top) / r.height) * LOGICAL);
    return [Math.max(0, Math.min(LOGICAL, x)), Math.max(0, Math.min(LOGICAL, y))];
  }

  get empty() { return this.strokes.length === 0; }
  get maxId() { return this.strokes.reduce((m, s) => Math.max(m, s.i), 0); }

  // Применить операцию целиком (без анимации).
  apply(op) {
    if (op.t === 's') this.begin(op.i, op.c, op.w, op.p);
    else if (op.t === 'a') this.extend(op.i, op.p);
    else if (op.t === 'u') this.remove(op.i);
    else if (op.t === 'x') this.clear();
  }

  begin(i, c, w, p = []) {
    if (this.byId.has(i)) return this.extend(i, p);
    const s = { i, c, w, p: [] };
    this.strokes.push(s);
    this.byId.set(i, s);
    this.extend(i, p);
    this.changed();
  }

  extend(i, pts) {
    const s = this.byId.get(i);
    if (!s || !pts || !pts.length) return;
    const from = s.p.length;
    for (const v of pts) s.p.push(v);
    this.paint(s, from);
  }

  remove(i) {
    const s = this.byId.get(i);
    if (!s) return;
    this.strokes.splice(this.strokes.indexOf(s), 1);
    this.byId.delete(i);
    this.redraw();
    this.changed();
  }

  clear() {
    this.strokes = [];
    this.byId.clear();
    this.redraw();
    this.changed();
  }

  changed() { if (this.onChange) this.onChange(); }

  redraw() {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of this.strokes) this.paint(s, 0);
  }

  // Дорисовать штрих начиная с точки с индексом from (в массиве координат).
  paint(s, from) {
    const { ctx } = this;
    const k = this.scale;
    const p = s.p;
    if (p.length < 2) return;
    const width = SIZES[s.w] * (s.c === ERASER ? ERASER_MULT : 1) * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = ctx.fillStyle = COLORS[s.c] || COLORS[0];
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0] * k, p[1] * k, width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    let start = Math.max(0, from - 2);
    if (start % 2) start--;
    if (from === 0) {
      ctx.beginPath();
      ctx.arc(p[0] * k, p[1] * k, width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(p[start] * k, p[start + 1] * k);
    for (let j = start + 2; j < p.length; j += 2) ctx.lineTo(p[j] * k, p[j + 1] * k);
    ctx.stroke();
  }
}

// Ввод художника: превращает касания в операции и копит их до отправки.
export class Pen {
  constructor(board) {
    this.board = board;
    this.color = 0;
    this.size = 1;
    this.eraser = false;
    this.pending = [];
    this.nextId = board.maxId + 1;
    this.active = null;
    this.enabled = true;
    this.drewSomething = false;
    const c = board.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e));
  }

  down(e) {
    if (!this.enabled || this.active !== null) return;
    e.preventDefault();
    this.board.canvas.setPointerCapture(e.pointerId);
    this.nextId = Math.max(this.nextId, this.board.maxId + 1);
    const id = this.nextId++;
    const c = this.eraser ? ERASER : this.color;
    const [x, y] = this.board.toLogical(e.clientX, e.clientY);
    this.active = { pointer: e.pointerId, id, lx: x, ly: y };
    this.board.begin(id, c, this.size, [x, y]);
    this.pending.push({ t: 's', i: id, c, w: this.size, p: [x, y] });
    this.drewSomething = true;
    if (this.onStroke) this.onStroke();
  }

  move(e) {
    const a = this.active;
    if (!a || e.pointerId !== a.pointer) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const pts = [];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = this.board.toLogical(ev.clientX, ev.clientY);
      if (Math.hypot(x - a.lx, y - a.ly) < 2.5) continue;
      pts.push(x, y);
      a.lx = x; a.ly = y;
    }
    if (!pts.length) return;
    this.board.extend(a.id, pts);
    const last = this.pending[this.pending.length - 1];
    if (last && (last.t === 's' || last.t === 'a') && last.i === a.id) last.p.push(...pts);
    else this.pending.push({ t: 'a', i: a.id, p: pts });
  }

  up(e) {
    const a = this.active;
    if (!a || e.pointerId !== a.pointer) return;
    const s = this.board.byId.get(a.id);
    // Одиночное касание — точка: дублируем координату, чтобы её было видно.
    if (s && s.p.length === 2) {
      this.board.extend(a.id, [s.p[0], s.p[1]]);
      this.pending.push({ t: 'a', i: a.id, p: [s.p[0], s.p[1]] });
    }
    this.active = null;
  }

  undo() {
    const last = this.board.strokes[this.board.strokes.length - 1];
    if (!last) return false;
    this.board.remove(last.i);
    this.pending.push({ t: 'u', i: last.i });
    return true;
  }

  clear() {
    if (this.board.empty) return false;
    this.board.clear();
    this.pending.push({ t: 'x' });
    return true;
  }

  take() {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  giveBack(ops) { this.pending = ops.concat(this.pending); }
}

// Воспроизведение у угадывающих: точки из пришедших пачек дорисовываются
// плавно, а не скачком раз в секунду.
export class Replay {
  constructor(board) {
    this.board = board;
    this.queue = [];
    this.raf = 0;
  }

  push(ops) {
    for (const op of ops) {
      if (op.t === 's') {
        this.queue.push({ t: 's', i: op.i, c: op.c, w: op.w, p: op.p.slice(0, 2) });
        for (let j = 2; j < op.p.length; j += 2) this.queue.push({ t: 'a', i: op.i, p: [op.p[j], op.p[j + 1]] });
      } else if (op.t === 'a') {
        for (let j = 0; j < op.p.length; j += 2) this.queue.push({ t: 'a', i: op.i, p: [op.p[j], op.p[j + 1]] });
      } else this.queue.push(op);
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  }

  // Мгновенно доиграть всё (например, при показе ответа).
  flush() {
    for (const op of this.queue) this.board.apply(op);
    this.queue = [];
  }

  tick() {
    this.raf = 0;
    if (!this.queue.length) return;
    // Очередь рассчитана примерно на 0,7 с воспроизведения.
    const n = Math.max(2, Math.ceil(this.queue.length / 40));
    const batch = this.queue.splice(0, n);
    // Подряд идущие точки одного штриха склеиваем, чтобы рисовать одной линией.
    let acc = null;
    for (const op of batch) {
      if (op.t === 'a' && acc && acc.i === op.i) { acc.p.push(...op.p); continue; }
      if (acc) this.board.apply(acc);
      acc = op.t === 'a' ? { t: 'a', i: op.i, p: op.p.slice() } : null;
      if (!acc) this.board.apply(op);
    }
    if (acc) this.board.apply(acc);
    if (this.queue.length) this.raf = requestAnimationFrame(() => this.tick());
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.queue = []; }
}

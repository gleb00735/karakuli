// Экран гонок. Своя машина считается здесь же (60 кадров в секунду),
// соперники — «призраки» по позициям с сервера с небольшой задержкой.
// Камера едет за машиной и поворачивается так, что машина всегда смотрит
// вверх: руль — касание левой или правой половины экрана.

import { h, icon, icons, svg, avatar } from '../ui.js';
import { haptic } from '../tg.js';
import { voiceButton } from './lobby.js';
import { buildTrack, nearest, heading } from '../race/tracks.js';

const COLORS = ['#ff5d5d', '#3fa7ff', '#ffc23d', '#22c3a6', '#7a5cff', '#ff9f43', '#e056fd', '#10ac84'];
const V_ROAD = 360;      // предельная скорость на асфальте, ед/с
const V_GRASS = 130;     // на траве
const ACCEL = 230;
const TURN = 2.6;        // рад/с на полной скорости
const GRIP = 6.5;        // как быстро скорость «догоняет» направление машины (дрифт)
const VIEW = 620;        // сколько мировых единиц видно по ширине
const GHOST_DELAY = 450; // мс: соперники рисуются в прошлом, чтобы было между чем интерполировать
const CAR_L = 46, CAR_W = 26;

const fmt = (ms) => {
  if (ms == null) return '—';
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};

export class RaceScreen {
  constructor({ room, actions, serverNow, voice }) {
    this.room = room;
    this.actions = actions;
    this.serverNow = serverNow;
    this.voice = voice;
    this.track = null;
    this.car = null;
    this.ghosts = new Map();
    this.steer = { left: false, right: false };
    this.finished = false;
    this.overlayKey = '';

    this.canvas = h('canvas.rc-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mini = h('canvas.rc-mini', { width: 220, height: 220 });
    this.hudLap = h('div.rc-stat');
    this.hudPos = h('div.rc-stat.pos');
    this.hudTime = h('div.rc-stat');
    this.countdown = h('div.rc-count');
    this.banner = h('div.rc-banner');
    this.leftBtn = h('div.rc-pad.left', null, svg(icons.back));
    this.rightBtn = h('div.rc-pad.right', null, svg(icons.back));

    this.el = h('div.screen.fixed.race', null,
      this.canvas,
      h('div.rc-top', null,
        h('div.rc-stats', null, this.hudPos, this.hudLap, this.hudTime),
        h('div.hud-btns', null, voiceButton(voice), h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('close'))),
      ),
      this.mini,
      this.countdown,
      this.banner,
      this.leftBtn,
      this.rightBtn,
    );

    const bind = (el, side) => {
      const on = (e) => { e.preventDefault(); this.steer[side] = true; };
      const off = (e) => { e.preventDefault(); this.steer[side] = false; };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    bind(this.leftBtn, 'left');
    bind(this.rightBtn, 'right');
    this.onKey = (e) => {
      const v = e.type === 'keydown';
      if (e.key === 'ArrowLeft' || e.key === 'a') this.steer.left = v;
      if (e.key === 'ArrowRight' || e.key === 'd') this.steer.right = v;
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);

    window.__race = this; // для автотестов (dev/e2e-race.mjs)
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  get s() { return this.room.state; }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
  }

  // ─── Состояние комнаты ───────────────────────────────────────────────────

  update(s) {
    const r = s.race;
    if (!r) return;
    if (!this.track) {
      this.track = buildTrack(r.track);
      this.placeOnGrid(r);
      this.drawMiniBase();
    }
    for (const [id, pos, fin, at] of r.cars) {
      let g = this.ghosts.get(id);
      if (!g) { g = { buf: [], fin: null }; this.ghosts.set(id, g); }
      if (!g.buf.length || g.buf[g.buf.length - 1].at !== at) g.buf.push({ at, ...pos });
      while (g.buf.length > 12) g.buf.shift();
      g.fin = fin;
    }
    if (r.myFinish != null) this.finished = true;
    this.renderOverlay(s, r);
  }

  absorb() {}

  // Позиция для отправки на сервер (main.js добавляет её в каждый опрос).
  get racePos() {
    const s = this.s;
    if (!this.car || !s || (s.phase !== 'r_race' && s.phase !== 'r_countdown')) return null;
    const c = this.car;
    const out = { x: Math.round(c.x), y: Math.round(c.y), a: +c.a.toFixed(3), v: Math.round(c.v), lap: c.lap, s: Math.round(c.s) };
    if (c.fin != null && !this.finSent) { out.fin = c.fin; }
    return out;
  }
  confirmFinish() { if (this.car && this.car.fin != null) this.finSent = true; }

  // Стартовая решётка: по двое в ряд за линией старта.
  placeOnGrid(r) {
    const tr = this.track;
    const slot = Math.max(0, r.grid.indexOf(this.s.me));
    const back = 70 + Math.floor(slot / 2) * 70;
    let i = tr.pts.length - 1, dist = 0;
    while (dist < back) { dist += tr.cum[i + 1] - tr.cum[i]; i--; }
    const a = heading(tr, i);
    const side = (slot % 2 ? 1 : -1) * tr.width * 0.22;
    const [px, py] = tr.pts[i];
    this.car = {
      x: px - Math.sin(a) * side, y: py + Math.cos(a) * side,
      a, v: 0, vx: 0, vy: 0, idx: i, lap: 0, s: tr.cum[i] - tr.length, fin: null,
    };
    this.camA = a;
  }

  // ─── Кадр ────────────────────────────────────────────────────────────────

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.track && this.car) {
      if (this.s.phase === 'r_race' && !this.finished) this.physics(dt);
      else if (this.finished) this.coast(dt);
      this.draw();
      this.hud();
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  physics(dt) {
    const c = this.car;
    const tr = this.track;
    let near = nearest(tr, c.x, c.y, c.idx);
    // Улетели далеко с трассы — ищем ближайшую точку по всей трассе.
    if (near.dist > tr.width * 3) near = nearest(tr, c.x, c.y);
    const onRoad = near.dist <= tr.width / 2;
    const vmax = onRoad ? V_ROAD : V_GRASS;
    // Газ автоматический; на траве машина сбрасывает скорость.
    c.v += (c.v < vmax ? ACCEL : -ACCEL * 1.6) * dt;
    if (c.v > vmax && onRoad) c.v = Math.max(vmax, c.v - ACCEL * dt);
    const steer = (this.steer.right ? 1 : 0) - (this.steer.left ? 1 : 0);
    c.a += steer * TURN * dt * Math.min(1, 0.35 + c.v / V_ROAD);
    // Скорость поворачивает к направлению машины не мгновенно — получается занос.
    const tx = Math.cos(c.a) * c.v, ty = Math.sin(c.a) * c.v;
    const k = Math.min(1, GRIP * dt);
    c.vx += (tx - c.vx) * k;
    c.vy += (ty - c.vy) * k;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (!onRoad && !this.wasOff) haptic.tick();
    this.wasOff = !onRoad;
    this.progress(near.i);
  }

  // После финиша машина плавно останавливается.
  coast(dt) {
    const c = this.car;
    c.v = Math.max(0, c.v - 300 * dt);
    c.vx *= 1 - Math.min(1, 2 * dt);
    c.vy *= 1 - Math.min(1, 2 * dt);
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  }

  // Путь по трассе и круги. s — пройденное в текущем круге (отрицательное —
  // ещё за линией старта). Срезать нельзя: круг засчитывается, только если
  // пройдена хотя бы половина трассы.
  progress(i) {
    const c = this.car;
    const L = this.track.length;
    const prev = c.idx;
    c.idx = i;
    let s = this.track.cum[i];
    const n = this.track.pts.length;
    // Переход через линию старта вперёд или назад.
    if (prev > n * 0.8 && i < n * 0.2) {
      if (c.s >= L * 0.5 || c.lap === 0 && c.s < 0) {
        if (c.s >= L * 0.5) c.lap += 1;
        if (c.lap >= this.s.race.laps && c.fin == null) {
          c.fin = Math.round(this.serverNow() - this.s.phaseStart);
          this.finished = true;
          haptic.ok();
        } else if (c.lap > 0) haptic.soft();
      }
    } else if (prev < n * 0.2 && i > n * 0.8) {
      s -= L; // откатились назад за линию
    } else if (c.s < 0 && i > n * 0.5) {
      s -= L; // ещё не пересекли старт после решётки
    }
    c.s = s;
  }

  // ─── Отрисовка ───────────────────────────────────────────────────────────

  ghostPos(g) {
    const at = this.serverNow() - GHOST_DELAY;
    const b = g.buf;
    if (!b.length) return null;
    if (b.length === 1 || at <= b[0].at) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].at <= at) {
        const p = b[i - 1], q = b[i];
        if (at >= q.at) return q;
        const k = (at - p.at) / Math.max(1, q.at - p.at);
        let da = q.a - p.a;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, a: p.a + da * k };
      }
    }
    return b[b.length - 1];
  }

  draw() {
    const { ctx, canvas, track: tr, car: c } = this;
    const W = canvas.width, H = canvas.height;
    const scale = W / VIEW;
    // Камера плавно доворачивает за машиной.
    let da = c.a - this.camA;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    this.camA += da * 0.12;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5fae4f';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.68);
    ctx.scale(scale, scale);
    ctx.rotate(-this.camA - Math.PI / 2);
    ctx.translate(-c.x, -c.y);

    // Трава в клетку для ощущения скорости.
    ctx.fillStyle = '#58a449';
    const g = 160, gx = Math.floor((c.x - 900) / g) * g, gy = Math.floor((c.y - 900) / g) * g;
    for (let x = gx; x < c.x + 900; x += g) for (let y = gy; y < c.y + 900; y += g) if (((x + y) / g) % 2 === 0) ctx.fillRect(x, y, g, g);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Бордюр: красно-белые полосы.
    ctx.lineWidth = tr.width + 22;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([]);
    ctx.stroke(tr.path);
    ctx.strokeStyle = '#e8463f';
    ctx.setLineDash([28, 28]);
    ctx.stroke(tr.path);
    ctx.setLineDash([]);
    // Асфальт.
    ctx.lineWidth = tr.width;
    ctx.strokeStyle = '#46434f';
    ctx.stroke(tr.path);
    // Разметка.
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 214, 92, .8)';
    ctx.setLineDash([30, 34]);
    ctx.stroke(tr.path);
    ctx.setLineDash([]);
    this.drawStartLine();

    // Соперники.
    const s = this.s;
    for (const [id, gh] of this.ghosts) {
      const p = this.ghostPos(gh);
      if (!p) continue;
      const pl = s.players.find((x) => x.id === id);
      this.drawCar(p.x, p.y, p.a, COLORS[s.race.ids.indexOf(id) % COLORS.length], 0.6, pl ? pl.name : '');
    }
    this.drawCar(c.x, c.y, c.a, COLORS[Math.max(0, s.race.ids.indexOf(s.me)) % COLORS.length], 1, '');
    this.drawMini();
  }

  drawStartLine() {
    const { ctx, track: tr } = this;
    const [x, y] = tr.pts[0];
    const a = heading(tr, 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const sq = 12, w = tr.width;
    for (let i = 0; i < w / sq; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fillRect(j * sq - sq, -w / 2 + i * sq, sq, sq);
      }
    }
    ctx.restore();
  }

  drawCar(x, y, a, color, alpha, label) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (label) {
      ctx.save();
      ctx.rotate(this.camA + Math.PI / 2);
      ctx.font = '700 15px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(20,16,34,.75)';
      const w = ctx.measureText(label).width + 12;
      ctx.fillRect(-w / 2, -48, w, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 0, -33);
      ctx.restore();
    }
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    roundRect(ctx, -CAR_L / 2 + 3, -CAR_W / 2 + 4, CAR_L, CAR_W, 8);
    ctx.fill();
    ctx.fillStyle = '#1b1828';
    for (const [wx, wy] of [[-14, -14], [12, -14], [-14, 14], [12, 14]]) { roundRect(ctx, wx - 6, wy - 3, 12, 6, 2); ctx.fill(); }
    ctx.fillStyle = color;
    roundRect(ctx, -CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(30, 40, 70, .85)';
    roundRect(ctx, 2, -CAR_W / 2 + 4, 11, CAR_W - 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    roundRect(ctx, -16, -3, 18, 6, 3);
    ctx.fill();
    ctx.restore();
  }

  drawMiniBase() {
    const tr = this.track;
    const { minX, minY, maxX, maxY } = tr.box;
    const pad = tr.width;
    const k = Math.min(200 / (maxX - minX + pad * 2), 200 / (maxY - minY + pad * 2));
    this.miniMap = (x, y) => [10 + (x - minX + pad) * k, 10 + (y - minY + pad) * k];
  }

  drawMini() {
    const m = this.mini.getContext('2d');
    const tr = this.track;
    m.clearRect(0, 0, 220, 220);
    m.lineJoin = 'round';
    m.beginPath();
    tr.pts.forEach(([x, y], i) => { const [px, py] = this.miniMap(x, y); i ? m.lineTo(px, py) : m.moveTo(px, py); });
    m.closePath();
    m.lineWidth = 9;
    m.strokeStyle = 'rgba(255,255,255,.85)';
    m.stroke();
    m.lineWidth = 5;
    m.strokeStyle = '#46434f';
    m.stroke();
    const dot = (x, y, color, r) => { const [px, py] = this.miniMap(x, y); m.beginPath(); m.arc(px, py, r, 0, Math.PI * 2); m.fillStyle = color; m.fill(); m.lineWidth = 2; m.strokeStyle = '#fff'; m.stroke(); };
    for (const [id, gh] of this.ghosts) {
      const p = this.ghostPos(gh);
      if (p) dot(p.x, p.y, COLORS[this.s.race.ids.indexOf(id) % COLORS.length], 6);
    }
    dot(this.car.x, this.car.y, COLORS[Math.max(0, this.s.race.ids.indexOf(this.s.me)) % COLORS.length], 8);
  }

  hud() {
    const s = this.s, r = s.race, c = this.car;
    const laps = r.laps;
    this.hudLap.textContent = `Круг ${Math.min(laps, c.lap + 1)}/${laps}`;
    // Место: по данным сервера, но свою позицию уточняем по локальному прогрессу.
    const L = this.track.length;
    let pos = 1;
    for (const gh of this.ghosts.values()) {
      const last = gh.buf[gh.buf.length - 1];
      if (!last) continue;
      if (c.fin != null) { if (gh.fin != null && gh.fin < c.fin) pos++; }
      else if (gh.fin != null || last.lap * L + last.s > c.lap * L + c.s) pos++;
    }
    this.hudPos.textContent = `${pos}/${r.ids.length}`;
    const t = s.phase === 'r_race' ? (c.fin != null ? c.fin : this.serverNow() - s.phaseStart) : s.phase === 'final' ? c.fin : 0;
    this.hudTime.textContent = fmt(Math.max(0, t || 0));

    // Обратный отсчёт.
    let cd = '';
    if (s.phase === 'r_countdown') {
      const left = Math.ceil((s.deadline - this.serverNow()) / 1000);
      cd = left > 3 ? '' : left > 0 ? String(left) : 'Марш!';
      if (cd !== this.lastCd && cd) haptic.tick();
    } else if (s.phase === 'r_race' && this.serverNow() - s.phaseStart < 900) cd = 'Марш!';
    if (cd !== this.lastCd) {
      this.lastCd = cd;
      this.countdown.textContent = cd;
      this.countdown.classList.remove('pop');
      void this.countdown.offsetWidth;
      if (cd) this.countdown.classList.add('pop');
    }
    let banner = '';
    if (s.phase === 'r_countdown') banner = 'Держите пальцы на кнопках руля';
    else if (s.phase === 'r_race' && c.fin != null) banner = `Финиш! ${fmt(c.fin)} · ждём остальных`;
    else if (s.phase === 'r_race' && r.firstFinish) banner = `Финиш через ${Math.max(0, Math.ceil((s.deadline - this.serverNow()) / 1000))} с`;
    else if (this.wasOff) banner = 'Вернитесь на трассу!';
    this.banner.textContent = banner;
    this.banner.style.opacity = banner ? '1' : '0';
  }

  renderOverlay(s, r) {
    const key = s.phase === 'final' && r.results ? 'final' : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (!key) return;
    const place = r.results.findIndex(([id]) => id === s.me) + 1;
    haptic[place === 1 ? 'ok' : 'soft']();
    const rows = r.results.map(([id, fin], i) => {
      const p = s.players.find((x) => x.id === id) || { id, name: 'Игрок' };
      return h('div.gain', null,
        h('div.rc-place', null, String(i + 1)),
        avatar(p),
        h('div.nm', null, id === s.me ? 'Вы' : p.name),
        h('div.plus' + (fin == null ? '.zero' : ''), null, fin == null ? 'не доехал' : fmt(fin)),
      );
    });
    const isHost = s.hostId === s.me;
    this.overlay = h('div.overlay', null,
      h('div', { style: { fontSize: '58px' } }, place === 1 ? '🏆' : place <= 3 ? '🏁' : '🚗'),
      h('div.hand', { style: { fontSize: '48px', lineHeight: 1, marginTop: '4px' } }, place === 1 ? 'Победа!' : `${place}-е место`),
      h('div.gains', null, rows),
      isHost
        ? h('div.row', { style: { width: '100%', maxWidth: '360px', marginTop: '18px' } },
            h('button.btn.mint', { onclick: (e) => { e.currentTarget.disabled = true; haptic.tap(); this.actions.start(); } }, svg(icons.replay), 'Ещё заезд'),
            h('button.btn.ghost', { style: { width: 'auto' }, onclick: () => { haptic.tap(); this.actions.toLobby(); } }, 'В лобби'))
        : h('div.waiting-pill', { style: { width: '100%', maxWidth: '360px', marginTop: '18px' } }, 'Ждём, пока хозяин начнёт', h('span.dots', null, h('span'), h('span'), h('span'))),
    );
    this.el.append(this.overlay);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

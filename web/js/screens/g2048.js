// Экран 2048. Игра целиком на телефоне; незаконченная партия хранится
// в localStorage, лучший результат уходит в общую таблицу рекордов.

import { h, svg, icon, icons, avatar, toast, sheet } from '../ui.js';
import { haptic, tg, BOT_USERNAME, confirm } from '../tg.js';
import { call } from '../api.js';
import { N, start, spawn, move, canMove, maxTile, restoreIds } from '../solo/engine2048.js';

const SAVE_KEY = 'karakuli-2048';
const SLIDE_MS = 110;

const store = {
  load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } },
  save(v) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(v)); } catch {} },
};

const fmt = (n) => n.toLocaleString('ru-RU');

export class G2048Screen {
  constructor({ back }) {
    this.back = back;
    this.tileEls = new Map();
    this.busy = false;

    this.scoreEl = h('div.g-val');
    this.bestEl = h('div.g-val');
    this.layer = h('div.g-layer');
    this.board = h('div.g-board', null,
      ...Array.from({ length: N * N }, () => h('div.g-cell')),
      this.layer);
    this.undoBtn = h('button.btn.ghost.small', { onclick: () => this.undo() }, icon('undo'), 'Отменить ход');

    this.el = h('div.screen.g2048', null,
      h('div.topbar', null,
        h('button.icon-btn', { onclick: back, 'aria-label': 'Назад' }, icon('back')),
        h('div.title', null, '2048'),
        h('button.icon-btn', { onclick: () => this.showTop(), 'aria-label': 'Рекорды' }, h('span', { style: { fontSize: '20px' } }, '🏆')),
      ),
      h('div.g-scores', null,
        h('div.g-score', null, h('div.g-lbl', null, 'Счёт'), this.scoreEl),
        h('div.g-score', null, h('div.g-lbl', null, 'Рекорд'), this.bestEl),
      ),
      h('div.g-hint.faint.small', null, 'Свайпайте, чтобы сдвигать плитки. Одинаковые сливаются — соберите 2048!'),
      h('div.g-wrap', null, this.board),
      h('div.row.g-actions', null,
        this.undoBtn,
        h('button.btn.ghost.small', { onclick: () => this.askRestart() }, svg(icons.replay), 'Заново'),
      ),
    );

    window.__g2048 = this; // для автотестов (dev/e2e-2048.mjs)
    this.bindInput();
    const saved = store.load();
    this.best = (saved && saved.best) || 0;
    if (saved && saved.tiles && saved.tiles.length && !saved.over) {
      this.tiles = saved.tiles;
      restoreIds(this.tiles);
      this.score = saved.score || 0;
      this.prev = saved.prev || null;
      this.undoUsed = !!saved.undoUsed;
      this.won = !!saved.won;
    } else this.reset();
    this.renderAll();
    // Подтягиваем рекорд с сервера (вдруг играли на другом телефоне).
    call('score', { game: '2048' }).then((r) => {
      if (r.me && r.me.best > this.best) { this.best = r.me.best; this.renderScore(); this.persist(); }
    }, () => {});
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
  }

  // ─── Управление ──────────────────────────────────────────────────────────

  bindInput() {
    let sx = 0, sy = 0, active = false;
    this.board.addEventListener('pointerdown', (e) => { active = true; sx = e.clientX; sy = e.clientY; this.board.setPointerCapture(e.pointerId); });
    this.board.addEventListener('pointerup', (e) => {
      if (!active) return;
      active = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      this.go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
    this.board.addEventListener('pointercancel', () => { active = false; });
    this.onKey = (e) => {
      const d = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
      if (d) { e.preventDefault(); this.go(d); }
    };
    window.addEventListener('keydown', this.onKey);
  }

  go(dir) {
    if (this.busy || this.over) return;
    const res = move(this.tiles, dir);
    if (!res.moved) { haptic.tick(); return; }
    this.prev = { tiles: this.tiles.map((t) => ({ ...t })), score: this.score };
    this.busy = true;
    // 1. Все плитки (и «съеденные») едут на новые места.
    const pos = new Map(res.tiles.map((t) => [t.id, t]));
    for (const m of res.merges) pos.set(m.from, { r: m.r, c: m.c });
    for (const [id, el] of this.tileEls) {
      const p = pos.get(id);
      if (p) this.place(el, p.r, p.c);
    }
    this.tiles = res.tiles;
    this.score += res.gained;
    if (res.gained) haptic.soft(); else haptic.tick();
    // 2. После сдвига — слияния и новая плитка.
    setTimeout(() => {
      for (const m of res.merges) {
        const gone = this.tileEls.get(m.from);
        if (gone) { gone.remove(); this.tileEls.delete(m.from); }
        const el = this.tileEls.get(m.into);
        const t = this.tiles.find((x) => x.id === m.into);
        if (el && t) { this.paint(el, t.v); el.classList.remove('merged'); void el.offsetWidth; el.classList.add('merged'); }
      }
      const fresh = spawn(this.tiles);
      if (fresh) this.addTile(fresh, true);
      this.busy = false;
      this.afterMove();
    }, SLIDE_MS);
  }

  afterMove() {
    if (this.score > this.best) this.best = this.score;
    this.renderScore();
    if (!this.won && maxTile(this.tiles) >= 2048) {
      this.won = true;
      haptic.ok();
      this.showEnd(true);
    } else if (!canMove(this.tiles)) {
      this.over = true;
      haptic.err();
      this.showEnd(false);
    }
    this.persist();
  }

  undo() {
    if (!this.prev || this.undoUsed || this.busy || this.over) {
      toast(this.undoUsed ? 'Отмена хода — одна на партию' : 'Нечего отменять', 'warn', 1500);
      return;
    }
    haptic.tap();
    this.tiles = this.prev.tiles;
    this.score = this.prev.score;
    this.prev = null;
    this.undoUsed = true;
    this.renderAll();
    this.persist();
  }

  reset() {
    this.closeEnd();
    this.tiles = start();
    this.score = 0;
    this.prev = null;
    this.undoUsed = false;
    this.won = false;
    this.over = false;
  }

  newGame() {
    haptic.tap();
    this.reset();
    this.renderAll();
    this.persist();
  }

  async askRestart() {
    if (this.score > 0 && !this.over && !(await confirm('Начать новую партию? Текущая пропадёт.'))) return;
    this.newGame();
  }

  persist() {
    store.save({ tiles: this.tiles, score: this.score, best: this.best, prev: this.prev, undoUsed: this.undoUsed, won: this.won, over: this.over });
  }

  // ─── Отрисовка ───────────────────────────────────────────────────────────

  place(el, r, c) { el.style.transform = `translate(${c * 100}%, ${r * 100}%)`; }

  paint(el, v) {
    el.dataset.v = v > 2048 ? 'big' : v;
    el.dataset.len = String(v).length;
    el.firstChild.textContent = v;
  }

  addTile(t, fresh) {
    const el = h('div.g-tile' + (fresh ? '.new' : ''), null, h('div.g-num'));
    this.paint(el, t.v);
    this.place(el, t.r, t.c);
    this.layer.append(el);
    this.tileEls.set(t.id, el);
  }

  renderAll() {
    this.layer.replaceChildren();
    this.tileEls.clear();
    for (const t of this.tiles) this.addTile(t, false);
    this.renderScore();
  }

  renderScore() {
    this.scoreEl.textContent = fmt(this.score);
    this.bestEl.textContent = fmt(this.best);
    this.undoBtn.disabled = !this.prev || this.undoUsed;
  }

  // ─── Итоги и рекорды ─────────────────────────────────────────────────────

  async submit() {
    try { return await call('score', { game: '2048', score: this.score, extra: maxTile(this.tiles) }); } catch { return null; }
  }

  closeEnd() { if (this.endEl) { this.endEl.remove(); this.endEl = null; } }

  async showEnd(won) {
    this.closeEnd();
    const rankEl = h('div.faint.small', { style: { marginTop: '8px', minHeight: '18px' } }, 'Сохраняем результат…');
    this.endEl = h('div.overlay', null,
      h('div', { style: { fontSize: '58px' } }, won ? '🎉' : '🧩'),
      h('div.hand', { style: { fontSize: '50px', lineHeight: 1, marginTop: '4px' } }, won ? '2048!' : 'Ходов нет'),
      h('div.muted', { style: { marginTop: '10px', fontWeight: 800 } }, `Счёт: ${fmt(this.score)} · плитка ${maxTile(this.tiles)}`),
      rankEl,
      h('div.col', { style: { width: '100%', maxWidth: '340px', marginTop: '20px' } },
        won ? h('button.btn.mint', { onclick: () => { haptic.tap(); this.closeEnd(); } }, 'Играть дальше') : h('button.btn.mint', { onclick: () => this.newGame() }, svg(icons.replay), 'Ещё раз'),
        h('button.btn.violet', { onclick: () => this.share() }, icon('share'), 'Поделиться рекордом'),
        h('button.btn.ghost', { onclick: () => this.showTop() }, '🏆 Таблица рекордов'),
      ),
    );
    this.el.append(this.endEl);
    const r = await this.submit();
    if (r && r.me) rankEl.textContent = `Ваше место в общей таблице: ${r.me.rank}`;
    else rankEl.textContent = '';
  }

  share() {
    haptic.tap();
    const text = `Мой счёт в 2048 — ${fmt(Math.max(this.score, this.best))}! Побьёшь? 🧩`;
    const url = `https://t.me/${BOT_USERNAME}`;
    const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    if (tg) tg.openTelegramLink(link); else window.open(link, '_blank');
  }

  async showTop() {
    haptic.tap();
    if (this.score > 0) await this.submit();
    const list = h('div.col', { style: { gap: '8px' } }, h('div.center', null, h('div.spinner')));
    sheet(h('div.col', null, h('div.h1.center', null, '🏆 Рекорды 2048'), list));
    let r;
    try { r = await call('score', { game: '2048' }); } catch { list.replaceChildren(h('div.muted.center', null, 'Нет связи с сервером')); return; }
    const rows = r.top.map((x, i) => h('div.gain', null,
      h('div.rc-place', null, String(i + 1)),
      avatar(x, { size: 34 }),
      h('div.nm', null, x.name),
      h('div.g-top-score', null, fmt(x.best), h('span.faint.small', null, ` · ${x.extra}`)),
    ));
    list.replaceChildren(...(rows.length ? rows : [h('div.muted.center', null, 'Пока пусто — будьте первым!')]),
      ...(r.me ? [h('div.muted.center', { style: { marginTop: '6px' } }, `Ваш рекорд: ${fmt(r.me.best)} · место ${r.me.rank}`)] : []));
  }
}

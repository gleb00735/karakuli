// Экран крестиков-ноликов: поле 3×3 или 10×10, знаки «рисуются» маркером,
// выигрышная линия перечёркивается.

import { h, svg, icon, icons, avatar } from '../ui.js';
import { haptic, confirm } from '../tg.js';
import { voiceButton } from './lobby.js';

const MARK_SVG = {
  x: '<svg viewBox="0 0 100 100" class="tt-mark x"><path pathLength="1" d="M22 22 78 78"/><path pathLength="1" d="M78 22 22 78" style="animation-delay:.12s"/></svg>',
  o: '<svg viewBox="0 0 100 100" class="tt-mark o"><path pathLength="1" d="M50 18a32 32 0 1 1-.1 0z"/></svg>',
};

export class TttScreen {
  constructor({ room, actions, voice }) {
    this.room = room;
    this.actions = actions;
    this.cells = [];
    this.size = 0;
    this.overlayKey = '';
    this.pending = null;

    this.boardEl = h('div.tt-board');
    this.lineSvg = svg('<svg class="tt-line" viewBox="0 0 100 100" preserveAspectRatio="none"><line pathLength="1"/></svg>');
    this.wrap = h('div.ck-wrap', null, h('div.tt-holder', null, this.boardEl, this.lineSvg));
    this.title = h('div.word-area');
    this.topBar = h('div.ck-player');
    this.bottomBar = h('div.ck-player.me');
    this.controls = h('div.ck-controls');

    this.el = h('div.screen.fixed.game.ttt', null,
      h('div.hud', null,
        h('div', { style: { width: '50px' } }),
        this.title,
        h('div.hud-btns', null, voiceButton(voice), h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('close'))),
      ),
      this.topBar,
      this.wrap,
      this.bottomBar,
      this.controls,
    );
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
  }

  destroy() { this.ro.disconnect(); }

  fit() {
    const r = this.wrap.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width, r.height));
    const holder = this.wrap.firstChild;
    if (size > 40) holder.style.width = holder.style.height = size + 'px';
  }

  get s() { return this.room.state; }

  build(size) {
    this.size = size;
    this.boardEl.style.setProperty('--n', size);
    this.boardEl.classList.toggle('big', size > 3);
    this.cells = Array.from({ length: size * size }, (_, i) => h('button.tt-cell', { onclick: () => this.tap(i), 'aria-label': `Клетка ${i + 1}` }));
    this.boardEl.replaceChildren(...this.cells);
    this.shown = '.'.repeat(size * size);
  }

  update(s) {
    const t = s.ttt;
    if (!t) return;
    if (t.size !== this.size) this.build(t.size);
    // Подтверждённый сервером ход снимает «ожидание».
    if (this.pending != null && t.board[this.pending] !== '.') this.pending = null;
    const board = this.pending != null ? t.board.slice(0, this.pending) + t.myMark + t.board.slice(this.pending + 1) : t.board;
    for (let i = 0; i < board.length; i++) {
      const cell = this.cells[i];
      if (board[i] !== this.shown[i]) {
        cell.replaceChildren(board[i] === '.' ? '' : svg(MARK_SVG[board[i]]));
        if (board[i] !== '.' && i === t.last && board[i] !== t.myMark) haptic.soft();
      }
      cell.classList.toggle('last', i === t.last);
      cell.classList.toggle('win', !!(t.line && t.line.includes(i)));
      cell.disabled = board[i] !== '.' || s.phase !== 't_play' || t.turn !== t.myMark || this.pending != null;
    }
    this.shown = board;
    this.renderLine(t);
    this.renderBars(s, t);
    this.renderControls(s);
    this.renderOverlay(s, t);
  }

  absorb() {}

  tap(i) {
    const s = this.s, t = s.ttt;
    if (!t || s.phase !== 't_play' || t.turn !== t.myMark || t.board[i] !== '.' || this.pending != null) return;
    haptic.tap();
    this.pending = i;
    this.update(s);
    this.actions.ttt('move', i).then((res) => {
      if (!res) { this.pending = null; this.update(this.s); }
    });
  }

  renderLine(t) {
    const line = this.lineSvg.querySelector('line');
    if (!t.line) { this.lineSvg.classList.remove('on'); return; }
    const n = t.size;
    const c = (i) => [((i % n) + 0.5) * (100 / n), (Math.floor(i / n) + 0.5) * (100 / n)];
    const [x1, y1] = c(t.line[0]);
    const [x2, y2] = c(t.line[t.line.length - 1]);
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    this.lineSvg.classList.add('on');
  }

  renderBars(s, t) {
    const meId = s.me;
    const oppId = t.x === meId ? t.o : t.x;
    const opp = s.players.find((p) => p.id === oppId) || { id: oppId, name: 'Соперник' };
    const me = s.players.find((p) => p.id === meId) || { id: meId, name: 'Вы' };
    const oppMark = t.myMark === 'x' ? 'o' : 'x';
    const wins = (id) => (t.score.find(([u]) => u === id) || [0, 0])[1];
    const playing = s.phase === 't_play';
    const bar = (p, mark, mine) => [
      avatar(p, { off: !p.active && !mine }),
      h('div.ck-who', null,
        h('div.ck-name', null, mine ? 'Вы' : p.name),
        h('div.ck-sub', null, h('span.tt-badge.' + mark, null, mark === 'x' ? '✕' : '◯'), mark === 'x' ? 'крестики' : 'нолики', ` · побед: ${wins(p.id)}`),
      ),
      playing && t.turn === mark ? h('div.ck-turn', null, mine ? 'Ваш ход' : 'думает…') : null,
    ].filter(Boolean);
    this.topBar.replaceChildren(...bar(opp, oppMark, false));
    this.bottomBar.replaceChildren(...bar(me, t.myMark, true));
    this.topBar.classList.toggle('active', playing && t.turn === oppMark);
    this.bottomBar.classList.toggle('active', playing && t.turn === t.myMark);
    this.title.replaceChildren(
      h('div.round', null, t.size === 3 ? 'Крестики-нолики' : `Поле ${t.size}×${t.size} · ${t.need} в ряд`),
      h('div.word-show', null, !playing ? 'Партия окончена' : t.turn === t.myMark ? 'Ваш ход' : 'Ход соперника'),
    );
  }

  renderControls(s) {
    const key = JSON.stringify([s.phase, s.hostId]);
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    let part;
    if (s.phase === 't_play') {
      part = h('button.btn.ghost.small', { onclick: async () => { if (await confirm('Сдаться и закончить партию?')) this.actions.ttt('resign'); } }, '🏳️ Сдаться');
    } else if (s.hostId === s.me) {
      part = h('div.row', null,
        h('button.btn.mint', { onclick: (e) => { e.currentTarget.disabled = true; haptic.tap(); this.actions.start(); } }, svg(icons.replay), 'Реванш'),
        h('button.btn.ghost', { style: { width: 'auto' }, onclick: () => { haptic.tap(); this.actions.toLobby(); } }, 'В лобби'));
    } else {
      part = h('div.waiting-pill', null, 'Ждём, пока хозяин начнёт', h('span.dots', null, h('span'), h('span'), h('span')));
    }
    this.controls.replaceChildren(part);
  }

  renderOverlay(s, t) {
    const key = s.phase === 'final' ? 'final' : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (!key) return;
    const draw = t.winner === 'draw';
    const won = t.winner === t.myMark;
    haptic[won ? 'ok' : draw ? 'soft' : 'warn']();
    const score = t.score.map(([u, n]) => `${u === s.me ? 'Вы' : (s.players.find((p) => p.id === u) || {}).name || 'Соперник'} ${n}`).join(' : ');
    // Даём увидеть выигрышную линию.
    setTimeout(() => {
      if (this.overlayKey !== 'final') return;
      this.overlay = h('div.overlay', { onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.remove(); } },
        h('div', { style: { fontSize: '60px' } }, draw ? '🤝' : won ? '🏆' : '😔'),
        h('div.hand', { style: { fontSize: '50px', lineHeight: 1, marginTop: '6px' } }, draw ? 'Ничья' : won ? 'Победа!' : 'Поражение'),
        h('div.muted', { style: { marginTop: '10px', fontWeight: 800 } }, t.reason || ''),
        h('div.tt-score', null, 'Счёт серии: ', h('b', null, score)),
        h('button.btn.ghost', { style: { maxWidth: '300px', marginTop: '22px' }, onclick: (e) => e.currentTarget.closest('.overlay').remove() }, 'Посмотреть поле'),
      );
      this.el.append(this.overlay);
    }, t.line ? 900 : 200);
  }
}

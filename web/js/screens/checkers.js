// Экран шашек. Доска рисуется со стороны игрока (чёрные видят доску
// перевёрнутой). Допустимые ходы присылает сервер: игрок выбирает шашку,
// затем поля по одному — при серии взятий путь собирается по шагам, пока
// не совпадёт с одним из допустимых ходов.

import { h, svg, icon, icons, avatar, toast } from '../ui.js';
import { haptic, confirm } from '../tg.js';
import { voiceButton } from './lobby.js';

const STEP_MS = 190;
const CROWN = '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor"/></svg>';

export class CheckersScreen {
  constructor({ room, actions, voice }) {
    this.room = room;
    this.actions = actions;
    this.voice = voice;
    this.prefix = [];
    this.shown = null; // доска, которая сейчас нарисована
    this.lastKey = '';
    this.animating = false;
    this.overlayKey = '';

    this.squares = [];
    this.boardEl = h('div.ck-board');
    for (let d = 0; d < 64; d++) {
      const r = d >> 3, c = d & 7;
      const sq = h('div.ck-sq' + ((r + c) % 2 ? '.dark' : ''), { onclick: () => this.tap(this.idx(d)) });
      this.squares.push(sq);
      this.boardEl.append(sq);
    }
    this.layer = h('div.ck-layer');
    this.boardEl.append(this.layer);

    this.topBar = h('div.ck-player');
    this.bottomBar = h('div.ck-player.me');
    this.hint = h('div.ck-hint');
    this.controls = h('div.ck-controls');
    this.title = h('div.word-area');

    this.el = h('div.screen.fixed.game.checkers', null,
      h('div.hud', null,
        h('div', { style: { width: '50px' } }),
        this.title,
        h('div.hud-btns', null, voiceButton(voice), h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('close'))),
      ),
      this.topBar,
      h('div.ck-wrap', null, this.boardEl),
      this.bottomBar,
      this.hint,
      this.controls,
    );
    this.ro = new ResizeObserver(() => this.fit());
    this.wrap = this.el.querySelector('.ck-wrap');
    this.ro.observe(this.wrap);
  }

  destroy() { this.ro.disconnect(); }

  fit() {
    const r = this.wrap.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width, r.height));
    if (size > 40) this.boardEl.style.width = this.boardEl.style.height = size + 'px';
  }

  get s() { return this.room.state; }
  get c() { return this.s.checkers; }
  get flip() { return this.c && this.c.myColor === 'b'; }
  // Поле на экране ↔ поле доски.
  idx(d) { return this.flip ? 63 - d : d; }
  disp(i) { return this.flip ? 63 - i : i; }

  update(s) {
    const c = s.checkers;
    if (!c) return;
    const key = JSON.stringify([c.board, c.last]);
    if (key !== this.lastKey) {
      const prev = this.shown;
      this.lastKey = key;
      this.prefix = [];
      // Свой ход уже показан при выборе полей — анимируем только ход соперника.
      if (prev && c.last && prev !== c.board && c.last.color !== c.myColor) this.animate(prev, c.board, c.last);
      else this.drawPieces(c.board);
      if (prev && c.last && c.last.color !== c.myColor) haptic.soft();
    }
    this.renderBars(s, c);
    this.renderMarks();
    this.renderControls(s, c);
    this.renderOverlay(s, c);
  }

  absorb(ops, msgs) {
    for (const m of msgs) if (m.kind === 'm' && /ничью|Ничья отклонена/.test(m.body)) toast(m.body, 'warn', 3000);
  }

  // ─── Доска ───────────────────────────────────────────────────────────────

  pieceEl(ch, i) {
    const el = h('div.ck-piece.' + (ch.toLowerCase() === 'w' ? 'w' : 'b') + (ch === 'W' || ch === 'B' ? '.king' : ''));
    if (ch === 'W' || ch === 'B') el.append(svg(CROWN));
    this.place(el, i);
    el.dataset.i = i;
    return el;
  }

  place(el, i) {
    const d = this.disp(i);
    el.style.transform = `translate(${(d & 7) * 100}%, ${(d >> 3) * 100}%)`;
  }

  drawPieces(board) {
    this.shown = board;
    this.layer.replaceChildren(...[...board].map((ch, i) => (ch === '.' ? null : this.pieceEl(ch, i))).filter(Boolean));
  }

  // Ход двигается по шагам пути, сбитые шашки исчезают.
  animate(prev, next, last) {
    this.drawPieces(prev);
    this.animating = true;
    this.animEnd = next;
    const token = (this.animToken = (this.animToken || 0) + 1);
    const mover = this.layer.querySelector(`[data-i="${last.path[0]}"]`);
    let step = 1;
    const go = () => {
      if (token !== this.animToken) return;
      if (step >= last.path.length || !mover) {
        setTimeout(() => { if (token === this.animToken) this.finishAnimation(); }, 120);
        return;
      }
      this.place(mover, last.path[step]);
      const cap = last.caps[step - 1];
      const capEl = cap != null && this.layer.querySelector(`[data-i="${cap}"]`);
      if (capEl) setTimeout(() => capEl.classList.add('gone'), STEP_MS * 0.6);
      if (last.caps.length) haptic.tick();
      step++;
      setTimeout(go, STEP_MS);
    };
    requestAnimationFrame(go);
  }

  // Сразу показать итог хода (по окончании анимации или если игрок уже нажимает на доску).
  finishAnimation() {
    if (!this.animating) return;
    this.animToken++;
    this.animating = false;
    this.drawPieces(this.animEnd);
    this.renderMarks();
  }

  movesFromPrefix() {
    const moves = this.c.moves || [];
    const p = this.prefix;
    return moves.filter((m) => p.every((x, k) => m[k] === x));
  }

  renderMarks() {
    const c = this.c;
    this.renderHint();
    const moves = c.moves || [];
    const starts = new Set(moves.map((m) => m[0]));
    const next = new Set(this.prefix.length ? this.movesFromPrefix().map((m) => m[this.prefix.length]).filter((x) => x != null) : []);
    const lastSq = new Set(c.last ? c.last.path : []);
    for (let d = 0; d < 64; d++) {
      const i = this.idx(d);
      const sq = this.squares[d];
      sq.classList.toggle('last', lastSq.has(i));
      sq.classList.toggle('dest', next.has(i));
      sq.classList.toggle('can', !this.prefix.length && starts.has(i));
      sq.classList.toggle('sel', this.prefix.includes(i));
    }
    for (const el of this.layer.children) {
      el.classList.toggle('can', !this.animating && !this.prefix.length && starts.has(Number(el.dataset.i)) && !!c.mustCapture);
    }
  }

  tap(i) {
    const c = this.c;
    if (!c || !c.moves) return;
    this.finishAnimation();
    const own = c.board[i] !== '.' && c.board[i].toLowerCase() === c.myColor;
    if (own && c.moves.some((m) => m[0] === i) && (this.prefix.length <= 1)) {
      this.prefix = [i];
      haptic.tick();
      return this.renderMarks();
    }
    if (!this.prefix.length) {
      if (own) { haptic.warn(); toast(c.mustCapture ? 'Бить обязательно — выберите шашку, которая может бить' : 'Этой шашкой сейчас не сходить', 'warn', 1800); }
      return;
    }
    const cand = this.movesFromPrefix().filter((m) => m[this.prefix.length] === i);
    if (!cand.length) {
      if (this.prefix.length > 1) this.drawPieces(this.shown);
      this.prefix = [];
      return this.renderMarks();
    }
    this.prefix.push(i);
    haptic.tick();
    // Двигаем выбранную шашку по уже выбранным шагам.
    const piece = this.layer.querySelector(`[data-i="${this.prefix[0]}"]`);
    if (piece) this.place(piece, i);
    const done = cand.find((m) => m.length === this.prefix.length);
    if (done) {
      const path = this.prefix.slice();
      this.prefix = [];
      this.renderMarks();
      this.actions.checkers('move', path).then((res) => { if (!res) this.drawPieces(this.c.board); });
    } else this.renderMarks();
  }

  // ─── Панели ──────────────────────────────────────────────────────────────

  renderBars(s, c) {
    const meId = s.me;
    const oppId = c.white === meId ? c.black : c.white;
    const opp = s.players.find((p) => p.id === oppId) || { id: oppId, name: 'Соперник' };
    const me = s.players.find((p) => p.id === meId) || { id: meId, name: 'Вы' };
    const oppColor = c.myColor === 'w' ? 'b' : 'w';
    const playing = s.phase === 'c_play';
    const bar = (p, color, mine) => [
      avatar(p, { off: !p.active && !mine }),
      h('div.ck-who', null,
        h('div.ck-name', null, mine ? 'Вы' : p.name),
        h('div.ck-sub', null, h('i.ck-dot.' + color), color === 'w' ? 'белые' : 'чёрные', ` · ${c.left[color]} ${c.left[color] === 1 ? 'шашка' : c.left[color] < 5 ? 'шашки' : 'шашек'}`),
      ),
      playing && c.turn === color && h('div.ck-turn', null, mine ? 'Ваш ход' : 'думает…'),
    ];
    this.topBar.replaceChildren(...bar(opp, oppColor, false).filter(Boolean));
    this.bottomBar.replaceChildren(...bar(me, c.myColor, true).filter(Boolean));
    this.topBar.classList.toggle('active', playing && c.turn === oppColor);
    this.bottomBar.classList.toggle('active', playing && c.turn === c.myColor);
    this.title.replaceChildren(
      h('div.round', null, 'Шашки'),
      h('div.word-show', null, !playing ? 'Партия окончена' : c.turn === c.myColor ? 'Ваш ход' : 'Ход соперника'),
    );
    this.renderHint();
  }

  renderHint() {
    const c = this.c;
    const mine = this.s.phase === 'c_play' && c.turn === c.myColor;
    const hint = !mine ? '' : this.prefix.length > 1 ? 'Бейте дальше!' : this.prefix.length ? 'Куда пойти?' : c.mustCapture ? 'Бить обязательно!' : 'Выберите шашку';
    this.hint.textContent = hint;
    this.hint.classList.toggle('warn', mine && !!c.mustCapture && this.prefix.length !== 1);
    this.hint.style.visibility = hint ? '' : 'hidden';
  }

  renderControls(s, c) {
    const key = JSON.stringify([s.phase, c.drawOffer, s.hostId]);
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    const parts = [];
    if (s.phase === 'c_play') {
      if (c.drawOffer && c.drawOffer !== s.me) {
        parts.push(h('div.ck-offer', null,
          h('div', null, 'Соперник предлагает ничью'),
          h('div.row', null,
            h('button.btn.mint.small', { onclick: () => { haptic.tap(); this.actions.checkers('accept'); } }, 'Согласиться'),
            h('button.btn.ghost.small', { onclick: () => { haptic.tap(); this.actions.checkers('decline'); } }, 'Играть дальше'))));
      } else {
        parts.push(h('div.row', null,
          h('button.btn.ghost.small', { disabled: !!c.drawOffer, onclick: () => { haptic.tap(); this.actions.checkers('draw'); } }, c.drawOffer ? 'Ничья предложена' : '🤝 Ничья'),
          h('button.btn.ghost.small', { onclick: async () => { if (await confirm('Сдаться и закончить партию?')) this.actions.checkers('resign'); } }, '🏳️ Сдаться')));
      }
    } else if (s.hostId === s.me) {
      parts.push(h('div.row', null,
        h('button.btn.mint', { onclick: (e) => { e.currentTarget.disabled = true; haptic.tap(); this.actions.start(); } }, svg(icons.replay), 'Реванш'),
        h('button.btn.ghost', { style: { width: 'auto' }, onclick: () => { haptic.tap(); this.actions.toLobby(); } }, 'В лобби')));
    } else {
      parts.push(h('div.waiting-pill', null, 'Ждём, пока хозяин начнёт', h('span.dots', null, h('span'), h('span'), h('span'))));
    }
    this.controls.replaceChildren(...parts);
  }

  renderOverlay(s, c) {
    const key = s.phase === 'final' ? 'final' : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (!key) return;
    const won = c.winner === c.myColor;
    const draw = c.winner === 'draw';
    haptic[won ? 'ok' : draw ? 'soft' : 'warn']();
    const show = () => {
      this.overlay = h('div.overlay', { onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.remove(); } },
        h('div', { style: { fontSize: '60px' } }, draw ? '🤝' : won ? '🏆' : '😔'),
        h('div.hand', { style: { fontSize: '50px', lineHeight: 1, marginTop: '6px' } }, draw ? 'Ничья' : won ? 'Победа!' : 'Поражение'),
        h('div.muted', { style: { marginTop: '10px', fontWeight: 800, maxWidth: '280px' } }, c.reason || ''),
        h('button.btn.ghost', { style: { maxWidth: '300px', marginTop: '26px' }, onclick: (e) => e.currentTarget.closest('.overlay').remove() }, 'Посмотреть доску'),
      );
      this.el.append(this.overlay);
    };
    // Даём доиграть анимацию последнего хода.
    setTimeout(show, this.animating ? 900 : 0);
  }
}

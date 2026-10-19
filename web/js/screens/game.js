// Игровой экран одного хода: выбор слова → рисование → ответ.
// Экран создаётся заново на каждый ход (roundNo), холст живёт весь ход.

import { h, svg, icon, icons, avatar, toast, shake, plural } from '../ui.js';
import { Board, Pen, Replay, COLORS, ERASER, SIZES } from '../draw.js';
import { haptic, confirm } from '../tg.js';
import { voiceButton } from './lobby.js';

const LEVELS = ['Легко', 'Средне', 'Сложно'];
const isLetter = (ch) => /[a-zа-яё0-9]/i.test(ch);

export class GameScreen {
  constructor({ room, actions, serverNow, voice }) {
    this.voice = voice;
    this.room = room;
    this.actions = actions;
    this.serverNow = serverNow;
    this.roundNo = room.state.roundNo;
    this.scores = new Map();
    this.overlayKey = '';
    this.hudKey = '';
    this.mode = null;
    this.lastSec = null;

    this.timer = h('div.timer', null,
      svg('<svg viewBox="0 0 50 50"><circle class="bg" cx="25" cy="25" r="21"/><circle class="fg" cx="25" cy="25" r="21" stroke-dasharray="132" stroke-dashoffset="0"/></svg>'),
      h('div.num'));
    this.wordArea = h('div.word-area');
    this.strip = h('div.strip');
    this.boardEl = h('div.board');
    this.emptyHint = h('div.empty-hint');
    this.floatFeed = h('div.float-feed');
    this.boardEl.append(this.emptyHint, this.floatFeed);
    this.board = new Board(this.boardEl);
    this.boardEl.insertBefore(this.board.canvas, this.emptyHint);
    this.board.onChange = () => { this.emptyHint.style.opacity = this.board.empty ? '1' : '0'; };
    this.replay = new Replay(this.board);
    this.wrap = h('div.board-wrap', null, this.boardEl);
    this.bottom = h('div.bottom');
    this.overlay = null;

    this.el = h('div.screen.fixed.game', null,
      h('div.hud', null,
        this.timer,
        this.wordArea,
        h('div.hud-btns', null,
          voiceButton(this.voice),
          h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('close'))),
      ),
      this.strip,
      this.wrap,
      this.bottom,
    );

    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.wrap);
    this.tickId = setInterval(() => this.tick(), 200);
  }

  destroy() {
    clearInterval(this.tickId);
    this.ro.disconnect();
    this.replay.stop();
  }

  fit() {
    const r = this.wrap.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width, r.height));
    if (size > 40 && size !== this.board.cssSize) this.board.resize(size);
  }

  get s() { return this.room.state; }
  get isDrawer() { return this.s.drawerId === this.s.me; }

  // ─── Обновление по состоянию ─────────────────────────────────────────────

  update(s) {
    if (!this.mode) this.buildBottom();
    this.renderHud(s);
    this.renderStrip(s);
    this.renderOverlay(s);
    if (this.pen) this.pen.enabled = s.phase === 'draw';
    if (this.guessUi) this.renderGuess(s);
    if (s.phase === 'reveal') this.replay.flush();
    this.emptyHint.textContent = s.phase === 'draw' && this.isDrawer ? 'Рисуйте здесь' : s.phase === 'draw' ? 'Сейчас начнут рисовать…' : '';
    this.tick();
  }

  absorb(ops, msgs) {
    if (ops.length) {
      if (this.isDrawer) {
        // Своё художник видит сразу; с сервера берём только восстановление
        // рисунка после перезапуска приложения.
        if (!this.pen || !this.pen.drewSomething) for (const op of ops) this.board.apply(op);
      } else if (this.s.phase === 'reveal') {
        for (const op of ops) this.board.apply(op);
      } else this.replay.push(ops);
    }
    for (const m of msgs) this.addMessage(m, true);
  }

  renderHud(s) {
    const me = s.players.find((p) => p.id === s.me);
    const key = JSON.stringify([s.phase, s.word, s.mask, me && me.guessed]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    const round = h('div.round', null, `Ход ${Math.min(s.turn + 1, s.turnTotal)} из ${s.turnTotal}`);
    let body;
    if (s.phase === 'pick') body = h('div.word-show.draw-label', null, 'Выбор слова…');
    else if (s.phase === 'reveal') body = h('div.word-show', null, (s.result && s.result.word) || '');
    else if (this.isDrawer) body = h('div.word-show.draw-label', null, 'Рисуйте', h('b', null, s.word));
    else if (s.word) body = h('div.word-show', { style: { color: 'var(--mint-d)' } }, s.word);
    else body = this.maskEl(s.mask || '');
    this.wordArea.replaceChildren(round, body);
  }

  maskEl(mask) {
    const letters = [...mask].filter((ch) => ch === '_' || isLetter(ch)).length;
    return h('div.mask' + (letters > 11 ? '.tight' : ''), null,
      [...mask].map((ch) => ch === ' ' ? h('div.gap') : ch === '_' ? h('div.ch') : !isLetter(ch) ? h('div.ch.dash', null, ch) : h('div.ch.open', null, ch)),
      h('span.mask-len', null, `${letters} ${plural(letters, 'буква', 'буквы', 'букв')}`));
  }

  renderStrip(s) {
    this.strip.replaceChildren(...s.players.map((p) => {
      const prev = this.scores.get(p.id);
      this.scores.set(p.id, p.score);
      const drawing = p.id === s.drawerId;
      const badge = drawing ? icons.pencil : p.guessed && s.phase === 'draw' ? icons.check : null;
      const chip = h('div.pchip' + (drawing ? '.drawing' : p.guessed && s.phase === 'draw' ? '.guessed' : ''), null,
        avatar(p, { badge, off: !p.active }),
        h('div.t', null, h('div.n', null, p.id === s.me ? 'Вы' : p.name), h('div.s', null, String(p.score))),
      );
      if (prev != null && p.score > prev) chip.classList.add('bump');
      return chip;
    }));
  }

  // ─── Таймер ──────────────────────────────────────────────────────────────

  tick() {
    const s = this.s;
    if (!s || !s.deadline) return;
    const total = Math.max(1, s.deadline - s.phaseStart);
    const left = Math.max(0, s.deadline - this.serverNow());
    const sec = Math.ceil(left / 1000);
    const frac = left / total;
    this.timer.querySelector('.fg').setAttribute('stroke-dashoffset', String(132 * (1 - frac)));
    this.timer.querySelector('.num').textContent = String(sec);
    this.timer.classList.toggle('warn', s.phase === 'draw' && frac < 0.5 && sec > 10);
    this.timer.classList.toggle('hot', s.phase === 'draw' && sec <= 10);
    if (sec !== this.lastSec) {
      if (s.phase === 'draw' && sec <= 5 && sec > 0) haptic.tick();
      this.lastSec = sec;
    }
  }

  // ─── Нижняя панель ───────────────────────────────────────────────────────

  buildBottom() {
    this.mode = this.isDrawer ? 'draw' : 'guess';
    if (this.isDrawer) {
      this.pen = new Pen(this.board);
      this.bottom.replaceChildren(this.toolsEl());
    } else {
      this.feedEl = h('div.feed');
      this.input = h('input', { placeholder: 'Ваша догадка…', maxlength: '40', enterkeyhint: 'send', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
      this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendGuess(); } });
      this.sendBtn = h('button.btn.violet', { onclick: () => this.sendGuess(), 'aria-label': 'Отправить' }, icon('send'));
      this.guessBar = h('div.guess-bar', null, this.input, this.sendBtn);
      this.guessDone = h('div.guess-done', null, svg(icons.check), 'Угадали! Ждём остальных');
      this.guessUi = h('div.guess-ui');
      this.bottom.replaceChildren(h('div.col', { style: { gap: '8px' } }, this.feedEl, this.guessUi));
      for (const m of this.room.messages) this.addMessage(m, false);
    }
  }

  toolsEl() {
    const pen = this.pen;
    const swatches = COLORS.slice(0, ERASER).map((c, i) => h('button.swatch', { style: { '--sw': c }, 'aria-label': 'Цвет', onclick: () => {
      haptic.tick(); pen.color = i; pen.eraser = false; sync();
    } }));
    const sizes = SIZES.map((w, i) => h('button', { 'aria-label': 'Толщина', onclick: () => { haptic.tick(); pen.size = i; sync(); } },
      h('i', { style: { width: 6 + i * 6 + 'px', height: 6 + i * 6 + 'px' } })));
    const eraser = h('button.icon-btn', { 'aria-label': 'Ластик', onclick: () => { haptic.tick(); pen.eraser = !pen.eraser; sync(); } }, icon('eraser'));
    const undo = h('button.icon-btn', { 'aria-label': 'Отменить', onclick: () => { if (pen.undo()) haptic.tap(); } }, icon('undo'));
    const clear = h('button.icon-btn', { 'aria-label': 'Очистить', onclick: async () => {
      if (this.board.empty) return;
      if (await confirm('Стереть весь рисунок?')) { pen.clear(); haptic.warn(); }
    } }, icon('trash'));
    const sync = () => {
      swatches.forEach((el, i) => el.classList.toggle('on', !pen.eraser && i === pen.color));
      sizes.forEach((el, i) => el.classList.toggle('on', i === pen.size));
      sizes.forEach((el) => { el.querySelector('i').style.background = pen.eraser ? 'var(--ink-3)' : COLORS[pen.color]; });
      eraser.classList.toggle('on', pen.eraser);
    };
    sync();
    return h('div.tools', null,
      h('div.palette', null, swatches),
      h('div.toolrow', null, h('div.sizes', null, sizes), eraser, h('div.grow'), undo, clear),
    );
  }

  renderGuess(s) {
    const me = s.players.find((p) => p.id === s.me);
    const done = me && me.guessed && s.phase === 'draw';
    const want = done ? this.guessDone : this.guessBar;
    if (this.guessUi.firstChild !== want) this.guessUi.replaceChildren(want);
    const open = s.phase === 'draw';
    this.input.disabled = !open;
    this.sendBtn.disabled = !open;
    this.input.placeholder = open ? 'Ваша догадка…' : s.phase === 'pick' ? 'Ждём слово…' : 'Ход закончился';
  }

  async sendGuess() {
    const text = this.input.value.trim();
    if (!text || this.input.disabled) return;
    this.input.value = '';
    haptic.tap();
    const res = await this.actions.guess(text);
    if (!res || !res.verdict) return;
    const v = res.verdict;
    if (v.result === 'correct') {
      haptic.ok();
      toast(`В точку! +${v.points}`, 'ok');
      this.input.blur();
    } else if (v.result === 'close') {
      haptic.warn();
      toast('Почти! Попробуйте ещё', 'warn', 1800);
      shake(this.guessBar);
      this.input.value = text;
      this.input.select();
    }
  }

  // ─── Лента ───────────────────────────────────────────────────────────────

  addMessage(m, live) {
    const line = formatMessage(m, this.s);
    if (!line) return;
    if (this.feedEl) {
      this.feedEl.append(line);
      while (this.feedEl.children.length > 60) this.feedEl.firstChild.remove();
      this.feedEl.scrollTop = this.feedEl.scrollHeight;
    }
    if (live && this.isDrawer && (m.kind === 'guess' || m.kind === 'correct')) {
      const fm = h('div.fm' + (m.kind === 'correct' ? '.ok' : ''), null, line.textContent);
      this.floatFeed.append(fm);
      while (this.floatFeed.children.length > 3) this.floatFeed.firstChild.remove();
      setTimeout(() => fm.remove(), 4100);
      if (m.kind === 'correct') haptic.ok();
    }
    if (live && !this.isDrawer && m.kind === 'correct' && m.userId !== this.s.me) haptic.soft();
  }

  // ─── Оверлеи фаз ─────────────────────────────────────────────────────────

  renderOverlay(s) {
    const key = s.phase + ':' + (s.phase === 'pick' ? JSON.stringify(s.choices || null) + s.drawerId : '');
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    let ov = null;
    if (s.phase === 'pick') ov = this.isDrawer ? this.pickOverlay(s) : this.waitOverlay(s);
    else if (s.phase === 'reveal') ov = this.revealOverlay(s);
    else if (s.phase === 'draw') haptic.soft();
    if (ov) { this.overlay = ov; this.el.append(ov); }
  }

  pickOverlay(s) {
    let chosen = false;
    const cards = (s.choices || []).map((c, i) => h('button.choice', { onclick: (e) => {
      if (chosen) return;
      chosen = true;
      haptic.ok();
      e.currentTarget.style.boxShadow = 'inset 0 0 0 3px var(--c), 0 1px 0 var(--line-2)';
      this.actions.pick(i);
    } },
      h('div', null, h('div.w', null, c.word), h('div.lv', null, LEVELS[c.diff])),
      h('div.pts', null, '×' + String(c.mult).replace('.', ',')),
    ));
    haptic.warn();
    return h('div.overlay', null,
      h('div.hand', { style: { fontSize: '46px', lineHeight: '1', transform: 'rotate(-3deg)' } }, 'Ваша очередь!'),
      h('div.muted', { style: { marginTop: '8px', fontWeight: 800 } }, 'Выберите, что будете рисовать'),
      h('div.choices', null, cards),
      h('div.faint.small', { style: { marginTop: '16px' } }, 'Не успеете — слово выберется само'),
    );
  }

  waitOverlay(s) {
    const d = s.players.find((p) => p.id === s.drawerId) || { id: 0, name: '…' };
    return h('div.overlay', null,
      h('div.big-ava', null, avatar(d, { badge: h('span.pencil-bob', null, svg(icons.pencil)) })),
      h('div.h1', { style: { marginTop: '18px' } }, d.name),
      h('div.muted', { style: { marginTop: '6px', fontWeight: 800 } }, 'выбирает слово ', h('span.dots', null, h('span'), h('span'), h('span'))),
      h('div.faint.small', { style: { marginTop: '22px', maxWidth: '260px' } }, 'Угадывайте быстрее всех — за скорость больше очков'),
    );
  }

  revealOverlay(s) {
    const r = s.result || { word: '', gains: [] };
    const nobody = !r.gains.some((g) => g.guessed);
    const rows = s.players
      .map((p) => ({ p, g: r.gains.find((x) => x.userId === p.id) || { gained: 0 } }))
      .sort((a, b) => b.g.gained - a.g.gained)
      .map(({ p, g }) => h('div.gain', null,
        avatar(p, { badge: p.id === r.drawerId ? icons.pencil : g.guessed ? icons.check : null }),
        h('div.nm', null, p.id === s.me ? 'Вы' : p.name),
        h('div.plus' + (g.gained ? '' : '.zero'), null, g.gained ? '+' + g.gained : '0'),
      ));
    const last = s.turn + 1 >= s.turnTotal;
    const bar = h('i');
    const left = Math.max(0, s.deadline - this.serverNow());
    requestAnimationFrame(() => {
      bar.style.transition = 'none';
      bar.style.transform = `scaleX(${left / Math.max(1, s.deadline - s.phaseStart)})`;
      requestAnimationFrame(() => { bar.style.transition = `transform ${left}ms linear`; bar.style.transform = 'scaleX(0)'; });
    });
    const myGain = r.gains.find((g) => g.userId === s.me);
    if (myGain && myGain.gained) haptic.ok();
    return h('div.overlay', null,
      h('div.muted', { style: { fontWeight: 800 } }, nobody ? 'Никто не угадал. Это было' : 'Загаданное слово'),
      h('div.reveal-word', null, r.word),
      h('div.gains', null, rows),
      h('div.progress', null, bar),
      h('div.faint.small', { style: { marginTop: '10px', fontWeight: 800 } }, last ? 'Сейчас — итоги!' : 'Следующий ход через пару секунд'),
    );
  }
}

function formatMessage(m, s) {
  const who = (id, name) => (id === s.me ? 'Вы' : name);
  switch (m.kind) {
    case 'guess': return h('div.m', null, h('b', null, who(m.userId, m.name) + ': '), m.body);
    case 'close': return h('div.m.close', null, `«${m.body}» — почти!`);
    case 'correct': return h('div.m.ok', null, `${who(m.userId, m.name)} — в точку! +${m.body}`);
    case 'turn': return h('div.m.sys', null, m.userId === s.me ? 'Вы рисуете' : `Рисует ${m.name}`);
    case 'word': return h('div.m.sys', null, `Слово было: ${m.body}`);
    case 'join': return h('div.m.sys', null, `${who(m.userId, m.name)} в комнате`);
    case 'away': return h('div.m.sys', null, `${m.name} не в сети`);
    case 'back': return h('div.m.sys', null, `${m.name} снова в сети`);
    case 'left': return h('div.m.sys', null, `${m.name} покидает комнату`);
    default: return null;
  }
}

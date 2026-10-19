// «Кто я?». Над каждым соперником — стикер с его персонажем, над вами — «?».
// В свой ход задаёте вопрос (текстом или голосом) или пытаетесь угадать;
// в чужой — отвечаете «Да / Нет / Не знаю».

import { h, svg, icon, icons, avatar, toast, sheet } from '../ui.js';
import { haptic, confirm } from '../tg.js';
import { voiceButton } from './lobby.js';

const YES = 1, NO = 2, DUNNO = 3;
const ANSWER_LABEL = { [YES]: '👍 Да', [NO]: '👎 Нет', [DUNNO]: '🤷 Не знаю' };

export class WhoScreen {
  constructor({ room, actions, serverNow, voice }) {
    this.room = room;
    this.actions = actions;
    this.serverNow = serverNow;
    this.key = '';
    this.overlayKey = '';
    this.lastSec = null;

    this.timer = h('div.timer', null,
      svg('<svg viewBox="0 0 50 50"><circle class="bg" cx="25" cy="25" r="21"/><circle class="fg" cx="25" cy="25" r="21" stroke-dasharray="132" stroke-dashoffset="0"/></svg>'),
      h('div.num'));
    this.title = h('div.word-area');
    this.meCard = h('div.wh-me');
    this.grid = h('div.wh-grid');
    this.qCard = h('div.wh-q');
    this.feedEl = h('div.feed.m-feed');
    this.bottom = h('div.m-bottom');

    this.input = h('input', { placeholder: 'Например: «Я человек?»', maxlength: '120', enterkeyhint: 'send', autocomplete: 'off' });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.ask(); } });

    this.el = h('div.screen.fixed.game.who', null,
      h('div.hud', null,
        this.timer,
        this.title,
        h('div.hud-btns', null, voiceButton(voice), h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('close'))),
      ),
      h('div.m-scroll', null, this.meCard, this.grid, this.qCard, this.feedEl),
      this.bottom,
    );
    for (const m of room.messages) this.addMessage(m);
    this.tickId = setInterval(() => this.tick(), 250);
  }

  destroy() { clearInterval(this.tickId); }

  get s() { return this.room.state; }

  update(s) {
    if (!s.who) return;
    // Сервер присылает словари с id игроков списками пар — собираем копию с объектами.
    const w = { ...s.who, chars: Object.fromEntries(s.who.chars || []), answers: Object.fromEntries(s.who.answers || []) };
    const key = JSON.stringify([s.phase, s.version, w.answers, s.players.map((p) => [p.id, p.active, p.voice])]);
    if (key !== this.key) {
      const turnChanged = this.prevAsker !== undefined && this.prevAsker !== w.asker;
      if (turnChanged && w.asker === s.me && s.phase === 'w_play') { haptic.ok(); toast('Ваш ход — задайте вопрос!', 'ok', 2000); }
      if (w.q && this.prevQ !== w.q.id && w.asker !== s.me) haptic.soft();
      this.prevAsker = w.asker;
      this.prevQ = w.q && w.q.id;
      this.key = key;
      this.render(s, w);
    }
    this.renderOverlay(s, w);
    this.tick();
  }

  absorb(ops, msgs) { for (const m of msgs) this.addMessage(m); }

  // ─── Вид ─────────────────────────────────────────────────────────────────

  render(s, w) {
    const me = s.me;
    const asker = s.players.find((p) => p.id === w.asker) || { name: '…' };
    const myTurn = w.asker === me && s.phase === 'w_play';
    const doneMe = w.done.find((d) => d.id === me);

    this.title.replaceChildren(
      h('div.round', null, w.deckName),
      h('div.word-show', null, s.phase === 'final' ? 'Игра окончена' : myTurn ? 'Ваш ход' : `Ход: ${asker.name}`),
    );

    const myChar = w.chars[me];
    this.meCard.replaceChildren(
      h('div.wh-sticker.me' + (myChar ? '.known' : ''), null, myChar || '?'),
      h('div.wh-me-text', null,
        h('div.h2', null, 'Ваш персонаж'),
        h('div.faint.small', null, myChar
          ? doneMe && doneMe.ok ? `Угадали — ${doneMe.place}-е место 🎉` : 'Вот кто это был'
          : 'Все видят его, кроме вас. Спрашивайте «да или нет».'),
      ),
    );

    this.grid.replaceChildren(...w.order.filter((id) => id !== me).map((id) => {
      const p = s.players.find((x) => x.id === id) || { id, name: 'Игрок' };
      const done = w.done.find((d) => d.id === id);
      const ans = w.answers && w.answers[id];
      return h('div.wh-p' + (id === w.asker ? '.asking' : '') + (done ? '.done' : ''), null,
        h('div.wh-sticker', null, w.chars[id] || '?'),
        avatar(p, { off: !p.active, badge: done ? (done.ok ? icons.check : h('span', null, '🏳')) : null }),
        h('div.wh-name', null, p.name),
        done && done.ok ? h('div.wh-tag', null, `${done.place}-е место`)
          : id === w.asker ? h('div.wh-tag.on', null, 'спрашивает')
          : ans ? h('div.wh-tag', null, ANSWER_LABEL[ans]) : null,
      );
    }));

    // Текущий вопрос.
    if (w.q && s.phase === 'w_play') {
      const answers = w.answers || {};
      const vals = Object.values(answers);
      const count = (v) => vals.filter((x) => x === v).length;
      const voters = w.order.filter((id) => id !== w.asker && (s.players.find((p) => p.id === id) || {}).active).length;
      const mine = answers[me];
      this.qCard.style.display = '';
      this.qCard.replaceChildren(
        h('div.wh-q-head', null, avatar(asker, { size: 30 }), h('b', null, w.asker === me ? 'Вы' : asker.name), ' спрашивает:'),
        h('div.wh-q-text', null, w.q.text),
        h('div.wh-tally', null,
          h('span', null, `👍 ${count(YES)}`), h('span', null, `👎 ${count(NO)}`), h('span', null, `🤷 ${count(DUNNO)}`),
          h('span.faint', null, `ответили ${vals.length}/${voters}`)),
        w.asker !== me && h('div.wh-answer', null, [YES, NO, DUNNO].map((v) => h('button.btn.small' + (mine === v ? (v === YES ? '.mint' : v === NO ? '' : '.sun') : '.ghost'), {
          onclick: () => { haptic.tap(); this.actions.who('answer', { value: v }); },
        }, ANSWER_LABEL[v]))),
      );
    } else this.qCard.style.display = 'none';

    // Управление своим ходом.
    const parts = [];
    if (myTurn && !w.q) {
      parts.push(h('div.guess-bar', null, this.input, h('button.btn.violet', { onclick: () => this.ask(), 'aria-label': 'Спросить' }, icon('send'))));
      parts.push(h('div.row', null,
        h('button.btn.ghost.small', { onclick: () => { haptic.tap(); this.actions.who('ask', { text: '' }); } }, '🎙 Спросил голосом'),
        h('button.btn.mint.small', { onclick: () => this.guessSheet() }, '💡 Я знаю!'),
        h('button.btn.ghost.small', { style: { width: 'auto', flex: 'none' }, onclick: async () => {
          if (await confirm('Сдаться и узнать своего персонажа?')) this.actions.who('giveup');
        } }, '🏳️')));
    } else if (myTurn && w.q) {
      parts.push(h('div.waiting-pill', null, 'Ждём ответов', h('span.dots', null, h('span'), h('span'), h('span'))));
    } else if (s.phase === 'final') {
      parts.push(s.hostId === me
        ? h('div.row', null,
            h('button.btn.mint', { onclick: (e) => { e.currentTarget.disabled = true; haptic.tap(); this.actions.start(); } }, svg(icons.replay), 'Ещё раз'),
            h('button.btn.ghost', { style: { width: 'auto' }, onclick: () => { haptic.tap(); this.actions.toLobby(); } }, 'В лобби'))
        : h('div.waiting-pill', null, 'Ждём, пока хозяин начнёт', h('span.dots', null, h('span'), h('span'), h('span'))));
    }
    this.bottom.replaceChildren(...parts);
  }

  ask() {
    const text = this.input.value.trim();
    if (!text) { toast('Напишите вопрос или нажмите «Спросил голосом»', 'warn', 1800); return; }
    this.input.value = '';
    haptic.tap();
    this.actions.who('ask', { text });
  }

  guessSheet() {
    haptic.tap();
    const input = h('input.wh-guess', { placeholder: 'Кто вы? Например: Чебурашка', maxlength: '60', autocomplete: 'off' });
    const go = () => {
      const text = input.value.trim();
      if (!text) return;
      sh.close();
      this.actions.who('guess', { text }).then((res) => {
        const d = res && res.state.who && res.state.who.done.find((x) => x.id === this.s.me);
        if (d && d.ok) { haptic.ok(); toast(`Верно! ${d.place}-е место 🎉`, 'ok'); } else { haptic.err(); toast('Не угадали — ход переходит', 'err'); }
      });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const sh = sheet(h('div.col', null,
      h('div.h1.center', null, 'Кто же вы?'),
      h('div.muted.center', null, 'Если ошибётесь, ход перейдёт к следующему'),
      input,
      h('button.btn.mint', { onclick: go }, 'Это я!'),
    ));
    setTimeout(() => input.focus(), 250);
  }

  addMessage(m) {
    if (m.id <= (this.seenMsg || 0)) return;
    this.seenMsg = m.id;
    const who = (id, name) => (id === this.s.me ? 'Вы' : name);
    let line = null;
    if (m.kind === 'm') line = h('div.m.narr', null, m.body);
    else if (m.kind === 'wq') line = h('div.m', null, h('b', null, who(m.userId, m.name) + ': '), m.body);
    else if (m.kind === 'join') line = h('div.m.sys', null, `${who(m.userId, m.name)} в комнате`);
    else if (m.kind === 'left') line = h('div.m.sys', null, `${m.name} покидает комнату`);
    if (!line) return;
    this.feedEl.append(line);
    while (this.feedEl.children.length > 80) this.feedEl.firstChild.remove();
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  tick() {
    const s = this.s;
    const has = s && s.deadline && s.phase === 'w_play';
    this.timer.style.visibility = has ? '' : 'hidden';
    if (!has) return;
    const total = Math.max(1, s.deadline - s.phaseStart);
    const left = Math.max(0, s.deadline - this.serverNow());
    const sec = Math.ceil(left / 1000);
    this.timer.querySelector('.fg').setAttribute('stroke-dashoffset', String(132 * (1 - left / total)));
    this.timer.querySelector('.num').textContent = String(sec);
    this.timer.classList.toggle('hot', sec <= 10);
    if (sec !== this.lastSec) {
      if (sec <= 5 && sec > 0 && s.who && s.who.asker === s.me) haptic.tick();
      this.lastSec = sec;
    }
  }

  renderOverlay(s, w) {
    const key = s.phase === 'final' ? 'final' : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (!key) return;
    const ranked = [...w.done.filter((d) => d.ok).sort((a, b) => a.place - b.place), ...w.done.filter((d) => !d.ok)];
    const mine = w.done.find((d) => d.id === s.me);
    haptic[mine && mine.ok && mine.place === 1 ? 'ok' : 'soft']();
    const rows = ranked.map((d) => {
      const p = s.players.find((x) => x.id === d.id) || { id: d.id, name: 'Игрок' };
      return h('div.gain', null,
        h('div.rc-place', null, d.ok ? String(d.place) : '—'),
        avatar(p),
        h('div.nm', null, d.id === s.me ? 'Вы' : p.name),
        h('span.wh-final-char', null, w.chars[d.id] || ''),
      );
    });
    this.overlay = h('div.overlay', { onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.remove(); } },
      h('div', { style: { fontSize: '58px' } }, mine && mine.ok && mine.place === 1 ? '🏆' : '🤔'),
      h('div.hand', { style: { fontSize: '46px', lineHeight: 1, marginTop: '4px' } }, mine && mine.ok ? `${mine.place}-е место!` : 'Игра окончена'),
      h('div.gains', null, rows),
      h('button.btn.ghost', { style: { maxWidth: '360px', marginTop: '18px' }, onclick: (e) => e.currentTarget.closest('.overlay').remove() }, 'Закрыть'),
    );
    this.el.append(this.overlay);
  }
}

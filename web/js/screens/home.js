// Главный экран: создать комнату, отсканировать QR или ввести код.

import { h, svg, icon, avatar, sheet, toast } from '../ui.js';
import { GAMES } from './lobby.js';
import { me, canScan, scanQr, parseCode, haptic, requestWriteAccess } from '../tg.js';
import { call } from '../api.js';

const HERO = `
<svg viewBox="0 0 320 236" class="doodle">
  <style>
    .hd { stroke-dasharray: 1; stroke-dashoffset: 1; animation: hero 7s infinite; }
    @keyframes hero { 0% { stroke-dashoffset: 1; } 10%, 82% { stroke-dashoffset: 0; } 92%, 100% { stroke-dashoffset: 1; opacity: 0; } }
  </style>
  <path class="hd" pathLength="1" style="animation-delay:0s"   stroke="#ffc23d" stroke-width="7" d="M250 52a22 22 0 1 1-.1 0z"/>
  <path class="hd" pathLength="1" style="animation-delay:.25s" stroke="#ffc23d" stroke-width="5" d="M250 18v-10M282 30l8-7M292 62h10M218 30l-8-7M210 62h-10"/>
  <path class="hd" pathLength="1" style="animation-delay:.6s"  stroke="#23203a" stroke-width="6" d="M70 200V128l58-48 58 48v72z"/>
  <path class="hd" pathLength="1" style="animation-delay:1.1s" stroke="#ff5d5d" stroke-width="7" d="M56 136l72-62 72 62"/>
  <path class="hd" pathLength="1" style="animation-delay:1.5s" stroke="#7a5cff" stroke-width="6" d="M112 200v-40h32v40"/>
  <path class="hd" pathLength="1" style="animation-delay:1.8s" stroke="#3fa7ff" stroke-width="5" d="M152 124h22v20h-22zM163 124v20M152 134h22"/>
  <path class="hd" pathLength="1" style="animation-delay:2.1s" stroke="#22c3a6" stroke-width="6" d="M24 206c40-6 230-8 278-2"/>
  <path class="hd" pathLength="1" style="animation-delay:2.4s" stroke="#22c3a6" stroke-width="5" d="M232 204v-30M232 186c-10-4-14-12-12-20 8 2 12 10 12 20 0-10 4-18 12-20 2 8-2 16-12 20"/>
</svg>`;

const UNDERLINE = `<svg class="underline" viewBox="0 0 210 22"><path d="M6 14c30-8 60-9 92-6s70 6 106-4" fill="none" stroke="#ff5d5d" stroke-width="6" stroke-linecap="round"/></svg>`;

// Рекорд 2048 из сохранённой партии — показываем на карточке.
function bestText() {
  try {
    const best = (JSON.parse(localStorage.getItem('karakuli-2048') || 'null') || {}).best;
    return best ? `рекорд ${best.toLocaleString('ru-RU')}` : 'играть';
  } catch { return 'играть'; }
}

export class HomeScreen {
  constructor({ create, join, solo }) {
    this.join = join;
    this.create = create;
    const word = h('span.logo-word', null, [...'Каракули'].map((ch) => h('span.l', null, ch)));
    this.el = h('div.screen', null,
      h('div.home-top', null,
        h('div.me-chip', null, avatar({ id: me.id, name: me.first_name, photo: me.photo_url }, { size: 32 }), h('span', null, me.first_name)),
        this.bell = h('button.bell', { onclick: () => this.toggleReminders(), 'aria-label': 'Напоминания' }),
      ),
      h('div.logo', null, word, svg(UNDERLINE)),
      h('div.tagline.center', null, 'Игры с друзьями прямо в Telegram'),
      h('div.hero', null, svg(HERO), h('div.bubble', null, 'Это домик?'), h('div.bubble.b2', null, 'В точку! +150')),
      h('div.solo-title', null, 'Одному'),
      h('button.solo-card', { onclick: () => { haptic.tap(); solo('2048'); } },
        h('div.solo-tile', null, '2048'),
        h('div.gc-text', null, h('div.gc-title', null, '2048'), h('div.gc-sub', null, 'Сливайте плитки — соберите 2048')),
        h('div.gc-players', null, bestText()),
      ),
      h('div.steps', null,
        h('div.step', null, h('b', null, '1'), 'Создай комнату'),
        h('div.step', null, h('b', null, '2'), 'Друзья сканируют QR'),
        h('div.step', null, h('b', null, '3'), 'Выбери игру'),
      ),
      h('div.spacer'),
      h('div.home-actions', null,
        h('button.btn', { onclick: () => this.pickGame() }, icon('plus'), 'Создать комнату'),
        h('div.row', null,
          h('button.btn.violet', { onclick: () => this.scan() }, icon('scan'), 'Сканировать'),
          h('button.btn.ghost', { onclick: () => this.askCode() }, icon('keypad'), 'Ввести код'),
        ),
      ),
    );
    this.loadBell();
  }

  // Колокольчик: ежедневные напоминания от бота.
  renderBell(on) {
    this.remindersOn = on;
    this.bell.className = 'bell' + (on ? ' on' : '');
    this.bell.textContent = on ? '🔔 Напоминания' : '🔕 Напоминания';
  }

  async toggleReminders() {
    haptic.tap();
    const want = !this.remindersOn;
    if (want && !(await requestWriteAccess())) {
      toast('Без разрешения писать бот не сможет напоминать', 'warn');
      return;
    }
    try {
      const r = await call('reminders', { enabled: want });
      this.renderBell(r.enabled);
      toast(r.enabled ? 'Будем напоминать раз в день 🔔' : 'Напоминания выключены', r.enabled ? 'ok' : '', 2000);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  pickGame() {
    haptic.tap();
    const card = (mode) => {
      const g = GAMES[mode];
      return h('button.game-card.' + mode, { onclick: () => { s.close(); this.create(mode); } },
        h('div.gc-emoji', null, g.emoji),
        h('div.gc-text', null, h('div.gc-title', null, g.title), h('div.gc-sub', null, g.sub)),
        h('div.gc-players', null, g.players),
      );
    };
    const s = sheet(h('div.col', null,
      h('div.h1.center', null, 'Во что играем?'),
      h('div.muted.center', null, 'Игру можно поменять в комнате'),
      card('draw'),
      card('mafia'),
      card('checkers'),
      card('race'),
      card('who'),
      card('ttt'),
    ));
  }

  loadBell() {
    this.renderBell(false);
    call('reminders').then((r) => this.renderBell(r.enabled), () => { this.bell.style.display = 'none'; });
  }

  scan() {
    haptic.tap();
    if (!canScan()) return this.askCode();
    scanQr((text) => {
      const code = parseCode(text);
      if (!code) { toast('Это не QR-код комнаты «Каракулей»', 'warn'); return false; }
      setTimeout(() => this.join(code), 0);
      return true;
    });
  }

  askCode() {
    haptic.tap();
    const boxes = [0, 1, 2, 3].map(() => h('div.code-box'));
    const input = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '5', 'aria-label': 'Код комнаты' });
    const wrap = h('div.code-boxes', null, boxes, input);
    const paint = () => {
      const v = input.value;
      boxes.forEach((b, i) => {
        b.textContent = v[i] || '';
        b.classList.toggle('filled', !!v[i]);
        b.classList.toggle('cur', i === Math.min(v.length, 3));
      });
    };
    let busy = false;
    const submit = async () => {
      if (busy) return;
      busy = true;
      input.blur();
      s.close();
      await this.join(input.value);
    };
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      haptic.tick();
      paint();
      if (input.value.length === 4) submit();
    });
    const s = sheet(h('div', null,
      h('div.h1.center', null, 'Код комнаты'),
      h('div.muted.center', { style: { marginTop: '6px' } }, 'Четыре цифры под QR-кодом у хозяина'),
      wrap,
    ));
    wrap.addEventListener('click', () => input.focus());
    paint();
    setTimeout(() => input.focus(), 250);
  }
}

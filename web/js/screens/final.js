// Итоги партии: пьедестал, конфетти, новая партия. В этой фазе в комнату
// снова можно заходить, поэтому здесь же есть QR-код.

import { h, svg, icon, icons, avatar, sheet, plural } from '../ui.js';
import { haptic } from '../tg.js';
import { qrCard, seatList } from './lobby.js';

export class FinalScreen {
  constructor({ room, actions }) {
    this.room = room;
    this.actions = actions;
    this.el = h('div.screen');
    this.key = '';
    this.celebrated = false;
  }

  destroy() { cancelAnimationFrame(this.raf); }

  update(s) {
    const key = JSON.stringify([s.players.map((p) => [p.id, p.score, p.active]), s.hostId]);
    if (key === this.key) return;
    this.key = key;
    const isHost = s.hostId === s.me;
    const ranked = s.players.slice().sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const tie = ranked.length > 1 && ranked[1].score === top.score;
    const iWon = !tie && top && top.id === s.me;

    const order = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
    const place = (p) => ranked.indexOf(p) + 1;
    const podium = h('div.podium', null, order.map((p) => h('div.pod.p' + place(p), null,
      place(p) === 1 && !tie && h('div.crown', null, '👑'),
      avatar(p),
      h('div.nm', null, p.id === s.me ? 'Вы' : p.name),
      h('div.col-bar', null, h('b', null, String(place(p))), h('span', null, `${p.score} ${plural(p.score, 'очко', 'очка', 'очков')}`)),
    )));

    const title = tie ? 'Ничья!' : iWon ? 'Вы победили!' : `${top.name} побеждает!`;
    this.el.replaceChildren(
      h('div.topbar', null,
        h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('home')),
        h('div.title', null, 'Итоги'),
        h('button.icon-btn', { onclick: () => this.showQr(s), 'aria-label': 'Пригласить' }, icon('scan')),
      ),
      h('div.center', { style: { marginTop: '10px' } },
        h('div.hand', { style: { fontSize: '50px', lineHeight: '1', transform: 'rotate(-2deg)' } }, title),
        h('div.muted', { style: { marginTop: '8px', fontWeight: 800 } }, iWon ? 'Лучший художник и самый зоркий угадыватель' : 'Отличная партия! Ещё одну?'),
      ),
      podium,
      h('div.spacer'),
      h('div.bottom-bar', null,
        isHost
          ? h('div.col', null,
              h('button.btn.mint', { disabled: s.players.filter((p) => p.active).length < 2, onclick: (e) => { e.currentTarget.disabled = true; haptic.tap(); this.actions.start(); } }, svg(icons.replay), 'Играть ещё'),
            )
          : h('div.waiting-pill', null, 'Ждём новую партию', h('span.dots', null, h('span'), h('span'), h('span'))),
      ),
    );
    if (!this.celebrated) {
      this.celebrated = true;
      haptic.ok();
      this.confetti();
    }
  }

  showQr(s) {
    haptic.tap();
    sheet(h('div.col', null,
      h('div.h1.center', null, 'Позвать ещё'),
      qrCard(s.code),
      seatList(s),
    ));
  }

  confetti() {
    const c = h('canvas', { id: 'confetti' });
    this.el.append(c);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (c.width = this.el.clientWidth * dpr);
    const H = (c.height = this.el.clientHeight * dpr);
    const ctx = c.getContext('2d');
    const colors = ['#ff5d5d', '#ffc23d', '#22c3a6', '#7a5cff', '#3fa7ff', '#ff8fb1'];
    const parts = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-Math.random() * 16 - 6) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: (5 + Math.random() * 6) * dpr,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    const step = (t) => {
      const age = t - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 2600) / 900);
      for (const p of parts) {
        p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (age < 3500) this.raf = requestAnimationFrame(step);
      else c.remove();
    };
    this.raf = requestAnimationFrame(step);
  }
}

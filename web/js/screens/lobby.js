// Лобби: QR-код и код комнаты, список игроков, настройки партии.

import { h, svg, icon, icons, avatar, toast } from '../ui.js';
import { qrSvg } from '../qr.js';
import { roomLink, shareRoom, copy, haptic, confirm } from '../tg.js';

const MAX = 3;

export function qrCard(code) {
  return h('div.qr-card', null,
    h('div.qr-frame', null,
      svg(qrSvg(roomLink(code))),
      h('i.corner.tl'), h('i.corner.tr'), h('i.corner.bl'), h('i.corner.br'), h('i.scan'),
    ),
    h('div.room-code', { onclick: () => copyCode(code) }, [...code].map((d) => h('span', null, d))),
    h('div.qr-hint', null, 'Друзья сканируют код в «Каракулях» или камерой телефона'),
    h('div.qr-actions', null,
      h('button.btn.ghost.small', { onclick: () => { haptic.tap(); shareRoom(code); } }, icon('share'), 'Позвать'),
      h('button.btn.ghost.small', { onclick: () => copyCode(code) }, icon('copy'), 'Код'),
    ),
  );
}

async function copyCode(code) {
  haptic.tap();
  if (await copy(code)) toast('Код скопирован', 'ok', 1400);
}

export function seatList(state) {
  const seats = state.players.map((p) => {
    const host = p.id === state.hostId;
    const online = p.active || p.id === state.me;
    return h('div.seat' + (online ? '' : '.away'), null,
      avatar(p, { off: !online }),
      h('div.who', null,
        h('div.nm', null, p.name),
        h('div.st' + (online ? '.on' : '.off'), null, online ? 'в сети' : 'не в сети — ждём…'),
      ),
      p.id === state.me && h('span.tag', null, 'вы'),
      host && h('span.tag.host', null, '👑 хозяин'),
    );
  });
  for (let i = state.players.length; i < MAX; i++) {
    seats.push(h('div.seat.empty', null,
      h('div.ph', null, '+'),
      h('div.nm.faint', null, 'Ждём игрока ', h('span.dots', null, h('span'), h('span'), h('span'))),
    ));
  }
  return h('div.seats', null, seats);
}

export class LobbyScreen {
  constructor({ room, actions }) {
    this.room = room;
    this.actions = actions;
    this.el = h('div.screen');
    this.key = '';
  }

  update(s) {
    const isHost = s.hostId === s.me;
    const key = JSON.stringify([s.players.map((p) => [p.id, p.name, p.active]), s.hostId, s.rounds, s.drawTime, s.notice, this.noticeHidden]);
    if (key === this.key) return;
    const prev = this.key ? JSON.parse(this.key)[0].length : s.players.length;
    if (s.players.length > prev) haptic.ok();
    this.key = key;

    const n = s.players.length;
    const online = s.players.filter((p) => p.active || p.id === s.me);
    const offline = s.players.filter((p) => !(p.active || p.id === s.me));
    const notice = s.notice && !this.noticeHidden && h('div.notice', null,
      h('div.notice-t', null, 'Игра прервана'),
      h('div', null, s.notice.names.length
        ? `${s.notice.names.length > 1 ? 'Игроки' : 'Игрок'} ${s.notice.names.join(', ')} ${s.notice.names.length > 1 ? 'вышли' : 'вышел'} из игры — продолжать не с кем. Соберите компанию и начните заново.`
        : 'Не хватило игроков. Соберите компанию и начните заново.'),
      h('button.notice-x', { 'aria-label': 'Закрыть', onclick: () => { this.noticeHidden = true; this.key = ''; this.update(this.room.state); } }, icon('close')),
    );
    const start = async (e) => {
      const btn = e.currentTarget;
      haptic.tap();
      if (offline.length) {
        const names = offline.map((p) => p.name).join(', ');
        if (!(await confirm(`${names} сейчас не в сети. Начать без ${offline.length > 1 ? 'них' : 'этого игрока'}?`))) return;
      }
      btn.disabled = true;
      this.actions.start();
    };
    const seg = (opts, cur, fmt, onPick) => h('div.seg' + (isHost ? '' : '.ro'), null,
      opts.map((v) => h('button' + (v === cur ? '.on' : ''), { onclick: () => { if (v !== cur) { haptic.tick(); onPick(v); } } }, fmt(v))));

    const host = s.players.find((p) => p.id === s.hostId);
    this.el.replaceChildren(
      h('div.topbar', null,
        h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('back')),
        h('div.title', null, 'Комната'),
        h('div', { style: { width: '44px' } }),
      ),
      notice || '',
      qrCard(s.code),
      h('div.section-title', null, h('div.h2', null, 'Игроки'), h('div.faint.small', null, `${online.length} в сети · ${n} из ${MAX}`)),
      seatList(s),
      h('div.section-title', null, h('div.h2', null, 'Партия'), !isHost && h('div.faint.small', null, 'настраивает хозяин')),
      h('div.card.settings', null,
        h('div.setting', null, h('div.lbl', null, 'Раунды'),
          seg([1, 2, 3], s.rounds, String, (v) => this.actions.settings(v, s.drawTime))),
        h('div.setting', null, h('div.lbl', null, 'На рисунок'),
          seg([60, 80, 100], s.drawTime, (v) => v + ' с', (v) => this.actions.settings(s.rounds, v))),
      ),
      h('div.spacer'),
      h('div.bottom-bar', null,
        isHost
          ? h('button.btn.mint', { disabled: online.length < 2, onclick: start },
              online.length >= 2 ? [svg(icons.play), 'Начать игру'] : n < 2 ? 'Нужен ещё 1 игрок' : 'Ждём игроков в сети')
          : h('div.waiting-pill', null, `Ждём, пока ${host ? host.name : 'хозяин'} начнёт`, h('span.dots', null, h('span'), h('span'), h('span'))),
      ),
    );
  }
}

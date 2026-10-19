// Лобби: QR-код и код комнаты, список игроков, настройки партии.

import { h, svg, icon, icons, avatar, toast } from '../ui.js';
import { qrSvg } from '../qr.js';
import { roomLink, shareRoom, copy, haptic, confirm } from '../tg.js';

// Состав ролей мафии — как на сервере (lib/mafia.js).
export function mafiaLineup(n) {
  const mafia = n >= 6 ? 2 : 1;
  const civ = Math.max(0, n - mafia - 2);
  return `${mafia === 1 ? '1 мафия' : '2 мафии'}, комиссар, доктор${civ ? `, ${civ} ${civ === 1 ? 'мирный' : 'мирных'}` : ''}`;
}

const DECK_NAMES = { mix: '🎲 Всё вперемешку', chars: '🦸 Персонажи', famous: '⭐ Знаменитости', animals: '🐾 Животные', jobs: '👷 Профессии' };

export const GAMES = {
  draw: { title: 'Каракули', sub: 'Рисуй и угадывай', players: '2–3 игрока', emoji: '🎨' },
  mafia: { title: 'Мафия', sub: 'Найди мафию среди друзей', players: '4–8 игроков', emoji: '🕵️' },
  checkers: { title: 'Шашки', sub: 'Русские шашки один на один', players: '2 игрока', emoji: '⚪' },
  race: { title: 'Гонки', sub: 'Заезд на 3 круга', players: '2–8 игроков', emoji: '🏎️' },
  who: { title: 'Кто я?', sub: 'Угадай, кто написан у тебя на лбу', players: '3–8 игроков', emoji: '🤔' },
};

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

// Кнопка микрофона; её вид обновляет сам менеджер голоса (Voice.render).
export function voiceButton(voice) {
  const el = h('button.icon-btn.voice-btn', { onclick: () => voice.press() });
  queueMicrotask(() => voice.render());
  return el;
}

// Карточка голосового чата: кто в эфире и кнопка подключения.
export function voiceCard(voice, state) {
  const inVoice = state.players.filter((p) => p.voice && p.active);
  const on = voice.mode !== 0;
  return h('div.card.voice-card', null,
    h('div.vc-icon' + (on ? '.on' : ''), null, svg(icons.mic)),
    h('div.vc-text', null,
      h('div.vc-title', null, 'Голосовой чат'),
      h('div.vc-sub', { 'data-voice-status': '' }, voice.statusText()),
      inVoice.length > 0 && h('div.vc-avas', null, inVoice.map((p) => avatar(p, { size: 22 }))),
    ),
    on
      ? h('button.btn.ghost.small', { onclick: () => voice.leave() }, 'Выйти')
      : h('button.btn.violet.small', { onclick: () => voice.join() }, 'Войти'),
  );
}

const voiceTag = (p) => p.voice === 1 ? h('span.vtag', { title: 'В голосовом чате' }, svg(icons.mic))
  : p.voice === 2 ? h('span.vtag', { title: 'Слушает' }, svg(icons.headphones)) : null;

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
      voiceTag(p),
      host && h('span.tag.host', null, '👑 хозяин'),
    );
  });
  const free = state.maxPlayers - state.players.length;
  if (free > 0) {
    const need = Math.max(0, state.minPlayers - state.players.length);
    seats.push(h('div.seat.empty', null,
      h('div.ph', null, '+'),
      h('div.nm.faint', null,
        need ? `Нужно ещё ${need} ` : `Можно ещё ${free} `,
        h('span.dots', null, h('span'), h('span'), h('span'))),
    ));
  }
  return h('div.seats', null, seats);
}

export class LobbyScreen {
  constructor({ room, actions, voice }) {
    this.room = room;
    this.actions = actions;
    this.voice = voice;
    this.el = h('div.screen');
    this.key = '';
  }

  update(s) {
    const isHost = s.hostId === s.me;
    const key = JSON.stringify([s.players.map((p) => [p.id, p.name, p.active, p.voice]), this.voice.mode, s.hostId, s.rounds, s.drawTime, s.mode, s.track, s.deck, s.notice, this.noticeHidden]);
    if (key === this.key) return;
    const prev = this.key ? JSON.parse(this.key)[0].length : s.players.length;
    if (s.players.length > prev) haptic.ok();
    this.key = key;

    const n = s.players.length;
    const online = s.players.filter((p) => p.active || p.id === s.me);
    const offline = s.players.filter((p) => !(p.active || p.id === s.me));
    const notice = s.notice && !this.noticeHidden && h('div.notice', null,
      h('div.notice-t', null, 'Игра прервана'),
      h('div', null, (s.notice.ids || []).includes(s.me)
        ? 'Вы долго были не в сети, и партия прервалась. Начните новую, когда все будут на месте.'
        : s.notice.names.length
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
        voiceButton(this.voice),
      ),
      notice || '',
      qrCard(s.code),
      h('div.section-title', null, h('div.h2', null, 'Игроки'), h('div.faint.small', null, `${online.length} в сети · ${n} из ${s.maxPlayers}`)),
      seatList(s),
      voiceCard(this.voice, s),
      h('div.section-title', null, h('div.h2', null, 'Партия'), !isHost && h('div.faint.small', null, 'настраивает хозяин')),
      h('div.card.settings', null,
        h('div.setting.wide', null, h('div.lbl', null, 'Игра'),
          h('div.game-grid', null, Object.keys(GAMES).map((v) => h('button.gg' + (v === s.mode ? '.on' : ''), {
            disabled: !isHost && v !== s.mode,
            onclick: () => { if (isHost && v !== s.mode) { haptic.tick(); this.actions.settings({ mode: v }); } },
          }, h('span.e', null, GAMES[v].emoji), GAMES[v].title)))),
        s.mode === 'draw' && [
          h('div.setting', null, h('div.lbl', null, 'Раунды'),
            seg([1, 2, 3], s.rounds, String, (v) => this.actions.settings({ rounds: v }))),
          h('div.setting', null, h('div.lbl', null, 'На рисунок'),
            seg([60, 80, 100], s.drawTime, (v) => v + ' с', (v) => this.actions.settings({ drawTime: v }))),
        ],
        s.mode === 'who' && h('div.setting.wide', null, h('div.lbl', null, 'Колода'),
          h('div.game-grid', null, Object.entries(DECK_NAMES).map(([v, name]) => h('button.gg' + (v === s.deck ? '.on' : ''), {
            disabled: !isHost && v !== s.deck,
            onclick: () => { if (isHost && v !== s.deck) { haptic.tick(); this.actions.settings({ deck: v }); } },
          }, name)))),
        s.mode === 'who' && h('div.mafia-info', null,
          h('div', null, 'Каждому загадан персонаж: его видят все, кроме вас. Задавайте вопросы «да/нет» и угадайте, кто вы.'),
          h('div.faint.small', null, 'Большинство ответило «да» — спрашиваете дальше, «нет» — ход переходит.'),
        ),
        s.mode === 'race' && h('div.setting.wide', null, h('div.lbl', null, 'Трасса'),
          seg(['ring', 'canyon', 'city'], s.track, (v) => ({ ring: 'Кольцо', canyon: 'Каньон', city: 'Город' })[v], (v) => this.actions.settings({ track: v }))),
        s.mode === 'race' && h('div.mafia-info', null,
          h('div', null, 'Три круга, газ автоматический. Руль — касание левой или правой половины экрана.'),
          h('div.faint.small', null, 'Соперники видны «призраками» с небольшой задержкой и не сталкиваются с вами.'),
        ),
        s.mode === 'checkers' && h('div.mafia-info', null,
          h('div', null, 'Русские шашки: бить обязательно, простые бьют и назад, дамки ходят на любое расстояние.'),
          h('div.faint.small', null, 'Цвета выпадают случайно, в реванше меняются.'),
        ),
        s.mode === 'mafia' && h('div.mafia-info', null,
          h('div', null, n >= s.minPlayers ? `${n} игроков: ${mafiaLineup(n)}.` : `Для мафии нужно от ${s.minPlayers} до ${s.maxPlayers} игроков.`),
          h('div.faint.small', null, 'Ведущий — сама игра. Ночью мафия выбирает жертву, комиссар проверяет, доктор лечит; днём город голосует.'),
        ),
      ),
      h('div.spacer'),
      h('div.bottom-bar', null,
        isHost
          ? h('button.btn.mint', { disabled: online.length < s.minPlayers, onclick: start },
              online.length >= s.minPlayers ? [svg(icons.play), 'Начать игру']
                : n < s.minPlayers ? `Нужно ещё ${s.minPlayers - n}` : 'Ждём игроков в сети')
          : h('div.waiting-pill', null, `Ждём, пока ${host ? host.name : 'хозяин'} начнёт`, h('span.dots', null, h('span'), h('span'), h('span'))),
      ),
    );
  }
}

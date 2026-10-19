// Экран мафии: одна страница на всю партию, вид меняется по фазе.
//   m_roles — карточка роли, m_night — ночные действия (город спит),
//   m_morning / m_verdict — итоги ночи и голосования, m_day — обсуждение,
//   m_vote — голосование, final — победители и все роли.

import { h, svg, icon, icons, avatar, toast, plural } from '../ui.js';
import { haptic } from '../tg.js';
import { voiceButton } from './lobby.js';

export const ROLES = {
  mafia: { name: 'Мафия', emoji: '🕶️', team: 'mafia', text: 'Ночью вместе с сообщниками выбираете жертву. Днём притворяйтесь мирным жителем.' },
  com: { name: 'Комиссар', emoji: '🔎', team: 'town', text: 'Каждую ночь проверяете одного игрока и узнаёте, мафия он или нет. Помогите городу, но не раскройтесь раньше времени.' },
  doc: { name: 'Доктор', emoji: '💉', team: 'town', text: 'Каждую ночь лечите одного игрока: если мафия выберет его, он выживет. Одного и того же нельзя лечить две ночи подряд.' },
  civ: { name: 'Мирный житель', emoji: '🏠', team: 'town', text: 'Ночью спите. Днём ищите мафию в разговоре и голосуйте за подозреваемых.' },
};

const PHASE_TITLES = {
  m_roles: 'Раздача ролей', m_night: 'Ночь', m_morning: 'Утро', m_day: 'День', m_vote: 'Голосование', m_verdict: 'Приговор', final: 'Итоги',
};
const NIGHT_HINT = {
  mafia: 'Выберите, кого мафия убьёт этой ночью',
  com: 'Выберите, кого проверить',
  doc: 'Выберите, кого вылечить',
};

export class MafiaScreen {
  constructor({ room, actions, serverNow, voice }) {
    this.room = room;
    this.actions = actions;
    this.serverNow = serverNow;
    this.voice = voice;
    this.lastSec = null;
    this.key = '';
    this.overlayKey = '';

    this.timer = h('div.timer', null,
      svg('<svg viewBox="0 0 50 50"><circle class="bg" cx="25" cy="25" r="21"/><circle class="fg" cx="25" cy="25" r="21" stroke-dasharray="132" stroke-dashoffset="0"/></svg>'),
      h('div.num'));
    this.title = h('div.word-area');
    this.roleBar = h('div.m-rolebar');
    this.hint = h('div.m-hint');
    this.grid = h('div.m-grid');
    this.feedEl = h('div.feed.m-feed');
    this.bottom = h('div.m-bottom');
    this.overlay = null;

    this.input = h('input', { placeholder: 'Сообщение…', maxlength: '200', enterkeyhint: 'send', autocomplete: 'off' });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.send(); } });
    this.chatBar = h('div.guess-bar', null, this.input, h('button.btn.violet', { onclick: () => this.send(), 'aria-label': 'Отправить' }, icon('send')));

    this.el = h('div.screen.fixed.game.mafia', null,
      h('div.hud', null,
        this.timer,
        this.title,
        h('div.hud-btns', null, voiceButton(voice), h('button.icon-btn', { onclick: this.actions.leave, 'aria-label': 'Выйти' }, icon('close'))),
      ),
      this.roleBar,
      this.hint,
      h('div.m-scroll', null, this.grid, this.feedEl),
      this.bottom,
    );
    for (const m of room.messages) this.addMessage(m);
    this.tickId = setInterval(() => this.tick(), 250);
  }

  destroy() {
    clearInterval(this.tickId);
    this.voice.setForced(false);
  }

  get s() { return this.room.state; }

  update(s) {
    const m = s.mafia;
    if (!m) return;
    const night = s.phase === 'm_night' || s.phase === 'm_roles';
    this.el.classList.toggle('night', night);
    // Ночью город спит — микрофоны выключены у всех.
    this.voice.setForced(s.phase === 'm_night');

    const key = JSON.stringify([s.phase, s.version, m.myMove, m.readyIds, m.votes, m.picks, s.players.map((p) => [p.id, p.active, p.voice]), s.hostId]);
    if (key !== this.key) {
      this.key = key;
      this.render(s, m);
    }
    this.renderOverlay(s, m);
    this.tick();
  }

  absorb(ops, msgs) {
    for (const msg of msgs) {
      this.addMessage(msg);
      if (msg.kind === 'm') haptic.soft();
    }
  }

  // ─── Основной вид ────────────────────────────────────────────────────────

  render(s, m) {
    const me = s.me;
    const alive = m.alive.includes(me);
    const role = ROLES[m.role] || ROLES.civ;
    const dayNo = m.round;

    this.title.replaceChildren(
      h('div.round', null, s.phase === 'final' ? `${m.total} ${plural(m.total, 'игрок', 'игрока', 'игроков')}` : s.phase === 'm_roles' ? 'Начало' : `${s.phase === 'm_night' ? 'Ночь' : 'День'} ${dayNo}`),
      h('div.word-show', null, PHASE_TITLES[s.phase] || ''),
    );
    this.roleBar.replaceChildren(
      h('button.m-role.' + role.team, { onclick: () => this.showRole(m) }, h('span.e', null, role.emoji), 'Вы — ', h('b', null, role.name)),
      h('div.m-count', null, `В живых ${m.alive.length} из ${m.total}`),
    );

    let hint = '';
    if (s.phase === 'final') hint = '';
    else if (!alive) hint = 'Вы выбыли. Наблюдайте за игрой молча.';
    else if (s.phase === 'm_roles') hint = 'Запомните роль. Скоро наступит ночь.';
    else if (s.phase === 'm_night') hint = NIGHT_HINT[m.role] ? (m.myMove ? 'Выбор сделан — можно изменить до утра' : NIGHT_HINT[m.role]) : 'Город спит. Закройте глаза и ждите утра 😴';
    else if (s.phase === 'm_day') hint = 'Обсуждайте, кто мафия. Нажмите «Готов», когда решите.';
    else if (s.phase === 'm_vote') hint = m.done ? 'Голос учтён — можно передумать до конца голосования' : 'Нажмите на игрока, чтобы проголосовать';
    this.hint.textContent = hint;
    this.hint.style.display = hint ? '' : 'none';

    this.grid.replaceChildren(...s.players.filter((p) => m.ids.includes(p.id)).map((p) => this.card(s, m, p)));
    this.renderBottom(s, m, alive);
  }

  card(s, m, p) {
    const dead = !m.alive.includes(p.id);
    const role = m.roles[p.id];
    const me = p.id === s.me;
    const target = this.targetable(s, m, p);
    const chosen = m.myMove === p.id;
    const votes = m.votes ? Object.entries(m.votes).filter(([, t]) => t === p.id).map(([v]) => Number(v)) : [];
    const picks = m.picks ? Object.entries(m.picks).filter(([u, t]) => t === p.id && Number(u) !== s.me).map(([u]) => Number(u)) : [];
    const check = m.checks && m.checks[p.id];
    const ready = m.readyIds && m.readyIds.includes(p.id);
    const tags = [];
    if (me) tags.push(h('span.m-tag', null, 'вы'));
    if (role && (!me || s.phase === 'final' || dead)) tags.push(h('span.m-tag.' + ROLES[role].team, null, `${ROLES[role].emoji} ${ROLES[role].name}`));
    if (check && !role) tags.push(h('span.m-tag.' + (check === 'mafia' ? 'mafia' : 'town'), null, check === 'mafia' ? '🔎 мафия!' : '🔎 мирный'));
    if (m.lastHeal === p.id && s.phase === 'm_night') tags.push(h('span.m-tag', null, 'лечили вчера'));

    const el = h('button.mp' + (dead ? '.dead' : '') + (target ? '.can' : '') + (chosen ? '.chosen' : '') + (ready ? '.ready' : ''), {
      disabled: !target,
      onclick: () => this.choose(s, m, p),
    },
      avatar(p, { off: dead || !p.active, badge: dead ? h('span', null, '☠') : ready ? icons.check : null }),
      h('div.mp-body', null,
        h('div.mp-name', null, me ? 'Вы' : p.name),
        h('div.mp-tags', null, tags.length ? tags : h('span.faint', null, dead ? 'выбыл' : p.active ? '' : 'не в сети')),
      ),
      votes.length > 0 && h('div.mp-votes', null, String(votes.length)),
      picks.length > 0 && h('div.mp-picks', null, picks.map((u) => avatar(s.players.find((x) => x.id === u) || { id: u, name: '?' }, { size: 20 }))),
    );
    return el;
  }

  targetable(s, m, p) {
    if (!m.alive.includes(s.me) || !m.alive.includes(p.id)) return false;
    if (s.phase === 'm_night') {
      if (m.role === 'mafia') return m.roles[p.id] !== 'mafia';
      if (m.role === 'com') return p.id !== s.me;
      if (m.role === 'doc') return p.id !== m.lastHeal;
      return false;
    }
    if (s.phase === 'm_vote') return p.id !== s.me;
    return false;
  }

  choose(s, m, p) {
    haptic.tap();
    if (s.phase === 'm_night') this.actions.mafia('night', p.id);
    else if (s.phase === 'm_vote') this.actions.mafia('vote', p.id);
  }

  renderBottom(s, m, alive) {
    const parts = [];
    const canChat = (alive && ['m_morning', 'm_day', 'm_vote', 'm_verdict'].includes(s.phase))
      || (alive && s.phase === 'm_night' && m.role === 'mafia') || s.phase === 'final';
    if (s.phase === 'm_roles' && alive) {
      parts.push(m.done
        ? h('div.waiting-pill', null, `Ждём остальных · ${m.readyIds.length}/${m.alive.length}`)
        : h('button.btn.violet', { onclick: () => { haptic.tap(); this.actions.mafia('ack'); } }, 'Понятно, я готов'));
    }
    if (s.phase === 'm_day' && alive) {
      parts.push(h('button.btn' + (m.done ? '.ghost' : '.mint'), { disabled: m.done, onclick: () => { haptic.tap(); this.actions.mafia('ready'); } },
        m.done ? `Ждём остальных · ${m.readyIds.length}/${m.alive.length}` : `Готов голосовать · ${m.readyIds.length}/${m.alive.length}`));
    }
    if (s.phase === 'm_vote' && alive) {
      parts.push(h('button.btn.ghost.small', { onclick: () => { haptic.tap(); this.actions.mafia('vote', 0); } },
        m.done && m.myMove === 0 ? 'Вы воздержались' : 'Воздержаться'));
    }
    if (s.phase === 'final') {
      const isHost = s.hostId === s.me;
      parts.push(isHost
        ? h('div.row', null,
            h('button.btn.mint', { onclick: (e) => { e.currentTarget.disabled = true; haptic.tap(); this.actions.start(); } }, svg(icons.replay), 'Ещё партию'),
            h('button.btn.ghost', { style: { width: 'auto' }, onclick: () => { haptic.tap(); this.actions.toLobby(); } }, 'В лобби'))
        : h('div.waiting-pill', null, 'Ждём, пока хозяин начнёт', h('span.dots', null, h('span'), h('span'), h('span'))));
    }
    if (canChat) {
      this.input.placeholder = s.phase === 'm_night' ? 'Шёпотом сообщникам…' : 'Сообщение городу…';
      parts.unshift(this.chatBar);
    }
    this.bottom.replaceChildren(...parts);
  }

  async send() {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    haptic.tap();
    await this.actions.chat(text);
  }

  // ─── Лента ───────────────────────────────────────────────────────────────

  addMessage(msg) {
    // Одно и то же сообщение может прийти и при создании экрана, и в absorb().
    if (msg.id <= (this.seenMsg || 0)) return;
    this.seenMsg = msg.id;
    const who = (id, name) => (id === this.s.me ? 'Вы' : name);
    let line = null;
    if (msg.kind === 'm') line = h('div.m.narr', null, msg.body);
    else if (msg.kind === 'chat') line = h('div.m', null, h('b', null, who(msg.userId, msg.name) + ': '), msg.body);
    else if (msg.kind === 'mchat') line = h('div.m.mafia-chat', null, h('b', null, '🕶️ ' + who(msg.userId, msg.name) + ': '), msg.body);
    else if (msg.kind === 'join') line = h('div.m.sys', null, `${who(msg.userId, msg.name)} в комнате`);
    else if (msg.kind === 'away') line = h('div.m.sys', null, `${msg.name} не в сети`);
    else if (msg.kind === 'back') line = h('div.m.sys', null, `${msg.name} снова в сети`);
    else if (msg.kind === 'left') line = h('div.m.sys', null, `${msg.name} покидает комнату`);
    if (!line) return;
    this.feedEl.append(line);
    while (this.feedEl.children.length > 80) this.feedEl.firstChild.remove();
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  // ─── Таймер ──────────────────────────────────────────────────────────────

  tick() {
    const s = this.s;
    const has = s && s.deadline;
    this.timer.style.visibility = has ? '' : 'hidden';
    if (!has) return;
    const total = Math.max(1, s.deadline - s.phaseStart);
    const left = Math.max(0, s.deadline - this.serverNow());
    const sec = Math.ceil(left / 1000);
    this.timer.querySelector('.fg').setAttribute('stroke-dashoffset', String(132 * (1 - left / total)));
    this.timer.querySelector('.num').textContent = String(sec);
    this.timer.classList.toggle('hot', sec <= 10 && (s.phase === 'm_day' || s.phase === 'm_vote' || s.phase === 'm_night'));
    if (sec !== this.lastSec) {
      if (sec <= 5 && sec > 0 && s.phase === 'm_vote') haptic.tick();
      this.lastSec = sec;
    }
  }

  // ─── Оверлеи ─────────────────────────────────────────────────────────────

  renderOverlay(s, m) {
    const show = (s.phase === 'm_roles' && !m.done) || s.phase === 'm_morning' || s.phase === 'm_verdict' || s.phase === 'final';
    const key = show ? s.phase + ':' + m.round : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (!show) return;
    const ov = s.phase === 'm_roles' ? this.roleOverlay(m)
      : s.phase === 'final' ? this.finalOverlay(s, m)
      : this.resultOverlay(s, m);
    this.overlay = ov;
    this.el.append(ov);
  }

  roleOverlay(m) {
    const r = ROLES[m.role] || ROLES.civ;
    const mates = m.role === 'mafia'
      ? Object.keys(m.roles).map(Number).filter((id) => id !== this.s.me && m.roles[id] === 'mafia') : [];
    const card = h('div.role-card.' + r.team, null,
      h('div.rc-inner', null,
        h('div.rc-back', null, h('div.rc-q', null, '?'), h('div.small', null, 'Нажмите, чтобы открыть')),
        h('div.rc-front', null,
          h('div.rc-emoji', null, r.emoji),
          h('div.rc-name', null, r.name),
          h('div.rc-text', null, r.text),
          mates.length > 0 && h('div.rc-mates', null, 'Ваши сообщники: ', mates.map((id) => (this.s.players.find((p) => p.id === id) || {}).name).join(', ')),
        ),
      ));
    card.addEventListener('click', () => { if (!card.classList.contains('open')) { card.classList.add('open'); haptic.ok(); } });
    return h('div.overlay.m-overlay', null,
      h('div.muted', { style: { fontWeight: 800, marginBottom: '14px' } }, 'Ваша роль в этой партии'),
      card,
      h('button.btn.violet', { style: { maxWidth: '320px', marginTop: '22px' }, onclick: () => { haptic.tap(); this.actions.mafia('ack'); } }, 'Понятно'),
      h('div.faint.small', { style: { marginTop: '10px' } }, 'Никому не показывайте экран'),
    );
  }

  resultOverlay(s, m) {
    const night = s.phase === 'm_morning';
    const victim = night ? m.night && m.night.killed : m.vote && m.vote.out;
    const p = victim && s.players.find((x) => x.id === victim);
    const role = victim && m.roles[victim];
    let title, text;
    if (night) {
      title = '☀️ Утро';
      text = victim ? 'Этой ночью погиб' : m.night && m.night.saved ? 'Мафия выбрала жертву, но доктор её спас!' : 'Ночь прошла спокойно — все живы';
    } else {
      title = '⚖️ Приговор';
      text = victim ? 'Город выгнал' : 'Сегодня никого не выгнали';
    }
    if (victim === s.me) haptic.err();
    return h('div.overlay.m-overlay', { onclick: (e) => e.currentTarget.remove() },
      h('div.hand', { style: { fontSize: '46px', lineHeight: 1 } }, title),
      h('div.muted', { style: { marginTop: '12px', fontWeight: 800 } }, text),
      p && h('div.big-ava', { style: { marginTop: '18px' } }, avatar(p, { off: true, badge: h('span', null, '☠') })),
      p && h('div.h1', { style: { marginTop: '14px' } }, victim === s.me ? 'Вы' : p.name),
      role && h('div.m-tag.big.' + ROLES[role].team, { style: { marginTop: '10px' } }, `${ROLES[role].emoji} ${ROLES[role].name}`),
      h('div.faint.small', { style: { marginTop: '22px' } }, 'Нажмите, чтобы закрыть'),
    );
  }

  finalOverlay(s, m) {
    const townWon = m.winner === 'town';
    const myRole = m.roles[s.me];
    const iWon = myRole && (ROLES[myRole].team === (townWon ? 'town' : 'mafia'));
    haptic[iWon ? 'ok' : 'warn']();
    const rows = s.players.filter((p) => m.roles[p.id]).map((p) => {
      const r = ROLES[m.roles[p.id]];
      const dead = !m.alive.includes(p.id);
      return h('div.gain', null,
        avatar(p, { off: dead }),
        h('div.nm', null, p.id === s.me ? 'Вы' : p.name),
        h('span.m-tag.' + r.team, null, `${r.emoji} ${r.name}`),
      );
    });
    return h('div.overlay.m-overlay.final-ov', { onclick: (e) => { if (e.target === e.currentTarget) e.currentTarget.remove(); } },
      h('div', { style: { fontSize: '56px' } }, townWon ? '🏙️' : '🕶️'),
      h('div.hand', { style: { fontSize: '44px', lineHeight: 1.05, marginTop: '6px' } }, townWon ? 'Мирные победили!' : 'Победила мафия'),
      h('div.muted', { style: { marginTop: '8px', fontWeight: 800 } }, iWon ? 'Ваша команда выиграла 🎉' : 'В этот раз не повезло'),
      h('div.gains', null, rows),
      h('button.btn.ghost', { style: { maxWidth: '360px', marginTop: '18px' }, onclick: (e) => e.currentTarget.closest('.overlay').remove() }, 'Закрыть'),
    );
  }

  showRole(m) {
    haptic.tap();
    const r = ROLES[m.role] || ROLES.civ;
    toast(`${r.emoji} ${r.name}: ${r.text}`, '', 5000);
  }
}

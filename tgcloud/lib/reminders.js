// Ежедневные напоминания о Mini App.
//
// Подписка: автоматически при /start в боте или переключателем в Mini App
// (тогда Telegram спрашивает разрешение писать пользователю). Отписка —
// кнопкой в самом напоминании, командой /stop или в Mini App.
//
// У платформы нет таймеров, поэтому рассылку раз в день запускает внешний
// планировщик (.github/workflows/reminders.yml) через endpoints/sendReminders.

import { api, BotApiError } from 'sdk';
import { one, many, exec } from './sql.js';
import { now } from './core.js';
import { APP_URL } from './config.js';

// Сутки считаем по Москве: напоминание — не чаще раза в календарный день.
const MSK = 3 * 3600_000;
const dayStart = (t) => Math.floor((t + MSK) / 86400_000) * 86400_000 - MSK;
// Сколько сообщений отправлять за один запуск (лимит Bot API — около 30 в секунду).
const BATCH = 150;

export async function setSubscription(userId, name, enabled) {
  await exec(
    `INSERT INTO subscribers (user_id, name, enabled, last_sent, created_at) VALUES (:u, :n, :e, 0, :t)
     ON CONFLICT (user_id) DO UPDATE SET enabled = :e, name = COALESCE(:n, subscribers.name)`,
    { u: userId, n: name || null, e: enabled ? 1 : 0, t: now() },
  );
}

// Подписать при первом /start, но не включать обратно тех, кто отписался.
export async function subscribeOnStart(userId, name) {
  await exec(
    `INSERT INTO subscribers (user_id, name, enabled, last_sent, created_at) VALUES (:u, :n, 1, 0, :t)
     ON CONFLICT (user_id) DO UPDATE SET name = :n`,
    { u: userId, n: name || null, t: now() },
  );
}

export async function isSubscribed(userId) {
  const row = await one('SELECT enabled FROM subscribers WHERE user_id = :u', { u: userId });
  return !!(row && row.enabled);
}

const TEXTS = [
  '🎨 Друзья заскучали! Соберите комнату в «Каракулях» — рисуйте и угадывайте вместе.',
  '🕵️ Сегодня отличный вечер для мафии. Позовите 4+ друзей — ведущий уже на месте.',
  '🧩 Новый день — новый рекорд в 2048. {best}',
  '⚪ Кто кого в шашки? Вызовите друга на партию.',
  '🏎️ Трассы прогреты! Заезд на 3 круга с друзьями ждёт.',
  '🤔 «Кто я?» — идеальная игра для компании. Узнаете, кем вас загадали?',
  '❌ Быстрая партия в крестики-нолики? 10×10 — до пяти в ряд.',
];

async function textFor(userId, t) {
  const day = Math.floor((t + MSK) / 86400_000);
  let text = TEXTS[(day + userId) % TEXTS.length];
  if (text.includes('{best}')) {
    const s = await one("SELECT best FROM scores WHERE game = '2048' AND user_id = :u", { u: userId });
    text = text.replace('{best}', s ? `Ваш рекорд — ${s.best.toLocaleString('ru-RU')}. Побьёте?` : 'Попробуйте собрать 2048!');
  }
  return text;
}

export const reminderKeyboard = {
  inline_keyboard: [
    [{ text: '🎮 Играть', web_app: { url: APP_URL } }],
    [{ text: '🔕 Не напоминать', callback_data: 'rem_off' }],
  ],
};

// Разослать сегодняшние напоминания тем, кому ещё не отправляли.
export async function sendDue() {
  const t = now();
  const today = dayStart(t);
  const due = await many(
    'SELECT user_id FROM subscribers WHERE enabled = 1 AND last_sent < :today ORDER BY last_sent LIMIT :n',
    { today, n: BATCH },
  );
  let sent = 0, blocked = 0, failed = 0;
  for (const { user_id } of due) {
    try {
      await api.sendMessage({ chat_id: user_id, text: await textFor(user_id, t), reply_markup: reminderKeyboard });
      sent++;
    } catch (e) {
      if (e instanceof BotApiError && e.code === 429) break; // упёрлись в лимит — остальных в следующий запуск
      if (e instanceof BotApiError && (e.code === 403 || e.code === 400)) {
        // Пользователь заблокировал бота или чат недоступен — больше не пишем.
        await exec('UPDATE subscribers SET enabled = 0 WHERE user_id = :u', { u: user_id });
        blocked++;
      } else failed++;
      if (!(e instanceof BotApiError) || e.code !== 403) console.warn('reminder', user_id, e && e.description);
    }
    await exec('UPDATE subscribers SET last_sent = :t WHERE user_id = :u', { t, u: user_id });
  }
  const left = await one('SELECT count(*) AS n FROM subscribers WHERE enabled = 1 AND last_sent < :today', { today });
  return { sent, blocked, failed, left: left ? left.n : 0 };
}

// Кнопка «🔕 Не напоминать» в ежедневном напоминании.
import { api } from 'sdk';
import { setSubscription } from '../lib/reminders.js';
import { APP_URL } from '../lib/config.js';

export default async function (query) {
  if (query.data !== 'rem_off') return api.answerCallbackQuery({ callback_query_id: query.id });
  await setSubscription(query.from.id, query.from.first_name, false);
  await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Больше не напоминаем. Включить обратно — /remind' });
  if (query.message) {
    await api.editMessageReplyMarkup({
      chat_id: query.message.chat.id, message_id: query.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: APP_URL } }]] },
    }).catch(() => {});
  }
}

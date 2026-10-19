// Бот: приветствие с кнопкой запуска игры. Ссылка из QR-кода
// t.me/<бот>?start=join_<код> открывает этот чат, а кнопка — сразу комнату.

import { api } from 'sdk';
import { APP_URL } from '../lib/config.js';

export default async function (message) {
  const text = message.text || '';
  const chatId = message.chat.id;
  if (message.chat.type !== 'private') return;

  const join = text.match(/^\/start\s+join_(\d{4,5})/);
  if (join) {
    await api.sendMessage({
      chat_id: chatId,
      text: `Вас зовут в комнату ${join[1]} 🎨\nЖмите кнопку — и сразу в игру.`,
      reply_markup: { inline_keyboard: [[{ text: '✏️ Войти в комнату', web_app: { url: `${APP_URL}?join=${join[1]}` } }]] },
    });
    return;
  }

  await api.setChatMenuButton({
    chat_id: chatId,
    menu_button: { type: 'web_app', text: 'Играть', web_app: { url: APP_URL } },
  });
  await api.sendMessage({
    chat_id: chatId,
    text:
      '<b>Каракули</b> — игры с друзьями прямо в Telegram 🎨\n\n' +
      '🎨 <b>Каракули</b> (2–3 игрока): один рисует слово, остальные угадывают\n' +
      '🕵️ <b>Мафия</b> (4–8 игроков): ведущий — сама игра, ночью мафия охотится, днём город голосует\n' +
      '⚪ <b>Шашки</b> (2 игрока): русские шашки один на один\n' +
      '🏎️ <b>Гонки</b> (2–8 игроков): заезд на три круга\n\n' +
      'Создайте комнату и покажите друзьям QR-код. Есть голосовой чат.',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '🎨 Играть', web_app: { url: APP_URL } }]] },
  });
}

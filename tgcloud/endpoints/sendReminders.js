// Ежедневная рассылка напоминаний. Запускается внешним планировщиком:
//   npx tgcloud run endpoints/sendReminders "{ key: '…' }"
// Без правильного ключа ничего не делает — эндпоинт виден и из Mini App.
import { EndpointError } from 'sdk';
import { REMINDER_KEY } from '../lib/secrets.js';
import { sendDue } from '../lib/reminders.js';

export default async function (input) {
  if (!REMINDER_KEY || input.key !== REMINDER_KEY) throw new EndpointError('Forbidden', { code: 'FORBIDDEN' });
  return sendDue();
}

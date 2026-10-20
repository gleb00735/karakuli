// Mini App: узнать или поменять подписку на ежедневные напоминания.
import { begin } from '../lib/game.js';
import { setSubscription, isSubscribed } from '../lib/reminders.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  if (typeof input.enabled === 'boolean') await setSubscription(user.id, user.name, input.enabled);
  return { enabled: await isSubscribed(user.id) };
}

// Рекорды одиночных игр: отправить результат (score) или получить таблицу.
import { begin } from '../lib/game.js';
import { submitScore, leaderboard } from '../lib/scores.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  if (input.score != null) return submitScore(user, String(input.game), input.score, input.extra);
  return leaderboard(user, String(input.game));
}

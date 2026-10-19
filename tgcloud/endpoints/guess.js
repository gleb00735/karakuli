import { caller, guess, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  const verdict = await guess(user, input.code, input.text);
  return { verdict, ...(await snapshot(user, input.code, input)) };
}

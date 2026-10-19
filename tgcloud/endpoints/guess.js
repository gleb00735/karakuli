import { begin, guess, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  const verdict = await guess(user, input.code, input.text);
  return { verdict, ...(await snapshot(user, input.code, input)) };
}

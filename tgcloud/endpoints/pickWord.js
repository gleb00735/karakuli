import { begin, pickWord, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await pickWord(user, input.code, Number(input.index));
  return snapshot(user, input.code, input);
}

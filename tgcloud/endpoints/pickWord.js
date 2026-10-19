import { caller, pickWord, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  await pickWord(user, input.code, Number(input.index));
  return snapshot(user, input.code, input);
}

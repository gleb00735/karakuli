import { begin, startGame, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await startGame(user, input.code);
  return snapshot(user, input.code, input);
}

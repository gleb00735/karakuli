import { caller, startGame, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  await startGame(user, input.code);
  return snapshot(user, input.code, input);
}

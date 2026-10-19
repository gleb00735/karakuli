import { begin, backToLobby, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await backToLobby(user, input.code);
  return snapshot(user, input.code, input);
}

// Создаёт новую комнату; вызывающий становится её хозяином.
import { begin, createLobby, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  const code = await createLobby(user, input.mode);
  return snapshot(user, code);
}

// Создаёт новую комнату; вызывающий становится её хозяином.
import { caller, createLobby, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  const code = await createLobby(user);
  return snapshot(user, code);
}

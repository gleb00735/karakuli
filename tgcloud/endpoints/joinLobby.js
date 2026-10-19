// Вход в комнату по коду (из QR, ссылки или ручного ввода).
import { begin, joinLobby, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  const lobby = await joinLobby(user, input.code);
  return snapshot(user, lobby.code);
}

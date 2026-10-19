// Вход в комнату по коду (из QR, ссылки или ручного ввода).
import { caller, joinLobby, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  const lobby = await joinLobby(user, input.code);
  return snapshot(user, lobby.code);
}

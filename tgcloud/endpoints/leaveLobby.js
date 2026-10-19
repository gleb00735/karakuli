import { caller, loadLobby, leave } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  const lobby = await loadLobby(input.code);
  if (lobby) await leave(lobby.id, user.id);
  return { ok: true };
}

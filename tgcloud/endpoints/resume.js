// Комната, в которой игрок уже состоит, — чтобы вернуться в игру после
// перезапуска Mini App.
import { begin } from '../lib/game.js';
import { one } from '../lib/sql.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  const row = await one(
    `SELECT l.code AS code FROM players p JOIN lobbies l ON l.id = p.lobby_id
     WHERE p.user_id = :u ORDER BY p.joined_at DESC LIMIT 1`,
    { u: user.id },
  );
  return { code: row ? row.code : null };
}

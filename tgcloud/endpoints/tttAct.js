// Ход в крестиках-ноликах или «сдаюсь».
import { begin, tttAction, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await tttAction(user, input.code, input.kind, input.cell);
  return snapshot(user, input.code, input);
}

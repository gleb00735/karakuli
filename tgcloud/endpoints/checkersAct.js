// Ход в шашках, сдача, предложение и ответ на ничью.
import { begin, checkersAction, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await checkersAction(user, input.code, input.kind, input.path);
  return snapshot(user, input.code, input);
}

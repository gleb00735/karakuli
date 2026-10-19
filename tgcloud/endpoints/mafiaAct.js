// Ход в мафии: ознакомился с ролью, ночное действие, «готов», голос.
import { begin, mafiaAction, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await mafiaAction(user, input.code, input.kind, input.target);
  return snapshot(user, input.code, input);
}

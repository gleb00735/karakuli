import { caller, updateSettings, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = caller(ctx);
  await updateSettings(user, input.code, { rounds: input.rounds, drawTime: input.drawTime });
  return snapshot(user, input.code, input);
}

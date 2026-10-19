import { begin, updateSettings, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await updateSettings(user, input.code, { rounds: input.rounds, drawTime: input.drawTime, mode: input.mode });
  return snapshot(user, input.code, input);
}

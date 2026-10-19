// Текстовый чат комнаты (мафия): днём — всем, ночью — мафии между собой.
import { begin, chat, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await chat(user, input.code, input.text);
  return snapshot(user, input.code, input);
}

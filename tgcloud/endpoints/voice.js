// Подключение к голосовому чату комнаты: 0 — выкл, 1 — микрофон, 2 — только слушать.
import { begin, setVoice, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await setVoice(user, input.code, Number(input.voice));
  return snapshot(user, input.code, input);
}

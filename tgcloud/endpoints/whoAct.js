// «Кто я?»: вопрос, ответ на вопрос, догадка, «сдаюсь».
import { begin, whoAction, snapshot } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  await whoAction(user, input.code, input.kind, { text: input.text, value: input.value });
  return snapshot(user, input.code, input);
}

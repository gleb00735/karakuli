// Основной цикл клиента: отметиться, отправить штрихи (если рисует),
// получить состояние комнаты и всё новое с прошлого раза.
import { begin, enter, pushOps, pushSignals, view, feed } from '../lib/game.js';

export default async function (input, ctx) {
  const user = await begin(ctx);
  const { lobby, players } = await enter(user, input.code);
  if (input.ops) await pushOps(lobby, user, input.ops);
  if (input.signals) await pushSignals(lobby, players, user, input.signals);
  return { state: await view(lobby, players, user.id), ...(await feed(lobby, user.id, input)) };
}

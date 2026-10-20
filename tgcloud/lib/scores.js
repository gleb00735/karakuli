// Таблица рекордов одиночных игр. Результат считает телефон, поэтому
// сервер отсекает заведомо невозможные значения.

import { one, many, exec } from './sql.js';
import { now, fail } from './core.js';

// Проверки правдоподобия по играм. В 2048 очки — сумма всех слияний:
// чтобы собрать плитку 2^k из двоек, нужно набрать (k−1)·2^k очков,
// поэтому счёт не может превышать (k−1)·2^k на каждую такую плитку на поле.
const GAMES = {
  2048: (score, extra) => {
    const k = Math.log2(extra);
    return Number.isInteger(k) && k >= 2 && k <= 17 && score >= 0 && score <= 16 * (k - 1) * extra;
  },
};

export async function submitScore(user, game, score, extra) {
  const check = GAMES[game];
  if (!check) fail('BAD_GAME', 'Нет такой игры');
  const s = Math.floor(Number(score)), e = Math.floor(Number(extra) || 0);
  if (!Number.isFinite(s) || !check(s, e)) fail('BAD_SCORE', 'Результат не похож на настоящий');
  await exec(
    `INSERT INTO scores (game, user_id, name, photo, best, extra, updated_at) VALUES (:g, :u, :n, :p, :s, :e, :t)
     ON CONFLICT (game, user_id) DO UPDATE SET name = :n, photo = :p,
       extra = CASE WHEN :s > scores.best THEN :e ELSE scores.extra END,
       updated_at = CASE WHEN :s > scores.best THEN :t ELSE scores.updated_at END,
       best = MAX(scores.best, :s)`,
    { g: game, u: user.id, n: user.name, p: user.photo, s, e, t: now() },
  );
  return leaderboard(user, game);
}

export async function leaderboard(user, game) {
  if (!GAMES[game]) fail('BAD_GAME', 'Нет такой игры');
  const top = await many(
    'SELECT user_id, name, photo, best, extra FROM scores WHERE game = :g ORDER BY best DESC, updated_at ASC LIMIT 20',
    { g: game },
  );
  const mine = await one('SELECT best, extra FROM scores WHERE game = :g AND user_id = :u', { g: game, u: user.id });
  let rank = null;
  if (mine) {
    const r = await one('SELECT count(*) AS n FROM scores WHERE game = :g AND best > :b', { g: game, b: mine.best });
    rank = (r ? r.n : 0) + 1;
  }
  return {
    top: top.map((r) => ({ id: r.user_id, name: r.name, photo: r.photo, best: r.best, extra: r.extra })),
    me: mine ? { best: mine.best, extra: mine.extra, rank } : null,
  };
}

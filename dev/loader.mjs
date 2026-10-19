// Подменяет импорты `sdk` и `sdk/db` на локальные заглушки.
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  const map = { 'sdk': ${JSON.stringify(new URL('./sdk/index.mjs', import.meta.url).href)},
                'sdk/db': ${JSON.stringify(new URL('./sdk/db.mjs', import.meta.url).href)} };
  export async function resolve(spec, ctx, next) {
    if (map[spec]) return { url: map[spec], shortCircuit: true };
    return next(spec, ctx);
  }
`));

// Тонкая обёртка над сырым SQL платформы: параметры передаются объектом
// { name: value }, а в запрос подставляются как :name.

import { db } from 'sdk';

// Платформа отвергает параметры, которых нет в запросе, поэтому лишние
// ключи отбрасываются.
function bind(query, params) {
  const out = {};
  for (const k in params) {
    if (!new RegExp(':' + k + '\\b').test(query)) continue;
    const v = params[k];
    out[':' + k] = typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v;
  }
  return out;
}

export const one = (query, params = {}) => db.get(query, bind(query, params));
export const many = (query, params = {}) => db.all(query, bind(query, params));
export const exec = (query, params = {}) => db.run(query, bind(query, params));

// Вызов эндпоинтов бэкенда. В Telegram — через официальный
// Telegram.WebApp.Serverless.call (он сам передаёт init data),
// в браузере — напрямую в локальный стенд dev/server.mjs.

import { tg, me } from './tg.js';

export class ApiError extends Error {
  constructor(message, type, code) { super(message); this.type = type; this.code = code; }
}

const offline = (e) => new ApiError('Нет связи с сервером', 'NETWORK', 'NETWORK', e);

export function call(name, input = {}) {
  if (tg && tg.Serverless) {
    return new Promise((resolve, reject) => {
      try {
        tg.Serverless.call(name, input, (err, result) => {
          if (err) {
            const type = err.type || 'NETWORK';
            reject(new ApiError(err.message || 'Ошибка сервера', type, (err.parameters && err.parameters.code) || type));
          } else resolve(result);
        });
      } catch (e) { reject(offline(e)); }
    });
  }
  return fetch('/api/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(me)) },
    body: JSON.stringify(input),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (body.ok) return body.result;
    throw new ApiError(body.description || 'Ошибка сервера', body.error_type, (body.parameters && body.parameters.code) || body.error_type);
  }, (e) => { throw offline(e); });
}

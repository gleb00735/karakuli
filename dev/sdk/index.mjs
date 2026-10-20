// Локальная замена `sdk`.
export { db } from './db.mjs';

export class EndpointError extends Error {
  constructor(description, parameters = {}) { super(description); this.description = description; this.parameters = parameters; }
}

export class BotApiError extends Error {
  constructor(code, description) { super(description); this.code = code; this.description = description; }
}

// Отправленные сообщения копятся в api.sent (для тестов). Чат 403 «заблокировал бота».
const sent = [];
export const api = new Proxy({}, {
  get: (_, method) => {
    if (method === 'sent') return sent;
    return async (params) => {
      if (process.env.LOG_API) console.log('[api]', method, JSON.stringify(params));
      if (params && params.chat_id === 403) throw new BotApiError(403, 'Forbidden: bot was blocked by the user');
      sent.push({ method, params });
      return true;
    };
  },
});

export const fetch = globalThis.fetch;

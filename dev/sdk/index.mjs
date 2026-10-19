// Локальная замена `sdk`.
export { db } from './db.mjs';

export class EndpointError extends Error {
  constructor(description, parameters = {}) { super(description); this.description = description; this.parameters = parameters; }
}

export const api = new Proxy({}, {
  get: (_, method) => async (params) => { console.log('[api]', method, JSON.stringify(params)); return true; },
});

export const fetch = globalThis.fetch;

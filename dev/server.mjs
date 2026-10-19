// Локальный стенд: раздаёт web/ и исполняет tgcloud/endpoints/* так же,
// как платформа (POST /api/<имя>). Пользователь задаётся заголовком X-Dev-User.
//   node --import ./dev/loader.mjs dev/server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { applySchema } from './sdk/db.mjs';
import { EndpointError } from './sdk/index.mjs';

const root = new URL('..', import.meta.url).pathname;
const web = join(root, 'web');
const port = Number(process.env.PORT || 5173);

applySchema(await import(join(root, 'tgcloud/schema.js')));

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return send(res, 404, { ok: false });
    let body = '';
    for await (const c of req) body += c;
    const user = JSON.parse(decodeURIComponent(req.headers['x-dev-user'] || 'null'));
    if (process.env.LOG) console.log(name, user && user.id, body.slice(0, 120));
    if (!user) return send(res, 401, { ok: false, error_type: 'UNAUTHORIZED', description: 'no user' });
    try {
      const mod = await import(join(root, 'tgcloud/endpoints', name + '.js'));
      const result = await mod.default(JSON.parse(body || '{}'), { initData: { user } });
      return send(res, 200, { ok: true, result });
    } catch (e) {
      if (e instanceof EndpointError) return send(res, 400, { ok: false, error_type: 'ENDPOINT_ERROR', description: e.description, parameters: e.parameters });
      console.error(e);
      return send(res, 500, { ok: false, error_type: 'INTERNAL', description: 'Internal error' });
    }
  }
  const path = normalize(join(web, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(web)) return send(res, 403, 'no', 'text/plain');
  try {
    send(res, 200, await readFile(path), types[extname(path)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain');
  }
}).listen(port, () => console.log(`dev server http://localhost:${port}`));

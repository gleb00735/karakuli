// ICE-серверы для голосового чата. Короткоживущие данные TURN выдаются
// по секретному ключу, который остаётся на сервере.
import { fetch } from 'sdk';
import { begin } from '../lib/game.js';
import { CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN, STATIC_TURN } from '../lib/secrets.js';

const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Порт 53 браузеры блокируют; без trickle ICE такой адрес только тормозит сбор кандидатов.
const dropPort53 = (servers) => servers.map((s) => ({
  ...s,
  urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
})).filter((s) => s.urls.length);

export default async function (input, ctx) {
  await begin(ctx);
  let turn = STATIC_TURN.slice();
  if (CLOUDFLARE_TURN_KEY_ID && CLOUDFLARE_TURN_API_TOKEN) {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CLOUDFLARE_TURN_API_TOKEN}` },
        body: fetch.body.json({ ttl: 6 * 3600 }),
      });
      if (res.ok) turn = turn.concat((await res.json()).iceServers.filter((s) => s.username));
      else console.warn('cloudflare turn', res.status, await res.text());
    } catch (e) {
      console.warn('cloudflare turn', e);
    }
  }
  return { iceServers: dropPort53(STUN.concat(turn)), turn: turn.length > 0 };
}

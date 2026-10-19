// Голосовой чат: два игрока с фейковым микрофоном Chromium слышат друг друга,
// третий подключается без микрофона и только слушает.
//   node dev/e2e-voice.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const withMic = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
const noMic = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--deny-permission-prompts'] });

async function player(browser, uid, name, grant) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU', permissions: grant ? ['microphone'] : [] });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?uid=${uid}&name=${encodeURIComponent(name)}`);
  return page;
}

const A = await player(withMic, 601, 'Аня', true);
const B = await player(withMic, 602, 'Борис', true);
const C = await player(noMic, 603, 'Вика', false);
await A.click('text=Создать комнату');
await A.waitForSelector('.qr-card');
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
for (const [p, uid] of [[B, 602], [C, 603]]) { await p.goto(`${BASE}/?uid=${uid}&join=${code}`); await p.waitForSelector('.qr-card'); }
await wait(1000);

for (const p of [A, B, C]) await p.click('.voice-card >> text=Войти');
const t0 = Date.now();
const peers = (p) => p.evaluate(() => [...window.__voice.peers.values()].map((x) => x.pc.connectionState));
for (let i = 0; i < 40; i++) {
  const [a, b, c] = await Promise.all([peers(A), peers(B), peers(C)]);
  if (a.length === 2 && b.length === 2 && c.length === 2 && [...a, ...b, ...c].every((x) => x === 'connected')) break;
  await wait(500);
}
console.log('connected in', ((Date.now() - t0) / 1000).toFixed(1), 's', await peers(A), await peers(B), await peers(C));
console.log('modes', await Promise.all([A, B, C].map((p) => p.evaluate(() => window.__voice.mode))));

// Уровень входящего звука от Ани у Бориса и у Вики (фейковый микрофон пищит).
const level = (p, from) => p.evaluate(async (id) => {
  const peer = window.__voice.peers.get(id);
  const stats = await peer.pc.getStats();
  let bytes = 0;
  stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') bytes = r.bytesReceived; });
  return bytes;
}, from);
await wait(2000);
console.log('bytes A→B', await level(B, 601), 'A→C', await level(C, 601), 'C→A', await level(A, 603));
await A.screenshot({ path: `${OUT}/v1-lobby-voice.png` });
await C.screenshot({ path: `${OUT}/v2-listen-only.png` });

// Mute.
await A.click('.topbar .voice-btn');
console.log('A muted', await A.evaluate(() => window.__voice.muted), await A.locator('.topbar .voice-btn').getAttribute('class'));

// Голос переживает старт партии и смену экранов.
await A.click('text=Начать игру');
await wait(2500);
await A.screenshot({ path: `${OUT}/v3-game-voice.png` });
console.log('in game peers', await peers(A), await peers(B));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await withMic.close(); await noMic.close();

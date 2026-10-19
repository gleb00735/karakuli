// Присутствие: закрытое приложение → «не в сети» → выбыл; прерванная партия.
//   node dev/e2e-presence.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(uid, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?uid=${uid}&name=${encodeURIComponent(name)}`);
  return { page, ctx };
}

const A = await player(501, 'Аня');
const B = await player(502, 'Борис');
const C = await player(503, 'Вика');
await A.page.click('text=Создать комнату');
await A.page.click('.game-card.draw');
await A.page.waitForSelector('.qr-card');
const code = (await A.page.locator('.room-code').innerText()).replace(/\D/g, '');
for (const p of [B, C]) { await p.page.goto(`${BASE}/?uid=${p === B ? 502 : 503}&join=${code}`); await p.page.waitForSelector('.qr-card'); }
await wait(1500);

// У Вики пропала связь (или Telegram убил приложение, не дав отправить выход).
await C.ctx.route('**/api/**', (r) => r.abort());
const t0 = Date.now();
await A.page.waitForSelector('.seat.away', { timeout: 20000 });
console.log('away shown after', Math.round((Date.now() - t0) / 1000), 's');
await A.page.screenshot({ path: `${OUT}/p1-away.png` });
await A.page.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 2, null, { timeout: 40000 });
console.log('removed after', Math.round((Date.now() - t0) / 1000), 's');
await wait(300);
await A.page.screenshot({ path: `${OUT}/p2-left.png` });

// Вика вернулась, а затем закрыла приложение штатно — выходит сразу.
await C.ctx.unroute('**/api/**');
await C.page.goto(`${BASE}/?uid=503&join=${code}`);
await C.page.waitForSelector('.qr-card');
await A.page.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 3, null, { timeout: 10000 });
const t2 = Date.now();
await C.page.close({ runBeforeUnload: true });
await A.page.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 2, null, { timeout: 10000 });
console.log('closed app removed after', ((Date.now() - t2) / 1000).toFixed(1), 's');

// Партия вдвоём, Борис пропадает — игра прерывается.
await A.page.click('text=Начать игру');
await A.page.waitForSelector('.overlay');
await B.ctx.route('**/api/**', (r) => r.abort());
const t1 = Date.now();
await A.page.waitForSelector('.notice', { timeout: 45000 });
console.log('abort after', Math.round((Date.now() - t1) / 1000), 's');
await wait(500);
await A.page.screenshot({ path: `${OUT}/p3-aborted.png` });

// Борис вернулся.
await B.ctx.unroute('**/api/**');
await B.page.waitForSelector('.notice', { timeout: 15000 });
await wait(1500);
await A.page.screenshot({ path: `${OUT}/p4-back.png` });
console.log('seats', await A.page.locator('.seat .st').allInnerTexts());
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

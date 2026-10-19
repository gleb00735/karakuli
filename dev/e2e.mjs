// Сквозной тест в браузере: три игрока проходят партию.
//   node dev/e2e.mjs  (стенд должен быть запущен на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function player(uid, name, dark = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, colorScheme: dark ? 'dark' : 'light', locale: 'ru-RU' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${BASE}/?uid=${uid}&name=${encodeURIComponent(name)}`);
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('unhandledRejection', async (e) => { console.log('FAILED:', e.message.split('\n')[0]); console.log(errors.join('\n')); for (const [i, pg] of (globalThis.__pages || []).entries()) await pg.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => {}); process.exit(1); });
const A = await player(101, 'Аня');
const B = await player(202, 'Борис', true);
const C = await player(303, 'Вика');
globalThis.__pages = [A, B, C];
await A.waitForSelector('.home-actions');
await wait(1500);
await shot(A, '01-home');
await shot(B, '01-home-dark');

await A.click('text=Создать комнату');
await A.click('.game-card.draw');
await A.waitForSelector('.qr-card').catch(async (e) => { await shot(A, 'fail-A'); console.log(errors.join('\n')); console.log(await A.evaluate(() => document.getElementById('app').innerHTML.slice(0, 300))); throw e; });
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
console.log('room', code);
await shot(A, '02-lobby-host-alone');

await B.click('text=Ввести код');
await B.waitForSelector('.code-boxes input');
await wait(300);
await shot(B, '03-code-sheet');
await B.locator('.code-boxes input').fill(code);
await B.waitForSelector('.qr-card');
await C.goto(`${BASE}/?uid=303&name=Вика&join=${code}`);
await C.waitForSelector('.qr-card');
await wait(2000);
await shot(A, '04-lobby-host-3');
await shot(B, '04-lobby-guest-dark');

await A.click('.seg >> nth=0 >> text=1');
await wait(500);
await A.click('text=Начать игру');
await wait(1500);
const pages = { 101: A, 202: B, 303: C };
const names = { 101: 'A', 202: 'B', 303: 'C' };

async function drawerOf() {
  for (const [id, p] of Object.entries(pages)) if (await p.locator('.choice').count()) return [Number(id), p];
  return [null, null];
}

for (let turn = 0; turn < 3; turn++) {
  let id, D;
  for (let i = 0; i < 20 && !D; i++) { [id, D] = await drawerOf(); if (!D) await wait(500); }
  if (!D) throw new Error('no drawer on turn ' + turn);
  console.log('turn', turn, 'drawer', names[id]);
  const others = Object.entries(pages).filter(([k]) => Number(k) !== id).map(([, p]) => p);
  if (turn === 0) { await shot(D, '05-pick-drawer'); await shot(others[0], '05-pick-wait'); }
  await D.locator('.choice').nth(turn % 3).click();
  await D.waitForSelector('.tools');
  const word = await D.locator('.word-show b').innerText();
  console.log(' word', word);
  // Рисуем: круг и линии пальцем.
  const box = await D.locator('.board canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await D.mouse.move(cx + 80, cy);
  await D.mouse.down();
  for (let a = 0; a <= 64; a++) await D.mouse.move(cx + 80 * Math.cos(a / 10), cy + 80 * Math.sin(a / 10), { steps: 1 });
  await D.mouse.up();
  await D.locator('.swatch').nth(1).click();
  await D.locator('.sizes button').nth(2).click();
  await D.mouse.move(cx - 100, cy + 110); await D.mouse.down();
  for (let x = 0; x <= 200; x += 8) await D.mouse.move(cx - 100 + x, cy + 110 + Math.sin(x / 20) * 15);
  await D.mouse.up();
  await D.locator('.swatch').nth(6).click();
  await D.locator('.sizes button').nth(0).click();
  await D.mouse.move(cx - 30, cy - 20); await D.mouse.down(); await D.mouse.up();
  await D.mouse.move(cx + 30, cy - 20); await D.mouse.down(); await D.mouse.up();
  await wait(2500);
  // Первый угадывающий ошибается, потом опечатка, потом угадывает.
  const [g1, g2] = others;
  await g1.fill('.guess-bar input', 'абракадабра'); await g1.press('.guess-bar input', 'Enter');
  await wait(400);
  if (word.length > 4) {
    await g1.fill('.guess-bar input', word.slice(0, -1) + 'ъ'); await g1.press('.guess-bar input', 'Enter');
    await wait(600);
  }
  if (turn === 0) { await shot(D, '06-draw-drawer'); await shot(g1, '06-draw-guesser'); await shot(g2, '06-draw-guesser-2'); }
  await g1.fill('.guess-bar input', word); await g1.press('.guess-bar input', 'Enter');
  await wait(1200);
  if (turn === 0) { await shot(g1, '07-guessed'); await shot(D, '07-drawer-feed'); }
  await g2.fill('.guess-bar input', word.toUpperCase()); await g2.press('.guess-bar input', 'Enter');
  await D.waitForSelector('.reveal-word', { timeout: 5000 });
  await wait(900);
  if (turn === 0) { await shot(g2, '08-reveal'); await shot(B, '08-reveal-dark'); }
  await wait(5500);
}
await A.waitForSelector('.podium', { timeout: 15000 });
await wait(400);
await shot(A, '09-final-host');
await wait(3200);
await shot(B, '09-final-dark');
await shot(C, '09-final-guest');
console.log('scores', await A.locator('.col-bar span').allInnerTexts());
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

// 2048 в браузере: свайпы, отмена хода, сохранение партии, конец игры и рекорды.
//   node dev/e2e-2048.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU' });
await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE}/?uid=1201&name=${encodeURIComponent('Аня')}`);
await page.waitForSelector('.solo-card');
await page.screenshot({ path: `${OUT}/g0-home.png` });
await page.click('.solo-card');
await page.waitForSelector('.g-board');

// Свайп мышью/пальцем по полю.
const box = await page.locator('.g-board').boundingBox();
async function swipe(dx, dy) {
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up();
  await wait(260);
}
await swipe(-120, 0); await swipe(0, 120); await swipe(120, 0); await swipe(0, -120);
// Дальше стрелками: стратегия «угол» — влево/вниз, иногда вправо.
const keys = ['ArrowLeft', 'ArrowDown'];
for (let i = 0; i < 160; i++) {
  await page.keyboard.press(keys[i % 2]);
  await wait(30);
  if (i % 7 === 6) { await page.keyboard.press('ArrowRight'); await wait(30); }
  if (await page.locator('.overlay').count()) break;
}
await wait(400);
const g = await page.evaluate(() => ({ score: window.__g2048.score, tiles: window.__g2048.tiles.length, over: window.__g2048.over, max: Math.max(...window.__g2048.tiles.map((t) => t.v)) }));
console.log('state', JSON.stringify(g));
await page.screenshot({ path: `${OUT}/g1-playing.png` });

// Отмена хода и сохранение после перезагрузки.
if (!g.over) {
  const before = await page.evaluate(() => window.__g2048.score);
  await page.keyboard.press('ArrowRight'); await wait(300);
  await page.click('text=Отменить ход'); await wait(200);
  const after = await page.evaluate(() => window.__g2048.score);
  console.log('undo restores score', before === after);
  await page.reload();
  await page.waitForSelector('.solo-card');
  await page.click('.solo-card');
  await page.waitForSelector('.g-tile');
  console.log('saved game restored', (await page.evaluate(() => window.__g2048.score)) === after);
}

// Конец игры: результат уходит в таблицу.
await page.evaluate(() => { window.__g2048.over = true; return window.__g2048.showEnd(false); });
await page.waitForFunction(() => /место/.test(document.querySelector('.overlay').textContent), null, { timeout: 8000 });
await wait(300);
await page.screenshot({ path: `${OUT}/g2-over.png` });
await page.click('text=🏆 Таблица рекордов');
await page.waitForSelector('.sheet .gain');
await wait(400);
await page.screenshot({ path: `${OUT}/g3-top.png` });
console.log('top rows', await page.locator('.sheet .gain').count());
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

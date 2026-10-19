// Шашки в браузере: двое делают ходы кликами по доске до первого взятия,
// предлагают ничью, затем один сдаётся и хозяин запускает реванш.
//   node dev/e2e-checkers.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(uid, name, dark) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU', colorScheme: dark ? 'dark' : 'light' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?uid=${uid}&name=${encodeURIComponent(name)}`);
  page.uid = uid;
  return page;
}
const A = await player(801, 'Аня', false);
const B = await player(802, 'Борис', true);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const st = (p) => p.evaluate(() => window.__voice.state);

await A.click('text=Создать комнату');
await A.click('.game-card.checkers');
await A.waitForSelector('.qr-card');
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
await B.goto(`${BASE}/?uid=802&name=${encodeURIComponent('Борис')}&join=${code}`);
await B.waitForSelector('.qr-card');
await wait(1600);
await A.evaluate(() => document.querySelector('.settings').scrollIntoView());
await shot(A, 'c0-lobby');
await A.click('text=Начать игру');
await A.waitForSelector('.ck-board');
await B.waitForSelector('.ck-board');
await wait(800);

// Клик по полю доски i с учётом переворота у чёрных.
async function clickSq(p, i) {
  const s = await st(p);
  const d = s.checkers.myColor === 'b' ? 63 - i : i;
  await p.locator('.ck-sq').nth(d).click();
}
async function play(p, path) { for (const i of path) { await clickSq(p, i); await wait(120); } }

let captures = 0, ply = 0, shotSel = false;
while (ply < 40 && captures < 2) {
  // Ждём, пока у игрока, чей ход, придёт список его ходов.
  let me, s;
  for (let k = 0; k < 40; k++) {
    const [sa, sb] = [await st(A), await st(B)];
    if (sa.checkers.moves) { me = A; s = sa; break; }
    if (sb.checkers.moves) { me = B; s = sb; break; }
    await wait(150);
  }
  if (!s || s.phase !== 'c_play') break;
  const moves = s.checkers.moves;
  // Предпочитаем ходы, которые не подставляют под бой сразу, — просто берём середину списка.
  const mv = s.checkers.mustCapture ? moves[0] : moves[Math.floor(moves.length / 2)];
  if (s.checkers.mustCapture) {
    captures++;
    if (captures === 1) { await shot(me, 'c2-must-capture'); }
  }
  if (!shotSel && ply === 2) {
    await clickSq(me, mv[0]);
    await wait(300);
    await shot(me, 'c1-selected');
    shotSel = true;
    await play(me, mv.slice(1));
  } else await play(me, mv);
  ply++;
  await me.waitForFunction(() => !window.__voice.state.checkers.moves, null, { timeout: 8000 });
  await wait(500);
}
console.log('plies', ply, 'captures', captures);
await shot(A, 'c3-board-white');
await shot(B, 'c3-board-black');

// Ничья: предложение и отказ.
await A.click('text=🤝 Ничья');
await B.waitForSelector('.ck-offer');
await wait(400);
await shot(B, 'c4-draw-offer');
await B.click('text=Играть дальше');
await wait(1500);

// Борис сдаётся.
B.on('dialog', (d) => d.accept());
await B.click('text=🏳️ Сдаться');
await A.waitForFunction(() => window.__voice.state.phase === 'final', null, { timeout: 8000 });
await wait(1500);
await shot(A, 'c5-final-win');
await shot(B, 'c5-final-lose');
const before = (await st(A)).checkers.white;
await A.click('.overlay .btn.ghost');
await A.click('text=Реванш');
await A.waitForFunction(() => window.__voice.state.phase === 'c_play', null, { timeout: 8000 });
const after = (await st(A)).checkers.white;
console.log('colors swapped', before !== after);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

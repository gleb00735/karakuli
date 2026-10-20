// Крестики-нолики в браузере: партия 3×3 до победы, реванш на 10×10.
//   node dev/e2e-ttt.mjs  (стенд на :5173)
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
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/?uid=${uid}&name=${encodeURIComponent(name)}`);
  page.uid = uid;
  return page;
}
const A = await player(1101, 'Аня', false);
const B = await player(1102, 'Борис', true);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const st = (p) => p.evaluate(() => window.__voice.state);

await A.click('text=Создать комнату');
await A.click('.game-card.ttt');
await A.waitForSelector('.qr-card');
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
await B.goto(`${BASE}/?uid=1102&name=${encodeURIComponent('Борис')}&join=${code}`);
await B.waitForSelector('.qr-card');
await wait(1500);
await A.click('text=Начать игру');
await A.waitForSelector('.tt-board');
await B.waitForSelector('.tt-board');

async function play(cells) {
  for (const c of cells) {
    let mover;
    for (let k = 0; k < 40 && !mover; k++) {
      const [sa, sb] = [await st(A), await st(B)];
      if (sa.ttt && sa.phase === 't_play' && sa.ttt.turn === sa.ttt.myMark) mover = A;
      else if (sb.ttt && sb.phase === 't_play' && sb.ttt.turn === sb.ttt.myMark) mover = B;
      else await wait(150);
    }
    await mover.locator('.tt-cell').nth(c).click();
    await mover.waitForFunction(() => window.__voice.state.ttt.turn !== window.__voice.state.ttt.myMark || window.__voice.state.phase !== 't_play', null, { timeout: 8000 });
  }
}
// x: 0, 4, 8 — диагональ; o: 1, 2.
await play([0, 1, 4]);
await wait(600);
await shot(A, 't1-mid');
await shot(B, 't1-mid-dark');
await play([2, 8]);
await A.waitForFunction(() => window.__voice.state.phase === 'final', null, { timeout: 8000 });
await wait(500);
await shot(A, 't2-winline');
await wait(1200);
await shot(A, 't3-final');
await shot(B, 't3-final-dark');

// Реванш на 10×10.
await A.click('.overlay .btn.ghost');
await A.click('text=В лобби');
await A.waitForSelector('.qr-card');
await A.click('.seg button:has-text("10×10")');
await wait(800);
await A.click('text=Начать игру');
await A.waitForSelector('.tt-board.big');
await play([44, 45, 54, 55, 64, 65]);
await wait(700);
await shot(A, 't4-big');
const s = await st(A);
console.log('size', s.ttt.size, 'score', JSON.stringify(s.ttt.score), 'x is', s.ttt.x === 1101 ? 'Аня' : 'Борис');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

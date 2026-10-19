// «Кто я?» в браузере: трое задают вопросы, отвечают, угадывают и сдаются.
//   node dev/e2e-who.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['Аня', 'Борис', 'Вика'];

async function player(i) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU', colorScheme: i === 1 ? 'dark' : 'light' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${NAMES[i]}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/?uid=${1001 + i}&name=${encodeURIComponent(NAMES[i])}`);
  page.uid = 1001 + i;
  return page;
}
const P = [await player(0), await player(1), await player(2)];
const [A] = P;
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const st = (p) => p.evaluate(() => window.__voice.state);
const byUid = (u) => P.find((p) => p.uid === u);

await A.click('text=Создать комнату');
await A.click('.game-card.who');
await A.waitForSelector('.qr-card');
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
for (const p of P.slice(1)) { await p.goto(`${BASE}/?uid=${p.uid}&name=${encodeURIComponent(NAMES[p.uid - 1001])}&join=${code}`); await p.waitForSelector('.qr-card'); }
await wait(1500);
await A.click('.gg:has-text("Животные")');
await wait(800);
await A.evaluate(() => document.querySelector('.settings').scrollIntoView());
await shot(A, 'w0-lobby');
await A.click('text=Начать игру');
for (const p of P) await p.waitForSelector('.wh-me');
await wait(1000);

let s = await st(A);
let asker = byUid(s.who.asker);
const others = () => P.filter((p) => p !== asker);
await shot(asker, 'w1-my-turn');
await shot(others()[0], 'w1-watching');

// Вопрос → «да» большинством → спрашивает ещё.
await asker.fill('.guess-bar input', 'Я умею летать?');
await asker.press('.guess-bar input', 'Enter');
for (const p of others()) { await p.waitForSelector('.wh-answer'); await p.click('.wh-answer button:has-text("Да")'); }
await wait(600);
await shot(others()[0], 'w2-answered');
await asker.waitForFunction(() => !window.__voice.state.who.q, null, { timeout: 8000 });
// Вопрос голосом → «нет» → ход переходит.
await asker.click('text=🎙 Спросил голосом');
for (const p of others()) { await p.waitForSelector('.wh-answer'); await p.click('.wh-answer button:has-text("Нет")'); }
await A.waitForFunction((u) => window.__voice.state.who.asker !== u, asker.uid, { timeout: 8000 });
s = await st(A);
asker = byUid(s.who.asker);
// Угадывает правильно — имя подсмотрим у соседа.
const name = (await st(others()[0])).who.chars.find(([id]) => id === asker.uid)[1];
await asker.click('text=💡 Я знаю!');
await asker.fill('.wh-guess', name.toUpperCase());
await asker.click('text=Это я!');
await wait(1200);
await shot(asker, 'w3-guessed');
s = await st(A);
asker = byUid(s.who.asker);
await asker.click('.m-bottom button:has-text("🏳️")');
await A.waitForFunction(() => window.__voice.state.phase === 'final', null, { timeout: 8000 });
await wait(800);
await shot(A, 'w4-final');
const fin = await st(A);
console.log('done', JSON.stringify(fin.who.done));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

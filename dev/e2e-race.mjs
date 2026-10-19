// Гонки в браузере: трое на автопилоте проезжают 3 круга.
//   node dev/e2e-race.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
const TRACK = process.env.TRACK || 'canyon';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['Аня', 'Борис', 'Вика'];

async function player(i) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${NAMES[i]}: ${e.message}`));
  await page.goto(`${BASE}/?uid=${901 + i}&name=${encodeURIComponent(NAMES[i])}`);
  page.uid = 901 + i;
  return page;
}
const P = [await player(0), await player(1), await player(2)];
const [A] = P;
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

await A.click('text=Создать комнату');
await A.click('.game-card.race');
await A.waitForSelector('.qr-card');
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
for (const p of P.slice(1)) { await p.goto(`${BASE}/?uid=${p.uid}&name=${encodeURIComponent(NAMES[p.uid - 901])}&join=${code}`); await p.waitForSelector('.qr-card'); }
await wait(1500);
await A.click(`.seg button:has-text("${{ ring: 'Кольцо', canyon: 'Каньон', city: 'Город' }[TRACK]}")`);
await wait(800);
await A.evaluate(() => document.querySelector('.settings').scrollIntoView());
await shot(A, 'r0-lobby');
await A.click('text=Начать игру');
await A.waitForSelector('.rc-canvas');
await wait(1200);
await shot(A, 'r1-countdown');

// Автопилот: держит курс на точку трассы чуть впереди. Разные «водители» — разная точность.
for (const [k, p] of P.entries()) {
  await p.evaluate((skill) => {
    setInterval(() => {
      const r = window.__race;
      if (!r || !r.car || !r.track) return;
      const c = r.car, tr = r.track, n = tr.pts.length;
      const [tx, ty] = tr.pts[(c.idx + 9) % n];
      let d = Math.atan2(ty - c.y, tx - c.x) - c.a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      r.steer.left = d < -0.06 * skill;
      r.steer.right = d > 0.06 * skill;
    }, 30);
  }, 1 + k * 0.6);
}
await A.waitForFunction(() => window.__voice.state.phase === 'r_race', null, { timeout: 10000 });
await wait(6000);
await shot(A, 'r2-racing');
await shot(P[2], 'r2-racing-3');
const lap = await A.evaluate(() => window.__race.car.lap + ':' + Math.round(window.__race.car.s) + '/' + Math.round(window.__race.track.length));
console.log('after 6s', lap);
await A.waitForFunction(() => window.__voice.state.phase === 'final', null, { timeout: 200000, polling: 1000 });
await wait(1200);
await shot(A, 'r3-final');
const res = await A.evaluate(() => window.__voice.state.race.results);
console.log('results', JSON.stringify(res));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

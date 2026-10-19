// Мафия в браузере: пятеро играют партию до победы одной из сторон.
//   node dev/e2e-mafia.mjs  (стенд на :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['Аня', 'Борис', 'Вика', 'Гоша', 'Даша'];

async function player(i, dark) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ru-RU', colorScheme: dark ? 'dark' : 'light' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${NAMES[i]}: ${e.message}`));
  await page.goto(`${BASE}/?uid=${701 + i}&name=${encodeURIComponent(NAMES[i])}`);
  page.uid = 701 + i;
  return page;
}
const P = [];
for (let i = 0; i < 5; i++) P.push(await player(i, i === 1));
const [A] = P;
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const st = (p) => p.evaluate(() => window.__voice.state);

await A.waitForSelector('.home-actions');
await A.click('text=Создать комнату');
await wait(400);
await shot(A, 'm0-pick-game');
await A.click('.game-card.mafia');
await A.waitForSelector('.qr-card');
const code = (await A.locator('.room-code').innerText()).replace(/\D/g, '');
for (const p of P.slice(1)) { await p.goto(`${BASE}/?uid=${p.uid}&name=${encodeURIComponent(NAMES[p.uid - 701])}&join=${code}`); await p.waitForSelector('.qr-card'); }
await wait(1800);
await A.evaluate(() => document.querySelector('.settings').scrollIntoView());
await shot(A, 'm1-lobby');
await A.click('text=Начать игру');
await A.waitForSelector('.role-card');
await wait(600);
await shot(A, 'm2-role-back');
await A.click('.role-card');
await wait(900);
await shot(A, 'm3-role-open');

const roles = {};
for (const p of P) roles[p.uid] = (await st(p)).mafia.role;
console.log('roles', JSON.stringify(Object.fromEntries(Object.entries(roles).map(([u, r]) => [NAMES[u - 701], r]))));
const pageOf = (r) => P.find((p) => roles[p.uid] === r);
for (const p of P) await p.click('.m-overlay .btn.violet');
await A.waitForSelector('.mafia.night');
await wait(800);

const card = (p, uid) => p.locator('.mp').nth(P.findIndex((x) => x.uid === uid));
const maf = pageOf('mafia'), com = pageOf('com'), doc = pageOf('doc');
const civs = P.filter((p) => roles[p.uid] === 'civ');
let round = 0;
while (true) {
  round++;
  const s = await st(A);
  if (s.phase === 'final') break;
  const alive = s.mafia.alive;
  const victim = civs.find((p) => alive.includes(p.uid)) || [com, doc].find((p) => alive.includes(p.uid));
  // Ночь: мафия бьёт мирного, комиссар проверяет мафию, доктор лечит себя.
  if (alive.includes(maf.uid)) await card(maf, victim.uid).click();
  if (alive.includes(com.uid)) await card(com, maf.uid).click();
  if (alive.includes(doc.uid)) await card(doc, round === 1 ? doc.uid : com.uid).click();
  if (round === 1) { await wait(700); await shot(maf, 'm4-night-mafia'); await shot(civs[0], 'm4-night-civ'); }
  await A.waitForSelector('.m-overlay', { timeout: 15000 });
  await wait(900);
  if (round === 1) await shot(A, 'm5-morning');
  await A.waitForFunction(() => window.__voice.state.phase === 'm_day', null, { timeout: 15000 });
  const s2 = await st(A);
  if (s2.phase === 'final') break;
  const speaker = P.find((p) => s2.mafia.alive.includes(p.uid));
  await speaker.fill('.m-bottom input', 'Я подозреваю, что мафия среди нас 🤔');
  await speaker.press('.m-bottom input', 'Enter');
  for (const p of P) if (s2.mafia.alive.includes(p.uid)) await p.click('.m-bottom .btn.mint');
  await A.waitForFunction(() => window.__voice.state.phase === 'm_vote', null, { timeout: 15000 });
  await wait(500);
  if (round === 1) await shot(com, 'm6-day');
  // Голосование: на первом круге мирные голосуют вразнобой, на втором — против мафии.
  const s3 = await st(A);
  for (const p of P) {
    if (!s3.mafia.alive.includes(p.uid)) continue;
    const others = s3.mafia.alive.filter((u) => u !== p.uid);
    const target = round >= 2 && p !== maf ? maf.uid : others[(others.indexOf(p.uid) + 1 + P.indexOf(p)) % others.length];
    await card(p, target).click();
  }
  await wait(400);
  if (round === 2) await shot(A, 'm7-vote');
  await A.waitForFunction(() => ['m_verdict', 'final'].includes(window.__voice.state.phase), null, { timeout: 15000 });
  await wait(900);
  if (round === 1) await shot(A, 'm8-verdict');
  await A.waitForFunction(() => ['m_night', 'final'].includes(window.__voice.state.phase), null, { timeout: 15000 });
  if (round > 4) break;
}
await A.waitForSelector('.final-ov', { timeout: 15000 });
await wait(800);
await shot(A, 'm9-final');
const fin = await st(A);
console.log('winner', fin.mafia.winner, 'rounds', round);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

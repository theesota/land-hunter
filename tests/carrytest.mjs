// 別ボードで貯めた端末が招待リンクを開いたら、手元の地点が消えずに移るか
import { chromium } from 'playwright';
const fails = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
async function open(ctx, url) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町' } }) }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 })));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
  return page;
}
async function addSpot(page, x, y, name) {
  await page.mouse.click(x, y);
  await page.waitForSelector('#confirm-bar:not([hidden])');
  await page.click('#btn-confirm-add');
  await page.waitForSelector('#sheet-spot:not([hidden])');
  await page.fill('#spot-name', name);
  await page.click('#spot-form button[type=submit]');
  await page.waitForSelector('#sheet-spot', { state: 'hidden' });
}
const names = (page) => page.$$eval('#spot-list li .spot-name', (els) => els.map((e) => e.textContent));

// スマホ: 自分のボードに1件
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 780 } });
const phone = await open(phoneCtx, 'http://localhost:8776/index.html?emu=1');
await phone.click('#btn-board-new');
await addSpot(phone, 180, 380, 'スマホの土地');
const invite = await phone.evaluate(() => location.href);

// PC: 別ボードに2件貯めてから、スマホの招待リンクをそのまま開く
const pcCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const pc = await open(pcCtx, 'http://localhost:8776/index.html?emu=1');
await pc.click('#btn-board-new');
await addSpot(pc, 500, 400, 'PCの土地1');
await addSpot(pc, 560, 460, 'PCの土地2');
await pc.goto(invite, { waitUntil: 'domcontentloaded' });
await pc.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
await pc.waitForTimeout(3000);
await pc.click('#btn-list');
const pcNames = await names(pc);
console.log('PC(招待リンクで開いた後):', pcNames);
for (const n of ['スマホの土地', 'PCの土地1', 'PCの土地2']) if (!pcNames.includes(n)) fails.push('PCで見えない: ' + n);

await phone.waitForTimeout(2000);
await phone.click('#btn-list');
const phNames = await names(phone);
console.log('スマホ:', phNames);
for (const n of ['PCの土地1', 'PCの土地2']) if (!phNames.includes(n)) fails.push('スマホに届かない: ' + n);

// 2回目以降のリロードで増殖しない
await pc.reload({ waitUntil: 'domcontentloaded' });
await pc.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
await pc.waitForTimeout(2000);
await pc.click('#btn-list');
const again = await names(pc);
if (again.length !== 3) fails.push('リロードで件数が変わった: ' + again.length);

await browser.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

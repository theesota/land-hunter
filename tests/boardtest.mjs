// ボードIDの取り違え対策: URLにIDが残るか / 別ボードのデータを持ち込めるか / 初回案内
import { chromium } from 'playwright';

const fails = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });

async function open(url, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, ...ctxOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町二丁目' } }) }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 })));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => ['同期済み', 'オフライン'].includes(document.querySelector('#sync-state').textContent), { timeout: 20000 });
  return { ctx, page };
}

async function openPanel(page, sel, btn) {
  if (await page.$eval(sel, (e) => e.hidden)) await page.click(btn);
  await page.waitForSelector(sel, { state: 'visible' });
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

// --- PC想定: 初回起動。新規ボードなので案内が出る ---
const pc = await open('http://localhost:8776/index.html?emu=1');
if (await pc.page.$eval('#sheet-board', (e) => e.hidden)) fails.push('初回に新規ボードの案内が出ない');
await pc.page.click('#btn-board-new');

// URLにボードIDが残っているか(ブックマークしても迷子にならない)
const pcHash = await pc.page.evaluate(() => location.hash);
console.log('PCのURLハッシュ:', pcHash.slice(0, 12) + '...');
if (!/^#b=.{20,}$/.test(pcHash)) fails.push('URLにボードIDが残っていない: ' + pcHash);

await addSpot(pc.page, 200, 400, 'PCで見つけた土地A');
await addSpot(pc.page, 240, 460, 'PCで見つけた土地B');
await openPanel(pc.page, '#panel-settings', '#btn-settings');
const pcBoard = await pc.page.textContent('#diag-board');
console.log('PCの共有ID:', pcBoard.slice(0, 8) + '...');

// --- iPhone想定: 別ボード(別ブラウザで開いた) ---
const ph = await open('http://localhost:8776/index.html?emu=1');
await ph.page.click('#btn-board-new');
await addSpot(ph.page, 180, 380, 'スマホで見つけた土地C');
await openPanel(ph.page, '#panel-settings', '#btn-settings');
const phBoard = await ph.page.textContent('#diag-board');
if (pcBoard === phBoard) fails.push('別ブラウザなのに同じボードになった(テスト前提が崩れている)');
console.log('スマホの共有ID:', phBoard.slice(0, 8) + '...');

// --- PC側で、スマホのボードに「持ち込みあり」で参加する ---
await openPanel(pc.page, '#panel-settings', '#btn-settings');
const carryLabel = await pc.page.textContent('#join-carry-label');
console.log('持ち込みラベル:', carryLabel);
if (!carryLabel.includes('2件')) fails.push('持ち込み件数が出ていない: ' + carryLabel);
await pc.page.fill('#join-input', phBoard);
await pc.page.click('#join-form button[type=submit]');
await pc.page.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
await pc.page.waitForTimeout(2500);

await openPanel(pc.page, '#panel-list', '#btn-list');
const pcNames = await pc.page.$$eval('#spot-list li .spot-name', (els) => els.map((e) => e.textContent.trim()));
console.log('参加後のPCの一覧:', pcNames.join(' / ').slice(0, 200));
for (const n of ['PCで見つけた土地A', 'PCで見つけた土地B', 'スマホで見つけた土地C']) {
  if (!pcNames.some((t) => t.includes(n))) fails.push('参加後に見えない: ' + n);
}

// スマホ側にもPCの2件が届く
await ph.page.waitForTimeout(2500);
await openPanel(ph.page, '#panel-list', '#btn-list');
const phNames = await ph.page.$$eval('#spot-list li .spot-name', (els) => els.map((e) => e.textContent));
for (const n of ['PCで見つけた土地A', 'PCで見つけた土地B']) {
  if (!phNames.some((t) => t.includes(n))) fails.push('スマホ側に届いていない: ' + n);
}
console.log('スマホ側の件数:', phNames.length);

// --- 招待リンクで開き直しても同じボード(localStorageが空の新規ブラウザ) ---
const invite = await pc.page.evaluate(() => location.href);
const mom = await open(invite.includes('?') ? invite : invite.replace('#', '?emu=1#'));
await mom.page.waitForTimeout(2500);
if (!(await mom.page.$eval('#sheet-board', (e) => e.hidden))) fails.push('招待リンクで開いたのに新規ボード案内が出た');
await openPanel(mom.page, '#panel-list', '#btn-list');
const momNames = await mom.page.$$eval('#spot-list li .spot-name', (els) => els.map((e) => e.textContent));
console.log('お義母さん側の件数:', momNames.length);
if (momNames.length !== 3) fails.push('招待リンクで3件見えない: ' + momNames.length);

await browser.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

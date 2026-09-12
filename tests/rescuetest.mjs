// データ保護と復帰のテスト
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const EMU = `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}`;

async function newDevice(label, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: EMU }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"results":{"muniCd":"10204","lv01Nm":"茂呂町"}}' }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  if (init) await page.addInitScript(init);
  return page;
}

const NEW_BOARD = 'RescueTestBoard12345678';
const localSpots = JSON.stringify([
  { id: 'local1', lat: 36.3033, lng: 139.2087, name: '手元にしかない地点', status: 'candidate', rating: 0, memo: '', url: '', info: null, roads: [], createdAt: 1, updatedAt: 1 },
]);

// (1) サーバーが空でも手元の地点が消えず、逆に引き上げられるか
const a = await newDevice('復旧', `
  localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({lat:36.3033,lng:139.2087,zoom:15}));
  localStorage.setItem('tasobow.landscout.spots.v1', ${JSON.stringify(localSpots)});
  localStorage.setItem('tasobow.landhunter.board.v1', '${NEW_BOARD}');
  localStorage.setItem('tasobow.landhunter.migrated.${NEW_BOARD}', '1');
`);
await a.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await a.waitForSelector('#map.leaflet-container');
await a.waitForTimeout(4000);
console.log('サーバー空でも手元の地点が残る =', await a.locator('.spot-pin').count(), '件');
const inCloud = await a.evaluate(async () => {
  const s = await import('./js/sync.js');
  return !(await s.isEmpty('RescueTestBoard12345678'));
});
console.log('サーバーへ引き上げられた =', inCloud);

// (2) 別ブラウザで空のボードになった状態から、共有IDで復帰できるか
const b = await newDevice('別端末');
await b.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await b.waitForSelector('#map.leaflet-container');
await b.waitForTimeout(2500);
console.log('別端末: 最初のピン数 =', await b.locator('.spot-pin').count());
await b.click('#btn-settings');
await b.fill('#join-input', NEW_BOARD);
await b.press('#join-input', 'Enter');
await b.waitForTimeout(1000);
await b.waitForSelector('#map.leaflet-container');
await b.waitForSelector('.spot-pin', { timeout: 20000 });
console.log('共有IDで参加後のピン数 =', await b.locator('.spot-pin').count());
console.log('  地点名 =', await b.evaluate(async () => (await import('./js/data.js')).getSpots()[0].name));

// (3) 招待リンク全体を貼っても参加できるか
const c = await newDevice('リンク貼り付け');
await c.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await c.waitForSelector('#map.leaflet-container');
await c.waitForTimeout(2000);
await c.click('#btn-settings');
await c.fill('#join-input', `http://localhost:8776/index.html#b=${NEW_BOARD}`);
await c.press('#join-input', 'Enter');
await c.waitForTimeout(1000);
await c.waitForSelector('.spot-pin', { timeout: 20000 });
console.log('リンク貼り付けでも参加 =', await c.locator('.spot-pin').count(), '件');

// 後片付け
await a.evaluate(async () => {
  const d = await import('./js/data.js');
  for (const s of d.getSpots()) await d.deleteSpot(s.id);
});
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');

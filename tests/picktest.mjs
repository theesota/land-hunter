// 基準地点の「地図で選ぶ」と駅名検索のテスト
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const page = await (await browser.newContext({ viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
// 「本庄駅」に対して国土地理院が市しか返さない実際の挙動を再現
await page.route('**/address-search/AddressSearch**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([
  { geometry: { coordinates: [139.19046, 36.24374], type: 'Point' }, properties: { title: '埼玉県本庄市' } },
  { geometry: { coordinates: [139.189651, 36.237839], type: 'Point' }, properties: { title: '埼玉県本庄市本庄' } },
]) }));
await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町' } }) }));
await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [] }) }));
await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 14 })));

await page.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });

// (1) 駅名検索: 「本庄駅」で駅そのものが候補に出るか
await page.click('#btn-settings');
await page.fill('#ref-search-input', '本庄駅');
await page.press('#ref-search-input', 'Enter');
await page.waitForSelector('#ref-results li');
console.log('「本庄駅」の候補 =', await page.locator('#ref-results li').allTextContents());

// (2) 地図で選ぶ: ピンポイント指定
await page.fill('#ref-name', '実家');
await page.click('#btn-ref-pick');
await page.waitForSelector('#pick-hint:not([hidden])');
console.log('案内 =', (await page.locator('#pick-hint-text').textContent()));
console.log('設定パネルは閉じたか =', await page.locator('#panel-settings').isHidden());
await page.click('#map', { position: { x: 260, y: 300 } });
await page.waitForSelector('#confirm-bar:not([hidden])');
console.log('確認文 =', await page.locator('#confirm-text').textContent(), '/ ボタン =', await page.locator('#btn-confirm-add').textContent());
console.log('案内は引っ込んだか =', await page.locator('#pick-hint').isHidden());
await page.click('#btn-confirm-add');
await page.waitForFunction(() => document.querySelectorAll('#ref-list li').length === 1, { timeout: 15000 });
console.log('登録された基準地点 =', await page.locator('#ref-list li .spot-name').textContent());
console.log('設定パネルが戻ったか =', !(await page.locator('#panel-settings').isHidden()));

const ref = await page.evaluate(async () => (await import('./js/data.js')).getSpots().find((s) => s.status === 'reference'));
console.log('保存座標 =', ref.lat, ref.lng, '/ 名前 =', ref.name);

// (3) 通常の地点登録が壊れていないか
await page.click('#panel-settings .panel-close');
await page.click('#map', { position: { x: 150, y: 500 } });
await page.waitForSelector('#confirm-bar:not([hidden])');
console.log('通常時の確認文 =', await page.locator('#confirm-text').textContent(), '/ ボタン =', await page.locator('#btn-confirm-add').textContent());
await page.click('#btn-confirm-add');
await page.waitForSelector('#sheet-spot:not([hidden])');
await page.fill('#spot-name', '候補地');
await page.click('#spot-form button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('.spot-pin').length === 2, { timeout: 15000 });
console.log('通常登録も動作 = ピン', await page.locator('.spot-pin').count(), '件');

// (4) 候補地から実家までの距離が出るか
await page.evaluate(() => {
  const pins = [...document.querySelectorAll('.spot-pin')];
  const vis = pins.find((el) => { const r = el.getBoundingClientRect(); return r.top > 400 && r.top < 700; });
  vis.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForSelector('.popup-dists', { timeout: 10000 });
console.log('距離表示 =', (await page.locator('.popup-dists').textContent()).trim());

// (5) 「やめる」でモードが解除されるか
await page.evaluate(() => document.querySelector('#btn-detail-close').click());
await page.waitForTimeout(400);
await page.click('#btn-settings');
await page.fill('#ref-name', 'テスト');
await page.click('#btn-ref-pick');
await page.waitForSelector('#pick-hint:not([hidden])');
await page.click('#btn-pick-cancel');
await page.waitForTimeout(300);
console.log('やめる後: 案内=', await page.locator('#pick-hint').isHidden(), '/ 仮マーカー =', await page.locator('.pending-pin').count());

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');

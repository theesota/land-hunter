// 回帰テスト: 同期導入後も既存機能が壊れていないか(クラウド接続あり)
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const photo = readFileSync(new URL('./fixtures/test.png', import.meta.url));
const floodPng = readFileSync(new URL('./fixtures/flood_mock.png', import.meta.url));

await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町二丁目' } }) }));
await page.route('**/address-search/AddressSearch**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ geometry: { coordinates: [139.185, 36.315], type: 'Point' }, type: 'Feature', properties: { title: '群馬県伊勢崎市宮子町' } }]) }));
await page.route('**/disaportaldata.gsi.go.jp/raster/01_flood**', (r) => r.fulfill({ contentType: 'image/png', body: floodPng }));
await page.route('**/disaportaldata.gsi.go.jp/raster/0[2-9]**', (r) => r.fulfill({ status: 404, body: '' }));
await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [{ type: 'node', lat: 36.305, lon: 139.21, tags: { shop: 'supermarket', name: 'ベイシア' } }] }) }));
await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 })));

await page.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });

// 設定: 基準地点を住所検索で登録
await page.click('#btn-settings');
await page.fill('#ref-name', '実家');
await page.fill('#ref-search-input', '宮子町');
await page.press('#ref-search-input', 'Enter');
await page.waitForSelector('#ref-results li');
await page.click('#ref-results li');
await page.waitForFunction(() => document.querySelectorAll('#ref-list li').length === 1, { timeout: 10000 });
console.log('基準地点 =', (await page.locator('#ref-list li .spot-name').textContent()));
await page.click('#panel-settings .panel-close');

// 学区レイヤ
await page.click('#btn-layers');
await page.click('#layer-chips .mini-chip:has-text("小学校区")');
await page.waitForSelector('.school-label', { timeout: 10000 });
console.log('学区ラベル =', await page.locator('.school-label').count(), '件');
await page.click('#panel-layers .panel-close');

// 登録: 土地情報 + 写真 + 接道方角 + URL
await page.click('#map', { position: { x: 195, y: 400 } });
await page.waitForSelector('#confirm-bar:not([hidden])');
console.log('仮マーカー =', await page.locator('.pending-pin').count());
await page.click('#btn-confirm-add');
await page.waitForSelector('#sheet-spot:not([hidden])');
await page.waitForFunction(() => !document.querySelector('#land-info').textContent.includes('取得中'), { timeout: 15000 });
const info = await page.locator('.land-info').textContent();
console.log('土地情報: 住所 =', /住所(.+?)学区/.exec(info)?.[1]?.trim());
console.log('土地情報: 学区 =', /学区(.+?)最寄り駅/.exec(info)?.[1]?.trim());
console.log('土地情報: 周辺施設 =', /周辺施設(.+?)ハザード/.exec(info)?.[1]?.trim());
console.log('土地情報: ハザード =', await page.locator('#land-info .hz-item').first().textContent());
await page.fill('#spot-name', '本命の土地');
await page.click('.chip[data-status="candidate"]');
await page.click('#spot-rating button[data-star="3"]');
await page.fill('#spot-url', 'https://suumo.jp/tochi/x');
await page.click('.road-chip[data-road="south"]');
await page.setInputFiles('.photo-input >> nth=1', { name: 'p.png', mimeType: 'image/png', buffer: photo });
await page.waitForSelector('.photo-thumb img');
await page.click('#spot-form button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('.spot-pin').length === 2, { timeout: 15000 });
console.log('登録完了。仮マーカーは消えたか =', (await page.locator('.pending-pin').count()) === 0);

// 一覧
await page.click('#btn-list');
console.log('一覧 =', (await page.locator('#spot-list li').allTextContents()).map((t) => t.trim()));
await page.click('#panel-list .panel-close');

// ポップアップの中身
await page.evaluate(() => {
  const pins = [...document.querySelectorAll('.spot-pin')];
  const vis = pins.find((el) => { const r = el.getBoundingClientRect(); return r.top > 200 && r.top < 700; });
  vis.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForSelector('.popup-info');
const pop = await page.locator('.popup').textContent();
console.log('ポップアップ: 接道 =', /接道: (.+?)側/.exec(pop)?.[1]);
console.log('ポップアップ: 距離 =', (await page.locator('.popup-dists').textContent()).trim());
await page.waitForSelector('.popup-photos img', { timeout: 10000 }).catch(() => {});
console.log('ポップアップ: 写真 =', await page.locator('.popup-photos img').count(), '枚 / 物件リンク =', await page.locator('.popup-listing').count());
console.log('ポップアップ: リンク =', await page.locator('.popup-links a').allTextContents());

// 編集して保存(既存データが保持されるか)
await page.click('.popup-edit');
await page.waitForSelector('#sheet-spot:not([hidden])');
console.log('編集時に写真が引き継がれる =', await page.locator('.photo-thumb').count(), '枚 / 南が選択済み =', await page.locator('.road-chip[data-road="south"].active').count());
await page.fill('#spot-memo', '日当たり良好');
await page.click('#spot-form button[type="submit"]');
await page.waitForTimeout(1500);
const saved = await page.evaluate(async () => (await import('./js/data.js')).getSpots().find((s) => s.name === '本命の土地'));
console.log('保存後: メモ =', saved.memo, '/ 評価 =', saved.rating, '/ 接道 =', saved.roads, '/ 学区 =', saved.info.school);

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');

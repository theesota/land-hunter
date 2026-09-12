// 表示パネルのコンパクト化と「使う項目」設定のテスト
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const page = await (await browser.newContext({ viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町' } }) }));
await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [] }) }));
await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 14 })));

await page.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#map.leaflet-container');

await page.click('#btn-layers');
await page.waitForSelector('#panel-layers:not([hidden])');
const box = await page.locator('#panel-layers').boundingBox();
console.log('パネルの高さ =', Math.round(box.height), 'px / 幅 =', Math.round(box.width), 'px');
console.log('ベース地図チップ =', await page.locator('#basemap-chips .mini-chip').allTextContents());
console.log('レイヤチップ =', await page.locator('#layer-chips .mini-chip').allTextContents());
console.log('ONのチップ =', await page.locator('#layer-chips .mini-chip.active').allTextContents());
const bg = await page.locator('#panel-layers').evaluate((el) => getComputedStyle(el).backgroundColor);
console.log('背景 =', bg);

// チップで学区をON
await page.click('#layer-chips .mini-chip:has-text("小学校区")');
await page.waitForSelector('.school-label', { timeout: 10000 });
console.log('学区ONで学校名ラベル =', await page.locator('.school-label').count(), '件');

// 設定で「使う項目」を絞る(津波・高潮・地すべりを外す)
await page.click('#panel-layers .panel-close');
await page.click('#btn-settings');
await page.waitForSelector('#enabled-toggles input');
console.log('設定の項目数 =', await page.locator('#enabled-toggles input').count());
for (const name of ['地すべり', '津波', '高潮']) {
  await page.click(`#enabled-toggles label:has-text("${name}") input`);
}
await page.click('#panel-settings .panel-close');
await page.click('#btn-layers');
const chips = await page.locator('#layer-chips .mini-chip').allTextContents();
console.log('絞り込み後のチップ =', chips);
const box2 = await page.locator('#panel-layers').boundingBox();
console.log('絞り込み後の高さ =', Math.round(box2.height), 'px');

// リロードしても設定が残るか
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#map.leaflet-container');
await page.click('#btn-layers');
console.log('リロード後のチップ =', await page.locator('#layer-chips .mini-chip').allTextContents());

// 地図タップでの登録が壊れていないか
await page.click('#panel-layers .panel-close');
await page.click('#map', { position: { x: 195, y: 500 } });
await page.waitForSelector('#confirm-bar:not([hidden])');
console.log('地図タップ登録 = OK');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');

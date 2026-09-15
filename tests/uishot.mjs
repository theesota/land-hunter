// 新UIの見た目確認: 地図(新ベースマップ+ハザード乗算)、メニュー、一覧(並び替え・ドラッグ)
import { chromium } from 'playwright';
const fails = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
await page.addInitScript(() => {
  localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3165, lng: 139.1967, zoom: 16 }));
  const mk = (id, name, rating, area, price, zone, t) => ({ id, lat: 36.31 + Math.random() * 0.01, lng: 139.19 + Math.random() * 0.02, name, status: 'interested', rating, area, price, water: '', sewer: '', memo: '', url: '', roads: [], info: zone ? { zone } : null, createdAt: t, updatedAt: t });
  localStorage.setItem('tasobow.landscout.spots.v1', JSON.stringify([
    mk('a', '南千木の角地', 3, 45, 1200, '市街化区域', 3),
    mk('b', '境の畑', 1, 80, 900, '市街化調整区域', 2),
    mk('c', '北千木2066', 2, 60, 1500, '市街化区域', 4),
    mk('d', '駅近の細長い土地', 2, 35, 1300, '市街化区域', 1),
    { id: 'ref', lat: 36.31, lng: 139.2, name: '実家', status: 'reference', rating: 0, roads: [], info: null, createdAt: 0, updatedAt: 0 },
  ]));
});
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-marker-icon');
await page.waitForTimeout(2500); // タイル
await page.screenshot({ path: 'ui_map.png' });
// ヘッダーに同期バッジが無い / ズームボタンが無い
if (await page.$('#sync-state')) fails.push('同期バッジが残っている');
if (await page.$('.leaflet-control-zoom')) fails.push('ズームボタンが残っている');
// 検索ボタンとコンパスが同じ高さ・同じ大きさ
const s = await page.$eval('#btn-search-open', (e) => e.getBoundingClientRect());
const c = await page.$eval('.compass', (e) => e.getBoundingClientRect());
console.log('search', s.top, s.width, '/ compass', c.top, c.width);
if (Math.abs(s.top - c.top) > 1 || Math.abs(s.width - c.width) > 1) fails.push('検索とコンパスが揃っていない');
const cam = await page.$eval('#btn-camera', (e) => e.getBoundingClientRect());
const loc = await page.$eval('#btn-locate', (e) => e.getBoundingClientRect());
if (Math.abs(cam.width - loc.width) > 1) fails.push('カメラと現在地の大きさが違う');
console.log('fab right gap', 390 - loc.right, 'bottom gap', 780 - loc.bottom); if (Math.abs(loc.width - s.width) > 1) fails.push('現在地と検索の大きさが違う');

// メニュー
await page.click('#btn-menu');
await page.waitForSelector('#page-menu:not([hidden])');
await page.screenshot({ path: 'ui_menu.png' });
await page.click('#btn-list');
await page.waitForSelector('#panel-list:not([hidden])');
let names = await page.$$eval('#spot-list .land-name', (els) => els.map((e) => e.textContent));
console.log('★順:', names);
if (names[0] !== '南千木の角地') fails.push('★順で3つ星が先頭でない');
if (names.includes('実家')) fails.push('基準地点が一覧に混ざっている');
await page.screenshot({ path: 'ui_list.png' });
// 価格順
await page.click('#sort-chips .mini-chip:has-text("価格")');
names = await page.$$eval('#spot-list .land-name', (els) => els.map((e) => e.textContent));
console.log('価格順:', names);
if (names[0] !== '境の畑') fails.push('価格順で最安が先頭でない');
// 坪単価
await page.click('#sort-chips .mini-chip:has-text("坪単価")');
names = await page.$$eval('#spot-list .land-name', (els) => els.map((e) => e.textContent));
console.log('坪単価順:', names);
if (names[0] !== '境の畑') fails.push('坪単価順が違う');
// ドラッグ: 3行目を1行目へ
await page.click('#sort-chips .mini-chip:has-text("★")');
const grips = await page.$$('#spot-list .grip');
const g3 = await grips[2].boundingBox();
const r1 = await (await page.$('#spot-list .land-row')).boundingBox();
await page.mouse.move(g3.x + g3.width / 2, g3.y + g3.height / 2);
await page.mouse.down();
await page.mouse.move(g3.x + g3.width / 2, r1.y + 5, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
names = await page.$$eval('#spot-list .land-name', (els) => els.map((e) => e.textContent));
const active = await page.$eval('#sort-chips .mini-chip.active', (e) => e.textContent);
console.log('ドラッグ後:', names, '/ 並び:', active);
if (active !== '手動') fails.push('ドラッグ後に「手動」順に切り替わらない');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tasobow.landscout.spots.v1')).filter((s) => s.status !== 'reference').map((s) => [s.name, s.order]));
console.log('order:', saved);
// 再描画しても順が保たれる
await page.click('#panel-list .page-back');
await page.click('#btn-menu'); await page.click('#btn-list');
const names2 = await page.$$eval('#spot-list .land-name', (els) => els.map((e) => e.textContent));
if (names2.join() !== names.join()) fails.push('じぶん順が再描画で崩れた');
await page.screenshot({ path: 'ui_list_manual.png' });
// 行タップで地図へ戻り詳細が開く
await page.click('#spot-list .land-row >> nth=0');
await page.waitForSelector('#sheet-detail:not([hidden])');
if (!(await page.$eval('#panel-list', (e) => e.hidden))) fails.push('行タップで一覧が閉じない');
await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

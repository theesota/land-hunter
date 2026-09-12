// 区域区分の自動判定 / 表示レイヤ / 坪数・売り値・上下水道の保存と表示
import { chromium } from 'playwright';
const fails = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
await page.route('**/*', (r) => (/localhost|127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '上武士町' } }) }));
await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.26, lng: 139.24, zoom: 16 })));
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#btn-layers');

// 表示パネルに「調整区域」チップがあり、ONで面が描かれる
await page.click('#btn-layers');
const chips = await page.$$eval('#layer-chips .mini-chip', (els) => els.map((e) => e.textContent));
console.log('チップ:', chips);
if (!chips.includes('調整区域')) fails.push('調整区域チップが無い');
await page.click('#layer-chips .mini-chip:has-text("調整区域")');
await page.waitForTimeout(1200);
const paths = await page.$$eval('path.leaflet-interactive, .leaflet-overlay-pane path', (els) => els.length);
const labels = await page.$$eval('.school-label', (els) => els.map((e) => e.textContent));
console.log('面の数:', paths, '/ ラベル:', labels);
if (!paths) fails.push('調整区域の面が描かれない');
if (!labels.includes('市街化調整区域')) fails.push('調整区域ラベルが無い');
await page.evaluate(() => document.querySelectorAll('.panel').forEach((p) => (p.hidden = true)));
await page.screenshot({ path: 'zone_map.png' });

// 田園部(境上武士あたり)をタップ → 区域区分 = 市街化調整区域
await page.mouse.click(195, 450);
await page.waitForSelector('#confirm-bar:not([hidden])');
await page.click('#btn-confirm-add');
await page.waitForSelector('#sheet-spot:not([hidden])');
await page.waitForFunction(() => document.querySelector('#land-info').textContent.includes('市街化'), { timeout: 10000 });
const zoneText = await page.textContent('#land-info');
console.log('区域区分:', zoneText.includes('市街化調整区域') ? '市街化調整区域' : zoneText.includes('市街化区域') ? '市街化区域' : '?');
if (!zoneText.includes('市街化調整区域')) fails.push('田園部で調整区域と判定されない');
// 坪数・売り値・上下水道を入れて保存
await page.fill('#spot-name', '境の畑');
await page.fill('#spot-area', '60');
await page.fill('#spot-price', '900');
await page.selectOption('#spot-water', 'yes');
await page.selectOption('#spot-sewer', 'no');
await page.click('#spot-form button[type=submit]');
await page.waitForSelector('#sheet-spot', { state: 'hidden' });
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tasobow.landscout.spots.v1'))[0]);
console.log('保存:', saved.area, saved.price, saved.water, saved.sewer, '/ zone:', saved.info && saved.info.zone);
if (saved.area !== 60 || saved.price !== 900 || saved.water !== 'yes' || saved.sewer !== 'no') fails.push('坪数・売り値・上下水道が保存されない');
// 詳細シートに出る
await page.click('.leaflet-marker-icon.spot-pin-wrap');
await page.waitForSelector('#sheet-detail:not([hidden])');
const detail = await page.textContent('#detail-body');
console.log('詳細:', detail.replace(/\s+/g, ' ').slice(0, 160));
for (const t of ['60坪', '900万円', '坪15.0万', '上水道あり', '下水道なし(浄化槽)', '市街化調整区域']) if (!detail.includes(t)) fails.push('詳細に無い: ' + t);
if (detail.includes('建ぺい')) fails.push('調整区域なのに用途地域が出ている');
await page.screenshot({ path: 'zone_detail.png' });
// 一覧にも坪数・価格
await page.click('#btn-list');
const sub = await page.textContent('#spot-list li .spot-sub');
if (!sub.includes('60坪') || !sub.includes('900万')) fails.push('一覧に坪数・価格が出ない: ' + sub);
// 編集で値が戻る
await page.evaluate(() => document.querySelectorAll('.panel').forEach((p) => (p.hidden = true)));
await page.click('.leaflet-marker-icon.spot-pin-wrap');
await page.waitForSelector('#sheet-detail:not([hidden])');
await page.click('.popup-edit');
await page.waitForSelector('#sheet-spot:not([hidden])');
if ((await page.inputValue('#spot-area')) !== '60' || (await page.inputValue('#spot-sewer')) !== 'no') fails.push('編集時に値が戻らない');

// 市街地(伊勢崎駅) → 市街化区域
await page.click('#btn-spot-cancel');
await page.fill('#search-input', '36.3165, 139.1967');
await page.press('#search-input', 'Enter');
await page.waitForSelector('#search-results li');
await page.click('#search-results li');
await page.waitForSelector('#confirm-bar:not([hidden])');
await page.click('#btn-confirm-add');
await page.waitForSelector('#sheet-spot:not([hidden])');
await page.waitForFunction(() => document.querySelector('#land-info').textContent.includes('市街化'), { timeout: 10000 });
const z2 = await page.textContent('#land-info');
if (z2.includes('市街化調整区域') || !z2.includes('市街化区域')) fails.push('駅前が市街化区域にならない');
await page.waitForFunction(() => document.querySelector('#land-info').textContent.includes('建ぺい'), { timeout: 10000 }).catch(() => {});
console.log('駅前 用途:', (z2.match(/[^\s]*地域\(建ぺい[^)]*\)/) || [await page.textContent('#land-info')])[0].slice(0, 60));
if (!(await page.textContent('#land-info')).includes('準工業地域(建ぺい60%・容積200%)')) fails.push('駅前の用途地域が出ない');
// 坪数を入れると「建てられる目安」がその場で出る
await page.fill('#spot-area', '50');
await page.waitForTimeout(300);
const build = await page.textContent('#land-info');
console.log('建てられる目安:', (build.match(/1階[^延]*延床[^)]*\)/) || ['?'])[0]);
if (!build.includes('1階 最大30.0坪(99㎡)') || !build.includes('延床 最大100.0坪(331㎡)')) fails.push('建てられる目安が合わない');
await page.fill('#spot-name', '駅前の土地');
await page.click('#spot-form button[type=submit]');
await page.waitForSelector('#sheet-spot', { state: 'hidden' });
await page.waitForTimeout(500);
await page.click('#btn-list');
await page.click('#spot-list li:has-text("駅前の土地")');
await page.waitForSelector('#sheet-detail:not([hidden])');
const d2 = await page.textContent('#detail-body');
if (!d2.includes('1階 最大30.0坪')) fails.push('詳細に建てられる目安が出ない');
if (!(await page.$('#detail-body use[href="#ic-home"]'))) fails.push('家アイコンが出ない');
await page.click('#btn-detail-close');
// 用途地域チップで塗りが出る
await page.click('#btn-layers');
await page.click('#layer-chips .mini-chip:has-text("用途地域")');
await page.waitForTimeout(1500);
const ylabels = await page.$$eval('.school-label', (els) => els.map((e) => e.textContent));
console.log('用途ラベル例:', ylabels.slice(0, 4));
if (!ylabels.some((t) => /\d+\/\d+/.test(t))) fails.push('用途地域ラベルが出ない');
await page.evaluate(() => document.querySelectorAll('.panel, .panel-compact').forEach((p) => (p.hidden = true)));
await page.screenshot({ path: 'youto_map.png' });
console.log('駅前:', z2.includes('市街化調整区域') ? '調整区域(NG)' : '市街化区域');

await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

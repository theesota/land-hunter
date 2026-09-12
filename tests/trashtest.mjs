// ゴミ箱: 削除→ゴミ箱に入る→他端末でも消える→戻す→完全削除(写真も)
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const fails = [];
const photo = readFileSync(new URL('./fixtures/test.png', import.meta.url));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町' } }) }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 })));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
  return page;
}
const openPanel = async (page, sel, btn) => { if (await page.$eval(sel, (e) => e.hidden)) await page.click(btn); };
const names = (page) => page.$$eval('#spot-list li .spot-name', (els) => els.map((e) => e.textContent));
const trashNames = (page) => page.$$eval('#trash-list li .spot-name', (els) => els.map((e) => e.textContent));

const a = await open('http://localhost:8776/index.html?emu=1');
await a.click('#btn-board-new');
// 写真つきで1件登録
await a.mouse.click(180, 400);
await a.waitForSelector('#confirm-bar:not([hidden])');
await a.click('#btn-confirm-add');
await a.waitForSelector('#sheet-spot:not([hidden])');
await a.fill('#spot-name', '消す土地');
await a.setInputFiles('.photo-input', { name: 'p.png', mimeType: 'image/png', buffer: photo });
await a.waitForSelector('#photo-thumbs img');
await a.click('#spot-form button[type=submit]');
await a.waitForSelector('#sheet-spot', { state: 'hidden' });
await a.waitForTimeout(1500);
const invite = await a.evaluate(() => location.href);

const b = await open(invite);
await b.waitForTimeout(2000);
await openPanel(b, '#panel-list', '#btn-list');
if (!(await names(b)).includes('消す土地')) fails.push('B側に地点が来ていない');

// A: 一覧から開いて削除
await openPanel(a, '#panel-list', '#btn-list');
await a.click('#spot-list li');
await a.waitForTimeout(500);
await a.click('.leaflet-marker-icon');
await a.waitForSelector('.popup-edit');
await a.click('.popup-edit');
await a.waitForSelector('#sheet-spot:not([hidden])');
await a.click('#btn-spot-delete');
await a.waitForSelector('#sheet-spot', { state: 'hidden' });
await a.waitForTimeout(1500);
await openPanel(a, '#panel-list', '#btn-list');
console.log('A 削除後 一覧:', await names(a), '/ ゴミ箱表示:', await a.textContent('#trash-toggle'));
if ((await names(a)).length !== 0) fails.push('削除後も一覧に残っている');
if (!(await a.textContent('#trash-toggle')).includes('(1)')) fails.push('ゴミ箱に入っていない');
const markers = await a.$$('.leaflet-marker-icon');
if (markers.length !== 0) fails.push('削除後も地図にピンが残っている: ' + markers.length);

// B: 同期して消える(ゴミ箱に入る)
await b.waitForTimeout(2000);
await openPanel(b, '#panel-list', '#btn-list');
if ((await names(b)).length !== 0) fails.push('B側で消えていない');
if (!(await b.textContent('#trash-toggle')).includes('(1)')) fails.push('B側のゴミ箱に入っていない');

// B: ゴミ箱から戻す(他の人でも戻せる)
await b.click('#trash-toggle');
console.log('B ゴミ箱の中:', await trashNames(b));
await b.click('.trash-restore');
await b.waitForTimeout(2000);
if (!(await names(b)).includes('消す土地')) fails.push('B側で戻せていない');
await a.waitForTimeout(1500);
await openPanel(a, '#panel-list', '#btn-list');
if (!(await names(a)).includes('消す土地')) fails.push('A側に戻ってきていない');
console.log('戻した後 A:', await names(a), 'B:', await names(b));

// A: もう一度消して、完全に削除 → 写真も消える
await a.click('#spot-list li');
await a.waitForTimeout(500);
await a.click('.leaflet-marker-icon');
await a.waitForSelector('.popup-edit');
await a.click('.popup-edit');
await a.waitForSelector('#sheet-spot:not([hidden])');
await a.click('#btn-spot-delete');
await a.waitForSelector('#sheet-spot', { state: 'hidden' });
await a.waitForTimeout(1500);
await openPanel(a, '#panel-list', '#btn-list');
if (await a.$eval('#trash-body', (e) => e.hidden)) await a.click('#trash-toggle');
await a.click('.trash-purge');
await a.waitForTimeout(2000);
const boardId = await a.evaluate(() => localStorage.getItem('tasobow.landhunter.board.v1'));
const photosLeft = await fetch(`http://127.0.0.1:8080/v1/projects/land-hunter-dev/databases/(default)/documents/boards/${boardId}/photos`).then((r) => r.json()).then((j) => (j.documents || []).length);
console.log('完全削除後 ゴミ箱:', await a.$eval('#trash-box', (e) => e.hidden) ? '空(非表示)' : await a.textContent('#trash-toggle'), '/ 写真:', photosLeft);
if (!(await a.$eval('#trash-box', (e) => e.hidden))) fails.push('完全削除後もゴミ箱に残っている');
await b.waitForTimeout(2000);
if (!(await b.$eval('#trash-box', (e) => e.hidden))) fails.push('B側のゴミ箱に残っている');

await browser.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

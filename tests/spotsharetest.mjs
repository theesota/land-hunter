// 土地1件の共有: 共有ボタン → リンク → 開くとその土地の詳細が開く
import { chromium } from 'playwright';
const fails = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
async function open(url) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}` }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '南千木町' } }) }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  await page.addInitScript(() => {
    localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 }));
    window.__shared = null;
    navigator.share = async (d) => { window.__shared = d; };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.sync === 'synced', { timeout: 20000 });
  return page;
}
// ソータ: 登録して共有ボタン
const a = await open('http://localhost:8776/index.html?emu=1');
await a.click('#btn-board-new');
await a.mouse.click(195, 450);
await a.waitForSelector('#confirm-bar:not([hidden])');
await a.click('#btn-confirm-add');
await a.waitForSelector('#sheet-spot:not([hidden])');
await a.fill('#spot-name', 'めっちゃ良い土地');
await a.fill('#spot-area', '50');
await a.fill('#spot-price', '1200');
await a.click('#spot-form button[type=submit]');
await a.waitForSelector('#sheet-spot', { state: 'hidden' });
await a.waitForTimeout(1500);
await a.click('.leaflet-marker-icon.spot-pin-wrap');
await a.waitForSelector('#sheet-detail:not([hidden])');
await a.click('#btn-detail-share');
await a.waitForTimeout(800);
const shared = await a.evaluate(() => window.__shared);
console.log('共有内容:', shared);
if (!shared || !/#b=.{20,}&s=/.test(shared.url)) fails.push('共有リンクに地点IDが無い');
if (!shared.text.includes('50坪') || !shared.text.includes('1,200万')) fails.push('共有文に坪数・価格が無い');

// ミホ: リンクを開く(別ブラウザ・未参加) → 参加してその土地の詳細が開く
const m = await open(shared.url.replace('index.html#', 'index.html?emu=1#'));
await m.waitForSelector('#sheet-detail:not([hidden])', { timeout: 15000 });
const title = await m.textContent('#detail-body strong');
console.log('ミホ側で開いた詳細:', title, '/ hash:', await m.evaluate(() => location.hash));
if (title !== 'めっちゃ良い土地') fails.push('リンク先で詳細が開かない');
if (!/^#b=[^&]+$/.test(await m.evaluate(() => location.hash))) fails.push('開いた後のURLに s= が残っている');
if (!(await m.$eval('#sheet-board', (e) => e.hidden))) fails.push('参加したのに新規ボード案内が出た');

// 同じボードで開いている画面のアドレスバーに地点リンクを貼る(ハッシュだけ変わる) → 読み直さずに開く
await m.click('#btn-detail-close');
await m.evaluate((u) => { location.hash = u.split('#')[1]; }, shared.url);
await m.waitForSelector('#sheet-detail:not([hidden])', { timeout: 5000 });
console.log('同一タブでの地点リンク: OK');
await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

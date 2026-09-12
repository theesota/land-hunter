import { chromium } from 'playwright';
const fails = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
await page.route('**/*', (r) => (r.request().url().includes('localhost') || r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
await page.addInitScript(() => {
  localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 }));
  localStorage.setItem('tasobow.landscout.spots.v1', JSON.stringify([
    { id: 'ref1', lat: 36.31, lng: 139.2, name: '実家', status: 'reference', rating: 0, memo: '', url: '', info: null, roads: [], createdAt: 1, updatedAt: 1 },
    { id: 'a', lat: 36.3033, lng: 139.2087, name: '南千木の角地', status: 'interested', rating: 3, memo: '', url: '', roads: ['south', 'east'], createdAt: 2, updatedAt: 2,
      info: { address: '群馬県伊勢崎市南千木町', school: '茂呂小学校(徒歩約13分) / 第一中学校(徒歩約29分)', station: '剛志駅(伊勢崎線) 徒歩約9分・車約2分',
        facility: 'コンビニ: セブン-イレブン(徒歩約3分) / スーパー: 西友(徒歩約4分) / ドラッグストア: マルエドラッグ伊勢崎南千木店(徒歩約6分)',
        hz: [{ t: '洪水浸水想定: 0.5〜3m', c: '#f7d9c4', n: '1階が浸水する目安' }] } },
  ]));
});
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-marker-icon');
async function openSpot() {
  await page.evaluate(() => document.querySelectorAll('.panel').forEach((p) => (p.hidden = true)));
  await page.click('#btn-list');
  await page.click('#spot-list li:has-text("南千木の角地")');
  await page.waitForSelector('#sheet-detail .popup-info');
}
await openSpot();
const text = await page.textContent('#sheet-detail .popup-info');
const lines = await page.$$eval('#sheet-detail .pi-row', (els) => els.map((e) => e.textContent.trim()));
console.log(lines);
if (text.includes('中学校')) fails.push('既定で中学校が出ている');
if (/📍|🏫|🚉|🛒|🛣/.test(text)) fails.push('絵文字が残っている');
const cartRow = lines.find((l) => l.includes('コンビニ'));
const brs = await page.$$eval('#sheet-detail .pi-row', (els) => els.map((e) => e.querySelectorAll('br').length));
if (Math.max(...brs) < 2) fails.push('施設が改行されていない');
const icons = await page.$$eval('#sheet-detail .pi-ic use', (els) => els.map((e) => e.getAttribute('href')));
console.log('icons:', icons);
await page.waitForTimeout(600);
await page.screenshot({ path: 'popup.png', timeout: 15000 });
// ピンがシートより上の見える範囲にいるか
const pin = await page.$eval('.leaflet-marker-icon.spot-pin-wrap >> nth=-1', (e) => e.getBoundingClientRect().bottom).catch(() => null);
const sheetTop = await page.$eval('#sheet-detail', (e) => e.getBoundingClientRect().top);
console.log('pin bottom:', pin, '/ sheet top:', sheetTop);
if (pin !== null && pin > sheetTop) fails.push('ピンがシートに隠れている');
// 設定で中学校区をONにするとポップアップにも出る
await page.click('#btn-settings');
await page.waitForSelector('#enabled-toggles input');
const cbs = await page.$$('#enabled-toggles label');
for (const l of cbs) { if ((await l.textContent()).includes('中学校区')) { await (await l.$('input')).check(); break; } }
await page.waitForTimeout(600); // 古いポップアップはフェードアウト後にDOMから消える
console.log('popups right after check:', await page.$$eval('#sheet-detail', (els) => els.map((e) => e.className)));
console.log('enabled after:', await page.evaluate(() => localStorage.getItem('tasobow.landhunter.enabled.v1')));
await openSpot();
const text2 = await page.textContent('#sheet-detail .popup-info');
console.log('popups:', await page.$$eval('#sheet-detail .popup-info', (els) => els.map((e) => e.textContent.slice(0, 80))));
if (!text2.includes('第一中学校')) fails.push('中学校区ONでもポップアップに出ない');
// 編集シートに住所欄が入っているか
await page.click('.popup-edit');
await page.waitForSelector('#sheet-spot:not([hidden])');
console.log('住所欄:', await page.inputValue('#spot-address'));
await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK');
process.exit(fails.length ? 1 : 0);

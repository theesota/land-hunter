// 検索: 緯度経度 / GoogleマップURL / 郵便番号付き住所 → 登録確認まで
import { chromium } from 'playwright';
const fails = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const page = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage();
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
const geoQueries = [];
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
await page.route('**/address-search/AddressSearch**', (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q'));
  geoQueries.push(q);
  const body = q.includes('２０６６') || q.includes('2066')
    ? [{ geometry: { coordinates: [139.21167, 36.30434], type: 'Point' }, type: 'Feature', properties: { title: '群馬県伊勢崎市北千木町２０６６番地' } }]
    : [{ geometry: { coordinates: [139.215652, 36.302883], type: 'Point' }, type: 'Feature', properties: { title: '群馬県伊勢崎市北千木町' } }];
  r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '北千木町' } }) }));
await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 14 })));
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#search-input');

async function search(q) {
  await page.fill('#search-input', q);
  await page.press('#search-input', 'Enter');
  await page.waitForSelector('#search-results li', { timeout: 8000 });
  const titles = await page.$$eval('#search-results li', (els) => els.map((e) => e.textContent));
  await page.click('#search-results li');
  await page.waitForTimeout(800);
  return titles;
}
const center = () => page.evaluate(() => { const m = document.querySelector('#map'); return null; });

// 1. 度分秒
let t = await search('36°17\'49.2"N 139°12\'28.8"E');
console.log('DMS →', t);
if (await page.$eval('#confirm-bar', (e) => e.hidden)) fails.push('DMSで登録確認が出ない');
console.log('確認文:', await page.textContent('#confirm-text'));
if (!(await page.$('.pending-pin'))) fails.push('DMSで仮ピンが出ない');
await page.click('#btn-confirm-cancel').catch(async () => { await page.evaluate(() => (document.querySelector('#confirm-bar').hidden = true)); });

// 2. GoogleマップURL
t = await search('https://www.google.com/maps/place/x/@36.297,139.208,17z/data=!3m1');
console.log('URL →', t);
if (await page.$eval('#confirm-bar', (e) => e.hidden)) fails.push('URLで登録確認が出ない');
await page.evaluate(() => (document.querySelector('#confirm-bar').hidden = true));

// 3. 郵便番号付き住所(番地まで) → 〒が落ちて GSI に届き、番地一致で登録確認
t = await search('〒372-0032 群馬県伊勢崎市北千木町２０６６－１');
console.log('住所 →', t, '/ GSIへの問い合わせ:', geoQueries.at(-1));
if (geoQueries.at(-1).includes('〒') || geoQueries.at(-1).includes('372-0032')) fails.push('郵便番号が落ちていない');
if (await page.$eval('#confirm-bar', (e) => e.hidden)) fails.push('番地一致で登録確認が出ない');
await page.evaluate(() => (document.querySelector('#confirm-bar').hidden = true));

// 4. 町名だけ → 地図を寄せるだけで登録確認は出ない
t = await search('伊勢崎市北千木町');
console.log('町名 →', t);
if (!(await page.$eval('#confirm-bar', (e) => e.hidden))) fails.push('町名レベルで登録確認が出てしまう');

await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

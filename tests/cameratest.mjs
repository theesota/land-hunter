// カメラモード: ライブラリ写真(GPSあり) / カメラ撮影(GPSなし+現在地) / どちらも無し→地図タップ
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const fails = [];
const gps = readFileSync(new URL('./fixtures/gps.jpg', import.meta.url)); const nogps = readFileSync(new URL('./fixtures/nogps.jpg', import.meta.url));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
async function open(ctxOpts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, ...ctxOpts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '北千木町' } }) }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.35, lng: 139.25, zoom: 14 })));
  await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-camera');
  return { ctx, page };
}
const mapCenter = (page) => page.evaluate(() => { const c = document.querySelector('#map')._leaflet_map; return null; });

// 1. ライブラリ写真(GPS入り) → 写真の場所で登録シート、写真も入っている
{
  const { ctx, page } = await open();
  await page.click('#btn-camera');
  await page.waitForSelector('#sheet-camera:not([hidden])');
  await page.click('#btn-cam-pick');
  await page.setInputFiles('#library-input', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: gps });
  await page.waitForSelector('#sheet-spot:not([hidden])', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#land-info').textContent.includes('北千木町'), { timeout: 10000 });
  const thumbs = await page.$$eval('#photo-thumbs img', (e) => e.length);
  const addr = await page.inputValue('#spot-address');
  console.log('ライブラリ: 写真', thumbs, '枚 / 住所', addr);
  if (thumbs !== 1) fails.push('ライブラリ写真がシートに入っていない');
  if (!addr.includes('北千木町')) fails.push('土地情報が取れていない');
  await page.fill('#spot-name', '写真の土地');
  await page.click('#spot-form button[type=submit]');
  await page.waitForSelector('#sheet-spot', { state: 'hidden' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tasobow.landscout.spots.v1')));
  console.log('保存座標:', saved[0].lat, saved[0].lng);
  if (Math.abs(saved[0].lat - 36.297) > 1e-3 || Math.abs(saved[0].lng - 139.208) > 1e-3) fails.push('EXIFの座標で保存されていない');
  await ctx.close();
}
// 2. カメラ撮影(GPSなし) + 位置情報許可 → 現在地で登録シート
{
  const { ctx, page } = await open({ permissions: ['geolocation'], geolocation: { latitude: 36.3100, longitude: 139.2200 } });
  await page.click('#btn-camera');
  await page.click('#btn-cam-shoot');
  await page.setInputFiles('#camera-input', { name: 'c.jpg', mimeType: 'image/jpeg', buffer: nogps });
  await page.waitForSelector('#sheet-spot:not([hidden])', { timeout: 15000 });
  await page.fill('#spot-name', '現在地で撮った');
  await page.click('#spot-form button[type=submit]');
  await page.waitForSelector('#sheet-spot', { state: 'hidden' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tasobow.landscout.spots.v1')));
  console.log('カメラ: 保存座標', saved[0].lat, saved[0].lng);
  if (Math.abs(saved[0].lat - 36.31) > 1e-3 || Math.abs(saved[0].lng - 139.22) > 1e-3) fails.push('現在地で保存されていない');
  await ctx.close();
}
// 3. GPSなし + 位置情報なし → 地図タップ待ち → タップで写真付きシート
{
  const { ctx, page } = await open();
  await page.addInitScript(() => {});
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, err) => err({ code: 1 }); });
  await page.click('#btn-camera');
  await page.click('#btn-cam-pick');
  await page.setInputFiles('#library-input', { name: 'n.jpg', mimeType: 'image/jpeg', buffer: nogps });
  await page.waitForSelector('#pick-hint:not([hidden])', { timeout: 15000 });
  console.log('案内:', await page.textContent('#pick-hint-text'));
  if (await page.$eval('#sheet-geo', (e) => e.hidden)) fails.push('拒否なのに位置情報の案内が出ない');
  console.log('診断:', await page.textContent('#geo-diag'));
  await page.click('#btn-geo-close');
  await page.mouse.click(195, 500);
  await page.waitForSelector('#sheet-spot:not([hidden])', { timeout: 10000 });
  const thumbs = await page.$$eval('#photo-thumbs img', (e) => e.length);
  if (thumbs !== 1) fails.push('地図タップ後に写真が入っていない');
  if (!(await page.$eval('#confirm-bar', (e) => e.hidden))) fails.push('写真待ちのタップで確認バーが出た');
  await ctx.close();
}
await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

// 初回起動時の表示位置テスト
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const EMU = `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}`;
const HOME = { latitude: 36.3050, longitude: 139.2100 };

async function newDevice(label, { geo = true, spots = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true,
    permissions: geo ? ['geolocation'] : [],
    ...(geo ? { geolocation: HOME } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: EMU }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"results":{"muniCd":"10204","lv01Nm":"茂呂町"}}' }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
  if (spots) {
    await page.addInitScript((sp) => localStorage.setItem('tasobow.landscout.spots.v1', sp), spots);
  }
  return page;
}

const view = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tasobow.landscout.view.v1')));

// (1) 初回起動・地点なし → 現在地に寄る
const a = await newDevice('初回/地点なし');
await a.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await a.waitForSelector('#map.leaflet-container');
await a.waitForFunction(() => {
  const v = JSON.parse(localStorage.getItem('tasobow.landscout.view.v1') || 'null');
  return v && Math.abs(v.lat - 36.305) < 0.05;
}, { timeout: 20000 }).catch(() => {});
const v1 = await view(a);
console.log('初回・地点なし → 表示位置 =', v1 && `${v1.lat.toFixed(3)}, ${v1.lng.toFixed(3)} z${v1.zoom}`, '(現在地 36.305, 139.210)');

// (2) 初回起動・地点あり(招待リンクで参加した想定) → 地点が収まる位置へ
const spotsJson = JSON.stringify([
  { id: 's1', lat: 36.290, lng: 139.190, name: '候補1', status: 'candidate', rating: 0, memo: '', url: '', info: null, roads: [], createdAt: 1, updatedAt: 1 },
  { id: 's2', lat: 36.320, lng: 139.230, name: '候補2', status: 'candidate', rating: 0, memo: '', url: '', info: null, roads: [], createdAt: 2, updatedAt: 2 },
]);
const b = await newDevice('初回/地点あり', { spots: spotsJson });
await b.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await b.waitForSelector('.spot-pin');
await b.waitForTimeout(2500);
const v2 = await view(b);
console.log('初回・地点あり → 表示位置 =', v2 && `${v2.lat.toFixed(3)}, ${v2.lng.toFixed(3)} z${v2.zoom}`, '(2地点の中心 36.305, 139.210)');
console.log('  2地点とも画面内にあるか =', await b.evaluate(() => {
  const pins = [...document.querySelectorAll('.spot-pin')];
  return pins.length === 2 && pins.every((p) => { const r = p.getBoundingClientRect(); return r.top > 0 && r.bottom < 780 && r.left > 0 && r.right < 390; });
}));

// (3) 位置情報を許可しない場合でも落ちないか
const c = await newDevice('許可なし', { geo: false });
await c.goto('http://localhost:8776/index.html?emu=1', { waitUntil: 'domcontentloaded' });
await c.waitForSelector('#map.leaflet-container');
await c.waitForTimeout(3000);
console.log('位置情報なしでも起動 =', await c.locator('#map.leaflet-container').count() === 1);

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');

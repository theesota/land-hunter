// 拡張テスト: 3人同時 / 写真の共有 / 未設定時のローカル動作
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8776/index.html?emu=1';
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const EMU_CONFIG = `export const FIREBASE_CONFIG={apiKey:'k',authDomain:'localhost',projectId:'land-hunter-dev',storageBucket:'',messagingSenderId:'0',appId:'0'};export function isConfigured(){return true;}`;
const photo = readFileSync(new URL('./fixtures/test.png', import.meta.url));

async function newDevice(label, { configured = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({
    contentType: 'text/javascript',
    body: configured ? EMU_CONFIG
      : "export const FIREBASE_CONFIG={projectId:'__FILL_ME__'};export function isConfigured(){return false;}",
  }));
  await page.route('**/reverse-geocoder/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: { muniCd: '10204', lv01Nm: '茂呂町' } }) }));
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/overpass-api.de/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [] }) }));
  await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 15 })));
  return page;
}

async function addSpot(page, name, pos, withPhoto = false) {
  // ポップアップが開いていると1回目のタップは「閉じる」に使われる(意図した挙動)
  await page.click('#map', { position: pos });
  await page.waitForSelector('#confirm-bar:not([hidden])');
  await page.click('#btn-confirm-add');
  await page.waitForSelector('#sheet-spot:not([hidden])');
  await page.fill('#spot-name', name);
  if (withPhoto) {
    await page.setInputFiles('.photo-input >> nth=1', { name: 'p.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('.photo-thumb img');
  }
  await page.click('#spot-form button[type="submit"]');
}

// --- ソータ: 新しいボードを作り、写真付きで登録 ---
const sota = await newDevice('ソータ');
await sota.goto(BASE, { waitUntil: 'domcontentloaded' });
await sota.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
await addSpot(sota, '写真付き候補', { x: 150, y: 400 }, true);
await sota.waitForSelector('.spot-pin', { timeout: 10000 });
const invite = await sota.evaluate(async () => (await import('./js/data.js')).getInviteUrl());
console.log('招待リンク文字数 =', invite.length);

// --- 美穂・お義母さん: 同じリンクで参加 ---
const miho = await newDevice('美穂');
const haha = await newDevice('お義母さん');
for (const [p, name] of [[miho, '美穂'], [haha, 'お義母さん']]) {
  await p.goto(invite.replace('#b=', '?emu=1#b='), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#sync-state').textContent === '同期済み', { timeout: 20000 });
  await p.waitForSelector('.spot-pin', { timeout: 15000 });
  console.log(`${name}: 参加後のピン =`, await p.locator('.spot-pin').count());
}

// 写真が共有されているか(美穂の画面でピンを開く)
await miho.evaluate(() => document.querySelector('.spot-pin').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await miho.waitForSelector('.popup-photos img', { timeout: 15000 });
console.log('美穂: 共有された写真 =', await miho.locator('.popup-photos img').count(), '枚');

// --- 3人が同時に追加 → 全員に3件揃うか ---
// ポップアップは×で閉じる(開いたままだと地図タップが吸われるのは通常の地図と同じ挙動)
await miho.evaluate(() => document.querySelector('#btn-detail-close').click());
await miho.waitForFunction(() => document.querySelector('#sheet-detail').hidden, { timeout: 5000 });
await miho.waitForTimeout(400);
await Promise.all([
  addSpot(miho, '美穂の候補', { x: 280, y: 250 }),
  addSpot(haha, 'お義母さんの候補', { x: 100, y: 550 }),
]);
for (const [p, name] of [[sota, 'ソータ'], [miho, '美穂'], [haha, 'お義母さん']]) {
  await p.waitForFunction(() => document.querySelectorAll('.spot-pin').length === 3, { timeout: 20000 });
  console.log(`${name}の画面: ${await p.locator('.spot-pin').count()}件`);
}

// --- 未設定(=Firebase未接続)でもローカルで動くか ---
const solo = await newDevice('未設定', { configured: false });
await solo.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await solo.waitForFunction(() => document.querySelector('#sync-state').textContent !== '…', { timeout: 15000 });
await addSpot(solo, 'ローカル候補', { x: 195, y: 400 });
await solo.waitForSelector('.spot-pin', { timeout: 10000 });
console.log('未設定時: バッジ =', await solo.locator('#sync-state').textContent(), '/ 保存できたピン =', await solo.locator('.spot-pin').count());

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');

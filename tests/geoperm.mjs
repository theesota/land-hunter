// 位置情報の許可案内画面のテスト
import { chromium } from 'playwright';

const fails = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  // ローカルモードで動かす(同期は今回の検証対象外)
  await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
  await page.addInitScript(() => localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 })));
  return { ctx, page };
}

// --- 1. 許可されていない状態で⌖を押すと案内が出る ---
{
  const { ctx, page } = await newPage();
  await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-locate');
  await page.click('#btn-locate');
  await page.waitForSelector('#sheet-geo:not([hidden])', { timeout: 30000 });
  const reason = await page.textContent('#geo-reason');
  const steps = await page.$$eval('#geo-steps li', (els) => els.map((e) => e.textContent));
  const fallback = await page.textContent('#geo-fallback');
  const active = await page.$eval('#btn-locate', (e) => e.classList.contains('active'));
  console.log('reason:', reason);
  console.log('steps:', steps);
  console.log('fallback:', fallback);
  if (!/ブロック|返ってきませんでした/.test(reason)) fails.push('理由文が出ていない: ' + reason);
  if (steps.length < 3) fails.push('手順が出ていない');
  if (!fallback) fails.push('補足が出ていない');
  if (active) fails.push('失敗したのに⌖がONのまま');

  // 案内が出ている間は地図タップで登録バーが出ない
  await page.mouse.click(195, 300);
  if (!(await page.$eval('#confirm-bar', (e) => e.hidden))) fails.push('案内表示中に地図タップが反応した');

  await page.click('#btn-geo-close');
  if (!(await page.$eval('#sheet-geo', (e) => e.hidden))) fails.push('閉じるが効かない');
  await ctx.close();
}

// --- 2. 許可済みなら案内は出ず、現在地マーカーが出る ---
{
  const { ctx, page } = await newPage({ permissions: ['geolocation'], geolocation: { latitude: 36.3033, longitude: 139.2087 } });
  await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-locate');
  await page.click('#btn-locate');
  await page.waitForTimeout(1500);
  if (!(await page.$eval('#sheet-geo', (e) => e.hidden))) fails.push('許可済みなのに案内が出た');
  const marker = await page.$$('path.leaflet-interactive');
  const active = await page.$eval('#btn-locate', (e) => e.classList.contains('active'));
  if (!active) fails.push('許可済みなのに⌖がONにならない');
  if (!marker.length) fails.push('現在地マーカーが出ていない');
  // もう一度押すと止まる
  await page.click('#btn-locate');
  if (await page.$eval('#btn-locate', (e) => e.classList.contains('active'))) fails.push('2回目のタップで止まらない');
  await ctx.close();
}

// --- 3. 案内を閉じて許可を与え、再試行ボタンで復帰できる ---
{
  const { ctx, page } = await newPage();
  await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
  await page.click('#btn-locate');
  await page.waitForSelector('#sheet-geo:not([hidden])', { timeout: 30000 });
  await ctx.grantPermissions(['geolocation'], { origin: 'http://localhost:8776' });
  await ctx.setGeolocation({ latitude: 36.3033, longitude: 139.2087 });
  await page.click('#btn-geo-retry');
  await page.waitForTimeout(1500);
  if (!(await page.$eval('#sheet-geo', (e) => e.hidden))) fails.push('再試行後も案内が出たまま');
  if (!(await page.$eval('#btn-locate', (e) => e.classList.contains('active')))) fails.push('再試行で現在地がONにならない');
  await ctx.close();
}

await browser.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

// iOS Safari の手順分岐と、denied 即時案内の確認
import { chromium } from 'playwright';
const fails = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
const ctx = await b.newContext({
  viewport: { width: 390, height: 780 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
await page.addInitScript(() => {
  navigator.permissions.query = async () => ({ state: 'denied' });
  localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 }));
});
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
await page.click('#btn-locate');
await page.waitForSelector('#sheet-geo:not([hidden])', { timeout: 30000 });
const ms = Date.now() - t0;
const reason = await page.textContent('#geo-reason');
const steps = await page.$$eval('#geo-steps li', (e) => e.map((x) => x.textContent));
const fb = await page.textContent('#geo-fallback');
console.log(ms + 'ms', reason);
console.log(steps);
console.log(fb);
// Safariは許可状態を常に prompt と返すので先回りはせず、watchPosition の結果(または打ち切り)で案内する
console.log('診断:', await page.textContent('#geo-diag'));
if (!steps[0].includes('位置情報サービス')) fails.push('iOS Safari の手順になっていない');
if (!fb.includes('Webサイトの設定')) fails.push('iOS の補足が出ていない');
await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK');
process.exit(fails.length ? 1 : 0);

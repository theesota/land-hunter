// 写真のスライド表示と、虫眼鏡ボタンだけの検索
import { chromium } from 'playwright';
const fails = [];
const launch = { executablePath: '/opt/pw-browsers/chromium' };
if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' };
const b = await chromium.launch(launch);
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
await page.route('**/*', (r) => (/localhost|127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
await page.addInitScript(() => {
  localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 }));
  localStorage.setItem('tasobow.landscout.spots.v1', JSON.stringify([
    { id: 'a', lat: 36.3033, lng: 139.2087, name: '写真3枚の土地', status: 'interested', rating: 2, memo: '', url: '', roads: [], info: null, createdAt: 2, updatedAt: 2 },
  ]));
});
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-marker-icon');

// ---- 検索: 普段は虫眼鏡だけ ----
if (!(await page.isVisible('#btn-search-open'))) fails.push('虫眼鏡ボタンが出ていない');
if (await page.isVisible('#search-input')) fails.push('最初から検索欄が出ている');
await page.click('#btn-search-open');
if (!(await page.isVisible('#search-input'))) fails.push('虫眼鏡を押しても検索欄が出ない');
if (!(await page.evaluate(() => document.activeElement?.id === 'search-input'))) fails.push('検索欄にフォーカスが入らない');
await page.click('#btn-search-close');
if (await page.isVisible('#search-input')) fails.push('✕で検索欄が閉じない');
await page.click('#btn-search-open');
await page.mouse.click(200, 600); // 地図を触る
if (await page.isVisible('#search-input')) fails.push('地図を触っても検索欄が閉じない');
await page.waitForTimeout(300);
if (!(await page.$eval('#confirm-bar', (e) => e.hidden))) fails.push('検索を閉じるタップで登録確認が出てしまう');
await page.waitForTimeout(800);
await page.mouse.click(200, 600);
await page.waitForTimeout(300);
if (await page.$eval('#confirm-bar', (e) => e.hidden)) fails.push('閉じた後の普通の地図タップで登録確認が出ない');
await page.click('#btn-confirm-cancel');
await page.screenshot({ path: 'search-collapsed.png' });

// ---- 写真を3枚入れる(色違い) ----
await page.evaluate(async () => {
  const { addPhoto } = await import('/js/photos.js');
  for (const color of ['#c93b3b', '#1a6b52', '#2d5fc9']) {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 400, 300);
    await addPhoto('a', c.toDataURL('image/jpeg', 0.8));
    await new Promise((r) => setTimeout(r, 5));
  }
});

await page.click('#btn-menu'); await page.click('#btn-list');
await page.click('#spot-list .land-row:has-text("写真3枚の土地")');
await page.waitForSelector('#sheet-detail .popup-photos img');
const n = await page.$$eval('#sheet-detail .popup-photos img', (els) => els.length);
if (n !== 3) fails.push(`詳細のサムネが3枚でない: ${n}`);

// 2枚目のサムネから開く → 2 / 3
await page.click('#sheet-detail .popup-photos img >> nth=1');
await page.waitForSelector('#photo-viewer:not([hidden])');
await page.waitForTimeout(300);
let count = await page.textContent('#pv-count');
console.log('開いた直後:', count);
if (count !== '2 / 3') fails.push(`2枚目から開いていない: ${count}`);

// 横スクロール(スワイプ相当)で次へ
await page.mouse.move(195, 390);
await page.mouse.wheel(390, 0);
await page.waitForTimeout(900);
count = await page.textContent('#pv-count');
console.log('次へ:', count);
if (count !== '3 / 3') fails.push(`スワイプで次に進まない: ${count}`);

// 最後の写真では「次」矢印が消える
if (!(await page.$eval('#pv-next', (e) => e.hidden))) fails.push('最後の写真で次ボタンが残っている');

// 矢印キーで戻る
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(900);
count = await page.textContent('#pv-count');
console.log('←キー:', count);
if (count !== '2 / 3') fails.push(`←キーで戻らない: ${count}`);

// 1枚ずつ止まっているか(半端な位置で止まらない)
const off = await page.$eval('#pv-track', (t) => t.scrollLeft % t.clientWidth);
if (off > 2 && off < (await page.$eval('#pv-track', (t) => t.clientWidth)) - 2) fails.push(`半端な位置で止まっている: ${off}`);
await page.screenshot({ path: 'photo-slide.png' });

// 写真の外(黒い余白)タップで閉じる
await page.mouse.click(195, 740);
await page.waitForTimeout(200);
if (!(await page.$eval('#photo-viewer', (e) => e.hidden))) fails.push('余白タップで閉じない');

// ✕で閉じる
await page.click('#sheet-detail .popup-photos img >> nth=0');
await page.waitForSelector('#photo-viewer:not([hidden])');
if ((await page.textContent('#pv-count')) !== '1 / 3') fails.push('1枚目から開いていない');
await page.click('#pv-close');
if (!(await page.$eval('#photo-viewer', (e) => e.hidden))) fails.push('✕で閉じない');

await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

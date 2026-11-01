// 既定のベース地図が地理院「標準」か、切り替えと記憶が効くか、寄れる上限
import { chromium } from 'playwright';
const fails = [];
// 外部への通信はすべて route で塞ぐので、プロキシは通さない(通すとlocalhostまで届かなくなる)
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails.push('pageerror: ' + e.message); });
const tileHosts = new Set();
// タイルは外に出さず、どのURLを要求したかだけ記録する
await page.route(/cyberjapandata|tile\.openstreetmap\.jp|disaportaldata|fonts\.googleapis|overpass/, (r) => {
  tileHosts.add(r.request().url().replace(/\/\d+\/\d+\/\d+\.(png|jpg)$/, ''));
  return r.fulfill({ status: 404, body: '' });
});
await page.route('**/js/firebase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const FIREBASE_CONFIG={projectId:'__x__'};export function isConfigured(){return false;}` }));
// 古い既定(bright)が保存されている端末のつもりで開く
await page.addInitScript(() => {
  localStorage.setItem('tasobow.landscout.view.v1', JSON.stringify({ lat: 36.3033, lng: 139.2087, zoom: 16 }));
  // 初回だけ古い既定を仕込む(このスクリプトはリロードでも走るので、2回目は触らない)
  if (!localStorage.getItem('tasobow.landscout.basemapReset.std')) {
    localStorage.setItem('tasobow.landscout.basemap.v1', 'bright');
  }
});
await page.goto('http://localhost:8776/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#map.leaflet-container');
await page.waitForTimeout(1200);

const base = () => page.evaluate(() => localStorage.getItem('tasobow.landscout.basemap.v1'));
console.log('要求したタイル =', [...tileHosts]);
if (![...tileHosts].some((u) => u.includes('/xyz/std'))) fails.push('既定で地理院「標準」のタイルを読んでいない');

await page.click('#btn-layers');
await page.waitForSelector('#panel-layers:not([hidden])');
const chips = await page.locator('#basemap-chips .mini-chip').allTextContents();
const active = await page.locator('#basemap-chips .mini-chip.active').allTextContents();
console.log('ベース地図チップ =', chips, '/ 選択中 =', active);
if (chips.join() !== '標準,地図,淡色,写真') fails.push(`チップが想定と違う: ${chips}`);
if (active.join() !== '標準') fails.push(`既定の選択が標準でない: ${active}`);

// 自分で「写真」に切り替える → 保存され、リロードしても残る(1回だけのリセットが毎回走らない)
await page.click('#basemap-chips .mini-chip:has-text("写真")');
await page.waitForTimeout(400);
if ((await base()) !== 'photo') fails.push('切り替えが保存されない');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#map.leaflet-container');
await page.click('#btn-layers');
const active2 = await page.locator('#basemap-chips .mini-chip.active').allTextContents();
console.log('リロード後の選択 =', active2);
if (active2.join() !== '写真') fails.push(`リロードで選択が飛んだ: ${active2}`);

// 配信が18までのタイルでも20まで寄れる
// 配信が18までのタイルでも20まで寄れる(引き伸ばし)。ホイールで寄せてスケール表示の変化を見る
await page.click('.panel-close');
await page.mouse.move(195, 400);
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
await page.waitForTimeout(600);
const scale = await page.textContent('.leaflet-control-scale-line');
console.log('寄せた後のスケール =', scale);
if (!/^(5|10|20) m$/.test(scale.trim())) fails.push(`18より先に寄れていない可能性: スケール ${scale}`);

await b.close();
console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

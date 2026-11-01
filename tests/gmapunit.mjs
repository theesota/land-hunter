// ブラウザ不要。Google版(js/gmap.js)が Leaflet版(js/map.js)と同じ口を持っているかだけ見る。
// app.js は mapView.◯◯ を直に呼ぶので、1つ欠けるとその操作だけ実機で落ちる。
import { readFileSync } from 'node:fs';

const fails = [];
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../js/app.js');
const leaflet = read('../js/map.js');
const google = read('../js/gmap.js');

// app.js が mapView に対して使っているもの(メソッドもプロパティも)
const used = new Set([...app.matchAll(/mapView\.([a-zA-Z_]+)/g)].map((m) => m[1]));
// クラス本体で定義しているもの
const defined = (src) => new Set([
  ...[...src.matchAll(/^  (?:async )?([a-zA-Z_][a-zA-Z0-9_]*)\(/gm)].map((m) => m[1]),
  ...[...src.matchAll(/this\.([a-zA-Z_][a-zA-Z0-9_]*) =/g)].map((m) => m[1]),
]);
const inLeaflet = defined(leaflet);
const inGoogle = defined(google);

const missing = [...used].filter((n) => !inGoogle.has(n) && n !== 'constructor');
console.log('app.js が使う口 =', [...used].sort().join(', '));
if (missing.length) fails.push(`Google版に無い: ${missing.join(', ')}`);

// Leaflet版にあって Google版に無い公開メソッド(_ 始まりは内部なので除く)
const leafletOnly = [...inLeaflet].filter((n) => !n.startsWith('_') && !inGoogle.has(n) && n !== 'constructor');
if (leafletOnly.length) console.log('Leaflet版にだけあるもの(参考) =', leafletOnly.join(', '));

// 両方が createMapView を出しているか(app.js はこれで作る)
for (const [name, src] of [['map.js', leaflet], ['gmap.js', google]]) {
  if (!/export async function createMapView/.test(src)) fails.push(`${name} に createMapView が無い`);
}

// キーをうっかり実ファイルに書いたまま push しないための見張り
const cfg = read('../js/gmap-config.js');
const key = cfg.match(/GMAPS_KEY = '([^']*)'/);
if (key && key[1] && !/^AIza/.test(key[1])) fails.push('GMAPS_KEY の形が怪しい');
console.log('キー設定 =', key && key[1] ? '入っている' : '未設定(実機では動かない)');

console.log(fails.length ? 'NG\n' + fails.join('\n') : 'OK: すべて通過');
process.exit(fails.length ? 1 : 0);

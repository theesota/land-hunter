// タップした地点の「土地情報」を自動で集める。
// 住所(国土地理院 逆ジオコーダ)、学区(同梱GeoJSONの内外判定)、
// ハザード(配信タイルの色を読んで浸水深等を判定)、最寄り駅(同梱駅データから直線距離)。
// 全て並列で取りに行き、取れた項目から順に返す。

import { HAZARD_LAYERS, SCHOOL_LAYERS } from './config.js';

// 洪水・津波・高潮の浸水深と色の対応。
// 出典: 重ねるハザードマップ公式凡例(shinsui_legend3.png)から抽出し、実タイルの色と一致を確認済み。
const DEPTH_COLORS = [
  { rgb: [220, 122, 220], label: '20m以上' },
  { rgb: [242, 133, 201], label: '10〜20m' },
  { rgb: [255, 145, 145], label: '5〜10m' },
  { rgb: [255, 183, 183], label: '3〜5m' },
  { rgb: [255, 216, 192], label: '0.5〜3m' },
  { rgb: [247, 245, 169], label: '0.5m未満' },
];

// 徒歩分数の換算: 不動産表示規約と同じ80m=1分(直線距離ベースの目安)
const WALK_METERS_PER_MIN = 80;

const jsonCache = new Map();

function getJson(url) {
  if (!jsonCache.has(url)) {
    jsonCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`fetch failed: ${url}`);
      return r.json();
    }));
  }
  return jsonCache.get(url);
}

// ---- 住所 ----

export async function addressAt(lat, lng) {
  const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`);
  const data = await res.json();
  const r = data.results;
  if (!r || !r.muniCd) return null;
  const muni = await getJson('data/muni.json');
  const city = muni[String(r.muniCd).padStart(5, '0')] || '';
  const town = r.lv01Nm && r.lv01Nm !== '−' ? r.lv01Nm : '';
  return (city + town) || null;
}

// ---- 学区(点のポリゴン内外判定) ----

function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inFeature(lat, lng, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    if (!inRing(lat, lng, poly[0])) continue;
    // 穴(内側リング)に入っていたら外
    if (poly.slice(1).some((hole) => inRing(lat, lng, hole))) continue;
    return true;
  }
  return false;
}

export async function schoolsAt(lat, lng) {
  const names = [];
  for (const def of SCHOOL_LAYERS) {
    try {
      const gj = await getJson(def.file);
      const hit = gj.features.find((f) => inFeature(lat, lng, f.geometry));
      if (hit) names.push(hit.properties.name);
    } catch { /* データ未整備エリアは黙ってスキップ */ }
  }
  return names;
}

// ---- ハザード(タイルの色を読む) ----

async function samplePixel(urlTemplate, lat, lng, z = 16) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const url = urlTemplate.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
  const res = await fetch(url);
  if (!res.ok) return null; // 404 = このタイルに指定区域なし
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, -Math.floor((x - tx) * 256), -Math.floor((y - ty) * 256));
  bmp.close();
  return ctx.getImageData(0, 0, 1, 1).data; // [r,g,b,a]
}

function depthLabel(px) {
  for (const { rgb, label } of DEPTH_COLORS) {
    if (Math.abs(px[0] - rgb[0]) < 30 && Math.abs(px[1] - rgb[1]) < 30 && Math.abs(px[2] - rgb[2]) < 30) {
      return label;
    }
  }
  return '想定あり(深さ不明)';
}

// 戻り値: 該当ハザードの文字列配列。全レイヤの取得に失敗したら判定不可としてnull。
// (通信エラーを「該当なし」と誤表示しないための区別)
export async function hazardsAt(lat, lng) {
  const depthLayerIds = new Set(['flood', 'tsunami', 'takashio']);
  let failed = 0;
  const results = await Promise.all(HAZARD_LAYERS.map(async (def) => {
    try {
      const px = await samplePixel(def.url, lat, lng);
      if (!px || px[3] === 0) return null;
      const short = def.label.replace(/\(.*\)/, '');
      return depthLayerIds.has(def.id) ? `${short}: ${depthLabel(px)}` : `${short}: 該当`;
    } catch {
      failed++;
      return null;
    }
  }));
  if (failed === HAZARD_LAYERS.length) return null;
  return results.filter(Boolean);
}

// ---- 最寄り駅 ----

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function nearestStationAt(lat, lng) {
  const stations = await getJson('data/stations.json');
  let best = null;
  let bestDist = Infinity;
  for (const st of stations) {
    const d = distanceMeters(lat, lng, st.lat, st.lng);
    if (d < bestDist) {
      bestDist = d;
      best = st;
    }
  }
  if (!best) return null;
  const walkMin = Math.ceil(bestDist / WALK_METERS_PER_MIN);
  return { name: best.n, line: best.l, meters: Math.round(bestDist), walkMin };
}

// ---- まとめて取得 ----

// onUpdate(partialInfo)を項目が取れるたびに呼ぶ。最終的な確定値も返す。
export function collectLandInfo(lat, lng, onUpdate) {
  const info = {};
  const tasks = [
    addressAt(lat, lng).then((v) => { if (v) info.address = v; }),
    schoolsAt(lat, lng).then((v) => { if (v.length) info.school = v.join(' / '); }),
    hazardsAt(lat, lng).then((v) => {
      if (v !== null) info.hazard = v.length ? v.join('、') : '主要ハザード該当なし';
    }),
    nearestStationAt(lat, lng).then((v) => {
      if (v) info.station = `${v.name}駅(${v.line}) 徒歩約${v.walkMin}分`;
    }),
  ].map((p) => p.catch(() => {}).then(() => onUpdate && onUpdate(info)));
  return Promise.all(tasks).then(() => info);
}

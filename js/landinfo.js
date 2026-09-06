// タップした地点の「土地情報」を自動で集める。
// 住所(国土地理院 逆ジオコーダ)、学区(同梱GeoJSONの内外判定)、
// ハザード(配信タイルの色を読んで浸水深等を判定)、最寄り駅(同梱駅データから直線距離)。
// 全て並列で取りに行き、取れた項目から順に返す。

import { HAZARD_LAYERS, SCHOOL_LAYERS } from './config.js';

// 洪水・津波・高潮の浸水深と色の対応。
// 出典: 重ねるハザードマップ公式凡例(shinsui_legend3.png)から抽出し、実タイルの色と一致を確認済み。
// noteは生活実感の目安(凡例パンフレットの一般的説明に基づく)。
export const DEPTH_COLORS = [
  { rgb: [220, 122, 220], label: '20m以上', note: '2階以上が水没する目安' },
  { rgb: [242, 133, 201], label: '10〜20m', note: '2階以上が水没する目安' },
  { rgb: [255, 145, 145], label: '5〜10m', note: '2階以上が水没する目安' },
  { rgb: [255, 183, 183], label: '3〜5m', note: '2階まで浸水する目安' },
  { rgb: [255, 216, 192], label: '0.5〜3m', note: '1階が浸水する目安' },
  { rgb: [247, 245, 169], label: '0.5m未満', note: '床下浸水の目安' },
];

// 土砂災害警戒区域の色(種類ごとに公式凡例+実タイルで確認済み)
// 赤系=特別警戒区域(レッドゾーン: 建築規制あり)、黄系=警戒区域(イエローゾーン)
const DOSHA_COLORS = {
  dosekiryu: { special: [165, 0, 33], warning: [230, 200, 50] },
  kyukeisha: { special: [250, 40, 0], warning: [250, 230, 0] },
  jisuberi: { special: [180, 0, 40], warning: [255, 153, 0] },
};

// 徒歩分数の換算: 不動産表示規約と同じ80m=1分(直線距離ベースの目安)
const WALK_METERS_PER_MIN = 80;

// 車分数の簡易目安: 直線距離×1.3(道のり補正)を市街地平均30km/h(=500m/分)で換算。
// あくまで目安で、正確な所要時間はGoogleマップの車ルートリンクで確認する前提。
export function carMinutes(meters) {
  return Math.max(1, Math.ceil((meters * 1.3) / 500));
}

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
  const results = [];
  let points = [];
  try {
    points = await getJson('data/school/isesaki_school_points.json');
  } catch { /* 位置データがなければ校名のみ */ }
  for (const def of SCHOOL_LAYERS) {
    try {
      const gj = await getJson(def.file);
      const hit = gj.features.find((f) => inFeature(lat, lng, f.geometry));
      if (!hit) continue;
      const name = hit.properties.name;
      const pt = points.find((sp) => sp.n === name);
      if (pt) {
        const walkMin = Math.ceil(distanceMeters(lat, lng, pt.lat, pt.lng) / WALK_METERS_PER_MIN);
        results.push(`${name}(徒歩約${walkMin}分)`);
      } else {
        results.push(name);
      }
    } catch { /* データ未整備エリアは黙ってスキップ */ }
  }
  return results;
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

function toHex(px) {
  return `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function nearColor(px, rgb, tol = 30) {
  return Math.abs(px[0] - rgb[0]) < tol && Math.abs(px[1] - rgb[1]) < tol && Math.abs(px[2] - rgb[2]) < tol;
}

function depthEntry(px) {
  for (const { rgb, label, note } of DEPTH_COLORS) {
    if (nearColor(px, rgb)) return { label, note };
  }
  return { label: '想定あり(深さ不明)', note: null };
}

function doshaLevel(px, layerId) {
  const colors = DOSHA_COLORS[layerId];
  if (colors && nearColor(px, colors.special)) return '特別警戒区域(赤)';
  if (colors && nearColor(px, colors.warning)) return '警戒区域(黄)';
  return '該当';
}

// 戻り値: 該当ハザードの配列 [{t: 表示文, c: 地図上の色, n: 目安}]。
// 全レイヤの取得に失敗したら判定不可としてnull(通信エラーを「該当なし」と誤表示しない)。
export async function hazardsAt(lat, lng) {
  const depthLayerIds = new Set(['flood', 'tsunami', 'takashio']);
  let failed = 0;
  const results = await Promise.all(HAZARD_LAYERS.map(async (def) => {
    try {
      const px = await samplePixel(def.url, lat, lng);
      if (!px || px[3] === 0) return null;
      const short = def.label.replace(/\(.*\)/, '');
      const c = toHex(px);
      if (depthLayerIds.has(def.id)) {
        const { label, note } = depthEntry(px);
        return { t: `${short}: ${label}`, c, n: note };
      }
      return { t: `${short}: ${doshaLevel(px, def.id)}`, c, n: null };
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

// ---- 周辺施設(OpenStreetMapのPOIをOverpass APIから取得) ----

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FACILITY_LABELS = {
  supermarket: 'スーパー',
  convenience: 'コンビニ',
  chemist: 'ドラッグストア',
  mall: '商業施設',
  department_store: '商業施設',
};

// 半径1.2km内の店舗を検索し、種類ごとに最寄りの1件を返す
export async function facilitiesAt(lat, lng) {
  const query = `[out:json][timeout:8];nwr(around:1200,${lat},${lng})[shop~"^(supermarket|convenience|chemist|mall|department_store)$"];out center 60;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const best = new Map(); // ラベル -> {name, meters}
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const label = FACILITY_LABELS[tags.shop];
      const name = tags.name || tags['name:ja'] || tags.brand;
      const pLat = el.lat ?? el.center?.lat;
      const pLng = el.lon ?? el.center?.lon;
      if (!label || !name || pLat === undefined) continue;
      const meters = distanceMeters(lat, lng, pLat, pLng);
      if (!best.has(label) || meters < best.get(label).meters) {
        best.set(label, { name, meters });
      }
    }
    return [...best.entries()].map(([label, { name, meters }]) => {
      const walkMin = Math.ceil(meters / WALK_METERS_PER_MIN);
      return `${label}: ${name}(徒歩約${walkMin}分)`;
    });
  } catch {
    return null; // 取得失敗は「なし」ではなく判定不可
  } finally {
    clearTimeout(timer);
  }
}

// ---- まとめて取得 ----

// onUpdate(partialInfo)を項目が取れるたびに呼ぶ。最終的な確定値も返す。
export function collectLandInfo(lat, lng, onUpdate) {
  const info = {};
  const tasks = [
    addressAt(lat, lng).then((v) => { if (v) info.address = v; }),
    schoolsAt(lat, lng).then((v) => { if (v.length) info.school = v.join(' / '); }),
    hazardsAt(lat, lng).then((v) => {
      if (v !== null) {
        info.hz = v;
        info.hazard = v.length ? v.map((h) => h.t).join('、') : '主要ハザード該当なし';
      }
    }),
    nearestStationAt(lat, lng).then((v) => {
      if (v) info.station = `${v.name}駅(${v.line}) 徒歩約${v.walkMin}分・車約${carMinutes(v.meters)}分`;
    }),
    facilitiesAt(lat, lng).then((v) => {
      if (v !== null) info.facility = v.length ? v.join(' / ') : '徒歩15分圏に主要店舗なし';
    }),
  ].map((p) => p.catch(() => {}).then(() => onUpdate && onUpdate(info)));
  return Promise.all(tasks).then(() => info);
}

// ハザード表示用HTML。地図と同じ色のチップ+生活実感の目安を添える。
export function hazardHtml(info) {
  if (!info) return '-';
  if (Array.isArray(info.hz) && info.hz.length) {
    return info.hz.map((h) => {
      const note = h.n ? `<small class="hz-note">${escapeText(h.n)}</small>` : '';
      return `<span class="hz-item"><i class="hz-swatch" style="background:${escapeText(h.c)}"></i>${escapeText(h.t)}${note}</span>`;
    }).join('');
  }
  if (info.hazard === '主要ハザード該当なし') {
    return '<span class="hz-item hz-safe">✓ 主要ハザード該当なし</span>';
  }
  return info.hazard ? escapeText(info.hazard) : '-';
}

function escapeText(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

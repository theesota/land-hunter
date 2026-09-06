// 地点データの保持と永続化。
// データは端末のlocalStorageに保存し、共有はshare.jsのリンク経由でマージする。
// 同じidの地点はupdatedAtが新しい方を採用する(=後から編集した内容が勝つ)。

const SPOTS_KEY = 'tasobow.landscout.spots.v1';
const VIEW_KEY = 'tasobow.landscout.view.v1';
const BASEMAP_KEY = 'tasobow.landscout.basemap.v1';

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadSpots() {
  try {
    const raw = localStorage.getItem(SPOTS_KEY);
    const spots = raw ? JSON.parse(raw) : [];
    return Array.isArray(spots) ? spots.filter(isValidSpot) : [];
  } catch {
    return [];
  }
}

function saveSpots(spots) {
  localStorage.setItem(SPOTS_KEY, JSON.stringify(spots));
}

export function isValidSpot(s) {
  return s && typeof s.id === 'string'
    && Number.isFinite(s.lat) && Number.isFinite(s.lng)
    && typeof s.name === 'string';
}

export function createSpot({ lat, lng, name, status, rating, memo, url, info }) {
  const now = Date.now();
  return {
    id: genId(),
    lat: +lat.toFixed(6),
    lng: +lng.toFixed(6),
    name: name || '',
    status: status || 'interested',
    rating: rating || 0,
    memo: memo || '',
    url: url || '',
    info: info || null, // 登録時に自動取得した土地情報(住所/学区/駅/ハザード)
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertSpot(spots, spot) {
  const next = spots.filter((s) => s.id !== spot.id);
  next.push({ ...spot, updatedAt: Date.now() });
  saveSpots(next);
  return next;
}

export function removeSpot(spots, id) {
  const next = spots.filter((s) => s.id !== id);
  saveSpots(next);
  return next;
}

// 共有リンク/JSONからの取り込み。戻り値は { spots, added, updated }。
export function mergeSpots(spots, incoming) {
  const byId = new Map(spots.map((s) => [s.id, s]));
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    if (!isValidSpot(inc)) continue;
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      added++;
    } else if ((inc.updatedAt || 0) > (cur.updatedAt || 0)) {
      byId.set(inc.id, inc);
      updated++;
    }
  }
  const next = [...byId.values()];
  saveSpots(next);
  return { spots: next, added, updated };
}

// 最後に見ていた地図位置(次回起動時の初期表示に使う)
export function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}

export function saveView(view) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(view));
}

// ベース地図の選択(次回起動時も引き継ぐ)
export function loadBasemap() {
  return localStorage.getItem(BASEMAP_KEY);
}

export function saveBasemap(key) {
  localStorage.setItem(BASEMAP_KEY, key);
}

// 地点データの保持と永続化。
// 端末内保存(クラウド同期のオフラインキャッシュ、および未接続時の保存先)。
// 共有はdata.js/sync.js(Firestore)が担当する。

const SPOTS_KEY = 'tasobow.landscout.spots.v1';
const VIEW_KEY = 'tasobow.landscout.view.v1';
const BASEMAP_KEY = 'tasobow.landscout.basemap.v1';
const ENABLED_KEY = 'tasobow.landhunter.enabled.v1';

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

// クラウド同期時のオフライン用キャッシュ書き込み
export function saveSpotsLocal(spots) {
  saveSpots(spots);
}

export function isValidSpot(s) {
  return s && typeof s.id === 'string'
    && Number.isFinite(s.lat) && Number.isFinite(s.lng)
    && typeof s.name === 'string';
}

export function createSpot({ lat, lng, name, status, rating, memo, url, info, roads, address, area, price, water, sewer }) {
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
    roads: roads || [], // 接道方角 north/east/south/west の配列
    address: address || '', // 手で直した住所(空なら info.address を使う)
    area: area || null,   // 坪数
    price: price || null, // 売り値(万円)
    water: water || '',   // 上水道 '' | 'yes' | 'no'
    sewer: sewer || '',   // 下水道 '' | 'yes' | 'no'
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

// 表示パネルに並べる項目(設定で選ぶ)。未設定ならnullを返し、呼び出し側が既定値を使う。
export function loadEnabledLayers() {
  try {
    const v = JSON.parse(localStorage.getItem(ENABLED_KEY));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveEnabledLayers(ids) {
  localStorage.setItem(ENABLED_KEY, JSON.stringify(ids));
}

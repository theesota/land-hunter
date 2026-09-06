// 共有リンクとJSON入出力。
// リンク方式: 全地点をタプル配列に圧縮 → JSON → UTF-8 → base64url → URLのハッシュに載せる。
// サーバー不要で「リンクを送るだけ」で共有できるのが狙い。地点数が数十件ならURL長も実用範囲。

import { isValidSpot } from './store.js';

const HASH_PREFIX = '#s=';

// キー名を落としてサイズを約半分にする
function toTuple(s) {
  return [s.id, s.lat, s.lng, s.name, s.status, s.rating, s.memo, s.createdAt, s.updatedAt, s.url || ''];
}

function fromTuple(t) {
  if (!Array.isArray(t) || t.length < 9) return null;
  const [id, lat, lng, name, status, rating, memo, createdAt, updatedAt, url] = t;
  const s = { id, lat, lng, name, status, rating, memo, createdAt, updatedAt, url: url || '' };
  return isValidSpot(s) ? s : null;
}

function encodeBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildShareUrl(spots) {
  const payload = encodeBase64Url(JSON.stringify(spots.map(toTuple)));
  return `${location.origin}${location.pathname}${HASH_PREFIX}${payload}`;
}

// URLハッシュに共有データがあれば地点配列を返す。なければnull。
export function parseShareHash() {
  if (!location.hash.startsWith(HASH_PREFIX)) return null;
  try {
    const tuples = JSON.parse(decodeBase64Url(location.hash.slice(HASH_PREFIX.length)));
    if (!Array.isArray(tuples)) return null;
    return tuples.map(fromTuple).filter(Boolean);
  } catch {
    return null;
  }
}

export function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

// 写真も含めた完全バックアップ(v2形式)。旧形式(地点配列のみ)の読み込みにも対応する。
export function exportJson(spots, photos = []) {
  const payload = { version: 2, spots, photos };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `land-spots-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 戻り値: { spots, photos }
export function importJsonFile(file) {
  return file.text().then((text) => {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return { spots: data.filter(isValidSpot), photos: [] };
    if (data && Array.isArray(data.spots)) {
      return { spots: data.spots.filter(isValidSpot), photos: Array.isArray(data.photos) ? data.photos : [] };
    }
    throw new Error('unknown format');
  });
}

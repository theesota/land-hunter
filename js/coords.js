// 検索欄に貼られた「緯度経度っぽい文字列」を座標に直す。
// Googleマップから送られてくる形式(度分秒 / 10進 / 共有URL)をそのまま受け付けるため。
// DOMに依存しない純粋な関数だけを置く。

const toHalf = (s) => s.replace(/[０-９．，－]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

export function parseCoords(text) {
  if (!text) return null;
  const s = toHalf(String(text)).trim();
  return fromUrl(s) || fromDms(s) || fromDecimal(s);
}

function valid(lat, lng) {
  const ok = Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  return ok ? { lat, lng } : null;
}

// Googleマップの共有URL: .../@36.29,139.21,17z / ?q=36.29,139.21 / query= / ll= / destination=
function fromUrl(s) {
  if (!/^https?:\/\//i.test(s)) return null;
  const m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    || s.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i);
  return m ? valid(+m[1], +m[2]) : null;
}

// 36°17'49.2"N 139°12'28.8"E  (記号のゆれ ′ ″ ’ ” も許す)
function fromDms(s) {
  const re = /(\d{1,3})[°º]\s*(\d{1,2})['′’]\s*(\d{1,2}(?:\.\d+)?)?["″”]?\s*([NSEW])/gi;
  const parts = [...s.matchAll(re)];
  if (parts.length < 2) return null;
  let lat = null;
  let lng = null;
  for (const [, d, m, sec, h] of parts) {
    const v = (+d + (+m) / 60 + (sec ? +sec : 0) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
    if (/[NS]/i.test(h)) lat = v; else lng = v;
  }
  return lat !== null && lng !== null ? valid(lat, lng) : null;
}

// 36.297, 139.208 / 36.297 139.208
function fromDecimal(s) {
  const m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  let a = +m[1];
  let b = +m[2];
  // 経度が先に書かれていても救う(日本なら経度 > 90 > 緯度)
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  return valid(a, b);
}

// 郵便番号は国土地理院の住所検索を空振りさせるので落とす。全角数字はそのままで通る。
export function normalizeAddress(text) {
  return String(text).replace(/〒?\s*[0-9０-９]{3}[-‐－ー]?[0-9０-９]{4}\s*/g, '').trim();
}

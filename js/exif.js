// JPEGのEXIFからGPS(緯度経度)だけを読む最小パーサー。
// ライブラリを入れるほどの量ではないので自前で持つ。JPEG以外(HEIC等)はnull。
// 注意: iOSのSafariで「カメラで撮る」を選ぶと位置情報は入ってこない(OS側で落とされる)。
// 写真ライブラリから選んだ写真には残る。呼び出し側はnullのときの逃げ道を用意すること。

export async function readGps(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null; // JPEGではない
    let off = 2;
    while (off + 4 <= v.byteLength) {
      if (v.getUint8(off) !== 0xFF) return null;
      const marker = v.getUint8(off + 1);
      const len = v.getUint16(off + 2);
      if (marker === 0xE1 && ascii(v, off + 4, 6) === 'Exif\0\0') {
        return parseTiff(new DataView(buf, off + 10, Math.min(len - 8, v.byteLength - off - 10)));
      }
      if (marker === 0xDA) return null; // 画像データに入ったら以後EXIFは無い
      off += 2 + len;
    }
  } catch { /* 壊れたファイルは位置なし扱い */ }
  return null;
}

function ascii(v, off, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(off + i));
  return s;
}

function parseTiff(t) {
  const le = t.getUint16(0) === 0x4949; // "II" = リトルエンディアン
  const u16 = (o) => t.getUint16(o, le);
  const u32 = (o) => t.getUint32(o, le);
  if (u16(2) !== 0x2A) return null;
  const ifd0 = u32(4);
  const gpsOff = findTag(t, ifd0, 0x8825, u16, u32);
  if (!gpsOff) return null;
  const gps = readIfd(t, gpsOff, u16, u32);
  const latRef = gps.get(1), lat = gps.get(2), lngRef = gps.get(3), lng = gps.get(4);
  if (!lat || !lng) return null;
  const toDeg = (r) => r[0] + r[1] / 60 + r[2] / 3600;
  const la = toDeg(lat) * (latRef === 'S' ? -1 : 1);
  const ln = toDeg(lng) * (lngRef === 'W' ? -1 : 1);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null;
  return { lat: la, lng: ln };
}

function findTag(t, ifd, wanted, u16, u32) {
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (u16(e) === wanted) return u32(e + 8);
  }
  return 0;
}

// GPS IFDの中で必要なタグだけ取り出す。1/3=方位(ASCII), 2/4=度分秒(RATIONAL×3)
function readIfd(t, ifd, u16, u32) {
  const out = new Map();
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    if ((tag === 1 || tag === 3) && type === 2) {
      out.set(tag, String.fromCharCode(t.getUint8(e + 8))); // 4バイト以内なので値がその場にある
    } else if ((tag === 2 || tag === 4) && type === 5 && count === 3) {
      const p = u32(e + 8);
      const vals = [];
      for (let k = 0; k < 3; k++) {
        const num = u32(p + k * 8);
        const den = u32(p + k * 8 + 4);
        vals.push(den ? num / den : 0);
      }
      out.set(tag, vals);
    }
  }
  return out;
}

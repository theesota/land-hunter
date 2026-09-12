import { parseCoords, normalizeAddress } from '../js/coords.js';
const cases = [
  ['36°17\'49.2"N 139°12\'28.8"E', 36.29700, 139.20800],
  ['36°17′49.2″N 139°12′28.8″E', 36.29700, 139.20800],
  ['36.2970, 139.2080', 36.2970, 139.2080],
  ['36.2970 139.2080', 36.2970, 139.2080],
  ['139.2080, 36.2970', 36.2970, 139.2080],
  ['３６.２９７０，１３９.２０８０', 36.2970, 139.2080],
  ['https://www.google.com/maps/place/%E7%BE%A4%E9%A6%AC/@36.297,139.208,17z/data=xx', 36.297, 139.208],
  ['https://maps.google.com/?q=36.297,139.208', 36.297, 139.208],
  ['https://www.google.com/maps/search/?api=1&query=36.297%2C139.208', 36.297, 139.208],
];
let ng = 0;
for (const [s, lat, lng] of cases) {
  const r = parseCoords(s);
  const ok = r && Math.abs(r.lat - lat) < 1e-4 && Math.abs(r.lng - lng) < 1e-4;
  if (!ok) { ng++; console.log('NG', s, r); }
}
for (const s of ['伊勢崎市北千木町', '本庄駅', '2066-1', 'https://suumo.jp/x']) {
  if (parseCoords(s)) { ng++; console.log('NG(座標扱いされた)', s); }
}
const n = normalizeAddress('〒372-0032 群馬県伊勢崎市北千木町２０６６－１');
if (n !== '群馬県伊勢崎市北千木町２０６６－１') { ng++; console.log('NG normalize', JSON.stringify(n)); }
console.log(ng ? 'UNIT NG' : 'UNIT OK');

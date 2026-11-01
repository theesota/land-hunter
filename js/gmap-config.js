// Google Maps Platform の設定。フロントに出る値なので秘密ではない。
// 代わりに Cloud Console 側で必ず制限をかけること:
//   アプリケーションの制限 = HTTPリファラー (https://theesota.github.io/* と http://localhost:8776/*)
//   APIの制限 = Maps JavaScript API だけ
// MAP_ID はベクター地図のID。これが無いと AdvancedMarkerElement が使えず、
// 寄ったときの鮮明さ(ベクター描画)も出ない。
export const GMAPS_KEY = '';
export const GMAPS_MAP_ID = '';

export function isGmapsConfigured() {
  return !!GMAPS_KEY && !!GMAPS_MAP_ID;
}

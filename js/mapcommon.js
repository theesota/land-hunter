// 地図エンジン(Leaflet / Google Maps)に依存しない共通部分。
// 詳細シートのHTML、距離の計算、エスケープ。どちらのMapViewからも同じものを使う。

import { statusById, listingSearchUrl } from './config.js';
import { carMinutes, landInfoRows } from './landinfo.js';

export const ROAD_LABELS = { north: '北', east: '東', south: '南', west: '西' };

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 2点間の直線距離(m)。Leafletのmap.distanceと同じHaversine。
// 地図エンジンに頼らないので、Google側でも同じ数字が出る。
export function distanceMeters(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 距離+徒歩/車の目安。徒歩は30分(2.4km)を超えたら現実的でないので省く。
// 距離と時間を別々に返す(詳細では列を揃えて並べる)
export function distanceParts(a, b) {
  const d = distanceMeters(a, b);
  const dist = d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
  const walk = d <= 2400 ? `徒歩${Math.ceil(d / 80)}分・` : '';
  return { dist, time: `${walk}車${carMinutes(d)}分` };
}

// 詳細シートの中身。クラス名は以前のポップアップ用CSSをそのまま使う。
// spots = 全地点(基準地点までの距離を出すため)、schoolKinds = 表示ONの学区の種類。
export function detailHtml(spot, { spots = [], schoolKinds } = {}) {
  const st = statusById(spot.status);
  const stars = spot.rating ? '★'.repeat(spot.rating) : '';
  // Google公式のMaps URLs形式。その地点のストリートビューを直接開く。
  const streetview = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${spot.lat},${spot.lng}`;
  const memo = spot.memo ? `<p class="popup-memo">${escapeHtml(spot.memo)}</p>` : '';
  const roads = (spot.roads || []).map((d) => ROAD_LABELS[d]).filter(Boolean);
  const rowsHtml = landInfoRows(spot.info, { address: spot.address, schoolKinds, roads, deal: spot });
  const infoHtml = rowsHtml ? `<div class="popup-info">${rowsHtml}</div>` : '';
  // 基準地点(自宅・駅など)までの直線距離。基準地点自身の詳細には出さない。
  const refs = spots.filter((s) => s.status === 'reference' && s.id !== spot.id);
  const dists = spot.status !== 'reference' && refs.length
    ? `<div class="popup-dists dist-grid">${refs.map((r) => {
      const drive = `https://www.google.com/maps/dir/?api=1&origin=${r.lat},${r.lng}&destination=${spot.lat},${spot.lng}&travelmode=driving`;
      const { dist, time } = distanceParts(spot, r);
      return `<span class="d-name">${escapeHtml(r.name)}</span><span class="d-km">${dist}</span><span class="d-time">${time}</span><a href="${drive}" target="_blank" rel="noopener" class="popup-drive">車ルート</a>`;
    }).join('')}</div>` : '';
  // 物件URLがあればそれ。無ければ住所で「探す」リンク(売り出し中と断定はしない)
  const addr = spot.address || (spot.info && spot.info.address) || '';
  const listing = spot.url
    ? `<a href="${escapeHtml(spot.url)}" target="_blank" rel="noopener" class="popup-listing">物件ページ</a>`
    : (addr ? `<a href="${listingSearchUrl(addr)}" target="_blank" rel="noopener" class="popup-listing ghost">売地をネットで探す</a>` : '');
  return `
      <div class="popup">
        <strong>${escapeHtml(spot.name)}</strong>
        <div class="popup-meta">
          <span class="popup-status" style="background:${st.color}">${st.label}</span>
          <span class="popup-stars">${stars}</span>
        </div>
        ${infoHtml}
        ${memo}
        ${dists}
        <div class="popup-photos" data-spot-id="${spot.id}"></div>
        ${listing}
        <div class="popup-links">
          <a href="${streetview}" target="_blank" rel="noopener">ストリートビュー</a>
        </div>
        <button type="button" class="popup-edit">編集</button>
      </div>`;
}

// 学区・用途地域・区域区分の面の塗り。Leaflet/Google どちらにも同じ値を渡す。
// 返すのは { stroke, weight, fill, fillOpacity, dash } の素の値。
export function zoneStyle(def, props, YOUTO_COLORS) {
  if (def.id === 'youto') {
    const col = YOUTO_COLORS[props.c] || '#ddd';
    return { stroke: col, weight: 1, fill: col, fillOpacity: 0.35, dash: null };
  }
  if (def.kind === 'zone') {
    return props.layer === 2
      ? { stroke: def.color, weight: 2, fill: def.color, fillOpacity: 0.10, dash: '6 4' }
      : { stroke: def.color, weight: 1, fill: def.color, fillOpacity: 0, dash: '2 4' };
  }
  return { stroke: def.color, weight: 2, fill: def.color, fillOpacity: 0.06, dash: '4 3' };
}

// 面に出すラベルの文字。無ければ空文字。
export function zoneLabel(def, props) {
  if (def.id === 'youto') return `${props.n.replace(/地域$/, '')} ${props.bcr}/${props.far}`;
  if (def.kind === 'zone') return props.layer === 2 ? '市街化調整区域' : '';
  return props.name || '';
}

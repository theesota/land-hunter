// Leaflet地図の管理: ベース地図、ハザードオーバーレイ、地点マーカー、現在地追跡。
// UIイベントとの結線はapp.js側。ここは地図APIの薄いラッパーに徹する。

import {
  BASE_MAPS, HAZARD_LAYERS, HAZARD_ATTRIBUTION, HAZARD_MAX_NATIVE_ZOOM,
  SCHOOL_LAYERS, ZONE_LAYERS, DEFAULT_VIEW, DEFAULT_BASEMAP, statusById,
} from './config.js';
import { loadView, saveView, loadBasemap, saveBasemap } from './store.js';
import { hazardHtml, carMinutes, landInfoRows } from './landinfo.js';

const ROAD_LABELS = { north: '北', east: '東', south: '南', west: '西' };

export class MapView {
  constructor(containerId, { onMapClick, onMarkerSelect, onLocationClick }) {
    const saved = loadView();
    this.hadSavedView = !!saved;
    const view = saved || DEFAULT_VIEW;
    this.map = L.map(containerId, { zoomControl: false }).setView([view.lat, view.lng], view.zoom);
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);
    L.control.scale({ imperial: false }).addTo(this.map);

    this.baseLayers = {};
    for (const [key, def] of Object.entries(BASE_MAPS)) {
      this.baseLayers[key] = L.tileLayer(def.url, {
        attribution: def.attribution,
        maxZoom: def.maxZoom,
      });
    }
    this.currentBasemap = BASE_MAPS[loadBasemap()] ? loadBasemap() : DEFAULT_BASEMAP;
    this.baseLayers[this.currentBasemap].addTo(this.map);

    this.hazardOpacity = 0.75; // 固定(UIでの調整は廃止)
    this.hazardLayers = {};
    for (const def of HAZARD_LAYERS) {
      this.hazardLayers[def.id] = L.tileLayer(def.url, {
        attribution: HAZARD_ATTRIBUTION,
        maxNativeZoom: HAZARD_MAX_NATIVE_ZOOM,
        maxZoom: 18,
        opacity: this.hazardOpacity,
      });
      if (def.defaultOn) this.hazardLayers[def.id].addTo(this.map);
    }

    this.schoolLayers = new Map(); // id -> {polygons, labels, visible}(初回表示時に読み込む)
    // ズームを引いたときは学校名ラベルを消して地図の見通しを保つ
    this.map.on('zoomend', () => this._updateSchoolLabels());

    this.markers = new Map(); // spot.id -> L.Marker
    this.onMarkerSelect = onMarkerSelect;
    this.onLocationClick = onLocationClick;
    this.currentLatLng = null;

    this.map.on('click', (e) => onMapClick(e.latlng));
    this.map.on('moveend', () => {
      const c = this.map.getCenter();
      saveView({ lat: c.lat, lng: c.lng, zoom: this.map.getZoom() });
    });

    this.locationMarker = null;
    this.accuracyCircle = null;
    this.watchId = null;
  }

  setBaseMap(key) {
    for (const layer of Object.values(this.baseLayers)) this.map.removeLayer(layer);
    this.baseLayers[key].addTo(this.map);
    this.currentBasemap = key;
    saveBasemap(key);
  }

  setHazardVisible(id, visible) {
    const layer = this.hazardLayers[id];
    if (visible) layer.addTo(this.map);
    else this.map.removeLayer(layer);
  }

  // 学区レイヤの表示切替。GeoJSONは初回だけfetchしてキャッシュする。
  async setSchoolVisible(id, visible) {
    let entry = this.schoolLayers.get(id);
    if (!entry) {
      const def = [...SCHOOL_LAYERS, ...ZONE_LAYERS].find((d) => d.id === id);
      const res = await fetch(def.file);
      const geojson = await res.json();
      const labels = L.layerGroup();
      const isZone = def.kind === 'zone';
      // interactive:false が重要。校区の面がタップを吸うと、学区表示中に
      // 地図をタップして地点登録ができなくなる(校名はラベルで確認できる)。
      const polygons = L.geoJSON(geojson, {
        interactive: false,
        // 区域区分は「調整区域」だけを目立たせる。市街化区域は境界線のみ薄く。
        style: (feature) => (isZone
          ? (feature.properties.layer === 2
            ? { color: def.color, weight: 2, fillColor: def.color, fillOpacity: 0.10, dashArray: '6 4' }
            : { color: def.color, weight: 1, fillOpacity: 0, dashArray: '2 4', opacity: 0.5 })
          : { color: def.color, weight: 2, fillColor: def.color, fillOpacity: 0.06, dashArray: '4 3' }),
        filter: (feature) => !isZone || feature.properties.layer === 1 || feature.properties.layer === 2,
        onEachFeature: (feature, l) => {
          const text = isZone
            ? (feature.properties.layer === 2 ? '市街化調整区域' : '')
            : feature.properties.name;
          if (!text) return;
          // 面の中心にラベル。中心置きなら形が歪な区域でもエリア外に出にくい。
          labels.addLayer(L.marker(l.getBounds().getCenter(), {
            interactive: false,
            icon: L.divIcon({
              className: 'school-label-wrap',
              iconSize: null,
              html: `<span class="school-label" style="color:${def.color}">${escapeHtml(text)}</span>`,
            }),
          }));
        },
        attribution: '<a href="https://nlftp.mlit.go.jp/ksj/" target="_blank">国土数値情報</a>',
      });
      entry = { polygons, labels, visible: false };
      this.schoolLayers.set(id, entry);
    }
    entry.visible = visible;
    if (visible) entry.polygons.addTo(this.map);
    else this.map.removeLayer(entry.polygons);
    this._updateSchoolLabels();
  }

  _updateSchoolLabels() {
    const zoomedIn = this.map.getZoom() >= 12;
    for (const entry of this.schoolLayers.values()) {
      if (entry.visible && zoomedIn) entry.labels.addTo(this.map);
      else this.map.removeLayer(entry.labels);
    }
  }

  // ---- 地点マーカー ----

  renderSpots(spots) {
    this.spots = spots; // ポップアップの距離計算用に保持
    const alive = new Set(spots.map((s) => s.id));
    for (const [id, marker] of this.markers) {
      if (!alive.has(id)) {
        this.map.removeLayer(marker);
        this.markers.delete(id);
      }
    }
    for (const spot of spots) this._upsertMarker(spot);
  }

  _upsertMarker(spot) {
    const existing = this.markers.get(spot.id);
    if (existing) this.map.removeLayer(existing);

    const color = statusById(spot.status).color;
    const icon = L.divIcon({
      className: 'spot-pin-wrap',
      html: `<div class="spot-pin" style="--pin-color:${color}"></div>`,
      iconSize: [26, 34],
      iconAnchor: [13, 34],
      popupAnchor: [0, -30],
    });
    const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(this.map);
    // 詳細は地図上のポップアップではなく画面下のシートに出す(app.js)。
    // ピンが画面の上寄りにあるとポップアップがヘッダーに隠れて読めないため。
    marker.on('click', () => { if (this.onMarkerSelect) this.onMarkerSelect(spot.id); });
    this.markers.set(spot.id, marker);
  }

  // 距離+徒歩/車の目安。徒歩は30分(2.4km)を超えたら現実的でないので省く。
  _distanceLabel(a, b) {
    const d = this.map.distance([a.lat, a.lng], [b.lat, b.lng]);
    const dist = d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
    const walk = d <= 2400 ? `徒歩約${Math.ceil(d / 80)}分・` : '';
    return `${dist}(${walk}車約${carMinutes(d)}分)`;
  }

  // 設定で表示ONにしている学区の種類('elementary'/'junior')。ポップアップの学区行を絞る。
  setSchoolKinds(ids) {
    this.schoolKinds = new Set(ids);
  }

  // 詳細シートの中身。クラス名は以前のポップアップ用CSSをそのまま使う。
  detailHtml(spot) {
    const st = statusById(spot.status);
    const stars = spot.rating ? '★'.repeat(spot.rating) : '';
    const gmap = `https://www.google.com/maps?q=${spot.lat},${spot.lng}`;
    // Google公式のMaps URLs形式。その地点のストリートビューを直接開く。
    const streetview = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${spot.lat},${spot.lng}`;
    const hazard = `https://disaportal.gsi.go.jp/maps/index.html?ll=${spot.lat},${spot.lng}&z=16`;
    const memo = spot.memo ? `<p class="popup-memo">${escapeHtml(spot.memo)}</p>` : '';
    const roads = (spot.roads || []).map((d) => ROAD_LABELS[d]).filter(Boolean);
    const rowsHtml = landInfoRows(spot.info, { address: spot.address, schoolKinds: this.schoolKinds, roads, deal: spot });
    const infoHtml = rowsHtml ? `<div class="popup-info">${rowsHtml}</div>` : '';
    // 基準地点(自宅・駅など)までの直線距離。基準地点自身のポップアップには出さない。
    const refs = (this.spots || []).filter((s) => s.status === 'reference' && s.id !== spot.id);
    const dists = spot.status !== 'reference' && refs.length
      ? `<div class="popup-dists">${refs.map((r) => {
        const drive = `https://www.google.com/maps/dir/?api=1&origin=${r.lat},${r.lng}&destination=${spot.lat},${spot.lng}&travelmode=driving`;
        return `${escapeHtml(r.name)}まで ${this._distanceLabel(spot, r)}<a href="${drive}" target="_blank" rel="noopener" class="popup-drive">車ルート</a>`;
      }).join('<br>')}</div>` : '';
    const listing = spot.url
      ? `<a href="${escapeHtml(spot.url)}" target="_blank" rel="noopener" class="popup-listing">物件ページを開く</a>` : '';
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
          <a href="${gmap}" target="_blank" rel="noopener">Googleマップ</a>
        </div>
        <div class="popup-links">
          <a href="${hazard}" target="_blank" rel="noopener">重ねるハザードマップ</a>
        </div>
        <button type="button" class="popup-edit">編集</button>
      </div>`;
  }

  focusSpot(spot) {
    this.map.setView([spot.lat, spot.lng], Math.max(this.map.getZoom(), 16));
    if (this.onMarkerSelect) this.onMarkerSelect(spot.id);
  }

  // 画面下にシート(高さ sheetPx)が出ている状態で、ピンがその上の見える範囲の真ん中に来るよう寄せる
  revealAbove(latlng, sheetPx) {
    const size = this.map.getSize();
    const visibleH = Math.max(size.y - sheetPx, 120);
    const targetY = visibleH * 0.5;
    const pt = this.map.latLngToContainerPoint(latlng);
    this.map.panBy([pt.x - size.x / 2, pt.y - targetY], { animate: true });
  }

  // タップ地点に仮マーカーを置く。確認UIは画面下のバー(app.js)が担当し、
  // 地図の上に重なるポップアップを使わないことで次のタップを塞がない。
  setPendingMarker(latlng) {
    if (this.pendingMarker) {
      this.pendingMarker.setLatLng(latlng);
      return;
    }
    this.pendingMarker = L.marker(latlng, {
      interactive: false,
      icon: L.divIcon({ className: 'pending-pin-wrap', html: '<div class="pending-pin"></div>', iconSize: [26, 34], iconAnchor: [13, 34] }),
    }).addTo(this.map);
  }

  clearPendingMarker() {
    if (this.pendingMarker) {
      this.map.removeLayer(this.pendingMarker);
      this.pendingMarker = null;
    }
  }

  // 検索結果へ移動。一時マーカーを置いて場所を分かりやすくする(次の検索で消える)。
  focusSearchResult(lat, lng, title, { zoom = 15, marker = true } = {}) {
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), zoom));
    if (this.searchMarker) this.map.removeLayer(this.searchMarker);
    this.searchMarker = null;
    if (!marker) return;
    this.searchMarker = L.circleMarker([lat, lng], {
      radius: 9, color: '#c93b3b', weight: 2.5, fillColor: '#fff', fillOpacity: 0.9,
    }).addTo(this.map).bindPopup(title).openPopup();
  }

  // 保存された地点が収まるように地図を合わせる(招待リンクで参加した直後など)
  fitToSpots(spots) {
    if (!spots.length) return false;
    if (spots.length === 1) {
      this.map.setView([spots[0].lat, spots[0].lng], 16);
      return true;
    }
    this.map.fitBounds(L.latLngBounds(spots.map((s) => [s.lat, s.lng])), { padding: [50, 50], maxZoom: 16 });
    return true;
  }

  // 追跡は始めずに一度だけ現在地へ寄せる(初回起動時用)
  locateOnce() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => this.map.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => {}, // 許可されなければ既定の表示のままでよい
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  // ---- 現在地 ----

  // 現在地追跡のトグル。歩きながら使う想定なのでwatchPositionで追従する。
  // 追跡を止めて青い点を消す。エラー時にも呼ぶのでトグル外からも使えるようにしておく。
  stopLocate() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.locationMarker) this.map.removeLayer(this.locationMarker);
    if (this.accuracyCircle) this.map.removeLayer(this.accuracyCircle);
    this.locationMarker = this.accuracyCircle = null;
    this.currentLatLng = null;
  }

  toggleLocate(onError, onFix) {
    if (this.watchId !== null) {
      this.stopLocate();
      return false;
    }
    if (!navigator.geolocation) {
      onError({ code: 0, message: 'この端末では位置情報が使えません' });
      return false;
    }
    let firstFix = true;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        this.currentLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!this.locationMarker) {
          // 歩きながら「今いる場所」をそのまま登録できるよう、青い点自体を押せるようにする
          this.locationMarker = L.circleMarker(latlng, {
            radius: 9, color: '#fff', weight: 3, fillColor: '#2b6fd6', fillOpacity: 1,
            interactive: true, bubblingMouseEvents: false,
          }).addTo(this.map);
          this.locationMarker.on('click', () => {
            if (this.onLocationClick && this.currentLatLng) this.onLocationClick(this.currentLatLng);
          });
          this.accuracyCircle = L.circle(latlng, {
            radius: pos.coords.accuracy, color: '#2b6fd6', weight: 1, fillOpacity: 0.1,
          }).addTo(this.map);
        } else {
          this.locationMarker.setLatLng(latlng);
          this.accuracyCircle.setLatLng(latlng).setRadius(pos.coords.accuracy);
        }
        if (firstFix) {
          this.map.setView(latlng, Math.max(this.map.getZoom(), 16));
          firstFix = false;
          if (onFix) onFix();
        }
      },
      // 失敗の理由(拒否/取得不能/タイムアウト)は呼び出し側で出し分ける。
      // 追跡は成立していないので、状態も戻しておく。
      (err) => { this.stopLocate(); onError(err); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return true;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

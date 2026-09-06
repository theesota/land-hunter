// Leaflet地図の管理: ベース地図、ハザードオーバーレイ、地点マーカー、現在地追跡。
// UIイベントとの結線はapp.js側。ここは地図APIの薄いラッパーに徹する。

import {
  BASE_MAPS, HAZARD_LAYERS, HAZARD_ATTRIBUTION, HAZARD_MAX_NATIVE_ZOOM,
  SCHOOL_LAYERS, DEFAULT_VIEW, DEFAULT_BASEMAP, statusById,
} from './config.js';
import { loadView, saveView, loadBasemap, saveBasemap } from './store.js';
import { hazardHtml } from './landinfo.js';

const ROAD_LABELS = { north: '北', east: '東', south: '南', west: '西' };

export class MapView {
  constructor(containerId, { onMapClick, onMarkerEdit, onPopupOpen }) {
    const view = loadView() || DEFAULT_VIEW;
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
    this.onMarkerEdit = onMarkerEdit;
    this.onPopupOpen = onPopupOpen;

    this.lastPopupClose = 0;
    this.map.on('popupclose', () => { this.lastPopupClose = Date.now(); });
    this.map.on('click', (e) => {
      // ポップアップを閉じるためのタップは登録確認を出さない
      if (Date.now() - this.lastPopupClose < 150) return;
      onMapClick(e.latlng);
    });
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
      const def = SCHOOL_LAYERS.find((d) => d.id === id);
      const res = await fetch(def.file);
      const geojson = await res.json();
      const labels = L.layerGroup();
      const polygons = L.geoJSON(geojson, {
        style: { color: def.color, weight: 2, fillColor: def.color, fillOpacity: 0.06, dashArray: '4 3', bubblingMouseEvents: false },
        onEachFeature: (feature, l) => {
          l.bindPopup(`${escapeHtml(feature.properties.name)}区<br><span class="popup-sub">${escapeHtml(feature.properties.address)}</span>`);
          // 校区の中心に学校名ラベル。中心置きなら形が歪な校区でもエリア外に出にくい。
          labels.addLayer(L.marker(l.getBounds().getCenter(), {
            interactive: false,
            icon: L.divIcon({
              className: 'school-label-wrap',
              iconSize: null,
              html: `<span class="school-label" style="color:${def.color}">${escapeHtml(feature.properties.name)}</span>`,
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
    marker.bindPopup(this._popupHtml(spot));
    marker.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const btn = el.querySelector('.popup-edit');
      if (btn) btn.addEventListener('click', () => this.onMarkerEdit(spot.id));
      if (this.onPopupOpen) this.onPopupOpen(spot, el);
    });
    this.markers.set(spot.id, marker);
  }

  _distanceLabel(a, b) {
    const d = this.map.distance([a.lat, a.lng], [b.lat, b.lng]);
    return d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`;
  }

  _popupHtml(spot) {
    const st = statusById(spot.status);
    const stars = spot.rating ? '★'.repeat(spot.rating) : '';
    const gmap = `https://www.google.com/maps?q=${spot.lat},${spot.lng}`;
    // Google公式のMaps URLs形式。その地点のストリートビューを直接開く。
    const streetview = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${spot.lat},${spot.lng}`;
    const hazard = `https://disaportal.gsi.go.jp/maps/index.html?ll=${spot.lat},${spot.lng}&z=16`;
    const memo = spot.memo ? `<p class="popup-memo">${escapeHtml(spot.memo)}</p>` : '';
    const info = spot.info || {};
    const roads = (spot.roads || []).map((d) => ROAD_LABELS[d]).filter(Boolean);
    const infoRows = [
      info.address && `📍 ${escapeHtml(info.address)}`,
      info.school && `🏫 ${escapeHtml(info.school)}`,
      info.station && `🚉 ${escapeHtml(info.station)}`,
      info.facility && `🛒 ${escapeHtml(info.facility)}`,
      roads.length && `🛣 接道: ${roads.join('・')}側`,
      (info.hz || info.hazard) && `<span class="popup-hz">${hazardHtml(info)}</span>`,
    ].filter(Boolean);
    const infoHtml = infoRows.length ? `<div class="popup-info">${infoRows.join('<br>')}</div>` : '';
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
    const marker = this.markers.get(spot.id);
    if (marker) marker.openPopup();
  }

  // タップ地点に「登録しますか?」の確認ポップアップを出す
  showRegisterPrompt(latlng, onConfirm) {
    const el = document.createElement('div');
    el.className = 'register-prompt';
    el.innerHTML = '<p>この場所を登録しますか?</p>';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '登録する';
    btn.addEventListener('click', () => {
      this.map.closePopup();
      onConfirm(latlng);
    });
    el.append(btn);
    L.popup({ closeButton: true, autoClose: true })
      .setLatLng(latlng)
      .setContent(el)
      .openOn(this.map);
  }

  // 検索結果へ移動。一時マーカーを置いて場所を分かりやすくする(次の検索で消える)。
  focusSearchResult(lat, lng, title) {
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), 15));
    if (this.searchMarker) this.map.removeLayer(this.searchMarker);
    this.searchMarker = L.circleMarker([lat, lng], {
      radius: 9, color: '#c93b3b', weight: 2.5, fillColor: '#fff', fillOpacity: 0.9,
    }).addTo(this.map).bindPopup(title).openPopup();
  }

  // ---- 現在地 ----

  // 現在地追跡のトグル。歩きながら使う想定なのでwatchPositionで追従する。
  toggleLocate(onError) {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      if (this.locationMarker) this.map.removeLayer(this.locationMarker);
      if (this.accuracyCircle) this.map.removeLayer(this.accuracyCircle);
      this.locationMarker = this.accuracyCircle = null;
      return false;
    }
    if (!navigator.geolocation) {
      onError('この端末では位置情報が使えません');
      return false;
    }
    let firstFix = true;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        if (!this.locationMarker) {
          this.locationMarker = L.circleMarker(latlng, {
            radius: 8, color: '#fff', weight: 2, fillColor: '#2b6fd6', fillOpacity: 1,
          }).addTo(this.map);
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
        }
      },
      () => onError('現在地を取得できませんでした(位置情報の許可を確認してください)'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return true;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Leaflet地図の管理: ベース地図、ハザードオーバーレイ、地点マーカー、現在地追跡。
// UIイベントとの結線はapp.js側。ここは地図APIの薄いラッパーに徹する。

import {
  BASE_MAPS, HAZARD_LAYERS, HAZARD_ATTRIBUTION, HAZARD_MAX_NATIVE_ZOOM,
  SCHOOL_LAYERS, DEFAULT_VIEW, DEFAULT_BASEMAP, statusById,
} from './config.js';
import { loadView, saveView, loadBasemap, saveBasemap } from './store.js';

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

    this.hazardOpacity = 0.7;
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

    this.schoolLayers = new Map(); // id -> L.GeoJSON(初回表示時に読み込む)

    this.markers = new Map(); // spot.id -> L.Marker
    this.onMarkerEdit = onMarkerEdit;
    this.onPopupOpen = onPopupOpen;

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
    let layer = this.schoolLayers.get(id);
    if (!layer) {
      const def = SCHOOL_LAYERS.find((d) => d.id === id);
      const res = await fetch(def.file);
      const geojson = await res.json();
      layer = L.geoJSON(geojson, {
        style: { color: def.color, weight: 2, fillColor: def.color, fillOpacity: 0.06, dashArray: '4 3' },
        onEachFeature: (feature, l) => l.bindPopup(`${escapeHtml(feature.properties.name)}区<br><span class="popup-sub">${escapeHtml(feature.properties.address)}</span>`),
        attribution: '<a href="https://nlftp.mlit.go.jp/ksj/" target="_blank">国土数値情報</a>',
      });
      this.schoolLayers.set(id, layer);
    }
    if (visible) layer.addTo(this.map);
    else this.map.removeLayer(layer);
  }

  setHazardOpacity(opacity) {
    this.hazardOpacity = opacity;
    for (const layer of Object.values(this.hazardLayers)) layer.setOpacity(opacity);
  }

  // ---- 地点マーカー ----

  renderSpots(spots) {
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

  _popupHtml(spot) {
    const st = statusById(spot.status);
    const stars = spot.rating ? '★'.repeat(spot.rating) : '';
    const gmap = `https://www.google.com/maps?q=${spot.lat},${spot.lng}`;
    // Google公式のMaps URLs形式。その地点のストリートビューを直接開く。
    const streetview = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${spot.lat},${spot.lng}`;
    const hazard = `https://disaportal.gsi.go.jp/maps/index.html?ll=${spot.lat},${spot.lng}&z=16`;
    const memo = spot.memo ? `<p class="popup-memo">${escapeHtml(spot.memo)}</p>` : '';
    const listing = spot.url
      ? `<a href="${escapeHtml(spot.url)}" target="_blank" rel="noopener" class="popup-listing">物件ページを開く</a>` : '';
    return `
      <div class="popup">
        <strong>${escapeHtml(spot.name)}</strong>
        <div class="popup-meta">
          <span class="popup-status" style="background:${st.color}">${st.label}</span>
          <span class="popup-stars">${stars}</span>
        </div>
        ${memo}
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

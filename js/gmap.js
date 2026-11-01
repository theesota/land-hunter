// Google Maps 版の地図まわり。js/map.js (Leaflet版) と同じメソッドを持つ。
// app.js からは createMapView() で作る。どちらを読むかは app.js が URL で決める。
//
// Leaflet版との違い(意図的なもの):
// - ベース地図は Google の「地図」「写真」の2つ。地理院の標準/淡色は Google の地図の上に
//   敷けない(Google Maps Platform の規約)。地理院ベースで見たいときは Leaflet版を使う。
// - ハザードは overlayMapTypes に重ねる。Leaflet版は乗算(multiply)で重ねているが、
//   Google側は半透明で重ねる。見え方はソータの実機確認待ち。
// - ピン・ラベルは AdvancedMarkerElement(中身はただのHTML)。既存のCSSがそのまま効く。

import {
  HAZARD_LAYERS, HAZARD_ATTRIBUTION, HAZARD_MAX_NATIVE_ZOOM,
  SCHOOL_LAYERS, ZONE_LAYERS, YOUTO_COLORS, DEFAULT_VIEW, MAX_ZOOM, statusById,
} from './config.js';
import { loadView, saveView, loadBasemap, saveBasemap } from './store.js';
import { detailHtml, escapeHtml, zoneStyle, zoneLabel } from './mapcommon.js';
import { GMAPS_KEY, GMAPS_MAP_ID } from './gmap-config.js';

// Google版で選べるベース地図。キーは Leaflet版と別物でいい(保存先が同じなので接頭辞を付ける)
const G_BASEMAPS = { roadmap: '地図', hybrid: '写真' };
const BASEMAP_PREFIX = 'g:';

let loaderPromise = null;

// 公式の inline bootstrap loader を関数にしたもの。importLibrary を1度だけ用意する。
function loadGoogleMaps() {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    if (!GMAPS_KEY) { reject(new Error('Google Maps のキーが未設定')); return; }
    const params = new URLSearchParams({ key: GMAPS_KEY, v: 'weekly', language: 'ja', region: 'JP', libraries: 'maps,marker,core' });
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${params}&loading=async&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps の読み込みに失敗'));
    window.__gmapsReady = () => resolve(window.google.maps);
    document.head.append(s);
  });
  return loaderPromise;
}

export async function createMapView(containerId, handlers) {
  const maps = await loadGoogleMaps();
  return new GoogleMapView(maps, containerId, handlers);
}

class GoogleMapView {
  constructor(maps, containerId, { onMapClick, onMarkerSelect, onLocationClick }) {
    this.maps = maps;
    const saved = loadView();
    this.hadSavedView = !!saved;
    const view = saved || DEFAULT_VIEW;

    const savedBase = (loadBasemap() || '').replace(BASEMAP_PREFIX, '');
    this.currentBasemap = G_BASEMAPS[savedBase] ? savedBase : 'roadmap';
    this.basemapLabels = G_BASEMAPS;

    this.map = new maps.Map(document.getElementById(containerId), {
      center: { lat: view.lat, lng: view.lng },
      zoom: view.zoom,
      mapId: GMAPS_MAP_ID,
      mapTypeId: this.currentBasemap,
      // 自前のUIに統一する。出すのは縮尺だけ(Leaflet版と同じ)
      disableDefaultUI: true,
      scaleControl: true,
      // 店のアイコンを押せると、地点を登録するつもりのタップが吸われる
      clickableIcons: false,
      // 1本指でもスクロールせず地図が動く(スマホで地図が全画面のため)
      gestureHandling: 'greedy',
      // この地図は常に上が北。傾けない・回さない(コンパス表示と合わせる)
      tilt: 0,
      heading: 0,
      rotateControl: false,
      keyboardShortcuts: false,
      maxZoom: MAX_ZOOM,
    });

    this.hazardOpacity = 0.7;
    this.hazardTypes = {};
    for (const def of HAZARD_LAYERS) {
      this.hazardTypes[def.id] = this._tileType(def.url, HAZARD_MAX_NATIVE_ZOOM, HAZARD_ATTRIBUTION);
      if (def.defaultOn) this.map.overlayMapTypes.push(this.hazardTypes[def.id]);
    }

    this.zoneLayers = new Map(); // id -> { data, labels[], visible, labelMinZoom }
    this.markers = new Map(); // spot.id -> AdvancedMarkerElement
    this.onMarkerSelect = onMarkerSelect;
    this.onLocationClick = onLocationClick;
    this.currentLatLng = null;
    this.spots = [];

    this.map.addListener('click', (e) => {
      if (e.latLng) onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
    this.map.addListener('idle', () => {
      const c = this.map.getCenter();
      if (c) saveView({ lat: c.lat(), lng: c.lng(), zoom: this.map.getZoom() });
      this._updateSchoolLabels();
    });

    this.locationMarker = null;
    this.accuracyCircle = null;
    this.watchId = null;
    this._attribution(HAZARD_ATTRIBUTION);
  }

  // XYZのラスタタイルを Google に重ねる形にする。
  // maxNative を超えたズームでは、そのタイルを切り出して引き伸ばす。
  _tileType(urlTemplate, maxNative, attribution) {
    const { maps } = this;
    return new maps.ImageMapType({
      name: attribution,
      tileSize: new maps.Size(256, 256),
      minZoom: 2,
      maxZoom: MAX_ZOOM,
      opacity: this.hazardOpacity,
      getTileUrl: (coord, zoom) => {
        const z = Math.min(zoom, maxNative);
        const scale = 2 ** (zoom - z);
        const x = Math.floor(coord.x / scale);
        const y = Math.floor(coord.y / scale);
        const n = 2 ** z;
        if (y < 0 || y >= n) return null;
        return urlTemplate.replace('{z}', z).replace('{x}', ((x % n) + n) % n).replace('{y}', y);
      },
    });
  }

  // Googleの著作権表示の横に、重ねているデータの出典を出す
  _attribution(html) {
    const box = document.createElement('div');
    box.className = 'gmap-attribution';
    box.innerHTML = html;
    this.map.controls[this.maps.ControlPosition.BOTTOM_RIGHT].push(box);
  }

  setBaseMap(key) {
    if (!G_BASEMAPS[key]) return;
    this.map.setMapTypeId(key);
    this.currentBasemap = key;
    saveBasemap(BASEMAP_PREFIX + key);
  }

  setHazardVisible(id, visible) {
    const type = this.hazardTypes[id];
    const arr = this.map.overlayMapTypes;
    const idx = arr.getArray().indexOf(type);
    if (visible && idx === -1) arr.push(type);
    else if (!visible && idx !== -1) arr.removeAt(idx);
  }

  // 学区・用途地域・区域区分。GeoJSONは初回だけfetchしてキャッシュする。
  async setSchoolVisible(id, visible) {
    let entry = this.zoneLayers.get(id);
    if (!entry) {
      const def = [...SCHOOL_LAYERS, ...ZONE_LAYERS].find((d) => d.id === id);
      const geojson = await (await fetch(def.file)).json();
      const data = new this.maps.Data({ map: null });
      data.addGeoJson(geojson);
      // 面がタップを吸うと、表示中に地図をタップして地点登録ができなくなる
      data.setStyle((feature) => {
        const props = {};
        feature.forEachProperty((v, k) => { props[k] = v; });
        const st = zoneStyle(def, props, YOUTO_COLORS);
        return {
          clickable: false,
          strokeColor: st.stroke,
          strokeWeight: st.weight,
          strokeOpacity: st.fillOpacity === 0 ? 0.5 : 0.9,
          fillColor: st.fill,
          fillOpacity: st.fillOpacity,
        };
      });
      const labels = [];
      data.forEach((feature) => {
        const props = {};
        feature.forEachProperty((v, k) => { props[k] = v; });
        const text = zoneLabel(def, props);
        if (!text) return;
        const center = featureCenter(feature, this.maps);
        if (!center) return;
        const el = document.createElement('span');
        el.className = 'school-label gmap-center';
        el.style.color = def.color;
        el.textContent = text;
        labels.push(new this.maps.marker.AdvancedMarkerElement({
          position: center, content: el, gmpClickable: false, zIndex: 1,
        }));
      });
      entry = { data, labels, visible: false, labelMinZoom: def.labelMinZoom || 12 };
      this.zoneLayers.set(id, entry);
    }
    entry.visible = visible;
    entry.data.setMap(visible ? this.map : null);
    this._updateSchoolLabels();
  }

  _updateSchoolLabels() {
    const zoom = this.map.getZoom();
    for (const entry of this.zoneLayers.values()) {
      const on = entry.visible && zoom >= entry.labelMinZoom;
      for (const m of entry.labels) m.map = on ? this.map : null;
    }
  }

  // ---- 地点マーカー ----

  renderSpots(spots) {
    this.spots = spots;
    const alive = new Set(spots.map((s) => s.id));
    for (const [id, marker] of this.markers) {
      if (!alive.has(id)) {
        marker.map = null;
        this.markers.delete(id);
      }
    }
    for (const spot of spots) this._upsertMarker(spot);
  }

  _upsertMarker(spot) {
    const existing = this.markers.get(spot.id);
    if (existing) existing.map = null;
    const wrap = document.createElement('div');
    wrap.className = 'spot-pin-wrap';
    wrap.innerHTML = `<div class="spot-pin" style="--pin-color:${statusById(spot.status).color}"></div>`;
    const marker = new this.maps.marker.AdvancedMarkerElement({
      map: this.map,
      position: { lat: spot.lat, lng: spot.lng },
      content: wrap,
      title: spot.name,
    });
    marker.addListener('gmp-click', () => { if (this.onMarkerSelect) this.onMarkerSelect(spot.id); });
    this.markers.set(spot.id, marker);
  }

  setSchoolKinds(ids) {
    this.schoolKinds = new Set(ids);
  }

  detailHtml(spot) {
    return detailHtml(spot, { spots: this.spots || [], schoolKinds: this.schoolKinds });
  }

  focusSpot(spot) {
    this.map.setZoom(Math.max(this.map.getZoom(), 16));
    this.map.panTo({ lat: spot.lat, lng: spot.lng });
    if (this.onMarkerSelect) this.onMarkerSelect(spot.id);
  }

  // 画面下にシート(高さ sheetPx)が出ている状態で、ピンがその上の見える範囲の真ん中に来るよう寄せる
  revealAbove(latlng, sheetPx) {
    const div = this.map.getDiv();
    const h = div.clientHeight;
    const visibleH = Math.max(h - sheetPx, 120);
    // 中心を「見えている範囲の真ん中」に合わせるぶん、下へずらす量(px)
    const shiftPx = h / 2 - visibleH / 2;
    const bounds = this.map.getBounds();
    if (!bounds) return;
    const span = bounds.toSpan().lat(); // 画面の高さ分の緯度
    const latPerPx = span / h;
    this.map.panTo({ lat: latlng.lat + shiftPx * latPerPx, lng: latlng.lng });
  }

  setPendingMarker(latlng) {
    if (this.pendingMarker) {
      this.pendingMarker.position = latlng;
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'pending-pin-wrap';
    wrap.innerHTML = '<div class="pending-pin"></div>';
    this.pendingMarker = new this.maps.marker.AdvancedMarkerElement({
      map: this.map, position: latlng, content: wrap, gmpClickable: false, zIndex: 5,
    });
  }

  clearPendingMarker() {
    if (this.pendingMarker) {
      this.pendingMarker.map = null;
      this.pendingMarker = null;
    }
  }

  focusSearchResult(lat, lng, title, { zoom = 15, marker = true } = {}) {
    this.map.setZoom(Math.max(this.map.getZoom(), zoom));
    this.map.panTo({ lat, lng });
    if (this.searchMarker) this.searchMarker.map = null;
    this.searchMarker = null;
    if (!marker) return;
    const dot = document.createElement('div');
    dot.className = 'search-dot gmap-center';
    dot.title = title;
    this.searchMarker = new this.maps.marker.AdvancedMarkerElement({
      map: this.map, position: { lat, lng }, content: dot, gmpClickable: false, zIndex: 4,
    });
  }

  fitToSpots(spots) {
    if (!spots.length) return false;
    if (spots.length === 1) {
      this.map.setCenter({ lat: spots[0].lat, lng: spots[0].lng });
      this.map.setZoom(16);
      return true;
    }
    const b = new this.maps.LatLngBounds();
    for (const s of spots) b.extend({ lat: s.lat, lng: s.lng });
    this.map.fitBounds(b, 50);
    if (this.map.getZoom() > 16) this.map.setZoom(16);
    return true;
  }

  locateOnce() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        this.map.setZoom(15);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  // ---- 現在地 ----

  stopLocate() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.locationMarker) this.locationMarker.map = null;
    if (this.accuracyCircle) this.accuracyCircle.setMap(null);
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
        const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.currentLatLng = latlng;
        if (!this.locationMarker) {
          // 歩きながら「今いる場所」をそのまま登録できるよう、青い点自体を押せるようにする
          const dot = document.createElement('div');
          dot.className = 'locate-dot gmap-center';
          this.locationMarker = new this.maps.marker.AdvancedMarkerElement({
            map: this.map, position: latlng, content: dot, zIndex: 6,
          });
          this.locationMarker.addListener('gmp-click', () => {
            if (this.onLocationClick && this.currentLatLng) this.onLocationClick(this.currentLatLng);
          });
          this.accuracyCircle = new this.maps.Circle({
            map: this.map, center: latlng, radius: pos.coords.accuracy, clickable: false,
            strokeColor: '#2b6fd6', strokeWeight: 1, fillColor: '#2b6fd6', fillOpacity: 0.1,
          });
        } else {
          this.locationMarker.position = latlng;
          this.accuracyCircle.setCenter(latlng);
          this.accuracyCircle.setRadius(pos.coords.accuracy);
        }
        if (firstFix) {
          this.map.setZoom(Math.max(this.map.getZoom(), 16));
          this.map.panTo(latlng);
          firstFix = false;
          if (onFix) onFix();
        }
      },
      (err) => { this.stopLocate(); onError(err); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return true;
  }
}

// 面の中心。Leaflet の getBounds().getCenter() と同じ考え方(外接の中心)。
function featureCenter(feature, maps) {
  const b = new maps.LatLngBounds();
  let n = 0;
  feature.getGeometry().forEachLatLng((ll) => { b.extend(ll); n += 1; });
  if (!n) return null;
  const c = b.getCenter();
  return { lat: c.lat(), lng: c.lng() };
}

export { escapeHtml };

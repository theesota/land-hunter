// UIの結線。地点データの出し入れはすべてdata.js経由(クラウド同期/ローカルの違いを吸収)。

import { HAZARD_LAYERS, SCHOOL_LAYERS, STATUSES, statusById, GEOCODER_URL, LISTINGS_LINK } from './config.js';
import { collectLandInfo, hazardHtml, DEPTH_COLORS } from './landinfo.js';
import { createSpot } from './store.js';
import {
  initData, getSpots, getMode, getInviteUrl,
  saveSpot, deleteSpot, listPhotos, addPhoto, deletePhoto, compressImage,
} from './data.js';
import { MapView } from './map.js';

let spots = [];
let pendingLatLng = null; // 新規追加時のタップ位置
let currentLandInfo = null; // 新規登録時に自動取得した土地情報

const $ = (sel) => document.querySelector(sel);

const mapView = new MapView('map', {
  onMapClick: (latlng) => {
    // タップ → 画面下の確認バー → 登録画面。編集中は誤操作防止で反応しない
    if (!$('#sheet-spot').hidden) return;
    closePanels();
    pendingLatLng = latlng;
    mapView.setPendingMarker(latlng);
    $('#confirm-bar').hidden = false;
  },
  onMarkerEdit: (id) => {
    const spot = spots.find((s) => s.id === id);
    if (spot) openSpotSheet(spot);
  },
  onPopupOpen: async (spot, popupEl) => {
    const box = popupEl.querySelector('.popup-photos');
    if (!box) return;
    const photos = await listPhotos(spot.id);
    box.innerHTML = '';
    for (const photo of photos) {
      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.alt = spot.name;
      img.addEventListener('click', () => openPhotoViewer(photo.dataUrl));
      box.append(img);
    }
  },
});

// ---- パネル開閉 ----

const panels = ['#panel-layers', '#panel-list', '#panel-share', '#panel-settings'].map((s) => $(s));

function closePanels() {
  for (const p of panels) p.hidden = true;
}

function togglePanel(sel) {
  const panel = $(sel);
  const willOpen = panel.hidden;
  closePanels();
  panel.hidden = !willOpen;
}

$('#btn-layers').addEventListener('click', () => togglePanel('#panel-layers'));
$('#btn-list').addEventListener('click', () => { renderList(); togglePanel('#panel-list'); });
$('#btn-share').addEventListener('click', () => togglePanel('#panel-share'));
$('#btn-settings').addEventListener('click', () => { renderRefList(); togglePanel('#panel-settings'); });
for (const btn of document.querySelectorAll('.panel-close')) {
  btn.addEventListener('click', closePanels);
}

// ---- ハザードレイヤUI ----

const togglesEl = $('#hazard-toggles');
for (const def of HAZARD_LAYERS) {
  const label = document.createElement('label');
  label.className = 'hazard-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = def.defaultOn;
  cb.addEventListener('change', () => mapView.setHazardVisible(def.id, cb.checked));
  label.append(cb, ` ${def.label}`);
  togglesEl.append(label);
}

const schoolTogglesEl = $('#school-toggles');
for (const def of SCHOOL_LAYERS) {
  const label = document.createElement('label');
  label.className = 'hazard-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('change', () => {
    mapView.setSchoolVisible(def.id, cb.checked).catch(() => {
      cb.checked = false;
      showToast('学区データの読み込みに失敗しました');
    });
  });
  const swatch = document.createElement('span');
  swatch.className = 'school-swatch';
  swatch.style.background = def.color;
  label.append(cb, ' ', swatch, ` ${def.label}`);
  schoolTogglesEl.append(label);
}

for (const radio of document.querySelectorAll('input[name="basemap"]')) {
  radio.checked = radio.value === mapView.currentBasemap;
  radio.addEventListener('change', () => mapView.setBaseMap(radio.value));
}
// 凡例(浸水深の色はlandinfo.jsの判定テーブルと同じものを表示)
{
  const rows = DEPTH_COLORS.map(({ rgb, label, note }) =>
    `<div class="legend-row"><i class="hz-swatch" style="background:rgb(${rgb})"></i><b>${label}</b><span>${note}</span></div>`);
  rows.push('<div class="legend-row legend-note">土砂災害: <i class="hz-swatch" style="background:#c1272d"></i>赤系=特別警戒区域(建築規制あり) / <i class="hz-swatch" style="background:#f5dc32"></i>黄系=警戒区域</div>');
  rows.push('<div class="legend-row legend-note">学区は令和5年度の国土数値情報。契約前は市の最新指定を確認。</div>');
  $('#hazard-legend').innerHTML = rows.join('');
}

// ---- 地域検索 ----

const searchResultsEl = $('#search-results');

function hideSearchResults() {
  searchResultsEl.hidden = true;
  searchResultsEl.innerHTML = '';
}

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('#search-input').value.trim();
  if (!query) return;
  try {
    const res = await fetch(GEOCODER_URL + encodeURIComponent(query));
    const features = await res.json();
    renderSearchResults(features.slice(0, 8));
  } catch {
    showToast('検索に失敗しました(通信環境を確認してください)');
  }
});

function renderSearchResults(features) {
  searchResultsEl.innerHTML = '';
  if (features.length === 0) {
    showToast('見つかりませんでした');
    hideSearchResults();
    return;
  }
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    const li = document.createElement('li');
    li.textContent = f.properties.title;
    li.addEventListener('click', () => {
      mapView.focusSearchResult(lat, lng, f.properties.title);
      hideSearchResults();
      $('#search-input').blur();
    });
    searchResultsEl.append(li);
  }
  searchResultsEl.hidden = false;
}

// 地図を触ったら結果リストを閉じる
$('#map').addEventListener('pointerdown', hideSearchResults);

// ---- 登録確認バー ----

function hideConfirmBar() {
  $('#confirm-bar').hidden = true;
  mapView.clearPendingMarker();
}

$('#btn-confirm-add').addEventListener('click', () => {
  $('#confirm-bar').hidden = true;
  openSpotSheet(null);
});

$('#btn-confirm-cancel').addEventListener('click', () => {
  pendingLatLng = null;
  hideConfirmBar();
});

// ---- 現在地 ----

$('#btn-locate').addEventListener('click', () => {
  const on = mapView.toggleLocate(showToast);
  $('#btn-locate').classList.toggle('active', on);
});

// ---- 地点フォーム(ボトムシート) ----

let formStatus = STATUSES[0].id;
let formRating = 0;
// フォーム中の写真。既存分は{id, dataUrl}、追加分は{id:null, dataUrl}で保存時に確定する。
let formPhotos = [];
let removedPhotoIds = [];
let formRoads = []; // 接道方角(north/east/south/west)

for (const btn of document.querySelectorAll('.road-chip')) {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.road;
    formRoads = formRoads.includes(dir) ? formRoads.filter((d) => d !== dir) : [...formRoads, dir];
    btn.classList.toggle('active', formRoads.includes(dir));
  });
}

function setFormRoads(roads) {
  formRoads = [...(roads || [])];
  for (const btn of document.querySelectorAll('.road-chip')) {
    btn.classList.toggle('active', formRoads.includes(btn.dataset.road));
  }
}

const statusRow = $('#spot-status');
for (const st of STATUSES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.textContent = st.label;
  btn.style.setProperty('--chip-color', st.color);
  btn.dataset.status = st.id;
  btn.addEventListener('click', () => setFormStatus(st.id));
  statusRow.append(btn);
}

function setFormStatus(id) {
  formStatus = id;
  for (const b of statusRow.children) b.classList.toggle('active', b.dataset.status === id);
}

function setFormRating(n) {
  formRating = n;
  for (const b of $('#spot-rating').children) {
    b.classList.toggle('active', +b.dataset.star <= n);
  }
}

for (const b of $('#spot-rating').children) {
  b.addEventListener('click', () => {
    // 同じ星をもう一度押したら0に戻す
    setFormRating(+b.dataset.star === formRating ? 0 : +b.dataset.star);
  });
}

const INFO_ROWS = [
  ['address', '住所'],
  ['school', '学区'],
  ['station', '最寄り駅'],
  ['facility', '周辺施設'],
  ['hazard', 'ハザード'],
];

function renderLandInfo(info, loading) {
  const box = $('#land-info');
  const rows = INFO_ROWS.map(([key, label]) => {
    let value;
    if (key === 'hazard' && info && (info.hz || info.hazard)) {
      value = hazardHtml(info);
    } else {
      value = info && info[key] ? info[key] : (loading ? '取得中…' : '-');
    }
    return `<div class="land-info-row"><span class="land-info-label">${label}</span><span>${value}</span></div>`;
  });
  rows.push(`<div class="land-info-row"><span class="land-info-label">売出し</span><a href="${LISTINGS_LINK.url}" target="_blank" rel="noopener">${LISTINGS_LINK.label}</a></div>`);
  box.innerHTML = rows.join('');
}

async function openSpotSheet(spot) {
  closePanels();
  currentLandInfo = spot ? spot.info : null;
  if (spot) {
    renderLandInfo(spot.info, false);
  } else if (pendingLatLng) {
    renderLandInfo(null, true);
    const target = pendingLatLng;
    collectLandInfo(target.lat, target.lng, (partial) => {
      // 取得中に別の地点を開いていたら反映しない
      if (pendingLatLng === target) {
        currentLandInfo = { ...partial };
        renderLandInfo(currentLandInfo, true);
      }
    }).then((info) => {
      if (pendingLatLng === target) {
        currentLandInfo = { ...info };
        renderLandInfo(currentLandInfo, false);
      }
    });
  }
  $('#spot-id').value = spot ? spot.id : '';
  $('#spot-name').value = spot ? spot.name : '';
  $('#spot-memo').value = spot ? spot.memo : '';
  $('#spot-url').value = spot && spot.url ? spot.url : '';
  setFormStatus(spot ? spot.status : STATUSES[0].id);
  setFormRating(spot ? spot.rating : 0);
  setFormRoads(spot ? spot.roads : []);
  removedPhotoIds = [];
  formPhotos = spot ? await listPhotos(spot.id) : [];
  renderPhotoThumbs();
  $('#btn-spot-delete').hidden = !spot;
  $('#sheet-spot').hidden = false;
  $('#spot-name').focus();
}

function renderPhotoThumbs() {
  const box = $('#photo-thumbs');
  box.innerHTML = '';
  formPhotos.forEach((photo, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src = photo.dataUrl;
    img.addEventListener('click', () => openPhotoViewer(photo.dataUrl));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'photo-del';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      if (photo.id) removedPhotoIds.push(photo.id);
      formPhotos.splice(i, 1);
      renderPhotoThumbs();
    });
    wrap.append(img, del);
    box.append(wrap);
  });
}

for (const input of document.querySelectorAll('.photo-input')) {
  input.addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      try {
        const dataUrl = await compressImage(file);
        formPhotos.push({ id: null, dataUrl });
      } catch {
        showToast('写真の読み込みに失敗しました');
      }
    }
    renderPhotoThumbs();
    e.target.value = '';
  });
}

function openPhotoViewer(dataUrl) {
  $('#photo-viewer-img').src = dataUrl;
  $('#photo-viewer').hidden = false;
}

$('#photo-viewer').addEventListener('click', () => {
  $('#photo-viewer').hidden = true;
});

function closeSpotSheet() {
  $('#sheet-spot').hidden = true;
  pendingLatLng = null;
  mapView.clearPendingMarker();
}

$('#spot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#spot-id').value;
  const fields = {
    name: $('#spot-name').value.trim(),
    status: formStatus,
    rating: formRating,
    memo: $('#spot-memo').value.trim(),
    url: $('#spot-url').value.trim(),
    roads: formRoads,
  };
  let savedId = id;
  const photosToSave = [...formPhotos];
  const photosToRemove = [...removedPhotoIds];
  const latlng = pendingLatLng; // シートを閉じるとクリアされるので先に退避
  closeSpotSheet();
  try {
    if (id) {
      const cur = spots.find((s) => s.id === id);
      await saveSpot({ ...cur, ...fields });
    } else if (latlng) {
      const spot = createSpot({
        ...fields, lat: latlng.lat, lng: latlng.lng, info: currentLandInfo,
      });
      await saveSpot(spot);
      savedId = spot.id;
    }
    for (const pid of photosToRemove) await deletePhoto(pid);
    for (const photo of photosToSave) {
      if (!photo.id && savedId) await addPhoto(savedId, photo.dataUrl);
    }
    showToast('保存しました');
  } catch {
    showToast('保存に失敗しました(通信状況を確認してください)');
  }
});

$('#btn-spot-cancel').addEventListener('click', closeSpotSheet);
$('#btn-spot-delete').addEventListener('click', async () => {
  const id = $('#spot-id').value;
  if (!id || !confirm('この地点を削除しますか?')) return;
  closeSpotSheet();
  try {
    await deleteSpot(id);
    showToast('削除しました');
  } catch {
    showToast('削除に失敗しました');
  }
});

// ---- 地点一覧 ----

function renderList() {
  const ul = $('#spot-list');
  ul.innerHTML = '';
  $('#spot-empty').hidden = spots.length > 0;
  const sorted = [...spots].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const spot of sorted) {
    const st = statusById(spot.status);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="dot" style="background:${st.color}"></span>
      <span class="spot-name"></span>
      <span class="spot-sub">${st.label}${spot.rating ? ' ' + '★'.repeat(spot.rating) : ''}</span>`;
    li.querySelector('.spot-name').textContent = spot.name || '(名称未設定)';
    li.addEventListener('click', () => {
      closePanels();
      mapView.focusSpot(spot);
    });
    ul.append(li);
  }
}

// ---- 設定(基準地点の管理) ----

function renderRefList() {
  const ul = $('#ref-list');
  ul.innerHTML = '';
  const refs = spots.filter((s) => s.status === 'reference');
  $('#ref-empty').hidden = refs.length > 0;
  for (const ref of refs) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = statusById('reference').color;
    const name = document.createElement('span');
    name.className = 'spot-name';
    name.textContent = ref.name;
    name.addEventListener('click', () => {
      closePanels();
      mapView.focusSpot(ref);
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ref-del';
    del.textContent = '削除';
    del.addEventListener('click', async () => {
      if (!confirm(`「${ref.name}」を削除しますか?`)) return;
      await deleteSpot(ref.id).catch(() => showToast('削除に失敗しました'));
    });
    li.append(dot, name, del);
    ul.append(li);
  }
}

$('#ref-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('#ref-search-input').value.trim();
  if (!query) return;
  const resultsEl = $('#ref-results');
  try {
    const res = await fetch(GEOCODER_URL + encodeURIComponent(query));
    const features = (await res.json()).slice(0, 6);
    resultsEl.innerHTML = '';
    if (features.length === 0) {
      showToast('見つかりませんでした');
      resultsEl.hidden = true;
      return;
    }
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      const li = document.createElement('li');
      li.textContent = f.properties.title;
      li.addEventListener('click', async () => {
        const name = $('#ref-name').value.trim() || f.properties.title;
        resultsEl.hidden = true;
        $('#ref-name').value = '';
        $('#ref-search-input').value = '';
        await saveSpot(createSpot({ name, status: 'reference', lat, lng }));
        showToast(`基準地点「${name}」を登録しました`);
      });
      resultsEl.append(li);
    }
    resultsEl.hidden = false;
  } catch {
    showToast('検索に失敗しました(通信環境を確認してください)');
  }
});

// ---- 共有(招待リンク) ----

// 招待リンクは短い固定URL。受け取った人が開くだけで同じボードに参加でき、
// 以降はお互いの編集がリアルタイムで反映される。
$('#btn-copy-link').addEventListener('click', async () => {
  const url = getInviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast('招待リンクをコピーしました');
  } catch {
    prompt('このリンクを送ってください', url);
  }
});

$('#btn-share-native').addEventListener('click', () => {
  const url = getInviteUrl();
  if (navigator.share) {
    navigator.share({ title: '土地ハンター', text: '土地探しの地図を共有します', url }).catch(() => {});
  } else {
    prompt('このリンクを送ってください', url);
  }
});

// ---- toast ----

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---- 起動 ----

function applySpots(next) {
  spots = next;
  mapView.renderSpots(spots);
  if (!$('#panel-list').hidden) renderList();
  if (!$('#panel-settings').hidden) renderRefList();
}

initData({
  onSpots: applySpots,
  onNotice: showToast,
}).then(({ mode, joined }) => {
  const badge = $('#sync-state');
  if (mode === 'cloud') {
    badge.textContent = '同期中';
    badge.className = 'sync-state on';
    if (joined) showToast('共有ボードに参加しました');
  } else {
    badge.textContent = 'この端末のみ';
    badge.className = 'sync-state off';
  }
});

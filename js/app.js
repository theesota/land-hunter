// UIの結線。状態(spots)を持つのはここだけで、map/store/shareを組み合わせる。

import { HAZARD_LAYERS, STATUSES, statusById } from './config.js';
import {
  loadSpots, createSpot, upsertSpot, removeSpot, mergeSpots,
} from './store.js';
import {
  buildShareUrl, parseShareHash, clearShareHash, exportJson, importJsonFile,
} from './share.js';
import { MapView } from './map.js';

let spots = loadSpots();
let addMode = false;
let pendingLatLng = null; // 新規追加時のタップ位置

const $ = (sel) => document.querySelector(sel);

const mapView = new MapView('map', {
  onMapClick: (latlng) => {
    if (!addMode) return;
    setAddMode(false);
    pendingLatLng = latlng;
    openSpotSheet(null);
  },
  onMarkerEdit: (id) => {
    const spot = spots.find((s) => s.id === id);
    if (spot) openSpotSheet(spot);
  },
});

// ---- パネル開閉 ----

const panels = ['#panel-layers', '#panel-list', '#panel-share'].map((s) => $(s));

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

for (const radio of document.querySelectorAll('input[name="basemap"]')) {
  radio.addEventListener('change', () => mapView.setBaseMap(radio.value));
}
$('#hazard-opacity').addEventListener('input', (e) => mapView.setHazardOpacity(+e.target.value));

// ---- 追加モード / 現在地 ----

function setAddMode(on) {
  addMode = on;
  $('#btn-add').classList.toggle('active', on);
  $('#add-hint').hidden = !on;
}

$('#btn-add').addEventListener('click', () => setAddMode(!addMode));
$('#btn-locate').addEventListener('click', () => {
  const on = mapView.toggleLocate(showToast);
  $('#btn-locate').classList.toggle('active', on);
});

// ---- 地点フォーム(ボトムシート) ----

let formStatus = STATUSES[0].id;
let formRating = 0;

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

function openSpotSheet(spot) {
  closePanels();
  $('#spot-id').value = spot ? spot.id : '';
  $('#spot-name').value = spot ? spot.name : '';
  $('#spot-memo').value = spot ? spot.memo : '';
  setFormStatus(spot ? spot.status : STATUSES[0].id);
  setFormRating(spot ? spot.rating : 0);
  $('#btn-spot-delete').hidden = !spot;
  $('#sheet-spot').hidden = false;
  $('#spot-name').focus();
}

function closeSpotSheet() {
  $('#sheet-spot').hidden = true;
  pendingLatLng = null;
}

$('#spot-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#spot-id').value;
  const fields = {
    name: $('#spot-name').value.trim(),
    status: formStatus,
    rating: formRating,
    memo: $('#spot-memo').value.trim(),
  };
  if (id) {
    const cur = spots.find((s) => s.id === id);
    spots = upsertSpot(spots, { ...cur, ...fields });
  } else if (pendingLatLng) {
    spots = upsertSpot(spots, createSpot({ ...fields, lat: pendingLatLng.lat, lng: pendingLatLng.lng }));
  }
  closeSpotSheet();
  mapView.renderSpots(spots);
  showToast('保存しました');
});

$('#btn-spot-cancel').addEventListener('click', closeSpotSheet);
$('#btn-spot-delete').addEventListener('click', () => {
  const id = $('#spot-id').value;
  if (id && confirm('この地点を削除しますか?')) {
    spots = removeSpot(spots, id);
    closeSpotSheet();
    mapView.renderSpots(spots);
    showToast('削除しました');
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

// ---- 共有 ----

$('#btn-copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildShareUrl(spots));
    showToast('共有リンクをコピーしました');
  } catch {
    prompt('このリンクをコピーして送ってください', buildShareUrl(spots));
  }
});

$('#btn-share-native').addEventListener('click', () => {
  const url = buildShareUrl(spots);
  if (navigator.share) {
    navigator.share({ title: '土地スカウト 共有', url }).catch(() => {});
  } else {
    prompt('このリンクをコピーして送ってください', url);
  }
});

$('#btn-export-json').addEventListener('click', () => exportJson(spots));

$('#input-import-json').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const incoming = await importJsonFile(file);
    applyImport(incoming);
  } catch {
    showToast('JSONの読み込みに失敗しました');
  }
  e.target.value = '';
});

function applyImport(incoming) {
  const result = mergeSpots(spots, incoming);
  spots = result.spots;
  mapView.renderSpots(spots);
  showToast(`取り込み完了: 追加${result.added}件 / 更新${result.updated}件`);
}

// 共有リンクで開いた場合はバナーで確認してから取り込む
const sharedSpots = parseShareHash();
if (sharedSpots && sharedSpots.length > 0) {
  $('#import-banner-text').textContent = `共有された${sharedSpots.length}件の地点があります`;
  $('#import-banner').hidden = false;
  $('#btn-import-yes').addEventListener('click', () => {
    applyImport(sharedSpots);
    $('#import-banner').hidden = true;
    clearShareHash();
  });
  $('#btn-import-no').addEventListener('click', () => {
    $('#import-banner').hidden = true;
    clearShareHash();
  });
} else if (location.hash) {
  clearShareHash();
}

// ---- toast ----

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// 初期描画
mapView.renderSpots(spots);

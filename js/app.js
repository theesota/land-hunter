// UIの結線。地点データの出し入れはすべてdata.js経由(クラウド同期/ローカルの違いを吸収)。

import { HAZARD_LAYERS, SCHOOL_LAYERS, STATUSES, statusById, GEOCODER_URL, LISTINGS_LINK } from './config.js';
import { collectLandInfo, hazardHtml, DEPTH_COLORS, searchStations, schoolLines, facilityLines } from './landinfo.js';
import { createSpot, loadEnabledLayers, saveEnabledLayers } from './store.js';
import {
  initData, getSpots, getMode, getInviteUrl, getBoardId, getStatus, flushPending, switchBoard,
  saveSpot, deleteSpot, restoreSpot, purgeSpot, listPhotos, addPhoto, deletePhoto, compressImage,
} from './data.js';
import { MapView } from './map.js';

let spots = []; // 生きている地点(地図と一覧に出す)
let trash = []; // ゴミ箱の地点(deletedAtあり)
let pendingLatLng = null; // 新規追加時のタップ位置
let refPickMode = false;  // 設定パネルの「地図で選ぶ」で基準地点を指定中
let refPickName = '';
let currentLandInfo = null; // 新規登録時に自動取得した土地情報

const $ = (sel) => document.querySelector(sel);

const mapView = new MapView('map', {
  onMapClick: (latlng) => {
    // タップ → 画面下の確認バー → 登録画面。編集中や案内表示中は誤操作防止で反応しない
    if (!$('#sheet-spot').hidden || !$('#sheet-geo').hidden) return;
    // 詳細を見ている最中の地図タップは「閉じる」。いきなり登録確認を出さない
    if (detailSpotId) { closeDetail(); return; }
    // 初回案内は読み終わる前に地図を触られることがある。邪魔せず引っ込める。
    $('#sheet-board').hidden = true;
    closePanels();
    pendingLatLng = latlng;
    mapView.setPendingMarker(latlng);
    $('#confirm-text').textContent = refPickMode ? `ここを「${refPickName}」にしますか?` : 'この場所を登録しますか?';
    $('#btn-confirm-add').textContent = refPickMode ? 'ここにする' : '登録する';
    $('#pick-hint').hidden = true; // 確認バーが出たら案内は引っ込める
    $('#confirm-bar').hidden = false;
  },
  onMarkerSelect: (id) => {
    const spot = spots.find((s) => s.id === id);
    if (spot) openDetail(spot);
  },
  // 青い現在地マーカーをタップしたら、その場所をそのまま登録できる
  onLocationClick: (latlng) => {
    if (!$('#sheet-spot').hidden) return;
    closePanels();
    pendingLatLng = latlng;
    mapView.setPendingMarker(latlng);
    $('#confirm-text').textContent = refPickMode
      ? `現在地を「${refPickName}」にしますか?` : '現在地を登録しますか?';
    $('#btn-confirm-add').textContent = refPickMode ? 'ここにする' : '登録する';
    $('#pick-hint').hidden = true;
    $('#confirm-bar').hidden = false;
  },
});

// ---- 地点の詳細(ボトムシート) ----

let detailSpotId = null;

async function openDetail(spot) {
  closePanels();
  $('#confirm-bar').hidden = true;
  mapView.clearPendingMarker();
  detailSpotId = spot.id;
  const body = $('#detail-body');
  body.innerHTML = mapView.detailHtml(spot);
  const edit = body.querySelector('.popup-edit');
  if (edit) edit.addEventListener('click', () => { closeDetail(); openSpotSheet(spot); });
  const sheet = $('#sheet-detail');
  sheet.hidden = false;
  sheet.scrollTop = 0;
  // シートに隠れない位置までピンを寄せる
  mapView.revealAbove({ lat: spot.lat, lng: spot.lng }, sheet.getBoundingClientRect().height);
  // 写真は別コレクションなので後から差し込む
  const box = body.querySelector('.popup-photos');
  const photos = await listPhotos(spot.id);
  if (detailSpotId !== spot.id || !box) return;
  box.innerHTML = '';
  for (const photo of photos) {
    const img = document.createElement('img');
    img.src = photo.dataUrl;
    img.alt = spot.name;
    img.addEventListener('click', () => openPhotoViewer(photo.dataUrl));
    box.append(img);
  }
}

function bindDetailEdit(spot) {
  const edit = $('#detail-body').querySelector('.popup-edit');
  if (edit) edit.addEventListener('click', () => { closeDetail(); openSpotSheet(spot); });
  listPhotos(spot.id).then((photos) => {
    const box = $('#detail-body').querySelector('.popup-photos');
    if (!box || detailSpotId !== spot.id) return;
    box.innerHTML = '';
    for (const photo of photos) {
      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.addEventListener('click', () => openPhotoViewer(photo.dataUrl));
      box.append(img);
    }
  });
}

function closeDetail() {
  detailSpotId = null;
  $('#sheet-detail').hidden = true;
}

$('#btn-detail-close').addEventListener('click', closeDetail);

// ---- パネル開閉 ----

const panels = ['#panel-layers', '#panel-list', '#panel-share', '#panel-settings'].map((s) => $(s));

function closePanels() {
  for (const p of panels) p.hidden = true;
}

function togglePanel(sel) {
  const panel = $(sel);
  const willOpen = panel.hidden;
  closePanels();
  closeDetail(); // 一覧や設定を開くときは詳細シートを引っ込める(重ねない)
  panel.hidden = !willOpen;
}

$('#btn-layers').addEventListener('click', () => togglePanel('#panel-layers'));
$('#btn-list').addEventListener('click', () => { renderList(); togglePanel('#panel-list'); });
$('#btn-share').addEventListener('click', () => togglePanel('#panel-share'));
$('#btn-settings').addEventListener('click', () => { renderRefList(); renderEnabledToggles(); renderDiagnostics(); togglePanel('#panel-settings'); });
for (const btn of document.querySelectorAll('.panel-close')) {
  btn.addEventListener('click', closePanels);
}

// ---- 表示レイヤ(コンパクトなチップ) ----

// ハザードと学区をまとめて1つのリストとして扱う。
// 「表示パネルに出す項目」(設定)で絞り込めるようにして、地図に重なるパネルを小さく保つ。
const ALL_LAYERS = [
  ...HAZARD_LAYERS.map((d) => ({ ...d, kind: 'hazard' })),
  ...SCHOOL_LAYERS.map((d) => ({ ...d, kind: 'school' })),
];

// 既定では中学校区を出さない(設定の「表示パネルに出す項目」で戻せる)
let enabledIds = loadEnabledLayers() || ALL_LAYERS.filter((d) => d.id !== 'junior').map((d) => d.id);
const schoolKindIds = () => enabledIds.filter((id) => SCHOOL_LAYERS.some((d) => d.id === id));
const activeIds = new Set(HAZARD_LAYERS.filter((d) => d.defaultOn).map((d) => d.id));

const BASEMAP_LABELS = { osm: '標準', pale: '淡色', photo: '航空写真' };

function renderBasemapChips() {
  const box = $('#basemap-chips');
  box.innerHTML = '';
  for (const [key, label] of Object.entries(BASEMAP_LABELS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini-chip' + (mapView.currentBasemap === key ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      mapView.setBaseMap(key);
      renderBasemapChips();
    });
    box.append(btn);
  }
}

function setLayerActive(def, on) {
  if (on) activeIds.add(def.id);
  else activeIds.delete(def.id);
  if (def.kind === 'hazard') {
    mapView.setHazardVisible(def.id, on);
  } else {
    mapView.setSchoolVisible(def.id, on).catch(() => {
      activeIds.delete(def.id);
      renderLayerChips();
      showToast('学区データの読み込みに失敗しました');
    });
  }
}

function renderLayerChips() {
  const box = $('#layer-chips');
  box.innerHTML = '';
  for (const def of ALL_LAYERS.filter((d) => enabledIds.includes(d.id))) {
    const on = activeIds.has(def.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini-chip' + (on ? ' active' : '');
    btn.textContent = def.short || def.label;
    if (def.color) btn.style.setProperty('--chip-on', def.color);
    btn.addEventListener('click', () => {
      setLayerActive(def, !activeIds.has(def.id));
      renderLayerChips();
    });
    box.append(btn);
  }
  if (!box.children.length) {
    box.innerHTML = '<span class="note">設定で表示する項目を選んでください</span>';
  }
}

// 設定側: 表示パネルに並べる項目を選ぶ
function renderEnabledToggles() {
  const box = $('#enabled-toggles');
  box.innerHTML = '';
  for (const def of ALL_LAYERS) {
    const label = document.createElement('label');
    label.className = 'hazard-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabledIds.includes(def.id);
    cb.addEventListener('change', () => {
      enabledIds = cb.checked
        ? [...enabledIds, def.id]
        : enabledIds.filter((id) => id !== def.id);
      saveEnabledLayers(enabledIds);
      // 一覧から外した項目は地図からも消す
      if (!cb.checked && activeIds.has(def.id)) setLayerActive(def, false);
      renderLayerChips();
      // 学区の表示種類はポップアップの学区行にも効かせる
      if (def.kind === 'school') {
        mapView.setSchoolKinds(schoolKindIds());
        mapView.renderSpots(spots);
      }
    });
    label.append(cb, ` ${def.label}`);
    box.append(label);
  }
}

// 初期状態を地図へ反映(既定でONのハザードのみ)
for (const def of ALL_LAYERS) {
  if (def.kind === 'hazard' && activeIds.has(def.id) && !enabledIds.includes(def.id)) {
    activeIds.delete(def.id);
    mapView.setHazardVisible(def.id, false);
  }
}
renderBasemapChips();
renderLayerChips();

// 凡例(浸水深の色はlandinfo.jsの判定テーブルと同じものを表示)
{
  const rows = DEPTH_COLORS.map(({ rgb, label, note }) =>
    `<div class="legend-row"><i class="hz-swatch" style="background:rgb(${rgb})"></i><b>${label}</b><span>${note}</span></div>`);
  rows.push('<div class="legend-row legend-note">土砂災害: <i class="hz-swatch" style="background:#c1272d"></i>赤系=特別警戒区域(建築規制あり) / <i class="hz-swatch" style="background:#f5dc32"></i>黄系=警戒区域</div>');
  rows.push('<div class="legend-row legend-note">学区は令和5年度の国土数値情報。契約前は市の最新指定を確認。</div>');
  $('#hazard-legend').innerHTML = rows.join('');
}

// ---- 地域検索 ----

// 駅名(同梱データ)と住所(国土地理院)をまとめて引く。
// 「本庄駅」のようなピンポイント指定は住所検索だけでは市までしか返らないため。
async function searchPlaces(query) {
  const [stations, geo] = await Promise.all([
    searchStations(query).catch(() => []),
    fetch(GEOCODER_URL + encodeURIComponent(query)).then((r) => r.json()).catch(() => []),
  ]);
  const geoItems = (Array.isArray(geo) ? geo : []).map((f) => ({
    title: f.properties.title,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
  return [...stations, ...geoItems].slice(0, 8);
}

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
    renderSearchResults(await searchPlaces(query));
  } catch {
    showToast('検索に失敗しました(通信環境を確認してください)');
  }
});

function renderSearchResults(places) {
  searchResultsEl.innerHTML = '';
  if (places.length === 0) {
    showToast('見つかりませんでした');
    hideSearchResults();
    return;
  }
  for (const place of places) {
    const li = document.createElement('li');
    li.textContent = place.title;
    li.addEventListener('click', () => {
      mapView.focusSearchResult(place.lat, place.lng, place.title);
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

$('#btn-confirm-add').addEventListener('click', async () => {
  $('#confirm-bar').hidden = true;
  if (!refPickMode) {
    openSpotSheet(null);
    return;
  }
  const latlng = pendingLatLng;
  const name = refPickName;
  exitRefPick();
  try {
    await saveSpot(createSpot({ name, status: 'reference', lat: latlng.lat, lng: latlng.lng }));
    $('#ref-name').value = '';
    showToast(`基準地点「${name}」を登録しました`);
    renderRefList();
    $('#panel-settings').hidden = false;
  } catch {
    showToast('登録に失敗しました');
  }
});

$('#btn-confirm-cancel').addEventListener('click', () => {
  if (refPickMode) exitRefPick();
  else {
    pendingLatLng = null;
    hideConfirmBar();
  }
});

// 「地図で選ぶ」: 住所検索では出せないピンポイントな場所(駅の出口・実家など)を指定する
function exitRefPick() {
  refPickMode = false;
  pendingLatLng = null;
  $('#pick-hint').hidden = true;
  hideConfirmBar();
}

$('#btn-ref-pick').addEventListener('click', () => {
  refPickName = $('#ref-name').value.trim() || '基準地点';
  refPickMode = true;
  closePanels();
  $('#pick-hint-text').textContent = `地図をタップして「${refPickName}」の場所を選んでください`;
  $('#pick-hint').hidden = false;
});

$('#btn-pick-cancel').addEventListener('click', exitRefPick);

// ---- 現在地 ----

// 位置情報は一度「許可しない」を押すとブラウザが二度と聞いてこない。
// トーストで「使えません」と出しても直しようがないので、端末別の戻し方を案内する。

const GEO_REASON = {
  1: '位置情報の利用がブロックされています。ブラウザの設定で許可し直してください。',
  2: '現在地を取得できませんでした。屋内やビル影ではGPSが届かないことがあります。',
  3: '現在地の取得に時間がかかりすぎました。電波の良い場所でもう一度試してください。',
  4: '位置情報が返ってきませんでした。許可のダイアログが出なかった場合は、このサイトの位置情報が「許可」になっているか確認してください。',
  0: 'この端末では位置情報が使えません。',
};

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = () => /Safari/.test(navigator.userAgent)
  && !/(CriOS|FxiOS|EdgiOS|Chrome|Chromium|Edg)\//.test(navigator.userAgent);
const isAndroid = () => /Android/.test(navigator.userAgent);

// 「どこを押せば許可に戻せるか」は端末ごとに違うので、手順文を出し分ける。
function permissionSteps() {
  if (isIOS() && isSafari()) {
    return {
      steps: [
        'アドレスバー左の「ぁあ」をタップ',
        'メニュー右下の「…」をタップ',
        '「Webサイトの設定」→「位置情報」を「許可」にする',
        'このページを再読み込みして、もう一度「現在地」ボタンを押す',
      ],
      fallback: '「Webサイトの設定」が出てこないときは、iPhoneの「設定」→「アプリ」→「Safari」→「Webサイトの設定」→「位置情報」からでも変えられます。それでもダメなら「設定」→「プライバシーとセキュリティ」→「位置情報サービス」で「Safari Webサイト」を「このAppの使用中のみ許可」にし、「正確な位置情報」もONにしてください。',
    };
  }
  if (isIOS()) {
    return {
      steps: [
        'アドレスバー左のアイコンをタップ',
        'サイトの設定/権限から「位置情報」を「許可」にする',
        'このページを再読み込みして、もう一度「現在地」ボタンを押す',
      ],
      fallback: 'iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」で、使っているブラウザを「このAppの使用中のみ許可」にしてください。',
    };
  }
  if (isAndroid()) {
    return {
      steps: [
        'アドレスバー左の鍵アイコン(または︙)をタップ',
        '「権限」または「サイトの設定」を開く',
        '「位置情報」を「許可」にする',
        'このページを再読み込みして、もう一度「現在地」ボタンを押す',
      ],
      fallback: '端末の「設定」→「位置情報」がOFFになっていないかも確認してください。',
    };
  }
  return {
    steps: [
      'アドレスバー左のアイコンをクリック',
      '「位置情報」を「許可する」に変更',
      'ページを再読み込みして、もう一度「現在地」ボタンを押す',
    ],
    fallback: 'パソコンのOS側で位置情報サービスがOFFになっていると、ブラウザで許可しても取得できません。',
  };
}

let geoTimer = null;

function showGeoHelp(err) {
  const code = err && Number.isFinite(err.code) ? err.code : 0;
  const insecure = location.protocol !== 'https:'
    && !['localhost', '127.0.0.1'].includes(location.hostname);
  $('#geo-reason').textContent = insecure
    ? '安全な接続(https)で開いていないため、ブラウザが位置情報を渡してくれません。'
    : (GEO_REASON[code] || GEO_REASON[0]);

  const ol = $('#geo-steps');
  ol.innerHTML = '';
  const { steps, fallback } = permissionSteps();
  // 許可の問題(拒否/無応答)のときだけ手順を出す。電波不良は設定を触っても直らない。
  const showSteps = !insecure && (code === 1 || code === 4);
  ol.hidden = !showSteps;
  if (showSteps) {
    for (const text of steps) {
      const li = document.createElement('li');
      li.textContent = text;
      ol.appendChild(li);
    }
  }
  $('#geo-fallback').textContent = insecure
    ? 'https://theesota.github.io/land-hunter/ から開いてください。'
    : (showSteps ? fallback : '現在地が使えなくても、地図をタップすれば地点は登録できます。');
  $('#sheet-geo').hidden = false;
}

$('#btn-geo-close').addEventListener('click', () => { $('#sheet-geo').hidden = true; });
$('#btn-geo-retry').addEventListener('click', () => {
  $('#sheet-geo').hidden = true;
  startLocate();
});

async function startLocate() {
  // 拒否済みならwatchPositionは即失敗する。先に案内を出したほうが速い。
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      if (st.state === 'denied') {
        $('#btn-locate').classList.remove('active');
        showGeoHelp({ code: 1 });
        return;
      }
    } catch { /* Permissions APIが無い端末は素通りしてよい */ }
  }
  clearTimeout(geoTimer);
  const on = mapView.toggleLocate((err) => {
    clearTimeout(geoTimer);
    $('#btn-locate').classList.remove('active');
    showGeoHelp(err);
  }, () => clearTimeout(geoTimer));
  $('#btn-locate').classList.toggle('active', on);
  if (on) {
    showToast('現在地を取得中…青い点をタップすると登録できます');
    // 許可ダイアログを放置された場合など、ブラウザが成功も失敗も返さないことがある。
    // 待ちっぱなしにせず、こちらから打ち切って案内を出す。
    geoTimer = setTimeout(() => {
      mapView.stopLocate();
      $('#btn-locate').classList.remove('active');
      showGeoHelp({ code: 4 });
    }, 22000);
  }
}

$('#btn-locate').addEventListener('click', () => {
  if ($('#btn-locate').classList.contains('active')) {
    clearTimeout(geoTimer);
    mapView.stopLocate();
    $('#btn-locate').classList.remove('active');
    return;
  }
  startLocate();
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
    } else if (key === 'school' && info && info.school) {
      value = schoolLines(info.school, new Set(schoolKindIds())).join('<br>') || '-';
    } else if (key === 'facility' && info && info.facility) {
      value = facilityLines(info.facility).join('<br>');
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
  closeDetail();
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
        if (info.address && !$('#spot-address').value) $('#spot-address').value = info.address;
      }
    });
  }
  $('#spot-id').value = spot ? spot.id : '';
  $('#spot-name').value = spot ? spot.name : '';
  $('#spot-memo').value = spot ? spot.memo : '';
  $('#spot-url').value = spot && spot.url ? spot.url : '';
  // 自動取得は町丁目まで。番地は歩いて見た表札や現地の看板から手で足す前提。
  $('#spot-address').value = spot ? (spot.address || (spot.info && spot.info.address) || '') : '';
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
    address: $('#spot-address').value.trim(),
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
// 戻せるので確認ダイアログは挟まない。ゴミ箱から戻す導線を一覧に置いてある。
$('#btn-spot-delete').addEventListener('click', async () => {
  const id = $('#spot-id').value;
  if (!id) return;
  closeSpotSheet();
  try {
    await deleteSpot(id);
    showToast('ゴミ箱に移しました(一覧から戻せます)');
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
  renderTrash();
}

// ゴミ箱。畳んでおいて件数だけ見せる。開くと「戻す」「完全に削除」。
let trashOpen = false;

function renderTrash() {
  const box = $('#trash-box');
  box.hidden = trash.length === 0;
  $('#trash-toggle').textContent = `${trashOpen ? '▾' : '▸'} ゴミ箱 (${trash.length})`;
  const body = $('#trash-body');
  body.hidden = !trashOpen;
  const ul = $('#trash-list');
  ul.innerHTML = '';
  if (!trashOpen) return;
  const sorted = [...trash].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  for (const spot of sorted) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="spot-name"></span>
      <button type="button" class="mini-chip trash-restore">戻す</button>
      <button type="button" class="mini-chip trash-purge">完全に削除</button>`;
    li.querySelector('.spot-name').textContent = spot.name || '(名称未設定)';
    li.querySelector('.trash-restore').addEventListener('click', async () => {
      try { await restoreSpot(spot.id); showToast('戻しました'); } catch { showToast('戻せませんでした'); }
    });
    li.querySelector('.trash-purge').addEventListener('click', async () => {
      // ここから先は戻れないので、ここだけ確認を挟む
      if (!confirm(`「${spot.name || '(名称未設定)'}」を完全に削除しますか? 写真も消えます。`)) return;
      try { await purgeSpot(spot.id); showToast('完全に削除しました'); } catch { showToast('削除に失敗しました'); }
    });
    ul.append(li);
  }
}

$('#trash-toggle').addEventListener('click', () => {
  trashOpen = !trashOpen;
  renderTrash();
});

$('#btn-trash-empty').addEventListener('click', async () => {
  if (trash.length === 0) return;
  if (!confirm(`ゴミ箱の${trash.length}件を完全に削除しますか? 写真も消えて、全員の画面から消えます。`)) return;
  try {
    await Promise.all(trash.map((s) => purgeSpot(s.id)));
    showToast('ゴミ箱を空にしました');
  } catch {
    showToast('一部削除できませんでした');
  }
});

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

// 別の端末・ブラウザで開いて空のボードになったとき、共有IDを入れて元のボードに戻れる
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('#join-input').value.trim();
  if (!value) return;
  const carry = $('#join-carry').checked;
  if (!switchBoard(value, { carry })) showToast('共有IDが正しくありません');
});

// 共有IDは3人で見比べるためのもの。長いので手打ちさせずコピーできるようにする。
$('#diag-board').addEventListener('click', async () => {
  const id = getBoardId();
  if (!id) return;
  try {
    await navigator.clipboard.writeText(getInviteUrl());
    showToast('招待リンクをコピーしました');
  } catch {
    prompt('このリンクを送ってください', getInviteUrl());
  }
});

$('#board-join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('#board-join-input').value.trim();
  if (!value) return;
  // 初回なので手元に地点はほぼ無いが、あれば一緒に持ち込む
  if (!switchBoard(value, { carry: true })) showToast('招待リンクが正しくありません');
});

$('#btn-board-new').addEventListener('click', () => { $('#sheet-board').hidden = true; });

$('#ref-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('#ref-search-input').value.trim();
  if (!query) return;
  const resultsEl = $('#ref-results');
  try {
    const places = (await searchPlaces(query)).slice(0, 6);
    resultsEl.innerHTML = '';
    if (places.length === 0) {
      showToast('見つかりませんでした');
      resultsEl.hidden = true;
      return;
    }
    for (const place of places) {
      const { lat, lng } = place;
      const li = document.createElement('li');
      li.textContent = place.title;
      li.addEventListener('click', async () => {
        const name = $('#ref-name').value.trim() || place.title;
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
// 共有する前に、未送信の書き込みを送り切ってからリンクを渡す。
// これをしないと「リンクは送ったのに相手に地点が見えない」が起きる。
async function ensureSynced() {
  if (getMode() !== 'cloud') {
    showToast('クラウド未接続です(この端末にのみ保存されています)');
    return false;
  }
  if (!getStatus().pending) return true;
  showToast('未送信のデータを送信中…');
  const done = await Promise.race([
    flushPending().then(() => true),
    new Promise((r) => setTimeout(() => r(false), 8000)),
  ]);
  if (!done) showToast('送信が完了しません。通信状況を確認してください');
  return done;
}

$('#btn-copy-link').addEventListener('click', async () => {
  await ensureSynced();
  const url = getInviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast('招待リンクをコピーしました');
  } catch {
    prompt('このリンクを送ってください', url);
  }
});

$('#btn-share-native').addEventListener('click', async () => {
  await ensureSynced();
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

mapView.setSchoolKinds(schoolKindIds());

function applySpots(next) {
  spots = next.filter((s) => !s.deletedAt);
  trash = next.filter((s) => s.deletedAt);
  mapView.renderSpots(spots);
  if (detailSpotId) {
    const cur = spots.find((s) => s.id === detailSpotId);
    if (cur) {
      $('#detail-body').innerHTML = mapView.detailHtml(cur);
      bindDetailEdit(cur);
    } else {
      closeDetail();
    }
  }
  if (!$('#panel-list').hidden) renderList();
  if (!$('#panel-settings').hidden) renderRefList();
}

// バッジは「本当にサーバーに届いているか」を映す。
// 未送信が残っている間を「同期中」と表示すると、共有できていない事実が隠れてしまう。
function renderSyncState() {
  const badge = $('#sync-state');
  if (getMode() !== 'cloud') {
    badge.textContent = 'この端末のみ';
    badge.className = 'sync-state off';
    return;
  }
  const st = getStatus();
  if (st.pending) {
    badge.textContent = '保存待ち';
    badge.className = 'sync-state warn';
  } else if (st.synced) {
    badge.textContent = '同期済み';
    badge.className = 'sync-state on';
  } else {
    badge.textContent = 'オフライン';
    badge.className = 'sync-state warn';
  }
  if (!$('#panel-settings').hidden) renderDiagnostics();
}

function renderDiagnostics() {
  const st = getStatus();
  $('#join-carry-label').textContent = spots.length
    ? `この端末の${spots.length}件も持ち込む` : 'この端末の地点も持ち込む';
  const state = getMode() !== 'cloud' ? 'この端末のみ(未接続)'
    : st.pending ? '保存待ち(未送信あり)'
      : st.synced ? '同期済み' : 'オフライン';
  $('#diag-state').textContent = state;
  $('#diag-count').textContent = `${spots.length}件`;
  $('#diag-board').textContent = getBoardId() || '-';
}

// 初回起動(前回の表示位置がない)だけ、地図の初期位置を決める。
// 招待リンクで参加した直後は全地点が入るように、地点がなければ現在地に寄せる。
let initialViewDone = mapView.hadSavedView;

function applyInitialView() {
  if (initialViewDone) return;
  if (spots.length) {
    initialViewDone = mapView.fitToSpots(spots);
  }
}

initData({
  onSpots: (next) => {
    applySpots(next);
    applyInitialView();
  },
  onNotice: showToast,
  onSyncStatus: renderSyncState,
}).then(({ mode, joined, created }) => {
  renderSyncState();
  if (mode === 'cloud' && joined) showToast('共有ボードに参加しました');
  // 新しいボードを黙って作ると「登録したのに共有されない」事故になる。
  // 初回だけ、家族の地図に参加する道を先に見せる。
  // クラウド未接続(この端末のみ)のときは共有の話をしても意味がないので出さない
  if (created && mode === 'cloud') $('#sheet-board').hidden = false;
  // 地点が一つもなければ現在地へ(許可されなければ既定表示のまま)
  setTimeout(() => {
    if (!initialViewDone && spots.length === 0) {
      initialViewDone = true;
      mapView.locateOnce();
    }
  }, 1500);
});

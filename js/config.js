// アプリ全体で使う定義。レイヤやステータスを増やすときはこのファイルだけ直せばいい。

// ベース地図。標準はOpenStreetMap(施設名や店名が出る現代的な見た目)、他は地理院タイル。
export const BASE_MAPS = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  pale: {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    maxZoom: 18,
  },
  photo: {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    maxZoom: 18,
  },
};

// 重ねるハザードマップ配信タイル
// 出典: https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html (配信ズーム2〜17)
export const HAZARD_LAYERS = [
  {
    id: 'flood',
    label: '洪水浸水想定(想定最大規模)',
    short: '洪水',
    url: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
    defaultOn: true,
  },
  {
    id: 'dosekiryu',
    label: '土砂災害警戒区域(土石流)',
    short: '土石流',
    url: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
    defaultOn: true,
  },
  {
    id: 'kyukeisha',
    label: '土砂災害警戒区域(急傾斜地)',
    short: '急傾斜地',
    url: 'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png',
    defaultOn: true,
  },
  {
    id: 'jisuberi',
    label: '土砂災害警戒区域(地すべり)',
    short: '地すべり',
    url: 'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png',
    defaultOn: false,
  },
  {
    id: 'tsunami',
    label: '津波浸水想定',
    short: '津波',
    url: 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png',
    defaultOn: false,
  },
  {
    id: 'takashio',
    label: '高潮浸水想定',
    short: '高潮',
    url: 'https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png',
    defaultOn: false,
  },
];

export const HAZARD_ATTRIBUTION =
  '<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>';

// ハザードタイルの配信範囲はズーム17まで。18以上は17のタイルを拡大表示する。
export const HAZARD_MAX_NATIVE_ZOOM = 17;

// 地点のステータス。順序はUIの表示順。
export const STATUSES = [
  { id: 'interested', label: '気になる', color: '#2b6fd6' },
  { id: 'visited', label: '見学済み', color: '#e08a00' },
  { id: 'candidate', label: '候補', color: '#1a9e50' },
  { id: 'rejected', label: '見送り', color: '#8a8a8a' },
  // 自宅・最寄り駅・職場など、候補地までの距離を測る起点。候補地のポップアップに距離が出る。
  { id: 'reference', label: '基準地点', color: '#d63384' },
];

export function statusById(id) {
  return STATUSES.find((s) => s.id === id) || STATUSES[0];
}

// 学区境界(国土数値情報 小学校区A27・中学校区A32 令和5年度、伊勢崎市分を抽出)
// 出典: https://nlftp.mlit.go.jp/ksj/ 。他エリアを足すときはここに追記する。
export const SCHOOL_LAYERS = [
  { id: 'elementary', label: '小学校区(伊勢崎市)', short: '小学校区', file: 'data/school/isesaki_elementary.geojson', color: '#7c3aed' },
  { id: 'junior', label: '中学校区(伊勢崎市)', short: '中学校区', file: 'data/school/isesaki_junior.geojson', color: '#0e7490' },
];

// 都市計画の区域。国土数値情報 都市計画決定情報(A55, 2024年度)の伊勢崎市分(市が提出したデータ)。
// zoning: layer=1 市街化区域, layer=2 市街化調整区域。調整区域は原則として住宅を建てられない。
// youto : 用途地域(n=名称, c=コード, bcr=建ぺい率%, far=容積率%)。何が建てられるかの根拠。
// tokutei: 特定用途制限地域(線引きしていない赤堀・東の区域での建築制限)。
export const YOUTO_COLORS = {
  1: '#9fd9a6', 2: '#c3e6b3', 3: '#b3e4cf', 4: '#d5efd5',
  5: '#ffe89a', 6: '#ffd37f', 7: '#ffb86a',
  9: '#ffb3c8', 10: '#ff8a8a', 11: '#cfa9d9', 12: '#a9c7e6', 13: '#86abd6',
};
export const ZONE_LAYERS = [
  { id: 'zoning', kind: 'zone', label: '市街化調整区域(伊勢崎市)', short: '調整区域', file: 'data/zone/isesaki_zoning.geojson', color: '#c2410c' },
  { id: 'youto', kind: 'zone', label: '用途地域(伊勢崎市)', short: '用途地域', file: 'data/zone/isesaki_youto.geojson', color: '#6b7280', labelMinZoom: 15 },
];
export const TOKUTEI_FILE = 'data/zone/isesaki_tokutei.geojson';

// 周辺の売出し情報(公開APIが存在しないため、エリアの物件一覧ページへのリンクで代替)
export const LISTINGS_LINK = {
  label: 'SUUMOで伊勢崎市の売土地を見る',
  url: 'https://suumo.jp/tochi/gumma/sc_isesaki/',
};

export const DEFAULT_BASEMAP = 'osm';

// 地域検索(国土地理院 住所検索API)。地名・駅名・施設名・住所を引ける。キー不要。
export const GEOCODER_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';

// 初期表示(地点も保存ビューもないとき): 日本全体
export const DEFAULT_VIEW = { lat: 36.2, lng: 138.25, zoom: 5 };

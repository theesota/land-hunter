// Firestoreによるリアルタイム共有。
//
// 考え方: 「ボード」=土地探しの共有スペース。ボードIDは推測不可能なランダム文字列で、
// そのIDを含む招待リンクを知っている人だけが読み書きできる(=鍵付きURL方式)。
// ログイン不要で家族3人がすぐ使えることを優先した設計。
//
// 保存先:
//   boards/{boardId}/spots/{spotId}   … 地点
//   boards/{boardId}/photos/{photoId} … 写真(圧縮済みdataURLを1枚1ドキュメント)

import { FIREBASE_CONFIG } from './firebase-config.js';

// SDKは同梱(CDN依存とオフライン起動不能を避けるため)。更新時はvendor/firebase/を差し替える。
const SDK = '../vendor/firebase';

let db = null;
let fs = null; // firestoreのモジュール(動的import結果)

export async function connect() {
  const [{ initializeApp }, firestore] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  fs = firestore;
  const app = initializeApp(FIREBASE_CONFIG);
  // 端末内キャッシュを有効にすると、電波の悪い現地でも表示・入力ができ、
  // 復帰時に自動で送信される(歩きながら使う前提のアプリなので必須)。
  db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  // 開発時のみ: ローカルのFirestoreエミュレータに接続する(?emu=1)
  if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('emu')) {
    fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return true;
}

function spotsCol(boardId) {
  return fs.collection(db, 'boards', boardId, 'spots');
}

function photosCol(boardId) {
  return fs.collection(db, 'boards', boardId, 'photos');
}

// Firestoreはundefinedを受け付けないので落とす
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// 地点の変更を購読。誰かが編集すると全員のonSpotsが呼ばれる。
// metaでサーバー確定済みか(fromCache)、送信待ちがあるか(hasPendingWrites)が分かる。
// これを見ないと「自分の端末にだけ見えている未送信データ」を同期済みと誤認する。
export function watchSpots(boardId, onSpots, onError) {
  return fs.onSnapshot(
    spotsCol(boardId),
    { includeMetadataChanges: true },
    (snap) => onSpots(
      snap.docs.map((d) => ({ ...d.data(), id: d.id })),
      { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites },
    ),
    onError,
  );
}

export async function putSpot(boardId, spot) {
  const { id, ...rest } = spot;
  await fs.setDoc(fs.doc(spotsCol(boardId), id), clean(rest));
}

export async function removeSpotDoc(boardId, id) {
  await fs.deleteDoc(fs.doc(spotsCol(boardId), id));
}

export async function putPhoto(boardId, photo) {
  const { id, ...rest } = photo;
  await fs.setDoc(fs.doc(photosCol(boardId), id), clean(rest));
}

export async function listPhotos(boardId, spotId) {
  const q = fs.query(photosCol(boardId), fs.where('spotId', '==', spotId));
  const snap = await fs.getDocs(q);
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function removePhotoDoc(boardId, id) {
  await fs.deleteDoc(fs.doc(photosCol(boardId), id));
}

export async function removePhotosOfSpot(boardId, spotId) {
  const photos = await listPhotos(boardId, spotId);
  await Promise.all(photos.map((p) => removePhotoDoc(boardId, p.id)));
}

// 既存の地点があるかどうか(ローカルデータの初回アップロード判定に使う)。
// キャッシュではなくサーバーに問い合わせる。オフライン時は例外になり、
// 呼び出し側は「判定できなかった」として次回起動に持ち越す。
export async function isEmpty(boardId) {
  const snap = await fs.getDocsFromServer(fs.query(spotsCol(boardId), fs.limit(1)));
  return snap.empty;
}

// 未送信の書き込みが残らずサーバーに届くまで待つ
export function waitForPendingWrites() {
  return fs.waitForPendingWrites(db);
}

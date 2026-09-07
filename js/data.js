// データ層の入り口。app.jsはここだけを見る。
// クラウド同期が使えるときはFirestore(3人でリアルタイム共有)、
// 使えないとき(未設定・接続失敗)は端末内保存だけで動くようにフォールバックする。

import { isConfigured } from './firebase-config.js';
import * as sync from './sync.js';
import {
  loadSpots as loadLocalSpots, saveSpotsLocal, isValidSpot,
} from './store.js';
import * as localPhotos from './photos.js';

const BOARD_KEY = 'tasobow.landhunter.board.v1';
const CARRY_KEY = 'tasobow.landhunter.carry.v1';
const HASH_PREFIX = '#b=';

let mode = 'local'; // 'cloud' | 'local'
let boardId = null;
let spots = [];
let notify = () => {};
let onStatus = () => {};
// サーバーに確定済みか。未送信の書き込みが残っている間は「保存待ち」を出す。
let status = { synced: false, pending: false };

export function getStatus() { return status; }

export function getMode() { return mode; }
export function getBoardId() { return boardId; }
export function getSpots() { return spots; }

// 招待リンク。これ1本を送れば全員が同じボードに入れる。
export function getInviteUrl() {
  return `${location.origin}${location.pathname}${HASH_PREFIX}${boardId}`;
}

function newBoardId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// URLに常にボードIDを残す。
// 以前は見た目のために消していたが、そうするとブックマークや履歴から開いたURLに
// IDが乗らず、localStorageが消えた端末で黙って別のボードが作られてしまう。
// 「アドレスバーのURL = 招待リンク」にしておくのが一番事故が少ない。
function keepHash(id) {
  const want = `${location.pathname}${location.search}${HASH_PREFIX}${id}`;
  if (location.pathname + location.search + location.hash !== want) {
    history.replaceState(null, '', want);
  }
}

// URLの招待リンク > 前回のボード > 新規作成 の優先順で決める
function resolveBoardId() {
  const fromHash = location.hash.startsWith(HASH_PREFIX)
    ? location.hash.slice(HASH_PREFIX.length).trim() : '';
  if (fromHash && fromHash.length >= 20) {
    // 別ボードで使っていた端末が招待リンクを開いたとき、手元の地点をそのまま捨てない。
    // 混ざったら消せばいいが、消えた地点は戻らないので「持ち込む」側に倒す。
    const saved = localStorage.getItem(BOARD_KEY);
    if (saved && saved !== fromHash) {
      const local = loadLocalSpots();
      if (local.length > 0) localStorage.setItem(CARRY_KEY, JSON.stringify(local));
    }
    localStorage.setItem(BOARD_KEY, fromHash);
    keepHash(fromHash);
    return { id: fromHash, joined: true };
  }
  const saved = localStorage.getItem(BOARD_KEY);
  if (saved) {
    keepHash(saved);
    return { id: saved, joined: false };
  }
  const created = newBoardId();
  localStorage.setItem(BOARD_KEY, created);
  keepHash(created);
  return { id: created, joined: false, created: true };
}

// 開いているタブのアドレスバーに招待リンクを貼ると、ハッシュだけ変わって再読み込みされない。
// ボードが変わるなら読み込み直して、通常の参加(持ち込み含む)と同じ道を通す。
window.addEventListener('hashchange', () => {
  const next = location.hash.startsWith(HASH_PREFIX) ? location.hash.slice(HASH_PREFIX.length).trim() : '';
  if (next && next.length >= 20 && next !== boardId) location.reload();
});

// onSpots: 地点が変わるたびに呼ばれる(自分の編集でも他の人の編集でも)
export async function initData({ onSpots, onNotice, onSyncStatus }) {
  notify = onSpots;
  onStatus = onSyncStatus || (() => {});
  const resolved = resolveBoardId();
  boardId = resolved.id;
  spots = loadLocalSpots();
  notify(spots); // まずローカルの内容で即描画(通信待ちで真っ白にしない)

  if (!isConfigured()) return { mode, boardId, ...resolved };

  try {
    await sync.connect();
    mode = 'cloud';
    // この端末にだけある地点を初回に引き上げる(共有に切り替える前のデータ救済)
    await migrateLocalSpots();
    const carried = await carryOverSpots().catch(() => 0);
    if (carried && onNotice) onNotice(`この端末の${carried}件をこのボードに移しました`);
    sync.watchSpots(boardId, (cloudSpots, meta) => {
      const next = cloudSpots.filter(isValidSpot);
      status = { synced: !meta.fromCache, pending: meta.hasPendingWrites };
      onStatus(status);
      // 空のスナップショットで端末内のデータを消さない。
      // 手元にあってサーバーに無い地点は「消えた」のではなく「まだ上がっていない」
      // 可能性があるため、破棄せずアップロードを試みる(データを失わない側に倒す)。
      // ただし一度サーバーで確認できた地点が消えたなら、それは誰かが本当に削除したもの。
      // それまで上げ直すと、最後の1件を完全削除できなくなる。
      if (!meta.fromCache) for (const s of next) serverSeen.add(s.id);
      if (next.length === 0 && spots.length > 0) {
        if (meta.fromCache) return; // キャッシュ由来の空は判断材料にしない
        const unconfirmed = spots.filter((s) => !serverSeen.has(s.id));
        if (unconfirmed.length > 0) {
          rescueLocalSpots(unconfirmed);
          return;
        }
      }
      spots = next;
      saveSpotsLocal(spots); // オフライン起動用のキャッシュ
      notify(spots);
    }, () => onNotice && onNotice('同期エラー: 通信状況を確認してください'));
  } catch {
    mode = 'local';
    if (onNotice) onNotice('クラウド同期に接続できません(この端末に保存します)');
  }
  return { mode, boardId, ...resolved };
}

async function migrateLocalSpots() {
  const local = loadLocalSpots();
  if (local.length === 0) return;
  const flagKey = `tasobow.landhunter.migrated.${boardId}`;
  if (localStorage.getItem(flagKey)) return;
  try {
    // サーバーに直接問い合わせる。オフラインなら例外になり、
    // フラグを立てずに次回起動へ持ち越す(取りこぼし防止)。
    if (await sync.isEmpty(boardId)) {
      await Promise.all(local.map((s) => sync.putSpot(boardId, s)));
      // 端末内の写真も一緒に引き上げる
      const photos = await localPhotos.getAllPhotos().catch(() => []);
      await Promise.all(photos.map((p) => sync.putPhoto(boardId, p)));
    }
    localStorage.setItem(flagKey, '1');
  } catch { /* オフライン等。次回接続時に再試行する */ }
}

// サーバーに無い手元の地点を引き上げる。二重実行しないよう一度だけ走らせる。
let rescuing = false;
const serverSeen = new Set(); // サーバーで存在を確認できた地点ID
async function rescueLocalSpots(list) {
  if (rescuing) return;
  rescuing = true;
  try {
    const ids = new Set(list.map((s) => s.id));
    await Promise.all(list.map((s) => sync.putSpot(boardId, s)));
    const photos = await localPhotos.getAllPhotos().catch(() => []);
    await Promise.all(photos.filter((p) => ids.has(p.spotId)).map((p) => sync.putPhoto(boardId, p)));
  } catch { /* 次のスナップショットで再試行される */ } finally {
    rescuing = false;
  }
}

// 別のボード(共有ID)に切り替える。読み込み直して確実に初期化する。
// carry=true なら、いまこの端末にある地点を切り替え先へ持ち込む。
// (別ボードで貯めてしまった分を、正しいボードへ移すための道)
export function switchBoard(idOrUrl, { carry = false } = {}) {
  const raw = String(idOrUrl).trim();
  const id = raw.includes(HASH_PREFIX) ? raw.split(HASH_PREFIX)[1].trim() : raw;
  if (!id || id.length < 20) return false;
  if (carry && spots.length > 0) {
    localStorage.setItem(CARRY_KEY, JSON.stringify(spots));
  }
  localStorage.setItem(BOARD_KEY, id);
  location.hash = HASH_PREFIX.slice(1) + id;
  location.reload();
  return true;
}

// 切り替え前の地点を新しいボードへ引き上げる。
// idは元のまま送るので、二重に走っても上書きになるだけで増殖しない。
async function carryOverSpots() {
  const raw = localStorage.getItem(CARRY_KEY);
  if (!raw) return 0;
  let list = [];
  try { list = JSON.parse(raw).filter(isValidSpot); } catch { list = []; }
  if (list.length === 0) { localStorage.removeItem(CARRY_KEY); return 0; }
  const ids = new Set(list.map((s) => s.id));
  await Promise.all(list.map((s) => sync.putSpot(boardId, s)));
  const photos = await localPhotos.getAllPhotos().catch(() => []);
  await Promise.all(photos.filter((p) => ids.has(p.spotId)).map((p) => sync.putPhoto(boardId, p)));
  localStorage.removeItem(CARRY_KEY);
  return list.length;
}

// 未送信の書き込みがサーバーに届くまで待つ(共有前の取りこぼし確認に使う)
export async function flushPending() {
  if (mode !== 'cloud') return false;
  await sync.waitForPendingWrites();
  return true;
}

// ---- 地点 ----

export async function saveSpot(spot) {
  const next = { ...spot, updatedAt: Date.now() };
  if (mode === 'cloud') {
    await sync.putSpot(boardId, next);
    return next; // 画面更新はwatchSpotsの通知で行われる
  }
  spots = [...spots.filter((s) => s.id !== next.id), next];
  saveSpotsLocal(spots);
  notify(spots);
  return next;
}

// 削除はゴミ箱行き(deletedAtを立てるだけ)。地点も写真もそのまま残るので戻せる。
// 共有中に誰かが誤って消しても、他の人が戻せるのがソフト削除にした理由。
export async function deleteSpot(id) {
  return setDeleted(id, Date.now());
}

export async function restoreSpot(id) {
  return setDeleted(id, null);
}

async function setDeleted(id, deletedAt) {
  const cur = spots.find((s) => s.id === id);
  if (!cur) return;
  const next = { ...cur, deletedAt, updatedAt: Date.now() };
  if (deletedAt === null) delete next.deletedAt;
  return saveSpot(next);
}

// ゴミ箱から完全に消す。ここで初めて写真も消える。
export async function purgeSpot(id) {
  if (mode === 'cloud') {
    spots = spots.filter((s) => s.id !== id);
    saveSpotsLocal(spots);
    await sync.removeSpotDoc(boardId, id);
    await sync.removePhotosOfSpot(boardId, id).catch(() => {});
    return;
  }
  spots = spots.filter((s) => s.id !== id);
  saveSpotsLocal(spots);
  await localPhotos.deletePhotosForSpot(id).catch(() => {});
  notify(spots);
}

// ---- 写真 ----

export function compressImage(file) {
  return localPhotos.compressImage(file);
}

export async function listPhotos(spotId) {
  if (mode === 'cloud') return sync.listPhotos(boardId, spotId).catch(() => []);
  return localPhotos.getPhotos(spotId).catch(() => []);
}

export async function addPhoto(spotId, dataUrl) {
  const photo = { id: localPhotos.newPhotoId(), spotId, dataUrl, createdAt: Date.now() };
  if (mode === 'cloud') {
    await sync.putPhoto(boardId, photo);
    return photo;
  }
  return localPhotos.addPhoto(spotId, dataUrl);
}

export async function deletePhoto(id) {
  if (mode === 'cloud') return sync.removePhotoDoc(boardId, id);
  return localPhotos.deletePhoto(id);
}

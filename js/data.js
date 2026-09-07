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

// URLの招待リンク > 前回のボード > 新規作成 の優先順で決める
function resolveBoardId() {
  const fromHash = location.hash.startsWith(HASH_PREFIX)
    ? location.hash.slice(HASH_PREFIX.length).trim() : '';
  if (fromHash && fromHash.length >= 20) {
    localStorage.setItem(BOARD_KEY, fromHash);
    history.replaceState(null, '', location.pathname + location.search);
    return { id: fromHash, joined: true };
  }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const saved = localStorage.getItem(BOARD_KEY);
  if (saved) return { id: saved, joined: false };
  const created = newBoardId();
  localStorage.setItem(BOARD_KEY, created);
  return { id: created, joined: false, created: true };
}

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
    sync.watchSpots(boardId, (cloudSpots, meta) => {
      const next = cloudSpots.filter(isValidSpot);
      // 通信できずキャッシュだけの空スナップショットで、端末内のデータを消さない
      if (next.length === 0 && meta.fromCache && spots.length > 0) return;
      spots = next;
      saveSpotsLocal(spots); // オフライン起動用のキャッシュ
      status = { synced: !meta.fromCache, pending: meta.hasPendingWrites };
      onStatus(status);
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

export async function deleteSpot(id) {
  if (mode === 'cloud') {
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

// 地点に紐づく写真の保存。localStorageは容量が小さい(約5MB)ので、
// 写真だけIndexedDB(通常は数百MB以上使える)に分けて保存する。
// 保存前にリサイズ+JPEG圧縮して1枚あたり100〜200KB程度に抑える。

const DB_NAME = 'tasobow.landscout.photos';
const STORE = 'photos';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('spotId', 'spotId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newPhotoId() {
  return genId();
}

// 撮影画像をアプリ保存用に縮小圧縮する。
// クラウド同期では1枚=1ドキュメント(上限1MB)なので、収まるまで品質を落とす。
const MAX_PHOTO_BYTES = 900 * 1024;

export async function compressImage(file, maxDim = 1280, quality = 0.8) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  let q = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length > MAX_PHOTO_BYTES && q > 0.3) {
    q -= 0.15;
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  return dataUrl;
}

export async function addPhoto(spotId, dataUrl) {
  const db = await openDb();
  const photo = { id: genId(), spotId, dataUrl, createdAt: Date.now() };
  await reqToPromise(tx(db, 'readwrite').add(photo));
  return photo;
}

export async function getPhotos(spotId) {
  const db = await openDb();
  const photos = await reqToPromise(tx(db, 'readonly').index('spotId').getAll(spotId));
  return photos.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deletePhoto(id) {
  const db = await openDb();
  await reqToPromise(tx(db, 'readwrite').delete(id));
}

export async function deletePhotosForSpot(spotId) {
  const photos = await getPhotos(spotId);
  for (const p of photos) await deletePhoto(p.id);
}

export async function getAllPhotos() {
  const db = await openDb();
  return reqToPromise(tx(db, 'readonly').getAll());
}

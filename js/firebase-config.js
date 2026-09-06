// Firebaseの接続先。Firebaseコンソール →「プロジェクトの設定」→「マイアプリ」の
// firebaseConfig をそのまま貼り替えれば別プロジェクトにも切り替えられる。
// ここに書く値は「接続先の住所」に相当する公開情報で、秘密鍵ではない。
// 実際のアクセス制御はFirestoreのセキュリティルール(firestore.rules)で行う。
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB4QG_BNXVDoIh2nrCm50_ZLzc-4fgoIHE',
  authDomain: 'land-hunter-54449.firebaseapp.com',
  projectId: 'land-hunter-54449',
  storageBucket: 'land-hunter-54449.firebasestorage.app',
  messagingSenderId: '800952714403',
  appId: '1:800952714403:web:fba06729ddd3cc21cbab16',
};

// 設定が未入力ならクラウド同期を使わずローカル保存のみで動かす
export function isConfigured() {
  return !String(FIREBASE_CONFIG.projectId).startsWith('__');
}

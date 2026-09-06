// Firebaseの接続先。Firebaseコンソール →「プロジェクトの設定」→「マイアプリ」の
// firebaseConfig をそのまま貼り替えれば別プロジェクトにも切り替えられる。
// ここに書く値は「接続先の住所」に相当する公開情報で、秘密鍵ではない。
// 実際のアクセス制御はFirestoreのセキュリティルール(firestore.rules)で行う。
export const FIREBASE_CONFIG = {
  apiKey: '__FILL_ME__',
  authDomain: '__FILL_ME__',
  projectId: '__FILL_ME__',
  storageBucket: '__FILL_ME__',
  messagingSenderId: '__FILL_ME__',
  appId: '__FILL_ME__',
};

// 設定が未入力ならクラウド同期を使わずローカル保存のみで動かす
export function isConfigured() {
  return !String(FIREBASE_CONFIG.projectId).startsWith('__');
}

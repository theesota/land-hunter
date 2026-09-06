# 土地ハンター

家づくりの土地探し用マップアプリ。歩きながら気になった土地をタップで登録し、ハザード・学区・周辺施設を自動で調べ、**家族3人がリアルタイムで共有**できる。

公開URL: https://theesota.github.io/land-hunter/

## できること

- **タップして登録**: 地図をタップ → 画面下の「登録する」→ 名前・ステータス・★評価・メモ・写真を保存
- **土地情報の自動取得**: 登録画面に住所 / 学区(学校まで徒歩何分) / 最寄り駅(徒歩・車) / 周辺施設(スーパー等) / ハザード(浸水深と目安)が自動で埋まる
- **ハザード重ね表示**: 洪水・土砂災害3種・津波・高潮。判定結果は地図と同じ色チップ+生活実感の目安つき
- **学区表示**: 伊勢崎市の小学校区23・中学校区11。校区の中心に学校名ラベル
- **基準地点**: 自宅・実家・駅を設定すると、候補地ごとに距離と徒歩/車の目安、Googleマップの車ルートリンクが出る
- **現在地追跡・地域検索・接道方角・物件URL・写真**
- **リアルタイム共有**: 招待リンク(短いURL)を送るだけ。開いた人と地点・写真が自動で同期される

## 共有の仕組み

- 「ボード」= 共有スペース。ボードIDは128bit乱数で、それを含む招待リンクを知っている人だけが読み書きできる(鍵付きURL方式、ログイン不要)
- データはFirestoreに保存。誰かの編集は全員の画面へ即時反映される
- 端末内キャッシュを持つので、電波の悪い現地でも表示・入力でき、復帰時に自動送信される
- `js/firebase-config.js` が未設定のときは、クラウドを使わず端末内保存だけで動く(バッジに「この端末のみ」と表示)

## セットアップ(共有を使う場合)

1. [Firebaseコンソール](https://console.firebase.google.com)でプロジェクトを作成(無料のSparkプランでよい)
2. 「Database と Storage」→ Firestore Database を作成(ロケーション: asia-northeast1)
3. 「アプリを追加」→ ウェブ(`</>`)を登録し、表示された `firebaseConfig` を `js/firebase-config.js` に貼る
4. Firestoreの「ルール」タブに `firestore.rules` の内容を貼って公開

## 技術構成

- 地図: [Leaflet](https://leafletjs.com/)(同梱)。ベースは[OpenStreetMap](https://www.openstreetmap.org/copyright) / [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)
- ハザード: [重ねるハザードマップ配信タイル](https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html)。浸水深は公式凡例の色をタイルから読み取って判定
- 学区・駅・学校位置: [国土数値情報](https://nlftp.mlit.go.jp/ksj/)(A27/A32/N02/P29)から対象エリアのみ抽出して同梱
- 住所: 国土地理院 逆ジオコーダ / 周辺施設: OpenStreetMap (Overpass API)
- 同期: Firebase Firestore(SDKは`vendor/firebase/`に同梱)
- ビルド不要のES Modules構成:
  - `js/data.js` … データ層の入り口(クラウド/ローカルの切替を吸収)
  - `js/sync.js` … Firestore接続・購読・読み書き
  - `js/landinfo.js` … 土地情報の自動取得(住所・学区・駅・施設・ハザード)
  - `js/map.js` … Leafletラッパー / `js/app.js` … UI結線
  - `js/store.js` … 端末内保存 / `js/photos.js` … 写真の圧縮とIndexedDB

## 開発時のテスト

```
npx firebase emulators:start --only firestore   # ローカルのFirestore
python3 -m http.server 8776                     # 静的配信
# ブラウザで http://localhost:8776/index.html?emu=1 を開くとエミュレータに接続する
```

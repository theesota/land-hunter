# テスト(Playwright + Firestoreエミュレータ)

前提: Node 22、Chromium、`npm i playwright firebase-tools`(このフォルダで)。

```bash
# 1. アプリを配信(リポジトリのルートで)
python3 -m http.server 8776 &
# 2. Firestoreエミュレータ(同期系のテストだけ必要)
npx firebase-tools emulators:start --only firestore --project land-hunter-dev &
# 3. 実行(このフォルダで)
node regress.mjs      # 登録〜編集〜保存の回帰(要エミュレータ)
node synctest2.mjs    # 3端末の共有(要エミュレータ)
node boardtest.mjs    # ボードIDの取り違え・持ち込み(要エミュレータ)
node carrytest.mjs    # 招待リンクを開いた端末の地点の持ち込み(要エミュレータ)
node trashtest.mjs    # ゴミ箱(要エミュレータ)
node rescuetest.mjs   # 空スナップショットで消えない(要エミュレータ)
node picktest.mjs     # 基準地点を地図で選ぶ
node chiptest.mjs     # 表示パネルのチップと設定
node geotest2.mjs     # 初回の地図位置
node geoperm.mjs geoperm2.mjs   # 位置情報の許可案内
node popupshot.mjs    # 詳細シートの内容(学区の連動、アイコン)
node searchtest.mjs   # 緯度経度・URL・郵便番号付き住所の検索
node cameratest.mjs   # カメラモード(EXIF/現在地/地図タップ)
node zonetest.mjs     # 区域区分・用途地域・坪数/売り値/上下水道・建てられる目安
node coordunit.mjs exifunit.mjs  # 単体(ブラウザ不要)
```

Chromiumの起動は `executablePath: '/opt/pw-browsers/chromium'` と agent proxy 前提で書いてある。
ローカルで動かすときは `chromium.launch()` に置き換える。

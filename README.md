# dm-converter

DM（数値地形図データファイル）をGeoJSON形式に変換します。線・面・記号・方向・注記の5種類に分割して出力します。

出力したGeoJSONは、QGIS等での地図表示のほか、tippecanoe・pmtiles によるベクトルタイル化を経て Web地図の背景地図として利用できます。

まず動くものを見るなら、変換済みデータを表示するデモがそのまま開けます（インストール不要）。右下の背景切替で「白図」を選ぶと、変換結果である都市計画基本図だけを表示できます。

- **デモ**: https://shiwaku.github.io/dm-converter/

## クイックスタート

必要なのは **Node.js 18以上**だけです。変換自体に外部ツールは要りません。

**1. DMデータを用意する**

手元にデータが無ければ、[静岡市オープンデータ](https://data.bodik.jp/dataset/221007_1712212695)の都市計画基本図（1/2,500・1/10,000）が試用に使えます。ダウンロードした `.dm` ファイルを縮尺ごとのフォルダに置きます（`.dmi` が混じっていても読み飛ばされます）。

```
input/
├── 2500/     # 縮尺1/2,500 の *.dm
└── 10000/    # 縮尺1/10,000 の *.dm
```

> DMデータは公共測量成果です。入手先の自治体が定める利用条件を確認してください（[利用上の注意](docs/legal.md)）。

**2. 変換する**

```bash
git clone https://github.com/shiwaku/dm-converter.git
cd dm-converter
npm install
node src/index.js            # input/2500/ を変換（座標系はファイルから自動判定）
ls output/                   # 線・面・記号・方向・注記 の5ファイルが出る
```

入力の平面直角座標系（系番号）は DM ファイルから自動で判定します。判定できないときや旧日本測地系のデータは、`--epsg` で指定します（例: 愛知県なら `--epsg 6675`）。系の一覧は[出力仕様](docs/output-spec.md#座標系)にあります。

**3. 地図で見る**

出力した GeoJSON は QGIS にそのまま読み込めます。同梱のスタイルを当てると図式どおりに描かれます（[QGIS での表示](docs/qgis.md)）。ベクトルタイル化して自分のデータをビューワで表示する手順は[ベクトルタイルと一括ビルド](docs/build-and-tiles.md)を参照してください。

## 使い方

縮尺・座標系・入力先はオプションで切り替えます。

```bash
# 縮尺1/10000
node src/index.js --scale 10000

# 入力座標系を指定する場合
node src/index.js --epsg 6675

# 入力フォルダを直接指定する場合
node src/index.js --scale 2500 --input /path/to/dm_folder
```

よく使う2つは npm scripts でも実行できます。

```bash
npm start            # node src/index.js と同じ（1/2500）
npm run start:10000  # node src/index.js --scale 10000 と同じ
```

### オプション

| オプション | デフォルト | 説明 |
|---|---|---|
| `--scale` | `2500` | 縮尺（入力フォルダ名と出力ファイル名に使用） |
| `--epsg` | 自動判定 | 入力データの座標参照系（EPSGコード）。指定すると全ファイルに適用 |
| `--input` | `input/<scale>/` | DMファイルが格納されたフォルダ |
| `--jobs` | CPUコア数 − 1 | 並列変換のワーカー数。`1` で逐次実行 |

`--epsg` に指定できる値は[座標系の一覧](docs/output-spec.md#座標系)を参照してください。省略時は .dmi・I レコード・図郭識別番号から系番号を読み、JGD2011 の該当系とみなします（[判定の詳細](docs/output-spec.md#座標系)）。

### 出力ファイル

`output/` フォルダに縮尺ごとの5ファイルが生成されます。出力はすべて EPSG:4326（WGS84 / 緯度経度）です。

| ファイル名 | 内容 |
|---|---|
| `都市計画基本図_<縮尺>_線.geojson` | 線要素（E2）・円弧（E4） |
| `都市計画基本図_<縮尺>_面.geojson` | 面要素（E1）・円（E3） |
| `都市計画基本図_<縮尺>_記号.geojson` | 記号・点要素（E5） |
| `都市計画基本図_<縮尺>_注記.geojson` | 注記要素（E7） |
| `都市計画基本図_<縮尺>_方向.geojson` | 方向要素（E6） |

属性の一覧は[出力仕様](docs/output-spec.md)を参照してください。

## 一括ビルド（GeoJSON + GeoParquet + PMTiles）

GeoJSON だけ作り直して GeoParquet や PMTiles が古いまま残ると、配信データと変換結果が食い違います。`scripts/build.sh` で最後までまとめて焼き直せます。

```bash
npm run build                    # 1/2,500 と 1/10,000 を一括
bash scripts/build.sh 2500       # 縮尺を指定
```

DM → GeoJSON → GeoParquet（`ogr2ogr`）→ MBTiles（`tippecanoe`）→ PMTiles（`pmtiles convert`）の順に処理します。ogr2ogr / tippecanoe / pmtiles が無ければ該当する段だけスキップされます。段を飛ばす環境変数や tippecanoe のオプションは[ベクトルタイルと一括ビルド](docs/build-and-tiles.md)を参照してください。

## QGIS での表示

記号・方向・注記は代表点のポイントとして出力するため、そのまま読み込むと同じ点マーカーが並ぶだけになります。出力5種すべてのレイヤスタイルを [`qgis/`](qgis/) に同梱しているので、**データファイルと同じフォルダに拡張子を `.qml` に替えた名前で置くと自動で適用されます。**

```bash
# 例: 出力先に5種類ぶんを縮尺ごとに配置する
for scale in 2500 10000; do
  for kind in 線 面 記号 方向 注記; do
    cp "qgis/都市計画基本図_${kind}.qml" "output/都市計画基本図_${scale}_${kind}.qml"
  done
done
```

地図記号の大きさ、注記の表示縮尺、角度の読み替えなどは [QGIS での表示](docs/qgis.md)を参照してください。

## ビューワ

本ツールで変換したデータをベクトルタイル化して表示するWebビューワを [`viewer/`](viewer/) に同梱しています。静岡市の都市計画基本図（1/10,000・1/2,500）を、国土地理院の最適化ベクトルタイル（淡色地図風・標準地図風）・静岡市オルソ画像（航空写真）・白図（無地）から選べる背景の上に表示します。

**右下の背景切替で「白図」を選ぶと背景地図が消え、都市計画基本図だけが表示されます。** これが本ツールの変換結果そのもので、公共測量標準図式に従った線種・線幅・地図記号・注記の再現を確認できます。他の3つは、基本図を既存の地図や空中写真と重ねて見るための背景です。

```bash
cd viewer
npm install
npm run dev      # http://localhost:5174/
```

基本図のスタイルは静的な MapLibre スタイルの JSON として持っており、ビューワもこれを読んで描画します。外部ツールからも参照できます（`pmtiles://` を解せるツールが必要）。

- https://shiwaku.github.io/dm-converter/style/kihonzu-light.json
- https://shiwaku.github.io/dm-converter/style/kihonzu-dark.json

レイヤー構成やスタイル定義は [viewer/README.md](viewer/README.md) を参照してください。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [都市計画基本図とDMデータ](docs/dm-format.md) | 都市計画基本図とは・縮尺と地図情報レベル・対応レコードタイプ・DMファイルの構造 |
| [出力仕様](docs/output-spec.md) | 出力ファイルと属性・方向（E6）と注記（E7）の扱い・座標系・処理時間 |
| [QGIS での表示](docs/qgis.md) | 同梱のレイヤスタイル（`.qml`）・地図記号・角度の読み替え |
| [ベクトルタイルと一括ビルド](docs/build-and-tiles.md) | `scripts/build.sh` の詳細・tippecanoe のオプション・タイル設計 |
| [利用上の注意](docs/legal.md) | 測量法上の扱い・静岡市データの使用承認・ライセンス |
| [ビューワ](viewer/README.md) | 同梱のWebビューワのレイヤー構成とスタイル定義 |

## ディレクトリ構成

```
dm-converter/
├── src/                  # 変換プログラム（エントリポイントは index.js）
├── docs/                 # 詳細ドキュメント
├── input/                # DMファイル（*.dm）を配置。Git管理対象外
│   ├── 2500/             # 縮尺1/2500
│   ├── 10000/            # 縮尺1/10000
│   └── 25000/            # 縮尺1/25000
├── output/               # 変換後のGeoJSON等が出力される。Git管理対象外
├── viewer/               # 変換結果を確認するWebビューワ（Vite + MapLibre）
├── scripts/
│   ├── build.sh          # GeoJSON+GeoParquet+PMTiles の一括生成
│   ├── make-qgis-styles.js  # QGIS レイヤスタイル（qgis/*.qml）の生成
│   └── sync-dm-symbols.js   # 地図記号SVGを dm-sprite の最新に追従させる
├── qgis/                 # QGIS レイヤスタイル（記号・方向・注記）
│   └── symbols/          # 地図記号SVG（dm-sprite / MIT）。SOURCE.json に取得元コミット
├── LICENSE               # Apache-2.0（対象は変換プログラム。DMデータは対象外）
└── NOTICE                # 帰属表示・測量法上の表示要件
```

## 留意事項

- **DMデータは測量法に基づく公共測量成果です。** 複製・使用には原則として測量計画機関（自治体）の承認が必要です。`input/` と `output/` は `.gitignore` で除外しており、リポジトリにデータは含めていません。
- **デモで使用している静岡市データは、測量法第44条の使用承認（07静都都第2068号／2027年1月19日まで）に基づいています。** この承認は申請者個人に与えられたもので、本リポジトリの利用者に及ぶものではありません。同じデータを使う場合は別途申請が必要です。
- 対応しているのは E1（面）・E2（線）・E3（円）・E4（円弧）・E5（記号）・E6（方向）・E7（注記）です。E8（属性）はスキップされます。
- 出力される属性はすべて文字列型です（`Angle` も `"86"` のような文字列）。

詳細は[利用上の注意](docs/legal.md)を参照してください。

## ライセンス

本リポジトリのソースコードおよびドキュメントは [Apache License, Version 2.0](LICENSE) です。**変換プログラムとビューワが対象で、入力するDMデータおよび変換結果には適用されません。** 再配布する場合は [NOTICE](NOTICE) ファイルを同梱してください。

## 参考文献

- 国土交通省「[都市計画情報のデジタル化・オープン化ガイダンス 第1.0版](https://www.mlit.go.jp/toshi/tosiko/content/001618641.pdf)」（令和5年6月）
- 国土地理院「[作業規程の準則](https://www.gsi.go.jp/gijyutukanri/gijyutukanri41018.html)」／「[付録7 公共測量標準図式](https://www.gsi.go.jp/common/000258741.pdf)」
- [測量法（昭和24年法律第188号）](https://laws.e-gov.go.jp/law/324AC0000000188)

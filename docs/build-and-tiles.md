# ベクトルタイルと一括ビルド

[← README に戻る](../README.md)

## 一括ビルド（GeoJSON + GeoParquet + PMTiles）

GeoJSON だけ作り直して GeoParquet や PMTiles が古いまま残ると、配信データと変換結果が食い違います。`scripts/build.sh` で最後までまとめて焼き直せます。

```bash
npm run build                    # 1/2,500 と 1/10,000 を一括
bash scripts/build.sh 2500       # 縮尺を指定
bash scripts/build.sh 2500 10000 25000
```

実行される処理は次の3段です。

1. **DM → GeoJSON**（`src/index.js`）
2. **GeoJSON → GeoParquet**（`ogr2ogr -f Parquet`）
3. **GeoJSON → MBTiles → PMTiles**（`tippecanoe` → `pmtiles convert`）

ズーム範囲は縮尺から自動で決まります（[最大ズームレベルの決め方](#最大ズームレベルの決め方)の表と同じ値）。未定義の縮尺を指定した場合はタイル生成のみスキップされ、`zoom_range` への追記を促すメッセージが出ます。

### 環境変数

| 変数 | 効果 |
|---|---|
| `EPSG=6675` | 入力データの座標参照系を指定（既定は自動判定） |
| `SKIP_CONVERT=1` | DM→GeoJSON を飛ばし、既存のGeoJSONから後段だけ作り直す |
| `SKIP_PARQUET=1` | GeoParquet を作らない |
| `SKIP_TILES=1` | MBTiles / PMTiles を作らない |

### 必要なツール

いずれも無ければ該当する段だけスキップされ、変換自体は完了します。

| ツール | 動作確認バージョン | 用途 |
|---|---|---|
| [OSGeo4W](https://trac.osgeo.org/osgeo4w/) の ogr2ogr | GDAL 3.9.3 | GeoParquet 生成 |
| [tippecanoe](https://github.com/felt/tippecanoe) | v2.80.0 | ベクトルタイル生成 |
| [go-pmtiles](https://github.com/protomaps/go-pmtiles) | v1.30.3 | PMTiles 変換 |

> **GeoParquet には Parquet ドライバを持つ GDAL が必要です。** conda 版・Debian 版の GDAL は既定で Parquet ドライバを含みません。スクリプトは `PATH` 上の `ogr2ogr` を調べ、Parquet 非対応であれば WSL 環境の `C:\OSGeo4W\bin\ogr2ogr.exe`（見つからなければ `C:\OSGeo4W64\bin\ogr2ogr.exe`）へ自動でフォールバックします（Windows形式のパスへの変換も行います）。

## 静岡市データでの実行例

[静岡市オープンデータ](https://data.bodik.jp/dataset/221007_1712212695)の都市計画基本図（1/2,500・1/10,000）で、[デモのビューワ](https://shiwaku.github.io/dm-converter/)のデータを作った際の手順です。

**1. DMファイルを配置する**

ダウンロードした `.dm` ファイルを縮尺ごとのフォルダに置きます。`.dmi`（索引ファイル）が同梱されていても読み飛ばされるため、そのまま置いて構いません。

```
input/
├── 2500/     # 123ファイル・628MB
└── 10000/    # 10ファイル・251MB（+ index10000.dmi）
```

**2. 一括ビルドを実行する**

座標系は DM ファイルから自動で判定するので、通常は `--epsg` / `EPSG` の指定は不要です。判定できないデータや旧日本測地系のデータのときだけ指定します。

```bash
npm run build            # 1/2,500 と 1/10,000 を一括（scripts/build.sh 2500 10000）
```

DM→GeoJSON→GeoParquet→MBTiles→PMTiles まで通ります。GeoJSON だけ欲しい場合は `node src/index.js --scale 2500` のように変換だけを実行します。

**3. 生成物**

| | フィーチャ数 | PMTiles | ズーム範囲 |
|---|---:|---:|---|
| 1/2,500 | 2,274,166 | 84MB | ZL15〜16 |
| 1/10,000 | 984,449 | 39MB | ZL2〜14 |

このほかに縮尺ごとに GeoJSON 5ファイル・GeoParquet 5ファイル・MBTiles が `output/` に出ます。

**部分的な焼き直し**

GeoJSON を作り直さずに後段だけやり直す場合は環境変数で段を飛ばします。

```bash
# タイルだけ焼き直す（tippecanoe のオプションを変えたとき）
SKIP_CONVERT=1 SKIP_PARQUET=1 npm run build

# GeoParquet だけ焼き直す（GeoJSON より古くなっているとき）
SKIP_CONVERT=1 SKIP_TILES=1 npm run build
```

**タイルサイズの確認**

生成した PMTiles のタイルサイズ分布は [vt-optimizer-rs](https://github.com/unvt/vt-optimizer-rs) で確認できます。

```bash
vt-optimizer inspect output/kihonzu_10000.pmtiles
```

## ベクトルタイル作成（参考）

以下は `scripts/build.sh` が内部で実行している内容です。手動で調整したい場合の参考として残しています。

縮尺ごとに別々の PMTiles を作成し、表示側で切り替えるのが基本の構成です（[viewer/](../viewer/) はこの方式）。

| 縮尺 | tippecanoe のズーム範囲 | 最大ZL | ビューワでの表示範囲 |
|---|---|---|---|
| 1/25,000 | `-Z2 -z12` | 12 | — |
| 1/10,000 | `-Z2 -z14` | 14 | z2〜z14.99 |
| 1/2,500 | `-Z15 -z16` | 16 | z15〜 |

最小ズームは、その縮尺のタイルを何倍まで引いて表示したいかで決めます。1/10,000 を `-Z2` としているのは、広域に引いた状態でも背景図として表示し続けるためです。一方 1/2,500 は z15 以上でのみ表示するため `-Z15` から作成します。

各縮尺を1ファイルにまとめたい場合は `tile-join` で結合できますが、その際はズーム範囲が重複しないよう割り当て直してください（例: 1/10,000 を `-Z13 -z14` にする）。表示側で切り替える構成では重複して問題ありません。

### 最大ズームレベルの決め方

ベクトルタイルは座標をタイル内の整数格子（0〜4,095）に量子化して格納するため、変換時にわずかな位置誤差が生じます。元データの精度を損なわないよう、**格子間隔（分解能）が地図の許容誤差以下**になる最小のZLを最大ズームレベルに選びます。

- **許容誤差** = 縮尺分母 × 0.1mm（図上0.1mmに相当する地上距離）
- **分解能** = 赤道周長 40,075,016.686m ÷ (2^ZL × 4,096)

| 縮尺 | 許容誤差 | 最大ZL | そのZLの分解能 | 1段下のZLの分解能 |
|---|---|---|---|---|
| 1/25,000 | 2.5m | **12** | 2.389m | 4.777m ✗ |
| 1/20,000 | 2.0m | **13** | 1.194m | 2.389m ✗ |
| 1/10,000 | 1.0m | **14** | 0.597m | 1.194m ✗ |
| 1/5,000 | 0.5m | **15** | 0.299m | 0.597m ✗ |
| 1/2,500 | 0.25m | **16** | 0.149m | 0.299m ✗ |

分解能は赤道基準の最大値で、実際には緯度 φ において cos φ 倍に小さくなります（静岡市付近の北緯35度では ZL16 で約0.12m）。したがって上表のZLであれば日本国内では余裕をもって許容誤差を満たします。

### タイルサイズの基準（1タイル 1,250KB）

ベクトルタイルの設計では、**1タイルあたり 1,250KB** が実務上の基準になります。Mapbox Tiling Service が明示している上限で、超えた分はレイヤーごとに予測不可能な形でフィーチャが削除されます。

> Each tile has a limit of 1250 kilobytes.
>
> — [Mapbox Tiling Service / Vector tiles](https://docs.mapbox.com/mapbox-tiling-service/ja/vector/)

タイルの担当範囲はズームが下がるほど広くなるため、**低ズームほどこの上限に当たりやすい**という非対称性があります。ZL0 は世界全体が1タイルなので、そのズームで描くデータすべてが 1,250KB に収まらなければなりません。都市計画基本図のように市域全体を1つのタイルセットで低ズームまで作ると、ZL9〜11 で1タイルが数MBに達します。

タイルサイズの分布は [vt-optimizer-rs](https://github.com/unvt/vt-optimizer-rs) の `inspect` で確認できます。同ツールの `--max-tile-bytes` の既定値も 1,280,000 バイト（= 1,250KB）で、この基準を超えたタイル数が `Tiles over limit` として出ます。

```bash
vt-optimizer inspect output/kihonzu_10000.pmtiles
```

上限に収めるための手段は、効果の大きい順に次のとおりです。本リポジトリでは前2つを採用しています。

| 手段 | 内容 | 本リポジトリ |
|---|---|---|
| 属性を削る | 描画に使わない属性を `-y` で落とす。特にフィーチャごとにユニークな文字列（IDなど）は文字列辞書を大きく膨らませる | [タイルに残す属性](#タイルに残す属性) |
| 描かないフィーチャを落とす | スタイル側の `minzoom` で描かれないものを `-j` でタイルから除外する | [低ズームで描かれないフィーチャの除外](#低ズームで描かれないフィーチャの除外) |
| ジオメトリを簡略化する | `-S` で低ズームの頂点を減らす。`--simplify-only-low-zooms` を併用すれば最大ズームの精度は保たれる | 未適用 |
| フィーチャを間引く | `--drop-densest-as-needed` などで密集部を落とす | 未適用（`-r1` の方針と衝突する） |
| ズーム範囲を分ける | 低ズームは粗い縮尺のタイルセットに任せる | 縮尺ごとに別タイルセット |

### tippecanoe のオプション

| オプション | 意味 |
|---|---|
| `-Z` / `-z` | 最小／最大ズームレベル |
| `-r1` | ポイントの間引きを無効化。**記号・注記では必須**（付けないと点が間引かれて消える） |
| `--no-feature-limit` | タイルあたりのフィーチャ数上限を解除 |
| `--no-tile-size-limit` | タイルサイズ上限を解除 |
| `-L` | レイヤー名を指定して入力ファイルを追加 |
| `--force` | 既存の出力ファイルを上書き |
| `-j` / `--feature-filter` | ズームや属性でフィーチャを絞り込む（[低ズームで描かれないフィーチャの除外](#低ズームで描かれないフィーチャの除外)を参照） |
| `-y` | タイルに残す属性を指定（[タイルに残す属性](#タイルに残す属性)を参照） |

密集地物でタイルサイズが問題になる場合は `--drop-densest-as-needed` の併用を検討してください。

### タイルに残す属性

`-y` でビューワの描画に必要な属性だけを残しています。GeoJSON 側の属性は削っていないため、QGIS などで全属性を使う用途には影響しません。

```
-y Code -y Text -y Angle
```

| 属性 | 用途 |
|---|---|
| `Code` | 全レイヤーの描き分け（フィルタ・アイコン名） |
| `Text` | 注記の文字列 |
| `Angle` | 記号・注記の回転角 |

落としている属性とその理由:

| 属性 | 理由 |
|---|---|
| `Elno` | 要素識別番号。フィーチャごとにユニークな文字列で、タイル内の文字列辞書を最も膨らませる |
| `RecordType` / `DataType` / `DataKind` | レイヤー内で単一値のため情報量がない |
| `Vnflag` | 縦横フラグ。現状のビューワは未使用（縦書き注記を実装する場合は復活させる） |

1/10,000（ZL2〜14）での実測値:

| 条件 | 総容量 | 最大タイル | 1,250KB超 | 平均タイル |
|---|---|---|---|---|
| フィルタなし | 83.10MB | 5.51MB | 15 | 363.64KB |
| 建物の除外のみ | 74.49MB | 4.54MB | 14 | 325.95KB |
| 建物の除外 + 属性の絞り込み | 44.90MB | 2.54MB | 5 | 196.50KB |
| さらに低ズームの描画外フィーチャを除外（現行） | **38.98MB** | **1.74MB** | **3** | **170.59KB** |

ジオメトリは変わらず、線レイヤの属性キーが5個→1個、値の辞書が422,382個→61個に減ります（ZL13で計測）。**属性の絞り込みのほうが建物の除外より削減効果が大きい**ことに注意してください。

1/2,500（ZL15〜16）は属性の絞り込みのみが効き、116.38MB → 83.62MB、最大タイル 340.68KB → 241.96KB になります。

なおビューワのポップアップは、残した属性しか表示できなくなります。

### 低ズームで描かれないフィーチャの除外

ビューワは低ズームではレイヤーの一部しか描きません（`viewer/src/layers.ts` の `minzoom`）。タイルに入れたままだと、描かれないのに転送とデコードのコストだけがかかります。`-j` の条件をビューワの `minzoom` と対応させて、描かれないフィーチャをタイルから落とします。

| レイヤー | 除外条件 | 対応するビューワの `minzoom` |
|---|---|---|
| 面 | 建物 `3001`〜`3004` を ZL13未満 | 建物は低ズームでは骨格に不要 |
| 線 | 建物を ZL13未満、等高線 `7101`〜`7104` を ZL12未満 | 分類コードごとの出現ズームはタイル側で決まる |
| 記号 | レイヤーごと ZL13未満 | `symbol`: 13 |
| 方向 | レイヤーごと ZL13未満 | `direction`: 13 |
| 注記 | ZL13未満 | `annotation`: 13 |

**`scripts/build.sh` の閾値はビューワの `minzoom` と対になっています。片方を変えたら両方直してください。** 対応表は [viewer/README.md の「1/10,000 レイヤー一覧」](../viewer/README.md#110000-レイヤー一覧)にあります。

除外の効果が最も大きいのは建物です。面レイヤはフィーチャの約9割が建物（`3001` 普通建物・`3002` 堅ろう建物・`3003` `3004` 無壁舎）で、これがないとZL9〜11で1タイルが数MBに達します。次に大きいのが等高線で、線レイヤのフィーチャの約17%を占めます。

建物を除外する条件は次の形になります。

```
-j '{"kihonzu_10000_polygon": ["any", [">=", "$zoom", 13], ["!in", "Code", "3001", "3002", "3003", "3004"]],
     "kihonzu_10000_line":    ["any", [">=", "$zoom", 13], ["!in", "Code", "3001", "3002", "3003", "3004"]]}'
```

- `Code` は文字列属性なので、除外値も文字列で指定します。
- `$zoom` は整数のタイルズームに対する判定です。MapLibre はベクトルタイルで `tileZoom = floor(zoom)` を使うため、建物が現れる境界はマップズーム13.0になります（12.99以下は非表示）。
- 最小ZLが13以上の縮尺（1/2,500 は ZL15〜16）では常に条件を満たすため、このフィルタは無影響です。`scripts/build.sh` は縮尺によらず同じフィルタを渡しています。
- 逆に**最大ZLが12以下の縮尺（1/25,000 は ZL2〜12）では建物が一切含まれなくなります**。1/25,000 を単体で使い建物が必要な場合は、`$zoom` の閾値を下げるかフィルタを外してください。
- タイルサイズの分布は [vt-optimizer-rs](https://github.com/unvt/vt-optimizer-rs) の `inspect` で確認できます。

### 1/2500 → MBTiles

```bash
tippecanoe \
  -o kihonzu_2500.mbtiles \
  -Z15 -z16 \
  -r1 \
  --no-feature-limit \
  --no-tile-size-limit \
  --force \
  -y Code -y Text -y Angle \
  -L kihonzu_2500_line:都市計画基本図_2500_線.geojson \
  -L kihonzu_2500_polygon:都市計画基本図_2500_面.geojson \
  -L kihonzu_2500_symbol:都市計画基本図_2500_記号.geojson \
  -L kihonzu_2500_direction:都市計画基本図_2500_方向.geojson \
  -L kihonzu_2500_annotation:都市計画基本図_2500_注記.geojson
```

### 1/10000 → MBTiles

```bash
tippecanoe \
  -o kihonzu_10000.mbtiles \
  -Z2 -z14 \
  -r1 \
  --no-feature-limit \
  --no-tile-size-limit \
  --force \
  -y Code -y Text -y Angle \
  -j '{"kihonzu_10000_polygon": ["any", [">=", "$zoom", 13], ["!in", "Code", "3001", "3002", "3003", "3004"]],
       "kihonzu_10000_line":    ["any", [">=", "$zoom", 13], ["!in", "Code", "3001", "3002", "3003", "3004"]]}' \
  -L kihonzu_10000_line:都市計画基本図_10000_線.geojson \
  -L kihonzu_10000_polygon:都市計画基本図_10000_面.geojson \
  -L kihonzu_10000_symbol:都市計画基本図_10000_記号.geojson \
  -L kihonzu_10000_direction:都市計画基本図_10000_方向.geojson \
  -L kihonzu_10000_annotation:都市計画基本図_10000_注記.geojson
```

### 1/25000 → MBTiles

```bash
tippecanoe \
  -o kihonzu_25000.mbtiles \
  -Z2 -z12 \
  -r1 \
  --no-feature-limit \
  --no-tile-size-limit \
  --force \
  -y Code -y Text -y Angle \
  -j '{"kihonzu_25000_polygon": ["any", [">=", "$zoom", 13], ["!in", "Code", "3001", "3002", "3003", "3004"]],
       "kihonzu_25000_line":    ["any", [">=", "$zoom", 13], ["!in", "Code", "3001", "3002", "3003", "3004"]]}' \
  -L kihonzu_25000_line:都市計画基本図_25000_線.geojson \
  -L kihonzu_25000_polygon:都市計画基本図_25000_面.geojson \
  -L kihonzu_25000_symbol:都市計画基本図_25000_記号.geojson \
  -L kihonzu_25000_direction:都市計画基本図_25000_方向.geojson \
  -L kihonzu_25000_annotation:都市計画基本図_25000_注記.geojson
```

### PMTiles変換

縮尺ごとに個別の PMTiles に変換します（結合しません）。表示側で縮尺を切り替えます。

```bash
pmtiles convert kihonzu_25000.mbtiles kihonzu_25000.pmtiles
pmtiles convert kihonzu_10000.mbtiles kihonzu_10000.pmtiles
pmtiles convert kihonzu_2500.mbtiles  kihonzu_2500.pmtiles
```

### 1ファイルに結合する場合（任意）

配信ファイルを1つにまとめたい場合は `tile-join` で結合します。この場合は**ズーム範囲が重複しないよう tippecanoe の `-Z` を割り当て直してください**（1/25,000 → `-Z2 -z12`、1/10,000 → `-Z13 -z14`、1/2,500 → `-Z15 -z16`）。重複したまま結合すると、同じズームで複数縮尺のタイルが競合します。

```bash
tile-join \
  -o kihonzu.mbtiles \
  --force \
  --no-tile-size-limit \
  kihonzu_25000.mbtiles \
  kihonzu_10000.mbtiles \
  kihonzu_2500.mbtiles

pmtiles convert kihonzu.mbtiles kihonzu.pmtiles
```

## 参考

- [tippecanoe](https://github.com/felt/tippecanoe)
- [go-pmtiles](https://github.com/protomaps/go-pmtiles)
- [vt-optimizer-rs](https://github.com/unvt/vt-optimizer-rs)（ベクトルタイルの検査・最適化）
- Mapbox「[Mapbox Tiling Service / Vector tiles](https://docs.mapbox.com/mapbox-tiling-service/ja/vector/)」（1タイル 1,250KB の上限）

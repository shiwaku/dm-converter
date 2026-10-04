// -----------------------------------------
// DM → GeoJSON 変換メインスクリプト
// 使用方法:
//   node src/index.js                                    # input/2500/ を読み込み output/ へ出力
//   node src/index.js --scale 10000                      # input/10000/ を読み込み output/ へ出力
//   node src/index.js --epsg 6676                        # 入力座標系を指定（既定: ファイルから自動判定）
//   node src/index.js --scale 2500 --input /path/to/dir  # 入力フォルダを直接指定
//   node src/index.js --jobs 4                           # 並列数を指定（既定: CPUコア数-1）
//   node src/index.js --jobs 1                           # 逐次実行
// -----------------------------------------
const path = require('path');
const fs = require('fs');
const DMFiles = require('./dmfiles');
const GeoJSONWriter = require('./geojsonWriter');
const { KINDS, convertFiles } = require('./convert');
const { convertParallel, defaultJobs } = require('./parallel');
const { resolveEpsg } = require('./crs');

// input/ と output/ はリポジトリルート直下（src/ の1つ上）
const ROOT = path.join(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let scale = 2500;
  let input = null;
  let epsg  = null;   // 既定: .dmi / I レコード / 図郭識別番号から自動判定（crs.js）
  let jobs  = defaultJobs();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scale' && args[i + 1]) {
      scale = parseInt(args[i + 1]);
    }
    if (args[i] === '--input' && args[i + 1]) {
      input = args[i + 1];
    }
    if (args[i] === '--epsg' && args[i + 1]) {
      epsg = parseInt(args[i + 1]);
    }
    if (args[i] === '--jobs' && args[i + 1]) {
      jobs = parseInt(args[i + 1]);
    }
  }

  if (isNaN(scale) || scale <= 0) {
    console.error('--scale に正の整数を指定してください');
    process.exit(1);
  }
  if (epsg !== null && (isNaN(epsg) || epsg <= 0)) {
    console.error('--epsg に正の整数を指定してください');
    process.exit(1);
  }
  if (isNaN(jobs) || jobs <= 0) {
    console.error('--jobs に正の整数を指定してください');
    process.exit(1);
  }

  // --input 省略時は input/${scale}/ フォルダを使用
  if (!input) {
    input = path.join(ROOT, 'input', String(scale));
  } else {
    input = path.resolve(input);
  }
  if (!fs.existsSync(input)) {
    console.error(`入力フォルダが見つかりません: ${input}`);
    process.exit(1);
  }

  return { scale, dmDir: input, epsg, jobs };
}

/** 逐次実行。ファイルが1つだけの場合や --jobs 1 のときに使う。 */
function runSequential(files, epsgByFile, outDir, scale) {
  // 入力座標系はファイルごとに切り替える。ここでは仮に先頭ファイルの系で作る
  const initial = files.length > 0 ? epsgByFile[files[0]] : 6676;
  const writers = {};
  for (const kind of KINDS) {
    writers[kind] = new GeoJSONWriter(path.join(outDir, `都市計画基本図_${scale}_${kind}.geojson`), initial);
  }
  try {
    convertFiles(files, writers, (f) => console.log(`File:[${f}]`), epsgByFile);
  } finally {
    for (const kind of KINDS) writers[kind].close();
  }
}

async function main() {
  const { scale, dmDir, epsg, jobs } = parseArgs();

  const outDir = path.join(ROOT, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const files = [...new DMFiles(dmDir)];

  // 入力座標系をファイルごとに決める。判定できないファイルがあれば、黙って
  // 誤った系で変換するより、--epsg の指定を求めて止める。
  const { epsgByFile, undetected, summary } = resolveEpsg(files, epsg);
  if (undetected.length > 0) {
    console.error(`座標系（平面直角座標系の系番号）を判定できないファイルが ${undetected.length} 件あります:`);
    for (const f of undetected.slice(0, 5)) console.error(`  ${f}`);
    if (undetected.length > 5) console.error(`  ほか ${undetected.length - 5} 件`);
    console.error('--epsg で入力の座標系を指定してください（例: --epsg 6676）。');
    process.exit(1);
  }
  const epsgMap = Object.fromEntries(epsgByFile);

  // ファイルが1つも無い場合も、空の GeoJSON を出して正常終了する（従来どおり）。
  // ここで異常終了すると scripts/build.sh が set -e で止まってしまう。
  const workers = Math.min(jobs, files.length);
  if (workers > 1) {
    console.log(`並列変換: ${workers} ワーカー / ${files.length} ファイル`);
    await convertParallel(files, epsgMap, outDir, scale, workers);
  } else {
    runSequential(files, epsgMap, outDir, scale);
  }

  console.log('Done.');
  for (const kind of KINDS) {
    console.log(path.join(outDir, `都市計画基本図_${scale}_${kind}.geojson`));
  }
  console.log(`DM dir: ${dmDir}`);
  for (const line of summary) console.log(`入力座標系: ${line}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

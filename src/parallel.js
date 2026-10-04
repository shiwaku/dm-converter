// -----------------------------------------
// .dm ファイルをワーカーに分けて並列変換し、断片を連結して最終出力にする。
//
// 分割は「連続したかたまり」で行う。ラウンドロビンにすると出力順が逐次実行と
// 変わってしまい、結果の比較ができなくなるため。連続分割なら断片を順に連結する
// だけで、逐次実行とバイト単位で同じ GeoJSON になる。
// -----------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { KINDS } = require('./convert');

/** files を n 個の連続したかたまりに分ける（要素数が均等になるように）。 */
function chunk(files, n) {
  const out = [];
  const size = Math.floor(files.length / n);
  const rest = files.length % n;
  let i = 0;
  for (let k = 0; k < n; k++) {
    const len = size + (k < rest ? 1 : 0);
    if (len > 0) out.push(files.slice(i, i + len));
    i += len;
  }
  return out;
}

/** 断片ファイルを順に読み、区切りを挟んで最終ファイルへ書き出す。 */
function mergeParts(outFile, parts) {
  const fd = fs.openSync(outFile, 'w');
  try {
    const nonEmpty = parts.filter((p) => fs.existsSync(p) && fs.statSync(p).size > 0);
    if (nonEmpty.length === 0) {
      fs.writeSync(fd, '{"type":"FeatureCollection","features":[]}', null, 'utf8');
      return;
    }
    fs.writeSync(fd, '{"type":"FeatureCollection","features":[\n', null, 'utf8');
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    nonEmpty.forEach((p, i) => {
      if (i > 0) fs.writeSync(fd, ',\n', null, 'utf8');
      const src = fs.openSync(p, 'r');
      try {
        let n;
        while ((n = fs.readSync(src, buf, 0, buf.length, null)) > 0) {
          fs.writeSync(fd, buf, 0, n);
        }
      } finally {
        fs.closeSync(src);
      }
    });
    fs.writeSync(fd, '\n]}', null, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string[]} files    .dm ファイルのパス（順序が出力順になる）
 * @param {object}   epsgByFile  { .dm のパス: 入力 EPSG }
 * @param {string}   outDir   最終出力先
 * @param {number}   scale    出力ファイル名に使う縮尺
 * @param {number}   jobs     ワーカー数
 */
async function convertParallel(files, epsgByFile, outDir, scale, jobs) {
  const groups = chunk(files, Math.min(jobs, files.length));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-converter-'));

  try {
    let done = 0;
    await Promise.all(
      groups.map(
        (group, index) =>
          new Promise((resolve, reject) => {
            const w = new Worker(path.join(__dirname, 'worker.js'), {
              workerData: { files: group, epsgByFile, tmpDir, index },
            });
            w.on('message', (msg) => {
              if (msg.type === 'file') console.log(`File:[${msg.file}] (${++done}/${files.length})`);
            });
            w.on('error', reject);
            w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ワーカーが異常終了しました (code ${code})`))));
          }),
      ),
    );

    for (const kind of KINDS) {
      const parts = groups.map((_, i) => path.join(tmpDir, `${kind}.${i}.part`));
      mergeParts(path.join(outDir, `都市計画基本図_${scale}_${kind}.geojson`), parts);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { convertParallel, defaultJobs: () => Math.max(1, os.cpus().length - 1) };

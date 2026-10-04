// -----------------------------------------
// 入力座標系（平面直角座標系の系番号）の自動判定。
//
// 系番号は次の順で探す。
//   1. フォルダ内の .dmi（インデックスファイル）のインデックスレコード(a)
//   2. .dm 自身のインデックスレコード（I レコード）
//   3. 図郭識別番号の先頭2桁（英数字2〜8桁のときだけ。静岡市 1/2,500 の
//      "08ND392" は第8系。1/10,000 の "1" のような番号は系を表さないので使わない）
// どれも見つからなければ null を返し、呼び出し側で --epsg の指定を求める。
//
// 測地系（JGD2011 / JGD2000 / 旧日本測地系）は系番号からは判別できないため、
// JGD2011 とみなす。JGD2000 と JGD2011 は proj4 の定義が同じで結果は変わらない。
// 旧日本測地系のデータは --epsg で明示する。
// -----------------------------------------
const fs = require('fs');
const path = require('path');

/** 系番号 → JGD2011 の EPSG コード（第1系 = 6669 … 第19系 = 6687）。 */
function zoneToEpsg(zone) {
  return 6668 + zone;
}

function parseZone(raw) {
  const s = raw.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const zone = parseInt(s, 10);
  return zone >= 1 && zone <= 19 ? zone : null;
}

/** インデックスレコード(a)の3〜4バイト目（I2）が系番号。 */
function zoneFromIndexRecord(line) {
  if (line.length < 4 || line[0] !== 0x49 /* I */) return null;
  return parseZone(line.toString('latin1', 2, 4));
}

/** フォルダ内の .dmi から系番号を読む。見つからなければ null。 */
function zoneFromDmi(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.dmi')).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const zone = zoneFromIndexRecord(readHead(path.join(dir, name), 256));
    if (zone !== null) return { zone, source: name };
  }
  return null;
}

function readHead(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size);
    const n = fs.readSync(fd, buf, 0, size, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * .dm ファイルの先頭から系番号を判定する（I レコード → 図郭識別番号）。
 * I レコードと図郭レコードはファイル先頭にあるので、先頭だけ読む。
 */
function zoneFromDm(file) {
  const head = readHead(file, 64 * 1024);
  let start = 0;
  for (let i = 0; i <= head.length; i++) {
    if (i < head.length && head[i] !== 0x0a) continue;
    const line = head.subarray(start, i);
    start = i + 1;
    if (line[0] === 0x49 /* I */) {
      const zone = zoneFromIndexRecord(line);
      if (zone !== null) return { zone, source: 'I レコード' };
    } else if (line[0] === 0x4d /* M */) {
      const id = line.toString('latin1', 2, 10).trim();
      if (/^[0-9A-Za-z]{2,8}$/.test(id)) {
        const zone = parseZone(id.slice(0, 2));
        if (zone !== null) return { zone, source: '図郭識別番号' };
      }
      // 図郭レコードより後ろに I レコードは来ない
      return null;
    }
  }
  return null;
}

/**
 * ファイルごとの入力 EPSG を決める。
 *
 * @param {string[]} files     .dm ファイルのパス
 * @param {number|null} epsg   --epsg の指定（あれば全ファイルに適用）
 * @returns {{ epsgByFile: Map<string, number>, undetected: string[], summary: string[] }}
 */
function resolveEpsg(files, epsg) {
  const epsgByFile = new Map();
  const undetected = [];
  const counts = new Map();   // "EPSG:6676（第8系・図郭識別番号）" → ファイル数

  const bump = (key) => counts.set(key, (counts.get(key) || 0) + 1);

  if (epsg !== null) {
    for (const f of files) epsgByFile.set(f, epsg);
    if (files.length > 0) bump(`EPSG:${epsg}（--epsg 指定）`);
  } else {
    const dmiCache = new Map();
    for (const f of files) {
      const dir = path.dirname(f);
      if (!dmiCache.has(dir)) dmiCache.set(dir, zoneFromDmi(dir));
      const hit = dmiCache.get(dir) || zoneFromDm(f);
      if (hit === null) {
        undetected.push(f);
        continue;
      }
      const code = zoneToEpsg(hit.zone);
      epsgByFile.set(f, code);
      bump(`EPSG:${code}（第${hit.zone}系・${hit.source}）`);
    }
  }

  const summary = [...counts].map(([k, n]) => `${k} ${n}ファイル`);
  return { epsgByFile, undetected, summary };
}

module.exports = { resolveEpsg, zoneToEpsg };

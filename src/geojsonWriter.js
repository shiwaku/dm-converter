// -----------------------------------------
// GeoJSON出力用クラス
// GeoJSONWriter.py の Node.js 移植版
// -----------------------------------------
const fs = require('fs');
const proj4 = require('proj4');
const EPSG_DEFS = require('./epsgDefs');
const { signedArea } = require('./rings');

proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Python の str(round(x, 7)) 相当：7桁丸め、末尾ゼロなし
function fmt(n) {
  return parseFloat(n.toFixed(7)).toString();
}

// 書き込みバッファのしきい値。1フィーチャごとに writeSync を呼ぶと、出力先が
// WSL の /mnt/c のような低速なファイルシステムのとき syscall のコストが支配的に
// なる（実測で 100万フィーチャあたり約6分）。一定量ためてからまとめて書き出す。
const FLUSH_SIZE = 4 * 1024 * 1024;

class GeoJSONWriter {
  // epsgCode: 入力データの座標参照系（EPSG整数コード）
  // opts.fragment: FeatureCollection の外枠を書かず、Feature の並びだけを出力する。
  //   並列処理でワーカーごとの断片を作り、あとで連結するために使う。
  constructor(outFile, epsgCode, opts = {}) {
    this._fragment = opts.fragment === true;
    const def = EPSG_DEFS[epsgCode];
    if (!def) {
      const keys = Object.keys(EPSG_DEFS).join(', ');
      throw new Error(`未対応のEPSGコードです: ${epsgCode}\n対応コード: ${keys}`);
    }
    proj4.defs(`EPSG:${epsgCode}`, def);
    this._transform = proj4(`EPSG:${epsgCode}`, 'EPSG:4326').forward;

    this._fd = fs.openSync(outFile, 'w');
    this.geometry = null;
    this.properties = null;
    this._started = false;
    this._closed = false;
    this._buf = '';
  }

  _write(str) {
    this._buf += str;
    if (this._buf.length >= FLUSH_SIZE) this._flush();
  }

  _flush() {
    if (this._buf.length === 0) return;
    fs.writeSync(this._fd, this._buf, null, 'utf8');
    this._buf = '';
  }

  close() {
    if (this._closed) return;
    if (!this._fragment) {
      if (!this._started) {
        this._write('{"type":"FeatureCollection","features":[]}');
      } else {
        this._write('\n]}');
      }
    }
    this._flush();
    fs.closeSync(this._fd);
    this._closed = true;
  }

  // ジオメトリの設定
  // holes: ポリゴン（figtype 2）の内側の輪。中庭線を穴として持たせるときに渡す。
  setGeometry(figtype, xyList, holes = []) {
    const tr = this._transform;
    const ring = (list) => list.map(xy => {
      const [lon, lat] = tr([xy[0], xy[1]]);
      return `[${fmt(lon)},${fmt(lat)}]`;
    }).join(',');
    if (figtype === 1) {
      // 折れ線
      let g = '\t{"type":"Feature",\n';
      g += '\t"geometry":{"type":"LineString","coordinates":[';
      g += xyList.map(xy => {
        const [lon, lat] = tr([xy[0], xy[1]]);
        return `[${fmt(lon)},${fmt(lat)}]`;
      }).join(',');
      g += ']';
      this.geometry = g;

    } else if (figtype === 2) {
      // ポリゴン（Python の numpy.flipud + append と同等）
      const XyList = [...xyList].reverse();
      XyList.push([...XyList[0]]);
      let g = '\t{"type":"Feature",\n';
      g += '\t"geometry":{"type":"Polygon","coordinates":[[';
      g += ring(XyList);
      g += ']';
      // 穴は外周と逆回りにする（RFC 7946 の右手則に揃える向きの関係）
      const outerCcw = signedArea(XyList) > 0;
      for (const hole of holes) {
        const h = (signedArea(hole) > 0) === outerCcw ? [...hole].reverse() : [...hole];
        const first = h[0], last = h[h.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) h.push([...first]);
        g += `,[${ring(h)}]`;
      }
      g += ']';
      this.geometry = g;

    } else if (figtype === 4 || figtype === 5) {
      // 点（注記の代表点 or 記号）
      const [lon, lat] = tr([xyList[0], xyList[1]]);
      let g = '\t{"type":"Feature",\n';
      g += '\t"geometry":{"type":"Point","coordinates":';
      g += `[${fmt(lon)},${fmt(lat)}]`;
      this.geometry = g;
    }
  }

  // プロパティの設定
  setPropertie(name, value) {
    if (this.properties === null) {
      this.properties = '\t"properties":{';
    } else {
      this.properties += ',';
    }
    const val = Array.isArray(value) ? value.join('') : String(value);
    this.properties += `"${name}":"${val}"`;
  }

  // ファイルへの書き込み（1 Feature）
  write() {
    if (!this._started) {
      if (!this._fragment) this._write('{"type":"FeatureCollection","features":[\n');
      this._started = true;
    } else {
      this._write(',\n');
    }
    this._write(this.geometry + '},\n');
    this._write(this.properties + '}}');

    this.geometry = null;
    this.properties = null;
  }
}

module.exports = GeoJSONWriter;

// -----------------------------------------
// DM DATファイル読み込みクラス
// DM.py の Node.js 移植版
// -----------------------------------------
const fs = require('fs');
const iconv = require('iconv-lite');

const DATATYPE_MAP = {
  'E1': '面', 'E2': '線', 'E3': '円', 'E4': '円弧',
  'E5': '点', 'E6': '方向', 'E7': '注記', 'E8': '属性'
};

// 図郭レコード(b)の「座標値の単位」→ メートルへの除数。
// 1: mm、10: cm、999: m。空欄や想定外の値は従来どおり cm とみなして警告する。
const UNIT_DIVISORS = { 1: 1000, 10: 100, 999: 1 };
const warnedUnits = new Set();

function unitDivisor(raw, file) {
  const code = parseInt(raw);
  if (UNIT_DIVISORS[code] !== undefined) return UNIT_DIVISORS[code];
  const key = `${file}:${raw}`;
  if (!warnedUnits.has(key)) {
    warnedUnits.add(key);
    console.warn(`座標値の単位が不明です（"${raw.trim()}"）。cm として扱います: ${file}`);
  }
  return 100;
}

class DM {
  constructor(inDMFile) {
    this._DMFile = inDMFile;
    this._elementDict = null;
  }

  _decode(buf, start, end) {
    return iconv.decode(buf.slice(start, end), 'cp932');
  }

  _parse() {
    if (this._elementDict !== null) return;
    this._elementDict = {};

    const buf = fs.readFileSync(this._DMFile);

    // バイナリモードで行分割（Python の readlines() 相当）
    const lines = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) { // \n
        lines.push(buf.slice(start, i + 1));
        start = i + 1;
      }
    }
    if (start < buf.length) {
      lines.push(buf.slice(start));
    }

    const decode = (b, s, e) => this._decode(b, s, e);
    let dictSeqno = 0;
    let recno = 0;
    let unitcode = '';
    let ldx = 0, ldy = 0;
    let unitDiv = 100;   // 座標値の単位（既定は cm）

    while (recno < lines.length) {
      const record = lines[recno];
      const rectype = decode(record, 0, 2);

      if (rectype[0] === 'M') {
        // 図郭レコード(a)
        unitcode = decode(record, 2, 10).trimEnd();
        const editcnt = parseInt(decode(record, 65, 67));
        recno++;
        // 図郭レコード(b)
        const recB = lines[recno];
        if (!recB) break;   // 途中で終端しているファイル
        ldx = parseFloat(decode(recB, 0, 7));
        ldy = parseFloat(decode(recB, 7, 14));
        unitDiv = unitDivisor(decode(recB, 44, 47), this._DMFile);
        // 図郭レコード(d)までシーク
        recno += 2;
        let cnt = 0;
        while (cnt < editcnt + 1) {
          const recD = lines[recno];
          if (!recD) break;
          const reccnt = parseInt(decode(recD, 9, 10));
          recno += reccnt + 2;
          cnt++;
        }

      } else if (rectype[0] === 'E') {
        const layercode = decode(record, 2, 6);
        const elementno = parseInt(decode(record, 12, 16));
        const recordcnt = parseInt(decode(record, 31, 35));
        const datakind = decode(record, 20, 21);
        // 図形区分。建物（3001〜3004）では 31 が中庭線（面の内側の輪）を表す。
        const zukei = decode(record, 18, 20).trim();
        const datacnt = parseInt(decode(record, 27, 31));
        let curRectype = rectype;
        let datatype = DATATYPE_MAP[rectype] || '';
        const elno = `${unitcode}-${layercode}-${String(elementno).padStart(4, '0')}`;

        if (curRectype === 'E1' || curRectype === 'E2') {
          // 線（E2）と面（E1）
          let pointcnt = 0;
          const xy = [];
          let rec = null;
          let truncated = false;
          while (pointcnt < datacnt) {
            if (pointcnt % 6 === 0) {
              recno++;
              rec = lines[recno];
              if (!rec) { truncated = true; break; }
            }
            const s = (pointcnt * 14) % 84;
            // 座標値の単位からメートルに変換
            const xVal = parseFloat(decode(rec, s, s + 7)) / unitDiv;
            const yVal = parseFloat(decode(rec, s + 7, s + 14)) / unitDiv;
            xy.push([ldy + yVal, ldx + xVal]);
            pointcnt++;
          }
          if (truncated) break;
          // 始終点が一致していれば面化する
          if (xy[0][0] === xy[xy.length - 1][0] && xy[0][1] === xy[xy.length - 1][1]) {
            curRectype = 'E1';
            datatype = DATATYPE_MAP['E1'];
          }
          this._elementDict[dictSeqno] = {
            FIGTYPE: curRectype,
            LAYER: layercode,
            ELNO: elno,
            ZUKEI: zukei,
            XYList: xy,
            RECORD_TYPE: curRectype,
            DATA_KIND: datakind,
            DATA_TYPE: datatype
          };
          dictSeqno++;
          recno++;

        } else if (curRectype === 'E5') {
          // 点（E5）
          // 座標値の単位からメートルに変換
          const px = parseFloat(decode(record, 35, 42)) / unitDiv;
          const py = parseFloat(decode(record, 42, 49)) / unitDiv;
          this._elementDict[dictSeqno] = {
            FIGTYPE: curRectype,
            LAYER: layercode,
            ELNO: elno,
            XYList: [ldy + py, ldx + px],
            RECORD_TYPE: curRectype,
            DATA_KIND: datakind,
            DATA_TYPE: datatype
          };
          dictSeqno++;
          recno += recordcnt + 1;

        } else if (curRectype === 'E6') {
          // 方向（E6）
          // 起点と方向点の2点で1本。第1点が地物の位置、第1点→第2点が向きを表す。
          // 2点間の距離は図上の記号長に相当する定型値であり実長ではないため、
          // 線としては出力せず、起点のみを点として持ち角度に変換する。
          //
          // 1要素に複数本入ることがある（データ数が2を超える）。以前は先頭2点だけを
          // 読んでいたため、残りのペアを捨てていた。ペアごとに1フィーチャを出力する。
          // 同一要素から複数出るので Elno が重複する。要素内の通し番号を SEQ で持たせる。
          //
          // 実データ区分が3・6（三次元）は1点21バイト。二次元は14バイト。
          const stride = (datakind === '3' || datakind === '6') ? 21 : 14;
          // 1レコードは84バイト。二次元は6点、三次元は4点入る。
          const perRecord = Math.floor(84 / stride);
          const pts = [];
          let truncated = false;
          for (let i = 0; i < datacnt; i++) {
            // 読み出しはヘッダ位置からの相対で求め、recno は動かさない。
            // データ数と実データ行数が食い違っても後続のレコード解釈がずれないようにする。
            const rec = lines[recno + 1 + Math.floor(i / perRecord)];
            if (!rec) { truncated = true; break; }
            const s = (i % perRecord) * stride;
            // 座標値の単位からメートルに変換
            pts.push([
              parseFloat(decode(rec, s, s + 7)) / unitDiv,
              parseFloat(decode(rec, s + 7, s + 14)) / unitDiv
            ]);
          }
          if (truncated) break;
          // 2点ずつで1本。端数の1点は向きを決められないため捨てる。
          for (let i = 0; i + 1 < pts.length; i += 2) {
            const [x1, y1] = pts[i];
            const [x2, y2] = pts[i + 1];
            // DMのXは北方向、Yは東方向。水平右（東）を0度とする反時計回りの度数に直す。
            // E7（注記）のANGLEと同じ規約に揃えてあるため、描画側は同じ変換で扱える。
            const angle = Math.round(Math.atan2(x2 - x1, y2 - y1) * 180 / Math.PI);
            this._elementDict[dictSeqno] = {
              FIGTYPE: curRectype,
              LAYER: layercode,
              ELNO: elno,
              SEQ: i / 2 + 1,
              XYList: [ldy + y1, ldx + x1],
              ANGLE: angle,
              RECORD_TYPE: curRectype,
              DATA_KIND: datakind,
              DATA_TYPE: datatype
            };
            dictSeqno++;
          }
          recno += recordcnt + 1;

        } else if (curRectype === 'E7') {
          // 注記（E7）
          // 座標値の単位からメートルに変換
          const px = parseFloat(decode(record, 35, 42)) / unitDiv;
          const py = parseFloat(decode(record, 42, 49)) / unitDiv;
          const rec2 = lines[recno + 1];
          if (!rec2) break;
          const vnflag = decode(rec2, 0, 1);
          const angle = parseInt(decode(rec2, 1, 8));
          // 注記データは後続レコードの21〜84バイト目。32文字を超える注記は
          // 複数レコードにまたがるので、レコード数ぶんを連結する。全角文字が
          // レコード境界で割れても崩れないよう、バイト列のまま連結してから復号する。
          const parts = [];
          for (let i = 1; i <= Math.max(recordcnt, 1); i++) {
            const r = lines[recno + i];
            if (!r) break;
            let end = Math.min(r.length, 84);
            while (end > 20 && (r[end - 1] === 0x0a || r[end - 1] === 0x0d)) end--;
            if (end > 20) parts.push(r.slice(20, end));
          }
          const text = iconv.decode(Buffer.concat(parts), 'cp932').trimEnd();
          this._elementDict[dictSeqno] = {
            FIGTYPE: curRectype,
            LAYER: layercode,
            ELNO: elno,
            XYList: [ldy + py, ldx + px],
            ANGLE: angle,
            VNFLAG: vnflag,
            TEXT: text,
            RECORD_TYPE: curRectype,
            DATA_KIND: datakind,
            DATA_TYPE: datatype
          };
          dictSeqno++;
          recno += recordcnt + 1;

        } else {
          recno += recordcnt + 1;
        }

      } else if (rectype[0] === 'H') {
        // グループヘッダレコード
        recno++;
      } else if (rectype[0] === 'G' || rectype[0] === 'T') {
        // グリッドヘッダ、TINレコード
        const recordcnt = parseInt(decode(record, 31, 35));
        recno += recordcnt + 1;
      } else {
        recno++;
      }
    }
  }

  [Symbol.iterator]() {
    this._parse();
    const dict = this._elementDict;
    const len = Object.keys(dict).length;
    let i = 0;
    return {
      next() {
        if (i >= len) return { done: true };
        return { value: dict[i++], done: false };
      }
    };
  }
}

module.exports = DM;

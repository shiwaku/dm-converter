// -----------------------------------------
// DMファイル群を種別ごとの Writer へ振り分ける変換ループ。
// 逐次実行（index.js）とワーカー（worker.js）の両方から使う。
// -----------------------------------------
const DM = require('./dm');
const { assignHoles } = require('./rings');

/** 出力種別。Writer の並び順とファイル名サフィックスの対応。 */
const KINDS = ['線', '面', '記号', '方向', '注記'];

/**
 * @param {string[]} files    .dm ファイルのパス
 * @param {object}   writers  { 線, 面, 記号, 方向, 注記 } の GeoJSONWriter
 * @param {function} onFile   1ファイル処理するたびに呼ばれる（進捗表示用）
 */
function convertFiles(files, writers, onFile) {
  for (const dmfile of files) {
    if (onFile) onFile(dmfile);
    const dats = [...new DM(dmfile)];
    // 中庭線は図郭単位で外周の面に割り当てる（rings.js）
    const { holes, consumed } = assignHoles(dats);

    for (const dat of dats) {
      if (consumed.has(dat)) continue;
      const fig = dat.FIGTYPE || '';

      if (fig === 'E2') {
        const w = writers['線'];
        w.setGeometry(1, dat.XYList);
        w.setPropertie('Code', dat.LAYER || '');
        w.setPropertie('Elno', dat.ELNO || '');
        w.setPropertie('RecordType', dat.RECORD_TYPE || '');
        w.setPropertie('DataType', dat.DATA_TYPE || '');
        w.setPropertie('DataKind', dat.DATA_KIND || '');
        w.write();

      } else if (fig === 'E1') {
        const w = writers['面'];
        w.setGeometry(2, dat.XYList, holes.get(dat));
        w.setPropertie('Code', dat.LAYER || '');
        w.setPropertie('Elno', dat.ELNO || '');
        w.setPropertie('RecordType', dat.RECORD_TYPE || '');
        w.setPropertie('DataType', dat.DATA_TYPE || '');
        w.setPropertie('DataKind', dat.DATA_KIND || '');
        w.write();

      } else if (fig === 'E5') {
        const w = writers['記号'];
        w.setGeometry(5, dat.XYList);
        w.setPropertie('Code', dat.LAYER || '');
        w.setPropertie('Elno', dat.ELNO || '');
        w.setPropertie('RecordType', dat.RECORD_TYPE || '');
        w.setPropertie('DataType', dat.DATA_TYPE || '');
        w.setPropertie('DataKind', dat.DATA_KIND || '');
        w.write();

      } else if (fig === 'E6') {
        const w = writers['方向'];
        w.setGeometry(5, dat.XYList);
        w.setPropertie('Code', dat.LAYER || '');
        w.setPropertie('Elno', dat.ELNO || '');
        // 1要素に複数の方向ベクトルが入ることがあり、その場合 Elno が重複する。
        // 要素内の通し番号を併記して区別できるようにする。
        w.setPropertie('Seq', dat.SEQ !== undefined ? dat.SEQ : '');
        w.setPropertie('Angle', dat.ANGLE !== undefined ? dat.ANGLE : '');
        w.setPropertie('RecordType', dat.RECORD_TYPE || '');
        w.setPropertie('DataType', dat.DATA_TYPE || '');
        w.setPropertie('DataKind', dat.DATA_KIND || '');
        w.write();

      } else if (fig === 'E7') {
        const w = writers['注記'];
        w.setGeometry(4, dat.XYList);
        w.setPropertie('Code', dat.LAYER || '');
        w.setPropertie('Elno', dat.ELNO || '');
        w.setPropertie('Text', dat.TEXT || '');
        w.setPropertie('Vnflag', dat.VNFLAG || '');
        w.setPropertie('Angle', dat.ANGLE !== undefined ? dat.ANGLE : '');
        w.setPropertie('RecordType', dat.RECORD_TYPE || '');
        w.setPropertie('DataType', dat.DATA_TYPE || '');
        w.setPropertie('DataKind', dat.DATA_KIND || '');
        w.write();
      }
    }
  }
}

module.exports = { KINDS, convertFiles };

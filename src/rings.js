// -----------------------------------------
// 中庭線（図形区分 31）を外側の面の穴として割り当てる。
//
// DM では中庭のある建物を「外周の面」と「中庭線の面」の2要素で持つ。そのまま
// 出力すると中庭が建物と同じ塗りの面として重なるため、中庭線を含む外周の面を
// 探して内側の輪にする。外周は同じ図郭・同じ分類コードの面に限って探す。
// 外周が見つからない中庭線（外周が隣の図郭にある、線のまま閉じていない等）は
// 単独の面として残す。
// -----------------------------------------

const INNER_ZUKEI = '31';

function bbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function bboxContains(a, b) {
  return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
}

/** 符号付き面積（反時計回りで正）。 */
function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return s / 2;
}

function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 1図郭ぶんの要素から、中庭線を外周の面に割り当てる。
 *
 * @param {object[]} elements  DM の要素（FIGTYPE / LAYER / ZUKEI / XYList）
 * @returns {{ holes: Map<object, number[][][]>, consumed: Set<object> }}
 *   holes: 外周の要素 → 穴にする輪の配列
 *   consumed: 穴として取り込んだ中庭線の要素（単独では出力しない）
 */
function assignHoles(elements) {
  const holes = new Map();
  const consumed = new Set();

  const polygons = elements.filter(e => e.FIGTYPE === 'E1' && e.XYList.length >= 3);
  const inners = polygons.filter(e => e.ZUKEI === INNER_ZUKEI);
  if (inners.length === 0) return { holes, consumed };

  const outers = polygons
    .filter(e => e.ZUKEI !== INNER_ZUKEI)
    .map(e => ({ el: e, box: bbox(e.XYList), area: null }));

  for (const inner of inners) {
    const box = bbox(inner.XYList);
    // 外周の頂点と重なりにくいよう、最初の辺の中点で包含を判定する
    const [a, b] = inner.XYList;
    const probe = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    let best = null;
    for (const o of outers) {
      if (o.el.LAYER !== inner.LAYER || !bboxContains(o.box, box)) continue;
      if (!pointInRing(probe, o.el.XYList)) continue;
      // 入れ子の建物に備えて、含む面のうち最も小さいものを選ぶ
      if (o.area === null) o.area = Math.abs(signedArea(o.el.XYList));
      if (best === null || o.area < best.area) best = o;
    }
    if (best === null) continue;

    if (!holes.has(best.el)) holes.set(best.el, []);
    holes.get(best.el).push(inner.XYList);
    consumed.add(inner);
  }

  return { holes, consumed };
}

module.exports = { assignHoles, signedArea };

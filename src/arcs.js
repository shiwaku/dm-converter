// -----------------------------------------
// 円（E3）・円弧（E4）を折れ線に近似する。
//
// DM の円は円周上の3点、円弧は始点・中間点・終点の3点で表される。3点を通る円を
// 求め、円は1周64分割、円弧は中心角に比例した分割数（最低4）で頂点を作る。
// 座標は平面直角座標（メートル、[東, 北]）のまま扱う。
// -----------------------------------------

const FULL_SEGMENTS = 64;
const MIN_ARC_SEGMENTS = 4;

/** 3点を通る円の中心と半径。3点が一直線上にあれば null。 */
function circumcircle([ax, ay], [bx, by], [cx, cy]) {
  // 座標は数万メートルの値なので、桁落ちを避けるため第1点を原点にした相対座標で解く
  const bx0 = bx - ax, by0 = by - ay, cx0 = cx - ax, cy0 = cy - ay;
  const b2 = bx0 * bx0 + by0 * by0, c2 = cx0 * cx0 + cy0 * cy0;
  const d0 = 2 * (bx0 * cy0 - by0 * cx0);
  // 一直線かどうかは辺の長さに対する相対値で見る
  if (Math.abs(d0) <= Math.max(b2, c2) * 1e-9) return null;
  const ux = (cy0 * b2 - by0 * c2) / d0;
  const uy = (bx0 * c2 - cx0 * b2) / d0;
  return { x: ax + ux, y: ay + uy, r: Math.hypot(ux, uy) };
}

/**
 * 円周上の3点から、円を近似した輪（時計回り、始終点は重複させない）を返す。
 * 3点が一直線上にあるなど円が決まらなければ null。
 */
function circleRing(p1, p2, p3) {
  const c = circumcircle(p1, p2, p3);
  if (c === null) return null;
  const start = Math.atan2(p1[1] - c.y, p1[0] - c.x);
  const ring = [];
  // 時計回り。出力時に GeoJSONWriter が反転して反時計回りになる
  for (let i = 0; i < FULL_SEGMENTS; i++) {
    const t = start - (2 * Math.PI * i) / FULL_SEGMENTS;
    ring.push([c.x + c.r * Math.cos(t), c.y + c.r * Math.sin(t)]);
  }
  return ring;
}

/**
 * 始点・中間点・終点から、円弧を近似した折れ線を返す。始点と終点は元の座標を
 * そのまま使う。円が決まらなければ3点をそのまま結んだ折れ線を返す。
 */
function arcLine(p1, p2, p3) {
  const c = circumcircle(p1, p2, p3);
  if (c === null) return [p1, p2, p3];
  const ang = ([x, y]) => Math.atan2(y - c.y, x - c.x);
  const a1 = ang(p1), a2 = ang(p2), a3 = ang(p3);
  const TAU = 2 * Math.PI;
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  // 反時計回りに始点から進んで、中間点が終点より手前にあれば反時計回りの弧
  const ccw = norm(a2 - a1) < norm(a3 - a1);
  const sweep = ccw ? norm(a3 - a1) : -norm(a1 - a3);
  const n = Math.max(MIN_ARC_SEGMENTS, Math.ceil((FULL_SEGMENTS * Math.abs(sweep)) / TAU));
  const line = [p1];
  for (let i = 1; i < n; i++) {
    const t = a1 + (sweep * i) / n;
    line.push([c.x + c.r * Math.cos(t), c.y + c.r * Math.sin(t)]);
  }
  line.push(p3);
  return line;
}

module.exports = { circleRing, arcLine };

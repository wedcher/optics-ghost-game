/*
 * optics-core.js — 純幾何／光學計算，不含任何畫面程式。
 *
 * 給完整產品（平面鏡、凸透鏡、凹透鏡）共用；目前只有凹透鏡 prototype 使用。
 * 瀏覽器：<script> 載入後為 window.OpticsCore。
 * Node：require() 取得同一份 API（供 tests/check-geometry.js 使用）。
 *
 * 側視座標（薄透鏡近軸模型）：
 *   - 透鏡平面 x = 0，主光軸 y = 0，光心 O = (0, 0)。
 *   - 物在左側：物點 = (-dObj, h)，dObj > 0。
 *   - 焦距 f：凹透鏡 f < 0，凸透鏡 f > 0。
 *   - 1/f = 1/dObj + 1/dImg；dImg < 0 表示虛像（與物同側）。
 *   - 像點 = (dImg, m·h)，m = -dImg/dObj。
 *     （dImg < 0 → 像在左側；dImg > 0 → 像在右側。）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpticsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;

  // ---------- 基本直線幾何 ----------
  // 直線以 {p:{x,y}, d:{x,y}} 表示（無限長）。

  function lineThrough(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return null;
    return { p: { x: a.x, y: a.y }, d: { x: dx, y: dy } };
  }

  function horizontalLine(point) {
    return { p: { x: point.x, y: point.y }, d: { x: 1, y: 0 } };
  }

  function intersect(l1, l2) {
    var den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    var scale = Math.hypot(l1.d.x, l1.d.y) * Math.hypot(l2.d.x, l2.d.y);
    if (Math.abs(den) < 1e-9 * scale) return null; // 平行或重合
    var t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
    return { x: l1.p.x + t * l1.d.x, y: l1.p.y + t * l1.d.y };
  }

  function intersectVertical(line, x0) {
    if (Math.abs(line.d.x) < EPS) return null;
    var t = (x0 - line.p.x) / line.d.x;
    return { x: x0, y: line.p.y + t * line.d.y };
  }

  function pointOnLine(line, pt, tol) {
    var len = Math.hypot(line.d.x, line.d.y);
    var dist = Math.abs((pt.x - line.p.x) * line.d.y - (pt.y - line.p.y) * line.d.x) / len;
    return dist <= (tol == null ? 1e-6 : tol);
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---------- 薄透鏡 ----------

  /** 正向成像：已知 f、物距 dObj(>0)、物高 h → 像。凸凹透鏡通用。 */
  function thinLensImage(f, dObj, h) {
    if (!(dObj > 0)) throw new Error('dObj must be > 0');
    if (Math.abs(dObj - f) < EPS) return null; // 物在焦點上：像在無窮遠
    var dImg = (f * dObj) / (dObj - f);
    var m = -dImg / dObj;
    return {
      dImg: dImg,
      m: m,
      point: { x: dImg, y: m * h },
      isVirtual: dImg < 0,
      isUpright: m > 0
    };
  }

  /** 焦點座標。凹透鏡的「物側焦點 F」在 (f,0)=(-|f|,0)；F' 在 (-f,0)。 */
  function focalPoints(f) {
    return {
      objectSide: { x: -Math.abs(f), y: 0 },
      imageSide: { x: Math.abs(f), y: 0 },
      // 「平行主軸入射光」折射後（或其反向延長）通過的那個焦點：
      // 凸透鏡是像側 F'(+f,0)，凹透鏡是物側 F(-|f|,0)。兩者都等於 (f, 0)。
      parallelRayFocus: { x: f, y: 0 }
    };
  }

  /**
   * 由像點反推物點（兩條可逆主光線）。凸凹透鏡通用。
   *   A. 光心線：物、像、光心 O 共線。
   *   B. 焦點／平行線：通過 parallelRayFocus 與像點的直線，交透鏡平面於 P；
   *      物側入射光為通過 P、平行主軸的直線。
   * 物點 = A 與 B 的平行線之交點。
   *
   * 凹透鏡時，B 線上各點的幾何順序是 F → 像點 I → P（I 介於 F 與透鏡之間）。
   */
  function reverseConstruct(f, imagePoint) {
    var O = { x: 0, y: 0 };
    var F = focalPoints(f).parallelRayFocus;
    var centerLine = lineThrough(imagePoint, O);
    var focusLine = lineThrough(F, imagePoint);
    if (!centerLine || !focusLine) return null;
    var P = intersectVertical(focusLine, 0);
    if (!P) return null;
    var parallelLine = horizontalLine(P);
    var object = intersect(centerLine, parallelLine);
    return {
      centerLine: centerLine,
      focusLine: focusLine,
      focus: F,
      P: P,
      parallelLine: parallelLine,
      object: object
    };
  }

  /**
   * 眼睛在透鏡後方 eyeDist 處（主軸上）透過透鏡看物點時的「視角正切」。
   * 眼睛看到的是像點，所以 tan = y_img / (eyeDist - x_img)。
   * lateral 可為垂直或水平的離軸量（薄透鏡旋轉對稱）。
   * 化簡後等於 lateral / (eyeDist + dObj·(1 - eyeDist/f))。
   */
  function apparentTanThroughLens(f, eyeDist, dObj, lateral) {
    var img = thinLensImage(f, dObj, lateral);
    return img.point.y / (eyeDist - img.point.x);
  }

  /** 上式的「等效深度」：透過透鏡看，深度 dObj 的東西像是在離眼睛這麼遠處。 */
  function effectiveDepthThroughLens(f, eyeDist, dObj) {
    return eyeDist + dObj * (1 - eyeDist / f);
  }

  // ---------- 平面鏡（預留給之後的 prototype；目前只有測試會呼叫） ----------

  /** 鏡面為通過 a、b 兩點的直線；回傳 pt 的鏡像（虛像）。 */
  function planeMirrorImage(a, b, pt) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    var foot = { x: a.x + t * dx, y: a.y + t * dy };
    return { x: 2 * foot.x - pt.x, y: 2 * foot.y - pt.y };
  }

  // ---------- 地板格（側視：沿物側深度方向的一排格子） ----------
  // 第 k 格（k = 1..count）涵蓋 x ∈ (-k·width, -(k-1)·width)。

  function makeFloorRow(width, count) {
    return {
      width: width,
      count: count,
      centerX: function (k) { return -(k - 0.5) * width; },
      /** 回傳 x 所在的格號；在範圍外或正好在格線上回傳 null。 */
      cellAt: function (x, edgeTol) {
        var u = -x / width;
        if (u <= 0 || u >= count) return null;
        var k = Math.floor(u) + 1;
        var frac = u - Math.floor(u);
        var tol = edgeTol == null ? 1e-9 : edgeTol / width;
        if (frac < tol || frac > 1 - tol) return null;
        return k;
      },
      /** x 到最近格線的距離（以格寬為 1）。0.5 = 正中央。 */
      edgeMargin: function (x) {
        var u = -x / width;
        var frac = u - Math.floor(u);
        return Math.min(frac, 1 - frac);
      }
    };
  }

  return {
    EPS: EPS,
    lineThrough: lineThrough,
    horizontalLine: horizontalLine,
    intersect: intersect,
    intersectVertical: intersectVertical,
    pointOnLine: pointOnLine,
    dist: dist,
    thinLensImage: thinLensImage,
    focalPoints: focalPoints,
    reverseConstruct: reverseConstruct,
    apparentTanThroughLens: apparentTanThroughLens,
    effectiveDepthThroughLens: effectiveDepthThroughLens,
    planeMirrorImage: planeMirrorImage,
    makeFloorRow: makeFloorRow
  };
});

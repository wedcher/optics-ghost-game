/*
 * optics.js — 實驗桌的光學計算（純函式，沒有畫面）。
 *
 * 約定（全部在這裡定一次，畫面只照做）：
 *  - 「正面」＝從透鏡這側看燈具（視線朝 −x）。燈窗座標 (r, y)：r 向右為正，y 向上為正。
 *  - 光屏：預設也從透鏡這側看（視線朝 +x）。薄透鏡成實像時，這樣看只有上下顛倒、左右沒有反；
 *    從光屏背面看（隔著半透明屏，視線朝 −x）才是上下左右都相反。
 *  - 看透鏡：眼睛在透鏡後方 d、視線朝 −x，所見方向與「正面」相同。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BenchOptics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var EPS = 1e-6;

  /** 薄透鏡成像。f > 0 凸、f < 0 凹；u = 物距 > 0。dImg > 0 實像（在透鏡右邊），< 0 虛像（在左邊）。 */
  function image(f, u) {
    if (Math.abs(u - f) < EPS) return { dImg: Infinity, m: Infinity, infinity: true };
    var dImg = (f * u) / (u - f);
    return { dImg: dImg, m: -dImg / u, infinity: false };
  }

  /**
   * 光屏上一個燈窗的光斑。s = 透鏡到光屏的距離。
   * 中心：通過光心的光線打在光屏上的位置（和成像清不清楚無關）→ y' = −y·s/u。
   * 模糊半徑：口徑半徑 R × |1 − s/f + s/u|（光屏剛好在像上時為 0）。
   * back = true：從光屏背面看（左右再反一次）。
   */
  function screenSpot(f, u, s, R, win, winR, back) {
    var k = s / u;
    return { r: (back ? -1 : 1) * win.r * k, y: -win.y * k, sharp: winR * k, blur: R * Math.abs(1 - s / f + s / u) };
  }

  /**
   * 隔著透鏡看一個燈窗。眼睛在透鏡後方 d。
   * 反向追光：從眼睛經鏡上高度 yL 出發的光線，穿過透鏡後打到物平面的高度 = yL·(1 + u/d − u/f)。
   * 所以像出現在鏡片裡的位置 = Mv × 燈窗位置，Mv = 1 / (1 + u/d − u/f)。Mv < 0 表示上下左右都反。
   */
  function lensSpot(f, u, d, near, win, winR) {
    var D = 1 + u / d - u / f;
    var Mv = Math.abs(D) < 1e-9 ? Infinity : 1 / D;
    var im = image(f, u);
    var focusable = im.infinity || im.dImg < 0 || (d - im.dImg) >= near; // 實像要在眼前至少一個近點距離外
    return { Mv: Mv, r: win.r * Mv, y: win.y * Mv, size: winR * Math.abs(Mv), upright: D > 0, focusable: focusable };
  }

  /** 像的性質（給說明文字用）。 */
  function describe(f, u) {
    var im = image(f, u);
    if (im.infinity) return { kind: 'infinity' };
    var a = Math.abs(im.m);
    return { kind: im.dImg > 0 ? 'real' : 'virtual', upright: im.m > 0, size: Math.abs(a - 1) < 0.02 ? 'same' : a > 1 ? 'enlarged' : 'reduced', dImg: im.dImg, m: im.m };
  }

  /**
   * 側視光路：物的上端 (−u, yo) 發出的三條光，穿過透鏡後的路徑。
   * 每條回傳 { yP, slope }：在透鏡上的高度與出射斜率（向右每走 1 cm 的高度變化）。
   * 出射斜率 = 入射斜率 − yP/f（薄透鏡）。超出口徑的光線 blocked = true。
   */
  function rays(f, u, yo, R) {
    var list = [{ name: 'parallel', yP: yo }, { name: 'center', yP: 0 }];
    if (Math.abs(u - f) > 0.01) list.push({ name: 'focus', yP: (-yo * f) / (u - f) });
    return list.map(function (r) {
      return { name: r.name, yP: r.yP, slope: (r.yP - yo) / u - r.yP / f, blocked: Math.abs(r.yP) > R };
    });
  }

  return { image: image, screenSpot: screenSpot, lensSpot: lensSpot, describe: describe, rays: rays };
});

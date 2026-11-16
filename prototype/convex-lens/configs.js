/*
 * configs.js — 凸透鏡 prototype 的參數化測試配置。
 *
 * 走廊座標（側視）：投影牆在 X = 0，走廊向左延伸到 X = -corridorLength；
 * 主光軸 y = 0（離地 axisHeight）。透鏡可沿主光軸移動，位置 lensX < 0。
 * 換到 OpticsCore 的透鏡座標（透鏡在 x = 0）只要減去 lensX。
 *
 * 做法和凹透鏡相同：只指定 f、目標格、離軸高度 h；物點放在格子正中央，
 * 其餘（能成清晰像的透鏡位置、像點）全部由幾何導出，不寫死答案座標。
 *
 * 同一個物與牆的距離 D > 4f 時，有兩個透鏡位置都能在牆上成清晰實像
 * （共軛位置：一個放大、一個縮小）。兩個位置反推回去是同一個物點。
 *
 * 長度單位：cm。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/optics-core.js'));
  } else {
    root.ConvexLensConfigs = factory(root.OpticsCore);
  }
})(typeof self !== 'undefined' ? self : this, function (Optics) {
  'use strict';

  var WORLD = {
    corridorLength: 1000,
    axisHeight: 150,      // 主光軸離地高度；天花板在主光軸上方同樣距離
    wallHalfWidth: 150,   // 投影牆正面視圖的半寬
    cellWidth: 100,
    cellCount: 10,        // 第 1 格緊鄰投影牆，第 10 格最遠
    lensMinX: -620,       // 透鏡可移動範圍（永遠在鬼與牆之間，不會穿過鬼）
    lensMaxX: -80,
    lensRadius: 120,      // 大型凸透鏡的口徑半徑（決定失焦時的模糊圓大小）
    lockBlurRatio: 0.18,  // 模糊圓半徑 ÷ 牆上鬼像半寬 小於這個比例才能標記（約等於偏離 ±5～12 cm；標記時自動對準）
    checkOffset: 8,       // 自我檢查用：離清晰位置這麼遠時應該已經看得出模糊
    ghostHalfHeight: 35,
    ghostHalfWidth: 25
  };

  // 只有這四個欄位是「輸入」。
  var RAW = [
    { id: 'A', f: 200, targetCell: 9, h: 70 },
    { id: 'B', f: 150, targetCell: 7, h: -60 },
    { id: 'C', f: 220, targetCell: 10, h: 65 },
    { id: 'D', f: 160, targetCell: 8, h: -50 }
  ];

  var floor = Optics.makeFloorRow(WORLD.cellWidth, WORLD.cellCount);

  /** 牆上成清晰像的透鏡位置（走廊座標）。D ≤ 4f 時沒有解。 */
  function sharpLensPositions(f, objX) {
    var D = -objX, disc = D * D - 4 * f * D;
    if (disc < 0) return [];
    var r = Math.sqrt(disc);
    // 物距 dObj = (D ± r)/2；透鏡位置 = objX + dObj
    return [objX + (D - r) / 2, objX + (D + r) / 2];
  }

  /** 透鏡在 lensX 時牆上的情形：像的中心高度、放大率、模糊圓半徑。 */
  function wallImage(f, objX, h, lensX, lensRadius) {
    var dObj = lensX - objX, s = -lensX;
    if (!(dObj > 0) || !(s > 0)) return null;
    var out = { dObj: dObj, s: s, scale: s / dObj, centerY: (-h * s) / dObj, blur: Infinity, blurRatio: Infinity, dImg: null };
    var img = Optics.thinLensImage(f, dObj, h);
    if (img) {
      out.dImg = img.dImg;
      out.blur = lensRadius * Math.abs(1 - s / img.dImg); // dImg < 0（虛像）時也成立
      out.blurRatio = out.blur / (WORLD.ghostHalfWidth * out.scale); // 相對於牆上鬼像大小的模糊程度
    }
    return out;
  }

  function build(raw) {
    var objX = floor.centerX(raw.targetCell);
    var sharp = sharpLensPositions(raw.f, objX).map(function (lensX) {
      var w = wallImage(raw.f, objX, raw.h, lensX, WORLD.lensRadius);
      return { lensX: lensX, dObj: w.dObj, dImg: w.s, m: -w.scale, imageY: w.centerY };
    });
    return { id: raw.id, element: 'convex-lens', f: raw.f, targetCell: raw.targetCell, h: raw.h, object: { x: objX, y: raw.h }, sharp: sharp };
  }

  var all = RAW.map(build);

  /**
   * 幾何自我檢查；回傳 [{ ok, label, detail }]。
   * 瀏覽器與 Node（tests/check-geometry-convex.js）都呼叫這一份。
   */
  function selfCheck() {
    var out = [];
    function ok(cond, label, detail) { out.push({ ok: !!cond, label: label, detail: detail || '' }); }
    function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }
    all.forEach(function (c) {
      var T = function (s) { return '配置' + c.id + ' ' + s; };
      ok(c.sharp.length === 2, T('有兩個清晰位置（D > 4f）'), 'D=' + (-c.object.x) + ' 4f=' + 4 * c.f);
      ok(floor.cellAt(c.object.x) === c.targetCell && near(floor.edgeMargin(c.object.x), 0.5), T('物點在目標格正中央'));
      ok(Math.abs(c.h) + WORLD.ghostHalfHeight < WORLD.axisHeight, T('鬼不穿出地板／天花板'));
      c.sharp.forEach(function (sp, i) {
        var S = function (s) { return T('清晰位置' + (i + 1) + ' ' + s); };
        ok(sp.lensX >= WORLD.lensMinX && sp.lensX <= WORLD.lensMaxX, S('在透鏡可移動範圍內'), 'lensX=' + sp.lensX.toFixed(2));
        ok(near(1 / c.f, 1 / sp.dObj + 1 / sp.dImg, 1e-12), S('符合 1/f = 1/dₒ + 1/dᵢ'), 'dₒ=' + sp.dObj.toFixed(2) + ' dᵢ=' + sp.dImg.toFixed(2));
        ok(sp.dObj > c.f, S('物在焦點外（實像）'));
        ok(sp.m < 0, S('倒立'), 'm=' + sp.m.toFixed(3));
        ok(Math.abs(sp.imageY) + 6 < WORLD.axisHeight, S('像的中心落在牆面內'), 'y=' + sp.imageY.toFixed(2));
        var w = wallImage(c.f, c.object.x, c.h, sp.lensX, WORLD.lensRadius);
        ok(w.blur < 1e-6, S('模糊圓為 0'), String(w.blur));
        // 兩條可逆主光線反推（透鏡座標：像點 = (dImg, imageY)）
        var r = Optics.reverseConstruct(c.f, { x: sp.dImg, y: sp.imageY });
        var back = { x: r.object.x + sp.lensX, y: r.object.y };
        ok(near(back.x, c.object.x) && near(back.y, c.object.y), S('兩條主光線反推回物點'), '(' + back.x.toFixed(4) + ', ' + back.y.toFixed(4) + ')');
        ok(floor.cellAt(back.x) === c.targetCell, S('反推交點落在目標格'));
        ok(near(r.P.y, c.h), S('P 的高度等於物高'), 'P.y=' + r.P.y.toFixed(3));
        ok(Math.abs(r.P.y) < WORLD.lensRadius, S('P 落在鏡片口徑內'));
        var ang = Math.atan(Math.abs(c.h) / sp.dObj) * 180 / Math.PI;
        ok(ang >= 5, S('兩線夾角 ≥ 5°'), ang.toFixed(1) + '°');
        ok(floor.cellAt(0 - 0.001) !== c.targetCell && floor.cellAt(sp.lensX) !== c.targetCell, S('透鏡與牆所在格 ≠ 目標格'));
        // 離開清晰位置，像就變模糊；模糊隨距離增加
        var w1 = wallImage(c.f, c.object.x, c.h, sp.lensX + WORLD.checkOffset, WORLD.lensRadius);
        var w2 = wallImage(c.f, c.object.x, c.h, sp.lensX + 3 * WORLD.checkOffset, WORLD.lensRadius);
        var b1 = w1.blur, b2 = w2.blur;
        var wHalf = wallImage(c.f, c.object.x, c.h, sp.lensX + WORLD.checkOffset / 2, WORLD.lensRadius);
        ok(wHalf.blurRatio <= WORLD.lockBlurRatio, S('偏 ' + WORLD.checkOffset / 2 + 'cm 內可以標記'), '模糊比 ' + wHalf.blurRatio.toFixed(3));
        ok(w2.blurRatio > WORLD.lockBlurRatio, S('偏 ' + 3 * WORLD.checkOffset + 'cm 不能標記'), '模糊比 ' + w2.blurRatio.toFixed(3));
        ok(b1 > 0.8 && b2 > b1, S('離開清晰位置會變模糊'), '偏 ' + WORLD.checkOffset + 'cm → ' + b1.toFixed(2) + 'cm；3 倍 → ' + b2.toFixed(2) + 'cm');
      });
      ok(c.sharp.length === 2 && near(c.sharp[0].m * c.sharp[1].m, 1, 1e-9), T('兩個清晰位置的放大率互為倒數'));
      ok(c.sharp.length === 2 && Math.abs(c.sharp[0].lensX - c.sharp[1].lensX) > 4 * WORLD.checkOffset, T('兩個清晰位置分得開'));
    });
    return out;
  }

  return { WORLD: WORLD, RAW: RAW, floor: floor, build: build, all: all, sharpLensPositions: sharpLensPositions, wallImage: wallImage, selfCheck: selfCheck };
});

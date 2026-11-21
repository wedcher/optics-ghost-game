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
 * 虛像題（kind: 'virtual'，實驗中）：D < 4f，布幕上永遠沒有清楚的實像；
 * 從布幕這邊（眼睛在 X = 0）隔著透鏡看，只有透鏡移到鬼和焦點之間時看得到正立、放大的虛像。
 * 玩家在「看凸透鏡」時標記虛像，標記打在虛像的位置（透鏡左邊）。
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
    wallHalfWidth: 80,    // 布幕正面視圖的半寬。鬼像永遠在主光軸正上／正下方，最寬的清晰像半寬約 56 cm，不需要正方形
    cellWidth: 100,
    cellCount: 10,        // 第 1 格緊鄰投影牆，第 10 格最遠
    lensMinX: -620,       // 透鏡可移動範圍：每一題都一樣，可以越過鬼（不能從「拉不過去」猜出題型）。透鏡在鬼後面時看不到像
    lensMaxX: -80,
    lensRadius: 120,      // 大型凸透鏡的口徑半徑（決定失焦時的模糊圓大小）
    virtualMaxY: 100,     // 虛像：像高（= 從標記水平畫到透鏡的 P）要在鏡片口徑內才能標記
    eyeX: 0,              // 「看凸透鏡」時眼睛的位置（站在布幕那一側）
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
    { id: 'D', f: 160, targetCell: 8, h: -50 },
    // E～I：挑過離軸高度，放大的那個像也完整落在布幕內（A～D 的放大像會超出布幕，見 findings ISSUE 20）
    { id: 'E', f: 110, targetCell: 5, h: -60 },
    { id: 'F', f: 130, targetCell: 6, h: 50 },
    { id: 'G', f: 180, targetCell: 8, h: 55 },
    { id: 'H', f: 150, targetCell: 7, h: 45 },
    { id: 'I', f: 200, targetCell: 9, h: -50 },
    // J～L：虛像題（D < 4f）。2026-11-21 改成短焦距：隔著透鏡看，像占鏡片的比例從約 0.33 提高到約 0.4～0.6（使用者：要像放大鏡）。布幕上永遠不會有清楚的像，只能隔著透鏡看到正立、放大的虛像
    { id: 'J', f: 110, targetCell: 4, h: 20, kind: 'virtual' },
    { id: 'K', f: 120, targetCell: 5, h: -20, kind: 'virtual' },
    { id: 'L', f: 170, targetCell: 7, h: -30, kind: 'virtual' },
    // M～O：原本的 J～L（2026-11-18，長焦距；像比較小，但焦點內的候選格比較多、不好猜）。使用者 2026-11-21 要加回來
    { id: 'M', f: 200, targetCell: 4, h: 30, kind: 'virtual' },
    { id: 'N', f: 220, targetCell: 5, h: -30, kind: 'virtual' },
    { id: 'O', f: 210, targetCell: 7, h: -30, kind: 'virtual' }
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
    var vw = virtualWindow(raw.f, objX, raw.h);
    return { id: raw.id, element: 'convex-lens', kind: raw.kind || 'real', f: raw.f, targetCell: raw.targetCell, h: raw.h, object: { x: objX, y: raw.h }, sharp: sharp,
      virtualWindow: vw, virtualLensX: vw ? Math.round((vw.from + vw.to) / 2) : null };
  }

  /**
   * 從布幕這邊（眼睛在 X = eyeX）隔著透鏡看鬼：
   *   eye = 'none'：透鏡在鬼的後面（或貼著鬼），鬼的光不會穿過透鏡到眼睛這邊
   *         'virtual'：鬼在焦點內 → 正立、放大的虛像（在透鏡左邊）
   *         'realInFront'：實像落在眼睛前面 ≥ 25 cm → 看得到倒立的像（虛像題不會發生）
   *         'infinity'：物在焦點上 → 出來的是平行光，眼睛看遠方就看得清楚：正立、放大的像在無限遠
   *         'behind'：實像落在眼睛後面 > 25 cm（光往眼睛後面會聚）→ 看到正立、放大的像。
   *                   眼睛對不了會聚光的焦，但模糊角 ≈ 瞳孔半徑 0.25 cm ÷ 像到眼睛的距離，不到鏡片的 2%，畫成清楚（2026-11-21 算過）
   *         'blur'：實像落在眼睛前後 25 cm 內 → 放大到極大、對不了焦，只看到一團光（只有實像題會發生）
   * A：從眼睛看，物上高 1 cm 的點的視角（弧度；正＝正立）。A = f ÷ (d·f − u·(d − f))，d＝透鏡到眼睛。
   *    虛像、實像在眼前或眼後、像在無限遠都適用（像在無限遠時 A = 1/f）。
   * inView：像的外框有沒有碰到鏡片的視野（鬼離主軸很遠時，像可能整個在鏡框外，鏡片裡是空的；2026-11-21）。
   *         只是必要條件：鬼圖的邊緣多半是空白，app.js 另外數實際畫進鏡片的像素（stats.lensImageVisible）。
   * x、y：像點（走廊座標）。markable：虛像可以標記（在走廊內、P 落在鏡片口徑內）。'infinity'／'behind' 一律不能標記。
   * angMag：從眼睛看，像的視角 ÷ 不用透鏡直接看鬼的視角。
   */
  function lensView(f, objX, h, lensX) {
    var u = lensX - objX, eye = WORLD.eyeX, d = eye - lensX;
    if (!(u > 5)) return { eye: 'none', u: u };
    var A = f / (d * f - u * (d - f));
    var img = Optics.thinLensImage(f, u, h);
    // 鬼的外框有沒有碰到鏡片視野（必要條件）。鬼圖不會塞滿外框，真的看不看得到由 app.js 照實際畫出的像素判斷
    var inView = Math.abs(A * h) - Math.abs(A) * WORLD.ghostHalfHeight < WORLD.lensRadius / d;
    if (!img || Math.abs(u - f) < 0.5) return { eye: 'infinity', u: u, A: A, angMag: Math.abs(A) * (eye - objX), markable: false, inView: inView };
    var x = lensX + img.dImg, y = img.m * h, out = { u: u, v: img.dImg, m: img.m, x: x, y: y, A: A, inView: inView };
    if (img.isVirtual) out.eye = 'virtual';
    else out.eye = x < eye - 25 ? 'realInFront' : x > eye + 25 ? 'behind' : 'blur';
    out.angMag = Math.abs(img.m) * (eye - objX) / Math.abs(eye - x);
    out.markable = out.eye === 'virtual' && inView && x >= -WORLD.corridorLength && Math.abs(y) <= WORLD.virtualMaxY;
    return out;
  }

  /** 透鏡在哪個範圍（每 1 cm 取樣）看得到可以標記的虛像：{ from, to }；沒有就是 null。 */
  function virtualWindow(f, objX, h) {
    var a = null, b = null;
    for (var x = WORLD.lensMinX; x <= WORLD.lensMaxX; x++) {
      if (lensView(f, objX, h, x).markable) { if (a == null) a = x; b = x; }
    }
    return a == null ? null : { from: a, to: b };
  }

  /**
   * 虛像標記反推（走廊座標）。學生能走的路線：
   *   A. 標記 ↔ 光心 O
   *   B. 標記水平畫到透鏡得 P → 連 P 與物側焦點 F（F′ 可能在布幕後面，畫不到）
   *   C. 標記 ↔ 像側焦點 F′，交透鏡於 P′ → 過 P′ 的水平線（F′ 在布幕前面時才畫得到）
   */
  function reverseVirtual(f, lensX, mark) {
    var O = { x: lensX, y: 0 }, F = { x: lensX - f, y: 0 }, F2 = { x: lensX + f, y: 0 };
    var center = Optics.lineThrough(mark, O);
    var P = { x: lensX, y: mark.y };
    var P2 = Optics.intersectVertical(Optics.lineThrough(mark, F2), lensX);
    return { P: P, P2: P2, viaF: Optics.intersect(center, Optics.lineThrough(P, F)), viaF2: Optics.intersect(center, Optics.horizontalLine(P2)) };
  }

  var all = RAW.map(build);

  /**
   * 幾何自我檢查；回傳 [{ ok, label, detail }]。
   * 瀏覽器與 Node（tests/check-geometry-convex.js）都呼叫這一份。
   */
  function selfCheck(list) {
    var out = [];
    function ok(cond, label, detail) { out.push({ ok: !!cond, label: label, detail: detail || '' }); }
    function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }
    (list || all).forEach(function (c) {
      var T = function (s) { return '配置' + c.id + ' ' + s; };
      if (c.kind === 'virtual') { checkVirtual(c, ok, near, T); return; }
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
        ok(WORLD.ghostHalfWidth * Math.abs(sp.m) + 6 < WORLD.wallHalfWidth, S('清晰像的寬度落在布幕內'), '半寬 ' + (WORLD.ghostHalfWidth * Math.abs(sp.m)).toFixed(1) + ' cm');
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
      // 實像題的透鏡也能移到鬼和焦點之間：那時看到的虛像，標記後一樣反推得回鬼（物理上正確，允許）
      if (c.virtualWindow) checkVirtualMarks(c, ok, near, T);
    });
    return out;
  }

  function checkVirtualMarks(c, ok, near, T) {
    var bad = [], n = 0;
    for (var x = c.virtualWindow.from; x <= c.virtualWindow.to; x += 5) {
      var v = lensView(c.f, c.object.x, c.h, x);
      if (!v.markable) continue;
      n++;
      var r = reverseVirtual(c.f, x, { x: v.x, y: v.y });
      var good = near(r.viaF.x, c.object.x, 1e-6) && near(r.viaF.y, c.h, 1e-6) && near(r.viaF2.x, c.object.x, 1e-6) && near(r.viaF2.y, c.h, 1e-6) &&
        near(r.P2.y, c.h, 1e-6) && Math.abs(r.P.y) < WORLD.lensRadius && v.m > 1 && v.angMag > 1;
      if (!good) bad.push(x);
    }
    ok(n > 0 && bad.length === 0, T('看得到虛像的每個透鏡位置：標記↔O 配「標記水平到 P → P↔F」或「標記↔F′ → 過 P′ 水平」都反推回鬼；正立、放大，看起來比直接看大'),
      '透鏡 ' + c.virtualWindow.from + '～' + c.virtualWindow.to + '，取樣 ' + n + ' 個' + (bad.length ? '，失敗 ' + bad.join(',') : ''));
  }

  function checkVirtual(c, ok, near, T) {
    var D = -c.object.x;
    ok(D < 4 * c.f && c.sharp.length === 0, T('虛像題：鬼到布幕 < 4f，沒有清晰實像的位置'), 'D=' + D + ' 4f=' + 4 * c.f);
    ok(floor.cellAt(c.object.x) === c.targetCell && near(floor.edgeMargin(c.object.x), 0.5), T('物點在目標格正中央'));
    ok(Math.abs(c.h) + WORLD.ghostHalfHeight < WORLD.axisHeight, T('鬼不穿出地板／天花板'));
    var minRatio = Infinity, inFront = 0, behind = 0;
    for (var x = WORLD.lensMinX; x <= WORLD.lensMaxX; x++) {
      var w = wallImage(c.f, c.object.x, c.h, x, WORLD.lensRadius);
      if (w && w.blurRatio < minRatio) minRatio = w.blurRatio;
      var v = lensView(c.f, c.object.x, c.h, x);
      if (v.eye === 'realInFront') inFront++;
      if (v.eye === 'none') behind++;
    }
    ok(minRatio > 2 * WORLD.lockBlurRatio, T('透鏡在可移動範圍內任何位置，布幕上都不夠清楚、不能標記'), '最小模糊比 ' + minRatio.toFixed(2) + '（門檻 ' + WORLD.lockBlurRatio + '）');
    ok(inFront === 0, T('隔著透鏡也永遠看不到倒立的實像（實像都落在布幕後面）'));
    var past = 0, pastBad = [];
    for (var x2 = WORLD.lensMinX; x2 <= WORLD.lensMaxX; x2++) {
      var v2 = lensView(c.f, c.object.x, c.h, x2);
      if (v2.u < c.f - 0.5 || v2.eye === 'none') continue;
      past++;
      if (!((v2.eye === 'infinity' || v2.eye === 'behind') && v2.A > 0 && !v2.markable && v2.inView)) pastBad.push(x2 + ':' + v2.eye + (v2.inView ? '' : '(鏡框外)'));
    }
    ok(pastBad.length === 0, T('透鏡推到焦點上或焦點外：隔著透鏡看得到正立的像（像在無限遠或布幕後面、在鏡框內），不能標記'), past + ' 個位置' + (pastBad.length ? '，不符 ' + pastBad.slice(0, 5).join(',') : ''));
    ok(true, T('（資訊）透鏡範圍和實像題一樣；能越過鬼的位置'), behind ? behind + ' 個（越過時布幕和透鏡裡都看不到像）' : '0 個（鬼在透鏡最左端之外）');
    var vw = c.virtualWindow;
    ok(vw && vw.to - vw.from >= 40, T('看得到可標記虛像的透鏡範圍夠寬（≥ 40 cm）'), vw ? vw.from + '～' + vw.to : '無');
    if (!vw) return;
    checkVirtualMarks(c, ok, near, T);
    var mid = lensView(c.f, c.object.x, c.h, c.virtualLensX);
    var ang = Math.atan(Math.abs(mid.y) / Math.abs(c.virtualLensX - mid.x)) * 180 / Math.PI;
    ok(ang >= 3, T('範圍中點：標記↔O 與水平線的夾角 ≥ 3°'), 'lensX=' + c.virtualLensX + '，虛像 (' + mid.x.toFixed(0) + ', ' + mid.y.toFixed(0) + ')，m=' + mid.m.toFixed(2) + '，看起來 ' + mid.angMag.toFixed(2) + ' 倍，夾角 ' + ang.toFixed(1) + '°');
  }

  return { WORLD: WORLD, RAW: RAW, floor: floor, build: build, all: all, sharpLensPositions: sharpLensPositions, wallImage: wallImage,
    lensView: lensView, virtualWindow: virtualWindow, reverseVirtual: reverseVirtual, selfCheck: selfCheck };
});

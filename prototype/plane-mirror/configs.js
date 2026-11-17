/*
 * configs.js — 第一關（平面鏡房間）的房間設定。
 *
 * 相機參數是對著背景圖（docs/concepts/Mirror1.png，1672×941）量出來的：
 *   - 左右兩條牆腳線的消失點在 (537, 296) → 視平線 y = 296、f·tan(yaw) = 299。
 *   - 正面牆腳線由 (245, 570) 到 (1125, 549) → f ≈ 1804、yaw ≈ 9.4°（鏡頭略朝右）。
 *   - 兩個牆角的位置 → 房間寬 = 眼高的 3.34 倍。定房間寬 = 4 格，得眼高 1.197 格、離正面牆 8.18 格。
 * 鏡面範圍也是照圖量的（把圖上鏡框內緣的四個角投回牆面），兩面鏡量出來都是上緣約 1.8 格、下緣 0.25 格。
 * 下緣改成 0：鏡面一路畫到地板（原圖的下框由程式蓋掉），理由見 docs/prototype-findings-mirror.md。
 *
 * 單位：一塊地磚的邊長。座標定義見 prototype/shared/mirror-core.js。
 * 出題的格子不寫在這裡：由 MirrorCore.eligibleCells() 依幾何算出，tests/check-geometry-mirror.js 驗證。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MirrorRoom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    image: { w: 1672, h: 941 },
    camera: { f: 1804, cx: 836, cy: 296, yawDeg: 9.4, eye: { x: 1.257, y: 1.197, z: 8.18 } },
    cols: 4,          // 左右 4 格（房間寬）
    rows: 4,          // 由正面牆往玩家數，畫面上完整看得到的排數（第 5 排已經超出畫面下緣）
    length: 10,       // 房間深度：玩家背後那面牆在 z = 10
    ceiling: 2.3,
    // 鬼：docs/concepts/ghost01.png 的女鬼。原圖裙襬收成一個尖、看起來懸空，沒辦法判斷牠站在哪一格，
    // 所以把圖在裙子還很寬的地方（原圖 y=1390）切平，讓牠像從地板冒出來；切口中央對準格子中央。
    ghost: { width: 0.58, height: 1.15, poolRadius: 0.30 },
    mirrors: {
      back:  { axis: 'z', value: 0, label: '正面的鏡子', glass: { a: 0.80, b: 3.09, topA: 1.84, topB: 1.77, bottom: 0 } },
      right: { axis: 'x', value: 4, label: '右邊的鏡子', glass: { a: 0.96, b: 3.75, topA: 1.75, topB: 1.83, bottom: 0 } }
    },
    paintedBottom: 0.25, // 原圖鏡框下緣的高度（只用來記錄與檢查）
    breaks: 'right',     // 鬼打碎的是右邊那面（Mirror2.png）
    // 原圖裡碎鏡的玻璃範圍（影像座標），單鏡階段用來把畫死的反射壓暗
    brokenGlassPx: [{ x: 1200, y: 165 }, { x: 1578, y: 58 }, { x: 1578, y: 668 }, { x: 1200, y: 522 }],
    // 場景裡會被鏡子照到的東西（位置照圖量的；只影響鏡中畫面好不好看，不影響答案）
    lamps: [{ wall: 'back', x: 0.31, y: 1.31 }, { wall: 'back', x: 3.64, y: 1.32 }],
    window: { z0: 2.11, z1: 3.33, y0: 0.72, y1: 1.9 },
    door: { x0: 1.4, x1: 2.6, y1: 1.85 },
    // 關卡規則
    lives: 3, catchesTwoMirrors: 2, catchesTotal: 5
  };
});

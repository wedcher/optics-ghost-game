/*
 * configs.js — 第一關（平面鏡房間）的房間設定。
 *
 * 背景圖：docs/concepts/Mirror4.png（兩面落地鏡完好）、Mirror5.png（右鏡打碎），1672×941。
 * 相機參數是對著 Mirror4.png 量出來的：
 *   - 正面牆腳線是水平的（y = 712）→ 鏡頭正對正面牆，沒有左右轉。
 *   - 左右兩條牆腳線交於 (704, 418) → 視平線 y = 418、主點 x = 704。
 *   - 圖上的地磚若是正方形，各排格線的位置（y = 742、782、832）給出 f ≈ 1350。
 *   - 兩個牆角在 x = 258、1292 → 房間寬 = 眼高的 3.517 倍。定房間寬 = 6 格，得眼高 1.706 格、離正面牆 7.83 格。
 * 鏡面範圍照圖量（鏡框內緣投回牆面）。兩面都是落地鏡，下緣 = 地板。
 * 右鏡一路延伸到畫面右緣之外，近端取 z = 5（畫面外，不影響看得到的範圍）。
 *
 * 單位：一塊地磚的邊長。座標定義見 prototype/shared/mirror-core.js。
 * 出題的格子不寫在這裡：由 MirrorCore.eligibleCells() 依幾何算出，tests/check-geometry-mirror.js 驗證。
 *
 * （第一版用的是 Mirror1.png／Mirror2.png：有下框的掛鏡、玩家站得遠。使用者試玩後認為太難玩而換圖，
 *   舊參數見 git 紀錄與 docs/prototype-findings-mirror.md。）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MirrorRoom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    image: { w: 1672, h: 941 },
    camera: { f: 1350, cx: 704, cy: 418, yawDeg: 0, eye: { x: 2.59, y: 1.706, z: 7.83 } },
    cols: 6,          // 左右 6 格（房間寬）
    rows: 3,          // 由正面牆往玩家數，畫面上完整看得到的排數（第 4 排已經超出畫面下緣）
    length: 12,       // 房間深度：玩家背後那面牆在 z = 12
    ceiling: 3.6,
    // 鬼：docs/concepts/ghost01.png 的女鬼。原圖裙襬收成一個尖、看起來懸空，沒辦法判斷牠站在哪一格，
    // 所以把圖在裙子還很寬的地方（原圖 y=1390）切平，讓牠像從地板冒出來；切口中央對準格子中央。
    ghost: { width: 0.81, height: 1.6, poolRadius: 0.38 },
    mirrors: {
      back:  { axis: 'z', value: 0, label: '正面的鏡子', glass: { a: 0.26, b: 5.83, topA: 3.26, topB: 3.26, bottom: 0 } },
      right: { axis: 'x', value: 6, label: '右邊的鏡子', glass: { a: 0.23, b: 5.0, topA: 3.16, topB: 3.16, bottom: 0 } }
    },
    paintedBottom: 0,    // 圖裡的鏡子就是落地的
    breaks: 'right',     // 鬼打碎的是右邊那面（Mirror5.png）
    // 圖裡碎鏡的玻璃範圍（影像座標）。brokenDarken > 0 時用半透明黑把圖裡畫死的反射壓暗；這張圖的鏡面本來就是暗的，不用壓。
    brokenGlassPx: [{ x: 1310, y: 160 }, { x: 1672, y: 5 }, { x: 1672, y: 902 }, { x: 1310, y: 720 }],
    brokenDarken: 0,
    shards: { z0: 0.3, z1: 1.9 }, // 碎片散在右牆邊的這一段
    // 場景裡會被鏡子照到的東西（位置照圖量的；只影響鏡中畫面好不好看，不影響答案）
    lamps: [{ x: 0, y: 2.45, z: 0.53 }],
    window: { z0: 1.57, z1: 2.64, y0: 1.18, y1: 3.3 },
    door: { x0: 2.3, x1: 3.7, y1: 3.0 },
    // 關卡規則
    lives: 3, catchesTwoMirrors: 2, catchesTotal: 5
  };
});

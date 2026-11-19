/*
 * configs.js — 凹透鏡 prototype 的參數化測試配置。
 *
 * 做法（依 docs/physics-check-concave-lens.md 的建議）：
 *   1. 先指定目標格 targetCell 與鬼的離軸高度 h；
 *   2. 物點放在該格正中央；
 *   3. 由 OpticsCore 正向算出虛像；
 *   4. 玩家反推時自然回到格中央。
 * 這裡不寫死任何像點或答案座標。
 *
 * 長度單位：cm。主光軸在眼睛高度；地面在主光軸下方 EYE_HEIGHT。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../shared/optics-core.js'));
  } else {
    root.ConcaveLensConfigs = factory(root.OpticsCore);
  }
})(typeof self !== 'undefined' ? self : this, function (Optics) {
  'use strict';

  var WORLD = {
    eyeHeight: 160,     // 主光軸離地高度
    eyeToLens: 45,      // 眼睛到手持透鏡的距離（手臂長）
    lensRadius: 25,     // 手持透鏡的實際半徑（探索視角用）
    cellWidth: 100,     // 地板格寬
    cellCount: 7,       // 物側格數
    ghostHalfHeight: 35,
    ghostHalfWidth: 25,
    directions: ['北', '東', '南', '西']
  };

  // 只有這四個欄位是「輸入」；其餘全部由幾何導出。
  var RAW = [
    { id: 'A', f: -200, targetCell: 4, h: 100, direction: 1 },
    { id: 'B', f: -250, targetCell: 6, h: -90, direction: 2 },
    { id: 'C', f: -300, targetCell: 7, h: 120, direction: 3 },
    { id: 'D', f: -180, targetCell: 3, h: -70, direction: 0 },
    // 2026-11-19 加（PENDING 25）：原本一個方位只有一組，學生會背「東邊＝第 4 格」。
    // 每個方位改成 3 組、答案格都不同，焦距與鬼的高度（正負）也換過；全部過 tests/check-geometry.js。
    { id: 'E', f: -260, targetCell: 5, h: 110, direction: 0 },
    { id: 'F', f: -320, targetCell: 7, h: -100, direction: 0 },
    { id: 'G', f: -290, targetCell: 2, h: -70, direction: 1 },
    { id: 'H', f: -320, targetCell: 6, h: 120, direction: 1 },
    { id: 'I', f: -240, targetCell: 3, h: 100, direction: 2 },
    { id: 'J', f: -300, targetCell: 5, h: -110, direction: 2 },
    { id: 'K', f: -280, targetCell: 2, h: 70, direction: 3 },
    { id: 'L', f: -270, targetCell: 4, h: -90, direction: 3 }
  ];

  var floor = Optics.makeFloorRow(WORLD.cellWidth, WORLD.cellCount);

  function build(raw) {
    var objX = floor.centerX(raw.targetCell);
    var dObj = -objX;
    var img = Optics.thinLensImage(raw.f, dObj, raw.h);
    return {
      id: raw.id,
      element: 'concave-lens',
      f: raw.f,
      direction: raw.direction,
      targetCell: raw.targetCell,
      dObj: dObj,
      h: raw.h,
      object: { x: objX, y: raw.h },
      image: img.point,
      dImg: img.dImg,
      m: img.m,
      focal: Optics.focalPoints(raw.f)
    };
  }

  return {
    WORLD: WORLD,
    RAW: RAW,
    floor: floor,
    build: build,
    all: RAW.map(build)
  };
});

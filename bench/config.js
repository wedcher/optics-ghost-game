/*
 * config.js — 光學實驗桌模擬器的所有數字。要改尺寸、焦距、位置，只改這一支。
 * 長度單位：公分。x 軸沿光具座，0 在尺的左端；光軸高度由尺的上緣往上算。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BenchConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    benchLength: 100,        // 光具座（尺）長度
    lensX: 40,               // 透鏡固定位置
    f: 10,                   // 焦距大小（凸透鏡 +f，凹透鏡 −f）
    lensRadius: 3,           // 透鏡口徑半徑（直徑 6）
    axisH: 12,               // 光軸離尺上緣的高度
    // 燈具：三個指尖燈疊成 L 形。r、y 是「從透鏡這側看」燈窗中心的位置（r 向右為正，y 從光軸往上）。
    // 燈窗在燈的右端（面向透鏡）；物的位置 objX 指燈窗那一面。
    lamp: {
      len: 3,                // 燈身長度（沿光軸）
      size: 1.5,             // 燈身寬、高
      windowR: 0.55,         // 燈窗半徑
      windows: [
        { id: 'blue',  r:  0.75, y: 2.25, color: [47, 123, 255] },
        { id: 'red',   r: -0.75, y: 0.75, color: [255, 59, 48] },
        { id: 'green', r:  0.75, y: 0.75, color: [34, 197, 94] }
      ]
    },
    screen: { w: 14, h: 16 },       // 光屏大小，中心在光軸上
    eye: { dist: 30, near: 10 },    // 看透鏡時眼睛在透鏡後方的距離；近點（再近就對不了焦）
    range: { objMin: 2, objMax: 36, screenMinFromLens: 8, screenMax: 98 },
    start: { objX: 10, screenX: 70 } // 開場位置：物距 30（大於 2f）、像距 30
  };
});

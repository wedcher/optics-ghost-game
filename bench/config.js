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
    benchLength: 84,         // 光具座（尺）長度
    lensX: 30,               // 透鏡固定位置
    f: 10,                   // 焦距大小（凸透鏡 +f，凹透鏡 −f）
    lensRadius: 5,           // 透鏡口徑半徑（直徑 10）
    axisH: 13,               // 光軸離尺上緣的高度
    // 燈具：三個指尖燈疊成 L 形。r、y 是「從透鏡這側看」燈窗中心的位置（r 向右為正，y 從光軸往上）。
    // 燈窗在燈的右端（面向透鏡）；物的位置 objX 指燈窗那一面。
    lamp: {
      len: 4,                // 燈身長度（沿光軸）
      size: 2,               // 燈身寬、高（L 形總高 4）
      windowR: 0.75,         // 燈窗半徑
      windows: [
        { id: 'blue',  r:  1, y: 3, color: [47, 123, 255] },
        { id: 'red',   r: -1, y: 1, color: [255, 59, 48] },
        { id: 'green', r:  1, y: 1, color: [34, 197, 94] }
      ]
    },
    analysisStretch: 2.5,    // 分析畫面上下方向放大幾倍（使用者給的參考圖：透鏡約 2.5 倍焦距高；上下拉伸不改變光學，直線與交點照樣成立）
    screen: { w: 16, h: 18 },       // 光屏大小，中心在光軸上
    eye: { dist: 30, near: 10 },    // 看透鏡時眼睛在透鏡後方的距離；近點（再近就對不了焦）
    range: { objMin: 4, objMax: 25, screenMinFromLens: 8, screenMax: 82 },
    start: { objX: 5, screenX: 62 }  // 開場位置：物距 25（大於 2f）、光屏離清楚的位置還差一點
  };
});

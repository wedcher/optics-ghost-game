/**
 * 第二、三關的鬼：使用者給的 9 張小鬼圖（shared/art/minion-0N.webp，也是過關演出裡飛走的那些）。
 * 第一關的女鬼（ghost01）另外處理，不用這支。
 *
 * 一隻鬼抽一張圖；鬼本體與它的像用同一張圖，由程式做倒立／左右相反／縮放（CONFIRMED：不另畫姿勢）。
 * 圖還沒載入時 draw() 回傳 false，各關退回原本的程式畫鬼。
 */
(function (root) {
  'use strict';
  var N = 9, calls = 0, imgs = [], cur = Math.floor(Math.random() * N), last = -1, listeners = [];
  var base = '../shared/art/';
  try {
    var s = document.currentScript && document.currentScript.src;
    if (s) base = s.replace(/[^\/]*$/, '') + 'art/';
  } catch (e) { /* 用預設路徑 */ }
  for (var i = 0; i < N; i++) {
    var im = new Image();
    im.onload = function () { listeners.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); };
    im.src = base + 'minion-0' + i + '.webp';
    imgs.push(im);
  }

  /** 換一隻鬼（不和上一隻相同）。 */
  function pick() {
    var n;
    do { n = Math.floor(Math.random() * N); } while (n === last && N > 1);
    last = cur = n;
    return n;
  }

  /**
   * 把鬼畫進以 (px, py) 為中心、半寬 hw、半高 hh 的框。
   * sx、sy = -1 表示左右／上下翻轉。glow：發光顏色（null 不發光）。
   */
  function draw(c, px, py, hw, hh, sx, sy, glow) {
    var im = imgs[cur];
    if (!im || !im.complete || !im.naturalWidth || !(hw > 0) || !(hh > 0)) return false;
    calls++;
    // 測試用：自動測試用鬼的顏色數像素（檢查沒有露出鬼），設了這個旗標就退回程式畫的單色輪廓
    if (root.__ghostArtOff) return false;
    c.save();
    if (glow) { c.shadowColor = glow; c.shadowBlur = Math.max(4, hw * 0.5); }
    c.translate(px, py);
    c.scale(sx || 1, sy || 1);
    c.drawImage(im, -hw, -hh, 2 * hw, 2 * hh);
    c.restore();
    return true;
  }

  root.GhostSprite = {
    pick: pick,
    draw: draw,
    index: function () { return cur; },
    calls: function () { return calls; },
    loaded: function () { return imgs.filter(function (m) { return m.complete && m.naturalWidth > 0; }).length; },
    onLoad: function (f) { listeners.push(f); },
    ready: function () { return !!(imgs[cur] && imgs[cur].complete && imgs[cur].naturalWidth); }
  };
})(typeof window !== 'undefined' ? window : this);

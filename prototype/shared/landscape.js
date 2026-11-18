/*
 * landscape.js — 遊戲一律橫向遊玩。
 *
 * 2026-11-18 試玩回饋 G3：不再蓋「請把手機橫放」的提示（#rotateHint 已拿掉）。
 * 目前能做的：
 *   - manifest.webmanifest 的 "orientation": "landscape"：從主畫面圖示開啟時由系統鎖橫向。
 *   - Android 全螢幕時 screen.orientation.lock('landscape')（在 shared/fullscreen.js 進全螢幕之後呼叫；
 *     不在全螢幕時瀏覽器一律拒絕，所以這裡載入時只試一次、失敗就算了）。
 * 還沒做（PROJECT.md 交接點）：手機直拿時把整個遊戲轉 90° 顯示、觸控座標跟著換算。
 */
(function () {
  'use strict';
  window.GameLandscape = {
    lock: function () {
      try {
        if (screen.orientation && screen.orientation.lock) {
          var p = screen.orientation.lock('landscape');
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) { /* 不支援（iOS 等）：不影響遊玩 */ }
    }
  };
  window.GameLandscape.lock();
})();

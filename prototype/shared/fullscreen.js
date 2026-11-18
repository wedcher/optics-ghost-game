/*
 * fullscreen.js — 進入關卡後全螢幕遊玩（三關共用）。
 *
 * - Android／平板的瀏覽器：玩家第一次碰畫面時切成全螢幕（Fullscreen API 一定要由使用者的操作觸發）。
 *   每次載入頁面只嘗試到成功為止；玩家自己退出全螢幕後不會再被拉回去。
 * - iPhone 的 Safari 不支援網頁全螢幕：改用「加入主畫面」（各頁 <head> 的 manifest 與 apple-mobile-web-app-capable），
 *   從主畫面圖示開啟時沒有網址列。這種開法（standalone）下這支程式什麼都不做。
 * - 進全螢幕後順便鎖橫向（screen.orientation.lock，Android 有效；iOS 不支援）。
 * - 桌機（滑鼠）不自動切；自動化測試（navigator.webdriver）也不切，以免改變視窗大小。
 */
(function () {
  'use strict';
  if (navigator.webdriver) return;
  var el = document.documentElement;
  var req = el.requestFullscreen || el.webkitRequestFullscreen;
  var mm = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  if (!req || navigator.standalone || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || !mm('(pointer: coarse)')) return;
  var tries = 0;
  // 進全螢幕後才鎖得住橫向（Android）；landscape.js 有載入就用它，沒有就直接呼叫。
  function lockLandscape() {
    if (window.GameLandscape) { window.GameLandscape.lock(); return; }
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) { /* ignore */ }
  }
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function stop() { document.removeEventListener('pointerup', go, true); document.removeEventListener('click', go, true); }
  function go() {
    if (isFull() || ++tries > 4) { stop(); return; }
    try {
      var p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(function () { stop(); lockLandscape(); }, function () { /* 這次操作不算數，下一次再試 */ }); else { stop(); lockLandscape(); }
    } catch (e) { /* 不支援就照一般網頁玩 */ }
  }
  document.addEventListener('pointerup', go, true);
  document.addEventListener('click', go, true);
})();

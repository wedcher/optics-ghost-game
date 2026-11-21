/*
 * fullscreen.js — 全螢幕遊玩（外框頁、選單、三關共用）。
 *
 * - Android／平板的瀏覽器：玩家第一次碰畫面時切成全螢幕（Fullscreen API 一定要由使用者的操作觸發）。
 *   每次載入頁面只嘗試到成功為止；玩家自己退出全螢幕後，在同一頁不會再被拉回去。
 * - 外框頁（game.html，使用者 2026-11-21）：選單與三關在外框頁的 iframe 裡換頁，全螢幕切在**外框頁**上，
 *   換頁時就不會退出全螢幕（不會每次跳「滑動結束全螢幕」）。框裡的頁面點畫面時請外框頁切
 *   （使用者的點擊會傳到外層頁面，外框頁可以用這次點擊切全螢幕）。直接開關卡網址時照舊自己切。
 * - iPhone 的 Safari 不支援網頁全螢幕：改用「加入主畫面」（各頁 <head> 的 manifest 與 apple-mobile-web-app-capable），
 *   從主畫面圖示開啟時沒有網址列。這種開法（standalone）下這支程式什麼都不做。
 * - 進全螢幕後順便鎖橫向（screen.orientation.lock，Android 有效；iOS 不支援）。
 * - 桌機（滑鼠）不自動切；自動化測試（navigator.webdriver）也不切，以免改變視窗大小。
 */
(function () {
  'use strict';
  var host = null;
  try { if (window.top !== window && window.top.GameFullscreen) host = window.top.GameFullscreen; } catch (e) { /* 不同網域：自己切 */ }

  var el = document.documentElement;
  var req = el.requestFullscreen || el.webkitRequestFullscreen;
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var usable = !navigator.webdriver && !!req && !navigator.standalone && !mm('(display-mode: standalone)') &&
    !mm('(display-mode: fullscreen)') && mm('(pointer: coarse)');

  // 進全螢幕後才鎖得住橫向（Android）；landscape.js 有載入就用它，沒有就直接呼叫。
  function lockLandscape() {
    if (window.GameLandscape) { window.GameLandscape.lock(); return; }
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) { /* ignore */ }
  }
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  // 在這一頁切全螢幕；回傳 Promise（成功 resolve）
  function enter() {
    if (!usable) return Promise.reject(new Error('fullscreen not usable'));
    if (isFull()) return Promise.resolve();
    try {
      var p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) return p.then(lockLandscape);
      lockLandscape(); return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }

  if (window.top === window) window.GameFullscreen = { enter: enter, isFull: isFull, usable: function () { return usable; } };

  // 這一頁：第一次碰畫面時切（框裡的頁面請外框頁切）
  if (host ? !host.usable() : !usable) return;
  var tries = 0;
  function stop() { document.removeEventListener('pointerup', go, true); document.removeEventListener('click', go, true); }
  function go() {
    if ((host ? host.isFull() : isFull()) || ++tries > 4) { stop(); return; }
    (host ? host.enter() : enter()).then(stop, function () { /* 這次操作不算數，下一次再試 */ });
  }
  document.addEventListener('pointerup', go, true);
  document.addEventListener('click', go, true);
})();

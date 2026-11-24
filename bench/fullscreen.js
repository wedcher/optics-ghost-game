/*
 * fullscreen.js — 右下角的全螢幕按鈕（點一下進全螢幕、再點一下退出，圖示跟著換）。
 * Android／桌機瀏覽器有 Fullscreen API；iPhone Safari 沒有（網頁不能全螢幕）→ 按鈕自動隱藏，改用「加入主畫面」。
 * 進全螢幕後順便鎖橫向（Android 有效）。
 */
(function () {
  'use strict';
  var el = document.documentElement, btn = document.getElementById('b-full');
  var req = el.requestFullscreen || el.webkitRequestFullscreen;
  var exit = document.exitFullscreen || document.webkitExitFullscreen;
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var supported = !!req && !!exit && !navigator.standalone && !mm('(display-mode: standalone)') && !mm('(display-mode: fullscreen)');
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function paint() {
    var full = isFull();
    btn.classList.toggle('is-full', full);
    btn.setAttribute('aria-label', full ? '縮小（離開全螢幕）' : '全螢幕');
    btn.title = full ? '縮小' : '全螢幕';
  }
  if (!btn) return;
  if (!supported) { btn.hidden = true; return; }
  btn.onclick = function () {
    try {
      if (isFull()) { exit.call(document); return; }
      var p = req.call(el, { navigationUI: 'hide' });
      var done = function () { if (window.BenchLandscape) window.BenchLandscape.lock(); };
      if (p && p.then) p.then(done, function () {}); else done();
    } catch (e) { /* 不支援或被拒絕：不影響使用 */ }
  };
  document.addEventListener('fullscreenchange', paint); document.addEventListener('webkitfullscreenchange', paint);
  paint();
})();

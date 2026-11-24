/*
 * landscape.js — 手機直拿時把整個畫面轉 90°，一律橫向顯示（從遊戲 prototype/shared/landscape.js 簡化而來，bench/ 獨立不引用遊戲檔案）。
 * 觸控裝置且視窗高 > 寬（網址沒有 ?portrait=1）時，<body> 轉 90°：寬 = 螢幕高、高 = 螢幕寬。
 * 轉向後 getBoundingClientRect() 拿到的是轉過的外框，所以觸控座標一律用 BenchLandscape.toLocal()。
 * 全螢幕之後 Android 可再鎖橫向（lock()），鎖成功視窗就是橫的，不需要轉。
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var OFF = /[?&]portrait=1(&|$)/.test(location.search);
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var rotated = false, lastKey = '';
  function touchDevice() { return mm('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && mm('(hover: none)')); }
  function screenSize() { return { width: window.innerWidth || root.clientWidth, height: window.innerHeight || root.clientHeight }; }

  var CSS = 'html.gl-rot{height:100%;overflow:hidden;overscroll-behavior:none}' +
    'html.gl-rot body{position:fixed;top:0;left:0;margin:0;width:var(--gl-w);height:var(--gl-h);max-width:none;' +
    'transform-origin:0 0;transform:translateX(var(--gl-sw)) rotate(90deg);overflow:hidden}';
  function injectCss() {
    if (document.getElementById('gl-css')) return;
    var s = document.createElement('style'); s.id = 'gl-css'; s.textContent = CSS; (document.head || root).appendChild(s);
  }
  function sync() {
    var s = screenSize(), want = !OFF && touchDevice() && s.height > s.width, key = want + ':' + s.width + 'x' + s.height;
    if (key === lastKey) return;
    lastKey = key; rotated = want;
    if (want) {
      injectCss();
      root.style.setProperty('--gl-sw', s.width + 'px'); root.style.setProperty('--gl-sh', s.height + 'px');
      root.style.setProperty('--gl-w', s.height + 'px'); root.style.setProperty('--gl-h', s.width + 'px');
      root.classList.add('gl-rot');
    } else {
      root.classList.remove('gl-rot');
      ['--gl-sw', '--gl-sh', '--gl-w', '--gl-h'].forEach(function (k) { root.style.removeProperty(k); });
    }
    try { window.dispatchEvent(new Event('benchlandscape')); } catch (e) { /* ignore */ }
  }
  function pt(e) { var t = e && e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e; return { x: t.clientX, y: t.clientY }; }

  window.BenchLandscape = {
    isRotated: function () { return rotated; },
    toLocal: function (e, el) { var c = pt(e), r = el.getBoundingClientRect(); return rotated ? { x: c.y - r.top, y: r.right - c.x } : { x: c.x - r.left, y: c.y - r.top }; },
    toClient: function (p, el) { var r = el.getBoundingClientRect(); return rotated ? { x: r.right - p.y, y: r.top + p.x } : { x: r.left + p.x, y: r.top + p.y }; },
    lock: function () {
      try { if (screen.orientation && screen.orientation.lock) { var p = screen.orientation.lock('landscape'); if (p && p.catch) p.catch(function () {}); } } catch (e) { /* iOS 等不支援 */ }
    }
  };
  sync();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', function () { sync(); setTimeout(sync, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', sync);
  document.addEventListener('DOMContentLoaded', function () { lastKey = ''; sync(); });
})();

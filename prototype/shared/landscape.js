/*
 * landscape.js — 遊戲一律橫向遊玩。
 *
 * 網頁不能強制手機轉向（screen.orientation.lock 只有全螢幕時才有效，iOS 不支援），
 * 所以做法是：觸控裝置直向拿著時，蓋上一層「請把手機橫放」的提示，橫放後自動消失。
 * 桌機（滑鼠）不受影響，視窗再窄也能操作。
 * 開發時網址加 ?portrait=1 可以關掉這個提示。
 */
(function () {
  'use strict';
  if (/[?&]portrait=1/.test(location.search)) return;

  var style = document.createElement('style');
  style.textContent =
    '#rotateHint{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;' +
    'flex-direction:column;gap:18px;background:#0d1020;color:#e8ebff;text-align:center;padding:24px;' +
    'font:600 20px/1.5 system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}' +
    '#rotateHint .phone{width:64px;height:110px;border:4px solid #b980ff;border-radius:12px;' +
    'animation:rotateHintTurn 2.4s ease-in-out infinite}' +
    '#rotateHint small{font-weight:400;font-size:14px;color:#9aa3cf}' +
    '@keyframes rotateHintTurn{0%,25%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}' +
    '@media (orientation:portrait) and (pointer:coarse){#rotateHint{display:flex}}' +
    '@media (prefers-reduced-motion:reduce){#rotateHint .phone{animation:none;transform:rotate(-90deg)}}';
  document.head.appendChild(style);

  function mount() {
    var el = document.createElement('div');
    el.id = 'rotateHint';
    el.setAttribute('role', 'alert');
    el.innerHTML = '<div class="phone" aria-hidden="true"></div><div>請把手機橫放<br><small>這個遊戲用橫向畫面玩</small></div>';
    document.body.appendChild(el);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // 能鎖就鎖（Android 全螢幕時有效）；不能鎖也沒關係，上面的提示會處理。
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
  } catch (e) { /* ignore */ }
})();

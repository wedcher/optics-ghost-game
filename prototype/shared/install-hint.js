/*
 * install-hint.js — 入口頁的「安裝」提示條（使用者 2026-11-17 指定：要自動跳出來，並說明不安裝也能玩）。
 *
 * - Android／桌機 Chrome：瀏覽器判定可以安裝時會送出 beforeinstallprompt。這裡攔下來，改顯示自己的提示條
 *   （才能放上自己的說明文字）；按「安裝」再叫出瀏覽器的安裝視窗。
 * - iPhone／iPad 的 Safari 沒有安裝視窗，只能教玩家用「分享 → 加入主畫面」，所以提示條只顯示做法。
 * - 已經從主畫面圖示開啟（standalone）時不顯示。按「先不用」只收起這一次，下次進入口頁還會出現。
 */
(function () {
  'use strict';
  var mm = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  if (navigator.standalone || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)')) return;

  var bar = null, deferred = null;
  function show(canPrompt) {
    if (bar) return;
    bar = document.createElement('div');
    bar.id = 'installHint';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', '安裝提示');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;flex-wrap:wrap;align-items:center;gap:10px;' +
      'padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:#1d1436;border-top:1px solid #b980ff;color:#e8ebff;' +
      'font-size:16px;line-height:1.5;box-shadow:0 -6px 24px rgba(0,0,0,.5)';
    var text = document.createElement('div');
    text.style.cssText = 'flex:1 1 220px;min-width:0';
    text.textContent = canPrompt
      ? '安裝體驗更好（全螢幕、沒有網址列）；不安裝也可以直接用瀏覽器玩。'
      : '安裝體驗更好（全螢幕、沒有網址列）：點 Safari 的「分享」→「加入主畫面」。不安裝也可以直接用瀏覽器玩。';
    bar.appendChild(text);
    function button(label, primary, onClick) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'flex:0 0 auto;min-width:88px;min-height:46px;padding:4px 16px;font:inherit;font-size:16px;color:#e8ebff;border-radius:10px;cursor:pointer;' +
        (primary ? 'background:#5b2a86;border:1px solid #b980ff;font-weight:600' : 'background:#232a4d;border:1px solid #3b4478');
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    }
    if (canPrompt) {
      button('安裝', true, function () {
        var d = deferred; deferred = null; hide();
        if (d && d.prompt) d.prompt();
      }).id = 'installYes';
    }
    button(canPrompt ? '先不用' : '知道了', false, hide).id = 'installNo';
    document.body.appendChild(bar);
  }
  function hide() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }

  window.addEventListener('beforeinstallprompt', function (e) {
    if (e.preventDefault) e.preventDefault(); // 不用瀏覽器內建的小提示，改用上面這一條
    deferred = e;
    show(true);
  });
  window.addEventListener('appinstalled', hide);

  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    if (document.body) show(false); else document.addEventListener('DOMContentLoaded', function () { show(false); });
  }
})();

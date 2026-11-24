/*
 * install-hint.js — 「安裝到手機」提示（使用者 2026-11-17 指定要說明不安裝也能玩；2026-11-21 改成只在第一次自動跳）。
 *
 * - Android／桌機 Chrome：瀏覽器判定可以安裝時會送出 beforeinstallprompt。這裡攔下來，改顯示自己的提示條；
 *   按「安裝」再叫出瀏覽器的安裝視窗。
 * - iPhone／iPad 的 Safari 沒有安裝視窗，只能教玩家用「分享 → 加入主畫面」。
 * - 自動跳出只有第一次（localStorage opticsGhost.installTip.v1）；之後從選單最下面的「安裝到手機」按鈕打開。
 * - 已經從主畫面圖示開啟（standalone／fullscreen）時不跳，選單也不顯示按鈕。
 * - 外框頁（game.html）裡：只有最外層那一頁收得到 beforeinstallprompt，所以由外框頁負責；
 *   框裡的選單直接用外框頁的 InstallHint（window.InstallHint 指向同一個）。
 *
 * window.InstallHint = { installed(), open() }：open() 能叫出安裝視窗就叫，不能就顯示做法。
 */
(function () {
  'use strict';
  try {
    if (window.top !== window && window.top.InstallHint && window.top.InstallHint.isHost) { window.InstallHint = window.top.InstallHint; return; }
  } catch (e) { /* 不同網域的外框：自己處理 */ }

  var KEY = 'opticsGhost.installTip.v1';
  var mm = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  var standalone = !!(navigator.standalone || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)'));
  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var bar = null, deferred = null;

  function seen() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
  function markSeen() { try { localStorage.setItem(KEY, '1'); } catch (e) { /* 無痕模式：下次可能再出現，沒關係 */ } }

  function show(mode) {
    hide();
    bar = document.createElement('div');
    bar.id = 'installHint';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', '安裝提示');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:600;display:flex;flex-wrap:wrap;align-items:center;gap:10px;' +
      'padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:#1d1436;border-top:1px solid #b980ff;color:#e8ebff;' +
      'font-family:system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;' +
      'font-size:16px;line-height:1.5;box-shadow:0 -6px 24px rgba(0,0,0,.5)';
    var text = document.createElement('div');
    text.style.cssText = 'flex:1 1 220px;min-width:0';
    if (mode === 'ios') {
      // 使用者 2026-11-24：字少一點，分享圖示用畫的（docs/ios-hint/share-icon.svg）
      text.innerHTML = 'iPhone：Safari → 分享圖示 ' +
        '<svg viewBox="0 0 48 48" width="26" height="26" fill="none" stroke="#5aa9ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="vertical-align:-6px" aria-hidden="true"><path d="M17 19h-4a2 2 0 0 0-2 2v19a2 2 0 0 0 2 2h22a2 2 0 0 0 2-2V21a2 2 0 0 0-2-2h-4"/>' +
        '<path d="M24 30V6"/><path d="M16 14l8-8 8 8"/></svg> → 加到主畫面' +
        '<div style="font-size:14px;opacity:.8">不安裝也能玩</div>';
    } else {
      text.textContent = mode === 'prompt'
        ? '安裝體驗更好（全螢幕、沒有網址列）；不安裝也可以直接用瀏覽器玩。'
        : '安裝體驗更好（全螢幕、沒有網址列）：打開瀏覽器的選單，選「安裝應用程式」或「加到主畫面」。不安裝也可以直接用瀏覽器玩。';
    }
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
    if (mode === 'prompt') button('安裝', true, prompt).id = 'installYes';
    button(mode === 'prompt' ? '先不用' : '知道了', false, hide).id = 'installNo';
    (document.body || document.documentElement).appendChild(bar);
  }
  function hide() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }
  function prompt() {
    var d = deferred; deferred = null; hide();
    if (d && d.prompt) { try { d.prompt(); } catch (e) { /* ignore */ } }
  }
  function whenReady(f) { if (document.body) f(); else document.addEventListener('DOMContentLoaded', f); }

  window.addEventListener('beforeinstallprompt', function (e) {
    if (e.preventDefault) e.preventDefault(); // 不用瀏覽器內建的小提示，改用自己的提示條
    deferred = e;
    if (!seen()) { markSeen(); whenReady(function () { show('prompt'); }); }
  });
  window.addEventListener('appinstalled', function () { deferred = null; hide(); });
  if (ios && !standalone && !seen()) { markSeen(); whenReady(function () { show('ios'); }); }

  window.InstallHint = {
    isHost: true,
    installed: function () { return standalone; },
    open: function () { if (deferred) show('prompt'); else show(ios ? 'ios' : 'manual'); }
  };
})();

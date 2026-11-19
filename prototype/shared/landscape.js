/*
 * landscape.js — 遊戲一律橫向遊玩（選單、排行榜、三關共用）。
 *
 * 2026-11-18 試玩回饋 G3／Q1：不管手機怎麼拿，畫面相對機身都是橫的。
 *   1. 手機直拿（觸控＋視窗高 > 寬）且網址沒有 ?portrait=1 時，把整個 <body> 轉 90° 顯示（固定順時針，待試玩）：
 *      body 的寬 = 螢幕高、高 = 螢幕寬，transform: translateX(螢幕寬) rotate(90deg)。
 *      <html> 加 class "gl-rot"，並設 CSS 變數 --gl-w／--gl-h（轉過之後「遊戲看到的」寬高）。
 *   2. 頁面上和寬高／方向有關的 @media 規則，轉向時改用「對調後的寬高」判斷
 *      （例如 (max-height:480px) 改看螢幕寬），所以各頁的橫向版面直接生效；動態加進來的 <style> 也會處理。
 *   3. 觸控座標換算：轉向後 getBoundingClientRect() 拿到的是轉過的外框、clientX/Y 的 x、y 對調。
 *      各頁一律用下面的共用函式，不要自己用 getBoundingClientRect／clientX／innerWidth 算位置：
 *        GameLandscape.toLocal(e, el)   事件（或 {clientX, clientY}）→ el 左上角為原點、遊戲方向的座標
 *        GameLandscape.size(el)         el 在遊戲方向的 { width, height }
 *        GameLandscape.toClient(p, el)  反過來：el 內的遊戲座標 → clientX/clientY（測試用來點畫面）
 *        GameLandscape.viewport()       遊戲方向的視窗 { width, height }
 *        GameLandscape.isRotated()
 *   4. Android 全螢幕時 screen.orientation.lock('landscape')（shared/fullscreen.js 進全螢幕之後呼叫 lock()）；
 *      manifest.webmanifest 的 "orientation": "landscape" 讓主畫面圖示開啟時由系統鎖橫向。鎖成功就不需要轉。
 *
 * 已知限制（PROJECT.md PENDING 19）：系統的東西不會跟著轉——鍵盤、confirm()／alert()、輸入框的選字窗；
 * iOS Safari 直拿時網址列在畫面側邊、可用高度會跳動。
 * 測試／開發：?portrait=1 關掉轉向（原本的直向 e2e 都帶這個參數）。
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var OFF = /[?&]portrait=1(&|$)/.test(location.search);
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var rotated = false, lastKey = '';

  function touchDevice() {
    return mm('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && mm('(hover: none)'));
  }
  function screenSize() {
    return { width: window.innerWidth || root.clientWidth, height: window.innerHeight || root.clientHeight };
  }

  var CSS =
    'html.gl-rot{height:100%;overflow:hidden;overscroll-behavior:none}' +
    'html.gl-rot body{position:fixed;top:0;left:0;margin:0;width:var(--gl-w);height:var(--gl-h);min-height:0;max-width:none;' +
    'transform-origin:0 0;transform:translateX(var(--gl-sw)) rotate(90deg);overflow:hidden}' +
    // 轉過的 body 本身當捲動容器時，手指捲不動（Chromium 實測）；選單、排行榜改由 <main> 捲動
    'html.gl-rot body>main{height:100%;box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
    'html.gl-rot #app{height:100%}';
  function injectCss() {
    if (document.getElementById('gl-css')) return;
    var s = document.createElement('style'); s.id = 'gl-css'; s.textContent = CSS;
    (document.head || root).appendChild(s);
  }

  // ---- @media：轉向時用對調後的寬高判斷 ----
  var ORIG = window.WeakMap ? new WeakMap() : null;
  var SWAP = { width: 'height', height: 'width', portrait: 'landscape', landscape: 'portrait' };
  function fixRules(rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.media && r.cssRules) {
        var orig = ORIG.get(r);
        if (orig == null) { orig = r.media.mediaText; ORIG.set(r, orig); }
        if (/width|height|orientation/.test(orig)) {
          var want = rotated ? (mm(orig.replace(/width|height|portrait|landscape/g, function (m) { return SWAP[m]; })) ? 'all' : 'not all') : orig;
          if (r.media.mediaText !== want) r.media.mediaText = want;
        }
        fixRules(r.cssRules);
      } else if (r.cssRules) {
        fixRules(r.cssRules);
      }
    }
  }
  function fixMedia() {
    if (!ORIG) return;
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; } // 跨網域的樣式表讀不到：略過
      if (rules) fixRules(rules);
    }
  }

  function sync() {
    var s = screenSize();
    var want = !OFF && touchDevice() && s.height > s.width;
    var key = want + ':' + s.width + 'x' + s.height;
    if (key === lastKey) return;
    lastKey = key;
    rotated = want;
    if (want) {
      injectCss();
      root.style.setProperty('--gl-sw', s.width + 'px');
      root.style.setProperty('--gl-sh', s.height + 'px');
      root.style.setProperty('--gl-w', s.height + 'px');
      root.style.setProperty('--gl-h', s.width + 'px');
      root.classList.add('gl-rot');
    } else {
      root.classList.remove('gl-rot');
      ['--gl-sw', '--gl-sh', '--gl-w', '--gl-h'].forEach(function (k) { root.style.removeProperty(k); });
    }
    fixMedia();
    try { window.dispatchEvent(new Event('gamelandscape')); } catch (e) { /* ignore */ }
  }

  function pt(e) {
    var t = e && e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  window.GameLandscape = {
    isRotated: function () { return rotated; },
    toLocal: function (e, el) {
      var c = pt(e), r = el.getBoundingClientRect();
      return rotated ? { x: c.y - r.top, y: r.right - c.x } : { x: c.x - r.left, y: c.y - r.top };
    },
    size: function (el) {
      var r = el.getBoundingClientRect();
      return rotated ? { width: r.height, height: r.width } : { width: r.width, height: r.height };
    },
    toClient: function (p, el) {
      var r = el.getBoundingClientRect();
      return rotated ? { x: r.right - p.y, y: r.top + p.x } : { x: r.left + p.x, y: r.top + p.y };
    },
    viewport: function () {
      var s = screenSize();
      return rotated ? { width: s.height, height: s.width } : s;
    },
    sync: sync,
    lock: function () {
      try {
        if (screen.orientation && screen.orientation.lock) {
          var p = screen.orientation.lock('landscape');
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) { /* 不支援（iOS 等）：不影響遊玩 */ }
    }
  };

  sync();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', function () { sync(); setTimeout(sync, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', sync);
  document.addEventListener('DOMContentLoaded', function () { lastKey = ''; sync(); });
  // 動態加進來的 <style>（過場、排行榜結算）：轉向時也要改寫它們的 @media
  if (window.MutationObserver) {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        for (var j = 0; j < list[i].addedNodes.length; j++) {
          var n = list[i].addedNodes[j];
          if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') { if (rotated) fixMedia(); return; }
        }
      }
    }).observe(document.head || root, { childList: true });
  }
  window.GameLandscape.lock();
})();

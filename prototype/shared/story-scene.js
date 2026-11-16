/*
 * story-scene.js — 過場對話畫面（三關的開場、過關演出、失敗畫面共用）。
 *
 * 全螢幕背景圖 + 下方一條對話框；一次一句，點畫面任何地方換下一句；右上角「跳過」。
 * 最後一句之後，對話框換成置中的結尾面板（標題、說明、大按鈕）。
 * 沒有台詞（lines 為空）時直接顯示結尾面板——失敗畫面就是這樣用。
 * 樣式是 docs/story-and-flow.md「過場對話畫面」的建議稿，尚未定案。
 *
 * 用法：
 *   var scene = StoryScene.show({
 *     id: 'intro',                         // 寫到 data-scene，方便測試與除錯
 *     background: 'assets/xxx.webp',       // 可省略
 *     lines: [{ speaker: '你', text: '……' }, { text: '沒有 speaker 的是旁白' }],
 *     title: '…', note: '…',               // 結尾面板的標題與說明，都可省略
 *     buttons: [{ id: 'startBtn', label: '開始抓鬼', primary: true, onClick: fn, href: '…' }],
 *     scatter: 6                           // 開場時有幾隻 placeholder 鬼往四周逃散（過關演出用）
 *   });
 *   scene.close();
 *
 * 這個元件不知道任何關卡資料，畫面上不會出現和鬼的位置有關的東西。
 */
(function (root) {
  'use strict';

  var ARM_MS = 350; // 結尾按鈕出現後這段時間內不接受點擊，避免連點換句時誤觸
  var CSS =
    '.story{position:fixed;inset:0;z-index:500;overflow:hidden;background:#07080f;color:#e8ebff;' +
    'font-family:system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;' +
    'user-select:none;-webkit-user-select:none;touch-action:manipulation;cursor:pointer}' +
    '.story-bg{position:absolute;inset:0;background-size:cover;background-position:center}' +
    '.story-shade{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,8,18,.25),rgba(6,8,18,.15) 45%,rgba(6,8,18,.78))}' +
    '.story.ended .story-shade{background:rgba(6,8,18,.66)}' +
    '.story-skip{position:absolute;top:10px;right:10px;min-width:72px;min-height:46px;padding:4px 14px;font:inherit;font-size:15px;' +
    'color:#e8ebff;background:rgba(23,27,51,.82);border:1px solid #3b4478;border-radius:10px;cursor:pointer}' +
    '.story-dialog{position:absolute;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);' +
    'width:min(94%,720px);min-height:92px;padding:22px 18px 26px;background:rgba(14,16,34,.86);border:1px solid #6d5aa8;border-radius:14px}' +
    '.story-speaker{position:absolute;left:14px;top:-15px;padding:3px 14px;font-size:14px;font-weight:600;color:#201500;' +
    'background:#ffd166;border-radius:999px}' +
    '.story-text{margin:0;font-size:19px;line-height:1.55}' +
    '.story-hint{position:absolute;right:14px;bottom:6px;font-size:12px;color:#9aa3cf;animation:storyBlink 1.4s ease-in-out infinite}' +
    '.story-end{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92%,520px);text-align:center;cursor:default}' +
    '.story-end h2{margin:0 0 8px;font-size:26px;text-shadow:0 2px 12px #000}' +
    '.story-end p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#cfd5f5;text-shadow:0 1px 8px #000}' +
    '.story-buttons{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}' +
    '.story-buttons .story-btn{display:inline-flex;align-items:center;justify-content:center;min-width:150px;min-height:56px;padding:8px 22px;' +
    'font:inherit;font-size:18px;color:#e8ebff;background:rgba(35,42,77,.94);border:1px solid #3b4478;border-radius:14px;' +
    'text-decoration:none;cursor:pointer}' +
    '.story-buttons .story-btn.primary{background:#5b2a86;border-color:#b980ff;font-weight:600;font-size:21px;min-width:200px;min-height:62px;' +
    'box-shadow:0 0 22px rgba(176,96,255,.55)}' +
    '.story-fx{position:absolute;inset:0;pointer-events:none}' +
    '.story-ghost{position:absolute;left:50%;top:52%;width:34px;height:46px;margin:-23px 0 0 -17px;background:#9dffd8;' +
    'border-radius:50% 50% 22% 22% / 58% 58% 16% 16%;box-shadow:0 0 16px rgba(120,255,200,.9);opacity:0;' +
    'animation:storyFlee 1.7s cubic-bezier(.3,.1,.6,1) forwards}' +
    '.story-ghost::before,.story-ghost::after{content:"";position:absolute;top:14px;width:6px;height:9px;border-radius:50%;background:#0d1020}' +
    '.story-ghost::before{left:8px}.story-ghost::after{right:8px}' +
    '@keyframes storyFlee{0%{opacity:0;transform:translate(0,0) scale(.6)}18%{opacity:1}' +
    '100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1.5)}}' +
    '@keyframes storyBlink{0%,100%{opacity:.35}50%{opacity:1}}' +
    '@media (max-height:480px){.story-dialog{min-height:76px;padding:18px 16px 22px}.story-text{font-size:17px}' +
    '.story-end h2{font-size:22px}.story-end p{margin-bottom:12px;font-size:14px}}' +
    '@media (prefers-reduced-motion:reduce){.story-ghost{animation-duration:.01s}.story-hint{animation:none}}' +
    '.story [hidden]{display:none !important}';

  var cssDone = false;
  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function show(opts) {
    injectCss();
    var lines = opts.lines || [];
    var idx = 0, ended = false, armedAt = 0, closed = false;

    var rootEl = el('div', 'story');
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    if (opts.id) rootEl.setAttribute('data-scene', opts.id);
    var bg = el('div', 'story-bg');
    if (opts.background) bg.style.backgroundImage = 'url("' + opts.background + '")';
    rootEl.appendChild(bg);
    rootEl.appendChild(el('div', 'story-shade'));
    var fx = el('div', 'story-fx');
    rootEl.appendChild(fx);

    var dialog = el('div', 'story-dialog');
    var speaker = el('span', 'story-speaker');
    var text = el('p', 'story-text');
    text.setAttribute('aria-live', 'polite');
    dialog.appendChild(speaker); dialog.appendChild(text);
    dialog.appendChild(el('span', 'story-hint', '點畫面繼續 ▼'));
    rootEl.appendChild(dialog);

    var skip = el('button', 'story-skip', '跳過');
    skip.type = 'button';
    rootEl.appendChild(skip);

    var end = el('div', 'story-end');
    if (opts.title) end.appendChild(el('h2', null, opts.title));
    if (opts.note) end.appendChild(el('p', null, opts.note));
    var btnRow = el('div', 'story-buttons');
    (opts.buttons || []).forEach(function (b) {
      var be = el(b.href ? 'a' : 'button', 'story-btn' + (b.primary ? ' primary' : ''), b.label);
      if (b.href) be.href = b.href; else be.type = 'button';
      if (b.id) be.id = b.id;
      be.addEventListener('click', function (e) {
        e.stopPropagation();
        if (performance.now() < armedAt) { e.preventDefault(); return; }
        if (b.onClick) b.onClick();
      });
      btnRow.appendChild(be);
    });
    end.appendChild(btnRow);
    end.hidden = true;
    rootEl.appendChild(end);

    function showLine() {
      var l = lines[idx];
      speaker.hidden = !l.speaker;
      speaker.textContent = l.speaker || '';
      text.textContent = l.text;
    }
    function showEnd() {
      if (ended) return;
      ended = true; armedAt = performance.now() + ARM_MS;
      dialog.hidden = true; skip.hidden = true; end.hidden = false;
      rootEl.classList.add('ended');
      rootEl.style.cursor = 'default';
    }
    function advance() {
      if (ended || closed) return;
      idx++;
      if (idx >= lines.length) showEnd(); else showLine();
    }
    rootEl.addEventListener('click', advance);
    skip.addEventListener('click', function (e) { e.stopPropagation(); showEnd(); });

    for (var i = 0; i < (opts.scatter || 0); i++) {
      var g = el('div', 'story-ghost'), ang = (i / opts.scatter) * Math.PI * 2 + 0.4;
      g.style.setProperty('--dx', Math.round(Math.cos(ang) * 60) + 'vw');
      g.style.setProperty('--dy', Math.round(Math.sin(ang) * 60) + 'vh');
      g.style.animationDelay = (i * 0.07).toFixed(2) + 's';
      fx.appendChild(g);
    }

    if (lines.length) showLine(); else showEnd();
    document.body.appendChild(rootEl);

    return {
      el: rootEl,
      close: function () { if (closed) return; closed = true; if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl); },
      skip: showEnd,
      info: function () { return { id: opts.id || null, line: ended ? -1 : idx, ended: ended, armed: ended && performance.now() >= armedAt, closed: closed }; }
    };
  }

  root.StoryScene = { show: show, ARM_MS: ARM_MS };
})(window);

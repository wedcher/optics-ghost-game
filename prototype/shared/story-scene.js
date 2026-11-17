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
 *     scatter: 6,                          // 開場時有幾隻 placeholder 鬼往四周逃散（過關演出用）
 *     overlay: true,                       // 疊在遊戲畫面上（背景透明、只壓暗一點），遊戲中途的小段對話用
 *     onDone: fn                           // 沒有結尾面板（沒有 title／note／buttons）時：最後一句或「跳過」後自動關閉並呼叫
 *   });
 *   每一句還可以帶：
 *     background: 'url' 或 'black'         // 從這句起換背景（換背景時信件會收起）
 *     letter: '……'                        // 這句是信上的字：疊在畫面中央的信紙上、逐句累加，對話框先收起
 *     image: 'url'                         // 對話框左邊附一張小圖（例如道具）
 *     scatter: 8                           // 這句出現時才讓 placeholder 鬼逃散
 *     onShow: fn                           // 這句出現時呼叫（音效用）
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
    '.story-bg{position:absolute;inset:0;background-size:cover;background-position:center;transition:background-image .35s}' +
    '.story.overlay{background:transparent}.story.overlay .story-shade{background:linear-gradient(to bottom,rgba(6,8,18,0),rgba(6,8,18,.1) 50%,rgba(6,8,18,.6))}' +
    '.story-letter{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%) rotate(-1.2deg);width:min(86%,520px);padding:22px 24px 30px;' +
    'background:rgba(238,226,196,.94);color:#2b1d0e;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.6);' +
    'font-family:"Noto Serif TC","PMingLiU","MingLiU",serif;font-size:19px;line-height:1.7}' +
    '.story-letter p{margin:0 0 6px;animation:storyInk .7s ease-out}' +
    '.story-letter .story-hint{color:#7a6340}' +
    '.story-dialog.has-img{padding-left:96px}' +
    '.story-img{position:absolute;left:12px;top:50%;width:72px;height:72px;margin-top:-36px;object-fit:contain;' +
    'background:rgba(255,255,255,.06);border-radius:10px}' +
    '@keyframes storyInk{from{opacity:0;filter:blur(2px)}to{opacity:1;filter:none}}' +
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
    '.story-letter{top:40%;padding:14px 18px 24px;font-size:17px;line-height:1.55}.story-dialog.has-img{padding-left:84px}' +
    '.story-img{width:60px;height:60px;margin-top:-30px}' +
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
    var idx = 0, ended = false, armedAt = 0, closed = false, pressed = false;

    var rootEl = el('div', 'story');
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    if (opts.id) rootEl.setAttribute('data-scene', opts.id);
    if (opts.overlay) rootEl.classList.add('overlay');
    var bg = el('div', 'story-bg'), bgNow = null;
    rootEl.appendChild(bg);
    rootEl.appendChild(el('div', 'story-shade'));
    var fx = el('div', 'story-fx');
    rootEl.appendChild(fx);

    var letter = el('div', 'story-letter');
    letter.hidden = true;
    rootEl.appendChild(letter);

    var dialog = el('div', 'story-dialog');
    var pic = el('img', 'story-img');
    pic.alt = ''; pic.hidden = true;
    dialog.appendChild(pic);
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

    var hasEnd = !!(opts.title || opts.note || (opts.buttons && opts.buttons.length));
    function setBg(b) {
      if (!b || b === bgNow) return;
      if (bgNow) { letter.hidden = true; letter.textContent = ''; } // 換場景：信收起來
      bgNow = b;
      bg.style.backgroundImage = b === 'black' ? 'none' : 'url("' + b + '")';
    }
    function scatterGhosts(n) {
      for (var i = 0; i < n; i++) {
        var g = el('div', 'story-ghost'), ang = (i / n) * Math.PI * 2 + 0.4;
        g.style.setProperty('--dx', Math.round(Math.cos(ang) * 60) + 'vw');
        g.style.setProperty('--dy', Math.round(Math.sin(ang) * 60) + 'vh');
        g.style.animationDelay = (i * 0.07).toFixed(2) + 's';
        fx.appendChild(g);
      }
    }
    function showLine() {
      var l = lines[idx];
      setBg(l.background);
      if (l.letter != null) {
        // 信上的字：一句一句加到信紙上，前面的字留著
        dialog.hidden = true;
        letter.hidden = false;
        var old = letter.querySelector('.story-hint');
        if (old) letter.removeChild(old);
        letter.appendChild(el('p', null, l.letter));
        letter.appendChild(el('span', 'story-hint', '點畫面繼續 ▼'));
      } else {
        var oldHint = letter.querySelector('.story-hint');
        if (oldHint) letter.removeChild(oldHint);
        dialog.hidden = false;
        speaker.hidden = !l.speaker;
        speaker.textContent = l.speaker || '';
        text.textContent = l.text;
        pic.hidden = !l.image;
        if (l.image) pic.src = l.image; else pic.removeAttribute('src');
        dialog.classList.toggle('has-img', !!l.image);
      }
      if (l.scatter) scatterGhosts(l.scatter);
      if (l.onShow) { try { l.onShow(); } catch (e) { /* 音效失敗不影響過場 */ } }
    }
    function finish() {
      // 沒有結尾面板：直接關掉，交回給呼叫的人
      ended = true; closed = true;
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      if (opts.onDone) opts.onDone();
    }
    function showEnd() {
      if (ended) return;
      if (!hasEnd) { finish(); return; }
      ended = true; armedAt = performance.now() + ARM_MS;
      if (opts.background) setBg(opts.background); // 跳過時也回到這段的主背景（結尾面板用）
      letter.hidden = true;
      dialog.hidden = true; skip.hidden = true; end.hidden = false;
      rootEl.classList.add('ended');
      rootEl.style.cursor = 'default';
    }
    function advance() {
      if (ended || closed) return;
      // 只算「在過場上按下去」的點擊：叫出過場的那一下（例如遊戲中點地板）放開後，瀏覽器還會送一個 click 到剛蓋上來的過場
      if (!pressed) return;
      idx++;
      if (idx >= lines.length) showEnd(); else showLine();
    }
    rootEl.addEventListener('pointerdown', function () { pressed = true; });
    rootEl.addEventListener('click', advance);
    skip.addEventListener('click', function (e) { e.stopPropagation(); showEnd(); });

    if (opts.scatter) scatterGhosts(opts.scatter);

    setBg((lines[0] && lines[0].background) || opts.background);
    document.body.appendChild(rootEl);
    if (lines.length) showLine(); else showEnd();

    return {
      el: rootEl,
      close: function () { if (closed) return; closed = true; if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl); },
      skip: showEnd,
      info: function () { return { id: opts.id || null, line: ended ? -1 : idx, ended: ended, armed: ended && performance.now() >= armedAt, closed: closed,
        letter: !letter.hidden, image: !pic.hidden && !dialog.hidden, bg: bgNow === 'black' ? 'black' : bgNow ? 'image' : null }; }
    };
  }

  root.StoryScene = { show: show, ARM_MS: ARM_MS };
})(window);

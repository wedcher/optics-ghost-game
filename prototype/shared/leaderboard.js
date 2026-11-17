/*
 * leaderboard.js — 趕鬼計時、成績上傳、排行榜讀取、結算畫面（三關共用）。
 * 規則（PROJECT.md CONFIRMED、docs/leaderboard.md）：
 *   - 兩個榜：castle＝趕鬼時間（第一關開始到第二關結束，牆上時間，愈短愈好）；
 *             hunt＝荒野 5 分鐘封印數（愈多愈好）。荒野練習模式不計。
 *   - 趕鬼時間是牆上時間：過場、失敗重來都算、不歸零；只有「重新開始遊戲」(restartRun) 會清掉。
 *   - 每個暱稱只留最佳成績；顯示前 10 名。
 *   - 有 window.LEADERBOARD_URL（Apps Script）就用共用排行；沒有就存本機 localStorage。
 *
 * 各關要呼叫的地方（目前還沒接上，見 docs/leaderboard.md「接進各關」）：
 *   第一關關卡模式開始時       Leaderboard.startRun()
 *   第二關抓滿 5 隻過關時      Leaderboard.finishCastle()      → 回傳毫秒（沒有開始紀錄則 null）
 *   荒野狩獵（正式）結束時     Leaderboard.recordHunt(n)；Leaderboard.showResult({ onClose })
 *   選單「重新開始遊戲」       Leaderboard.restartRun()
 *
 * 這個檔不知道任何鬼的位置。
 */
(function (root) {
  'use strict';

  var TOP = 10, NAME_MAX = 10;
  var RUN_KEY = 'ogg.run.v1', NAME_KEY = 'ogg.nickname.v1', LOCAL_KEY = 'ogg.leaderboard.local.v1';
  var BOARDS = {
    castle: { asc: true,  min: 30 * 1000, max: 24 * 3600 * 1000 },
    hunt:   { asc: false, min: 0,         max: 60 }
  };
  var now = function () { return Date.now(); };

  function load(key, fallback) {
    try { var s = root.localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, v) {
    try { if (v === null) root.localStorage.removeItem(key); else root.localStorage.setItem(key, JSON.stringify(v)); }
    catch (e) { /* 私密模式等：不影響遊玩 */ }
  }
  function url() { return (root.LEADERBOARD_URL || '').trim(); }

  // ---------- 趕鬼計時（牆上時間） ----------
  // run = { startedAt, castleMs|null, hunt|null, submitted:{castle,hunt} }
  function getRun() { return load(RUN_KEY, null); }
  function startRun() {
    var r = getRun();
    if (r && r.startedAt) return r;          // 失敗重來、重新整理：不歸零
    r = { startedAt: now(), castleMs: null, hunt: null };
    save(RUN_KEY, r);
    return r;
  }
  function restartRun() { save(RUN_KEY, null); }
  function finishCastle() {
    var r = getRun();
    if (!r || !r.startedAt) return null;     // 沒從第一關開始（例如直接開第二關網址）就不算成績
    if (r.castleMs == null) { r.castleMs = Math.max(0, now() - r.startedAt); save(RUN_KEY, r); }
    return r.castleMs;
  }
  function recordHunt(n) {
    var r = getRun() || { startedAt: null, castleMs: null };
    r.hunt = Math.max(0, Math.floor(n));
    save(RUN_KEY, r);
    return r;
  }

  function formatTime(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    var s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (h) return h + ' 小時 ' + m + ' 分 ' + sec + ' 秒';
    if (m) return m + ' 分 ' + sec + ' 秒';
    return sec + ' 秒';
  }

  // ---------- 暱稱 ----------
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, NAME_MAX).join('').trim();
  }
  function getNickname() { return load(NAME_KEY, ''); }
  function setNickname(n) { save(NAME_KEY, cleanName(n)); }

  function validValue(key, v) {
    var b = BOARDS[key];
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= b.min && v <= b.max;
  }

  // ---------- 本機排行（沒有 LEADERBOARD_URL 時；與 backend/leaderboard/Code.gs 同規則） ----------
  function sortBoard(key, list) {
    var asc = BOARDS[key].asc;
    return list.slice().sort(function (a, b) {
      if (a.value !== b.value) return asc ? a.value - b.value : b.value - a.value;
      return a.at - b.at;
    });
  }
  function localSubmit(name, entries) {
    var db = load(LOCAL_KEY, { castle: [], hunt: [] });
    var out = { ok: true, castle: null, hunt: null };
    Object.keys(entries).forEach(function (key) {
      var list = db[key] || (db[key] = []), value = entries[key], t = now(), improved = false;
      var mine = list.filter(function (r) { return r.name === name; })[0];
      if (!mine) { mine = { name: name, value: value, at: t }; list.push(mine); improved = true; }
      else if (BOARDS[key].asc ? value < mine.value : value > mine.value) { mine.value = value; mine.at = t; improved = true; }
      var s = sortBoard(key, list);
      out[key] = { rank: s.indexOf(mine) + 1, best: mine.value, improved: improved };
    });
    save(LOCAL_KEY, db);
    return out;
  }
  function localTop() {
    var db = load(LOCAL_KEY, { castle: [], hunt: [] });
    return { ok: true, castle: sortBoard('castle', db.castle || []).slice(0, TOP), hunt: sortBoard('hunt', db.hunt || []).slice(0, TOP) };
  }

  // ---------- 對外：上傳／讀取 ----------
  // 回傳 Promise<{ok, castle:{rank,best,improved}|null, hunt:..., mode, error?}>
  function submit(opts) {
    var name = cleanName(opts && opts.name);
    if (!name) return Promise.resolve({ ok: false, error: '請輸入暱稱' });
    var entries = {};
    if (opts.castleMs != null) {
      var c = Math.round(opts.castleMs);
      if (!validValue('castle', c)) return Promise.resolve({ ok: false, error: '趕鬼時間不合理，沒有上傳' });
      entries.castle = c;
    }
    if (opts.hunt != null) {
      if (!validValue('hunt', opts.hunt)) return Promise.resolve({ ok: false, error: '封印數不合理，沒有上傳' });
      entries.hunt = opts.hunt;
    }
    if (!Object.keys(entries).length) return Promise.resolve({ ok: false, error: '沒有可上傳的成績' });
    setNickname(name);
    if (!url()) { var r = localSubmit(name, entries); r.mode = 'local'; return Promise.resolve(r); }
    var body = { name: name };
    if (entries.castle != null) body.castleMs = entries.castle;
    if (entries.hunt != null) body.hunt = entries.hunt;
    // text/plain：不觸發 CORS preflight（Apps Script 不回應 OPTIONS）
    return fetch(url(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json(); })
      .then(function (j) { j.mode = 'remote'; if (!j.ok) j.error = '上傳失敗（' + (j.error || '未知') + '）'; return j; })
      .catch(function () { return { ok: false, mode: 'remote', error: '連不上排行榜，請檢查網路後再試' }; });
  }
  // 回傳 Promise<{ok, castle:[{name,value,at}], hunt:[...], mode, error?}>
  function fetchTop() {
    if (!url()) { var r = localTop(); r.mode = 'local'; return Promise.resolve(r); }
    return fetch(url() + (url().indexOf('?') < 0 ? '?' : '&') + 'action=top&t=' + now())
      .then(function (res) { return res.json(); })
      .then(function (j) { j.mode = 'remote'; return j; })
      .catch(function () { return { ok: false, mode: 'remote', castle: [], hunt: [], error: '連不上排行榜' }; });
  }

  // ---------- 結算畫面（荒野狩獵結束後） ----------
  var CSS =
    '.lb-ov{position:fixed;inset:0;z-index:600;display:flex;align-items:center;justify-content:center;padding:12px 16px;' +
    'background:rgba(6,8,18,.86);color:#e8ebff;font-family:system-ui,-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}' +
    '.lb-card{width:min(100%,560px);max-height:100%;overflow:auto;padding:18px 18px 16px;background:#171b33;border:1px solid #6d5aa8;border-radius:16px;text-align:center}' +
    '.lb-card h2{margin:0 0 8px;font-size:22px}' +
    '.lb-sum{margin:0 0 14px;font-size:17px;line-height:1.6}.lb-sum b{color:#ffd166}' +
    '.lb-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:0 0 10px}' +
    '.lb-card input{flex:1 1 180px;min-width:0;max-width:280px;min-height:50px;padding:6px 14px;font:inherit;font-size:18px;color:#e8ebff;' +
    'background:#0d1020;border:1px solid #3b4478;border-radius:12px}' +
    '.lb-btn{display:inline-flex;align-items:center;justify-content:center;min-width:120px;min-height:52px;padding:6px 18px;font:inherit;font-size:17px;' +
    'color:#e8ebff;background:#232a4d;border:1px solid #3b4478;border-radius:12px;cursor:pointer;text-decoration:none}' +
    '.lb-btn.primary{background:#5b2a86;border-color:#b980ff;font-weight:600}' +
    '.lb-btn:disabled{opacity:.5}' +
    '.lb-msg{min-height:1.5em;margin:4px 0 10px;font-size:15px;color:#cfd5f5}.lb-msg.err{color:#ff8a8a}' +
    '.lb-note{margin:6px 0 0;font-size:13px;color:#9aa3cf}';
  function injectCss() {
    if (document.getElementById('lb-css')) return;
    var st = document.createElement('style'); st.id = 'lb-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function rankText(res) {
    var parts = [];
    if (res.castle) parts.push('趕鬼時間第 ' + res.castle.rank + ' 名' + (res.castle.improved ? '' : '（沒有超過你之前的 ' + formatTime(res.castle.best) + '）'));
    if (res.hunt) parts.push('荒野封印第 ' + res.hunt.rank + ' 名' + (res.hunt.improved ? '' : '（沒有超過你之前的 ' + res.hunt.best + ' 隻）'));
    return parts.join('；');
  }

  // opts: { castleMs?, hunt?（省略則取本輪紀錄）, leaderboardHref?, onClose? }
  function showResult(opts) {
    opts = opts || {};
    injectCss();
    var run = getRun() || {};
    var castleMs = opts.castleMs !== undefined ? opts.castleMs : run.castleMs;
    var hunt = opts.hunt !== undefined ? opts.hunt : run.hunt;
    var ov = el('div', { 'class': 'lb-ov', id: 'lbResult', role: 'dialog', 'aria-modal': 'true' });
    var card = el('div', { 'class': 'lb-card' });
    card.appendChild(el('h2', null, '結算'));
    var sum = el('p', { 'class': 'lb-sum', id: 'lbSummary' });
    sum.appendChild(document.createTextNode('你花費 '));
    sum.appendChild(el('b', null, castleMs != null ? formatTime(castleMs) : '—'));
    sum.appendChild(document.createTextNode(' 把鬼趕出城堡，並在荒野中封印了 '));
    sum.appendChild(el('b', null, hunt != null ? String(hunt) : '—'));
    sum.appendChild(document.createTextNode(' 隻鬼。'));
    card.appendChild(sum);
    if (castleMs == null) card.appendChild(el('p', { 'class': 'lb-note' }, '這一輪不是從第一關開始玩的，趕鬼時間不列入排行。'));

    var row = el('div', { 'class': 'lb-row' });
    var input = el('input', { id: 'lbName', type: 'text', maxlength: String(NAME_MAX * 2), placeholder: '暱稱（最多 ' + NAME_MAX + ' 字）', autocomplete: 'nickname', enterkeyhint: 'send' });
    input.value = getNickname();
    var send = el('button', { 'class': 'lb-btn primary', id: 'lbSubmit', type: 'button' }, '留名上榜');
    row.appendChild(input); row.appendChild(send); card.appendChild(row);
    var msg = el('p', { 'class': 'lb-msg', id: 'lbMsg', 'aria-live': 'polite' });
    card.appendChild(msg);
    var row2 = el('div', { 'class': 'lb-row' });
    var view = el('a', { 'class': 'lb-btn', id: 'lbView', href: opts.leaderboardHref || '../leaderboard.html' }, '看排行榜');
    var close = el('button', { 'class': 'lb-btn', id: 'lbClose', type: 'button' }, '不留名，關閉');
    row2.appendChild(view); row2.appendChild(close); card.appendChild(row2);
    card.appendChild(el('p', { 'class': 'lb-note' }, url() ? '每個暱稱只保留最好的成績。' : '目前還沒連上共用排行榜，成績只存在這支手機。'));
    ov.appendChild(card);
    document.body.appendChild(ov);

    var payload = { castleMs: castleMs != null ? castleMs : null, hunt: hunt != null ? hunt : null };
    function doSend() {
      if (send.disabled) return;
      send.disabled = true; msg.className = 'lb-msg'; msg.textContent = '上傳中…';
      submit({ name: input.value, castleMs: payload.castleMs, hunt: payload.hunt }).then(function (res) {
        if (!res.ok) { msg.className = 'lb-msg err'; msg.textContent = res.error; send.disabled = false; return; }
        msg.textContent = '已上榜：' + rankText(res);
        send.textContent = '已送出';
        close.textContent = '關閉';
      });
    }
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });
    input.addEventListener('input', function () { if (msg.className.indexOf('err') >= 0) { msg.className = 'lb-msg'; msg.textContent = ''; } });
    close.addEventListener('click', function () { ov.remove(); if (opts.onClose) opts.onClose(); });
    return { el: ov, close: function () { ov.remove(); } };
  }

  root.Leaderboard = {
    TOP: TOP, NAME_MAX: NAME_MAX, BOARDS: BOARDS,
    isShared: function () { return !!url(); },
    startRun: startRun, restartRun: restartRun, finishCastle: finishCastle, recordHunt: recordHunt, getRun: getRun,
    formatTime: formatTime, cleanName: cleanName, getNickname: getNickname, setNickname: setNickname,
    submit: submit, fetchTop: fetchTop, showResult: showResult,
    _setNow: function (fn) { now = fn; } // 測試用
  };
})(window);

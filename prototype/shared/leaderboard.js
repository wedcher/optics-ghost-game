/*
 * leaderboard.js — 趕鬼計時、成績上傳、排行榜讀取、結算畫面（三關共用）。
 * 規則（PROJECT.md CONFIRMED、docs/leaderboard.md）：
 *   - 兩個榜：castle＝趕鬼時間（愈短愈好）；hunt＝荒野 5 分鐘封印數（愈多愈好）。練習模式不計。
 *   - 趕鬼時間（使用者 2026-11-18 定案）＝第一關「最後一次過關」的成績＋第二關「最後一次過關」的成績。
 *     一次挑戰的成績＝按「開始抓鬼」起到過關為止的遊玩時間；關卡中的劇情過場（pauseLevel/resumeLevel 之間）不算。
 *     命用完（cancelLevel）、中途離開頁面（挑戰只存在記憶體，換頁就消失）的那一次不算。
 *     再玩一次過關 → 取代那一關的舊成績；沒過關 → 保留上次過關的成績。兩關都有成績才有趕鬼時間。
 *     只有「重新開始遊戲」(restartRun) 會清掉兩關成績。
 *   - 每個暱稱只留最佳成績；顯示前 10 名。
 *   - 有 window.LEADERBOARD_URL（Apps Script）就用共用排行；沒有就存本機 localStorage。
 *
 * 各關要呼叫的地方（第一關、第二關、選單已接上；荒野狩獵尚未實作）：
 *   第一、二關按「開始抓鬼」／重新挑戰／再玩一次   Leaderboard.startLevel('mirror' | 'convex')
 *   關卡中的劇情過場出現／結束                     Leaderboard.pauseLevel() / Leaderboard.resumeLevel()
 *   命用完（失敗畫面）                             Leaderboard.cancelLevel()
 *   第一關過關時               Leaderboard.finishMirror()      → 回傳這次的毫秒
 *   第二關抓滿 5 隻過關時      Leaderboard.finishCastle()      → 回傳兩關相加的趕鬼時間（缺第一關成績則 null）
 *   荒野狩獵（正式）結束時     Leaderboard.recordHunt(n)；Leaderboard.showResult({ onClose })
 *   選單「重新開始遊戲」       Leaderboard.restartRun()
 *
 * 這個檔不知道任何鬼的位置。
 */
(function (root) {
  'use strict';

  var TOP = 10, NAME_MAX_W = 20;
  // run.v1 是舊規則（牆上時間）的紀錄，意義不同，不沿用；restartRun 時順便刪掉。
  var OLD_RUN_KEY = 'ogg.run.v1', RUN_KEY = 'ogg.run.v2', NAME_KEY = 'ogg.nickname.v1', LOCAL_KEY = 'ogg.leaderboard.local.v1';
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

  // ---------- 趕鬼計時（兩關最後一次過關成績相加） ----------
  // 存起來的 run = { mirrorMs|null, convexMs|null, castleMs|null, hunt|null }；castleMs 永遠是 mirrorMs+convexMs（兩個都有才有）。
  // 進行中的這一次挑戰只放記憶體（attempt）：重新整理／回選單＝放棄這一次，不留下任何時間。
  var attempt = null; // { level, acc, since|null }  since=null 表示暫停中（劇情過場）
  function getRun() { return load(RUN_KEY, null); }
  function emptyRun() { return { mirrorMs: null, convexMs: null, castleMs: null, hunt: null }; }
  function withCastle(r) {
    r.castleMs = (r.mirrorMs != null && r.convexMs != null) ? r.mirrorMs + r.convexMs : null;
    return r;
  }
  function startLevel(level) { attempt = { level: level, acc: 0, since: now() }; return attempt; }
  function pauseLevel() { if (attempt && attempt.since != null) { attempt.acc += Math.max(0, now() - attempt.since); attempt.since = null; } }
  function resumeLevel() { if (attempt && attempt.since == null) attempt.since = now(); }
  function cancelLevel() { attempt = null; }
  function levelElapsed() {
    if (!attempt) return null;
    return attempt.acc + (attempt.since != null ? Math.max(0, now() - attempt.since) : 0);
  }
  // 結束這一次挑戰並記成那一關的成績（取代舊成績）。沒有進行中的挑戰（自由練習、練習模式、沒按開始）→ null、不改紀錄。
  function finishLevel(level) {
    if (!attempt || attempt.level !== level) return null;
    var ms = Math.round(levelElapsed());
    attempt = null;
    var r = getRun() || emptyRun();
    r[level + 'Ms'] = ms;
    save(RUN_KEY, withCastle(r));
    return ms;
  }
  function restartRun() { attempt = null; save(RUN_KEY, null); try { root.localStorage.removeItem(OLD_RUN_KEY); } catch (e) { /* 無妨 */ } }
  function finishMirror() { return finishLevel('mirror'); }
  function finishCastle() {
    if (finishLevel('convex') == null) return null;
    return getRun().castleMs; // 只有第二關成績（例如 ?unlock=1 跳關）→ null，不記趕鬼時間
  }
  function recordHunt(n) {
    var r = getRun() || emptyRun();
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
  // 暱稱長度用「寬度」算：英數符號 1、中文等全形字 2，上限 NAME_MAX_W（＝中文 10 字或英文 20 字）。
  // 不雅字詞：比對前轉小寫、常見替代字（0→o、1→i、@→a…）還原、去掉空白符號，再找清單中的字串。
  // 清單刻意保守：會誤傷正常名字的（例如單字「幹」「操」、英文 ass）不放。前端（prototype/shared/leaderboard.js）與後端（backend/leaderboard/Code.gs）兩份要一致。
  var BAD_WORDS = [
    '幹你', '幹妳', '幹林', '幹恁', '操你', '操妳', '靠北', '靠杯', '靠夭', '機掰', '雞掰', '機八', '雞巴', '雞八', '機車人',
    '王八蛋', '白癡', '白痴', '智障', '腦殘', '低能', '去死', '他媽', '你媽', '妳媽', '尼瑪', '塞恁', '三小', '淦',
    '婊子', '賤人', '賤貨', '妓女', '屁眼', '傻逼', '傻b', '煞筆', '草泥馬', '支那',
    'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'nigger', 'nigga', 'slut', 'whore',
    'porn', 'penis', 'pussy', 'wtf', 'stfu'
  ];
  function nameWidth_(s) {
    var w = 0, chars = Array.from ? Array.from(s) : s.split('');
    for (var i = 0; i < chars.length; i++) w += chars[i].charCodeAt(0) <= 0xff ? 1 : 2;
    return w;
  }
  function cutToWidth_(s, max) {
    var out = '', w = 0, chars = Array.from ? Array.from(s) : s.split('');
    for (var i = 0; i < chars.length; i++) {
      var cw = chars[i].charCodeAt(0) <= 0xff ? 1 : 2;
      if (w + cw > max) break;
      out += chars[i]; w += cw;
    }
    return out;
  }
  function isBadName_(s) {
    var t = String(s).toLowerCase()
      .replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
      .replace(/[^a-z㐀-鿿豈-﫿]/g, '');
    for (var i = 0; i < BAD_WORDS.length; i++) if (t.indexOf(BAD_WORDS[i]) >= 0) return true;
    return false;
  }
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
    return cutToWidth_(s, NAME_MAX_W).trim();
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
    if (isBadName_(name)) return Promise.resolve({ ok: false, error: '這個暱稱不能用，請換一個' });
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
    if (castleMs == null) card.appendChild(el('p', { 'class': 'lb-note' }, '第一關或第二關還沒有過關成績，趕鬼時間不列入排行。'));

    var row = el('div', { 'class': 'lb-row' });
    var input = el('input', { id: 'lbName', type: 'text', maxlength: String(NAME_MAX_W), placeholder: '暱稱（中文 10 字、英文 20 字內）', autocomplete: 'nickname', enterkeyhint: 'send' });
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
    TOP: TOP, NAME_MAX_W: NAME_MAX_W, BOARDS: BOARDS, nameWidth: nameWidth_, isBadName: isBadName_,
    isShared: function () { return !!url(); },
    startLevel: startLevel, pauseLevel: pauseLevel, resumeLevel: resumeLevel, cancelLevel: cancelLevel, levelElapsed: levelElapsed,
    activeLevel: function () { return attempt ? attempt.level : null; },
    restartRun: restartRun, finishMirror: finishMirror, finishCastle: finishCastle, recordHunt: recordHunt, getRun: getRun,
    formatTime: formatTime, cleanName: cleanName, getNickname: getNickname, setNickname: setNickname,
    submit: submit, fetchTop: fetchTop, showResult: showResult,
    _setNow: function (fn) { now = fn; } // 測試用
  };
})(window);

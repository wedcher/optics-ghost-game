/**
 * 光學抓鬼 — 共用排行榜後端（Google Apps Script，綁在一份 Google 試算表上）。
 * 部署步驟見 docs/leaderboard.md。
 *
 * 兩個榜，各一個工作表（第一次寫入時自動建立）：
 *   castle：趕鬼時間（第一關＋第二關，毫秒，愈小愈好）
 *   hunt  ：荒野封印數（第三關 5 分鐘，隻，愈大愈好）
 * 欄位：A 暱稱、B 成績、C 更新時間。每個暱稱只留最佳一列。
 * 老師要刪掉不當暱稱：直接在試算表刪那一列即可。
 *
 * API（前端 prototype/shared/leaderboard.js）：
 *   GET  ?action=top           → {ok:true, castle:[{name,value,at}], hunt:[...]}（各前 TOP 名）
 *   POST body(text/plain JSON) {name, castleMs?, hunt?}
 *        → {ok:true, castle:{rank,best,improved}|null, hunt:{...}|null}
 *   錯誤一律 {ok:false, error:'...'}（HTTP 200，Apps Script 不能自訂狀態碼）。
 *
 * 這個檔不依賴 Apps Script 以外的東西；tests/check-leaderboard.js 用假的 SpreadsheetApp 跑同一份程式。
 */

var TOP = 10;
var NAME_MAX = 10;
var BOARDS = {
  castle: { asc: true,  min: 30 * 1000, max: 24 * 3600 * 1000, integer: true },
  hunt:   { asc: false, min: 0,         max: 60,                integer: true }
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  if ((p.action || 'top') !== 'top') return json_({ ok: false, error: 'unknown action' });
  return json_({ ok: true, castle: top_('castle'), hunt: top_('hunt') });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }
  return json_(submit_(body));
}

function submit_(body) {
  var name = cleanName_(body && body.name);
  if (!name) return { ok: false, error: 'bad name' };
  var entries = {};
  var any = false;
  for (var key in BOARDS) {
    var field = key === 'castle' ? 'castleMs' : 'hunt';
    var v = body[field];
    if (v === undefined || v === null) continue;
    if (!validValue_(key, v)) return { ok: false, error: 'bad ' + field };
    entries[key] = Number(v);
    any = true;
  }
  if (!any) return { ok: false, error: 'nothing to submit' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var out = { ok: true, castle: null, hunt: null };
    for (var k in entries) out[k] = upsert_(k, name, entries[k]);
    return out;
  } finally {
    lock.releaseLock();
  }
}

function cleanName_(s) {
  if (typeof s !== 'string') return '';
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  var chars = Array.from ? Array.from(s) : s.split('');
  return chars.slice(0, NAME_MAX).join('').trim();
}

function validValue_(key, v) {
  var b = BOARDS[key];
  if (typeof v !== 'number' || !isFinite(v)) return false;
  if (b.integer && Math.floor(v) !== v) return false;
  return v >= b.min && v <= b.max;
}

function sheet_(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(key);
  if (!sh) {
    sh = ss.insertSheet(key);
    sh.appendRow(['name', key === 'castle' ? 'castleMs' : 'hunt', 'updatedAt']);
  }
  return sh;
}

function rows_(key) {
  var values = sheet_(key).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r[0] === '' || r[0] === null) continue;
    out.push({ row: i + 1, name: String(r[0]), value: Number(r[1]), at: Number(r[2]) || 0 });
  }
  return out;
}

function sorted_(key, list) {
  var asc = BOARDS[key].asc;
  return list.slice().sort(function (a, b) {
    if (a.value !== b.value) return asc ? a.value - b.value : b.value - a.value;
    return a.at - b.at; // 同分：先達成的在前
  });
}

function better_(key, a, b) { return BOARDS[key].asc ? a < b : a > b; }

function upsert_(key, name, value) {
  var sh = sheet_(key);
  var list = rows_(key);
  var now = Date.now();
  var mine = null;
  for (var i = 0; i < list.length; i++) if (list[i].name === name) { mine = list[i]; break; }
  var improved = false;
  if (!mine) {
    sh.appendRow([name, value, now]);
    mine = { name: name, value: value, at: now };
    list.push(mine);
    improved = true;
  } else if (better_(key, value, mine.value)) {
    sh.getRange(mine.row, 1, 1, 3).setValues([[name, value, now]]);
    mine.value = value; mine.at = now;
    improved = true;
  }
  var s = sorted_(key, list);
  var rank = 0;
  for (var j = 0; j < s.length; j++) if (s[j].name === name) { rank = j + 1; break; }
  return { rank: rank, best: mine.value, improved: improved };
}

function top_(key) {
  return sorted_(key, rows_(key)).slice(0, TOP).map(function (r) {
    return { name: r.name, value: r.value, at: r.at };
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

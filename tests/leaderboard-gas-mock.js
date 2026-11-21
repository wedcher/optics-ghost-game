/*
 * 用假的 SpreadsheetApp / LockService / ContentService 載入 backend/leaderboard/Code.gs，
 * 讓 Node 測試與 e2e 的假伺服器跑「同一份」後端程式。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet() {
  const rows = [];
  return {
    rows,
    appendRow(r) { rows.push(r.slice()); },
    getDataRange() { return { getValues: () => rows.map((r) => r.slice()) }; },
    getRange(row, col, nr, nc) {
      return { setValues(v) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) rows[row - 1 + i][col - 1 + j] = v[i][j]; } };
    }
  };
}

function loadGas(opts) {
  opts = opts || {};
  const sheets = {};
  let clock = opts.start || 1700000000000;
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = makeSheet())
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return !(opts && opts.busy); }, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } })
    },
    Date: Object.assign(function () {}, { now: () => (clock += 1000) }),
    JSON, Math, Number, String, Array, isFinite
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend/leaderboard/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    sheets,
    get: (params) => JSON.parse(ctx.doGet({ parameter: params || {} }).text),
    post: (bodyText) => JSON.parse(ctx.doPost({ postData: { contents: bodyText } }).text)
  };
}

module.exports = { loadGas };

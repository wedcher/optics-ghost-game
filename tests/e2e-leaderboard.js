#!/usr/bin/env node
/*
 * 排行榜前端的 headless 瀏覽器實測：node tests/e2e-leaderboard.js
 *   - 趕鬼計時：兩關「最後一次過關」的遊玩時間相加；劇情過場暫停、命用完／離開頁面不算、再玩一次取代、重新開始遊戲清掉
 *   - 結算畫面：文案、暱稱、上傳、名次、只留最佳
 *   - 排行榜頁：本機模式、共用模式（假伺服器跑真的 backend/leaderboard/Code.gs）、連不上時的訊息
 * 截圖輸出到 docs/screenshots/leaderboard-*.png（橫向手機）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const { loadGas } = require('./leaderboard-gas-mock');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let gas = loadGas();
let remoteDown = false;
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/mock-exec') {
    if (remoteDown) { res.writeHead(500); res.end('down'); return; }
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET') { send(gas.get(Object.fromEntries(new URL(req.url, 'http://x').searchParams))); return; }
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => send(gas.post(body)));
    return;
  }
  const file = path.normalize(path.join(ROOT, decodeURIComponent(u)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const SHOTS = path.join(ROOT, 'docs/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let checks = 0, failures = 0;
function ok(c, label, detail) {
  checks++;
  if (!c) { failures++; console.log('FAIL ' + label + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}
const MIN = 60 * 1000;

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  // 專案鎖的 Playwright 版本找不到瀏覽器時，改用環境預裝的 Chromium（雲端環境）
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
  const ctxOpts = { viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true };

  async function newPage(remote) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    // 一律蓋掉 config：本機模式用空網址；共用模式用假伺服器。絕不打真的部署網址（會寫進正式試算表）。
    const testUrl = remote ? BASE + '/mock-exec' : '';
    await page.route('**/shared/leaderboard-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.LEADERBOARD_URL = '" + testUrl + "';" }));
    page.on('pageerror', (e) => ok(false, 'page error', String(e)));
    await page.goto(BASE + '/prototype/leaderboard.html');
    await page.waitForFunction(() => document.getElementById('mode').textContent !== '讀取中…');
    // 假時鐘：測試控制 Date.now
    await page.evaluate(() => { window.__t = 1e12; Leaderboard._setNow(() => window.__t); });
    return { ctx, page };
  }
  const setT = (page, t) => page.evaluate((t) => { window.__t = t; }, t);

  // ---------- 1. 計時規則（本機模式） ----------
  {
    const { ctx, page } = await newPage(false);
    const L = (fn, ...args) => page.evaluate(([fn, args]) => Leaderboard[fn](...args), [fn, args]);
    const T0 = 1e12;
    ok(await L('finishCastle') === null && await L('getRun') === null, '沒按開始抓鬼：第二關結束不算、不留紀錄');
    ok(await L('finishMirror') === null && await L('getRun') === null, '沒按開始抓鬼：第一關過關不留紀錄（自由練習、練習模式不呼叫 startLevel）');
    // 第一關：玩 2 分鐘 → 丟圓盤過場 1 分鐘（暫停）→ 再玩 1 分鐘 → 打碎鏡子過場 5 分鐘（暫停）→ 再玩 30 秒 → 過關
    await L('startLevel', 'mirror');
    await setT(page, T0 + 2 * MIN); await L('pauseLevel');
    await setT(page, T0 + 3 * MIN); await L('pauseLevel'); // 重複暫停沒關係
    await L('resumeLevel');
    await setT(page, T0 + 4 * MIN); await L('pauseLevel');
    await setT(page, T0 + 9 * MIN); await L('resumeLevel'); await L('resumeLevel');
    ok(await L('levelElapsed') === 3 * MIN, '劇情過場暫停的時間不算', await L('levelElapsed'));
    await setT(page, T0 + 9 * MIN + 30000);
    ok(await L('finishMirror') === 3 * MIN + 30000, '第一關成績＝扣掉過場的遊玩時間');
    let run = await L('getRun');
    ok(run.mirrorMs === 3 * MIN + 30000 && run.convexMs === null && run.castleMs === null, '只有第一關成績：還沒有趕鬼時間', run);
    ok(await L('activeLevel') === null && await L('finishMirror') === null, '過關後挑戰結束，再呼叫一次不重記');
    // 「再玩一次」但命用完：保留上次過關成績
    await L('startLevel', 'mirror'); await setT(page, T0 + 30 * MIN); await L('cancelLevel');
    ok((await L('getRun')).mirrorMs === 3 * MIN + 30000 && await L('finishMirror') === null, '再玩一次沒過關（命用完）：保留上次過關的成績');
    // 再玩一次但中途回選單（換頁＝記憶體裡的挑戰消失）
    await L('startLevel', 'mirror');
    await page.reload();
    await page.evaluate(() => { window.__t = 1e12 + 40 * 60000; Leaderboard._setNow(() => window.__t); });
    ok(await L('activeLevel') === null && await L('finishMirror') === null && (await L('getRun')).mirrorMs === 3 * MIN + 30000, '中途回選單（換頁）放棄的那一次不算，舊成績還在');
    // 第二關：命用完一次（不算）→ 重新挑戰 4 分鐘過關
    await L('startLevel', 'convex'); await setT(page, T0 + 50 * MIN); await L('cancelLevel');
    ok(await L('finishCastle') === null, '第二關命用完：不算');
    await setT(page, T0 + 60 * MIN); await L('startLevel', 'convex'); await setT(page, T0 + 64 * MIN);
    ok(await L('finishCastle') === 7 * MIN + 30000, '趕鬼時間＝第一關成績＋第二關這一次（重新挑戰從 0 起算）');
    run = await L('getRun');
    ok(run.mirrorMs === 3 * MIN + 30000 && run.convexMs === 4 * MIN && run.castleMs === 7 * MIN + 30000, '兩關成績都存下來', run);
    // 第二關再玩一次、這次比較慢：最後一次取代（不是取最佳）
    await L('startLevel', 'convex'); await setT(page, T0 + 70 * MIN);
    ok(await L('finishCastle') === 9 * MIN + 30000, '再玩一次過關：新成績取代舊的（最後一次，即使比較慢）');
    // 第二關過關後回頭重玩第一關：總時間跟著換成新的第一關成績（PENDING：要不要重新上傳）
    await L('startLevel', 'mirror'); await setT(page, T0 + 72 * MIN);
    ok(await L('finishMirror') === 2 * MIN && (await L('getRun')).castleMs === 8 * MIN, '第二關過關後重玩第一關過關：趕鬼時間改用新的第一關成績');
    // 第二關的挑戰不能用第一關的 finish 收掉
    await L('startLevel', 'convex');
    ok(await L('finishMirror') === null && await L('activeLevel') === 'convex', '關卡對不上不記');
    await L('cancelLevel');
    await L('restartRun');
    ok(await L('getRun') === null, '重新開始遊戲清掉兩關成績');
    // 只有第二關成績（例如 ?unlock=1 跳關）
    await L('startLevel', 'convex'); await setT(page, T0 + 80 * MIN);
    ok(await L('finishCastle') === null && (await L('getRun')).convexMs === 8 * MIN && (await L('getRun')).castleMs === null, '只有第二關成績（跳關）：不記趕鬼時間');
    await L('restartRun');
    // 舊規則（牆上時間）的紀錄不沿用
    await page.evaluate(() => localStorage.setItem('ogg.run.v1', JSON.stringify({ startedAt: 1, mirrorDone: true, castleMs: 600000 })));
    ok(await L('getRun') === null, '舊版 ogg.run.v1（牆上時間）不沿用');
    await L('restartRun');
    ok(await page.evaluate(() => localStorage.getItem('ogg.run.v1')) === null, '重新開始遊戲順便刪掉舊版紀錄');
    ok(await page.evaluate(() => Leaderboard.formatTime(9 * 60000 + 30000)) === '9 分 30 秒', '時間格式');
    ok(await page.evaluate(() => Leaderboard.formatTime(3723000)) === '1 小時 2 分 3 秒', '時間格式（小時）');
    await page.evaluate(() => Leaderboard.restartRun());
    ok(await page.evaluate(() => Leaderboard.getRun()) === null, '重新開始遊戲清掉計時');

    // ---------- 2. 結算畫面（本機） ----------
    await page.evaluate(() => { Leaderboard.startLevel('mirror'); window.__t += 5 * 60000; Leaderboard.finishMirror(); Leaderboard.startLevel('convex'); window.__t += 6 * 60000; Leaderboard.finishCastle(); Leaderboard.recordHunt(3); Leaderboard.showResult(); });
    const sum = await page.textContent('#lbSummary');
    ok(sum === '你花費 11 分 0 秒 把鬼趕出城堡，並在荒野中封印了 3 隻鬼。', '結算文案', sum);
    ok(/只存在這支手機/.test(await page.textContent('#lbResult')), '本機模式有提示');
    const sz = await page.evaluate(() => ['lbName', 'lbSubmit', 'lbClose', 'lbView'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return Math.min(r.width, r.height); }));
    ok(sz.every((s) => s >= 44), '結算畫面的按鈕與輸入框 ≥ 44 px', sz);
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => document.getElementById('lbMsg').textContent !== '上傳中…');
    ok(/請輸入暱稱/.test(await page.textContent('#lbMsg')), '空暱稱不能送出');
    await page.fill('#lbName', '靠北');
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => document.getElementById('lbMsg').textContent !== '上傳中…');
    ok(/不能用/.test(await page.textContent('#lbMsg')), '不雅暱稱不能送出');
    ok(!(await page.isDisabled('#lbSubmit')), '被擋後可以換暱稱再送');
    ok(await page.getAttribute('#lbName', 'maxlength') === '20' && /中文 10 字/.test(await page.getAttribute('#lbName', 'placeholder')), '輸入框提示長度');
    await page.fill('#lbName', '測試甲');
    await page.screenshot({ path: path.join(SHOTS, 'leaderboard-result.png') });
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => /已上榜/.test(document.getElementById('lbMsg').textContent));
    ok(/趕鬼時間第 1 名/.test(await page.textContent('#lbMsg')) && /荒野封印第 1 名/.test(await page.textContent('#lbMsg')), '上傳後顯示名次');
    ok(await page.isDisabled('#lbSubmit'), '送出後不能重複送');
    await page.tap('#lbClose');
    ok(await page.$('#lbResult') === null, '關閉結算畫面');
    ok(await page.evaluate(() => Leaderboard.getNickname()) === '測試甲', '記住暱稱');

    // 只算荒野（沒從第一關開始）
    await page.evaluate(() => { Leaderboard.restartRun(); Leaderboard.recordHunt(5); Leaderboard.showResult(); });
    ok(/不列入排行/.test(await page.textContent('#lbResult')), '沒有趕鬼時間時有說明');
    ok(await page.inputValue('#lbName') === '測試甲', '暱稱自動帶入');
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => /已上榜/.test(document.getElementById('lbMsg').textContent));
    const msg = await page.textContent('#lbMsg');
    ok(/荒野封印第 1 名/.test(msg) && !/趕鬼時間/.test(msg), '只上傳荒野成績', msg);
    await page.tap('#lbClose');

    await page.reload();
    await page.waitForFunction(() => document.getElementById('mode').textContent !== '讀取中…');
    ok(/這支手機/.test(await page.textContent('#mode')), '排行榜頁顯示本機模式');
    ok((await page.textContent('#list li .vl')) === '11 分 0 秒', '本機排行：趕鬼時間分頁顯示最佳成績');
    await page.tap('#tabHunt');
    await page.waitForFunction(() => document.getElementById('tabHunt').classList.contains('on') && document.getElementById('mode').textContent !== '讀取中…');
    ok((await page.textContent('#list li .vl')) === '5 隻', '本機排行：切到荒野封印分頁');
    ok(await page.$eval('#list li', (li) => li.classList.contains('me')), '自己的暱稱有標示');
    ok(/^[0-9]{1,2}[/][0-9]{1,2}$/.test(await page.textContent('#list li .dt')), '每一列有日期（月/日）', await page.textContent('#list li .dt'));
    await ctx.close();
  }

  // ---------- 3. 共用模式（假伺服器跑 Code.gs） ----------
  {
    gas = loadGas();
    for (let i = 0; i < 12; i++) gas.post(JSON.stringify({ name: '同學' + (i + 1), castleMs: (8 + i) * MIN + 7000, hunt: 12 - i }));
    const { ctx, page } = await newPage(true);
    ok(/所有玩家共用/.test(await page.textContent('#mode')), '共用模式說明');
    const waitLoad = () => page.waitForFunction(() => document.getElementById('mode').textContent !== '讀取中…');
    ok((await page.$$('#list li')).length === 10 && (await page.textContent('#pageInfo')) === '第 1／2 頁（共 12 人）', '共用排行：一頁 10 名，共 2 頁', await page.textContent('#pageInfo'));
    ok((await page.textContent('#list li .nm')) === '同學1' && await page.isDisabled('#prev') && !(await page.isDisabled('#next')), '第 1 頁：第一名同學1；不能往前、可以往後');
    await page.screenshot({ path: path.join(SHOTS, 'leaderboard-page.png') });
    await page.tap('#next'); await waitLoad();
    ok((await page.$$('#list li')).length === 2 && (await page.textContent('#list li .rk')) === '11' && await page.isDisabled('#next'), '下一頁：第 11、12 名', await page.textContent('#pageInfo'));
    await page.tap('#tabHunt'); await waitLoad();
    ok((await page.textContent('#list li .vl')) === '12 隻' && (await page.textContent('#pageInfo')).startsWith('第 1／2 頁'), '切到荒野封印：回第 1 頁');
    await page.tap('#tabCastle'); await waitLoad();

    // 舊榜的回應晚到：不能用新榜的格式顯示（使用者 2026-11-21：荒野榜閃出「308087 隻」）
    await page.evaluate(() => {
      const orig = Leaderboard.fetchPage; window.__origFetchPage = orig;
      Leaderboard.fetchPage = (board, pg) => orig.call(Leaderboard, board, pg).then((r) => new Promise((res) => setTimeout(() => res(r), board === 'castle' ? 500 : 0)));
    });
    await page.tap('#refresh');          // 趕鬼榜（慢）
    await page.tap('#tabHunt');          // 馬上切到荒野榜（快）
    await page.waitForTimeout(900);
    const vls = await page.$$eval('#list li .vl', (a) => a.map((x) => x.textContent));
    ok(vls.length > 0 && vls.every((v) => /^\d{1,2} 隻$/.test(v)), '切榜時舊榜的回應晚到：荒野榜只顯示「N 隻」，不會閃出趕鬼時間數字', vls.slice(0, 3).join(','));
    await page.evaluate(() => { Leaderboard.fetchPage = window.__origFetchPage; });
    await page.tap('#tabCastle'); await waitLoad();

    await page.evaluate(() => Leaderboard.showResult({ castleMs: 7 * 60000, hunt: 2 }));
    ok(/最好的成績/.test(await page.textContent('#lbResult')), '共用模式結算提示');
    await page.fill('#lbName', '<新人>');
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => /已上榜|失敗|連不上/.test(document.getElementById('lbMsg').textContent));
    let m = await page.textContent('#lbMsg');
    ok(/趕鬼時間第 1 名/.test(m) && /荒野封印第 12 名/.test(m), '共用模式上傳後拿到名次', m);
    ok(gas.get().castle[0].name === '新人', '後端收到清理過的暱稱', gas.get().castle[0]);
    const dev = await page.evaluate(() => Leaderboard.deviceId());
    ok(/^[a-z0-9]{8,40}$/.test(dev) && gas.sheets.castle.rows.some((x) => x[0] === '新人' && x[3] === dev), '上傳帶裝置代碼，試算表 D 欄記下', dev);
    ok(await page.evaluate(() => Leaderboard.deviceId()) === dev, '裝置代碼固定（存在這支手機）');
    await page.tap('#lbClose');
    // 別支手機的同名玩家：分開列
    gas.post(JSON.stringify({ name: '新人', device: 'otherdevice0001', castleMs: 30 * MIN }));
    ok(gas.get({ action: 'page', board: 'castle', page: '1', size: '50' }).rows.filter((x) => x.name === '新人').length === 2, '同名不同手機：排行榜上兩筆');
    // 找我的名次：荒野第 12 名 → 跳到第 2 頁並標示
    await page.tap('#tabHunt'); await waitLoad();
    await page.tap('#findMe');
    await page.waitForFunction(() => /你是第/.test(document.getElementById('mode').textContent));
    ok(/你是第 12 名/.test(await page.textContent('#mode')) && (await page.textContent('#pageInfo')).startsWith('第 2／2 頁') && (await page.textContent('#list li.me .nm')) === '新人', '找我的名次：跳到第 2 頁並標出自己', await page.textContent('#pageInfo'));
    await page.screenshot({ path: path.join(SHOTS, 'leaderboard-findme.png') });

    await page.evaluate(() => Leaderboard.showResult({ castleMs: 9 * 60000, hunt: 1 }));
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => /已上榜/.test(document.getElementById('lbMsg').textContent));
    m = await page.textContent('#lbMsg');
    ok(/沒有超過你之前的 7 分 0 秒/.test(m) && /沒有超過你之前的 2 隻/.test(m), '較差成績提示沒有超過', m);
    await page.tap('#lbClose');

    remoteDown = true;
    await page.evaluate(() => Leaderboard.showResult({ castleMs: 6 * 60000, hunt: 9 }));
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => !/上傳中/.test(document.getElementById('lbMsg').textContent));
    ok(/連不上排行榜/.test(await page.textContent('#lbMsg')) && !(await page.isDisabled('#lbSubmit')), '連不上時提示且可再按');
    remoteDown = false;
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => /已上榜/.test(document.getElementById('lbMsg').textContent));
    ok(true, '網路恢復後重送成功');
    await page.tap('#lbClose');

    remoteDown = true;
    await page.tap('#refresh');
    await page.waitForFunction(() => document.getElementById('mode').textContent !== '讀取中…');
    ok(/連不上/.test(await page.textContent('#mode')), '排行榜頁連不上時顯示錯誤');
    remoteDown = false;
    await ctx.close();
  }

  // ---------- 5. 入口選單：重新開始遊戲同時清掉過關紀錄與計時（逐步解鎖細節見 tests/e2e-menu.js） ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => ok(false, 'page error（選單）', String(e)));
    await page.goto(BASE + '/prototype/index.html');
    await page.evaluate(() => { localStorage.setItem('opticsGhost.progress.v1', JSON.stringify({ mirror: true })); Leaderboard.startLevel('mirror'); Leaderboard.finishMirror(); });
    await page.reload();
    ok(!!(await page.$('a.card[data-item="convex"]')) && !(await page.$('a.card[data-item="concave"]')), '選單：過了第一關，第二關出現、第三關還沒出現');
    ok(!!(await page.$('a.card[href="leaderboard.html"]')) && !!(await page.$('#resetBtn')), '選單：排行榜入口與「重新開始遊戲」都在');
    await page.tap('#resetBtn');
    ok(await page.isVisible('#gameConfirm'), '重新開始遊戲：跳頁面內確認視窗（不是系統 confirm）');
    await Promise.all([page.waitForNavigation(), page.tap('#gcOk')]);
    const after = await page.evaluate(() => ({ p: localStorage.getItem('opticsGhost.progress.v1'), run: Leaderboard.getRun() }));
    ok(after.p === null && after.run === null, '重新開始遊戲：過關紀錄與趕鬼計時都清掉', JSON.stringify(after));
    ok(!(await page.$('a.card[data-item="convex"]')) && !!(await page.$('a.card[data-item="start"]')), '重新開始後回到只有「開始遊戲」');
    await ctx.close();
  }

  // ---------- 4. 直向手機也能看 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.route('**/shared/leaderboard-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.LEADERBOARD_URL = '';" }));
    await page.goto(BASE + '/prototype/leaderboard.html');
    await page.waitForFunction(() => document.getElementById('mode').textContent !== '讀取中…');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '窄螢幕沒有橫向捲動');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log((failures ? 'FAILED ' : 'OK ') + (checks - failures) + '/' + checks + ' leaderboard e2e checks');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

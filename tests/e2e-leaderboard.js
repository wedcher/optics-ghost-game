#!/usr/bin/env node
/*
 * 排行榜前端的 headless 瀏覽器實測：node tests/e2e-leaderboard.js
 *   - 趕鬼計時：牆上時間、失敗重來不歸零、重新開始遊戲才清掉、沒從第一關開始不算
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
    if (remote) {
      await page.route('**/shared/leaderboard-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.LEADERBOARD_URL = '" + BASE + "/mock-exec';" }));
    }
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
    ok(await page.evaluate(() => Leaderboard.finishCastle()) === null, '沒從第一關開始：第二關結束不算時間');
    await page.evaluate(() => Leaderboard.startRun());
    await setT(page, 1e12 + 3 * MIN);
    await page.evaluate(() => Leaderboard.startRun()); // 失敗重來／重新整理
    ok(await page.evaluate(() => Leaderboard.getRun().startedAt) === 1e12, '再次進第一關不歸零');
    await page.reload();
    await page.evaluate(() => { window.__t = 1e12 + 9 * 60000 + 30000; Leaderboard._setNow(() => window.__t); });
    ok(await page.evaluate(() => Leaderboard.finishCastle()) === null, '第一關還沒過（例如 ?unlock=1 跳關）：第二關結束不算時間');
    await page.evaluate(() => Leaderboard.finishMirror());
    ok(await page.evaluate(() => Leaderboard.finishCastle()) === 9 * MIN + 30000, '重新整理後仍用原本的開始時間（牆上時間）');
    await setT(page, 1e12 + 20 * MIN);
    ok(await page.evaluate(() => Leaderboard.finishCastle()) === 9 * MIN + 30000, '第二關結束時間只記一次');
    ok(await page.evaluate(() => Leaderboard.formatTime(9 * 60000 + 30000)) === '9 分 30 秒', '時間格式');
    ok(await page.evaluate(() => Leaderboard.formatTime(3723000)) === '1 小時 2 分 3 秒', '時間格式（小時）');
    await page.evaluate(() => Leaderboard.restartRun());
    ok(await page.evaluate(() => Leaderboard.getRun()) === null, '重新開始遊戲清掉計時');

    // ---------- 2. 結算畫面（本機） ----------
    await page.evaluate(() => { Leaderboard.startRun(); Leaderboard.finishMirror(); window.__t += 11 * 60000; Leaderboard.finishCastle(); Leaderboard.recordHunt(3); Leaderboard.showResult(); });
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
    ok((await page.textContent('#castle li .vl')) === '11 分 0 秒' && (await page.textContent('#hunt li .vl')) === '5 隻', '本機排行顯示最佳成績');
    ok(await page.$eval('#hunt li', (li) => li.classList.contains('me')), '自己的暱稱有標示');
    await ctx.close();
  }

  // ---------- 3. 共用模式（假伺服器跑 Code.gs） ----------
  {
    gas = loadGas();
    for (let i = 0; i < 12; i++) gas.post(JSON.stringify({ name: '同學' + (i + 1), castleMs: (8 + i) * MIN + 7000, hunt: 12 - i }));
    const { ctx, page } = await newPage(true);
    ok(/所有玩家共用/.test(await page.textContent('#mode')), '共用模式說明');
    ok((await page.$$('#castle li')).length === 10 && (await page.$$('#hunt li')).length === 10, '共用排行只顯示前 10');
    ok((await page.textContent('#castle li .nm')) === '同學1' && (await page.textContent('#hunt li .vl')) === '12 隻', '共用排行順序');
    await page.screenshot({ path: path.join(SHOTS, 'leaderboard-page.png') });

    await page.evaluate(() => Leaderboard.showResult({ castleMs: 7 * 60000, hunt: 2 }));
    ok(/最好的成績/.test(await page.textContent('#lbResult')), '共用模式結算提示');
    await page.fill('#lbName', '<新人>');
    await page.tap('#lbSubmit');
    await page.waitForFunction(() => /已上榜|失敗|連不上/.test(document.getElementById('lbMsg').textContent));
    let m = await page.textContent('#lbMsg');
    ok(/趕鬼時間第 1 名/.test(m) && /荒野封印第 12 名/.test(m), '共用模式上傳後拿到名次', m);
    ok(gas.get().castle[0].name === '新人', '後端收到清理過的暱稱', gas.get().castle[0]);
    await page.tap('#lbClose');

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
    await page.evaluate(() => { localStorage.setItem('opticsGhost.progress.v1', JSON.stringify({ mirror: true })); Leaderboard.startRun(); Leaderboard.finishMirror(); });
    await page.reload();
    ok(!!(await page.$('a.card[data-item="convex"]')) && !(await page.$('a.card[data-item="concave"]')), '選單：過了第一關，第二關出現、第三關還沒出現');
    ok(!!(await page.$('a.card[href="leaderboard.html"]')) && !!(await page.$('#resetBtn')), '選單：排行榜入口與「重新開始遊戲」都在');
    page.once('dialog', (d) => d.accept());
    await Promise.all([page.waitForNavigation(), page.tap('#resetBtn')]);
    const after = await page.evaluate(() => ({ p: localStorage.getItem('opticsGhost.progress.v1'), run: Leaderboard.getRun() }));
    ok(after.p === null && after.run === null, '重新開始遊戲：過關紀錄與趕鬼計時都清掉', JSON.stringify(after));
    ok(!(await page.$('a.card[data-item="convex"]')) && !!(await page.$('a.card[data-item="start"]')), '重新開始後回到只有「開始遊戲」');
    await ctx.close();
  }

  // ---------- 4. 直向手機也能看 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
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

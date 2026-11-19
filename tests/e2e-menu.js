#!/usr/bin/env node
/*
 * 選單（prototype/index.html）與共用模組的 headless 瀏覽器實測：node tests/e2e-menu.js
 *   - G4 逐步解鎖：每個過關階段選單上出現哪些項目、文字、連結（練習模式 ?practice=1）
 *   - G2 全螢幕教學：只在第一次按「開始遊戲」時出現（測試用 ?fstip=1 強制視為會切全螢幕的裝置）
 *   - G3 不再出現「請橫放」提示；manifest 有 orientation: landscape
 *   - G5 從選單進下一關
 * 截圖輸出到 docs/screenshots/menu-*.png（橫向手機）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
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
const KEY = 'opticsGhost.progress.v1';
const T = {
  start: ['開始遊戲', '古堡邀請，充滿鏡子的房間', 'plane-mirror/index.html'],
  mirror: ['第一關：充滿鏡子的房間', '鏡子中，有一個女鬼', 'plane-mirror/index.html'],
  'mirror-practice': ['第一關：練習模式', null, 'plane-mirror/index.html?practice=1'],
  convex: ['第二關：走廊的凸透鏡', '城堡裡到處都是鬼，請趕走他們', 'convex-lens/index.html'],
  'convex-practice': ['第二關：練習模式', null, 'convex-lens/index.html?practice=1'],
  concave: ['第三關：荒野狩獵，小凹透鏡派上用場', '趁天亮前，多封印幾隻', 'concave-lens/index.html'],
  'concave-practice': ['第三關：練習模式（不計時）', null, 'concave-lens/index.html?practice=1'],
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const MENU = BASE + '/prototype/index.html';
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok(false, 'page error', String(e)));

  async function menuAt(progress, query) {
    await page.goto(MENU);
    await page.evaluate(([k, p]) => { localStorage.clear(); if (p) localStorage.setItem(k, JSON.stringify(p)); }, [KEY, progress]);
    await page.goto(MENU + (query || ''));
    return page.$$eval('#menu a.card', (as) => as.map((a) => ({
      id: a.getAttribute('data-item'), title: a.querySelector('strong').textContent,
      sub: a.querySelector('span').textContent, href: a.getAttribute('href'), main: a.classList.contains('main'),
      note: a.querySelector('em') ? a.querySelector('em').textContent : '',
    })));
  }
  function expectItems(items, ids, label) {
    ok(JSON.stringify(items.map((i) => i.id)) === JSON.stringify(ids), label + '：項目', items.map((i) => i.id));
    items.forEach((it) => {
      const t = T[it.id];
      if (!t) return;
      ok(it.title === t[0] && (t[1] === null || it.sub === t[1]) && it.href === t[2], label + '：' + it.id + ' 文字與連結', it);
    });
  }

  // ---------- G4 逐步解鎖 ----------
  let items = await menuAt(null);
  expectItems(items, ['start'], '第一次開');
  ok(items[0].main, '「開始遊戲」是主要入口');
  ok(!!(await page.$('a.card[href="leaderboard.html"]')) && !!(await page.$('#resetBtn')), '排行榜入口與「重新開始遊戲」保留');
  ok(!(await page.$('#menu a.card.dev')), '開發用自由練習不放進一般選單');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '橫向手機沒有橫向捲動');
  const sz = await page.$$eval('#menu a.card, #lbLink, #resetBtn', (els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
  ok(sz.every((s) => s >= 44), '選單按鈕 ≥ 44 px', sz);
  await page.screenshot({ path: path.join(SHOTS, 'menu-first.png') });

  items = await menuAt({ mirror: true });
  expectItems(items, ['mirror', 'mirror-practice', 'convex'], '第一關過關後');
  ok(items.filter((i) => i.main).map((i) => i.id).join() === 'convex', '第一關過關後主要入口是第二關');
  // G5：從選單進下一關
  await Promise.all([page.waitForURL(/convex-lens\/index\.html$/), page.tap('a.card[data-item="convex"]')]);
  ok(true, '從選單點第二關進得去');

  items = await menuAt({ mirror: true, convex: true });
  expectItems(items, ['mirror', 'mirror-practice', 'convex', 'convex-practice', 'concave'], '第二關過關後');
  ok(!items[4].note, '第三關不再標「製作中」（荒野狩獵已做好）', items[4]);
  await page.screenshot({ path: path.join(SHOTS, 'menu-cleared-2.png') });
  await Promise.all([page.waitForURL(/convex-lens\/index\.html\?practice=1$/), page.tap('a.card[data-item="convex-practice"]')]);
  ok(true, '從選單點第二關練習模式進得去');

  items = await menuAt({ mirror: true, convex: true, concave: true });
  expectItems(items, ['mirror', 'mirror-practice', 'convex', 'convex-practice', 'concave', 'concave-practice'], '第三關完成後');

  items = await menuAt(null, '?unlock=1');
  ok(items.length === 8 && items.filter((i) => i.id.endsWith('-free')).length === 2, '?unlock=1：全部顯示＋開發用自由練習', items.map((i) => i.id));
  ok(items.filter((i) => i.main).length <= 1, '?unlock=1：最多一個主要入口');

  // ---------- G2 全螢幕教學 ----------
  await menuAt(null);
  await Promise.all([page.waitForURL(/plane-mirror\/index\.html$/), page.tap('a.card[data-item="start"]')]);
  ok(true, '不會切全螢幕的裝置（桌機、iOS Safari、自動化）：按開始遊戲直接進第一關，不跳教學');

  await menuAt(null, '?fstip=1');
  await page.tap('a.card[data-item="start"]');
  await page.waitForSelector('#fsTip');
  ok(/離開全螢幕/.test(await page.textContent('#fsTip')) && /index\.html\?fstip=1$/.test(page.url()), '第一次按開始遊戲：先跳全螢幕教學、還沒換頁');
  await page.screenshot({ path: path.join(SHOTS, 'menu-fullscreen-tip.png') });
  await Promise.all([page.waitForURL(/plane-mirror\/index\.html$/), page.tap('#fsTipGo')]);
  ok(true, '按「知道了」進第一關');
  await page.goto(MENU + '?fstip=1');
  await Promise.all([page.waitForURL(/plane-mirror\/index\.html$/), page.tap('a.card[data-item="start"]')]);
  ok(true, '第二次按開始遊戲不再跳教學');
  await page.goto(MENU + '?fstip=1');
  await page.evaluate((k) => localStorage.setItem(k, '{"mirror":true}'), KEY);
  await page.evaluate(() => localStorage.removeItem('opticsGhost.fsTip.v1'));
  await page.goto(MENU + '?fstip=1');
  await Promise.all([page.waitForURL(/plane-mirror\/index\.html$/), page.tap('a.card[data-item="mirror"]')]);
  ok(true, '「第一關」「練習模式」等其他入口不跳教學');

  // ---------- G3 不再有轉向提示 ----------
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pp = await pctx.newPage();
  for (const u of ['/prototype/index.html', '/prototype/plane-mirror/index.html', '/prototype/convex-lens/index.html', '/prototype/concave-lens/index.html', '/prototype/leaderboard.html']) {
    await pp.goto(BASE + u);
    ok(!(await pp.$('#rotateHint')), '直拿手機不出現「請橫放」提示：' + u);
  }
  await pctx.close();
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype/manifest.webmanifest'), 'utf8'));
  ok(mf.orientation === 'landscape' && mf.display === 'fullscreen', 'manifest：orientation landscape、display fullscreen', mf);

  await browser.close();
  server.close();
  console.log((failures ? 'FAILED ' : 'OK ') + (checks - failures) + '/' + checks + ' menu e2e checks');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

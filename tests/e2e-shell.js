#!/usr/bin/env node
/*
 * 外框頁（prototype/game.html）與「安裝到手機」的 headless 瀏覽器實測：node tests/e2e-shell.js
 *   - 外框頁裡載入選單；從選單進關卡、回選單都在框裡換頁，外框頁本身不重新載入（全螢幕因此不會退出）
 *   - 網址 #… 記住框裡的頁面；不接受遊戲以外的網址
 *   - 手機直拿：外框頁整個轉 90°，框裡的頁面看到橫的畫面、自己不再轉
 *   - 安裝提示：iPhone 第一次自動跳、第二次不跳；選單最下面的「安裝到手機」按鈕打開提示（提示條出現在外框頁）
 * （全螢幕本身在 headless 測不到：fullscreen.js 在自動化測試裡不切。實體手機要看。）
 * 截圖：docs/screenshots/shell-*.png
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
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
let checks = 0, failures = 0;
function ok(c, label, detail) {
  checks++;
  if (!c) failures++;
  console.log((c ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port + '/prototype/';
  const browser = await chromium.launch();

  // ---------- 橫向手機：框裡換頁、外框頁不重新載入 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('opticsGhost.progress.v1', JSON.stringify({ mirror: true })); localStorage.setItem('opticsGhost.installTip.v1', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + 'game.html');
    const frame = () => page.frame({ url: /prototype\/(index|leaderboard|plane-mirror|convex-lens|concave-lens)/ });
    await page.waitForFunction(() => { const f = document.getElementById('game'); return f && f.contentDocument && f.contentDocument.querySelector('a.card'); });
    await page.evaluate(() => { window.__shellMark = 42; });
    ok(/#index\.html$/.test(page.url()) && await frame().evaluate(() => !!document.getElementById('menu')), '外框頁一開就在框裡載入選單，網址記成 #index.html', page.url());
    ok(await page.title() === '光學抓鬼 — 選單', '外框頁的標題跟著框裡的頁面', await page.title());
    await page.screenshot({ path: path.join(SHOTS, 'shell-menu.png') });
    await frame().tap('a.card[data-item="convex"]');
    await page.waitForFunction(() => /convex-lens\/index\.html$/.test(location.hash));
    await page.waitForFunction(() => { const d = document.getElementById('game').contentDocument; return d && d.querySelector('.story'); });
    ok(await page.evaluate(() => window.__shellMark) === 42, '從選單進第二關：在框裡換頁，外框頁沒有重新載入（全螢幕不會退出）', page.url());
    await frame().evaluate(() => document.getElementById('menuBtn').click()); // 開場過場蓋著，直接觸發按鈕
    await page.waitForFunction(() => /#index\.html$/.test(location.hash));
    ok(await page.evaluate(() => window.__shellMark) === 42, '「☰ 回關卡」回選單：還是同一個外框頁');
    ok(await frame().evaluate(() => !!(window.InstallHint && window.InstallHint === window.top.InstallHint)), '框裡的選單用外框頁的 InstallHint');
    ok(await frame().isVisible('#installBtn'), '選單最下面有「安裝到手機」按鈕');
    await frame().tap('#installBtn');
    const bar = await page.evaluate(() => { const b = document.getElementById('installHint'); return b ? b.textContent : null; });
    ok(bar && /安裝/.test(bar) && /不安裝也可以/.test(bar), '按「安裝到手機」：提示條出現在外框頁（沒有安裝事件時顯示做法）', bar);
    await page.screenshot({ path: path.join(SHOTS, 'shell-install.png') });
    await page.tap('#installNo');
    ok(await page.evaluate(() => !document.getElementById('installHint')), '「知道了」收起提示條');
    // #… 只接受遊戲自己的頁面
    await page.goto('about:blank'); // 只改 # 不會重新載入頁面
    await page.goto(BASE + 'game.html#plane-mirror/index.html');
    await page.waitForFunction(() => { const f = document.getElementById('game'); return f.contentWindow && /plane-mirror\/index\.html/.test(f.contentWindow.location.href); });
    ok(true, '#plane-mirror/index.html：重新整理回到第一關');
    await page.goto('about:blank');
    await page.goto(BASE + 'game.html#credits.html');
    await page.waitForFunction(() => { const f = document.getElementById('game'); return f.contentWindow && /prototype\/credits\.html/.test(f.contentWindow.location.href); });
    ok(true, '#credits.html：重新整理留在「製作與素材」頁');
    await page.goto('about:blank');
    await page.goto(BASE + 'game.html#https://example.com/');
    await page.waitForFunction(() => { const f = document.getElementById('game'); return f.contentWindow && /prototype\/index\.html/.test(f.contentWindow.location.href); });
    ok(true, '#後面是別的網址：不理它，改開選單');
    ok(errors.length === 0, '沒有 JS 錯誤', errors.join(' | '));
    await ctx.close();
  }

  // ---------- 直拿手機：外框頁轉 90°，框裡不再轉 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('opticsGhost.installTip.v1', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    await page.goto(BASE + 'game.html');
    await page.waitForFunction(() => { const f = document.getElementById('game'); return f && f.contentDocument && f.contentDocument.querySelector('a.card'); });
    const r = await page.evaluate(() => {
      const w = document.getElementById('game').contentWindow;
      return { shellRot: document.documentElement.classList.contains('gl-rot'), innerRot: w.document.documentElement.classList.contains('gl-rot'), iw: w.innerWidth, ih: w.innerHeight };
    });
    ok(r.shellRot && !r.innerRot && r.iw > r.ih, '直拿：外框頁轉 90°，框裡看到橫的畫面、自己不再轉', r);
    const f = page.frame({ url: /prototype\/index\.html/ });
    const box = await f.evaluate(() => { const b = document.querySelector('a.card').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const pt = await page.evaluate((p) => GameLandscape.toClient(p, document.getElementById('game')), box);
    await page.touchscreen.tap(pt.x, pt.y);
    await page.waitForFunction(() => /plane-mirror\/index\.html/.test(location.hash), null, { timeout: 5000 }).catch(() => {});
    ok(/plane-mirror\/index\.html/.test(page.url()), '直拿：點轉過的選單卡片進得了第一關（觸控座標正確）', page.url());
    await page.screenshot({ path: path.join(SHOTS, 'shell-rotate.png') });
    await ctx.close();
  }

  // ---------- iPhone：安裝提示只在第一次自動跳 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });
    const page = await ctx.newPage();
    await page.goto(BASE + 'game.html');
    await page.waitForSelector('#installHint');
    const t1 = await page.textContent('#installHint');
    ok(/分享/.test(t1) && /加入主畫面/.test(t1), 'iPhone 第一次：自動跳「分享 → 加入主畫面」提示', t1);
    await page.reload();
    await page.waitForFunction(() => { const f = document.getElementById('game'); return f && f.contentDocument && f.contentDocument.querySelector('a.card'); });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.getElementById('installHint')), 'iPhone 第二次：不再自動跳（從選單按鈕打開）');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

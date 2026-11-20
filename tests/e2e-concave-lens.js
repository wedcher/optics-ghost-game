#!/usr/bin/env node
/*
 * 凹透鏡 prototype 的 headless 瀏覽器實測：node tests/e2e-concave-lens.js
 * 需要 Playwright（本機：npm i -D playwright && npx playwright install chromium）。
 *
 * 用真正的觸控事件（手機）／滑鼠事件（桌機）走完整流程，並檢查：
 *   - 控制項不被擠出畫面、頁面不捲動
 *   - 透鏡內整個場景被重映射；鬼只在透鏡內出現
 *   - 標記保留、放下透鏡後鬼消失
 *   - 畫線不會誤觸選格／縮放；拖曳與雙指不會畫線
 *   - 沒開 Debug 時畫面與 DOM 不洩漏答案
 *   - 錯誤封印不揭露鬼；正確封印才顯形
 *   - 封印後畫的線真的畫在畫面上（使用者 2026-11-18 回報的 bug）；鬼本體封印後才成為吸附點
 *   - 荒野練習模式（?practice=1）：3 顆 ❤️、抓錯扣命、命用完出現失敗畫面、不計時、不記排行
 *   （正式荒野狩獵——開場、5 分鐘倒數、結算、排行榜——在 tests/e2e-hunt.js）
 * 原本的完整流程用 ?free=1（自由練習／開發模式：有配置選單與 Debug、不計命）跑；關卡模式另外在 runLevel 測。
 * 截圖輸出到 docs/screenshots/。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { checkReplay, checkReplayIdle } = require('./replay-checks.js');

const ROOT = path.join(__dirname, '..');
// 用本機 HTTP 伺服器開頁面：背景是圖片檔，file:// 下 canvas 會被標成 tainted，
// 測試就不能用 getImageData 讀像素。（學生直接雙擊開啟仍可正常遊玩，只是不能讀回像素。）
const http = require('http');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
let URL = null; // 伺服器啟動後設定
const SHOTS = path.join(ROOT, 'docs/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0, checks = 0;
const results = [];
function ok(cond, label, detail) {
  checks++;
  if (!cond) failures++;
  const line = (cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + detail : '');
  results.push(line);
  console.log(line);
}

const PROFILES = [
  // 遊戲一律橫向（docs/decisions.md）。橫向手機是主要情境，跑完全部配置。
  { name: 'phone-landscape', viewport: { width: 812, height: 375 }, touch: true, dsf: 2, configs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], shots: /./, query: '?free=1' },
  // 直向只當備援版面檢查：用 ?portrait=1 關掉「請橫放」提示。
  { name: 'phone-portrait', viewport: { width: 375, height: 812 }, touch: true, dsf: 2, configs: [0], shots: /^[258]-/, query: '?portrait=1&free=1' },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false, dsf: 1, configs: [0, 2], shots: /^[258]-/, query: '?free=1' }
];

async function run(profile, browser) {
  console.log('\n===== ' + profile.name + ' ' + profile.viewport.width + '×' + profile.viewport.height + (profile.touch ? ' touch' : ' mouse') + ' =====');
  const context = await browser.newContext({
    viewport: profile.viewport, hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: profile.dsf
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL + (profile.query || ''));
  await page.waitForFunction(() => window.__proto);
  ok(await page.evaluate(() => window.__proto.background().ready), '[' + profile.name + '] 背景圖已載入');

  const P = (label) => '[' + profile.name + '] ' + label;
  const shot = async (name) => { if (profile.shots.test(name)) await page.screenshot({ path: path.join(SHOTS, profile.name + '-' + name + '.png') }); };
  const canvasBox = () => page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const tap = async (x, y) => {
    const b = await canvasBox();
    if (profile.touch) await page.touchscreen.tap(b.x + x, b.y + y); else await page.mouse.click(b.x + x, b.y + y);
    await page.waitForTimeout(40);
  };
  const press = async (sel) => { if (profile.touch) await page.tap(sel); else await page.click(sel); await page.waitForTimeout(40); };
  const drag = async (x0, y0, x1, y1) => {
    const b = await canvasBox();
    if (profile.touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + x0, y: b.y + y0, id: 1 }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + x0 + (x1 - x0) * i / 6, y: b.y + y0 + (y1 - y0) * i / 6, id: 1 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(b.x + x0, b.y + y0); await page.mouse.down();
      await page.mouse.move(b.x + x1, b.y + y1, { steps: 6 }); await page.mouse.up();
    }
    await page.waitForTimeout(60);
  };
  const pinch = async (cx, cy) => {
    const b = await canvasBox();
    const pts = (d) => [{ x: b.x + cx - d, y: b.y + cy, id: 1 }, { x: b.x + cx + d, y: b.y + cy, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
    for (const d of [30, 45, 60, 80]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);
  };
  // 計算 canvas 上接近某顏色的像素數（鬼體色／標記色）
  const countColor = (hex, region) => page.evaluate(({ hex, region }) => {
    window.__proto.render();
    const c = document.getElementById('view'), g = c.getContext('2d');
    const n = parseInt(hex.slice(1), 16), R = n >> 16, G = (n >> 8) & 255, B = n & 255;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const dpr = window.__proto.canvasSize().DPR;
    let cnt = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (region && Math.hypot(x / dpr - region.x, y / dpr - region.y) > region.r) continue;
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - R) < 10 && Math.abs(d[i + 1] - G) < 10 && Math.abs(d[i + 2] - B) < 10) cnt++;
    }
    return cnt;
  }, { hex, region });
  const GHOST = '#9dffd8', MARK = '#ff5fd2';
  const st = () => page.evaluate(() => {
    const s = window.__proto.state;
    return { phase: s.phase, facing: s.facing, lensUp: s.lensUp, marker: s.marker, mode: s.mode, lines: s.lines.length, pending: !!s.pending,
      selectedCell: s.selectedCell, solved: s.solved, attempts: s.attempts, zoomIdx: s.zoomIdx, tx: s.view.tx, ty: s.view.ty, sc: s.view.s, debug: s.debug,
      stats: Object.assign({}, window.__proto.stats), vv: window.visualViewport ? window.visualViewport.scale : 1 };
  });
  const cfgInfo = () => page.evaluate(() => { const c = window.__proto.cfg(); return { id: c.id, f: c.f, direction: c.direction, targetCell: c.targetCell, object: c.object, image: c.image, imageCell: window.__proto.configs.floor.cellAt(c.image.x) }; });
  const layoutCheck = async (where) => {
    const r = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, bad = [], small = [];
      document.querySelectorAll('button, select').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return; // hidden
        if (b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5) bad.push(el.id);
        if (b.height < 40 || b.width < 40) small.push(el.id + ':' + Math.round(b.width) + 'x' + Math.round(b.height));
      });
      const c = document.getElementById('view').getBoundingClientRect();
      const de = document.documentElement;
      return { bad, small, scroll: de.scrollWidth > vw || de.scrollHeight > vh, canvas: Math.round(c.width) + '×' + Math.round(c.height), ch: c.height, cw: c.width };
    });
    ok(r.bad.length === 0, P(where + '：所有控制項都在畫面內'), r.bad.join(',') || 'canvas ' + r.canvas);
    ok(r.small.length === 0, P(where + '：按鈕點擊區 ≥ 40×40 px'), r.small.join(',') || undefined);
    ok(!r.scroll, P(where + '：頁面不需捲動'));
    ok(r.ch >= 150 && r.cw >= 300, P(where + '：畫布仍有足夠空間（≥300×150）'), r.canvas);
    return r;
  };
  const w2s = (pt) => page.evaluate((pt) => window.__proto.w2s(pt), pt);
  // 某個控制列裡看得見的按鈕：文字（依畫面由左到右）＋是不是排在同一排（回饋 C1、C2）
  const rowButtons = (sel) => page.evaluate((sel) => {
    const bs = Array.from(document.querySelectorAll(sel + ' button')).map((el) => ({ t: el.textContent.trim(), r: el.getBoundingClientRect() })).filter((b) => b.r.width && b.r.height);
    bs.sort((a, b) => (Math.abs(a.r.top - b.r.top) > 4 ? a.r.top - b.r.top : a.r.left - b.r.left)); // 由上而下、由左而右
    const tops = bs.map((b) => Math.round(b.r.top));
    return { labels: bs.map((b) => b.t), oneRow: tops.every((t) => Math.abs(t - tops[0]) <= 1) };
  }, sel);
  // 拖曳畫線用：從 from 往水平（h）／垂直（v）／斜向（d）找一個終點，在畫布內、而且不在任何標示點的吸附範圍裡
  const freeEnd = (from, axis) => page.evaluate(({ from, axis, hook }) => {
    const H = window[hook], r = document.getElementById('view').getBoundingClientRect();
    const pts = H.snapPoints().map((p) => H.w2s(p));
    for (const d of [80, -80, 60, -60, 110, -110, 45, -45, 140, -140]) for (const k of (axis === 'd' ? [0.6, -0.6] : [0])) {
      const e = axis === 'h' ? { x: from.x + d, y: from.y + 4 } : axis === 'v' ? { x: from.x + 4, y: from.y + d } : { x: from.x + d, y: from.y + k * d };
      if (e.x < 8 || e.y < 8 || e.x > r.width - 8 || e.y > r.height - 8) continue;
      const el = document.elementFromPoint(r.left + e.x, r.top + e.y);
      if (!el || el.id !== 'view') continue;
      // 從起點到終點的線也不能經過別的標示點（線經過點會吸附到那個點）
      const ux = e.x - from.x, uy = e.y - from.y, len = Math.hypot(ux, uy);
      const through = pts.some((q) => { const al = ((q.x - from.x) * ux + (q.y - from.y) * uy) / len, off = Math.abs((q.x - from.x) * uy - (q.y - from.y) * ux) / len; return al > 1 && off < 17; });
      if (through) continue;
      if (pts.every((q) => Math.hypot(q.x - e.x, q.y - e.y) > H.SNAP_PX + 8)) return e;
    }
    return null;
  }, { from, axis, hook: '__proto' });
  const snap = async (id) => {
    const pts = await page.evaluate(() => window.__proto.snapPoints());
    const p = pts.find((q) => q.id === id);
    if (!p) throw new Error('snap point not found: ' + id);
    return w2s(p);
  };

  for (const ci of profile.configs) {
    await page.selectOption('#configSel', String(ci));
    await page.waitForTimeout(60);
    const c = await cfgInfo();
    const first = ci === profile.configs[0];
    const T = (label) => P('配置' + c.id + ' ' + label);
    let s;

    // ---------- 探索 ----------
    if (first) { await layoutCheck('探索'); await shot('1-explore-naked'); }
    if (first) {
      const rb = await rowButtons('#exploreControls');
      ok(rb.labels.join('|') === '◀ 左轉|舉起凹透鏡|右轉 ▶|光路分析' && (rb.oneRow || profile.name === 'phone-portrait'),
        T('C1 探索按鈕：◀ 左轉／舉起凹透鏡／右轉 ▶／光路分析' + (profile.name === 'phone-portrait' ? '' : '，只排一排')), rb.labels.join('、'));
      // 共用約定 G1：「☰ 回關卡」在右上角（2026-11-18 改字）
      const mb = await page.evaluate(() => { const r = document.getElementById('menuBtn').getBoundingClientRect(); return { right: window.innerWidth - r.right, top: r.top, t: document.getElementById('menuBtn').textContent.trim() }; });
      ok(mb.t === '☰ 回關卡' && mb.right < 16 && mb.top < 16, T('「☰ 回關卡」在右上角'), '離右邊 ' + mb.right.toFixed(0) + 'px、離上面 ' + mb.top.toFixed(0) + 'px');
    }
    ok(await countColor(GHOST) === 0, T('裸眼畫面沒有鬼'));

    // 透鏡內場景重映射：同一方位，舉起透鏡前後，透鏡圓內（不含邊框）的像素應大量不同
    const m = await page.evaluate(() => window.__proto.exploreMetrics());
    const nonGhostDir = (c.direction + 2) % 4;
    while ((await st()).facing !== nonGhostDir) await press('#turnRight');
    await page.evaluate(() => { window.__proto.render(); const cv = document.getElementById('view'); window.__before = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; });
    await press('#lensBtn');
    {
      const d = await page.evaluate((m) => {
        window.__proto.render();
        const cv = document.getElementById('view'), w = cv.width, h = cv.height, dpr = window.__proto.canvasSize().DPR;
        const before = window.__before, after = cv.getContext('2d').getImageData(0, 0, w, h).data;
        let inside = 0, diff = 0, outsideDiff = 0, outside = 0;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const r = Math.hypot(x / dpr - m.cx, y / dpr - m.cy), i = (y * w + x) * 4;
          const ch = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 24;
          if (r < m.rLens - 8) { inside++; if (ch) diff++; }
          else if (r > m.rLens + 8 && Math.abs(x / dpr - m.cx) > 14) { outside++; if (ch) outsideDiff++; }
        }
        window.__before = null;
        return { in: diff / inside, out: outsideDiff / outside };
      }, m);
      ok(d.in > 0.15, T('透鏡內整個場景被重映射（非只縮鬼）'), '透鏡內 ' + (100 * d.in).toFixed(0) + '% 像素改變；此方位沒有鬼');
      ok(d.out < 0.01, T('透鏡外畫面不變'), (100 * d.out).toFixed(2) + '%');
    }
    // 四個方位：鬼只在正確方位的透鏡內出現
    const seen = [];
    for (let k = 0; k < 4; k++) {
      s = await st();
      if (await countColor(GHOST) > 20) seen.push(s.facing);
      await press('#turnRight');
    }
    ok(seen.length === 1 && seen[0] === c.direction, T('鬼像只出現在一個方位的透鏡內'), '出現於方位 ' + seen.join(','));
    while ((await st()).facing !== c.direction) await press('#turnRight');
    const ip = await page.evaluate(() => window.__proto.imageScreenPos());
    ok(Math.hypot(ip.x - m.cx, ip.y - m.cy) + ip.r < m.rLens, T('鬼像整個在透鏡圓內'));
    ok(await countColor(GHOST, { x: ip.x, y: ip.y, r: ip.r + 6 }) > 20, T('鬼像畫在幾何算出的虛像視角位置'));
    ok(await countColor(GHOST, { x: m.cx, y: m.cy, r: 1e4 }) === await countColor(GHOST, { x: ip.x, y: ip.y, r: ip.r * 2 + 30 }), T('透鏡外沒有鬼的像素'));
    if (first) await shot('2-explore-lens-ghost');

    // 標記：點別處不成立，點鬼像成立
    await tap(m.cx + m.rLens * 0.6, m.cy + (ip.y < m.cy ? 1 : -1) * m.rLens * 0.5);
    ok((await st()).marker === null, T('點在沒有鬼像的地方不會產生標記'));
    await tap(ip.x + 9, ip.y - 7); // 故意偏一點，模擬手指
    s = await st();
    ok(s.marker && s.marker.dir === c.direction, T('點鬼像（偏 11px）可標記虛像'));
    ok(await page.evaluate(() => document.getElementById('lensBtn').textContent.trim()) === '放下凹透鏡', T('舉起後按鈕變成「放下凹透鏡」'));
    await press('#lensBtn');
    s = await st();
    ok(!s.lensUp && await countColor(GHOST) === 0, T('放下透鏡後鬼像消失'));
    ok(s.marker && await countColor(MARK) > 30, T('放下透鏡後標記保留'));
    if (first) await shot('3-explore-marker-kept');

    // ---------- 側視分析 ----------
    await press('#toAnalysis');
    await page.waitForTimeout(120);
    s = await st();
    ok(s.phase === 'analysis', T('按「光路分析」切到側視分析'));
    if (first) {
      const rb = await rowButtons('#analysisControls');
      ok(rb.labels.join('|') === '回探索|選格封印|畫線|復原|清除' && (rb.oneRow || profile.name === 'phone-portrait'),
        T('C2 光路分析按鈕：回探索／選格封印／畫線／復原／清除' + (profile.name === 'phone-portrait' ? '' : '，只排一排')), rb.labels.join('、'));
    }
    if (first) { const lr = await layoutCheck('分析／畫線'); await shot('4-analysis-start');
      const cell = await page.evaluate(() => window.__proto.configs.floor.width * window.__proto.state.view.s);
      ok(true, P('（資訊）預設縮放下一格寬 ' + cell.toFixed(1) + ' px，畫布 ' + lr.canvas));
    }
    // 不洩漏答案
    const leak = async (when) => {
      const info = await page.evaluate(() => {
        const c = window.__proto.cfg(), o = c.object;
        const near = window.__proto.snapPoints().filter((p) => Math.hypot(p.x - o.x, p.y - o.y) < 30).length;
        const text = document.body.innerText;
        const dp = document.getElementById('debugPanel');
        return { near, text, dpHidden: dp.hidden, dpLen: dp.textContent.length, debugDrawn: window.__proto.stats.debugDrawn, revealed: window.__proto.stats.ghostRevealed, ox: String(o.x), tc: c.targetCell };
      });
      const textLeak = /目標格|物點|理論交點|DEBUG/.test(info.text) || info.text.includes('(' + info.ox);
      ok(await countColor(GHOST) === 0 && !info.revealed, T(when + '：畫面上沒有鬼本體'));
      ok(!textLeak && info.dpHidden && info.dpLen === 0 && !info.debugDrawn, T(when + '：DOM／文字／Debug 圖層沒有答案'));
      return info;
    };
    let info = await leak('分析開始');
    ok(info.near === 0, T('分析開始：吸附點裡沒有物點'));
    // 預設縮放下，每個吸附點都要點得到（不被縮放鈕等控制項蓋住）
    {
      const covered = await page.evaluate(() => {
        const H = window.__proto, cv = document.getElementById('view'), r = cv.getBoundingClientRect(), out = [];
        H.snapPoints().forEach((p) => {
          const q = H.w2s(p);
          if (q.x < 0 || q.y < 0 || q.x > r.width || q.y > r.height) return; // 在畫面外不算「被蓋住」（F′ 作圖用不到）
          const el = document.elementFromPoint(r.left + q.x, r.top + q.y);
          if (el !== cv) out.push(p.label + ' 被 #' + (el ? el.id || el.tagName : 'null') + ' 蓋住');
        });
        return out;
      });
      ok(covered.length === 0, T('預設縮放下所有吸附點都點得到（沒有被按鈕蓋住）'), covered.join('；') || undefined);
    }

    // 畫線模式點地板格 → 不會選格
    const cellPt = await w2s({ x: -(c.targetCell - 0.5) * 100, y: -175 });
    await tap(cellPt.x, cellPt.y);
    s = await st();
    ok(s.selectedCell === null && s.lines === 0, T('畫線模式下點地板格：不選格、不畫線'));

    // 線 1：虛像 ↔ O（故意偏離吸附點中心 12px）
    let a = await snap('I'), b = await snap('O');
    await tap(a.x - 8, a.y - 9); await tap(b.x + 10, b.y + 7);
    ok((await st()).lines === 1, T('線 1：虛像 ↔ 光心 O（點擊偏 12px 仍吸附）'));
    // 線 2：F ↔ 虛像（幾何順序 F → I → P）
    a = await snap('F'); b = await snap('I');
    await tap(a.x - 9, a.y + 8); await tap(b.x + 6, b.y + 6);
    s = await st();
    const pts = await page.evaluate(() => window.__proto.snapPoints());
    const Pp = pts.find((q) => q.id === 'P');
    ok(s.lines === 2 && Pp && Math.abs(Pp.x) < 1e-9 && Math.abs(Pp.y - c.object.y) < 1e-6, T('線 2：F ↔ 虛像，延長後在透鏡上產生可吸附的 P = (0, h)'), Pp ? 'P.y=' + Pp.y.toFixed(3) : 'no P');
    // 線 3：過 P 平行主軸
    a = await snap('P');
    b = await freeEnd(a, 'h');
    await drag(a.x + 3, a.y - 2, b.x, b.y);
    if (profile.touch) { await page.waitForTimeout(40); await page.touchscreen.tap(4, 4); } // CDP 觸控拖曳後第一次點擊會被吃掉，先消耗掉
    const inter = await page.evaluate(() => {
      const o = window.__proto.cfg().object;
      const best = window.__proto.studentIntersections().map((p) => ({ p, d: Math.hypot(p.x - o.x, p.y - o.y) })).sort((x, y) => x.d - y.d)[0];
      return { d: best.d, cell: window.__proto.configs.floor.cellAt(best.p.x), margin: window.__proto.configs.floor.edgeMargin(best.p.x), n: window.__proto.state.lines.length };
    });
    ok(inter.n === 3 && inter.d < 1e-6, T('線 3：從 P 橫向拖曳拉出平行線；與光心線的交點 = 物點'), '誤差 ' + inter.d.toExponential(1) + ' cm');
    ok(inter.cell === c.targetCell && inter.margin > 0.3, T('學生作圖的交點落在唯一一格的中央附近'), '格 ' + inter.cell + '，離格線 ' + inter.margin.toFixed(2) + ' 格');
    await leak('畫完三條線');
    if (first) await shot('5-analysis-lines');

    // 縮放／平移／雙指
    const cs = await canvasBox();
    let s0 = await st();
    await press('#zoomIn');
    s = await st();
    ok(s.zoomIdx === 1 && s.sc > s0.sc && s.lines === 3, T('＋ 按鈕放大'), (s.sc / s0.sc).toFixed(2) + '×');
    await press('#zoomIn');
    if (first) { await layoutCheck('分析／放大後'); }
    s0 = await st();
    // 往右拖再往左拖（其中一個方向可能已貼到內容邊界而被夾住）
    // 平移拖曳的起點要避開標示點：從標示點開始的拖曳一律是畫線
    const freeY = (x) => page.evaluate(({ x, h, hook }) => {
      const H = window[hook], pts = H.snapPoints().map((p) => H.w2s(p));
      return [0.5, 0.7, 0.3, 0.82].map((f) => h * f).find((y) => pts.every((q) => Math.hypot(q.x - x, q.y - y) > H.SNAP_PX + 15)) || h * 0.5;
    }, { x, h: cs.h, hook: '__proto' });
    const panY1 = await freeY(cs.w * 0.3);
    await drag(cs.w * 0.3, panY1, cs.w * 0.3 + 90, panY1 + 25);
    const mid = await st();
    const panY2 = await freeY(cs.w * 0.6); // 第一次平移後標示點的位置變了，重新找
    await drag(cs.w * 0.6, panY2, cs.w * 0.6 - 90, panY2 - 25);
    s = await st();
    const moved = Math.max(Math.abs(mid.tx - s0.tx), Math.abs(s.tx - mid.tx));
    ok(moved > 40, T('放大後單指拖曳可平移'), 'Δx=' + moved.toFixed(0) + 'px');
    ok(s.lines === 3 && !s.pending && s.selectedCell === null && s.zoomIdx === s0.zoomIdx, T('拖曳平移不會畫線／選格／改變縮放'));
    // 從吸附點上開始拖曳也不算點擊
    const onF = await snap('F');
    if (onF.x > 20 && onF.x < cs.w - 100 && onF.y > 10 && onF.y < cs.h - 10) {
      await press('#modeDraw');
      await drag(onF.x, onF.y, onF.x + 30, onF.y + 60);
      s = await st();
      ok(!s.pending && s.lines === 3, T('從標示點斜向拖到空白處放開：不留線、不算點擊'));
    }
    if (profile.touch) {
      s0 = await st();
      await pinch(cs.w * 0.5, cs.h * 0.5);
      s = await st();
      ok(s.zoomIdx === s0.zoomIdx && s.sc === s0.sc && s.lines === 3 && !s.pending && s.selectedCell === null && s.vv === 1,
        T('雙指 pinch：不縮放頁面、不縮放視圖、不畫線、不選格'), 'visualViewport.scale=' + s.vv);
    }
    if (first) await shot('6-analysis-zoomed');
    await press('#zoomFit');
    ok((await st()).zoomIdx === 0, T('「全圖」回到預設視圖'));

    // ---------- 拖曳畫線：跟手的虛線預覽；碰到標示點／水平／垂直才吸附成實線；放開時實線留下、虛線消失 ----------
    {
      await press('#modeDraw');
      const cb = await canvasBox();
      const path = async (pts, mid) => {
        let out;
        if (profile.touch) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cb.x + pts[0][0], y: cb.y + pts[0][1], id: 1 }] });
          for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 4; k++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cb.x + pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 4, y: cb.y + pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 4, id: 1 }] });
          }
          await page.waitForTimeout(40); if (mid) out = await mid();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          // headless Chromium：用 CDP 模擬的拖曳結束後，緊接的第一次點擊不會產生 click（平移拖曳也一樣，是測試工具的現象）。
          // 先在標題列空白處點一下把它消耗掉。
          await page.waitForTimeout(40); await page.touchscreen.tap(4, 4);
        } else {
          await page.mouse.move(cb.x + pts[0][0], cb.y + pts[0][1]); await page.mouse.down();
          for (let i = 1; i < pts.length; i++) await page.mouse.move(cb.x + pts[i][0], cb.y + pts[i][1], { steps: 4 });
          await page.waitForTimeout(40); if (mid) out = await mid();
          await page.mouse.up();
        }
        await page.waitForTimeout(60);
        return out;
      };
      const peek = () => page.evaluate(() => {
        const H = window.__proto, s = H.state, l = s.lines[s.lines.length - 1], g = s.drag;
        const fin = (p) => isFinite(p.x) && isFinite(p.y);
        return { n: s.lines.length, drag: g ? { snap: g.snap, ax: g.a.x, ay: g.a.y, b: g.b ? { x: g.b.x, y: g.b.y } : null } : null,
          last: l ? { kind: l.kind, x: l.a.x, y: l.a.y, b: l.b ? { x: l.b.x, y: l.b.y } : null } : null,
          tx: s.view.tx, ty: s.view.ty, pending: !!s.pending, finite: H.snapPoints().every(fin) && H.studentIntersections().every(fin),
          nP: H.snapPoints().filter((p) => p.id === 'P').length };
      });
      const worldOf = (id) => page.evaluate((id) => window.__proto.snapPoints().find((q) => q.id === id), id);
      const n0 = (await peek()).n;
      const sp0 = await snap('F'), world = await worldOf('F');
      let mid, after, e;
      // 標示點真的有畫在畫面上（白點）
      const dot = await page.evaluate(({ x, y }) => { const H = window.__proto; H.render(); const dpr = H.canvasSize().DPR; const d = document.getElementById('view').getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return d[0] + d[1] + d[2]; }, { x: sp0.x, y: sp0.y });
      ok(dot > 690, T('標示點有畫在畫面上（起點處是白點）'), 'rgb 總和 ' + dot);

      // 水平：拖曳中是實線預覽、還沒有線；放開後留下精確的水平線
      e = await freeEnd(sp0, 'h');
      if (e) {
        mid = await path([[sp0.x + 4, sp0.y - 3], [e.x, e.y]], peek);
        after = await peek();
        ok(mid.drag && mid.drag.snap === 'h' && mid.n === n0, T('拖曳畫線：拉成接近水平 → 預覽吸附成水平實線，還沒有真的畫線'));
        ok(after.n === n0 + 1 && !after.drag && after.last.kind === 'parallel' && Math.abs(after.last.y - world.y) < 1e-9 && Math.abs(after.last.x - world.x) < 1e-9 && !after.pending,
          T('放開：留下通過起點、精確水平的線（存的是標示點座標）'));
        // 直向備援版面：狀態列文字換行會改變畫布高度、重新排版，不是平移，所以不比
        if (profile.name !== 'phone-portrait') ok(Math.abs(after.tx - mid.tx) < 1e-9 && Math.abs(after.ty - mid.ty) < 1e-9, T('從標示點拖曳時畫面不會跟著平移'));
        await press('#undoBtn');
        ok((await peek()).n === n0, T('「復原」可以拿掉拖出來的水平線'));
      }

      // 垂直：吸附成通過起點、精確垂直的線；它平行透鏡平面，不會產生 P，也不會算出壞掉的交點
      e = await freeEnd(sp0, 'v');
      if (e) {
        const before = await peek();
        mid = await path([[sp0.x - 3, sp0.y + 2], [e.x, e.y]], peek);
        after = await peek();
        ok(mid.drag && mid.drag.snap === 'v' && mid.n === n0, T('拖曳畫線：拉成接近垂直 → 預覽吸附成垂直實線'));
        ok(after.n === n0 + 1 && after.last.kind === 'vertical' && Math.abs(after.last.x - world.x) < 1e-9, T('放開：留下通過起點、精確垂直的線'));
        ok(after.finite && after.nP === before.nP, T('垂直線不產生新的 P，交點與吸附點座標都正常'));
        await press('#undoBtn');
        ok((await peek()).n === n0, T('「復原」可以拿掉拖出來的垂直線'));
      }

      // 斜向拖到空白處：只有跟手的虛線預覽；放開後消失
      e = await freeEnd(sp0, 'd');
      if (e) {
        mid = await path([[sp0.x, sp0.y], [e.x, e.y]], peek);
        after = await peek();
        ok(mid.drag && mid.drag.snap === null && mid.n === n0, T('拖曳畫線：斜向拖到空白處 → 只有跟手的虛線預覽（沒有吸附）'));
        ok(after.n === n0 && !after.drag && !after.pending, T('虛線時放開：線消失，不留線'));
        if (profile.name !== 'phone-portrait') ok(Math.abs(after.tx - mid.tx) < 1e-9 && Math.abs(after.ty - mid.ty) < 1e-9, T('斜向拖曳也不會平移畫面'));
        // 先拉成水平（實線），再拉到空白處（變回虛線）→ 放開不留線
        const eh = await freeEnd(sp0, 'h');
        if (eh) {
          mid = await path([[sp0.x, sp0.y], [eh.x, eh.y], [e.x, e.y]], peek);
          after = await peek();
          ok(mid.drag && mid.drag.snap === null && after.n === n0, T('吸附後又拉到空白處：變回虛線，放開不留線'));
        }
      }

      // 拖到另一個標示點：吸附到該點，放開後留下通過兩點的直線
      {
        const tp = await snap('O'), tw = await worldOf('O');
        const near = await page.evaluate(({ x, y }) => { const q = window.__proto.nearestSnap(x, y); return q ? q.id : null; }, { x: tp.x + 2, y: tp.y - 2 });
        const el = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el && el.id; }, { x: cb.x + tp.x + 2, y: cb.y + tp.y - 2 });
        if (near === 'O' && el === 'view') {
          mid = await path([[sp0.x, sp0.y], [tp.x + 2, tp.y - 2]], peek);
          after = await peek();
          ok(mid.drag && mid.drag.snap === 'point' && Math.abs(mid.drag.b.x - tw.x) < 1e-9 && Math.abs(mid.drag.b.y - tw.y) < 1e-9 && mid.n === n0, T('拖曳畫線：拖到另一個標示點 → 吸附到該點，預覽變實線'));
          ok(after.n === n0 + 1 && after.last.kind === 'line' && Math.abs(after.last.x - world.x) < 1e-9 && Math.abs(after.last.y - world.y) < 1e-9 && Math.abs(after.last.b.x - tw.x) < 1e-9 && Math.abs(after.last.b.y - tw.y) < 1e-9,
            T('放開：留下通過兩個標示點的直線（兩端都是標示點的精確座標）'));
          await press('#undoBtn');
          ok((await peek()).n === n0, T('「復原」可以拿掉拖出來的連線'));
        }
      }

      // 線經過另一個標示點（手指只拖到半路，沒有碰到那個點）→ 一樣吸附到該點
      {
        const tp = await snap('P'), tw = await worldOf('P');
        const hx = sp0.x + (tp.x - sp0.x) * 0.55, hy = sp0.y + (tp.y - sp0.y) * 0.55;
        const okSpot = await page.evaluate(({ x, y, cx, cy }) => {
          const H = window.__proto, el = document.elementFromPoint(cx, cy);
          return !H.nearestSnap(x, y) && !!el && el.id === 'view';
        }, { x: hx, y: hy, cx: cb.x + hx, cy: cb.y + hy });
        if (okSpot && Math.hypot(hx - sp0.x, hy - sp0.y) > 40) {
          mid = await path([[sp0.x, sp0.y], [hx, hy]], peek);
          after = await peek();
          const onLine = (A, B) => !!B && Math.abs((B.x - A.x) * (tw.y - A.y) - (B.y - A.y) * (tw.x - A.x)) / Math.hypot(B.x - A.x, B.y - A.y) < 1e-6; // 共線的點吸附到哪一個都是同一條線
          ok(mid.drag && mid.drag.snap === 'point' && onLine({ x: mid.drag.ax, y: mid.drag.ay }, mid.drag.b), T('拖曳畫線：線經過另一個標示點（手指只到半路）→ 吸附到該點，預覽變實線'));
          ok(after.n === n0 + 1 && after.last.kind === 'line' && onLine(after.last, after.last.b), T('放開：留下通過兩個標示點的直線（手指沒有碰到第二個點）'));
          await press('#undoBtn');
        }
      }

      // 選格封印模式下不會拉出線
      await press('#modeSeal');
      e = await freeEnd(sp0, 'h');
      if (e) {
        mid = await path([[sp0.x, sp0.y], [e.x, e.y]], peek);
        after = await peek();
        ok(!mid.drag && after.n === n0, T('選格封印模式下，從標示點拖曳不會畫線'));
      }
      await press('#modeDraw');
      ok(await page.evaluate(() => !document.getElementById('toolParallel') && !document.getElementById('styleBtn') && !document.getElementById('toolLine')), T('C2 沒有「連線」「平行線」「實線／虛線」按鈕（點兩個點連線在「畫線」模式裡）'));
      await press('#zoomFit');
    }

    // ---------- 錯誤封印 ----------
    await press('#modeSeal');
    if (first) await layoutCheck('分析／封印');
    // 封印模式下點吸附點不會畫線
    a = await snap('O');
    await tap(a.x, a.y - 30);
    s = await st();
    ok(s.lines === 3 && !s.pending, T('封印模式下點擊不會畫線'));
    const wrongCell = c.imageCell; // 最自然的錯誤：封印虛像所在的格
    let wp = await w2s({ x: -(wrongCell - 0.5) * 100, y: -175 });
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === wrongCell, T('點地板格可選取（虛像所在的第 ' + wrongCell + ' 格）'));
    if (first) {
      const rb = await rowButtons('#analysisControls');
      ok(rb.labels.join('|') === '回探索|選格封印|畫線|復原|清除|施放封印法陣' && (rb.oneRow || profile.name === 'phone-portrait'), T('選格封印模式：「施放封印法陣」接在同一排最後'), rb.labels.join('、'));
    }
    // C3：還沒抓到鬼之前，再點一次同一格取消選取
    await tap(wp.x, wp.y);
    s = await st();
    ok(s.selectedCell === null && await page.evaluate(() => document.getElementById('castBtn').disabled), T('C3 封印前再點同一格 → 取消選取（施放鈕變不能按）'));
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === wrongCell, T('C3 取消後再點一次 → 重新選取'));
    await press('#castBtn');
    const during = [];
    for (const t of [250, 450, 500]) { await page.waitForTimeout(t); during.push(await countColor(GHOST)); if (t === 450 && first) await shot('7-seal-wrong'); }
    await page.waitForTimeout(600);
    s = await st();
    const status = await page.evaluate(() => document.getElementById('status').textContent);
    ok(!s.solved && s.attempts === 1 && s.selectedCell === null, T('封印虛像所在格 → 失敗'));
    ok(s.mode === 'draw' && await page.evaluate(() => document.getElementById('modeDraw').classList.contains('on')), T('封印失敗後自動切回「畫線」（使用者 2026-11-20）'));
    ok(during.every((n) => n === 0) && await countColor(GHOST) === 0 && !s.stats.ghostRevealed, T('錯誤封印全程不顯示鬼'), '動畫取樣 ' + during.join('/'));
    ok(!/[左右前後遠近]|太|靠|第\s*\d|格子?\s*\d|\d/.test(status), T('錯誤訊息不含方向／距離／格號線索'), '「' + status + '」');
    await leak('錯誤封印後');
    await checkReplayIdle({ page, hook: '__proto', ok, T, when: '錯誤封印後' });

    // ---------- 正確封印（對照組：確認「顯形」真的偵測得到） ----------
    await press('#modeSeal');
    wp = await w2s({ x: -(c.targetCell - 0.5) * 100, y: 60 }); // 點直欄上方也能選到格
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === c.targetCell, T('整個直欄都是該格的點擊區'));
    await press('#castBtn');
    await page.waitForTimeout(1750);
    s = await st();
    ok(s.solved && await countColor(GHOST) > 20, T('封印作圖交點所在格 → 成功並顯形'));
    if (first) await shot('8-seal-success');

    // C3：抓到鬼之後不能取消、也不能改選別格
    {
      const otherCell = c.targetCell === 1 ? 2 : c.targetCell - 1;
      wp = await w2s({ x: -(c.targetCell - 0.5) * 100, y: -175 });
      await tap(wp.x, wp.y);
      const op = await w2s({ x: -(otherCell - 0.5) * 100, y: -175 });
      await tap(op.x, op.y);
      s = await st();
      const vis = await page.evaluate(() => ({ seal: !document.getElementById('modeSeal').hidden, cast: !document.getElementById('castBtn').hidden }));
      ok(s.solved && s.selectedCell === c.targetCell && !vis.seal && !vis.cast, T('C3 封印後點同一格／別格：選取不變，「選格封印」「施放」按鈕收起'));
    }
    // C4：封印後仍可以畫線（點兩個點、拖曳都可以）
    {
      ok((await st()).mode === 'draw', T('C4 封印成功後自動回到畫線模式'));
      const n0 = (await st()).lines;
      const a2 = await snap('I'), b2 = await snap('F');
      await tap(a2.x, a2.y); await tap(b2.x, b2.y);
      s = await st();
      ok(s.lines === n0 + 1 && !s.pending, T('C4 封印後依序點兩個點 → 畫出連線'));
      const o2 = await snap('O'), e2 = await freeEnd(o2, 'h');
      if (e2) {
        await drag(o2.x, o2.y, e2.x, e2.y);
        ok((await st()).lines === n0 + 2, T('C4 封印後從標示點拖曳 → 畫出水平線'));
      }
      if (first) await shot('8b-draw-after-seal');
      // 照真人速度按：拖曳畫線（CDP 觸控）剛結束就點按鈕，手機模擬偶爾不產生 click（2026-11-19 配置 F、H 抓到），先等一下
      await page.waitForTimeout(400); await press('#undoBtn');
      if (e2) { await page.waitForTimeout(400); await press('#undoBtn'); }
      ok((await st()).lines === n0, T('C4 封印後「復原」也能用'));
    }

    // ---------- 光路重現 ----------
    await checkReplay({
      page, hook: '__proto', ok, T, press,
      shot: first ? () => shot('10-replay-end') : null,
      physics: (spec) => {
        // 用配置（物點、虛像、焦距）驗證，不拿 spec 自己對自己。透鏡在 x = 0，物與虛像都在 x < 0。
        const o = c.object, O = { x: 0, y: 0 }, F = { x: -Math.abs(c.f), y: 0 }, Pt = { x: 0, y: o.y }, sg = spec.segments;
        const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
        const col = (a, b, p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
        return [
          { ok: sg.length === 9 && [0, 1, 2, 3, 6, 7].every((i) => sg[i].kind === 'ray') && [4, 5, 8].every((i) => sg[i].kind === 'extension'), label: '六段實際光線＋三段反向延長線（三條主光線）' },
          { ok: same(sg[0].a, o) && same(sg[1].a, o) && same(sg[6].a, o), label: '三條光線都從鬼本體出發' },
          { ok: same(sg[0].b, Pt) && same(sg[2].a, Pt), label: '光線 1 平行主軸射到透鏡上的 P' },
          { ok: sg[2].b.x > 0 && col(F, Pt, sg[2].b) < 1e-6 && Math.abs(sg[2].b.y) > Math.abs(o.y), label: '光線 1 折射後發散，方向像是從物側焦點 F 射出', detail: '偏離 ' + col(F, Pt, sg[2].b).toExponential(1) + ' cm' },
          { ok: same(sg[1].b, O) && same(sg[3].a, O) && sg[3].b.x > 0 && col(o, O, sg[3].b) < 1e-6, label: '光線 2 通過光心 O 不偏折' },
          { ok: same(sg[4].a, Pt) && same(sg[4].b, F) && same(sg[5].a, O) && same(sg[5].b, c.image), label: '反向延長線：P → F、O → 虛像' },
          { ok: Math.abs(sg[6].b.x) < 1e-9 && col(o, sg[6].b, { x: Math.abs(c.f), y: 0 }) < 1e-6 && same(sg[7].a, sg[6].b), label: '光線 3 對準另一側焦點 F′ 射到透鏡', detail: '偏離 ' + col(o, sg[6].b, { x: Math.abs(c.f), y: 0 }).toExponential(1) + ' cm' },
          { ok: sg[7].b.x > 0 && Math.abs(sg[7].b.y - sg[7].a.y) < 1e-9, label: '光線 3 折射後平行主光軸' },
          { ok: same(sg[8].a, sg[6].b) && same(sg[8].b, c.image), label: '光線 3 的反向延長線（水平）通過虛像' },
          { ok: col(Pt, F, c.image) < 1e-6 && col(O, o, c.image) < 1e-6 && same(spec.points[0].p, c.image), label: '三條反向延長線交於虛像', detail: '(' + c.image.x.toFixed(2) + ', ' + c.image.y.toFixed(2) + ')' }
        ];
      }
    });

    // ---------- 封印後畫線看得到（使用者 2026-11-18 回報：放開後看不到線，但多了交點 P）＋ 鬼本體是吸附點 ----------
    {
      // 等光路重現播完（播的那幾秒線會壓淡，那是刻意的）；之後畫的線一定要用原本的顏色畫在最上層
      await page.evaluate(() => { const s = window.__proto.state; if (s.replay) s.replay.t0 = performance.now() - 60000; window.__proto.render(); });
      await press('#modeDraw');
      const pts2 = await page.evaluate(() => window.__proto.snapPoints());
      const G = pts2.find((q) => q.id === 'G');
      ok(!!G && Math.abs(G.x - c.object.x) < 1e-9 && Math.abs(G.y - c.object.y) < 1e-9, T('封印後鬼本體成為吸附點（座標 = 物點）'));
      // 像素：在線經過、但不靠近任何標示點的地方取樣，比較畫線前後有幾個像素變了（不比顏色：線寬 2 會被反鋸齒混色）
      const region = (at) => page.evaluate((at) => {
        const H = window.__proto; H.render();
        const dpr = H.canvasSize().DPR, R = Math.ceil(4 * dpr), x0 = Math.round(at.x * dpr) - R, y0 = Math.round(at.y * dpr) - R;
        return Array.from(document.getElementById('view').getContext('2d').getImageData(x0, y0, 2 * R + 1, 2 * R + 1).data);
      }, at);
      // 變了、而且是線的顏色（黃 #ffd166／綠 #7dffb2，容許反鋸齒混色）才算；原本的 bug 是畫成 22% 白，色相不對，不算
      const hue = { y: (r, g, b) => r > 140 && r - b > 70, g: (r, g, b) => g > 110 && g - r > 45 };
      const changed = (a, b, kind) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60 && hue[kind](b[i], b[i + 1], b[i + 2])) n++; return n; };
      const n0 = (await st()).lines;
      // ① 鬼本體 → F（不和重現的光線重疊）
      const g = await snap('G'), o = await snap('F');
      const midGO = { x: g.x + (o.x - g.x) * 0.45, y: g.y + (o.y - g.y) * 0.45 };
      const yb = await region(midGO);
      await tap(g.x, g.y); await tap(o.x, o.y);
      s = await st();
      const ya = changed(yb, await region(midGO), 'y');
      ok(s.lines === n0 + 1 && !s.pending, T('封印後點「鬼本體」再點 F → 畫出連線'));
      ok(ya >= 3, T('封印後畫的連線有畫在畫面上（線經過處出現黃色線的像素）'), ya + ' 個像素');
      // ② 從 F 拖出垂直線（拖曳畫線、放開後）
      const f = await snap('F'), e3 = await freeEnd(f, 'v');
      if (e3) {
        const at = { x: f.x + (e3.x - f.x) * 0.6, y: f.y + (e3.y - f.y) * 0.6 };
        const gb = await region(at);
        await drag(f.x, f.y, e3.x, e3.y);
        if (profile.touch) { await page.waitForTimeout(40); await page.touchscreen.tap(4, 4); }
        const ga = changed(gb, await region(at), 'g');
        ok((await st()).lines === n0 + 2 && ga >= 3, T('封印後拖曳畫的垂直線放開後看得到（線經過處出現綠色線的像素）'), ga + ' 個像素');
        if (first) await shot('8c-line-visible-after-seal');
        await press('#undoBtn');
      }
      await press('#undoBtn');
      ok((await st()).lines === n0, T('封印後畫的線可以復原'));
    }

    // ---------- Debug ----------
    if (first) {
      await press('#debugBtn');
      const dbg = await page.evaluate(() => ({ t: document.getElementById('debugPanel').textContent, drawn: (window.__proto.render(), window.__proto.stats.debugDrawn) }));
      ok(/物點/.test(dbg.t) && /虛像/.test(dbg.t) && /焦距/.test(dbg.t) && /目標格/.test(dbg.t) && /理論交點/.test(dbg.t) && dbg.drawn, T('Debug overlay 顯示物點／虛像／焦距／目標格／理論光線'));
      await shot('9-debug');
      await press('#debugBtn');
      const off = await page.evaluate(() => document.getElementById('debugPanel').textContent.length);
      ok(off === 0, T('關閉 Debug 後面板清空'));
    }
  }
  ok(errors.length === 0, P('沒有 JS 錯誤'), errors.join(' | ') || undefined);
  await context.close();
}

// ---------- 關卡模式（不帶 ?free=1）：❤️、扣命、失敗畫面、練習模式 ----------
async function runLevel(browser, query) {
  const practice = /practice=1/.test(query);
  const name = practice ? 'level-practice' : 'level';
  console.log('\n===== ' + name + ' 812×375 touch ' + query + ' =====');
  const context = await browser.newContext({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.dismiss());
  await page.goto(URL + query);
  await page.waitForFunction(() => window.__proto);
  const P = (label) => '[' + name + '] ' + label;
  const press = async (sel, wait) => { await page.tap(sel); await page.waitForTimeout(wait || 40); };
  const tapCanvas = async (x, y) => { const b = await page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left, y: r.top }; }); await page.touchscreen.tap(b.x + x, b.y + y); await page.waitForTimeout(40); };
  const info = () => page.evaluate(() => {
    const H = window.__proto, lv = H.level, vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getBoundingClientRect().width > 0; };
    const sc = document.querySelector('.story');
    return { lives: lv.lives, sealed: lv.sealed, screen: lv.screen, on: lv.on,
      heartsLeft: Array.from(document.querySelectorAll('#hearts > span')).filter((h) => !h.classList.contains('lost')).length,
      hearts: document.querySelectorAll('#hearts > span').length,
      count: document.getElementById('sealCount').textContent, status: document.getElementById('status').textContent,
      hud: vis('hud'), title: vis('title'), configSel: vis('configSel'), debugBtn: vis('debugBtn'), debug: H.state.debug,
      menu: document.getElementById('menuBtn').textContent.trim(), next: document.getElementById('nextBtn').textContent.trim(),
      phase: H.state.phase, solved: H.state.solved, lines: H.state.lines.length,
      scene: sc ? { id: sc.getAttribute('data-scene'), text: sc.innerText, buttons: Array.from(sc.querySelectorAll('.story-btn')).map((b) => b.id), menuHref: (sc.querySelector('#failMenuBtn') || {}).getAttribute ? sc.querySelector('#failMenuBtn').getAttribute('href') : null } : null,
      lb: typeof window.Leaderboard };
  });
  // 標記虛像、進入光路分析（探索流程在 ?free=1 的測試裡已經用真的點擊測過，這裡直接設定標記）
  const toAnalysis = async () => {
    await page.evaluate(() => { const H = window.__proto, c = H.cfg(); H.state.marker = { dir: c.direction, tanX: 0, tanY: H.imageScreenPos().tan }; });
    await page.evaluate(() => window.__proto.render());
    await press('#lensBtn'); await press('#lensBtn'); // 讓 syncUI 更新「光路分析」按鈕
    await press('#toAnalysis', 150);
  };
  const sealCell = async (cell) => {
    await press('#modeSeal');
    const p = await page.evaluate((cell) => window.__proto.w2s({ x: -(cell - 0.5) * 100, y: 60 }), cell);
    await tapCanvas(p.x, p.y);
    await press('#castBtn');
    await page.waitForTimeout(1700);
  };
  const wrongCell = () => page.evaluate(() => { const c = window.__proto.cfg(); return c.targetCell === 1 ? 2 : c.targetCell - 1; });

  let s = await info();
  ok(s.on && s.hud && s.hearts === 3 && s.heartsLeft === 3, P('上方顯示 3 顆 ❤️'));
  ok(!s.title && !s.configSel && !s.debugBtn, P('關卡模式不顯示標題、配置選單與 Debug（和第二關一樣）'));
  ok(s.menu === '☰ 回關卡', P('右上角按鈕字樣「☰ 回關卡」'), s.menu);
  ok(practice ? /^練習/.test(s.count) : s.count === '封印 0 隻', P(practice ? '練習模式：命數旁標「練習」' : '命數旁顯示封印數'), s.count);
  ok(await page.evaluate(() => window.__proto.HUNT === false && document.getElementById('timer').hidden && window.__proto.hunt.deadline == null), P('練習模式：沒有開場、不倒數'));
  {
    // 說明文字放在 ❤️ 後面：同一列、在愛心右邊、在「☰ 回關卡」左邊
    const r = await page.evaluate(() => { const b = (id) => document.getElementById(id).getBoundingClientRect(); return { hud: b('hud'), st: b('status'), menu: b('menuBtn') }; });
    ok(r.st.left >= r.hud.right - 1 && r.st.right <= r.menu.left + 1 && Math.abs((r.st.top + r.st.bottom) / 2 - (r.hud.top + r.hud.bottom) / 2) < 12,
      P('說明文字在 ❤️ 後面、同一列（照第二關的排法）'), 'hud 右緣 ' + r.hud.right.toFixed(0) + '、說明 ' + r.st.left.toFixed(0) + '～' + r.st.right.toFixed(0));
  }
  await page.screenshot({ path: path.join(SHOTS, 'concave-' + name + '-1-hud.png') });

  // 抓錯 → 扣一顆，訊息不帶位置
  await toAnalysis();
  for (let k = 1; k <= 2; k++) {
    await sealCell(await wrongCell());
    s = await info();
    ok(s.lives === 3 - k && s.heartsLeft === 3 - k && !s.solved && s.screen === 'play', P('第 ' + k + ' 次抓錯：扣一顆 ❤️（剩 ' + (3 - k) + '）'));
    ok(!/[左右前後遠近]|太|靠|第\s*\d|格子?\s*\d|\d/.test(s.status), P('第 ' + k + ' 次抓錯：訊息不含方向／距離／格號線索'), '「' + s.status + '」');
  }
  if (!practice) await page.screenshot({ path: path.join(SHOTS, 'concave-level-2-hit.png') });
  // 抓對 → 封印數 +1，可以換下一隻
  await sealCell(await page.evaluate(() => window.__proto.cfg().targetCell));
  s = await info();
  ok(s.solved && s.sealed === 1 && s.lives === 1 && (practice ? /封印 1 隻/.test(s.count) : s.count === '封印 1 隻'), P('抓對：封印數 +1、不扣命'), s.count);
  ok(s.next === '下一隻鬼 ➜', P('封印後按鈕是「下一隻鬼 ➜」'), s.next);
  await press('#nextBtn', 100);
  s = await info();
  ok(s.phase === 'explore' && !s.solved && s.lives === 1 && s.sealed === 1, P('下一隻鬼：回到探索，命數與封印數保留'));
  // 第 3 次抓錯 → 命用完 → 失敗畫面
  await toAnalysis();
  await sealCell(await wrongCell());
  s = await info();
  ok(s.lives === 0 && s.heartsLeft === 0 && s.screen === 'failed' && s.scene && s.scene.id === 'failed', P('命用完：出現失敗畫面'));
  ok(s.scene && /❤️用完了/.test(s.scene.text) && !(await page.$('#lbResult')), P('失敗標題「❤️用完了……」、沒有結算／暱稱畫面'));
  ok(await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('ogg.run.v2') || 'null'); return !r || r.hunt == null; }) && await page.evaluate(() => !GameProgress.isCleared('concave')),
    P('練習模式不記荒野封印數、不算完成荒野狩獵'));
  ok(s.scene && s.scene.buttons.join() === 'retryBtn,failMenuBtn' && s.scene.menuHref === '../index.html', P('失敗畫面有「重新挑戰」與「回關卡選單」'), s.scene && s.scene.buttons.join());
  const cellsHidden = await page.evaluate(() => { const c = window.__proto.cfg(); return c.targetCell; });
  ok(s.scene && !/[左右前後遠近]|格/.test(s.scene.text) && !s.scene.text.includes('第 ' + cellsHidden), P('失敗畫面的文字不洩漏位置'), s.scene && s.scene.text.replace(/\s+/g, ' '));
  if (!practice) await page.screenshot({ path: path.join(SHOTS, 'concave-level-3-failed.png') });
  await page.waitForTimeout(400); // 結尾按鈕出現後 350ms 內不接受點擊
  await press('#retryBtn', 150);
  s = await info();
  ok(!s.scene && s.screen === 'play' && s.lives === 3 && s.heartsLeft === 3 && s.sealed === 0 && s.phase === 'explore', P('重新挑戰：3 顆 ❤️、封印數歸零、回到探索'));
  {
    // ?debug=1 在關卡模式不能打開 Debug（會洩漏答案）
    await page.goto(URL + '?debug=1');
    await page.waitForFunction(() => window.__proto);
    s = await info();
    ok(!s.debug && !s.debugBtn && await page.evaluate(() => document.getElementById('debugPanel').hidden), P('關卡模式下 ?debug=1 不會打開 Debug'));
    // ?free=1：不計命，照舊顯示標題、配置選單與 Debug
    await page.goto(URL + '?free=1');
    await page.waitForFunction(() => window.__proto);
    s = await info();
    ok(!s.on && !s.hud && s.title && s.configSel && s.debugBtn && /第三關/.test(await page.evaluate(() => document.getElementById('title').textContent)), P('?free=1：不顯示 ❤️，標題「第三關」、配置選單與 Debug 照舊'));
    await toAnalysis();
    await sealCell(await wrongCell());
    s = await info();
    ok(s.lives === 3 && s.screen === 'play', P('?free=1：抓錯不扣命'));
  }
  ok(errors.length === 0, P('沒有 JS 錯誤'), errors.join(' | ') || undefined);
  await context.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  URL = 'http://127.0.0.1:' + server.address().port + '/prototype/concave-lens/index.html';
  const browser = await chromium.launch();
  for (const p of PROFILES) {
    try { await run(p, browser); } catch (e) { ok(false, '[' + p.name + '] 測試腳本例外', e.message); }
  }
  for (const q of ['?practice=1']) {
    try { await runLevel(browser, q); } catch (e) { ok(false, '[level ' + q + '] 測試腳本例外', e.message); }
  }
  await browser.close();
  server.close();
  console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks');
  fs.writeFileSync(path.join(ROOT, 'docs/screenshots/e2e-results.txt'), results.join('\n') + '\n\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks\n');
  process.exit(failures === 0 ? 0 : 1);
})();

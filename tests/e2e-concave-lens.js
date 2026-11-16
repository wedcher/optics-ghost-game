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
 * 截圖輸出到 docs/screenshots/。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

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
  { name: 'phone-portrait', viewport: { width: 375, height: 812 }, touch: true, dsf: 2, configs: [0, 1, 2, 3], shots: /./ },
  { name: 'phone-landscape', viewport: { width: 812, height: 375 }, touch: true, dsf: 1, configs: [0], shots: /^[258]-/ },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false, dsf: 1, configs: [0, 2], shots: /^[258]-/ }
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
  await page.goto(URL);
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
    await press('#lensBtn');
    s = await st();
    ok(!s.lensUp && await countColor(GHOST) === 0, T('放下透鏡後鬼像消失'));
    ok(s.marker && await countColor(MARK) > 30, T('放下透鏡後標記保留'));
    if (first) await shot('3-explore-marker-kept');

    // ---------- 側視分析 ----------
    await press('#toAnalysis');
    await page.waitForTimeout(120);
    s = await st();
    ok(s.phase === 'analysis', T('切到側視分析'));
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
    await press('#toolParallel');
    a = await snap('P');
    await tap(a.x + 7, a.y - 8);
    const inter = await page.evaluate(() => {
      const o = window.__proto.cfg().object;
      const best = window.__proto.studentIntersections().map((p) => ({ p, d: Math.hypot(p.x - o.x, p.y - o.y) })).sort((x, y) => x.d - y.d)[0];
      return { d: best.d, cell: window.__proto.configs.floor.cellAt(best.p.x), margin: window.__proto.configs.floor.edgeMargin(best.p.x), n: window.__proto.state.lines.length };
    });
    ok(inter.n === 3 && inter.d < 1e-6, T('線 3：過 P 的平行線；與光心線的交點 = 物點'), '誤差 ' + inter.d.toExponential(1) + ' cm');
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
    await drag(cs.w * 0.3, cs.h * 0.5, cs.w * 0.3 + 90, cs.h * 0.5 + 25);
    const mid = await st();
    await drag(cs.w * 0.6, cs.h * 0.5, cs.w * 0.6 - 90, cs.h * 0.5 - 25);
    s = await st();
    const moved = Math.max(Math.abs(mid.tx - s0.tx), Math.abs(s.tx - mid.tx));
    ok(moved > 40, T('放大後單指拖曳可平移'), 'Δx=' + moved.toFixed(0) + 'px');
    ok(s.lines === 3 && !s.pending && s.selectedCell === null && s.zoomIdx === s0.zoomIdx, T('拖曳平移不會畫線／選格／改變縮放'));
    // 從吸附點上開始拖曳也不算點擊
    const onF = await snap('F');
    if (onF.x > 20 && onF.x < cs.w - 100 && onF.y > 10 && onF.y < cs.h - 10) {
      await press('#toolLine');
      await drag(onF.x, onF.y, onF.x + 70, onF.y + 10);
      s = await st();
      ok(!s.pending && s.lines === 3, T('從吸附點上開始的拖曳不會被當成畫線'));
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
    await press('#castBtn');
    const during = [];
    for (const t of [250, 450, 500]) { await page.waitForTimeout(t); during.push(await countColor(GHOST)); if (t === 450 && first) await shot('7-seal-wrong'); }
    await page.waitForTimeout(600);
    s = await st();
    const status = await page.evaluate(() => document.getElementById('status').textContent);
    ok(!s.solved && s.attempts === 1 && s.selectedCell === null, T('封印虛像所在格 → 失敗'));
    ok(during.every((n) => n === 0) && await countColor(GHOST) === 0 && !s.stats.ghostRevealed, T('錯誤封印全程不顯示鬼'), '動畫取樣 ' + during.join('/'));
    ok(!/[左右前後遠近]|太|靠|第\s*\d|格子?\s*\d|\d/.test(status), T('錯誤訊息不含方向／距離／格號線索'), '「' + status + '」');
    await leak('錯誤封印後');

    // ---------- 正確封印（對照組：確認「顯形」真的偵測得到） ----------
    wp = await w2s({ x: -(c.targetCell - 0.5) * 100, y: 60 }); // 點直欄上方也能選到格
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === c.targetCell, T('整個直欄都是該格的點擊區'));
    await press('#castBtn');
    await page.waitForTimeout(1750);
    s = await st();
    ok(s.solved && await countColor(GHOST) > 20, T('封印作圖交點所在格 → 成功並顯形'));
    if (first) await shot('8-seal-success');

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

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  URL = 'http://127.0.0.1:' + server.address().port + '/prototype/concave-lens/index.html';
  const browser = await chromium.launch();
  for (const p of PROFILES) {
    try { await run(p, browser); } catch (e) { ok(false, '[' + p.name + '] 測試腳本例外', e.message); }
  }
  await browser.close();
  server.close();
  console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks');
  fs.writeFileSync(path.join(ROOT, 'docs/screenshots/e2e-results.txt'), results.join('\n') + '\n\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks\n');
  process.exit(failures === 0 ? 0 : 1);
})();

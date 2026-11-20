#!/usr/bin/env node
/*
 * 凸透鏡 prototype 的 headless 瀏覽器實測：node tests/e2e-convex-lens.js
 * 需要 Playwright（npm ci && npx playwright install chromium）。
 *
 * 用真正的觸控事件（手機）／滑鼠事件（桌機）走完整流程，並檢查：
 *   - 控制項不被擠出畫面、頁面不捲動、吸附點不被按鈕蓋住
 *   - 拖曳／微調可移動透鏡；像模糊時不能標記，清楚時可以（兩個共軛的清晰位置都測）
 *   - 布幕上的實像倒立且左右相反（讀像素）
 *   - 透鏡的物側畫面不隨配置或透鏡位置改變（不洩漏鬼的位置）
 *   - 畫線不會誤觸選格／縮放；拖曳與雙指不會畫線
 *   - 三條主光線反推的交點 = 物點，落在目標格
 *   - 錯誤封印不揭露鬼、不啟動光路重現；正確封印才顯形
 *   - 破關後的光路重現（tests/replay-checks.js）
 * 截圖輸出到 docs/screenshots/convex-*.png。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const { checkReplay, checkReplayIdle } = require('./replay-checks.js');

const ROOT = path.join(__dirname, '..');
// 用本機 HTTP 伺服器開頁面：背景是圖片檔，file:// 下 canvas 會被標成 tainted，測試就不能讀像素。
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
let URL = null;
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

// runs：[配置索引, 清晰位置索引]。0 = 離布幕遠、放大的像；1 = 離布幕近、縮小的像。
const ALL_RUNS = [], VIRTUAL_RUNS = [];
const ALL_CFGS = require('../prototype/convex-lens/configs.js').all;
const CONFIG_COUNT = ALL_CFGS.length;
// 實像題跑兩個清晰位置；虛像題（D < 4f，沒有清晰位置）另外跑「看凸透鏡 → 標記虛像」的流程
ALL_CFGS.forEach((c, i) => { if (c.kind === 'virtual') VIRTUAL_RUNS.push(i); else for (let s = 0; s < 2; s++) ALL_RUNS.push([i, s]); });
// 回饋 V4：實像題把透鏡移到鬼和焦點之間時看到的虛像也能標記、推得出答案。挑實像題裡有虛像範圍的，橫向手機全部跑一次
const REAL_VIRTUAL_RUNS = ALL_CFGS.map((c, i) => (c.kind !== 'virtual' && c.virtualWindow ? i : -1)).filter((i) => i >= 0);
const PROFILES = [
  // 遊戲一律橫向（docs/decisions.md）。橫向手機是主要情境：所有配置全跑。
  { name: 'phone-landscape', viewport: { width: 812, height: 375 }, touch: true, dsf: 2, runs: ALL_RUNS, virtualRuns: VIRTUAL_RUNS.concat(REAL_VIRTUAL_RUNS), shots: /./ },
  // 直向只當備援版面檢查：用 ?portrait=1 關掉「請橫放」提示。
  { name: 'phone-portrait', viewport: { width: 375, height: 812 }, touch: true, dsf: 2, runs: [[0, 0]], virtualRuns: VIRTUAL_RUNS.slice(0, 1), shots: /^[258]-/, query: '&portrait=1' },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false, dsf: 1, runs: [[0, 1], [2, 0]], virtualRuns: VIRTUAL_RUNS.slice(-1), shots: /^[258]-/ }
];

const GHOST = '#9dffd8', MARK = '#ff5fd2';
const collinear = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);

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
  await page.waitForFunction(() => window.__protoConvex && window.__protoConvex.art().pending === 0);
  await page.evaluate(() => window.__protoConvex.render());

  const P = (label) => '[' + profile.name + '] ' + label;
  const art = await page.evaluate(() => window.__protoConvex.art());
  ok(art.corridor && art.lens, P('走廊背景圖與鏡片圖已載入'));

  const shot = async (name) => { if (profile.shots.test(name)) await page.screenshot({ path: path.join(SHOTS, 'convex-' + profile.name + '-' + name + '.png') }); };
  const canvasBox = () => page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const tap = async (x, y) => {
    const b = await canvasBox();
    if (profile.touch) await page.touchscreen.tap(b.x + x, b.y + y); else await page.mouse.click(b.x + x, b.y + y);
    await page.waitForTimeout(40);
  };
  const press = async (sel, wait) => { if (profile.touch) await page.tap(sel); else await page.click(sel); await page.waitForTimeout(wait === undefined ? 40 : wait); };
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
  // 計算 canvas 上接近某顏色的像素數（鬼本體色／標記色）
  const countColor = (hex) => page.evaluate((hex) => {
    window.__protoConvex.render();
    const c = document.getElementById('view'), g = c.getContext('2d');
    const n = parseInt(hex.slice(1), 16), R = n >> 16, G = (n >> 8) & 255, B = n & 255;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let cnt = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - R) < 10 && Math.abs(d[i + 1] - G) < 10 && Math.abs(d[i + 2] - B) < 10) cnt++;
    return cnt;
  }, hex);
  const st = () => page.evaluate(() => {
    const H = window.__protoConvex, s = H.state, w = H.wallNow();
    return { phase: s.phase, lensX: s.lensX, marker: s.marker, mode: s.mode, lines: s.lines.length, pending: !!s.pending,
      selectedCell: s.selectedCell, solved: s.solved, attempts: s.attempts, zoomIdx: s.zoomIdx, tx: s.view.tx, ty: s.view.ty, sc: s.view.s, debug: s.debug,
      blurRatio: w ? w.blurRatio : null, stats: Object.assign({}, H.stats), status: document.getElementById('status').textContent,
      toAnalysisDisabled: document.getElementById('toAnalysis').disabled, vv: window.visualViewport ? window.visualViewport.scale : 1 };
  });
  const cfgInfo = () => page.evaluate(() => {
    const H = window.__protoConvex, c = H.cfg();
    return { id: c.id, f: c.f, h: c.h, targetCell: c.targetCell, object: c.object, sharp: c.sharp, lock: H.configs.WORLD.lockBlurRatio, world: H.configs.WORLD,
      kind: c.kind, virtualWindow: c.virtualWindow, virtualLensX: c.virtualLensX };
  });
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
  const w2s = (pt) => page.evaluate((pt) => window.__protoConvex.w2s(pt), pt);
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
  }, { from, axis, hook: '__protoConvex' });
  const snap = async (id) => {
    const pts = await page.evaluate(() => window.__protoConvex.snapPoints());
    const p = pts.find((q) => q.id === id);
    if (!p) throw new Error('snap point not found: ' + id);
    return Object.assign(await w2s(p), { wy: p.y });
  };
  // 物側畫面（透鏡可移動範圍最左端再往左 60px 以外）的像素。鬼就藏在這一帶，這裡不該隨配置或透鏡位置而變。
  const objectSidePixels = (key, compareTo) => page.evaluate(({ key, compareTo }) => {
    const H = window.__protoConvex; H.render();
    const cv = document.getElementById('view'), dpr = H.canvasSize().DPR, side = H.regions().side;
    const x1 = Math.floor((H.w2s({ x: H.configs.WORLD.lensMinX, y: 0 }).x - 60) * dpr);
    const x0 = Math.ceil(side.x * dpr), y0 = Math.ceil(side.y * dpr), hh = Math.floor(side.h * dpr);
    if (x1 - x0 < 20) return { width: 0 };
    const d = cv.getContext('2d').getImageData(x0, y0, x1 - x0, hh).data;
    window.__objSide = window.__objSide || {};
    let diff = null;
    if (compareTo) { const b = window.__objSide[compareTo]; diff = 0; if (!b || b.length !== d.length) diff = -1; else for (let i = 0; i < d.length; i++) if (d[i] !== b[i]) diff++; }
    if (key) window.__objSide[key] = d;
    return { width: Math.round((x1 - x0) / dpr), diff };
  }, { key, compareTo });
  // 布幕正面視圖：暫時藏起標記，讀實像的像素（true = 被投影的光照亮）
  const wallProbe = () => page.evaluate(() => {
    const H = window.__protoConvex, s = H.state, W = H.configs.WORLD, r = H.regions().wallView, w = H.wallNow(), dpr = H.canvasSize().DPR;
    const saved = s.marker; s.marker = null; H.render();
    const k = Math.min((r.w - 20) / (2 * W.wallHalfWidth), (r.h - 20 - 18) / (2 * W.axisHeight));
    const cx = r.x + r.w / 2, cy = r.y + 18 + (r.h - 18) / 2;
    const px = cx, py = cy - w.centerY * k, hw = W.ghostHalfWidth * w.scale * k, hh = W.ghostHalfHeight * w.scale * k;
    const g = document.getElementById('view').getContext('2d');
    const lit = (x, y) => { const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return d[0] + d[1] + d[2] > 600; };
    const out = {
      hw: hw, hh: hh,
      // 正立的鬼：眼睛在中心上方 0.3hh、小手在右側。倒立且左右相反 → 眼睛在下方、小手在左側。
      eyesBelow: !lit(px - 0.36 * hw, py + 0.3 * hh) && !lit(px + 0.36 * hw, py + 0.3 * hh),
      solidAbove: lit(px - 0.36 * hw, py - 0.3 * hh) && lit(px + 0.36 * hw, py - 0.3 * hh),
      handLeft: lit(px - 1.22 * hw, py + 0.05 * hh), noHandRight: !lit(px + 1.22 * hw, py + 0.05 * hh),
      body: lit(px, py + 0.55 * hh) && lit(px, py + 0.2 * hh),
      // 像的上下緣超出布幕多少 cm（> 0 表示被布幕邊緣裁掉）
      overflowCm: Math.max(0, Math.abs(w.centerY) + W.ghostHalfHeight * w.scale - W.axisHeight)
    };
    s.marker = saved; H.render();
    return out;
  });
  const nudgeTo = async (x) => {
    for (let i = 0; i < 200; i++) {
      const lx = (await st()).lensX;
      if (Math.abs(lx - x) <= 2.5) return;
      await press(lx > x ? '#nudgeLeft' : '#nudgeRight', 8);
    }
    throw new Error('nudgeTo 沒有收斂');
  };

  let firstRun = true;
  for (const [ci, si] of profile.runs) {
    await page.selectOption('#configSel', String(ci));
    await page.waitForTimeout(60);
    const c = await cfgInfo();
    const sp = c.sharp[si];
    const first = firstRun; firstRun = false;
    const T = (label) => P('配置' + c.id + (si === 0 ? '·放大像 ' : '·縮小像 ') + label);
    let s;

    // ---------- 對焦觀察 ----------
    if (first) { await layoutCheck('觀察'); await shot('1-observe-start'); }
    const leak = async (when) => {
      const info = await page.evaluate(() => {
        const H = window.__protoConvex, c = H.cfg(), o = c.object;
        const near = H.snapPoints().filter((p) => Math.hypot(p.x - o.x, p.y - o.y) < 30).length;
        const dp = document.getElementById('debugPanel');
        return { near, text: document.body.innerText, dpHidden: dp.hidden, dpLen: dp.textContent.length, debugDrawn: H.stats.debugDrawn, revealed: H.stats.ghostRevealed, ox: String(o.x) };
      });
      const textLeak = /目標格|物點|清晰位置|DEBUG/.test(info.text) || info.text.includes('(' + info.ox);
      ok(await countColor(GHOST) === 0 && !info.revealed, T(when + '：畫面上沒有鬼本體'));
      ok(!textLeak && info.dpHidden && info.dpLen === 0 && !info.debugDrawn, T(when + '：DOM／文字／Debug 圖層沒有答案'));
      ok(info.near === 0, T(when + '：吸附點裡沒有物點'));
    };
    await leak('開始觀察');
    if (first) await objectSidePixels('base');
    else {
      const d = await objectSidePixels(null, 'base');
      if (d.width) ok(d.diff === 0, T('換配置後，物側畫面與第一組配置完全相同'), '寬 ' + d.width + ' px，' + d.diff + ' 個位元組不同');
    }
    await objectSidePixels('cfg');

    const cs0 = await canvasBox();
    const side = await page.evaluate(() => window.__protoConvex.regions().side);
    const sScale = await page.evaluate(() => { const H = window.__protoConvex; return H.w2s({ x: 1, y: 0 }).x - H.w2s({ x: 0, y: 0 }).x; });
    if (first) {
      // 單純點一下不會移動透鏡；雙指也不會
      s = await st();
      await tap(side.x + side.w * 0.5, side.y + side.h * 0.5);
      ok((await st()).lensX === s.lensX, T('點一下畫面不會移動透鏡'));
      if (profile.touch) {
        await pinch(side.x + side.w * 0.5, side.y + side.h * 0.5);
        const p2 = await st();
        ok(p2.lensX === s.lensX && p2.vv === 1, T('雙指 pinch：不移動透鏡、不縮放頁面'));
      }
    }
    // 拖曳：朝清晰位置拖過去
    s = await st();
    let dxPx = Math.max(-side.w * 0.6, Math.min(side.w * 0.6, (sp.lensX - s.lensX) * sScale));
    if (Math.abs(dxPx) < 40) dxPx = 60; // 起點本來就在清晰位置附近：改成單純往右拖一段，只看方向
    const xStart = side.x + side.w * (dxPx > 0 ? 0.2 : 0.8);
    await drag(xStart, side.y + side.h * 0.45, xStart + dxPx, side.y + side.h * 0.45 + 6);
    const afterDrag = await st();
    ok(Math.abs(afterDrag.lensX - s.lensX) > 10 && Math.sign(afterDrag.lensX - s.lensX) === Math.sign(dxPx),
      T('在畫面上左右拖曳可移動透鏡'), s.lensX.toFixed(0) + ' → ' + afterDrag.lensX.toFixed(0) + ' cm（清晰位置 ' + sp.lensX.toFixed(0) + '）');

    // 偏 30 cm：模糊，不能標記
    await nudgeTo(sp.lensX + 30);
    await press('#markBtn');
    s = await st();
    ok(s.marker === null && s.blurRatio > c.lock && s.toAnalysisDisabled && /糊/.test(s.status), T('偏離清晰位置約 30 cm：像是糊的，按「標記實像」被拒絕'), '模糊比 ' + s.blurRatio.toFixed(2));
    if (first) await shot('1b-observe-blurry');

    // 微調到清晰 → 可標記，透鏡對準清晰位置
    await nudgeTo(sp.lensX);
    s = await st();
    ok(s.blurRatio <= c.lock, T('用「微調」可以調到夠清楚'), '離清晰位置 ' + Math.abs(s.lensX - sp.lensX).toFixed(1) + ' cm，模糊比 ' + s.blurRatio.toFixed(3));
    await press('#markBtn');
    s = await st();
    ok(s.marker && Math.abs(s.lensX - sp.lensX) < 1e-9 && Math.abs(s.marker.y - sp.imageY) < 1e-9 && !s.toAnalysisDisabled,
      T('清楚時可標記實像；透鏡對準清晰位置'), 'lensX=' + s.lensX.toFixed(1) + '，像高 ' + (s.marker ? s.marker.y.toFixed(1) : '—') + '，m=' + sp.m.toFixed(2));
    ok(await countColor(MARK) > 30, T('布幕上留下實像標記'));
    const wp0 = await wallProbe();
    ok(wp0.body && wp0.eyesBelow && wp0.solidAbove, T('布幕上的實像是倒立的（眼睛在下半部）'), '像半寬 ' + wp0.hw.toFixed(1) + ' px');
    ok(wp0.handLeft && wp0.noHandRight, T('布幕上的實像左右相反（小手在左側）'));
    if (wp0.overflowCm > 0 && profile.name === 'phone-landscape') ok(true, T('（資訊）實像有一部分超出布幕，被布幕邊緣裁掉'), '超出 ' + wp0.overflowCm.toFixed(0) + ' cm；像高的一半是 ' + (c.world.ghostHalfHeight * Math.abs(sp.m)).toFixed(0) + ' cm');
    {
      const d = await objectSidePixels(null, 'cfg');
      if (d.width) ok(d.diff === 0, T('透鏡移到清晰位置後，物側畫面完全沒變（不洩漏鬼的位置）'), '寬 ' + d.width + ' px');
    }
    await leak('標記後');
    if (first) {
      await layoutCheck('觀察／已標記');
      await shot('2-observe-marked');
      // 移動透鏡會取消標記
      await press('#nudgeRight');
      s = await st();
      ok(s.marker === null && s.toAnalysisDisabled, T('標記後再移動透鏡：標記取消、不能進入分析'));
      await press('#nudgeLeft');
      await press('#markBtn');
      ok(!!(await st()).marker, T('調回來可以重新標記'));
    }

    // ---------- 側視分析 ----------
    await press('#toAnalysis');
    await page.waitForTimeout(120);
    s = await st();
    ok(s.phase === 'analysis', T('切到側視分析'));
    if (first) {
      const lr = await layoutCheck('分析／畫線'); await shot('4-analysis-start');
      const cell = await page.evaluate(() => window.__protoConvex.configs.floor.width * window.__protoConvex.state.view.s);
      ok(true, P('（資訊）預設縮放下一格寬 ' + cell.toFixed(1) + ' px，畫布 ' + lr.canvas));
    }
    await leak('分析開始');
    await checkReplayIdle({ page, hook: '__protoConvex', ok, T, when: '分析開始' });
    // 預設縮放下，每個吸附點都要點得到（不被縮放鈕等控制項蓋住）
    {
      const covered = await page.evaluate(() => {
        const H = window.__protoConvex, cv = document.getElementById('view'), r = cv.getBoundingClientRect(), out = [];
        H.snapPoints().forEach((p) => {
          const q = H.w2s(p);
          if (q.x < 0 || q.y < 0 || q.x > r.width || q.y > r.height) return; // 在畫面外不算「被蓋住」
          const el = document.elementFromPoint(r.left + q.x, r.top + q.y);
          if (el !== cv) out.push(p.label + ' 被 #' + (el ? el.id || el.tagName : 'null') + ' 蓋住');
        });
        return out;
      });
      ok(covered.length === 0, T('預設縮放下所有吸附點都點得到（沒有被按鈕蓋住）'), covered.join('；') || undefined);
    }

    // 畫線模式點地板格 → 不會選格
    const cellPt = await w2s({ x: -(c.targetCell - 0.5) * 100, y: -165 });
    await tap(cellPt.x, cellPt.y);
    s = await st();
    ok(s.selectedCell === null && s.lines === 0, T('畫線模式下點地板格：不選格、不畫線'));

    // 線 1：實像 ↔ 光心 O（點擊故意偏離吸附點中心）
    let a = await snap('I'), b = await snap('O');
    await tap(a.x - 6, a.y + (a.wy > 0 ? -6 : 6)); await tap(b.x - 7, b.y + (c.h > 0 ? 6 : -6));
    ok((await st()).lines === 1, T('線 1：實像 ↔ 光心 O（點擊偏約 9px 仍吸附）'));
    // 線 2：實像 ↔ 像側焦點 F′，延長後交透鏡於 P
    a = await snap('I'); b = await snap('F2');
    await tap(a.x - 5, a.y + (a.wy > 0 ? -6 : 6)); await tap(b.x + 6, b.y + (c.h > 0 ? 6 : -6));
    s = await st();
    const pts = await page.evaluate(() => window.__protoConvex.snapPoints());
    const Pp = pts.find((q) => q.id === 'P');
    ok(s.lines === 2 && Pp && Math.abs(Pp.x - sp.lensX) < 1e-9 && Math.abs(Pp.y - c.object.y) < 1e-6, T('線 2：實像 ↔ F′，延長後在透鏡上產生可吸附的 P（高度 = 物高）'), Pp ? 'P.y=' + Pp.y.toFixed(3) : 'no P');
    // 線 3：過 P 平行主軸
    a = await snap('P');
    b = await freeEnd(a, 'h');
    await drag(a.x + 3, a.y - 2, b.x, b.y);
    if (profile.touch) { await page.waitForTimeout(40); await page.touchscreen.tap(4, 4); } // CDP 觸控拖曳後第一次點擊會被吃掉，先消耗掉
    const inter = await page.evaluate(() => {
      const H = window.__protoConvex, o = H.cfg().object;
      const best = H.studentIntersections().map((p) => ({ p, d: Math.hypot(p.x - o.x, p.y - o.y) })).sort((x, y) => x.d - y.d)[0];
      return best ? { d: best.d, cell: H.configs.floor.cellAt(best.p.x), margin: H.configs.floor.edgeMargin(best.p.x), n: H.state.lines.length } : { d: Infinity, n: H.state.lines.length };
    });
    ok(inter.n === 3 && inter.d < 1e-6, T('線 3：從 P 橫向拖曳拉出平行線；與光心線的交點 = 物點'), '誤差 ' + inter.d.toExponential(1) + ' cm');
    ok(inter.cell === c.targetCell && inter.margin > 0.3, T('學生作圖的交點落在唯一一格的中央附近'), '格 ' + inter.cell + '，離格線 ' + (inter.margin || 0).toFixed(2) + ' 格');
    await leak('畫完三條線');
    if (first) await shot('5-analysis-lines');

    // 縮放／平移／雙指
    const cs = await canvasBox();
    let s0 = await st();
    await press('#zoomIn');
    s = await st();
    ok(s.zoomIdx === 1 && s.sc > s0.sc && s.lines === 3, T('＋ 按鈕放大'), (s.sc / s0.sc).toFixed(2) + '×');
    await press('#zoomIn');
    if (first) await layoutCheck('分析／放大後');
    s0 = await st();
    // 平移拖曳的起點要避開標示點：從標示點開始的拖曳一律是畫線
    const freeY = (x) => page.evaluate(({ x, h, hook }) => {
      const H = window[hook], pts = H.snapPoints().map((p) => H.w2s(p));
      return [0.6, 0.78, 0.42, 0.3].map((f) => h * f).find((y) => pts.every((q) => Math.hypot(q.x - x, q.y - y) > H.SNAP_PX + 15)) || h * 0.6;
    }, { x, h: cs.h, hook: '__protoConvex' });
    const panY1 = await freeY(cs.w * 0.3);
    await drag(cs.w * 0.3, panY1, cs.w * 0.3 + 90, panY1 + 25);
    const mid = await st();
    const panY2 = await freeY(cs.w * 0.6); // 第一次平移後標示點的位置變了，重新找
    await drag(cs.w * 0.6, panY2, cs.w * 0.6 - 90, panY2 - 25);
    s = await st();
    const moved = Math.max(Math.abs(mid.tx - s0.tx), Math.abs(s.tx - mid.tx));
    ok(moved > 40, T('放大後單指拖曳可平移'), 'Δx=' + moved.toFixed(0) + 'px');
    ok(s.lines === 3 && !s.pending && s.selectedCell === null && s.zoomIdx === s0.zoomIdx && Math.abs(s.lensX - sp.lensX) < 1e-9, T('拖曳平移不會畫線／選格／改變縮放／移動透鏡'));
    const onO = await snap('O');
    if (onO.x > 20 && onO.x < cs.w - 100 && onO.y > 70 && onO.y < cs.h - 10) {
      await press('#modeDraw');
      await drag(onO.x, onO.y, onO.x + 30, onO.y + 60);
      s = await st();
      ok(!s.pending && s.lines === 3, T('從標示點斜向拖到空白處放開：不留線、不算點擊'));
    }
    if (profile.touch) {
      s0 = await st();
      await pinch(cs.w * 0.5, cs.h * 0.6);
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
        const H = window.__protoConvex, s = H.state, l = s.lines[s.lines.length - 1], g = s.drag;
        const fin = (p) => isFinite(p.x) && isFinite(p.y);
        return { n: s.lines.length, drag: g ? { snap: g.snap, ax: g.a.x, ay: g.a.y, b: g.b ? { x: g.b.x, y: g.b.y } : null } : null,
          last: l ? { kind: l.kind, x: l.a.x, y: l.a.y, b: l.b ? { x: l.b.x, y: l.b.y } : null } : null,
          tx: s.view.tx, ty: s.view.ty, pending: !!s.pending, finite: H.snapPoints().every(fin) && H.studentIntersections().every(fin),
          nP: H.snapPoints().filter((p) => p.id === 'P').length };
      });
      const worldOf = (id) => page.evaluate((id) => window.__protoConvex.snapPoints().find((q) => q.id === id), id);
      const n0 = (await peek()).n;
      const sp0 = await snap('F2'), world = await worldOf('F2');
      let mid, after, e;
      // 標示點真的有畫在畫面上（白點）
      const dot = await page.evaluate(({ x, y }) => { const H = window.__protoConvex; H.render(); const dpr = H.canvasSize().DPR; const d = document.getElementById('view').getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return d[0] + d[1] + d[2]; }, { x: sp0.x, y: sp0.y });
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
        const tp = await snap('I'), tw = await worldOf('I');
        const near = await page.evaluate(({ x, y }) => { const q = window.__protoConvex.nearestSnap(x, y); return q ? q.id : null; }, { x: tp.x + 2, y: tp.y - 2 });
        const el = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el && el.id; }, { x: cb.x + tp.x + 2, y: cb.y + tp.y - 2 });
        if (near === 'I' && el === 'view') {
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
        const tp = await snap('I'), tw = await worldOf('I');
        const hx = sp0.x + (tp.x - sp0.x) * 0.55, hy = sp0.y + (tp.y - sp0.y) * 0.55;
        const okSpot = await page.evaluate(({ x, y, cx, cy }) => {
          const H = window.__protoConvex, el = document.elementFromPoint(cx, cy);
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
      ok(await page.evaluate(() => !document.getElementById('toolParallel') && !document.getElementById('styleBtn') && !document.getElementById('toolLine')), T('沒有「連線」「平行線」「實線／虛線」按鈕：畫線模式下拖曳與點兩點都能畫（回饋 V2）'));
      await press('#zoomFit');
    }

    // ---------- 錯誤封印 ----------
    await press('#modeSeal');
    if (first) await layoutCheck('分析／封印');
    a = await snap('O');
    await tap(a.x, a.y + 30);
    s = await st();
    ok(s.lines === 3 && !s.pending, T('封印模式下點擊不會畫線'));
    // 上面那一下點在透鏡下方，會選到透鏡所在的格；再點一次同一格 → 取消選取（2026-11-18 定案）
    if (s.selectedCell !== null) {
      await tap(a.x, a.y + 30);
      ok((await st()).selectedCell === null, T('封印前再點同一格（透鏡下方）：取消選取'));
    }
    const wrongCell = Math.ceil(-sp.lensX / 100); // 很自然的錯誤：封印透鏡所在的格
    let wp = await w2s({ x: -(wrongCell - 0.5) * 100, y: -165 });
    await tap(wp.x, wp.y);
    ok(wrongCell !== c.targetCell && (await st()).selectedCell === wrongCell, T('點地板格可選取（透鏡所在的第 ' + wrongCell + ' 格）'));
    // 封印前再點同一格可以取消選取（2026-11-18 定案，和第三關一致）
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === null && await page.evaluate(() => document.getElementById('castBtn').disabled), T('封印前再點同一格：取消選取，「施放」變不能按'));
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === wrongCell, T('取消後再點一次：重新選取'));
    ok(!(await page.evaluate(() => window.__protoConvex.snapPoints().some((p) => p.id === 'G'))), T('封印前：鬼本體不是吸附點（不洩漏位置）'));
    await press('#castBtn');
    const during = [];
    for (const t of [250, 450, 500]) { await page.waitForTimeout(t); during.push(await countColor(GHOST)); if (t === 450 && first) await shot('7-seal-wrong'); }
    await page.waitForTimeout(600);
    s = await st();
    ok(!s.solved && s.attempts === 1 && s.selectedCell === null, T('封印透鏡所在格 → 失敗'));
    ok(s.mode === 'draw' && await page.evaluate(() => document.getElementById('modeDraw').classList.contains('on')), T('封印失敗後自動切回「畫線」（使用者 2026-11-20）'));
    ok(during.every((n) => n === 0) && await countColor(GHOST) === 0 && !s.stats.ghostRevealed, T('錯誤封印全程不顯示鬼'), '動畫取樣 ' + during.join('/'));
    ok(!/[左右前後遠近]|太|靠|第\s*\d|格子?\s*\d|\d/.test(s.status), T('錯誤訊息不含方向／距離／格號線索'), '「' + s.status + '」');
    await leak('錯誤封印後');
    await checkReplayIdle({ page, hook: '__protoConvex', ok, T, when: '錯誤封印後' });

    // ---------- 正確封印 ----------
    await press('#modeSeal');
    wp = await w2s({ x: -(c.targetCell - 0.5) * 100, y: 60 }); // 點直欄上方也能選到格
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === c.targetCell, T('整個直欄都是該格的點擊區'));
    await press('#castBtn');
    await page.waitForTimeout(1750);
    s = await st();
    ok(s.solved && await countColor(GHOST) > 20, T('封印作圖交點所在格 → 成功並顯形'));
    if (first) await shot('8-seal-success');

    // ---------- 光路重現 ----------
    await checkReplay({
      page, hook: '__protoConvex', ok, T, press,
      shot: first ? () => shot('9-replay-end') : null,
      physics: (spec) => {
        // 用配置（物點、焦距、清晰位置）驗證，不拿 spec 自己對自己
        const o = c.object, O = { x: sp.lensX, y: 0 }, F2 = { x: sp.lensX + c.f, y: 0 }, I = { x: 0, y: sp.imageY }, sg = spec.segments;
        const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
        return [
          { ok: sg.length === 6 && sg.every((x) => x.kind === 'ray'), label: '六段都是實際光線（三條主光線，實像沒有延長線）' },
          { ok: same(sg[0].a, o) && same(sg[1].a, o) && same(sg[4].a, o), label: '三條光線都從鬼本體出發' },
          { ok: same(sg[0].b, { x: sp.lensX, y: o.y }) && same(sg[2].a, sg[0].b), label: '光線 1 平行主軸射到透鏡上的 P' },
          { ok: collinear(sg[2].a, sg[2].b, F2) < 1e-6, label: '光線 1 折射後通過像側焦點 F′', detail: '偏離 ' + collinear(sg[2].a, sg[2].b, F2).toExponential(1) + ' cm' },
          { ok: same(sg[1].b, O) && same(sg[3].a, O) && collinear(o, sg[3].b, O) < 1e-6, label: '光線 2 通過光心 O 不偏折' },
          { ok: Math.abs(sg[4].b.x - sp.lensX) < 1e-9 && collinear(o, sg[4].b, { x: sp.lensX - c.f, y: 0 }) < 1e-6 && same(sg[5].a, sg[4].b), label: '光線 3 通過物側焦點 F 射到透鏡', detail: '偏離 ' + collinear(o, sg[4].b, { x: sp.lensX - c.f, y: 0 }).toExponential(1) + ' cm' },
          { ok: Math.abs(sg[5].b.y - sg[5].a.y) < 1e-9 && Math.abs(sg[4].b.y) < c.world.lensRadius, label: '光線 3 折射後平行主光軸，而且打在鏡片範圍內', detail: '高 ' + sg[4].b.y.toFixed(1) + ' cm' },
          { ok: same(sg[2].b, I) && same(sg[3].b, I) && same(sg[5].b, I) && same(spec.points[0].p, I), label: '三條光線在布幕上會聚於實像', detail: '(0, ' + sp.imageY.toFixed(2) + ')' }
        ];
      }
    });

    // ---------- 封印後：選格不能改、仍可畫線、鬼本體是吸附點、線不被光路重現蓋住 ----------
    if (first) {
      const sv = await page.evaluate(() => ({ seal: document.getElementById('modeSeal').hidden, mode: window.__protoConvex.state.mode }));
      ok(sv.seal && sv.mode === 'draw', T('封印後：「選格封印」收起、回到畫線模式'));
      const g = await page.evaluate(() => { const H = window.__protoConvex, p = H.snapPoints().find((q) => q.id === 'G'), o = H.cfg().object; return p && { ok: Math.abs(p.x - o.x) < 1e-9 && Math.abs(p.y - o.y) < 1e-9 }; });
      ok(g && g.ok, T('封印後：鬼本體（物點）成為吸附點'));
      // 播放中線會壓淡；先讓重現播完（把重現時鐘撥到結束之後，只改測試時鐘）
      await page.evaluate(() => { const s = window.__protoConvex.state; s.replay = { t0: performance.now() - 60000 }; window.__protoConvex.render(); });
      const before = (await st()).lines;
      const pO = await snap('O'), pG = await snap('G');
      await drag(pG.x, pG.y, pO.x, pO.y);
      const lineColor = (a, b) => page.evaluate(({ a, b }) => {
        const H = window.__protoConvex; H.render();
        const dpr = H.canvasSize().DPR, g = document.getElementById('view').getContext('2d');
        let hit = 0, n = 0;
        for (const f of [0.3, 0.4, 0.5, 0.6, 0.7]) {
          const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
          const d = g.getImageData(Math.round(x * dpr) - 2, Math.round(y * dpr) - 2, 5, 5).data;
          n++;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 185 && d[i + 1] < 230 && d[i + 2] > 70 && d[i + 2] < 130) { hit++; break; } // #ffd166
        }
        return { hit, n, dimmed: H.stats.linesDimmed };
      }, { a, b });
      let lc = await lineColor(pG, pO);
      ok((await st()).lines === before + 1, T('封印後：從鬼本體拖到 O 可以畫線'));
      ok(lc.hit >= 4 && lc.dimmed === false, T('封印後畫的線：重現播完後是原色黃線、畫在重現光線上面（看得見）'), lc.hit + '/' + lc.n + ' 個取樣點是黃色');
      await shot('11-draw-after-seal');
      await page.evaluate(() => document.getElementById('replayBtn').click()); // 按鈕本身由 replay-checks 測；這裡只看線的顏色
      await page.waitForTimeout(100);
      lc = await lineColor(pG, pO);
      const rpAge = await page.evaluate(() => { const s = window.__protoConvex.state; return s.replay ? Math.round(performance.now() - s.replay.t0) : null; });
      ok(lc.dimmed === true, T('光路重現播放中，學生的線暫時壓淡'), 'replay age ' + rpAge + ' ms');
      await page.evaluate(() => { const s = window.__protoConvex.state; s.replay = { t0: performance.now() - 60000 }; });
      await page.waitForTimeout(80);
      lc = await lineColor(pG, pO);
      ok(lc.dimmed === false && lc.hit >= 4, T('重現播完，學生的線恢復原色'));
      // 封印後點地板格：不能改選格
      const cellPt = await w2s({ x: -(wrongCell - 0.5) * 100, y: -165 });
      await tap(cellPt.x, cellPt.y);
      ok((await st()).selectedCell === c.targetCell && (await st()).solved, T('封印後點別的格：選格不變'));
    }

    // ---------- Debug ----------
    if (first) {
      await press('#debugBtn');
      const dbg = await page.evaluate(() => ({ t: document.getElementById('debugPanel').textContent, drawn: (window.__protoConvex.render(), window.__protoConvex.stats.debugDrawn) }));
      ok(/物點/.test(dbg.t) && /焦距/.test(dbg.t) && /目標格/.test(dbg.t) && /清晰位置/.test(dbg.t) && dbg.drawn, T('Debug overlay 顯示物點／焦距／目標格／清晰位置'));
      await shot('10-debug');
      await press('#debugBtn');
      const off = await page.evaluate(() => document.getElementById('debugPanel').textContent.length);
      ok(off === 0, T('關閉 Debug 後面板清空'));
    }
    void cs0;

    // ---------- 下一組配置：隨機出題 ----------
    if (first) {
      // 頁面載入時已經從牌堆抽走一張，所以先按 N-1 次抽完第一副，再按 N 次剛好是完整的第二副。
      const seen = await page.evaluate(() => {
        const H = window.__protoConvex, out = [{ idx: H.state.cfgIndex }];
        for (let i = 0; i < 2 * H.configs.all.length - 1; i++) {
          H.state.solved = true; // 只是讓按鈕可用；resetRound 會清掉
          document.getElementById('nextBtn').click();
          out.push({ idx: H.state.cfgIndex, phase: H.state.phase, solved: H.state.solved, marker: !!H.state.marker, lines: H.state.lines.length });
        }
        return out;
      });
      const steps = seen.slice(1);
      ok(steps.every((s, i) => s.idx !== seen[i].idx), T('「下一組配置」不會連續出同一組'), seen.map((s) => s.idx).join('→'));
      const second = steps.slice(CONFIG_COUNT - 1).map((s) => s.idx);
      ok(new Set(steps.slice(0, CONFIG_COUNT - 1).map((s) => s.idx)).size === CONFIG_COUNT - 1 && new Set(second).size === CONFIG_COUNT, T('「下一組配置」每一輪內每組各出一次、不重複'), second.join(','));
      ok(steps.every((s) => s.phase === 'observe' && !s.solved && !s.marker && s.lines === 0), T('換配置後回到觀察階段，標記與作圖線都清空'));
    }
  }
  // ---------- 虛像題：看布幕找不到 → 看凸透鏡 → 標記虛像 → 反推 → 封印 → 重播 ----------
  // 「看凸透鏡」畫面裡虛像的紫色（半透明疊在暗色鏡片上）
  const countVirtual = () => page.evaluate(() => {
    const H = window.__protoConvex; H.render();
    const r = H.regions().wall, dpr = H.canvasSize().DPR, g = document.getElementById('view').getContext('2d');
    const d = g.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 180 && d[i + 1] < 170 && d[i] > 115 && d[i] < 200 && d[i] > d[i + 1]) n++;
    return n;
  });
  for (const ci of (profile.virtualRuns || [])) {
    await page.selectOption('#configSel', String(ci));
    await page.waitForTimeout(60);
    const c = await cfgInfo();
    const realQ = c.kind !== 'virtual'; // 實像題，但這一輪改用虛像作答（V4）
    const T = (label) => P('配置' + c.id + (realQ ? '·實像題改標虛像 ' : '·虛像題 ') + label);
    const shotV = profile.name === 'phone-landscape' && ci === profile.virtualRuns[0] ? (n) => shot('v' + n) : async () => {};
    const noLeak = async (when) => {
      const info = await page.evaluate(() => {
        const H = window.__protoConvex, o = H.cfg().object, dp = document.getElementById('debugPanel');
        return { text: document.body.innerText, dpLen: dp.textContent.length, revealed: H.stats.ghostRevealed, debugDrawn: H.stats.debugDrawn };
      });
      ok(await countColor(GHOST) === 0 && !info.revealed && !/目標格|物點|清晰位置|DEBUG|虛像題/.test(info.text) && info.dpLen === 0 && !info.debugDrawn, T(when + '：畫面、文字、Debug 都沒有鬼本體或答案'));
    };
    let s = await st();
    ok(s.phase === 'observe' && !s.marker && await page.evaluate(() => window.__protoConvex.state.look === 'screen'), T('開場：看布幕、沒有標記'));
    await noLeak('開始觀察');
    // 透鏡可移動範圍和實像題一樣；整個範圍內布幕上都不夠清楚
    const scan = await page.evaluate(() => {
      const H = window.__protoConvex, W = H.configs.WORLD, s = H.state, keep = s.lensX;
      let minR = Infinity;
      for (let x = W.lensMinX; x <= W.lensMaxX; x += 2) { s.lensX = x; const w = H.wallNow(); if (w && w.blurRatio < minR) minR = w.blurRatio; }
      s.lensX = keep; H.render();
      return { minR, min: W.lensMinX, max: W.lensMaxX };
    });
    if (!realQ) ok(scan.min === -620 && scan.max === -80 && scan.minR > c.lock, T('透鏡範圍 -620～-80（和實像題相同），整段布幕上都是模糊的光'), '最小模糊比 ' + scan.minR.toFixed(2));
    await nudgeTo(c.virtualLensX);
    await press('#markBtn');
    s = await st();
    ok(!s.marker && s.toAnalysisDisabled && /模糊|看不到/.test(s.status), T('看布幕時按「標記」被拒絕（布幕上沒有清楚的像）'), '「' + s.status + '」');
    ok(await countVirtual() === 0, T('看布幕時沒有畫虛像'));
    // 切到「看透鏡」
    await press('#lookLens');
    const look = await page.evaluate(() => ({ look: window.__protoConvex.state.look, a: document.getElementById('lookLens').getAttribute('aria-pressed'), b: document.getElementById('lookScreen').getAttribute('aria-pressed') }));
    ok(look.look === 'lens' && look.a === 'true' && look.b === 'false', T('按「看透鏡」切換畫面（兩個並排按鈕，狀態正確）'));
    const lvInfo = await page.evaluate(() => { const H = window.__protoConvex, r = H.regions(); return { lv: H.lensViewNow(), wall: r.wall }; });
    const purple = await countVirtual();
    ok(lvInfo.lv.eye === 'virtual' && lvInfo.lv.m > 1 && lvInfo.lv.angMag > 1 && purple > 20, T('透鏡在鬼和焦點之間：透鏡裡看到正立、放大的虛像，看起來比直接看鬼大'),
      'm=' + lvInfo.lv.m.toFixed(2) + '，視角放大 ' + lvInfo.lv.angMag.toFixed(2) + ' 倍，' + purple + ' px');
    const cap = await page.evaluate(() => { const H = window.__protoConvex; H.render(); return H.stats.lensCaption; });
    ok(cap === '虛像（正立、放大）', T('鏡框裡寫「虛像（正立、放大）」（使用者答虛像題 V2）'), String(cap));
    await noLeak('看透鏡');
    await shotV('1-lens-view');
    // 透鏡越過鬼：透鏡裡和布幕上都沒有像
    if (c.object.x - 15 >= c.world.lensMinX) {
      await nudgeTo(c.object.x - 15);
      await press('#markBtn');
      s = await st();
      const n1 = await countVirtual();
      await press('#lookScreen');
      const wallLit = await page.evaluate(() => window.__protoConvex.wallNow());
      await press('#lookLens');
      ok(!s.marker && n1 === 0 && wallLit === null && /看不到/.test(s.status), T('透鏡越過鬼：透鏡裡、布幕上都看不到像，不能標記'));
    }
    await nudgeTo(c.virtualLensX);
    await press('#markBtn');
    s = await st();
    const lv = await page.evaluate(() => window.__protoConvex.lensViewNow());
    ok(s.marker && s.marker.virtual && Math.abs(s.marker.x - lv.x) < 1e-9 && Math.abs(s.marker.y - lv.y) < 1e-9 && s.marker.x < s.lensX && !s.toAnalysisDisabled,
      T('看到虛像時可標記：標記打在虛像的位置（透鏡左邊），透鏡不會被自動移動'), '標記 (' + (s.marker ? s.marker.x.toFixed(0) + ', ' + s.marker.y.toFixed(0) : '—') + ')，透鏡 ' + s.lensX.toFixed(1));
    ok(s.status.includes('這是，正立、放大、虛像，鬼與像都在透鏡對面。'), T('標記後出現台詞'), '「' + s.status + '」');
    ok(await countColor(MARK) > 30, T('畫面上有標記'));
    await shotV('2-lens-marked');
    // 切回布幕：標記取消
    await press('#lookScreen');
    ok(!(await st()).marker, T('切到「看布幕」：虛像標記取消'));
    ok(await page.evaluate(() => { const H = window.__protoConvex; H.render(); return H.stats.lensCaption; }) === null, T('看布幕時沒有「虛像」字樣'));
    await press('#lookLens');
    await press('#markBtn');
    ok(!!(await st()).marker, T('切回「看透鏡」可以重新標記'));
    await layoutCheck('虛像題／看透鏡已標記');
    // 直向只是備援版面：側視圖太窄（標記離鏡片只有十幾 px），作圖流程只在橫向與桌機測
    if (profile.name === 'phone-portrait') continue;

    // 側視分析
    await press('#toAnalysis');
    await page.waitForTimeout(120);
    s = await st();
    ok(s.phase === 'analysis', T('切到側視分析'));
    const sp0 = await page.evaluate(() => window.__protoConvex.snapPoints().map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })));
    const I0 = sp0.find((p) => p.id === 'I');
    ok(I0 && I0.label === '虛像' && I0.x < s.lensX && sp0.every((p) => p.x <= 0), T('虛像標記在透鏡左邊；所有吸附點都在布幕前面（F′ 在布幕後面就不出現）'), sp0.map((p) => p.label + '(' + p.x.toFixed(0) + ')').join(' '));
    await noLeak('分析開始');
    if (profile.name === 'phone-landscape') await page.waitForTimeout(5300); // 等說明橫幅淡出，才不會蓋住截圖
    // 線 1：從虛像標記水平拉向透鏡 → 透鏡上出現 P（高度 = 虛像高）
    let a = await snap('I');
    let b = await freeEnd(a, 'h');
    await drag(a.x + 3, a.y - 2, b.x, b.y);
    if (profile.touch) { await page.waitForTimeout(40); await page.touchscreen.tap(4, 4); }
    const Pp = (await page.evaluate(() => window.__protoConvex.snapPoints())).find((q) => q.id === 'P');
    ok((await st()).lines === 1 && Pp && Math.abs(Pp.x - s.lensX) < 1e-9 && Math.abs(Pp.y - I0.y) < 1e-9, T('線 1：從虛像標記拉水平線，交透鏡於 P'), Pp ? 'P.y=' + Pp.y.toFixed(2) : 'no P');
    // 線 2：P ↔ 物側焦點 F
    a = await snap('P'); b = await snap('F');
    await tap(a.x + 4, a.y + 4); await tap(b.x - 5, b.y + 5);
    // 線 3：虛像標記 ↔ 光心 O
    a = await snap('I'); b = await snap('O');
    await tap(a.x - 4, a.y - 4); await tap(b.x + 5, b.y + 5);
    const inter = await page.evaluate(() => {
      const H = window.__protoConvex, o = H.cfg().object;
      const best = H.studentIntersections().map((p) => ({ p, d: Math.hypot(p.x - o.x, p.y - o.y) })).sort((x, y) => x.d - y.d)[0];
      return best ? { d: best.d, cell: H.configs.floor.cellAt(best.p.x), n: H.state.lines.length, kinds: H.state.lines.map((l) => l.kind).join(',') } : { d: Infinity, n: H.state.lines.length };
    });
    ok(inter.n === 3 && inter.d < 1e-6 && inter.cell === c.targetCell, T('「標記→水平得 P → P 連 F → 標記連 O」交點 = 鬼，落在目標格'), '誤差 ' + inter.d.toExponential(1) + ' cm，格 ' + inter.cell + '（' + inter.kinds + '）');
    ok(await page.evaluate(() => !document.getElementById('styleBtn')), T('學生畫的線一律實線（沒有實線／虛線切換）'));
    await noLeak('畫完三條線');
    await shotV('3-analysis-lines');
    // 封印
    await press('#modeSeal');
    const wp = await w2s({ x: -(c.targetCell - 0.5) * 100, y: 60 });
    await tap(wp.x, wp.y);
    ok((await st()).selectedCell === c.targetCell, T('選目標格'));
    await press('#castBtn');
    await page.waitForTimeout(1750);
    s = await st();
    ok(s.solved && await countColor(GHOST) > 20, T('封印成功並顯形'));
    ok(/虛像/.test(s.status), T('過關訊息說明透鏡裡看到的是虛像'), '「' + s.status + '」');
    await checkReplay({
      page, hook: '__protoConvex', ok, T, press,
      shot: profile.name === 'phone-landscape' && ci === profile.virtualRuns[0] ? () => shot('v4-replay-end') : null,
      physics: (spec) => {
        // 用配置自己算（物點、焦距、透鏡位置 → 1/f = 1/u + 1/v），不拿 spec 自己對自己
        const o = c.object, L = s.lensX, u = L - o.x, v = (u * c.f) / (u - c.f), I = { x: L + v, y: (-v / u) * o.y };
        const O = { x: L, y: 0 }, F = { x: L - c.f, y: 0 }, F2 = { x: L + c.f, y: 0 }, sg = spec.segments;
        const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
        const rays = sg.filter((x) => x.kind === 'ray'), ext = sg.filter((x) => x.kind === 'extension');
        const inside = rays.every((x) => x.b.x <= 1e-9 && Math.abs(x.b.y) <= c.world.axisHeight + 1e-9);
        return [
          { ok: v < 0 && -v / u > 1, label: '虛像：像距為負、放大率 > 1（正立、放大）', detail: 'v=' + v.toFixed(1) + '，m=' + (-v / u).toFixed(2) },
          { ok: rays.length === 6 && ext.length === 3, label: '六段實際光線（實線）＋三段反向延長線（虛線）' },
          { ok: same(sg[0].a, o) && same(sg[1].a, o) && same(sg[4].a, o), label: '三條光線都從鬼本體出發' },
          { ok: same(sg[0].b, { x: L, y: o.y }) && collinear(sg[2].a, sg[2].b, F2) < 1e-6, label: '平行主軸的光線折射後朝 F′ 的方向走' },
          { ok: same(sg[1].b, O) && collinear(o, sg[3].b, O) < 1e-6, label: '過光心的光線不偏折' },
          { ok: collinear(o, sg[4].b, F) < 1e-6 && Math.abs(sg[5].b.y - sg[5].a.y) < 1e-9 && Math.abs(sg[4].b.y) < c.world.lensRadius, label: '從 F 方向來的光線折射後平行主光軸，打在鏡片內' },
          { ok: !same(sg[2].b, sg[3].b) && !same(sg[3].b, sg[5].b) && inside, label: '折射後的光線發散，到布幕（或地板／天花板）為止，沒有會聚成像' },
          { ok: ext.every((x) => same(x.b, I)) && same(ext[0].a, sg[2].a) && same(ext[1].a, sg[3].a) && same(ext[2].a, sg[5].a) && same(spec.points[0].p, I) && same(I, { x: s.marker.x, y: s.marker.y }),
            label: '三條反向延長線交在虛像（= 玩家的標記）', detail: '(' + I.x.toFixed(1) + ', ' + I.y.toFixed(1) + ')' }
        ];
      }
    });
  }

  ok(errors.length === 0, P('沒有 JS 錯誤'), errors.join(' | ') || undefined);
  await context.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  URL = 'http://127.0.0.1:' + server.address().port + '/prototype/convex-lens/index.html?free=1'; // 自由練習模式：可指定配置、不計命。關卡流程由 e2e-convex-level.js 測
  const browser = await chromium.launch();
  for (const p of PROFILES) {
    try { await run(p, browser); } catch (e) { ok(false, '[' + p.name + '] 測試腳本例外', e.message); }
  }
  await browser.close();
  server.close();
  const summary = (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks';
  console.log('\n' + summary);
  fs.writeFileSync(path.join(SHOTS, 'e2e-results-convex.txt'), results.join('\n') + '\n\n' + summary + '\n');
  process.exit(failures === 0 ? 0 : 1);
})();

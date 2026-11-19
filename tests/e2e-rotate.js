#!/usr/bin/env node
/*
 * 手機直拿、網址不帶 ?portrait=1 時「整個遊戲轉 90°」的 headless 實測：node tests/e2e-rotate.js
 * （PROJECT.md PENDING 19、試玩回饋 G3 後半；轉向本身在 prototype/shared/landscape.js）
 *
 * 用 390×844 直向觸控手機開三關、選單、排行榜，檢查：
 *   - <html> 有 gl-rot、遊戲看到的版面是橫的（寬 > 高），各頁走橫向版面（@media 用對調後的寬高）
 *   - 所有看得見的按鈕都在螢幕內、而且點得到（elementFromPoint 打到自己）
 *   - 真的觸控點格子、拖曳畫線／平移，遊戲收到的座標正確（換算錯的話會點到別格、吸附不到點）
 *   - 頁面不捲動
 * 原本各關 e2e 的直向情境都帶 ?portrait=1（不轉），不受影響。
 * 這只是 headless Chromium 模擬，**一定要在實體手機上再驗證**（iOS Safari、Android Chrome）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
let BASE = null;
const SHOTS = path.join(ROOT, 'docs/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const VIEW = { width: 390, height: 844 };

let failures = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) failures++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + detail : ''));
}

async function open(browser, url) {
  const context = await browser.newContext({ viewport: VIEW, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await context.route('**/shared/leaderboard-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.LEADERBOARD_URL = '';" }));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + url);
  await page.waitForTimeout(150);
  return { context, page, cdp, errors };
}

// 共用檢查：有轉、遊戲方向是橫的、按鈕都在螢幕內而且點得到、頁面沒捲動
async function common(page, where, opts) {
  const r = await page.evaluate(() => {
    const L = window.GameLandscape, vp = L.viewport();
    const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden'; };
    const btns = Array.from(document.querySelectorAll('button, a.btn, a.card, .story-btn')).filter(vis).map((el) => {
      const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, hit = document.elementFromPoint(cx, cy);
      return { id: el.id || el.className || el.textContent.trim().slice(0, 8), inside: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1, hit: !!hit && (hit === el || el.contains(hit)) };
    });
    return { rot: L.isRotated(), cls: document.documentElement.classList.contains('gl-rot'), vp, btns,
      scroll: window.scrollX + window.scrollY + document.documentElement.scrollTop + document.documentElement.scrollLeft };
  });
  ok(r.rot && r.cls, where + '：直拿手機自動轉 90°（html.gl-rot）');
  ok(r.vp.width === VIEW.height && r.vp.height === VIEW.width, where + '：遊戲看到的視窗是橫的', r.vp.width + '×' + r.vp.height);
  const out = r.btns.filter((b) => !b.inside).map((b) => b.id), blocked = r.btns.filter((b) => b.inside && !b.hit).map((b) => b.id);
  if (opts && opts.scrolls) ok(r.btns.length > 0, where + '：有按鈕（' + r.btns.length + ' 顆，內容比畫面高的部分要捲動才看得到）', out.join(',') || undefined);
  else ok(r.btns.length > 0 && out.length === 0, where + '：看得見的按鈕都在螢幕內（' + r.btns.length + ' 顆）', out.join(',') || undefined);
  if (!(opts && opts.allowCovered)) ok(blocked.length === 0, where + '：按鈕都點得到（沒被蓋住）', blocked.join(',') || undefined);
  ok(r.scroll === 0, where + '：頁面沒有捲動', String(r.scroll));
  return r;
}
async function noScroll(page, where) {
  const s = await page.evaluate(() => ({ win: window.scrollX + window.scrollY, doc: document.documentElement.scrollTop + document.documentElement.scrollLeft, body: document.body.scrollTop + document.body.scrollLeft }));
  ok(s.win === 0 && s.doc === 0 && s.body === 0, where + '：操作後頁面沒有捲動', JSON.stringify(s));
}
// 元素內的遊戲座標 → 螢幕座標
const toClient = (page, sel, p) => page.evaluate(({ sel, p }) => window.GameLandscape.toClient(p, document.querySelector(sel)), { sel, p });
// 用 CDP 送一串觸控（螢幕座標），模擬手指拖曳
async function touchPath(cdp, page, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
  for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 5; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k / 5, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k / 5, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}
// headless Chromium：CDP 觸控拖曳結束後緊接的第一次點擊不會產生 click（測試工具的現象，見其他 e2e）。點一下狀態列消耗掉。
async function eatClick(page) { await page.tap('#status'); await page.waitForTimeout(40); }

async function mirror(browser) {
  console.log('\n===== 第一關 鏡子房間（直拿 390×844） =====');
  // 正式關卡：開場過場要能點、按鈕要點得到
  {
    const { context, page, errors } = await open(browser, '/prototype/plane-mirror/index.html');
    await page.waitForFunction(() => window.__protoMirror && window.__protoMirror.art().intact && window.__protoMirror.art().ghost);
    await page.waitForFunction(() => window.__protoMirror.scene());
    ok((await page.evaluate(() => window.__protoMirror.scene().line)) === 0, '第一關：開場過場第一句');
    await page.touchscreen.tap(VIEW.width / 2, VIEW.height / 2);
    await page.waitForTimeout(80);
    ok((await page.evaluate(() => window.__protoMirror.scene().line)) === 1, '第一關：轉向後點過場畫面換下一句');
    await page.screenshot({ path: path.join(SHOTS, 'rotate-mirror-intro.png') });
    ok(errors.length === 0, '第一關（過場）：沒有 JS 錯誤', errors.join(' | ') || undefined);
    await context.close();
  }
  const { context, page, cdp, errors } = await open(browser, '/prototype/plane-mirror/index.html?free=1');
  await page.waitForFunction(() => window.__protoMirror && window.__protoMirror.art().intact && window.__protoMirror.art().ghost);
  await common(page, '第一關');
  const info = await page.evaluate(() => window.__protoMirror.canvasInfo());
  ok(info.W > info.H, '第一關：畫布是橫的', info.W + '×' + info.H);
  const lay = await page.evaluate(() => {
    const L = window.GameLandscape, a = document.getElementById('app'), st = L.size(document.getElementById('stage')), sd = L.size(document.getElementById('side'));
    return { cols: getComputedStyle(a).gridTemplateColumns.split(' ').length, st, sd };
  });
  ok(lay.cols === 2 && Math.abs(lay.st.height - VIEW.width) < 2 && lay.sd.width >= 150, '第一關：走橫向版面（右側欄，不是直向的上下排）', '側欄 ' + Math.round(lay.sd.width) + 'px 寬');

  // 點格子：用 cellClient（影像座標 → 螢幕座標，經過 GameLandscape.toClient）
  const sel = await page.evaluate(() => window.__protoMirror.selectable.map((c) => ({ col: c.col, row: c.row })));
  const picks = [sel[0], sel[Math.floor(sel.length / 2)], sel[sel.length - 1]];
  for (const c of picks) {
    const p = await page.evaluate((c) => window.__protoMirror.cellClient(c.col, c.row), c);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(60);
    const s = await page.evaluate(() => window.__protoMirror.state.selected);
    ok(s && s.col === c.col && s.row === c.row, '第一關：點 c' + c.col + 'r' + c.row + ' 選到同一格', s ? 'c' + s.col + 'r' + s.row : 'null');
  }
  // 放大按鈕、拖曳平移方向
  await page.tap('#zoomIn'); await page.waitForTimeout(60);
  ok((await page.evaluate(() => window.__protoMirror.canvasInfo().zoom)) > 1, '第一關：「＋」按鈕點得到（放大）');
  const before = await page.evaluate(() => window.__protoMirror.canvasInfo());
  const a = await toClient(page, '#view', { x: info.W * 0.5, y: info.H * 0.5 }), b = await toClient(page, '#view', { x: info.W * 0.5 + 60, y: info.H * 0.5 });
  await touchPath(cdp, page, [a, b]);
  await eatClick(page);
  const after = await page.evaluate(() => window.__protoMirror.canvasInfo());
  ok(after.OX - before.OX > 40 && Math.abs(after.OY - before.OY) < 5, '第一關：手指往遊戲的右邊拖，畫面往右平移（x、y 沒對調）', 'ΔOX=' + (after.OX - before.OX).toFixed(0) + ' ΔOY=' + (after.OY - before.OY).toFixed(0));
  await page.tap('#zoomFit'); await page.waitForTimeout(60);
  // 施放
  const c = picks[0];
  const p = await page.evaluate((c) => window.__protoMirror.cellClient(c.col, c.row), c);
  await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(60);
  await page.tap('#castBtn'); await page.waitForTimeout(80);
  ok((await page.evaluate(() => window.__protoMirror.stats.casts)) >= 1, '第一關：「展開封印法陣」按鈕點得到');
  await noScroll(page, '第一關');
  await page.screenshot({ path: path.join(SHOTS, 'rotate-mirror.png') });
  ok(errors.length === 0, '第一關：沒有 JS 錯誤', errors.join(' | ') || undefined);
  await context.close();
}

// 第二、三關共用：進光路分析 → 點格子 → 點兩點畫線 → 拖曳畫線
async function lens(browser, o) {
  console.log('\n===== ' + o.name + '（直拿 390×844） =====');
  const { context, page, cdp, errors } = await open(browser, o.url);
  await page.waitForFunction((h) => window[h], o.hook);
  await common(page, o.name + '：探索');
  const cs = await page.evaluate(() => window.GameLandscape.size(document.getElementById('view')));
  ok(cs.width > cs.height && cs.height > 150, o.name + '：畫布是橫的', Math.round(cs.width) + '×' + Math.round(cs.height));
  await o.toAnalysis(page);
  ok((await page.evaluate((h) => window[h].state.phase, o.hook)) === 'analysis', o.name + '：按鈕點得到、進入光路分析');
  await common(page, o.name + '：光路分析');
  const H = o.hook;
  const w2c = async (wp) => { const sp = await page.evaluate(({ H, wp }) => window[H].w2s(wp), { H, wp }); return toClient(page, '#view', sp); };
  const snapC = async (id) => { const q = await page.evaluate(({ H, id }) => window[H].snapPoints().find((p) => p.id === id), { H, id }); if (!q) throw new Error('no snap ' + id); return w2c(q); };

  // 點地板格
  await page.tap('#modeSeal'); await page.waitForTimeout(40);
  for (const cell of o.cells) {
    const p = await w2c({ x: -(cell - 0.5) * 100, y: o.cellY });
    await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(60);
    const s = await page.evaluate((H) => window[H].state.selectedCell, H);
    ok(s === cell, o.name + '：點第 ' + cell + ' 格選到同一格', String(s));
  }
  // 點兩個標示點畫線
  await page.tap('#modeDraw'); await page.waitForTimeout(40);
  const n0 = await page.evaluate((H) => window[H].state.lines.length, H);
  const [i1, i2] = o.tapLine;
  let a = await snapC(i1), b = await snapC(i2);
  await page.touchscreen.tap(a.x, a.y); await page.waitForTimeout(50);
  await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(60);
  const n1 = await page.evaluate((H) => window[H].state.lines.length, H);
  ok(n1 === n0 + 1, o.name + '：依序點 ' + i1 + '、' + i2 + ' 畫出一條線', n0 + ' → ' + n1);
  // 拖曳畫線：從一個標示點拖到另一個
  const [d1, d2] = o.dragLine;
  a = await snapC(d1); b = await snapC(d2);
  await touchPath(cdp, page, [a, b]);
  await eatClick(page);
  const r = await page.evaluate(({ H, d1, d2 }) => {
    const s = window[H].state, l = s.lines[s.lines.length - 1], pts = window[H].snapPoints();
    const A = pts.find((p) => p.id === d1), B = pts.find((p) => p.id === d2);
    const near = (p, q) => p && q && Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
    return { n: s.lines.length, ends: l && l.b ? ((near(l.a, A) && near(l.b, B)) || (near(l.a, B) && near(l.b, A))) : false };
  }, { H, d1, d2 });
  ok(r.n === n1 + 1 && r.ends, o.name + '：從 ' + d1 + ' 拖到 ' + d2 + ' 畫出一條線，兩端吸附在這兩點', 'lines=' + r.n);
  await noScroll(page, o.name);
  await page.screenshot({ path: path.join(SHOTS, 'rotate-' + o.shot + '.png') });
  ok(errors.length === 0, o.name + '：沒有 JS 錯誤', errors.join(' | ') || undefined);
  await context.close();
}

async function pages(browser) {
  console.log('\n===== 選單、排行榜（直拿 390×844） =====');
  {
    const { context, page, cdp, errors } = await open(browser, '/prototype/index.html?unlock=1');
    await common(page, '選單', { scrolls: true });
    await page.screenshot({ path: path.join(SHOTS, 'rotate-menu.png') });
    // 選單內容（?unlock=1 全部顯示）比轉過的畫面高：手指往遊戲的「上」滑，在 <main> 裡捲動，頁面本身不捲
    const inView = () => page.evaluate(() => { const b = document.getElementById('resetBtn').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; });
    const hidden0 = !(await inView());
    // 遊戲座標 (x, y) → 螢幕：遊戲的「往上」= 螢幕的往右
    await touchPath(cdp, page, [{ x: 60, y: 420 }, { x: 330, y: 420 }]);
    await page.waitForTimeout(400);
    const sc = await page.evaluate(() => ({ main: document.querySelector('main').scrollTop, body: document.body.scrollTop, win: window.scrollY + window.scrollX }));
    ok(hidden0 && sc.main > 0 && sc.body === 0 && sc.win === 0 && await inView(), '選單：手指往遊戲上方滑可以捲到最下面的「重新開始遊戲」（捲的是 <main>，頁面不動）', JSON.stringify(sc));
    await page.evaluate(() => { document.querySelector('main').scrollTop = 0; });
    const href = await page.evaluate(() => document.querySelector('a.card').getAttribute('href'));
    await Promise.all([page.waitForURL((u) => u.pathname.endsWith(href.replace(/\?.*$/, '').replace(/^\.?\/?/, '')) || /fstip=1/.test(u.search)), page.tap('a.card')]);
    ok(true, '選單：轉向後點第一張卡片可以進關（或跳全螢幕教學）');
    ok(errors.length === 0, '選單：沒有 JS 錯誤', errors.join(' | ') || undefined);
    await context.close();
  }
  {
    const { context, page, errors } = await open(browser, '/prototype/leaderboard.html');
    await page.waitForFunction(() => document.getElementById('mode').textContent !== '讀取中…');
    await common(page, '排行榜');
    await Promise.all([page.waitForURL(/prototype\/index\.html$/), page.tap('a.btn[href="index.html"]')]);
    ok(true, '排行榜：「← 選單」點得到');
    ok(errors.length === 0, '排行榜：沒有 JS 錯誤', errors.join(' | ') || undefined);
    await context.close();
  }
  // ?portrait=1 關掉轉向
  {
    const { context, page } = await open(browser, '/prototype/concave-lens/index.html?portrait=1&free=1');
    ok(!(await page.evaluate(() => window.GameLandscape.isRotated() || document.documentElement.classList.contains('gl-rot'))), '?portrait=1：不轉向（舊的直向測試照舊）');
    await context.close();
  }
  // 橫拿的手機、桌機不轉
  for (const vp of [{ width: 844, height: 390, touch: true }, { width: 900, height: 1200, touch: false }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });
    const page = await context.newPage();
    await page.goto(BASE + '/prototype/convex-lens/index.html?free=1');
    ok(!(await page.evaluate(() => window.GameLandscape.isRotated())), (vp.touch ? '橫拿手機' : '直立的桌機視窗（滑鼠）') + '：不轉向');
    await context.close();
  }
  // 拿著手機轉成橫的（視窗變寬）→ 取消轉向；再轉回直的 → 又轉
  {
    const { context, page } = await open(browser, '/prototype/concave-lens/index.html?free=1');
    await page.waitForFunction(() => window.__proto);
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(150);
    const l = await page.evaluate(() => ({ rot: window.GameLandscape.isRotated(), W: window.__proto.canvasSize ? window.__proto.canvasSize() : null }));
    await page.setViewportSize(VIEW); await page.waitForTimeout(150);
    const p = await page.evaluate(() => ({ rot: window.GameLandscape.isRotated(), sz: window.GameLandscape.size(document.getElementById('view')) }));
    ok(!l.rot && p.rot && p.sz.width > p.sz.height, '手機轉橫 → 不轉；轉回直 → 又轉 90°，畫布仍是橫的', JSON.stringify(p.sz));
    await context.close();
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  await mirror(browser);
  await lens(browser, {
    name: '第二關 凸透鏡走廊', shot: 'convex', hook: '__protoConvex', url: '/prototype/convex-lens/index.html?free=1',
    cells: [2, 4], cellY: 40, tapLine: ['O', 'F'], dragLine: ['F', 'O'],
    toAnalysis: async (page) => {
      await page.evaluate(() => { const H = window.__protoConvex, c = H.cfg(); H.state.lensX = c.kind === 'virtual' ? c.virtualLensX : c.sharp[1].lensX; H.render(); });
      const virt = await page.evaluate(() => window.__protoConvex.cfg().kind === 'virtual');
      if (virt) await page.tap('#lookLens');
      await page.tap('#markBtn'); await page.waitForTimeout(60);
      await page.tap('#toAnalysis'); await page.waitForTimeout(150);
    }
  });
  await lens(browser, {
    name: '第三關 凹透鏡', shot: 'concave', hook: '__proto', url: '/prototype/concave-lens/index.html?free=1',
    cells: [2, 4], cellY: 60, tapLine: ['I', 'O'], dragLine: ['F', 'O'],
    toAnalysis: async (page) => {
      await page.evaluate(() => { const H = window.__proto, c = H.cfg(); H.state.marker = { dir: c.direction, tanX: 0, tanY: H.imageScreenPos().tan }; H.render(); });
      await page.tap('#lensBtn'); await page.waitForTimeout(40); await page.tap('#lensBtn'); await page.waitForTimeout(40);
      await page.tap('#toAnalysis'); await page.waitForTimeout(150);
    }
  });
  await pages(browser);
  await browser.close();
  server.close();
  console.log((failures ? 'FAILED ' : 'OK ') + (checks - failures) + '/' + checks + ' rotate e2e checks');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

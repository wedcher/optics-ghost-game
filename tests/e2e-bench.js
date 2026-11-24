// 實驗桌模擬器 e2e：拖曳底座、標記像、進分析、自己拖曳畫三條光線，檢查交點就是像。node tests/e2e-bench.js [截圖資料夾]
const { chromium } = require('playwright');
const path = require('path');
let fails = 0, n = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('FAIL', msg); } }
(async () => {
  const shots = process.argv[2];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '../bench/index.html')); await p.waitForTimeout(200);
  const st = () => p.evaluate(() => JSON.parse(JSON.stringify(BenchDebug.state)));
  const px = (x, h) => p.evaluate(([x, h]) => ({ x: BenchDebug.X(x), y: BenchDebug.PY(h) }), [x, h]);
  async function drag(a, b2) { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + b2.x) / 2, (a.y + b2.y) / 2, { steps: 4 }); await p.mouse.move(b2.x, b2.y, { steps: 4 }); await p.mouse.up(); }

  // 1. 拖曳光屏到像清楚的位置（物距 25 → 像距 16.67 → x = 46.67）
  const g = await p.evaluate(() => ({ x0: BenchDebug.geom.x0, k: BenchDebug.geom.k, base: BenchDebug.geom.baseY }));
  const yb = g.base - 0.8 * g.k;
  await drag({ x: g.x0 + 62 * g.k, y: yb }, { x: g.x0 + 46.7 * g.k, y: yb });
  let s = await st(); ok(Math.abs(s.screenX - 46.7) < 0.3, '拖曳光屏 → ' + s.screenX);
  // 2. 還沒標記就按「分析光路」：不能進去
  await p.click('#b-ana'); s = await st(); ok(s.mode === 'obs', '沒標記不能分析');
  // 3. 標記
  await p.click('#b-mark'); s = await st(); ok(s.marker && !s.marker.virtual, '標記實像'); ok(Math.abs(s.marker.x - (30 + 50 / 3)) < 0.01, '標記位置 = 像位置');
  // 4. 進分析
  await p.click('#b-ana'); s = await st(); ok(s.mode === 'ana', '進入分析');
  const T = await px(5, 3.75), Ptop = await px(30, 3.75), F2 = await px(40, 0), O = await px(30, 0);
  // 平行光：從「物」往右水平拉
  await drag(T, { x: T.x + 120, y: T.y }); s = await st(); ok(s.lines.length === 1 && s.lines[0].kind === 'parallel', '水平線 ' + JSON.stringify(s.lines[0]));
  // 通過 P 與 F′：從 P 往 F′ 拉
  await drag(Ptop, F2); s = await st(); ok(s.lines.length === 2 && s.lines[1].kind === 'line' && s.lines[1].b.label === 'F′', '通過 P 與 F′');
  // 通過光心：從物拉向 O
  await drag(T, O); s = await st(); ok(s.lines.length === 3 && s.lines[2].b.label === 'O', '通過物與 O');
  // 沒吸附的虛線：放開會消失
  await drag(T, { x: T.x + 60, y: T.y - 35 }); s = await st(); ok(s.lines.length === 3, '虛線放開不留下');
  await p.screenshot({ path: path.join(shots || '/tmp', 'bench-ana.png') });
  // 兩條光線（P→F′ 與 物→O）的交點 = 像
  const inter = await p.evaluate(() => {
    const L = BenchDebug.state.lines, g = l => l.kind === 'line' ? { p: l.a, d: { x: l.b.x - l.a.x, y: l.b.y - l.a.y } } : { p: l.a, d: { x: 1, y: 0 } };
    const a = g(L[1]), c = g(L[2]), den = a.d.x * c.d.y - a.d.y * c.d.x, t = ((c.p.x - a.p.x) * c.d.y - (c.p.y - a.p.y) * c.d.x) / den;
    return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y, m: BenchDebug.state.marker };
  });
  ok(Math.hypot(inter.x - inter.m.x, inter.y - inter.m.y) < 0.05, '兩條光線的交點就是像 ' + JSON.stringify(inter));
  // 5. 復原／清除／回實驗桌；移動燈具會清掉標記與線
  await p.click('#b-undo'); s = await st(); ok(s.lines.length === 2, '復原');
  await p.click('#b-clear'); s = await st(); ok(s.lines.length === 0, '清除');
  await p.click('#b-back'); s = await st(); ok(s.mode === 'obs' && s.marker, '回實驗桌，標記還在');
  await drag({ x: g.x0 + 3 * g.k, y: yb }, { x: g.x0 + 8 * g.k, y: yb }); s = await st(); ok(s.objX !== 5 && s.marker === null, '移動燈具 → 標記清掉');
  // 6. 凹透鏡：標記虛像、分析
  await p.click('#b-concave'); await p.click('#b-mark'); s = await st(); ok(s.marker && s.marker.virtual && s.marker.y > 0, '凹透鏡標記虛像（正立）');
  await p.click('#b-ana'); s = await st(); ok(s.mode === 'ana', '凹透鏡進入分析');
  await p.screenshot({ path: path.join(shots || '/tmp', 'bench-ana-concave.png') });

  // 7. 燈具經過 F（x=20）、2F（x=10）時吸附：拖到 20.4 → 20、拖到 10.5 → 10、拖到 15 → 不吸附
  await p.click('#b-back'); await p.click('#b-reset'); await p.click('#b-convex'); s = await st();
  async function dragLamp(toX) { const cur = (await st()).objX; await drag({ x: g.x0 + (cur - 2) * g.k, y: yb }, { x: g.x0 + (toX - 2) * g.k, y: yb }); return (await st()).objX; }
  ok(await dragLamp(20.4) === 20, '吸附在 F');
  ok(await dragLamp(10.5) === 10, '吸附在 2F');
  const free = await dragLamp(15); ok(free !== 10 && free !== 20 && Math.abs(free - 15) < 0.3, '15 不吸附 → ' + free);
  // 8. 光屏左右微調：按一下 0.1 cm，按住會連續移動
  await p.click('#b-reset'); s = await st(); const s0 = s.screenX;
  let nr = await p.evaluate(() => BenchDebug.nudgeRects());
  await p.mouse.click(nr[1].x + 24, nr[1].y + 24); s = await st(); ok(Math.abs(s.screenX - (s0 + 0.1)) < 0.001, '右鈕 +0.1 → ' + s.screenX);
  nr = await p.evaluate(() => BenchDebug.nudgeRects());
  await p.mouse.click(nr[0].x + 24, nr[0].y + 24); await p.mouse.click(nr[0].x + 24, nr[0].y + 24); s = await st(); ok(Math.abs(s.screenX - (s0 - 0.1)) < 0.001, '左鈕兩下 → ' + s.screenX);
  nr = await p.evaluate(() => BenchDebug.nudgeRects());
  await p.mouse.move(nr[1].x + 24, nr[1].y + 24); await p.mouse.down(); await p.waitForTimeout(900); await p.mouse.up(); s = await st(); ok(s.screenX > s0 + 0.5, '按住連續微調 → ' + s.screenX);
  // 微調不會清掉標記
  await p.click('#b-reset'); await drag({ x: g.x0 + 62 * g.k, y: yb }, { x: g.x0 + 46.7 * g.k, y: yb }); await p.click('#b-mark');
  nr = await p.evaluate(() => BenchDebug.nudgeRects()); await p.mouse.click(nr[1].x + 24, nr[1].y + 24); s = await st(); ok(s.marker, '微調光屏不清掉標記');
  // 9. 「對答案」：動畫跑完後，畫面上有粗線（取樣光線的顏色）
  await p.click('#b-ana'); await p.click('#t-ans'); await p.waitForTimeout(1700);
  await p.screenshot({ path: path.join(shots || '/tmp', 'bench-ans.png') });
  // 10. 全螢幕按鈕在右下角（燈具正面旁）；不支援的瀏覽器會隱藏
  const fb = await p.evaluate(() => { const b = document.getElementById('b-full'), r = b.getBoundingClientRect(); return { hidden: b.hidden, r: [r.right, r.bottom], vw: innerWidth, vh: innerHeight }; });
  ok(fb.hidden || (fb.r[0] > fb.vw - 20 && fb.r[1] > fb.vh - 20), '全螢幕鈕在右下角 ' + JSON.stringify(fb));
  await p.screenshot({ path: path.join(shots || '/tmp', 'bench-full.png') });
  ok(errs.length === 0, '沒有 JS 錯誤（新功能）' + JSON.stringify(errs));

  // 11. 手機直拿：整個畫面轉 90° 變橫的，拖曳與按鈕照常
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const q = await m.newPage(); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto('file://' + path.resolve(__dirname, '../bench/index.html')); await q.waitForTimeout(300);
  const rot = await q.evaluate(() => ({ cls: document.documentElement.classList.contains('gl-rot'), W: BenchDebug.geom.W, H: BenchDebug.geom.H }));
  ok(rot.cls && rot.W > rot.H, '直拿時轉成橫的 ' + JSON.stringify(rot));
  const gq = await q.evaluate(() => ({ x0: BenchDebug.geom.x0, k: BenchDebug.geom.k, base: BenchDebug.geom.baseY }));
  const cl = (x, y) => q.evaluate(([x, y]) => BenchLandscape.toClient({ x, y }, document.getElementById('c')), [x, y]);
  const a1 = await cl(gq.x0 + 62 * gq.k, gq.base - 0.8 * gq.k), a2 = await cl(gq.x0 + 50 * gq.k, gq.base - 0.8 * gq.k);
  await q.mouse.move(a1.x, a1.y); await q.mouse.down(); await q.mouse.move((a1.x + a2.x) / 2, (a1.y + a2.y) / 2, { steps: 4 }); await q.mouse.move(a2.x, a2.y, { steps: 4 }); await q.mouse.up();
  const sx = await q.evaluate(() => BenchDebug.state.screenX); ok(Math.abs(sx - 50) < 0.4, '直拿時拖曳光屏 → ' + sx);
  const bc = await q.evaluate(() => { const r = document.getElementById('b-mark').getBoundingClientRect(); return BenchLandscape.toClient({ x: 0, y: 0 }, document.getElementById('c')) && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await q.mouse.click(bc.x, bc.y); // 按「標記像」（沒對準，會提示但不會出錯）
  await q.screenshot({ path: path.join(shots || '/tmp', 'bench-rot.png') });
  ok(errs2.length === 0, '直拿沒有 JS 錯誤 ' + JSON.stringify(errs2));
  ok(errs.length === 0, '沒有 JS 錯誤 ' + JSON.stringify(errs));
  console.log(n + ' checks, ' + fails + ' failed'); await b.close(); process.exit(fails ? 1 : 0);
})();

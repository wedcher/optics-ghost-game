#!/usr/bin/env node
/*
 * 第一關（平面鏡房間）的 headless 瀏覽器實測：node tests/e2e-plane-mirror.js
 * 需要 Playwright（npm ci && npx playwright install chromium）。
 *
 * 幾何本身由 check-geometry-mirror.js 測；這裡測畫面、操作與關卡流程：
 *   - 開場過場；兩面鏡抓 2 次 → 打碎鏡子的過場 → 一面鏡抓 3 次 → 過關演出
 *   - 抓錯扣一顆心、鬼不換位置；命數跨過「打碎鏡子」不補；命用完 → 失敗畫面 → 重新挑戰
 *   - 鬼只出現在鏡子裡；抓錯全程不洩漏位置；選格標示與法陣不會出現在鏡子裡
 *   - 點鏡子裡的像：只有提醒，不扣命
 *   - 每一格都點得到；放大／平移／全圖；版面
 * 都是真的點擊（手機用觸控）。只有「把鬼放到指定格」用測試掛鉤。
 * 截圖輸出到 docs/screenshots/mirror-*.png。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
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

let failures = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) failures++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + detail : ''));
}

const PROFILES = [
  { name: 'phone-landscape', viewport: { width: 812, height: 375 }, touch: true, dsf: 2, shots: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false, dsf: 1, shots: false }
];
const ARM_WAIT = 420; // 過場的結尾按鈕出現後 350 ms 內不接受點擊
const LEAK_WORDS = /[左右前後遠近]|第\s*\d|[欄排]|c\dr\d/; // 抓錯的訊息不能有方向、距離、格號

async function open(profile, browser, query) {
  const context = await browser.newContext({ viewport: profile.viewport, hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: profile.dsf });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  await page.goto(BASE + '/prototype/plane-mirror/index.html' + query);
  await page.waitForFunction(() => window.__protoMirror && window.__protoMirror.art().intact && window.__protoMirror.art().broken);
  const tapAt = (x, y) => profile.touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
  const press = (sel) => profile.touch ? page.tap(sel) : page.click(sel);
  const info = () => page.evaluate(() => {
    const m = window.__protoMirror, s = m.state, id = (c) => c ? m.core.cellId(c.col, c.row) : null;
    return { lives: s.lives, sealed: s.sealed, phase: s.phase, ghost: id(s.ghost), selected: id(s.selected), revealed: s.revealed, busy: s.busy, over: s.over,
      images: Object.assign({}, m.stats.images), stats: Object.assign({}, m.stats), scene: m.scene(), intact: m.intactMirrors(),
      status: document.getElementById('status').textContent, hearts: document.querySelectorAll('#hearts span:not(.lost)').length,
      sealText: document.getElementById('sealCount').textContent, castDisabled: document.getElementById('castBtn').disabled,
      castHidden: document.getElementById('castBtn').hidden, nextHidden: document.getElementById('nextBtn').hidden, nextText: document.getElementById('nextBtn').textContent,
      zoom: m.canvasInfo().zoom };
  });
  // 數畫布上「鬼的顏色」與「選格標示的顏色」的像素，分成鏡面內、鏡面外
  const pixels = () => page.evaluate(() => {
    const m = window.__protoMirror, ci = m.canvasInfo(), cv = document.getElementById('view');
    m.render();
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const polys = m.intactMirrors().map((id) => m.glassPoly(id));
    const out = { ghostIn: 0, ghostOut: 0, pickIn: 0, pickOut: 0, magicIn: 0, magicOut: 0 };
    for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
      const i = (y * cv.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const ghost = Math.abs(r - 157) <= 26 && Math.abs(g - 255) <= 26 && Math.abs(b - 216) <= 26;
      const pick = Math.abs(r - 255) <= 8 && Math.abs(g - 209) <= 8 && Math.abs(b - 102) <= 8;
      const magic = Math.abs(r - 217) <= 12 && Math.abs(g - 168) <= 12 && Math.abs(b - 255) <= 12;
      if (!ghost && !pick && !magic) continue;
      const p = { x: (x / ci.DPR - ci.OX) / ci.S, y: (y / ci.DPR - ci.OY) / ci.S };
      const inside = polys.some((poly) => m.core.pointInPoly(p, poly));
      if (ghost) out[inside ? 'ghostIn' : 'ghostOut']++;
      if (pick) out[inside ? 'pickIn' : 'pickOut']++;
      if (magic) out[inside ? 'magicIn' : 'magicOut']++;
    }
    return out;
  });
  const cellPt = (cell) => page.evaluate((c) => { const m = window.__protoMirror; return m.cellClient(Number(c[1]), Number(c[3])); }, cell);
  const tapCell = async (cell) => { const p = await cellPt(cell); await tapAt(p.x, p.y); };
  const otherCell = (ghost, n) => page.evaluate(([g, k]) => {
    // 挑不貼著鏡子的格子（第 2 排以後、第 1～3 欄）：選格的外框才不會壓到鏡面邊緣
    const m = window.__protoMirror; return m.selectable.filter((c) => c.row >= 2 && c.col <= 3).map((c) => m.core.cellId(c.col, c.row)).filter((c) => c !== g)[k || 0];
  }, [ghost, n || 0]);
  const shot = async (name) => { if (profile.shots) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const catchGhost = async () => {
    const g = (await info()).ghost;
    await tapCell(g);
    await press('#castBtn');
    await page.waitForFunction(() => window.__protoMirror.state.revealed);
    return g;
  };
  const castWrong = async (n) => {
    const g = (await info()).ghost;
    await tapCell(await otherCell(g, n));
    await press('#castBtn');
  };
  const waitIdle = () => page.waitForFunction(() => { const s = window.__protoMirror.state; return !s.busy && !s.cast; });
  return { context, page, errors, tapAt, press, info, pixels, cellPt, tapCell, otherCell, shot, catchGhost, castWrong, waitIdle };
}

async function levelFlow(profile, browser) {
  console.log('\n===== ' + profile.name + '：關卡流程 =====');
  const t = await open(profile, browser, '');
  const { page, press, info, pixels, shot } = t;
  const vp = profile.viewport;

  // ---- 開場 ----
  let s = await info();
  ok(s.scene && s.scene.id === 'intro' && s.scene.line === 0, '一進來是開場過場的第一句');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.story-bg')).backgroundImage.includes('room-intact')), '開場背景是鏡子完好的房間');
  await shot('mirror-1-intro');
  for (let i = 1; i <= 3; i++) {
    await t.tapAt(vp.width / 2, vp.height / 2);
    s = await info();
    ok(s.scene.line === i && !s.scene.ended, '點畫面換到第 ' + (i + 1) + ' 句');
  }
  ok(!(await page.isVisible('#startBtn')), '最後一句時還沒有【開始抓鬼】');
  await t.tapAt(vp.width / 2, vp.height / 2);
  ok((await info()).scene.ended && await page.isVisible('#startBtn'), '台詞結束後出現【開始抓鬼】');
  await page.waitForTimeout(ARM_WAIT);
  await press('#startBtn');
  s = await info();
  ok(s.scene === null, '按【開始抓鬼】後進入房間');
  ok(s.lives === 3 && s.hearts === 3 && s.sealed === 0 && s.phase === 1, '3 條命、封印 0、兩面鏡', JSON.stringify([s.lives, s.sealed, s.phase]));
  ok(s.intact.join() === 'back,right', '兩面鏡都完好');
  ok(await page.evaluate(() => window.__protoMirror.pools[1].some((c) => window.__protoMirror.core.cellId(c.col, c.row) === window.__protoMirror.core.cellId(window.__protoMirror.state.ghost.col, window.__protoMirror.state.ghost.row))), '鬼在雙鏡出題格內', s.ghost);
  ok(s.images.back && s.images.right, '兩面鏡裡都有鬼的像');
  let px = await pixels();
  ok(px.ghostIn > 0 && px.ghostOut === 0, '鬼只出現在鏡子裡，房間裡看不到', JSON.stringify(px));
  ok(s.castDisabled, '還沒選格時不能施放');
  await shot('mirror-2-two-mirrors');

  // ---- 點鏡子裡的像：只提醒，不扣命 ----
  const imgPt = await page.evaluate(() => {
    const m = window.__protoMirror, g = m.state.ghost, c = m.core.cellCenter(g.col, g.row);
    const v = { back: m.core.visibility(m.room, m.cam, g, 'back'), right: m.core.visibility(m.room, m.cam, g, 'right') };
    const id = v.back.mid ? 'back' : 'right';
    return m.toClient(m.core.project(m.cam, m.core.imageOf(m.room, { x: c.x, y: m.room.ghost.height / 2, z: c.z }, [id])));
  });
  await t.tapAt(imgPt.x, imgPt.y);
  s = await info();
  ok(s.stats.mirrorTaps === 1 && s.lives === 3 && s.selected === null && s.stats.casts === 0, '點鏡中的像：不扣命、不選格、不施放');
  ok(/像/.test(s.status) && /地板/.test(s.status), '點鏡中的像：提醒那是像，要點地板', s.status);

  // ---- 選格：標示不會出現在鏡子裡 ----
  const before = await pixels();
  const wrong1 = await t.otherCell(s.ghost, 0);
  await t.tapCell(wrong1);
  s = await info();
  ok(s.selected === wrong1 && !s.castDisabled, '點地板選到那一格，可以施放', s.selected);
  px = await pixels();
  ok(px.pickOut > before.pickOut && px.pickIn === before.pickIn, '選格標示只畫在地板上，鏡子裡沒有', JSON.stringify([before, px]));
  await shot('mirror-3-selected');

  // ---- 抓錯 ----
  const ghost0 = s.ghost;
  await press('#castBtn');
  await page.waitForTimeout(450);
  px = await pixels();
  ok(px.ghostOut === 0, '抓錯：法陣展開途中房間裡沒有鬼', JSON.stringify(px));
  ok(px.magicOut > 0 && px.magicIn === 0, '法陣只畫在地板上，鏡子裡沒有', JSON.stringify(px));
  await shot('mirror-4-wrong');
  await t.waitIdle();
  s = await info();
  ok(s.lives === 2 && s.hearts === 2, '抓錯扣一顆心', String(s.lives));
  ok(s.sealed === 0 && s.ghost === ghost0 && !s.revealed, '抓錯：封印數不變、鬼不換位置');
  ok(s.selected === null && s.castHidden === false && s.nextHidden, '抓錯後要重新選格');
  ok(!LEAK_WORDS.test(s.status), '抓錯的訊息沒有方向、距離、格號', s.status);
  px = await pixels();
  ok(px.ghostOut === 0 && px.ghostIn > 0, '抓錯之後房間裡仍然沒有鬼，鏡中的像還在');

  // ---- 抓對第 1 次 ----
  await t.catchGhost();
  s = await info();
  ok(s.sealed === 1 && s.revealed && s.lives === 2, '抓對：封印 1、命數不變');
  ok(s.sealText.replace(/\s/g, '') === '封印1／5', '封印數顯示 1／5', s.sealText);
  ok(!s.nextHidden && /繼續/.test(s.nextText) && s.castHidden, '出現「繼續 ➜」');
  px = await pixels();
  ok(px.ghostOut > 0, '抓對：鬼在房間裡現身', String(px.ghostOut));
  await shot('mirror-5-caught');
  await press('#nextBtn');
  s = await info();
  ok(s.ghost !== ghost0 && !s.revealed && s.selected === null, '按繼續後鬼換了位置', ghost0 + ' → ' + s.ghost);
  ok(s.phase === 1 && s.scene === null, '抓到 1 次還是兩面鏡');
  px = await pixels();
  ok(px.ghostOut === 0, '換位置後房間裡又看不到鬼');

  // ---- 抓對第 2 次 → 打碎鏡子 ----
  await t.catchGhost();
  s = await info();
  ok(s.sealed === 2 && /繼續/.test(s.nextText), '抓到第 2 次');
  await press('#nextBtn');
  s = await info();
  ok(s.scene && s.scene.id === 'break', '抓到 2 次後播「打碎鏡子」過場');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.story-bg')).backgroundImage.includes('room-broken')), '過場背景是鏡子打碎的房間');
  await shot('mirror-6-break-scene');
  for (let i = 0; i < 3; i++) await t.tapAt(vp.width / 2, vp.height / 2);
  ok(await page.isVisible('#resumeBtn'), '過場最後出現【繼續抓鬼】');
  await page.waitForTimeout(ARM_WAIT);
  await press('#resumeBtn');
  await page.waitForTimeout(750); // 等震動與閃光結束
  s = await info();
  ok(s.phase === 2 && s.intact.join() === 'back', '只剩正面那面鏡子');
  ok(s.lives === 2 && s.sealed === 2, '打碎鏡子不補命、封印數保留', JSON.stringify([s.lives, s.sealed]));
  ok(s.images.back && !s.images.right, '只有正面鏡裡有像');
  ok(await page.evaluate(() => window.__protoMirror.pools[2].some((c) => window.__protoMirror.core.cellId(c.col, c.row) === window.__protoMirror.core.cellId(window.__protoMirror.state.ghost.col, window.__protoMirror.state.ghost.row))), '鬼在單鏡出題格內', s.ghost);
  px = await pixels();
  ok(px.ghostIn > 0 && px.ghostOut === 0, '單鏡：鬼只出現在正面鏡裡', JSON.stringify(px));
  await shot('mirror-7-one-mirror');
  // 點碎掉的鏡子
  const bp = await page.evaluate(() => window.__protoMirror.toClient({ x: 1400, y: 380 }));
  await t.tapAt(bp.x, bp.y);
  s = await info();
  ok(/碎/.test(s.status) && s.lives === 2, '點碎掉的鏡子：只有說明，不扣命', s.status);

  // ---- 再抓 3 次 → 過關 ----
  const seen = [];
  for (let n = 3; n <= 5; n++) {
    const prev = (await info()).ghost;
    seen.push(prev);
    await t.catchGhost();
    s = await info();
    ok(s.sealed === n, '抓到第 ' + n + ' 次');
    if (n < 5) {
      await press('#nextBtn');
      s = await info();
      ok(s.ghost !== prev && s.phase === 2 && s.scene === null, '第 ' + n + ' 次後鬼換位置，還是一面鏡', prev + ' → ' + s.ghost);
    }
  }
  ok(new Set(seen).size === 3, '單鏡的 3 隻位置都不同', seen.join(' '));
  s = await info();
  ok(/過關/.test(s.nextText), '第 5 次抓到後按鈕變成「過關 ➜」', s.nextText);
  await press('#nextBtn');
  s = await info();
  ok(s.scene && s.scene.id === 'clear', '播過關演出');
  for (let i = 0; i < 3; i++) await t.tapAt(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(ARM_WAIT);
  ok(await page.isVisible('#toLevel2Btn'), '過關畫面有【前往第二關】');
  ok(/convex-lens\/index\.html$/.test(await page.getAttribute('#toLevel2Btn', 'href')), '【前往第二關】連到凸透鏡關卡');
  await shot('mirror-8-clear');
  await press('#againBtn');
  s = await info();
  ok(s.scene === null && s.lives === 3 && s.sealed === 0 && s.phase === 1 && s.intact.length === 2, '再玩一次：命數、封印數、鏡子都重置');

  // ---- 命用完 ----
  const g1 = s.ghost;
  for (let i = 0; i < 3; i++) { await t.castWrong(i); await t.waitIdle(); }
  await page.waitForFunction(() => window.__protoMirror.scene() && window.__protoMirror.scene().id === 'fail');
  s = await info();
  ok(s.lives === 0 && s.over && s.ghost === g1, '抓錯 3 次：命用完、出現失敗畫面');
  ok(!LEAK_WORDS.test(await page.textContent('.story-end')), '失敗畫面沒有位置資訊');
  await page.waitForTimeout(ARM_WAIT);
  await press('#retryBtn');
  s = await info();
  ok(s.scene === null && s.lives === 3 && s.sealed === 0 && s.phase === 1 && !s.over, '重新挑戰：從兩面鏡重來，不再播開場');
  px = await pixels();
  ok(px.ghostOut === 0, '重新挑戰後房間裡沒有鬼');

  // ---- 版面 ----
  const lay = await page.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const els = Array.from(document.querySelectorAll('#side button, #side a.btn, #zoomBox button')).filter((e) => e.offsetParent !== null);
    return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      items: els.map((e) => Object.assign({ id: e.id }, r(e))), stage: r(document.getElementById('stage')), info: window.__protoMirror.canvasInfo() };
  });
  ok(lay.sw <= lay.vw && lay.sh <= lay.vh, '頁面不捲動');
  ok(lay.items.every((i) => i.x >= 0 && i.y >= 0 && i.r <= lay.vw + 0.5 && i.b <= lay.vh + 0.5), '所有按鈕都在畫面內');
  ok(lay.items.every((i) => i.w >= 44 && i.h >= 44), '所有按鈕至少 44×44', lay.items.map((i) => i.id + ' ' + Math.round(i.w) + '×' + Math.round(i.h)).join(', '));
  console.log('   房間畫面 ' + Math.round(lay.stage.w) + '×' + Math.round(lay.stage.h) + '，背景圖縮放 ' + lay.info.S.toFixed(3));
  ok(t.errors.length === 0, '沒有 JS 錯誤或載入失敗', t.errors.join(' | '));
  await t.context.close();
}

async function freeMode(profile, browser) {
  console.log('\n===== ' + profile.name + '：自由練習、每一格、縮放 =====');
  const t = await open(profile, browser, '?free=1');
  const { page, press, info } = t;
  let s = await info();
  ok(s.scene === null, '?free=1 沒有過場');
  ok(await page.isHidden('#hud') && await page.isVisible('#freeTools'), '?free=1 不顯示命數，顯示開發工具');

  // 每一格都點得到（在預設縮放下，點格子中央）
  const cells = await page.evaluate(() => window.__protoMirror.selectable.map((c) => window.__protoMirror.core.cellId(c.col, c.row)));
  let hit = 0;
  for (const c of cells) { await t.tapCell(c); if ((await info()).selected === c) hit++; }
  ok(hit === cells.length, '每一格點中央都選得到', hit + ' / ' + cells.length);
  const sizes = await page.evaluate(() => {
    const m = window.__protoMirror, S = m.canvasInfo().S;
    return [1, 2, 3, 4].map((row) => (m.core.project(m.cam, { x: 2, y: 0, z: row }).y - m.core.project(m.cam, { x: 2, y: 0, z: row - 1 }).y) * S);
  });
  console.log('   各排在螢幕上的高度（CSS px，由遠到近）：' + sizes.map((v) => v.toFixed(0)).join('、'));

  // 自由練習抓錯不扣命
  await page.evaluate(() => window.__protoMirror.setGhost(3, 2));
  await t.tapCell('c2r4'); await press('#castBtn'); await t.waitIdle();
  s = await info();
  ok(s.stats.wrong === 1 && s.lives === 3 && s.ghost === 'c3r2', '自由練習抓錯不扣命、鬼不換位置');

  // 縮放與平移
  await press('#zoomIn'); await press('#zoomIn');
  s = await info();
  ok(s.zoom === 2, '按兩次＋放大到 2 倍', String(s.zoom));
  await t.tapCell('c2r2');
  ok((await info()).selected === 'c2r2', '放大後點格子仍選到正確的格');
  const st = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const pan0 = await page.evaluate(() => window.__protoMirror.canvasInfo());
  if (profile.touch) {
    const cdp = await t.context.newCDPSession(page);
    const tp = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(st.x, st.y) });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(st.x - i * 15, st.y - i * 8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(st.x, st.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(st.x - i * 15, st.y - i * 8);
    await page.mouse.up();
  }
  const pan1 = await page.evaluate(() => window.__protoMirror.canvasInfo());
  s = await info();
  ok(Math.abs(pan1.OX - pan0.OX) > 40 && Math.abs(pan1.OY - pan0.OY) > 20, '放大後拖曳會平移畫面', JSON.stringify([pan0.OX - pan1.OX, pan0.OY - pan1.OY].map(Math.round)));
  ok(s.selected === 'c2r2' && s.stats.casts === 1, '拖曳不會改選格、不會施放');
  await t.shot('mirror-9-zoom');
  await page.waitForTimeout(80);
  await press('#zoomFit');
  s = await info();
  const fit = await page.evaluate(() => window.__protoMirror.canvasInfo());
  ok(s.zoom === 1 && Math.abs(fit.OX - (fit.W - 1672 * fit.S) / 2) < 0.5, '按「全圖」回到整張圖置中');
  await t.tapCell('c4r1');
  ok((await info()).selected === 'c4r1', '回到全圖後點格子正常');

  // Debug 與指定配置
  await press('#debugBtn');
  await page.waitForFunction(() => /鬼本體/.test(document.getElementById('debugPanel').textContent));
  ok(await page.isVisible('#debugPanel') && /鬼本體/.test(await page.textContent('#debugPanel')), 'Debug 面板可開');
  await page.selectOption('#phaseSel', '2');
  s = await info();
  ok(s.phase === 2 && s.intact.join() === 'back', '可切到一面鏡');
  if (!profile.shots) await page.screenshot({ path: path.join(SHOTS, 'mirror-10-debug-desktop.png') });
  ok(t.errors.length === 0, '沒有 JS 錯誤或載入失敗', t.errors.join(' | '));
  await t.context.close();
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const p of PROFILES) { await levelFlow(p, browser); await freeMode(p, browser); }
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\n第一關（平面鏡）e2e：${checks - failures}/${checks} 通過`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

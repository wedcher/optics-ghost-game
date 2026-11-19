#!/usr/bin/env node
/*
 * 第二關（凸透鏡走廊）關卡流程的 headless 瀏覽器實測：node tests/e2e-convex-level.js
 * 需要 Playwright（npm ci && npx playwright install chromium）。
 *
 * 光學與作圖本身由 e2e-convex-lens.js（?free=1）測；這裡只測關卡流程：
 *   - 開場過場：一次一句、點畫面換句、可跳過、最後才出現【開始抓鬼】
 *   - 3 條命抓 5 隻：抓錯扣一顆心、抓對封印數 +1 並換下一隻
 *   - 抓錯與失敗畫面都不洩漏鬼的位置
 *   - 命用完 → 失敗畫面 → 重新挑戰後命數、封印數、作圖狀態都重置，不再播開場
 *   - 抓滿 5 隻 → 過關演出（劇本 2-3：撿起小透鏡）→「回關卡選單」＋「再玩一次」（2026-11-18 定案）
 *   - 「再玩一次」／重新挑戰：命、封印數、牌堆都重置；每輪 5 隻保證至少一題虛像題（J、K、L），位置隨機
 *   - 觀察／光路分析的按鈕各排成一排、每顆 ≥ 44 px（回饋 V1、V2）；「☰ 回關卡」在右上角（G1）
 *   - ?practice=1 練習模式：不播開場、照樣扣命、不計時不上榜
 * 對焦用測試掛鉤直接把透鏡放到清晰位置（拖曳／微調已由另一支測試涵蓋），其餘都是真的點擊。
 * 截圖輸出到 docs/screenshots/convex-level-*.png。
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

const PROFILES = [
  { name: 'phone-landscape', viewport: { width: 812, height: 375 }, touch: true, dsf: 2, shots: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false, dsf: 1, shots: false }
];
const GHOST = '#9dffd8';
const ARM_WAIT = 420; // 結尾按鈕出現後 350 ms 內不接受點擊

async function run(profile, browser) {
  console.log('\n===== ' + profile.name + ' ' + profile.viewport.width + '×' + profile.viewport.height + (profile.touch ? ' touch' : ' mouse') + ' =====');
  const context = await browser.newContext({ viewport: profile.viewport, hasTouch: profile.touch, isMobile: profile.touch, deviceScaleFactor: profile.dsf });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url()); });

  const P = (label) => '[' + profile.name + '] ' + label;
  const shot = async (name) => { if (profile.shots) await page.screenshot({ path: path.join(SHOTS, 'convex-level-' + name + '.png') }); };
  const load = async () => {
    await page.goto(URL);
    await page.waitForFunction(() => window.__protoConvex && window.__protoConvex.art().pending === 0);
  };
  const tapAt = async (x, y) => { if (profile.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await page.waitForTimeout(50); };
  const press = async (sel, wait) => { if (profile.touch) await page.tap(sel); else await page.click(sel); await page.waitForTimeout(wait === undefined ? 50 : wait); };
  const canvasBox = () => page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const countGhost = () => page.evaluate((hex) => {
    window.__protoConvex.render();
    const c = document.getElementById('view'), g = c.getContext('2d');
    const n = parseInt(hex.slice(1), 16), R = n >> 16, G = (n >> 8) & 255, B = n & 255;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let cnt = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - R) < 10 && Math.abs(d[i + 1] - G) < 10 && Math.abs(d[i + 2] - B) < 10) cnt++;
    return cnt;
  }, GHOST);
  // 關卡與畫面狀態
  const st = () => page.evaluate(() => {
    const H = window.__protoConvex, s = H.state, L = H.level, sc = document.querySelector('.story');
    const vis = (id) => { const e = document.getElementById(id); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    return {
      screen: L.screen, lives: L.lives, sealed: L.sealed, goal: L.goal,
      cfg: s.cfgIndex, phase: s.phase, marker: !!s.marker, lines: s.lines.length, solved: s.solved, selectedCell: s.selectedCell, revealed: H.stats.ghostRevealed,
      heartsLeft: document.querySelectorAll('#hearts > span:not(.lost)').length, hearts: document.querySelectorAll('#hearts > span').length,
      sealText: document.getElementById('sealCount').textContent, status: document.getElementById('status').textContent,
      hudVisible: vis('hud'), configVisible: vis('configSel'), debugVisible: vis('debugBtn'), nextText: document.getElementById('nextBtn').textContent,
      scene: sc ? {
        id: sc.getAttribute('data-scene'), info: L.scene ? L.scene.info() : null,
        text: sc.querySelector('.story-dialog').hidden ? null : sc.querySelector('.story-text').textContent,
        speaker: sc.querySelector('.story-speaker').hidden ? null : sc.querySelector('.story-speaker').textContent,
        endShown: !sc.querySelector('.story-end').hidden, skipShown: !sc.querySelector('.story-skip').hidden,
        endText: sc.querySelector('.story-end').textContent, ghosts: sc.querySelectorAll('.story-ghost').length,
        buttons: Array.from(sc.querySelectorAll('.story-btn')).map((b) => b.id), all: sc.innerText
      } : null
    };
  });
  // 過場畫面上看得見的按鈕：都在畫面內、夠大、沒被別的東西蓋住
  const sceneButtons = async (where) => {
    const r = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, out = [];
      document.querySelectorAll('.story button, .story a').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return;
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        out.push({ id: el.id || el.className, inside: b.left >= 0 && b.top >= 0 && b.right <= vw && b.bottom <= vh, big: b.width >= 44 && b.height >= 44, hit: top === el, size: Math.round(b.width) + '×' + Math.round(b.height) });
      });
      const de = document.documentElement;
      return { out, scroll: de.scrollWidth > vw || de.scrollHeight > vh };
    });
    ok(r.out.length > 0 && r.out.every((b) => b.inside && b.big && b.hit) && !r.scroll, P(where + '：按鈕都在畫面內、≥ 44×44、點得到，頁面不捲動'), r.out.map((b) => b.id + ' ' + b.size).join('、'));
  };
  // 過場蓋住整個遊戲畫面：底下的控制項點不到
  const sceneBlocksGame = () => page.evaluate(() => {
    const sc = document.querySelector('.story');
    return ['markBtn', 'castBtn', 'nextBtn', 'toAnalysis', 'view'].every((id) => {
      const e = document.getElementById(id), b = e.getBoundingClientRect();
      if (!b.width || !b.height) return true;
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!top && sc.contains(top);
    });
  });
  const hudLayout = async (where) => {
    const r = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight, bad = [];
      document.querySelectorAll('button, select, #hud, #hearts, #sealCount').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return;
        if (b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5) bad.push(el.id);
      });
      const h = document.getElementById('hud').getBoundingClientRect(), c = document.getElementById('view').getBoundingClientRect(), de = document.documentElement;
      return { bad, hudLeft: h.left, hudTop: h.top, canvas: Math.round(c.width) + '×' + Math.round(c.height), ch: c.height, scroll: de.scrollWidth > vw || de.scrollHeight > vh };
    });
    ok(r.bad.length === 0 && !r.scroll && r.ch >= 150, P(where + '：愛心、封印數與控制項都在畫面內，畫布仍夠大'), r.bad.join(',') || 'canvas ' + r.canvas);
    ok(r.hudLeft < 40 && r.hudTop < 20, P(where + '：愛心在左上角'), '(' + Math.round(r.hudLeft) + ', ' + Math.round(r.hudTop) + ')');
    const m = await page.evaluate(() => { const e = document.getElementById('menuBtn'), b = e.getBoundingClientRect(); return { right: window.innerWidth - b.right, top: b.top, w: b.width, h: b.height, text: e.textContent.trim() }; });
    ok(m.text === '☰ 回關卡', P(where + '：右上角按鈕字樣「☰ 回關卡」'), m.text);
    ok(m.right < 16 && m.top < 12 && m.w >= 44 && m.h >= 40, P(where + '：「☰ 回關卡」在右上角（G1）'), '離右邊 ' + Math.round(m.right) + ' px、離上面 ' + Math.round(m.top) + ' px、' + Math.round(m.w) + '×' + Math.round(m.h));
  };
  // 一排按鈕（回饋 V1、V2）：看得見的按鈕都在同一列、每顆 ≥ 44×44、文字沒有被截斷，順序照規格
  const rowCheck = async (where, box, expect) => {
    const r = await page.evaluate((box) => Array.from(document.querySelectorAll('#' + box + ' button')).map((e) => {
      const b = e.getBoundingClientRect();
      return { id: e.id, text: e.textContent.trim(), top: Math.round(b.top), w: b.width, h: b.height, clip: e.scrollWidth > e.clientWidth + 1 };
    }).filter((b) => b.w > 0 && b.h > 0), box);
    const texts = r.map((b) => b.text);
    ok(texts.join('｜') === expect.join('｜'), P(where + '：按鈕與順序'), texts.join('｜'));
    ok(r.length && r.every((b) => b.top === r[0].top), P(where + '：只排一排'), r.map((b) => b.top).join(','));
    ok(r.every((b) => b.w >= 44 && b.h >= 44 && !b.clip), P(where + '：每顆 ≥ 44×44 px、文字沒被截斷'), r.map((b) => b.text + ' ' + Math.round(b.w) + '×' + Math.round(b.h)).join('、'));
  };
  // 重新進關（測試直接重開網址、跳過開場）
  const restart = async () => {
    await load();
    await press('.story-skip');
    await page.waitForTimeout(ARM_WAIT);
    await press('#startHuntBtn', 150);
  };

  // 走到「可以施放」：對焦（掛鉤）→ 標記 → 分析 → 選格模式。回傳這一隻鬼的資料。
  const toSealMode = async () => {
    // 虛像題（沒有清晰實像位置）：透鏡放在看得到虛像的位置，改「看凸透鏡」再標記
    const c = await page.evaluate(() => {
      const H = window.__protoConvex, c = H.cfg(), virt = c.kind === 'virtual', lx = virt ? c.virtualLensX : c.sharp[1].lensX;
      if (H.state.phase === 'observe') { H.state.lensX = lx; H.render(); }
      return { id: c.id, targetCell: c.targetCell, lensX: lx, phase: H.state.phase, virt };
    });
    if (c.phase === 'observe') {
      if (c.virt) await press('#lookLens');
      await press('#markBtn'); await press('#toAnalysis', 120);
    }
    await press('#modeSeal');
    return c;
  };
  const castAt = async (cell) => {
    const b = await canvasBox();
    const q = await page.evaluate((cell) => window.__protoConvex.w2s({ x: -(cell - 0.5) * 100, y: 40 }), cell);
    await tapAt(b.x + q.x, b.y + q.y);
    await press('#castBtn');
  };
  const sealWrong = async (label, shotName) => {
    const c = await toSealMode();
    const wrong = Math.ceil(-c.lensX / 100); // 透鏡所在的格，一定不是目標格
    const before = await st();
    await castAt(wrong);
    const during = [];
    for (const t of [300, 450, 500]) { await page.waitForTimeout(t); during.push(await countGhost()); }
    await page.waitForTimeout(450);
    const s = await st();
    if (shotName) await shot(shotName);
    ok(wrong !== c.targetCell && s.lives === before.lives - 1 && s.heartsLeft === s.lives && s.hearts === 3, P(label + '：抓錯扣一顆心'), before.lives + ' → ' + s.lives + ' 條命');
    ok(s.sealed === before.sealed && s.cfg === before.cfg && !s.solved, P(label + '：封印數不變、還是同一隻鬼'));
    ok(during.every((n) => n === 0) && await countGhost() === 0 && !s.revealed, P(label + '：全程不顯示鬼'), '動畫取樣 ' + during.join('/'));
    ok(!/[左右前後遠近]|太|靠|第\s*\d|格子?\s*\d|\d/.test(s.status), P(label + '：訊息不含方向／距離／格號線索'), '「' + s.status + '」');
    return s;
  };
  const sealRight = async (label) => {
    const c = await toSealMode();
    const before = await st();
    await castAt(c.targetCell);
    await page.waitForTimeout(1750);
    const s = await st();
    ok(s.solved && s.sealed === before.sealed + 1 && s.lives === before.lives && await countGhost() > 20, P(label + '：抓對，封印數 +1、不扣命、鬼顯形'), '封印 ' + s.sealed + '／' + s.goal + '（配置 ' + c.id + '）');
    ok(s.sealText.endsWith('封印 ' + s.sealed + '／' + s.goal), P(label + '：左上角顯示「' + s.sealText + '」'));
    return s;
  };

  // ---------- 開場過場 ----------
  await load();
  let s = await st();
  ok(s.screen === 'intro' && s.scene && s.scene.id === 'intro', P('進入第二關先看到開場過場'));
  const bgOk = await page.evaluate(() => new Promise((res) => {
    const m = /url\("?(.*?)"?\)/.exec(document.querySelector('.story-bg').style.backgroundImage);
    if (!m) { res(false); return; }
    const im = new Image(); im.onload = () => res(im.naturalWidth > 100); im.onerror = () => res(false); im.src = m[1];
  }));
  ok(bgOk, P('過場背景圖（走廊）載入成功'));
  ok(s.scene.text === '看不到鬼了……' && s.scene.speaker === '你' && !s.scene.endShown && s.scene.skipShown, P('一次顯示一句，說話者是「你」'), '「' + s.scene.text + '」');
  ok(await sceneBlocksGame(), P('過場蓋住遊戲畫面，底下的控制項點不到'));
  await sceneButtons('開場');
  await shot('1-intro');
  const vw = profile.viewport.width, vh = profile.viewport.height;
  await tapAt(vw * 0.3, vh * 0.3);
  s = await st();
  ok(s.scene.text === '可是這裡沒有鏡子。', P('點畫面任何地方換下一句（第 2 句）'), '「' + s.scene.text + '」');
  await tapAt(vw * 0.7, vh * 0.85); // 點在對話框上也可以
  s = await st();
  ok(s.scene.text === '咦？這裡怎麼有一個這麼大的凸透鏡？' && !s.scene.endShown, P('第 3 句；【開始抓鬼】還沒出現'), '「' + s.scene.text + '」');
  // 連點防呆：最後一句換成按鈕的同一瞬間，按鈕不接受點擊
  const guard = await page.evaluate(() => {
    document.querySelector('.story').click();
    document.getElementById('startHuntBtn').click();
    return window.__protoConvex.level.screen;
  });
  s = await st();
  ok(guard === 'intro' && s.scene.endShown && s.scene.text === null && !s.scene.skipShown, P('最後一句之後換成【開始抓鬼】；剛出現的瞬間連點不會誤觸'));
  ok(/請抓到 5 隻鬼/.test(s.scene.endText) && /失去一顆心/.test(s.scene.endText) && s.scene.buttons.join() === 'startHuntBtn', P('開始前說明規則（劇本 2-1）：抓到 5 隻、抓錯失去一顆心'), s.scene.endText);
  await page.waitForTimeout(ARM_WAIT);
  await sceneButtons('開始抓鬼');
  await shot('2-intro-start');
  await press('#startHuntBtn', 150);
  s = await st();
  ok(s.screen === 'play' && !s.scene, P('按【開始抓鬼】進入抓鬼介面'));
  ok(s.lives === 3 && s.heartsLeft === 3 && s.hearts === 3 && s.sealed === 0 && s.sealText === '封印 0／5' && s.hudVisible, P('開始時 3 顆愛心、封印 0／5'));
  ok(!s.configVisible && !s.debugVisible, P('關卡模式不顯示配置選單與 Debug'));
  ok(await countGhost() === 0, P('開始抓鬼時畫面上沒有鬼本體'));
  await hudLayout('抓鬼／觀察');
  if (profile.name === 'phone-landscape') await rowCheck('觀察（812×375）', 'exploreControls', ['◀ 微調', '標記', '微調 ▶', '光路分析', '看布幕', '看透鏡']);
  await shot('3-hunt-start');

  // 「跳過」：直接到【開始抓鬼】
  await load();
  await press('.story-skip');
  s = await st();
  ok(s.scene && s.scene.endShown && s.screen === 'intro', P('按「跳過」直接到【開始抓鬼】（仍要按才開始）'));
  await page.waitForTimeout(ARM_WAIT);
  await press('#startHuntBtn', 150);
  ok((await st()).screen === 'play', P('跳過後按【開始抓鬼】進入抓鬼'));

  // ---------- 抓錯扣命、抓對換下一隻 ----------
  if (profile.name === 'phone-landscape') {
    await toSealMode();
    await press('#modeDraw');
    await rowCheck('光路分析・畫線（812×375）', 'analysisControls', ['重新對焦', '選格封印', '畫線', '復原', '清除']);
    ok(await page.evaluate(() => !document.getElementById('toolLine')), P('光路分析沒有「連線」按鈕（V2）'));
    await press('#modeSeal');
    await rowCheck('光路分析・選格封印（812×375）', 'analysisControls', ['重新對焦', '選格封印', '畫線', '復原', '清除', '施放封印法陣']);
  }
  await sealWrong('第 1 次抓錯', '4-wrong-one-life-lost');
  await hudLayout('抓鬼／封印');
  s = await sealRight('抓對第 1 隻');
  ok(s.nextText === '下一隻鬼 ➜' && s.screen === 'play', P('抓對後按鈕是「下一隻鬼 ➜」'));
  if (profile.name === 'phone-landscape') await rowCheck('封印成功後（812×375）', 'analysisControls', ['畫線', '復原', '清除', '光路重現', '下一隻鬼 ➜']);
  const prevCfg = s.cfg;
  await press('#nextBtn', 120);
  s = await st();
  ok(s.cfg !== prevCfg && s.phase === 'observe' && !s.marker && s.lines === 0 && !s.solved && s.lives === 2 && s.sealed === 1, P('下一隻鬼：換配置、回到觀察、命數與封印數保留'));
  ok(await countGhost() === 0, P('下一隻鬼開始時畫面上沒有鬼本體'));

  // ---------- 命用完 → 失敗畫面 ----------
  await sealWrong('第 2 次抓錯');
  ok((await st()).screen === 'play', P('剩 1 條命時還在抓鬼'));
  const c3 = await toSealMode();
  await castAt(Math.ceil(-c3.lensX / 100));
  await page.waitForTimeout(1700);
  s = await st();
  ok(s.screen === 'failed' && s.scene && s.scene.id === 'failed' && s.lives === 0 && s.heartsLeft === 0, P('第 3 次抓錯：命用完，出現失敗畫面'));
  ok(/❤️用完了/.test(s.scene.endText) && !/三顆心/.test(s.scene.endText), P('失敗標題用 ❤️（劇本修訂：命的文字統一用 ❤️）'), s.scene.endText);
  ok(s.scene.buttons.join() === 'retryBtn,failMenuBtn' && s.scene.endShown, P('失敗畫面有「重新挑戰」與「回關卡選單」'));
  ok(s.scene.ghosts === 0 && await countGhost() === 0 && !s.revealed && !/第\s*\d+\s*格|[左右]邊|配置/.test(s.scene.all), P('失敗畫面不顯示鬼、不提示位置'), s.scene.endText);
  ok(await sceneBlocksGame(), P('失敗畫面蓋住遊戲，不能繼續施放'));
  const menuHref = await page.evaluate(() => document.getElementById('failMenuBtn').getAttribute('href'));
  ok(menuHref === '../index.html' && fs.existsSync(path.join(ROOT, 'prototype/index.html')), P('「回關卡選單」連到原型入口'), menuHref);
  await page.waitForTimeout(ARM_WAIT);
  await sceneButtons('失敗畫面');
  await shot('5-failed');

  // ---------- 重新挑戰：狀態重置 ----------
  await press('#retryBtn', 150);
  s = await st();
  ok(s.screen === 'play' && !s.scene, P('重新挑戰：直接回到抓鬼，不再播開場'));
  ok(s.lives === 3 && s.heartsLeft === 3 && s.sealed === 0 && s.sealText === '封印 0／5', P('重新挑戰：命數與封印數重置'));
  ok(s.phase === 'observe' && !s.marker && s.lines === 0 && !s.solved && s.selectedCell === null && await countGhost() === 0, P('重新挑戰：回到觀察，標記／作圖／選格都清空，畫面上沒有鬼'));

  // ---------- 抓滿 5 隻 → 過關 ----------
  const seq = [s.cfg];
  for (let i = 1; i <= 5; i++) {
    if (i === 3) await sealWrong('過關途中抓錯一次'); // 中途扣一命不影響過關
    s = await sealRight('抓對第 ' + i + ' 隻');
    if (i < 5) {
      ok(s.nextText === '下一隻鬼 ➜', P('第 ' + i + ' 隻之後還沒過關'));
      await press('#nextBtn', 120);
      seq.push((await st()).cfg);
    }
  }
  ok(seq.every((c, i) => i === 0 || c !== seq[i - 1]) && new Set(seq).size === 5, P('5 隻鬼是 5 組不同的配置，隨機出題'), seq.join('→'));
  ok(await page.evaluate((seq) => seq.some((i) => window.__protoConvex.configs.all[i].kind === 'virtual'), seq), P('這一輪 5 隻裡至少有一題虛像題'), seq.join('→'));
  ok(s.sealed === 5 && s.lives === 2 && s.nextText === '過關 ➜' && s.screen === 'play', P('抓滿 5 隻：按鈕變成「過關 ➜」，先讓玩家看完顯形與光路重現'));
  await shot('6-fifth-sealed');
  await press('#nextBtn', 200);
  s = await st();
  ok(s.screen === 'cleared' && s.scene && s.scene.id === 'cleared', P('按「過關 ➜」進入過關演出'));
  ok(s.scene.ghosts >= 5 && s.scene.text === '剩下的鬼一哄而散，逃出了城堡！' && s.scene.speaker === null, P('過關演出：鬼一哄而散（旁白）'), s.scene.ghosts + ' 隻逃散的鬼');
  await shot('7-cleared-flee');
  // 劇本 2-3：凸透鏡太大帶不走 → 撿起地上的一片小透鏡（不是大凸透鏡的碎片）
  const said = [];
  for (const want of [['你', '但凸透鏡太大了，帶不走啊。'], [null, '你撿起地上的一片小透鏡。'], ['你', '咦，這個……'], ['你', '也可以吧。']]) {
    await tapAt(vw * 0.5, vh * 0.5);
    s = await st();
    said.push(s.scene.text);
    ok(s.scene.text === want[1] && s.scene.speaker === want[0], P('過關演出：' + (want[0] ? '你：' : '旁白：') + '「' + want[1] + '」'), '「' + s.scene.text + '」' + (s.scene.speaker ? '（' + s.scene.speaker + '）' : '（旁白）'));
  }
  ok(!said.some((t) => /碎片|碎掉|敲下/.test(t || '')), P('物理：小透鏡不是大凸透鏡的碎片（凸透鏡碎片仍會聚）'));
  await tapAt(vw * 0.5, vh * 0.5);
  s = await st();
  ok(s.scene.endShown && /第二關過關/.test(s.scene.endText) && /第三關：荒野狩獵（已解鎖）/.test(s.scene.endText) && s.scene.buttons.join() === 'clearMenuBtn,againBtn', P('過關畫面：標題、第三關：荒野狩獵（已解鎖），「回關卡選單」＋「再玩一次」'), s.scene.endText);
  ok(await page.evaluate(() => document.getElementById('clearMenuBtn').getAttribute('href')) === '../index.html', P('過關畫面的「回關卡選單」連到入口頁'));
  ok(!/你花費/.test(s.scene.endText) && /成功把鬼趕出城堡。第三關：荒野狩獵（已解鎖）/.test(s.scene.endText) && (await page.evaluate(() => { const r = Leaderboard.getRun(); return r && r.mirrorMs == null && r.castleMs == null && r.convexMs > 0; })), P('排行榜：直接開第二關（沒有第一關成績）不顯示趕鬼時間、不記趕鬼時間（只記第二關成績）；過關文字照 2026-11-19 統一版'), s.scene.endText);
  await page.waitForTimeout(ARM_WAIT);
  await sceneButtons('過關畫面');
  await shot('8-cleared');
  // 「再玩一次」：整關重置（命、封印數、牌堆），不播開場
  await press('#againBtn', 150);
  s = await st();
  const again = await page.evaluate(() => { const H = window.__protoConvex, d = H.deck(); return { round: [H.state.cfgIndex].concat(d.slice(-4).reverse()), all: H.configs.all.map((c) => c.kind) }; });
  ok(s.screen === 'play' && !s.scene && s.lives === 3 && s.heartsLeft === 3 && s.sealed === 0 && s.sealText === '封印 0／5', P('「再玩一次」：直接回到抓鬼，命數與封印數重置'));
  ok(s.phase === 'observe' && !s.marker && s.lines === 0 && !s.solved && s.selectedCell === null && await countGhost() === 0, P('「再玩一次」：回到觀察，標記／作圖／選格都清空'));
  ok(again.round.length === 5 && new Set(again.round).size === 5 && again.round.some((i) => again.all[i] === 'virtual'), P('「再玩一次」：重洗牌堆，這輪 5 隻不重複、含虛像題'), again.round.join('→'));
  await restart();

  // ---------- 排行榜：從第一關依序玩過來，第二關過關顯示趕鬼時間 ----------
  // 先模擬 ?unlock=1 跳關：沒有第一關成績 → 不算。再模擬第一關已過關（成績 10 分）→ 算。為了省時間，直接把封印數設成 4、再抓最後一隻。
  const clearOnce = async (label) => {
    await page.evaluate(() => { window.__protoConvex.level.sealed = 4; });
    await sealRight(label);
    await press('#nextBtn', 200);
    for (let i = 0; i < 8 && !(await st()).scene.endShown; i++) await tapAt(vw * 0.5, vh * 0.5);
    return st();
  };
  ok(await page.evaluate(() => Leaderboard.activeLevel()) === 'convex', P('排行榜：按「開始抓鬼」／重新挑戰後第二關在計時'));
  s = await clearOnce('跳關後抓最後一隻');
  {
    const run = await page.evaluate(() => Leaderboard.getRun());
    ok(s.screen === 'cleared' && !/你花費/.test(s.scene.endText) && run.castleMs == null && run.convexMs > 0, P('排行榜：只有第二關成績（?unlock=1 跳關）第二關過關不算趕鬼時間'), s.scene.endText);
  }
  await restart();
  await page.evaluate(() => localStorage.setItem('ogg.run.v2', JSON.stringify({ mirrorMs: 600000, convexMs: null, castleMs: null, hunt: null })));
  s = await clearOnce('第一關已過關後抓最後一隻');
  const run2 = await page.evaluate(() => Leaderboard.getRun());
  ok(s.screen === 'cleared' && !/你花費/.test(s.scene.endText) && /成功把鬼趕出城堡。第三關：荒野狩獵（已解鎖）/.test(s.scene.endText) && run2.castleMs === 600000 + run2.convexMs && run2.convexMs < 60000,
    P('排行榜：趕鬼時間＝第一關成績＋第二關這次的遊玩時間，過關說明是統一版「成功把鬼趕出城堡。第三關：荒野狩獵（已解鎖）」（趕鬼時間照記，在荒野結算顯示）'), s.scene.endText);
  // 再玩一次但命用完：保留上次過關的成績
  await page.waitForTimeout(ARM_WAIT);
  await press('#againBtn', 150);
  for (let i = 0; i < 3; i++) await sealWrong('再玩一次抓錯 ' + (i + 1));
  s = await st();
  {
    const run = await page.evaluate(() => Leaderboard.getRun());
    ok(s.screen === 'failed' && await page.evaluate(() => Leaderboard.activeLevel()) === null && run.convexMs === run2.convexMs && run.castleMs === run2.castleMs, P('排行榜：再玩一次命用完，保留上次過關的成績'), JSON.stringify(run));
  }
  await restart();

  // ---------- ?practice=1 練習模式：不播開場、扣命、不計時、不上榜 ----------
  await page.evaluate(() => localStorage.setItem('ogg.run.v2', JSON.stringify({ mirrorMs: 600000, convexMs: null, castleMs: null, hunt: null })));
  await page.goto(URL + '?practice=1');
  await page.waitForFunction(() => window.__protoConvex && window.__protoConvex.art().pending === 0);
  s = await st();
  ok(s.screen === 'play' && !s.scene && s.hudVisible && !s.configVisible && !s.debugVisible && s.lives === 3, P('?practice=1：不播開場，直接抓鬼；有愛心、沒有開發工具'));
  ok(s.sealText === '練習　封印 0／5', P('?practice=1：左上角標「練習」'), s.sealText);
  await sealWrong('練習模式抓錯');
  s = await clearOnce('練習模式抓最後一隻');
  const runP = await page.evaluate(() => Leaderboard.getRun());
  ok(s.screen === 'cleared' && !/你花費/.test(s.scene.endText) && runP && runP.castleMs == null && s.scene.buttons.join() === 'clearMenuBtn,againBtn', P('?practice=1：過關不顯示趕鬼時間、不記成績（就算本輪第一關已過）；「回關卡選單」＋「再玩一次」'), s.scene.endText);

  // ---------- 每輪保證至少一題虛像題：跑很多輪統計（用 app 自己的發牌函式） ----------
  const stat = await page.evaluate(() => {
    const H = window.__protoConvex, all = H.configs.all, N = 3000, pos = [0, 0, 0, 0, 0], ids = {};
    let missing = 0, dup = 0;
    for (let k = 0; k < N; k++) {
      H.dealLevelDeck();
      const round = H.deck().slice(-5).reverse(); // 從尾端發：第 1 隻是最後一張
      if (new Set(round).size !== 5) dup++;
      const v = round.map((i) => all[i].kind === 'virtual');
      if (!v.some(Boolean)) missing++;
      pos[v.indexOf(true)]++; // 第一題虛像題出現在第幾隻
      round.forEach((i) => { if (all[i].kind === 'virtual') ids[all[i].id] = (ids[all[i].id] || 0) + 1; });
    }
    return { N, missing, dup, pos, ids };
  });
  ok(stat.missing === 0 && stat.dup === 0, P('發牌統計 ' + stat.N + ' 輪：每輪都有虛像題、5 隻不重複'), '缺虛像題 ' + stat.missing + ' 輪');
  ok(stat.pos.every((n) => n > stat.N * 0.05) && stat.pos[0] < stat.N * 0.6, P('發牌統計：第一題虛像題出現在第 1～5 隻都有（不固定第一或最後一題）'), stat.pos.join('/'));
  ok(['J', 'K', 'L'].every((id) => stat.ids[id] > stat.N * 0.15), P('發牌統計：J、K、L 三題都會出現'), JSON.stringify(stat.ids));

  // ---------- 自由練習模式不受影響 ----------
  await page.goto(URL + '?free=1');
  await page.waitForFunction(() => window.__protoConvex && window.__protoConvex.art().pending === 0);
  s = await st();
  ok(!s.scene && !s.hudVisible && s.configVisible && s.debugVisible && s.screen === 'play', P('?free=1：沒有過場與愛心，保留配置選單與 Debug'));

  ok(errors.length === 0, P('沒有 JS 錯誤、沒有載入失敗的檔案'), errors.join(' | ') || undefined);
  await context.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  URL = 'http://127.0.0.1:' + server.address().port + '/prototype/convex-lens/index.html';
  const browser = await chromium.launch();
  for (const p of PROFILES) {
    try { await run(p, browser); } catch (e) { ok(false, '[' + p.name + '] 測試腳本例外', e.message); }
  }
  await browser.close();
  server.close();
  const summary = (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks';
  console.log('\n' + summary);
  fs.writeFileSync(path.join(SHOTS, 'e2e-results-convex-level.txt'), results.join('\n') + '\n\n' + summary + '\n');
  process.exit(failures === 0 ? 0 : 1);
})();

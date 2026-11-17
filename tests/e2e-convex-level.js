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
 *   - 抓滿 5 隻 → 過關演出 → 再玩一次也會重置
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
    ok(s.sealText === '封印 ' + s.sealed + '／' + s.goal, P(label + '：左上角顯示「' + s.sealText + '」'));
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
  ok(s.scene.text === '這鬼似乎只能用鏡子看到。', P('點畫面任何地方換下一句（第 2 句）'), '「' + s.scene.text + '」');
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
  ok(/3 條命/.test(s.scene.endText) && /5 隻/.test(s.scene.endText) && s.scene.buttons.join() === 'startHuntBtn', P('開始前說明規則：3 條命、5 隻'), s.scene.endText);
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
  await sealWrong('第 1 次抓錯', '4-wrong-one-life-lost');
  await hudLayout('抓鬼／封印');
  s = await sealRight('抓對第 1 隻');
  ok(s.nextText === '下一隻鬼 ➜' && s.screen === 'play', P('抓對後按鈕是「下一隻鬼 ➜」'));
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
  ok(s.sealed === 5 && s.lives === 2 && s.nextText === '過關 ➜' && s.screen === 'play', P('抓滿 5 隻：按鈕變成「過關 ➜」，先讓玩家看完顯形與光路重現'));
  await shot('6-fifth-sealed');
  await press('#nextBtn', 200);
  s = await st();
  ok(s.screen === 'cleared' && s.scene && s.scene.id === 'cleared', P('按「過關 ➜」進入過關演出'));
  ok(s.scene.ghosts >= 5 && s.scene.text === '剩下的鬼一哄而散，逃出了城堡！' && s.scene.speaker === null, P('過關演出：鬼一哄而散（旁白）'), s.scene.ghosts + ' 隻逃散的鬼');
  await shot('7-cleared-flee');
  await tapAt(vw * 0.5, vh * 0.5);
  s = await st();
  ok(s.scene.text === '想跑？追！' && s.scene.speaker === '你', P('過關演出：玩家說「想跑？追！」'));
  await tapAt(vw * 0.5, vh * 0.5);
  s = await st();
  ok(s.scene.endShown && /過關/.test(s.scene.endText) && /荒野/.test(s.scene.endText) && s.scene.buttons.join() === 'clearMenuBtn,againBtn', P('過關畫面：標題、下一站荒野、回選單／再玩一次'), s.scene.endText);
  ok(!/趕鬼時間/.test(s.scene.endText) && (await page.evaluate(() => Leaderboard.getRun())) === null, P('排行榜：直接開第二關（沒從第一關開始）不顯示趕鬼時間、不記成績'));
  await page.waitForTimeout(ARM_WAIT);
  await sceneButtons('過關畫面');
  await shot('8-cleared');
  await press('#againBtn', 150);
  s = await st();
  ok(s.screen === 'play' && !s.scene && s.lives === 3 && s.sealed === 0 && s.heartsLeft === 3 && s.phase === 'observe' && !s.solved, P('再玩一次：命數與封印數重置，回到抓鬼'));

  // ---------- 排行榜：從第一關依序玩過來，第二關過關顯示趕鬼時間 ----------
  // 先模擬 ?unlock=1 跳關：本輪計時已開始、但第一關沒過 → 不算。再模擬第一關已過 → 算。為了省時間，直接把封印數設成 4、再抓最後一隻。
  const clearOnce = async (label) => {
    await page.evaluate(() => { window.__protoConvex.level.sealed = 4; });
    await sealRight(label);
    await press('#nextBtn', 200);
    await tapAt(vw * 0.5, vh * 0.5); await tapAt(vw * 0.5, vh * 0.5);
    return st();
  };
  await page.evaluate(() => localStorage.setItem('ogg.run.v1', JSON.stringify({ startedAt: Date.now() - 600000, castleMs: null, hunt: null })));
  s = await clearOnce('跳關後抓最後一隻');
  ok(s.screen === 'cleared' && !/趕鬼時間/.test(s.scene.endText) && (await page.evaluate(() => Leaderboard.getRun().castleMs)) == null, P('排行榜：第一關沒過（?unlock=1 跳關）第二關過關不算趕鬼時間'), s.scene.endText);
  await page.waitForTimeout(ARM_WAIT);
  await press('#againBtn', 150);
  await page.evaluate(() => localStorage.setItem('ogg.run.v1', JSON.stringify({ startedAt: Date.now() - 600000, mirrorDone: true, castleMs: null, hunt: null })));
  s = await clearOnce('依序過關後抓最後一隻');
  const ms = await page.evaluate(() => Leaderboard.getRun().castleMs);
  ok(s.screen === 'cleared' && /趕鬼時間：10 分 \d+ 秒/.test(s.scene.endText) && ms >= 600000 && ms < 660000, P('排行榜：依序過關，第二關過關畫面顯示趕鬼時間並記下成績'), s.scene.endText);
  await page.waitForTimeout(ARM_WAIT);
  await press('#againBtn', 150);

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

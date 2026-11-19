#!/usr/bin/env node
/*
 * 第三關「荒野狩獵」正式關卡的 headless 實測：node tests/e2e-hunt.js
 *
 * 檢查（PROJECT.md CONFIRMED、docs/story-and-flow.md、docs/leaderboard.md）：
 *   - 開場過場（劇本 3-1 逐句）→【開始狩獵】才開始倒數 5:00
 *   - 倒數顯示在畫面上，手機橫向 812×375 排得下、不擋按鈕；最後 30 秒變紅＋提示（不帶位置）
 *   - 3 顆 ❤️，抓錯才扣命、訊息不帶位置；每抓到一隻換下一組配置，不連續重複
 *   - 時間到（含法陣展開中剛好到時）／命用完 → 結束過場（劇本 3-2）→ 結算畫面
 *     「你花費＿＿把鬼趕出城堡，並在荒野中封印了＿＿隻鬼。」（趕鬼時間＝兩關最後一次過關成績相加）
 *   - Leaderboard.recordHunt、GameProgress.markCleared('concave')；第一次完成多一行「練習模式已解鎖」與按鈕
 *   - 結算畫面「再挑戰一次」「回關卡選單」；輸入暱稱上傳（本機模式）
 * 一律用 page.route 蓋掉 leaderboard-config.js（空網址＝本機排行），絕不打正式試算表。
 * 截圖輸出到 docs/screenshots/hunt-*.png。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
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

let failures = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) failures++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + detail : ''));
}
const NO_POS = /[左右前後遠近東西南北]|太|靠|第\s*\d|格/;

const INTRO = ['你追出城堡，眼前是一片漆黑的荒野。', '鬼影四散，一轉眼就消失在夜色裡。', '又看不到了……', '還好出門前帶了這片透鏡。',
  '咦？等等，鬼怎麼變小了？', '這是一片凹透鏡。', '天亮之前，能抓幾隻就抓幾隻！'];
const TIMEUP = ['東邊的天空漸漸亮了起來。', '剩下的鬼趁著晨霧，躲得無影無蹤。', '呼……天亮了，今晚就到這裡吧。'];
const NOLIVES = ['法陣又落空了——荒野深處傳來一陣嘻嘻的笑聲。', '可惡……下次一定把你們全部抓回來！'];

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const URL = BASE + '/prototype/concave-lens/index.html';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await context.route('**/shared/leaderboard-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.LEADERBOARD_URL = '';" }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.dismiss());

  const press = async (sel, wait) => { await page.tap(sel); await page.waitForTimeout(wait || 40); };
  const tapCanvas = async (x, y) => { const b = await page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left, y: r.top }; }); await page.touchscreen.tap(b.x + x, b.y + y); await page.waitForTimeout(40); };
  const info = () => page.evaluate(() => {
    const H = window.__proto, lv = H.level, sc = document.querySelector('.story'), t = document.getElementById('timer');
    return { lives: lv.lives, sealed: lv.sealed, screen: lv.screen, cfg: H.state.cfgIndex, solved: H.state.solved, phase: H.state.phase,
      heartsLeft: Array.from(document.querySelectorAll('#hearts > span')).filter((h) => !h.classList.contains('lost')).length,
      timer: t.hidden ? null : t.textContent, low: t.classList.contains('low'), remaining: H.huntRemaining(), status: document.getElementById('status').textContent,
      scene: sc ? sc.getAttribute('data-scene') : null, result: !!document.getElementById('lbResult') };
  });
  // 一句一句點過過場，回傳讀到的台詞；有結尾面板就停在面板上
  const readScene = async () => {
    const got = [];
    for (let i = 0; i < 20; i++) {
      const st = await page.evaluate(() => {
        const sc = document.querySelector('.story');
        if (!sc) return null;
        const end = sc.querySelector('.story-end');
        return { ended: !end.hidden, text: sc.querySelector('.story-text').textContent };
      });
      if (!st || st.ended) break;
      got.push(st.text);
      await page.touchscreen.tap(400, 120); await page.waitForTimeout(60);
    }
    return got;
  };
  const toAnalysis = async () => {
    await page.evaluate(() => { const H = window.__proto, c = H.cfg(); H.state.marker = { dir: c.direction, tanX: 0, tanY: H.imageScreenPos().tan }; H.render(); });
    await press('#lensBtn'); await press('#lensBtn');
    await press('#toAnalysis', 150);
  };
  const pickCell = async (cell) => {
    await press('#modeSeal');
    const p = await page.evaluate((cell) => window.__proto.w2s({ x: -(cell - 0.5) * 100, y: 60 }), cell);
    await tapCanvas(p.x, p.y);
  };
  const seal = async (cell) => { await pickCell(cell); await press('#castBtn'); await page.waitForTimeout(1700); };
  const target = () => page.evaluate(() => window.__proto.cfg().targetCell);
  const wrong = () => page.evaluate(() => { const c = window.__proto.cfg().targetCell; return c === 1 ? 2 : c - 1; });

  // 第一關＋第二關的過關成績（3 分 20 秒＋5 分＝8 分 20 秒），還沒完成過荒野狩獵
  await page.goto(URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('opticsGhost.progress.v1', JSON.stringify({ mirror: true, convex: true }));
    localStorage.setItem('ogg.run.v2', JSON.stringify({ mirrorMs: 200000, convexMs: 300000, castleMs: 500000, hunt: null }));
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__proto);

  // ---------- 開場 ----------
  let s = await info();
  ok(s.scene === 'hunt-intro' && s.timer === null && s.remaining === null, '開場過場先出現；還沒開始倒數');
  await page.screenshot({ path: path.join(SHOTS, 'hunt-1-intro.png') });
  const intro = await readScene();
  ok(JSON.stringify(intro) === JSON.stringify(INTRO), '開場台詞照劇本 3-1（逐句）', intro.join(' / '));
  const end = await page.evaluate(() => { const e = document.querySelector('.story-end'); return { h: e.querySelector('h2').textContent, p: e.querySelector('p').textContent, b: Array.from(e.querySelectorAll('.story-btn')).map((x) => x.id + ':' + x.textContent) }; });
  ok(end.h === '荒野狩獵' && /限時 5 分鐘/.test(end.p) && /3 條命/.test(end.p) && end.b.join() === 'startHuntBtn:開始狩獵', '開場結尾：標題「荒野狩獵」、說明、【開始狩獵】', JSON.stringify(end));
  await page.waitForTimeout(400);
  await press('#startHuntBtn', 200);

  // ---------- 狩獵中 ----------
  s = await info();
  ok(!s.scene && s.screen === 'play' && s.lives === 3 && s.heartsLeft === 3 && s.sealed === 0, '按【開始狩獵】：3 顆 ❤️、封印 0 隻');
  ok(s.timer === '⏳ 5:00' || s.timer === '⏳ 4:59', '倒數從 5:00 開始、顯示在畫面上', s.timer);
  {
    const r = await page.evaluate(() => {
      const b = (id) => { const e = document.getElementById(id).getBoundingClientRect(); return { l: e.left, r: e.right, t: e.top, b: e.bottom, w: e.width }; };
      const btns = Array.from(document.querySelectorAll('#exploreControls button')).map((x) => x.getBoundingClientRect());
      return { timer: b('timer'), hearts: b('hearts'), count: b('sealCount'), status: b('status'), menu: b('menuBtn'), stage: b('stage'),
        btnsOk: btns.every((x) => x.right <= innerWidth + 0.5 && x.bottom <= innerHeight + 0.5 && x.height >= 44),
        scroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    });
    const inside = r.timer.l >= 0 && r.timer.r <= 812 && r.timer.b <= r.stage.t + 1;
    const noOverlap = r.timer.l >= r.hearts.r - 1 && r.timer.r <= r.count.l + 1 && r.timer.r <= r.status.l + 1 && r.timer.r <= r.menu.l;
    ok(inside && noOverlap, '812×375：倒數在上方列、不壓到 ❤️／封印數／說明／「☰ 回關卡」、不蓋到畫面', JSON.stringify(r.timer));
    ok(r.btnsOk && !r.scroll && r.stage.b - r.stage.t > 180, '812×375：按鈕都在畫面內、高 ≥ 44px，頁面不捲動，畫面高度夠', 'stage 高 ' + (r.stage.b - r.stage.t).toFixed(0));
  }
  await page.waitForTimeout(1300);
  s = await info();
  ok(s.remaining < 299000 && s.remaining > 290000, '倒數真的在走', s.remaining + ' ms，' + s.timer);
  await page.screenshot({ path: path.join(SHOTS, 'hunt-2-play.png') });

  // 抓錯扣命、訊息不帶位置
  await toAnalysis();
  await seal(await wrong());
  s = await info();
  ok(s.lives === 2 && s.heartsLeft === 2 && s.screen === 'play', '抓錯：扣一顆 ❤️');
  ok(!NO_POS.test(s.status.replace('失去一顆心', '')) && !/\d/.test(s.status), '抓錯訊息不含方向／距離／格號', s.status);

  // 抓對 → 換下一組（不連續重複）。連抓 8 隻看順序
  const seq = [s.cfg];
  let repeat = false;
  for (let k = 1; k <= 8; k++) {
    if (k > 1) await toAnalysis();
    await seal(await target());
    s = await info();
    if (!(s.solved && s.sealed === k)) { ok(false, '第 ' + k + ' 隻抓對：封印數 +1', JSON.stringify(s)); break; }
    await press('#nextBtn', 100);
    s = await info();
    if (s.cfg === seq[seq.length - 1]) repeat = true;
    seq.push(s.cfg);
  }
  ok(s.sealed === 8 && s.lives === 2, '連抓 8 隻：封印數 8、命數不變', 'sealed ' + s.sealed);
  ok(!repeat, '每抓到一隻換下一組配置，不連續重複', seq.join(','));
  ok(await page.evaluate(() => document.getElementById('nextBtn').textContent.trim() === '下一隻鬼 ➜' && document.getElementById('configSel').hidden && document.getElementById('debugBtn').hidden),
    '正式狩獵沒有「下一組配置」循環、配置選單與 Debug');
  ok(s.remaining > 200000, '還沒時間到（測試本身沒有拖太久）', s.timer);

  // ---------- 最後 30 秒 ----------
  await page.evaluate(() => window.__proto.setHuntRemaining(25000));
  await page.waitForTimeout(300);
  s = await info();
  const banner = await page.evaluate(() => { const b = document.getElementById('banner'); return b.hidden ? null : b.textContent; });
  ok(s.low && /^⏳ 0:2\d$/.test(s.timer), '最後 30 秒：倒數變紅', s.timer);
  ok(banner && /30 秒/.test(banner) && !NO_POS.test(banner), '最後 30 秒：提示只講時間、不帶位置', banner);
  await page.screenshot({ path: path.join(SHOTS, 'hunt-3-last30.png') });

  // ---------- 法陣展開中剛好時間到：等結果，抓到也算 ----------
  await toAnalysis();
  await pickCell(await target());
  await press('#castBtn', 50);
  await page.evaluate(() => window.__proto.setHuntRemaining(0));
  s = await info();
  ok(s.screen === 'play' && !s.scene && s.timer === '⏳ 0:00', '法陣展開中時間到：先等法陣結果', s.timer);
  await page.waitForTimeout(1700);
  s = await info();
  ok(s.sealed === 9 && s.screen === 'ended' && s.scene === 'hunt-timeup', '法陣結果出來（抓到，封印 9）後才進「時間到」過場');
  const timeup = await readScene();
  ok(JSON.stringify(timeup) === JSON.stringify(TIMEUP), '時間到台詞照劇本 3-2 情況一', timeup.join(' / '));
  await page.waitForTimeout(200);

  // ---------- 結算 ----------
  const res = await page.evaluate(() => {
    const r = document.getElementById('lbResult'); if (!r) return null;
    return { title: r.querySelector('#lbTitle').textContent, sum: r.querySelector('#lbSummary').textContent, extra: (r.querySelector('#lbExtra') || {}).textContent || null,
      btns: Array.from(r.querySelectorAll('.lb-btn')).map((b) => b.id + ':' + b.textContent), practiceHref: (r.querySelector('#huntPracticeBtn') || { getAttribute: () => null }).getAttribute('href'),
      run: JSON.parse(localStorage.getItem('ogg.run.v2')), cleared: GameProgress.isCleared('concave') };
  });
  ok(res && res.title === '時間到！', '結算畫面標題「時間到！」', res && res.title);
  ok(res && res.sum === '你花費 8 分 20 秒 把鬼趕出城堡，並在荒野中封印了 9 隻鬼。', '結算文案：趕鬼時間（兩關相加）＋荒野封印數', res && res.sum);
  ok(res && res.run.hunt === 9 && res.run.castleMs === 500000, 'Leaderboard.recordHunt(9)；趕鬼時間沒被改', res && JSON.stringify(res.run));
  ok(res && res.cleared, 'GameProgress.markCleared("concave")');
  ok(res && res.extra === '荒野練習模式已解鎖（不限時間，不計入排行榜）。' && res.practiceHref === 'index.html?practice=1', '第一次完成：多一行「練習模式已解鎖」與【荒野練習模式】按鈕', res && res.extra);
  ok(res && res.btns.join() === 'lbSubmit:留名上榜,huntRetryBtn:再挑戰一次,huntPracticeBtn:荒野練習模式,lbView:看排行榜,lbClose:回關卡選單', '結算按鈕：留名上榜／再挑戰一次／荒野練習模式／看排行榜／回關卡選單', res && res.btns.join());
  await page.screenshot({ path: path.join(SHOTS, 'hunt-4-result.png') });
  // 上傳（本機模式）
  await page.fill('#lbName', '測試獵人');
  await press('#lbSubmit', 400);
  const up = await page.evaluate(() => ({ msg: document.getElementById('lbMsg').textContent, close: document.getElementById('lbClose').textContent, local: localStorage.getItem('ogg.leaderboard.local.v1') }));
  ok(/已上榜/.test(up.msg) && up.close === '回關卡選單', '留名上榜（本機模式）成功；關閉鈕仍是「回關卡選單」', up.msg);
  ok(!!up.local && /測試獵人/.test(up.local) && /9/.test(up.local), '本機排行存了暱稱與封印數', up.local && up.local.slice(0, 120));

  // ---------- 再挑戰一次 ----------
  await press('#huntRetryBtn', 200);
  s = await info();
  ok(!s.result && !s.scene && s.screen === 'play' && s.lives === 3 && s.sealed === 0 && (s.timer === '⏳ 5:00' || s.timer === '⏳ 4:59') && !s.low, '再挑戰一次：直接開始，3 顆 ❤️、封印 0、倒數重來', s.timer);

  // ---------- 命用完 ----------
  await toAnalysis();
  await seal(await target());
  await press('#nextBtn', 100);
  for (let k = 0; k < 3; k++) { if (k === 0) await toAnalysis(); await seal(await wrong()); }
  s = await info();
  ok(s.lives === 0 && s.screen === 'ended' && s.scene === 'hunt-nolives' && s.timer && !/0:00/.test(s.timer), '三顆 ❤️ 用完：還有時間也結束，進「命用完」過場');
  const nol = await readScene();
  ok(JSON.stringify(nol) === JSON.stringify(NOLIVES), '命用完台詞照劇本 3-2 情況二', nol.join(' / '));
  await page.waitForTimeout(200);
  const res2 = await page.evaluate(() => { const r = document.getElementById('lbResult'); return r && { title: r.querySelector('#lbTitle').textContent, sum: r.querySelector('#lbSummary').textContent, extra: !!r.querySelector('#lbExtra'), practice: !!r.querySelector('#huntPracticeBtn'), hunt: JSON.parse(localStorage.getItem('ogg.run.v2')).hunt }; });
  ok(res2 && res2.title === '狩獵結束' && res2.sum === '你花費 8 分 20 秒 把鬼趕出城堡，並在荒野中封印了 1 隻鬼。' && res2.hunt === 1, '命用完的結算：標題「狩獵結束」、封印 1 隻', res2 && res2.sum);
  ok(res2 && !res2.extra && !res2.practice, '已經完成過：不再顯示「練習模式已解鎖」');
  ok(res2 && !NO_POS.test(res2.sum.replace('把鬼趕出城堡', '')), '結算文字不洩漏位置');
  await Promise.all([page.waitForURL(/prototype\/index\.html$/), press('#lbClose')]);
  ok(true, '「回關卡選單」回到選單');
  const menu = await page.evaluate(() => Array.from(document.querySelectorAll('a.card')).map((a) => a.getAttribute('data-item') + '|' + a.getAttribute('href') + '|' + (a.querySelector('em') ? 'note' : '')));
  ok(menu.includes('concave|concave-lens/index.html|') && menu.includes('concave-practice|concave-lens/index.html?practice=1|'), '選單：第三關連到荒野狩獵、沒有「製作中」；練習模式已解鎖', menu.join(' '));

  // ---------- 沒有前兩關成績（例如直接開網址）：結算一樣出現，趕鬼時間顯示 — ----------
  await page.evaluate(() => { localStorage.removeItem('ogg.run.v2'); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__proto);
  await page.tap('.story-skip'); await page.waitForTimeout(400);
  await press('#startHuntBtn', 150);
  await page.evaluate(() => window.__proto.setHuntRemaining(0));
  await page.waitForTimeout(100);
  await page.tap('.story-skip'); await page.waitForTimeout(150);
  const res3 = await page.evaluate(() => { const r = document.getElementById('lbResult'); return r && r.querySelector('#lbSummary').textContent + ' | ' + r.innerText; });
  ok(res3 && /你花費 — 把鬼趕出城堡，並在荒野中封印了 0 隻鬼。/.test(res3) && /還沒有過關成績/.test(res3), '沒有前兩關成績：趕鬼時間顯示「—」並說明', res3 && res3.split(' | ')[0]);

  // ---------- 練習模式不呼叫 Leaderboard ----------
  await page.goto(URL + '?practice=1');
  await page.waitForFunction(() => window.__proto);
  s = await info();
  ok(!s.scene && s.timer === null && s.remaining === null && s.screen === 'play', '?practice=1：沒有開場、不倒數');
  await page.evaluate(() => { window.__lbCalls = []; ['recordHunt', 'showResult', 'submit'].forEach((k) => { const f = Leaderboard[k]; Leaderboard[k] = function () { window.__lbCalls.push(k); return f.apply(this, arguments); }; }); });
  for (let k = 0; k < 3; k++) { if (k === 0) await toAnalysis(); await seal(await wrong()); }
  s = await info();
  const calls = await page.evaluate(() => window.__lbCalls);
  ok(s.lives === 0 && s.scene === 'failed' && !s.result && calls.length === 0, '?practice=1：一樣扣命、命用完是失敗畫面、不呼叫 Leaderboard', calls.join());

  ok(errors.length === 0, '沒有 JS 錯誤', errors.join(' | ') || undefined);
  await browser.close();
  server.close();
  console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

/*
 * 破關後「光路重現」動畫的共用檢查（tests/e2e-concave-lens.js 與 tests/e2e-convex-lens.js 使用）。
 *
 * 做法：封印成功後，把 state.replay.t0 往回撥到指定的時間點（只改測試時鐘，不改幾何），
 * 重畫一次，再讀 canvas 像素，確認每一段光線「該亮的地方亮了、還沒走到的地方沒亮」。
 * 光線的座標來自 app 的 replaySpec()；它是否符合物理由呼叫端的 physics(spec) 另外用配置驗證。
 *
 * 需要 app 的測試掛鉤提供：state、render、w2s、canvasSize、replaySpec、stats。
 */
'use strict';

const RAY = [0xff, 0xe0, 0x8a];    // RayReplay.RAY_COLOR  實際光線
const EXT = [0xff, 0x9b, 0xe6];    // RayReplay.EXT_COLOR  反向延長線
const POINT = [0xff, 0x5f, 0xd2];  // 像點
const CAPTION = [0xb9, 0x80, 0xff]; // 說明文字框的邊框

const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/**
 * 把動畫時鐘設成 tau 秒（null = 暫時關掉重現）、重畫、讀像素。
 * samples: [{ p:{x,y} 世界座標, color:[r,g,b], r: 搜尋半徑(px) }]
 * 回傳 { hits: [true|false|null(在畫面外)], totals: { ray, ext, point, caption } }。讀完後還原時鐘。
 */
function probe(page, hook, tau, samples, pointAt) {
  return page.evaluate(({ hook, tau, samples, pointAt, C }) => {
    const Hk = window[hook], st = Hk.state, saved = st.replay;
    st.replay = tau === null ? null : { t0: performance.now() - tau * 1000 };
    Hk.render();
    const cv = document.getElementById('view'), w = cv.width, h = cv.height, dpr = Hk.canvasSize().DPR;
    const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const is = (i, c) => Math.abs(d[i] - c[0]) < 10 && Math.abs(d[i + 1] - c[1]) < 10 && Math.abs(d[i + 2] - c[2]) < 10;
    // 只算「和關掉重現時的畫面不同」的像素：白色標示點壓在黃色作圖線上時，反鋸齒的混色會剛好接近光線色，
    // 但那些像素在兩張畫面裡一模一樣，不會被算進來。
    if (tau === null) window.__replayOff = d;
    const base = window.__replayOff && window.__replayOff.length === d.length ? window.__replayOff : null;
    const fresh = (i) => !base || Math.abs(d[i] - base[i]) + Math.abs(d[i + 1] - base[i + 1]) + Math.abs(d[i + 2] - base[i + 2]) > 24;
    const near = (pt, c, r) => {
      const q = Hk.w2s(pt), X = Math.round(q.x * dpr), Y = Math.round(q.y * dpr), R = Math.round(r * dpr);
      if (X - R < 0 || Y - R < 0 || X + R >= w || Y + R >= h) return null;
      let n = 0;
      for (let y = Y - R; y <= Y + R; y++) for (let x = X - R; x <= X + R; x++) { const i = (y * w + x) * 4; if (is(i, c) && (tau === null || fresh(i))) n++; }
      return n;
    };
    const hits = samples.map((s) => { const n = near(s.p, s.color, s.r); return n === null ? null : n > 0; });
    const totals = { ray: 0, ext: 0, caption: 0, point: pointAt ? near(pointAt, C.POINT, 7) : 0 };
    for (let i = 0; i < d.length; i += 4) {
      if (is(i, C.RAY)) totals.ray++;
      else if (is(i, C.EXT)) totals.ext++;
      else if (tau !== null && is(i, C.CAPTION) && fresh(i)) totals.caption++; // 說明框的邊框（在上方或下方）
    }
    st.replay = saved;
    Hk.render();
    return { hits, totals };
  }, { hook, tau, samples, pointAt: pointAt || null, C: { RAY, EXT, POINT, CAPTION } });
}

/** 還沒破關時：重現不能啟動，畫面上也不能有光路（那等於直接公布答案）。 */
async function checkReplayIdle({ page, hook, ok, T, when }) {
  const idle = await page.evaluate((hook) => ({ replay: !!window[hook].state.replay, btn: document.getElementById('replayBtn').hidden }), hook);
  // 重現只在 state.replay 存在且已破關時才畫；這裡確認它沒被啟動、按鈕也沒出現。
  ok(!idle.replay && idle.btn, T(when + '：光路重現沒有啟動、沒有「光路重現」按鈕'),
    idle.replay ? 'state.replay 已存在' : (idle.btn ? undefined : '「光路重現」按鈕已出現'));
}

// 每一段光線取 25%、75% 兩個位置
function specSamples(spec) {
  const samples = [];
  spec.segments.forEach((sg, i) => [0.25, 0.75].forEach((fr) => samples.push({
    seg: i, fr, color: sg.kind === 'extension' ? EXT : RAY, r: 5,
    p: { x: sg.a.x + (sg.b.x - sg.a.x) * fr, y: sg.a.y + (sg.b.y - sg.a.y) * fr }
  })));
  return samples;
}

/**
 * 封印成功之後呼叫。
 * physics(spec) → [{ ok, label, detail }]：由呼叫端用配置（不是用 spec 自己）驗證光路符合物理。
 */
async function checkReplay({ page, hook, ok, T, press, physics, shot }) {
  const info = await page.evaluate((hook) => {
    const Hk = window[hook];
    return { started: !!Hk.state.replay, btnHidden: document.getElementById('replayBtn').hidden, spec: Hk.replaySpec() };
  }, hook);
  ok(info.started && !info.btnHidden, T('封印成功後自動播放光路重現，並出現「光路重現」按鈕'));
  const spec = info.spec;
  (physics ? physics(spec) : []).forEach((r) => ok(r.ok, T('光路重現：' + r.label), r.detail));

  // 依動畫時間判斷每個取樣點該不該亮
  const samples = specSamples(spec);
  const expectLit = (sm, tau) => {
    const sg = spec.segments[sm.seg];
    return tau > sg.start && sm.fr < ease((tau - sg.start) / (sg.end - sg.start)) - 0.08;
  };
  const phases = [];
  spec.segments.forEach((sg) => { if (!phases.some((p) => p.start === sg.start && p.end === sg.end)) phases.push({ start: sg.start, end: sg.end }); });
  const taus = phases.map((p) => (p.start + p.end) / 2).concat([spec.duration]);
  const pointAt = spec.points && spec.points[0] ? spec.points[0].p : null;

  // 對照組：關掉重現的畫面。之後只算「和這張畫面不同」的像素。
  const off = await probe(page, hook, null, samples, pointAt);

  let end = null;
  for (const tau of taus) {
    const r = await probe(page, hook, tau, samples, pointAt);
    let tested = 0; const wrong = [];
    r.hits.forEach((hit, i) => {
      if (hit === null) return;
      tested++;
      if (hit !== expectLit(samples[i], tau)) wrong.push('段' + (samples[i].seg + 1) + '@' + samples[i].fr * 100 + '%' + (hit ? '不該亮' : '該亮'));
    });
    const isEnd = tau === spec.duration;
    ok(tested >= samples.length / 2 && wrong.length === 0,
      T('光路重現 t=' + tau.toFixed(2) + 's：' + (isEnd ? '全部光線都畫出來了' : '光線依序長出（走到的亮、沒走到的不亮）')),
      wrong.join('、') || tested + '/' + samples.length + ' 個取樣點在畫面內');
    if (isEnd) end = r;
  }
  ok(end.totals.caption > 0, T('光路重現：畫面上方有說明文字框'));
  if (pointAt) ok(end.totals.point > off.totals.point, T('光路重現：結束時標出像點'), end.totals.point + ' px（重現前 ' + off.totals.point + '）');
  if (spec.segments.some((s) => s.kind === 'extension')) ok(end.totals.ext > 0, T('光路重現：反向延長線用另一種顏色的虛線'));

  // 重播按鈕：重新開始，而且動畫真的在跑（畫格數增加）
  await page.evaluate((hook) => { const s = window[hook].state; s.replay = { t0: performance.now() - 60000 }; }, hook);
  await page.waitForTimeout(80);
  await press('#replayBtn');
  const f0 = await page.evaluate((hook) => ({ frame: window[hook].stats.frame, age: performance.now() - window[hook].state.replay.t0 }), hook);
  await page.waitForTimeout(350);
  const f1 = await page.evaluate((hook) => window[hook].stats.frame, hook);
  ok(f0.age < 2000 && f1 - f0.frame >= 3, T('「光路重現」按鈕可重播，動畫持續重畫'), '350 ms 內重畫 ' + (f1 - f0.frame) + ' 次');
  if (shot) {
    await page.evaluate((hook) => { const Hk = window[hook]; Hk.state.replay = { t0: performance.now() - 60000 }; Hk.render(); }, hook);
    await shot();
  }
}

module.exports = { checkReplay, checkReplayIdle, probe, RAY, EXT };

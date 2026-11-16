/*
 * app.js — 凹透鏡 vertical prototype 的互動與畫面。
 *
 * 分層：
 *   OpticsCore (../shared/optics-core.js)  純幾何，不知道畫面。
 *   ConcaveLensConfigs (configs.js)        參數化配置，由幾何導出像點。
 *   本檔                                    狀態、輸入、兩個視圖的繪製。
 *
 * 畫面上的像、線、交點、P 點全部即時由 OpticsCore 算出；沒有任何預畫的答案。
 * 之後的凸透鏡／平面鏡 prototype 可以重用 OpticsCore 與本檔的側視分析工具
 * （吸附畫線、縮放平移、選格封印）——那部分不依賴「凹」透鏡。
 */
(function () {
  'use strict';
  var Optics = window.OpticsCore;
  var Cfg = window.ConcaveLensConfigs;
  var WORLD = Cfg.WORLD;
  var floor = Cfg.floor;

  // 鬼體色：薄荷綠。夜景背景圖偏藍（月亮接近淡青），用背景裡不會出現的顏色，
  // 這樣「畫面上有沒有鬼」可以用像素顏色可靠地檢查。
  var GHOST_COLOR = '#9dffd8';
  var MARK_COLOR = '#ff5fd2';
  var SNAP_PX = 30;          // 吸附半徑（CSS px）；視覺點半徑只有 5
  var TAP_SLOP_PX = 10;      // 移動超過這個距離就算拖曳（平移），不算點擊
  var ZOOM_STEPS = [1, 1.5, 2.25, 3.4, 5];
  var BOUNDS = { minX: -(WORLD.cellCount * WORLD.cellWidth) - 40, maxX: 115, minY: -(WORLD.eyeHeight + 48), maxY: 178 };

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('view');
  var ctx = canvas.getContext('2d');

  var state = {
    cfgIndex: 0,
    phase: 'explore',     // 'explore' | 'analysis'
    facing: 0,
    lensUp: false,
    marker: null,         // { dir, tanX, tanY }
    mode: 'draw',         // 'draw' | 'seal'
    tool: 'line',         // 'line' | 'parallel'
    dashed: false,
    pending: null,        // 兩點連線的第一點
    lines: [],            // { kind, a, b, dashed }
    selectedCell: null,
    seal: null,           // { cell, t0, success, done }
    solved: false,
    attempts: 0,
    debug: /[?&]debug=1/.test(location.search),
    zoomIdx: 0,
    view: { s: 1, tx: 0, ty: 0 },
    seenAnalysisIntro: false
  };
  var stats = { frame: 0, ghostInLens: false, ghostRevealed: false, debugDrawn: false };
  var W = 300, H = 300, DPR = 1;

  function cfg() { return Cfg.all[state.cfgIndex]; }

  // ====================================================================
  // 探索視角
  // ====================================================================

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 每個方位一份固定的程序化場景（世界座標：x 右、y 上（相對眼睛）、z 前；cm）
  var scenes = [0, 1, 2, 3].map(function (dir) {
    var r = mulberry32(1234 + dir * 977);
    var G = -WORLD.eyeHeight;
    var sc = { dir: dir, ridge: [], stars: [], items: [], trail: [] };
    var i, z, n = 48, ph = r() * 6, amp = 0.05 + r() * 0.06;
    for (i = 0; i <= n; i++) {
      var t = -2.4 + (4.8 * i) / n;
      sc.ridge.push({ t: t, e: 0.035 + amp * (1 + Math.sin(t * 2.3 + ph) * 0.6 + Math.sin(t * 5.1 + ph * 2) * 0.3) + r() * 0.012 });
    }
    for (i = 0; i < 70; i++) sc.stars.push({ tx: (r() - 0.5) * 4.4, ty: 0.15 + r() * 1.6, s: 0.6 + r() * 1.1 });
    for (i = 0; i < 9; i++) {
      z = 500 + r() * 4500;
      sc.items.push({ type: 'tree', x: (r() - 0.5) * 2.4 * z, z: z, h: 320 + r() * 380, w: 120 + r() * 120, y: G });
    }
    for (i = 0; i < 14; i++) {
      z = 200 + r() * 2300;
      sc.items.push({ type: 'rock', x: (r() - 0.5) * 2.2 * z, z: z, h: 18 + r() * 45, w: 30 + r() * 70, y: G });
    }
    for (i = 0; i < 80; i++) {
      z = 110 + r() * r() * 1900;
      sc.items.push({ type: 'tuft', x: (r() - 0.5) * 2.4 * z, z: z, h: 8 + r() * 14, w: 10 + r() * 10, y: G });
    }
    // 每個方位一個地標，方便辨認方向（不是定位線索：與鬼的位置無關）
    var lm = [
      [{ x: -420, z: 1500, h: 260, w: 70 }, { x: -250, z: 1650, h: 300, w: 70 }, { x: -60 - 300, z: 1900, h: 240, w: 70 }],
      [{ x: 520, z: 1300, h: 520, w: 40 }],
      [{ x: -600, z: 2200, h: 420, w: 90 }, { x: -380, z: 2200, h: 420, w: 90 }],
      [{ x: 480, z: 1000, h: 330, w: 22 }]
    ][dir];
    lm.forEach(function (p) { sc.items.push({ type: 'pillar', x: p.x, z: p.z, h: p.h, w: p.w, y: G, dir: dir }); });
    var a1 = 0.10 + r() * 0.08, p1 = r() * 6, drift = (r() - 0.5) * 0.25;
    for (z = 60; z < 9000; z *= 1.18) {
      var cx = Math.sin(z / 520 + p1) * a1 * z * 0.5 + drift * z;
      sc.trail.push({ z: z, x: cx, hw: 42 });
    }
    sc.moon = dir === 2 ? { tx: 0.55, ty: 0.62 } : null;
    sc.items.sort(function (a, b) { return b.z - a.z; });
    return sc;
  });

  function exploreMetrics() {
    var fp = 0.72 * Math.min(W, H);
    return { fp: fp, cx: W / 2, cy: H * 0.5, rLens: fp * WORLD.lensRadius / WORLD.eyeToLens };
  }

  // 投影器：世界點 → 螢幕。裸眼是針孔；透鏡內用薄透鏡的等效深度（=看虛像）。
  function makeProjector(m, f) {
    var L = WORLD.eyeToLens;
    return function (x, y, z) {
      var zE = f == null ? z : Optics.effectiveDepthThroughLens(f, L, z - L);
      var k = m.fp / zE;
      return { x: m.cx + x * k, y: m.cy - y * k, k: k };
    };
  }

  function lerpColor(a, b, t) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  function ghostPath(c, px, py, hw, hh) {
    var i;
    c.beginPath();
    for (i = 0; i <= 16; i++) {
      var a = Math.PI - (Math.PI * i) / 16;
      c.lineTo(px + Math.cos(a) * hw, py - (hh - hw) - Math.sin(a) * hw);
    }
    for (i = 0; i <= 12; i++) {
      var u = 1 - i / 6; // 1 → -1
      c.lineTo(px + u * hw, py + hh - Math.abs(Math.sin((i / 12) * Math.PI * 3)) * hh * 0.22);
    }
    c.closePath();
  }

  function drawGhostShape(c, px, py, hw, hh) {
    c.save();
    c.shadowColor = 'rgba(120,255,200,.9)';
    c.shadowBlur = Math.max(4, hw * 0.6);
    c.fillStyle = GHOST_COLOR;
    ghostPath(c, px, py, hw, hh);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#12203a';
    c.beginPath();
    c.ellipse(px - hw * 0.36, py - hh * 0.3, hw * 0.16, hh * 0.16, 0, 0, 7);
    c.ellipse(px + hw * 0.36, py - hh * 0.3, hw * 0.16, hh * 0.16, 0, 0, 7);
    c.fill();
    c.beginPath();
    c.ellipse(px, py + hh * 0.08, hw * 0.2, hh * 0.1, 0, 0, 7);
    c.fill();
    c.restore();
  }

  function drawScene(sc, m, proj, ghost) {
    var i, p, q;
    var far = 1e7;
    var G = -WORLD.eyeHeight;
    // 天空（依仰角；透鏡內仰角被壓縮）
    var yH = proj(0, 0, far).y, yTop = proj(0, far * 1.1, far).y;
    var g = ctx.createLinearGradient(0, yTop, 0, yH);
    g.addColorStop(0, '#070b24'); g.addColorStop(0.6, '#2a2552'); g.addColorStop(1, '#a8627a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.ceil(yH) + 1);
    ctx.fillStyle = '#fff';
    for (i = 0; i < sc.stars.length; i++) {
      p = proj(sc.stars[i].tx * far, sc.stars[i].ty * far, far);
      ctx.globalAlpha = 0.75; ctx.fillRect(p.x, p.y, sc.stars[i].s, sc.stars[i].s);
    }
    ctx.globalAlpha = 1;
    if (sc.moon) {
      p = proj(sc.moon.tx * far, sc.moon.ty * far, far);
      ctx.fillStyle = '#f4ecc8'; ctx.beginPath(); ctx.arc(p.x, p.y, p.k * far * 0.05, 0, 7); ctx.fill();
    }
    // 遠山
    var zm = 60000;
    ctx.fillStyle = ['#2b2748', '#33294a', '#262a4c', '#30264a'][sc.dir];
    ctx.beginPath();
    p = proj(sc.ridge[0].t * zm, G, zm); ctx.moveTo(p.x, p.y);
    for (i = 0; i < sc.ridge.length; i++) { p = proj(sc.ridge[i].t * zm, sc.ridge[i].e * zm, zm); ctx.lineTo(p.x, p.y); }
    p = proj(sc.ridge[sc.ridge.length - 1].t * zm, G, zm); ctx.lineTo(p.x, p.y);
    ctx.closePath(); ctx.fill();
    // 地面（依深度分帶上色；透鏡內同一深度落在不同螢幕高度）
    var nearC = [34, 46, 30], farC = [92, 70, 96];
    ctx.fillStyle = lerpColor(nearC, farC, 0); ctx.fillRect(0, yH, W, H - yH + 1);
    var zs = [];
    for (var z = 50; z < 40000; z *= 1.22) zs.push(z);
    // 由近到遠畫：愈遠的帶愈小，蓋在上面
    for (i = 0; i < zs.length; i++) {
      var yy = proj(0, G, zs[i]).y;
      var tt = Math.min(1, Math.log(zs[i] / 50) / Math.log(40000 / 50));
      ctx.fillStyle = lerpColor(nearC, farC, Math.pow(tt, 1.6));
      ctx.fillRect(0, yH, W, Math.max(0, yy - yH));
    }
    // 小徑（連續線條最容易看出透鏡邊界的斷裂）
    ctx.fillStyle = 'rgba(190,160,120,.55)';
    for (i = 0; i < sc.trail.length - 1; i++) {
      var a = sc.trail[i], b = sc.trail[i + 1];
      if (a.z <= WORLD.eyeToLens + 5) continue;
      var a1 = proj(a.x - a.hw, G, a.z), a2 = proj(a.x + a.hw, G, a.z), b1 = proj(b.x - b.hw, G, b.z), b2 = proj(b.x + b.hw, G, b.z);
      ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b1.x, b1.y); ctx.closePath(); ctx.fill();
    }
    // 物件（遠 → 近），鬼依深度插入
    var ghostZ = ghost ? WORLD.eyeToLens + ghost.dObj : -1, ghostDone = !ghost;
    function drawGhostNow() {
      var gp = proj(0, ghost.h, ghostZ);
      drawGhostShape(ctx, gp.x, gp.y, WORLD.ghostHalfWidth * gp.k, WORLD.ghostHalfHeight * gp.k);
      ghostDone = true;
    }
    for (i = 0; i < sc.items.length; i++) {
      var it = sc.items[i];
      if (!ghostDone && it.z < ghostZ) drawGhostNow();
      if (it.z <= WORLD.eyeToLens + 5) continue;
      p = proj(it.x, it.y, it.z);
      var w = it.w * p.k, h = it.h * p.k;
      if (p.x < -w - 50 || p.x > W + w + 50) continue;
      if (it.type === 'tree') {
        ctx.fillStyle = '#1a1420'; ctx.fillRect(p.x - w * 0.06, p.y - h * 0.5, w * 0.12, h * 0.5);
        ctx.fillStyle = '#16261f';
        ctx.beginPath(); ctx.moveTo(p.x - w / 2, p.y - h * 0.3); ctx.lineTo(p.x, p.y - h); ctx.lineTo(p.x + w / 2, p.y - h * 0.3); ctx.closePath(); ctx.fill();
      } else if (it.type === 'rock') {
        ctx.fillStyle = '#4a465c';
        ctx.beginPath(); ctx.moveTo(p.x - w / 2, p.y); ctx.lineTo(p.x - w * 0.25, p.y - h); ctx.lineTo(p.x + w * 0.3, p.y - h * 0.8); ctx.lineTo(p.x + w / 2, p.y); ctx.closePath(); ctx.fill();
      } else if (it.type === 'tuft') {
        ctx.strokeStyle = '#5d7a4a'; ctx.lineWidth = Math.max(1, p.k * 2);
        ctx.beginPath(); ctx.moveTo(p.x - w / 2, p.y); ctx.lineTo(p.x - w * 0.3, p.y - h); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - h * 1.2); ctx.moveTo(p.x + w / 2, p.y); ctx.lineTo(p.x + w * 0.3, p.y - h); ctx.stroke();
      } else if (it.type === 'pillar') {
        ctx.fillStyle = ['#8d88a8', '#3a2c2c', '#a09a8a', '#c9a24a'][it.dir];
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);
        if (it.dir === 3) { ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.arc(p.x, p.y - h, w * 1.6, 0, 7); ctx.fill(); }
        if (it.dir === 1) { ctx.fillRect(p.x - w * 3, p.y - h * 0.8, w * 6, w * 0.6); ctx.fillRect(p.x - w * 2, p.y - h * 0.6, w * 4, w * 0.5); }
        if (it.dir === 2) { ctx.fillRect(p.x - w / 2, p.y - h, w * 3, w * 0.7); }
      }
    }
    if (!ghostDone) drawGhostNow();
  }

  // --------------------------------------------------------------------
  // 背景圖（docs/concepts/ 的荒野概念圖，壓成 JPEG 放在 assets/）
  //
  // 圖是一張寬幅全景，本身沒有深度資料。透鏡內的重映射用「地面＋遠景」深度模型：
  //   - 地平線以下的像素：當成地面上的點，深度 z = fp·eyeHeight / (離地平線的螢幕距離)
  //   - 地平線以上的像素：當成無限遠
  // 每個深度套用和鬼相同的薄透鏡等效深度公式，所以透鏡內是同一張圖被光學重映射，
  // 不是另一張縮小圖。直立物（拱門、枯樹）在地平線以下的部分被當成地面，會有些微變形。
  // 網址加 ?bg=0 改用程式畫的場景。
  // --------------------------------------------------------------------
  // 四個方位各一張圖（北、東、南、西）。horizon = 地平線占圖高的比例（目測）。
  var BG_DIRS = [
    { src: 'assets/wilderness-3-moon.jpg', horizon: 0.52 },     // 北：滿月與拱門
    { src: 'assets/wilderness-2-pillars.jpg', horizon: 0.55 },  // 東：石柱遺跡
    { src: 'assets/wilderness-1-open.jpg', horizon: 0.53 },     // 南：空曠草原
    { src: 'assets/wilderness-4-wall.jpg', horizon: 0.54 }      // 西：斷牆
  ];
  var bgOff = /[?&]bg=0/.test(location.search);
  var bg = { imgs: [], ready: false, settled: bgOff, img: null, horizon: 0.5 };
  var bgWaiters = [];
  function bgSettle(ok) {
    bg.ready = ok; bg.settled = true;
    bgWaiters.splice(0).forEach(function (fn) { fn(); });
  }
  if (!bgOff) {
    var bgLeft = BG_DIRS.length, bgFailed = false;
    BG_DIRS.forEach(function (d, i) {
      var im = new Image();
      im.onload = function () { if (--bgLeft === 0) bgSettle(!bgFailed); };
      im.onerror = function () { bgFailed = true; if (--bgLeft === 0) bgSettle(false); };
      im.src = d.src;
      bg.imgs[i] = im;
    });
  }
  // 選定目前方位的圖（四張都載入成功才會用圖；否則整體退回程式畫的場景）
  function bgUse(facing) { bg.img = bg.imgs[facing]; bg.horizon = BG_DIRS[facing].horizon; }

  // 背景圖在螢幕上的擺放：地平線對齊主光軸高度（cy），圖水平置中。
  function bgLayout(m, facing) {
    bgUse(facing);
    var iw = bg.img.naturalWidth, ih = bg.img.naturalHeight, hf = bg.horizon;
    var h = 1.02 * Math.max(m.cy / hf, (H - m.cy) / (1 - hf), (W * 1.5 * ih) / iw);
    var w = (h * iw) / ih;
    return { x: -(w - W) / 2, y: m.cy - hf * h, w: w, h: h };
  }

  function drawBgNaked(m, facing) {
    var L = bgLayout(m, facing);
    ctx.fillStyle = '#050814'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(bg.img, L.x, L.y, L.w, L.h);
  }

  // 透鏡內：螢幕上離地平線 v 的那一列，顯示的是裸眼畫面中離地平線 V 的那一列（V ≥ v），
  // 並以透鏡中心為準水平縮小 v/V 倍。由 v 反求 V 用二分法（關係單調）。
  function lensRatioAtDepth(f, z) {
    var L = WORLD.eyeToLens;
    var zz = Math.max(z, L + 5);
    return zz / Optics.effectiveDepthThroughLens(f, L, zz - L);
  }
  function drawBgLens(m, facing, f) {
    var Lay = bgLayout(m, facing);
    var iw = bg.img.naturalWidth, ih = bg.img.naturalHeight;
    var kx = iw / Lay.w, ky = ih / Lay.h;
    var rInf = lensRatioAtDepth(f, 1e9);
    var groundK = m.fp * WORLD.eyeHeight;
    var r = m.rLens;
    function sourceV(v) {
      if (v <= 0) return v / rInf;
      var lo = v, hi = v / rInf, i, mid;
      for (i = 0; i < 22; i++) {
        mid = (lo + hi) / 2;
        if (mid * lensRatioAtDepth(f, groundK / mid) < v) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    ctx.fillStyle = '#050814'; ctx.fillRect(m.cx - r, m.cy - r, 2 * r, 2 * r);
    var y0 = Math.floor(m.cy - r), y1 = Math.ceil(m.cy + r), y;
    var V = sourceV(y0 - m.cy), Vn;
    for (y = y0; y < y1; y++, V = Vn) {
      Vn = sourceV(y + 1 - m.cy);
      var v = y + 0.5 - m.cy;
      var ratio = Math.abs(v) < 0.5 ? rInf : (v / ((V + Vn) / 2));
      var halfSrc = r / ratio;
      var sx = (m.cx - halfSrc - Lay.x) * kx, sw = 2 * halfSrc * kx;
      var sy = (m.cy + V - Lay.y) * ky, sh = Math.max(0.5, (Vn - V) * ky);
      var dx = m.cx - r, dw = 2 * r;
      // 來源超出圖片範圍時，裁掉超出的部分並等比例縮短目的端
      if (sx < 0) { dx += (-sx / sw) * dw; dw *= (sw + sx) / sw; sw += sx; sx = 0; }
      if (sx + sw > iw) { dw *= (iw - sx) / sw; sw = iw - sx; }
      if (sy < 0 || sy + sh > ih || sw <= 0) continue;
      ctx.drawImage(bg.img, sx, sy, sw, sh, dx, y, dw, 1.6);
    }
  }

  function drawGhostThroughLens(m, c) {
    var gp = makeProjector(m, c.f)(0, c.h, WORLD.eyeToLens + c.dObj);
    drawGhostShape(ctx, gp.x, gp.y, WORLD.ghostHalfWidth * gp.k, WORLD.ghostHalfHeight * gp.k);
  }

  function imageScreenPos() {
    var c = cfg(), m = exploreMetrics();
    var tan = Optics.apparentTanThroughLens(c.f, WORLD.eyeToLens, c.dObj, c.h);
    return { x: m.cx, y: m.cy - m.fp * tan, tan: tan, r: Math.max(8, m.fp * WORLD.ghostHalfHeight / Optics.effectiveDepthThroughLens(c.f, WORLD.eyeToLens, c.dObj)) };
  }

  function renderExplore() {
    var c = cfg(), m = exploreMetrics(), sc = scenes[state.facing];
    var useBg = bg.ready;
    // 裸眼：永遠沒有鬼
    if (useBg) drawBgNaked(m, state.facing); else drawScene(sc, m, makeProjector(m, null), null);
    stats.ghostInLens = false;
    if (state.lensUp) {
      var showGhost = state.facing === c.direction && !state.solved;
      // 握柄
      ctx.fillStyle = '#3a2d22'; ctx.fillRect(m.cx - 9, m.cy + m.rLens, 18, H);
      ctx.save();
      ctx.beginPath(); ctx.arc(m.cx, m.cy, m.rLens, 0, Math.PI * 2); ctx.clip();
      if (useBg) {
        drawBgLens(m, state.facing, c.f);
        if (showGhost) drawGhostThroughLens(m, c);
        // 鏡片邊緣較厚：往邊緣略暗，讓鏡片看起來像玻璃
        var vg = ctx.createRadialGradient(m.cx, m.cy, m.rLens * 0.55, m.cx, m.cy, m.rLens);
        vg.addColorStop(0, 'rgba(8,12,30,0)'); vg.addColorStop(1, 'rgba(8,12,30,.38)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      } else {
        drawScene(sc, m, makeProjector(m, c.f), showGhost ? c : null);
      }
      ctx.fillStyle = 'rgba(170,205,255,.07)'; ctx.fillRect(0, 0, W, H);
      ctx.restore();
      stats.ghostInLens = showGhost;
      ctx.lineWidth = 7; ctx.strokeStyle = '#c9d2e6';
      ctx.beginPath(); ctx.arc(m.cx, m.cy, m.rLens, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#2a3048';
      ctx.beginPath(); ctx.arc(m.cx, m.cy, m.rLens - 4, 0, Math.PI * 2); ctx.stroke();
    }
    if (state.marker && state.marker.dir === state.facing) {
      drawMarker(m.cx + m.fp * state.marker.tanX, m.cy - m.fp * state.marker.tanY, true);
    }
    // 方位 HUD
    ctx.font = '600 15px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W - 96, 8, 88, 28);
    ctx.fillStyle = '#fff'; ctx.fillText('面向：' + WORLD.directions[state.facing], W - 16, 14);
    if (state.debug) {
      stats.debugDrawn = true;
      if (state.facing === c.direction) {
        var np = makeProjector(m, null)(0, c.h, WORLD.eyeToLens + c.dObj);
        ctx.strokeStyle = '#3dff7a'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.strokeRect(np.x - 14, np.y - 14, 28, 28); ctx.setLineDash([]);
        ctx.fillStyle = '#3dff7a'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
        ctx.fillText('裸眼方向上的鬼本體 (debug)', np.x + 18, np.y - 6);
      }
    }
  }

  function drawMarker(x, y, withLabel) {
    ctx.save();
    ctx.strokeStyle = MARK_COLOR; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 19, y); ctx.lineTo(x - 7, y); ctx.moveTo(x + 7, y); ctx.lineTo(x + 19, y);
    ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 7); ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 19); ctx.stroke();
    ctx.fillStyle = MARK_COLOR; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    if (withLabel) {
      ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText('虛像標記', x + 22, y - 16);
      ctx.fillText('虛像標記', x + 22, y - 16);
    }
    ctx.restore();
  }

  function exploreTap(x, y) {
    var c = cfg(), m = exploreMetrics();
    if (!state.lensUp) { setStatus('裸眼什麼也看不到。先「舉起凹透鏡」再找。'); return; }
    if (Math.hypot(x - m.cx, y - m.cy) > m.rLens) { setStatus('鬼只會出現在透鏡裡。請點透鏡內看到的鬼像。'); return; }
    var ip = imageScreenPos();
    if (state.facing === c.direction && Math.hypot(x - ip.x, y - ip.y) <= Math.max(36, ip.r + 18)) {
      state.marker = { dir: state.facing, tanX: 0, tanY: ip.tan };
      setStatus('已標記「虛像」——這是鬼看起來在的位置，不是鬼本體。可放下透鏡確認，再切到側視分析。');
    } else {
      setStatus('這裡沒有異象。找到透鏡裡發光的鬼像再點它。');
    }
    syncUI();
  }

  // ====================================================================
  // 側視分析
  // ====================================================================

  function w2s(p) { return { x: p.x * state.view.s + state.view.tx, y: -p.y * state.view.s + state.view.ty }; }
  function s2w(p) { return { x: (p.x - state.view.tx) / state.view.s, y: -(p.y - state.view.ty) / state.view.s }; }

  function fitScale() {
    return Math.min(W / (BOUNDS.maxX - BOUNDS.minX), H / (BOUNDS.maxY - BOUNDS.minY));
  }
  function clampView() {
    var v = state.view, cw = (BOUNDS.maxX - BOUNDS.minX) * v.s, ch = (BOUNDS.maxY - BOUNDS.minY) * v.s;
    if (cw <= W) v.tx = (W - cw) / 2 - BOUNDS.minX * v.s;
    else v.tx = Math.min(-BOUNDS.minX * v.s, Math.max(W - BOUNDS.maxX * v.s, v.tx));
    if (ch <= H) v.ty = (H - ch) / 2 + BOUNDS.maxY * v.s;
    else v.ty = Math.min(BOUNDS.maxY * v.s, Math.max(H + BOUNDS.minY * v.s, v.ty));
  }
  function setZoom(idx, anchor) {
    idx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx));
    var a = anchor || { x: W / 2, y: H / 2 };
    var wpt = s2w(a);
    state.zoomIdx = idx;
    state.view.s = fitScale() * ZOOM_STEPS[idx];
    state.view.tx = a.x - wpt.x * state.view.s;
    state.view.ty = a.y + wpt.y * state.view.s;
    clampView();
    syncUI(); requestRender();
  }

  function geomLine(l) {
    return l.kind === 'parallel' ? Optics.horizontalLine(l.a) : Optics.lineThrough(l.a, l.b);
  }

  /** 可吸附點：O、F、F′、虛像標記，加上「學生自己畫的線」與透鏡平面的交點 P。 */
  function snapPoints() {
    var c = cfg();
    var pts = [
      { id: 'O', label: 'O', x: 0, y: 0 },
      { id: 'F', label: 'F', x: c.focal.objectSide.x, y: 0 },
      { id: 'F2', label: 'F′', x: c.focal.imageSide.x, y: 0 },
      { id: 'I', label: '虛像', x: c.image.x, y: c.image.y }
    ];
    state.lines.forEach(function (l) {
      var p = Optics.intersectVertical(geomLine(l), 0);
      if (!p || Math.abs(p.y) > 400) return;
      for (var i = 0; i < pts.length; i++) if (Optics.dist(pts[i], p) < 0.5) return;
      pts.push({ id: 'P', label: 'P', x: 0, y: p.y });
    });
    return pts;
  }

  function nearestSnap(sx, sy) {
    var best = null, bd = SNAP_PX;
    snapPoints().forEach(function (p) {
      var q = w2s(p), d = Math.hypot(q.x - sx, q.y - sy);
      if (d <= bd) { bd = d; best = p; }
    });
    return best;
  }

  /** 學生畫的線兩兩的交點（只來自學生的線，不來自答案）。 */
  function studentIntersections() {
    var out = [], i, j;
    for (i = 0; i < state.lines.length; i++) for (j = i + 1; j < state.lines.length; j++) {
      var p = Optics.intersect(geomLine(state.lines[i]), geomLine(state.lines[j]));
      if (p && p.x > BOUNDS.minX - 200 && p.x < BOUNDS.maxX + 200 && Math.abs(p.y) < 500) out.push(p);
    }
    return out;
  }

  function strokeInfinite(line, color, width, dash) {
    var len = Math.hypot(line.d.x, line.d.y), ux = line.d.x / len, uy = line.d.y / len, R = 6000;
    var a = w2s({ x: line.p.x - ux * R, y: line.p.y - uy * R }), b = w2s({ x: line.p.x + ux * R, y: line.p.y + uy * R });
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  }

  function label(text, x, y, color, align) {
    ctx.save(); ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,24,.9)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
  }

  function drawMagicCircle(cx, cy, rx, alpha, spin) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = '#d9a8ff'; ctx.lineWidth = 2; ctx.shadowColor = '#b060ff'; ctx.shadowBlur = 12;
    var ry = Math.max(4, rx * 0.28), i;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.68, ry * 0.68, 0, 0, 7); ctx.stroke();
    ctx.beginPath();
    for (i = 0; i <= 5; i++) {
      var a = spin + (i * 4 * Math.PI) / 5;
      var px = cx + Math.cos(a) * rx * 0.68, py = cy + Math.sin(a) * ry * 0.68;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    var gr = ctx.createLinearGradient(0, cy - rx * 2.2, 0, cy);
    gr.addColorStop(0, 'rgba(190,120,255,0)'); gr.addColorStop(1, 'rgba(190,120,255,.35)');
    ctx.fillStyle = gr; ctx.shadowBlur = 0; ctx.fillRect(cx - rx * 0.68, cy - rx * 2.2, rx * 1.36, rx * 2.2);
    ctx.restore();
  }

  function renderAnalysis() {
    var c = cfg(), v = state.view, s = v.s, i, p, q;
    var G = -WORLD.eyeHeight;
    ctx.fillStyle = '#0b0e1f'; ctx.fillRect(0, 0, W, H);
    // 座標輔助格線
    ctx.lineWidth = 1;
    for (var gx = -1200; gx <= 300; gx += 50) {
      p = w2s({ x: gx, y: 0 });
      ctx.strokeStyle = gx % 100 === 0 ? 'rgba(120,135,210,.20)' : 'rgba(120,135,210,.08)';
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
    }
    for (var gy = -150; gy <= 400; gy += 50) {
      p = w2s({ x: 0, y: gy });
      ctx.strokeStyle = gy % 100 === 0 ? 'rgba(120,135,210,.20)' : 'rgba(120,135,210,.08)';
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
    }
    // 地面與地板格
    var fl = w2s({ x: 0, y: G });
    ctx.fillStyle = '#1a2018'; ctx.fillRect(0, fl.y, W, H - fl.y);
    var tileH = 34 * s;
    for (i = 1; i <= floor.count; i++) {
      var x0 = w2s({ x: -i * floor.width, y: G }).x, x1 = w2s({ x: -(i - 1) * floor.width, y: G }).x;
      ctx.fillStyle = i % 2 ? '#2b3550' : '#232b42';
      ctx.fillRect(x0, fl.y, x1 - x0, tileH);
      if (state.selectedCell === i) {
        ctx.fillStyle = 'rgba(255,209,102,.16)'; ctx.fillRect(x0, 0, x1 - x0, fl.y);
        ctx.fillStyle = 'rgba(255,209,102,.75)'; ctx.fillRect(x0, fl.y, x1 - x0, tileH);
      }
      ctx.strokeStyle = '#8b98d8'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, fl.y, x1 - x0, tileH);
      if (x1 - x0 >= 18) {
        ctx.font = (x1 - x0 >= 30 ? '12px' : '10px') + ' system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = state.selectedCell === i ? '#201500' : '#aab3e6';
        ctx.fillText(String(i), (x0 + x1) / 2, fl.y + tileH / 2);
      }
    }
    ctx.strokeStyle = '#8b98d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, fl.y); ctx.lineTo(W, fl.y); ctx.stroke();
    // 主光軸
    p = w2s({ x: 0, y: 0 });
    ctx.save(); ctx.strokeStyle = '#7f8bc9'; ctx.lineWidth = 1.5; ctx.setLineDash([14, 4, 3, 4]);
    ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke(); ctx.restore();
    label('主光軸', Math.max(34, w2s({ x: BOUNDS.minX + 60, y: 0 }).x), p.y - 11, '#7f8bc9');
    // 凹透鏡（示意符號：延伸的薄透鏡平面；端點為凹透鏡的倒箭頭）
    var lt = w2s({ x: 0, y: 160 }), lb = w2s({ x: 0, y: -148 });
    ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(lt.x, lt.y); ctx.lineTo(lb.x, lb.y);
    ctx.moveTo(lt.x - 8, lt.y - 9); ctx.lineTo(lt.x, lt.y); ctx.lineTo(lt.x + 8, lt.y - 9);
    ctx.moveTo(lb.x - 8, lb.y + 9); ctx.lineTo(lb.x, lb.y); ctx.lineTo(lb.x + 8, lb.y + 9); ctx.stroke();
    label('凹透鏡', lt.x, lt.y - 20, '#9fd8ff');
    // 觀察者（眼睛）
    var eye = w2s({ x: WORLD.eyeToLens, y: 0 });
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(eye.x + 12, eye.y - 9); ctx.quadraticCurveTo(eye.x - 6, eye.y, eye.x + 12, eye.y + 9); ctx.stroke();
    ctx.beginPath(); ctx.arc(eye.x + 5, eye.y, 3, 0, 7); ctx.fill();
    label('你', eye.x + 12, eye.y + 24, '#fff');

    // 學生畫的線
    state.lines.forEach(function (l) {
      strokeInfinite(geomLine(l), state.replay ? 'rgba(255,255,255,.22)' : (l.kind === 'parallel' ? '#7dffb2' : '#ffd166'), 2, l.dashed ? [8, 6] : null);
    });
    studentIntersections().forEach(function (pt) {
      q = w2s(pt); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.stroke();
    });
    // 吸附點
    snapPoints().forEach(function (sp) {
      q = w2s(sp);
      if (sp.id === 'I') { drawMarker(q.x, q.y, false); label('虛像標記', q.x, q.y + (sp.y >= 0 ? -29 : 29), MARK_COLOR); return; }
      ctx.fillStyle = sp.id === 'P' ? '#7dffb2' : '#fff';
      ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill();
      if (state.mode === 'draw') { ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, 14, 0, 7); ctx.stroke(); }
      if (sp.id === 'P') label('P', q.x + 14, q.y - 12, '#7dffb2');
      else label(sp.label, q.x + (sp.id === 'O' ? -11 : 0), q.y + (sp.id === 'O' ? 15 : 18) * (sp.id !== 'O' && c.image.y < 0 ? -1 : 1), '#fff');
    });
    if (state.pending) {
      q = w2s(state.pending); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(q.x, q.y, 18, 0, 7); ctx.stroke();
    }

    // 封印法陣
    stats.ghostRevealed = false;
    if (state.seal) {
      var t = (performance.now() - state.seal.t0) / 1000;
      var cc = w2s({ x: floor.centerX(state.seal.cell), y: G });
      var rx = Math.max(16, floor.width * s * 0.5);
      if (state.seal.success) {
        drawMagicCircle(cc.x, cc.y + tileH * 0.4, rx * Math.min(1, t / 0.5), 1, t * 1.5);
        if (t > 0.7) {
          var gp = w2s(c.object), ga = Math.min(1, (t - 0.7) / 0.5);
          ctx.save(); ctx.globalAlpha = ga;
          drawGhostShape(ctx, gp.x, gp.y, Math.max(7, WORLD.ghostHalfWidth * s), Math.max(10, WORLD.ghostHalfHeight * s));
          ctx.restore();
          label('鬼本體', gp.x, gp.y - Math.max(10, WORLD.ghostHalfHeight * s) - 12, GHOST_COLOR);
          stats.ghostRevealed = true;
        }
      } else if (t < 1.5) {
        drawMagicCircle(cc.x, cc.y + tileH * 0.4, rx * Math.min(1, t / 0.5), t < 0.8 ? 1 : 1 - (t - 0.8) / 0.7, t * 1.5);
      }
    }

    // 破關後的光路重現（正推）：鬼本體 → 兩條光線 → 凹透鏡 → 反向延長 → 虛像
    if (state.replay && state.solved) {
      var spec = replaySpec();
      var tau = Math.min(spec.duration, (performance.now() - state.replay.t0) / 1000);
      if (tau > spec.imageAt) {
        var ip = w2s(c.image);
        ctx.save(); ctx.globalAlpha = 0.6 * Math.min(1, (tau - spec.imageAt) / 0.5);
        drawGhostShape(ctx, ip.x, ip.y, Math.max(4, WORLD.ghostHalfWidth * c.m * s), Math.max(6, WORLD.ghostHalfHeight * c.m * s));
        ctx.restore();
      }
      window.RayReplay.draw(ctx, w2s, spec, tau, { x: 0, y: 0, w: W, h: H });
    }

    // Debug overlay（理論光線、物點、目標格）
    if (state.debug) {
      stats.debugDrawn = true;
      var r = Optics.reverseConstruct(c.f, c.image);
      strokeInfinite(r.centerLine, 'rgba(61,255,122,.8)', 1, [3, 5]);
      strokeInfinite(r.focusLine, 'rgba(61,255,122,.8)', 1, [3, 5]);
      strokeInfinite(r.parallelLine, 'rgba(61,255,122,.8)', 1, [3, 5]);
      q = w2s(r.object); ctx.strokeStyle = '#3dff7a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x - 8, q.y - 8); ctx.lineTo(q.x + 8, q.y + 8); ctx.moveTo(q.x + 8, q.y - 8); ctx.lineTo(q.x - 8, q.y + 8); ctx.stroke();
      var tx0 = w2s({ x: -c.targetCell * floor.width, y: G }).x, tx1 = w2s({ x: -(c.targetCell - 1) * floor.width, y: G }).x;
      ctx.setLineDash([5, 4]); ctx.strokeRect(tx0, fl.y, tx1 - tx0, tileH); ctx.setLineDash([]);
    }
  }

  // 光路重現的內容：全部由配置的幾何座標組成（透鏡在 x = 0）。
  //   光線 1：由鬼平行主軸射到透鏡上的 P，折射後發散，反向延長通過物側焦點 F。
  //   光線 2：由鬼射向光心 O，直線通過。
  //   兩條折射光的反向延長線交於虛像。
  function replaySpec() {
    var c = cfg(), o = c.object, F = c.focal.objectSide, R = 105;
    var P = { x: 0, y: o.y }, O = { x: 0, y: 0 };
    return {
      duration: 3.8, imageAt: 2.9,
      segments: [
        { a: o, b: P, start: 0, end: 1.0, kind: 'ray' },
        { a: o, b: O, start: 0, end: 1.0, kind: 'ray' },
        { a: P, b: { x: R, y: o.y + (o.y * R) / Math.abs(c.f) }, start: 1.0, end: 1.8, kind: 'ray' },
        { a: O, b: { x: R, y: (o.y * R) / o.x }, start: 1.0, end: 1.8, kind: 'ray' },
        { a: P, b: F, start: 1.9, end: 2.9, kind: 'extension' },
        { a: O, b: c.image, start: 1.9, end: 2.9, kind: 'extension' }
      ],
      points: [{ p: c.image, start: 2.9 }],
      captions: [
        { start: 0, text: '鬼身上發出兩條光線' },
        { start: 1.0, text: '經過凹透鏡：平行的那條發散，過光心的直走' },
        { start: 1.9, text: '把折射後的光線反向延長（虛線）' },
        { start: 2.9, text: '實際光路 → 反向延長 → 虛像位置' }
      ]
    };
  }
  function replayRunning() { return !!state.replay && (performance.now() - state.replay.t0) / 1000 < replaySpec().duration + 0.3; }
  function startReplay() { $('banner').hidden = true; state.replay = { t0: performance.now() }; animate(); }

  function analysisTap(x, y) {
    if (state.mode === 'seal') {
      if (state.solved || (state.seal && !state.seal.done)) return;
      var k = floor.cellAt(s2w({ x: x, y: y }).x);
      if (k == null) { setStatus('請點一個地板格（整個直欄都可以點）。'); return; }
      state.selectedCell = k; state.seal = null;
      setStatus('已選第 ' + k + ' 格。確定的話按「施放封印法陣」。');
      syncUI(); requestRender();
      return;
    }
    var sp = nearestSnap(x, y);
    if (!sp) { setStatus('線的端點要吸附在標示點上（O、F、F′、虛像標記、P）。點在點的附近即可。'); return; }
    var pt = { x: sp.x, y: sp.y, label: sp.label };
    if (state.tool === 'parallel') {
      state.lines.push({ kind: 'parallel', a: pt, b: null, dashed: state.dashed });
      setStatus('已畫出通過「' + sp.label + '」、平行主光軸的線。');
    } else if (!state.pending) {
      state.pending = pt;
      setStatus('起點：「' + sp.label + '」。再點另一個點完成連線（會自動延長）。');
    } else if (Optics.dist(state.pending, pt) < 0.5) {
      state.pending = null; setStatus('已取消起點。');
    } else {
      state.lines.push({ kind: 'line', a: state.pending, b: pt, dashed: state.dashed });
      setStatus('已畫出通過「' + state.pending.label + '」與「' + sp.label + '」的直線。它與透鏡的交點會成為可吸附的 P。');
      state.pending = null;
    }
    syncUI(); requestRender();
  }

  function castSeal() {
    if (state.selectedCell == null || state.solved || (state.seal && !state.seal.done)) return;
    var c = cfg();
    state.attempts++;
    var success = state.selectedCell === c.targetCell;
    state.seal = { cell: state.selectedCell, t0: performance.now(), success: success, done: false };
    setStatus('法陣展開中……');
    syncUI(); animate();
    setTimeout(function () {
      if (!state.seal) return;
      state.seal.done = true;
      if (success) {
        state.solved = true;
        setStatus('封印成功！鬼被迫顯形——牠的本體不在你標記的虛像位置。看看光是怎麼走的。');
        startReplay();
      } else {
        state.selectedCell = null;
        giggle();
        setStatus('法陣落空，裡面什麼也沒有……（嘻）　再檢查你的光線作圖。');
      }
      syncUI(); requestRender();
    }, 1500);
  }

  // 短促、單聲道、無方向性的回饋音
  var audioCtx = null;
  function giggle() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = audioCtx.currentTime;
      [0, 0.11].forEach(function (dt) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(880, t0 + dt); o.frequency.exponentialRampToValueAtTime(1320, t0 + dt + 0.08);
        g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.1);
        o.connect(g); g.connect(audioCtx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.11);
      });
    } catch (e) { /* 沒有音效也不影響玩法 */ }
  }

  // ====================================================================
  // 共用：輸入、UI、繪製排程
  // ====================================================================

  var pointers = {}, gesture = null;
  function localPos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function pointerCount() { return Object.keys(pointers).length; }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    pointers[e.pointerId] = true;
    if (pointerCount() === 1) {
      var p = localPos(e);
      gesture = { id: e.pointerId, x0: p.x, y0: p.y, lx: p.x, ly: p.y, moved: false, multi: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else if (gesture) {
      gesture.multi = true; // 兩指：既不畫線也不縮放（縮放只用按鈕）
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!gesture || gesture.id !== e.pointerId || gesture.multi) return;
    var p = localPos(e);
    if (!gesture.moved && Math.hypot(p.x - gesture.x0, p.y - gesture.y0) > TAP_SLOP_PX) gesture.moved = true;
    if (gesture.moved && state.phase === 'analysis') {
      state.view.tx += p.x - gesture.lx; state.view.ty += p.y - gesture.ly;
      clampView(); requestRender();
    }
    gesture.lx = p.x; gesture.ly = p.y;
  });
  function endPointer(e, cancelled) {
    delete pointers[e.pointerId];
    if (!gesture) return;
    if (gesture.id === e.pointerId && !gesture.moved && !gesture.multi && !cancelled) {
      var p = localPos(e);
      if (state.phase === 'explore') exploreTap(p.x, p.y); else analysisTap(p.x, p.y);
      requestRender();
    }
    if (pointerCount() === 0) gesture = null;
  }
  canvas.addEventListener('pointerup', function (e) { endPointer(e, false); });
  canvas.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // iOS Safari 會忽略 user-scalable=no；擋掉頁面層級的雙指縮放手勢
  ['gesturestart', 'gesturechange'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }); });

  function setStatus(t) { $('status').textContent = t; }

  var bannerTimer = null;
  function showBanner(text, ms) {
    var b = $('banner'); b.textContent = text; b.hidden = false; b.style.opacity = '1';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { b.style.opacity = '0'; setTimeout(function () { b.hidden = true; }, 450); }, ms);
  }

  function syncUI() {
    var analysis = state.phase === 'analysis';
    $('exploreControls').hidden = analysis;
    $('analysisControls').hidden = !analysis;
    $('zoomBox').hidden = !analysis;
    $('lensBtn').textContent = state.lensUp ? '放下凹透鏡' : '舉起凹透鏡';
    $('toAnalysis').disabled = !state.marker;
    $('toAnalysis').classList.toggle('primary', !!state.marker);
    $('modeDraw').classList.toggle('on', state.mode === 'draw');
    $('modeSeal').classList.toggle('on', state.mode === 'seal');
    $('drawRow').hidden = state.mode !== 'draw';
    $('sealRow').hidden = state.mode !== 'seal';
    $('toolLine').classList.toggle('on', state.tool === 'line');
    $('toolParallel').classList.toggle('on', state.tool === 'parallel');
    $('styleBtn').textContent = state.dashed ? '虛線' : '實線';
    $('undoBtn').disabled = !state.lines.length && !state.pending;
    $('clearBtn').disabled = !state.lines.length && !state.pending;
    $('castBtn').disabled = state.selectedCell == null || state.solved || !!(state.seal && !state.seal.done);
    $('castBtn').hidden = state.solved;
    $('toExplore').hidden = state.solved; // 破關後不能回探索：那會把法陣和現身的鬼清掉，而且探索畫面沒有「下一組配置」
    $('nextBtn').hidden = !state.solved;
    $('replayBtn').hidden = !state.solved;
    $('zoomIn').disabled = state.zoomIdx >= ZOOM_STEPS.length - 1;
    $('zoomOut').disabled = state.zoomIdx <= 0;
    $('debugBtn').classList.toggle('on', state.debug);
    $('debugBtn').setAttribute('aria-pressed', String(state.debug));
    var dp = $('debugPanel');
    dp.hidden = !state.debug;
    dp.textContent = state.debug ? debugText() : ''; // 關閉時 DOM 內不留任何答案文字
  }

  function debugText() {
    var c = cfg(), f2 = function (n) { return (Math.round(n * 100) / 100).toString(); };
    var r = Optics.reverseConstruct(c.f, c.image);
    return 'DEBUG 配置 ' + c.id + '（僅供開發驗證）\n' +
      '焦距 f = ' + c.f + ' cm   F = (' + c.focal.objectSide.x + ', 0)\n' +
      '物點 = (' + f2(c.object.x) + ', ' + f2(c.object.y) + ')  do = ' + c.dObj + '\n' +
      '虛像 = (' + f2(c.image.x) + ', ' + f2(c.image.y) + ')  m = ' + f2(c.m) + '\n' +
      'P = (0, ' + f2(r.P.y) + ')\n' +
      '理論交點 = (' + f2(r.object.x) + ', ' + f2(r.object.y) + ')\n' +
      '目標格 = ' + c.targetCell + '   鬼方位 = ' + WORLD.directions[c.direction] + '\n' +
      '封印次數 = ' + state.attempts + '   線 = ' + state.lines.length;
  }

  function resetRound(idx) {
    state.cfgIndex = idx;
    state.phase = 'explore'; state.facing = 0; state.lensUp = false; state.marker = null;
    state.mode = 'draw'; state.tool = 'line'; state.dashed = false; state.pending = null; state.lines = [];
    state.selectedCell = null; state.seal = null; state.solved = false; state.attempts = 0; state.replay = null;
    state.zoomIdx = 0;
    $('configSel').value = String(idx);
    setStatus('荒野裡有異象。轉向四周，舉起凹透鏡找出鬼的像，然後點它做標記。');
    layout();
  }

  function enterAnalysis() {
    if (!state.marker) return;
    state.phase = 'analysis'; state.lensUp = false; state.pending = null;
    syncUI(); layout();
    setStatus(state.solved ? '已封印。' : '側視圖：從「虛像標記」出發，用主光線反推鬼本體在哪一格。先選起點，再選終點。');
    if (!state.seenAnalysisIntro) {
      state.seenAnalysisIntro = true;
      showBanner('視角轉了 90°：現在是從側面看同一個空間。右邊是你和透鏡，左邊是你剛才面向的遠方；粉紅標記就是你剛才標的虛像。', 5200);
    }
  }

  function layout() {
    var r = $('stage').getBoundingClientRect();
    W = Math.max(50, Math.round(r.width)); H = Math.max(50, Math.round(r.height));
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    if (state.phase === 'analysis') {
      // 保持目前的視圖中心
      var center = state.view.s ? s2w({ x: W / 2, y: H / 2 }) : { x: 0, y: 0 };
      var first = !state.view.inited;
      state.view.s = fitScale() * ZOOM_STEPS[state.zoomIdx];
      if (first || state.zoomIdx === 0) { state.view.tx = 0; state.view.ty = 0; state.view.inited = true; }
      else { state.view.tx = W / 2 - center.x * state.view.s; state.view.ty = H / 2 + center.y * state.view.s; }
      clampView();
    }
    syncUI(); render();
  }

  var renderQueued = false, animating = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }
  function animate() {
    if (animating) return;
    animating = true;
    (function tick() {
      render();
      if ((state.seal && performance.now() - state.seal.t0 < 2200) || replayRunning()) requestAnimationFrame(tick); else animating = false;
    })();
  }
  function render() {
    stats.frame++; stats.debugDrawn = false; stats.ghostInLens = false; stats.ghostRevealed = false;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (state.phase === 'explore') renderExplore(); else renderAnalysis();
  }

  // ---- 控制項 ----
  Cfg.all.forEach(function (c, i) {
    var o = document.createElement('option'); o.value = String(i); o.textContent = '配置 ' + c.id; $('configSel').appendChild(o);
  });
  $('configSel').addEventListener('change', function () { resetRound(Number(this.value)); });
  $('debugBtn').addEventListener('click', function () { state.debug = !state.debug; syncUI(); requestRender(); });
  $('turnLeft').addEventListener('click', function () { state.facing = (state.facing + 3) % 4; syncUI(); requestRender(); });
  $('turnRight').addEventListener('click', function () { state.facing = (state.facing + 1) % 4; syncUI(); requestRender(); });
  $('lensBtn').addEventListener('click', function () {
    state.lensUp = !state.lensUp;
    setStatus(state.lensUp
      ? '透鏡裡整個視野都被縮小了。看到發光的鬼像就點它標記；沒有就轉向再找。'
      : (state.marker ? '放下透鏡後鬼像消失了，但虛像標記還在。可以切到側視分析。' : '裸眼看不到鬼。舉起凹透鏡再找。'));
    syncUI(); requestRender();
  });
  $('toAnalysis').addEventListener('click', enterAnalysis);
  $('toExplore').addEventListener('click', function () {
    state.phase = 'explore'; state.pending = null;
    setStatus('回到探索視角。虛像標記仍保留。');
    syncUI(); layout();
  });
  $('modeDraw').addEventListener('click', function () { state.mode = 'draw'; setStatus('畫線模式：點標示點來畫線。此模式下不會選到地板格。'); syncUI(); requestRender(); });
  $('modeSeal').addEventListener('click', function () { state.mode = 'seal'; state.pending = null; setStatus('封印模式：點一個地板格（整個直欄都可點），再按「施放封印法陣」。'); syncUI(); requestRender(); });
  $('toolLine').addEventListener('click', function () { state.tool = 'line'; setStatus('兩點連線：依序點兩個標示點，會畫出通過它們並延長的直線。'); syncUI(); });
  $('toolParallel').addEventListener('click', function () { state.tool = 'parallel'; state.pending = null; setStatus('平行主軸：點一個標示點，畫出通過它、平行主光軸的線。'); syncUI(); requestRender(); });
  $('styleBtn').addEventListener('click', function () { state.dashed = !state.dashed; setStatus(state.dashed ? '接下來畫的線是虛線（延長線／作圖線）。' : '接下來畫的線是實線（實際光線）。'); syncUI(); });
  $('undoBtn').addEventListener('click', function () { if (state.pending) state.pending = null; else state.lines.pop(); syncUI(); requestRender(); });
  $('clearBtn').addEventListener('click', function () { state.lines = []; state.pending = null; setStatus('已清除所有線。'); syncUI(); requestRender(); });
  $('castBtn').addEventListener('click', castSeal);
  $('nextBtn').addEventListener('click', function () { resetRound((state.cfgIndex + 1) % Cfg.all.length); });
  $('replayBtn').addEventListener('click', function () { if (state.solved) startReplay(); });
  $('zoomIn').addEventListener('click', function () { setZoom(state.zoomIdx + 1); });
  $('zoomOut').addEventListener('click', function () { setZoom(state.zoomIdx - 1); });
  $('zoomFit').addEventListener('click', function () { setZoom(0); });

  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe($('stage'));

  // 測試／開發用掛鉤（tests/e2e-concave-lens.js 使用；不是學生 UI）
  // 背景圖載入（或失敗）之後才掛上，測試才不會在換圖前後各取一次畫面。
  function exposeHooks() {
    window.__proto = {
      state: state, stats: stats, cfg: cfg, configs: Cfg, GHOST_COLOR: GHOST_COLOR, SNAP_PX: SNAP_PX,
      w2s: w2s, s2w: s2w, snapPoints: snapPoints, imageScreenPos: imageScreenPos,
      studentIntersections: studentIntersections, exploreMetrics: exploreMetrics,
      canvasSize: function () { return { W: W, H: H, DPR: DPR }; }, render: render, replaySpec: replaySpec,
      background: function () { return { ready: bg.ready, src: bgOff ? null : BG_DIRS.map(function (d) { return d.src; }) }; }
    };
  }

  resetRound(0);
  if (bg.settled) exposeHooks();
  else bgWaiters.push(function () { render(); exposeHooks(); });
})();

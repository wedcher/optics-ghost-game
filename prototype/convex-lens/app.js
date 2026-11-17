/*
 * 凸透鏡 vertical prototype（Sprint 02）
 *
 * 流程：移動凸透鏡 → 布幕上出現清楚的倒立實像 → 標記 → 側視光路分析（兩條可逆主光線）
 *       → 選地板格 → 封印。
 *
 * 畫面：固定走廊（側視）＋布幕正面視圖；鬼、像、光線、法陣都是動態圖層。
 * 幾何全部來自 ../shared/optics-core.js 與 configs.js，這裡只負責畫面與互動。
 *
 * 側視分析的畫線／吸附／縮放／選格邏輯與 ../concave-lens/app.js 相同（目前是複製，
 * 之後三套玩法整合成共用 shell 時再抽出）。
 *
 * 座標：走廊座標，布幕在 X = 0，走廊在左側（X < 0），主光軸 y = 0，y 向上為正。
 */
(function () {
  'use strict';
  var Optics = window.OpticsCore;
  var Cfg = window.ConvexLensConfigs;
  var WORLD = Cfg.WORLD;
  var floor = Cfg.floor;

  var GHOST_COLOR = '#9dffd8';
  var MARK_COLOR = '#ff5fd2';
  var SNAP_PX = 30;
  var TAP_SLOP_PX = 10;
  var NUDGE_CM = 5;
  var ZOOM_STEPS = [1, 1.5, 2.25, 3.4, 5];
  var BOUNDS = { minX: -(WORLD.corridorLength + 40), maxX: 70, minY: -(WORLD.axisHeight + 48), maxY: WORLD.axisHeight + 25 };
  var BLUR_SAMPLES = 36;

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('view');
  var ctx = canvas.getContext('2d');

  // 第二關：3 條命內抓到 5 隻鬼（docs/story-and-flow.md）。
  // 網址加 ?free=1 是自由練習／開發模式：沒有過場、不計命，並顯示配置選單與 Debug。
  var FREE = /[?&]free=1/.test(location.search);
  var LEVEL_LIVES = 3, LEVEL_GOAL = 5;
  var INTRO_BG = 'assets/intro-corridor.webp', MENU_URL = '../index.html';
  var level = { on: !FREE, screen: FREE ? 'play' : 'intro', lives: LEVEL_LIVES, sealed: 0, goal: LEVEL_GOAL, scene: null };

  var state = {
    cfgIndex: 0,
    phase: 'observe',     // 'observe' | 'analysis'
    lensX: -350,
    look: 'screen',       // 觀察時看哪裡：'screen' 布幕（找實像）｜'lens' 從布幕這邊隔著凸透鏡看（找虛像）
    marker: null,         // { lensX, x, y, virtual }：標記時透鏡的位置與像點（實像 x = 0 在布幕上；虛像在透鏡左邊）
    mode: 'draw', pending: null, lines: [], drag: null,
    selectedCell: null, seal: null, solved: false, attempts: 0,
    debug: FREE && /[?&]debug=1/.test(location.search),
    zoomIdx: 0,
    view: { s: 1, tx: 0, ty: 0 },
    seenAnalysisIntro: false
  };
  var stats = { frame: 0, ghostRevealed: false, debugDrawn: false, blur: null };
  var W = 300, H = 300, DPR = 1;
  var FS = 1; // 畫布文字的放大倍率：畫布短邊小（手機）時放大，見 resize

  function cfg() { return Cfg.all[state.cfgIndex]; }

  // 美術圖層（docs/concepts/ 的概念圖，壓縮後放在 assets/）。載入失敗時退回程式畫的 placeholder。
  // 走廊背景：側視的石牆長廊。floorAt／ceilAt 是圖中「牆腳線」與「橫樑下緣」占圖高的比例，
  // 用來把圖對齊到走廊座標（地板 y = -axisHeight、天花板 y = +axisHeight）。
  var ART = {
    corridor: { src: 'assets/corridor.jpg', img: null, ready: false, floorAt: 0.795, ceilAt: 0.09, leftX: -1100 },
    lens: { src: 'assets/lens.png', img: null, ready: false }
  };
  var artOff = /[?&]art=0/.test(location.search);
  var artPending = 0;
  Object.keys(ART).forEach(function (k) {
    if (artOff) return;
    var a = ART[k];
    artPending++;
    a.img = new Image();
    a.img.onload = function () { a.ready = true; artPending--; requestRender(); };
    a.img.onerror = function () { artPending--; };
    a.img.src = a.src;
  });
  function clampLens(x) { return Math.max(WORLD.lensMinX, Math.min(WORLD.lensMaxX, x)); }
  function wallNow() { var c = cfg(); return Cfg.wallImage(c.f, c.object.x, c.h, state.lensX, WORLD.lensRadius); }
  function lensViewNow() { var c = cfg(); return Cfg.lensView(c.f, c.object.x, c.h, state.lensX); }
  function nearestSharp() {
    var best = null;
    cfg().sharp.forEach(function (sp) { if (!best || Math.abs(sp.lensX - state.lensX) < Math.abs(best.lensX - state.lensX)) best = sp; });
    return best;
  }

  // ====================================================================
  // 版面：觀察階段把畫布分成「布幕正面」與「走廊側視」兩塊
  // ====================================================================

  function regions() {
    if (W > H * 1.25) {
      // 布幕是直的窄長條（寬:高 = wallHalfWidth:axisHeight），只留它需要的寬度，其餘給走廊側視
      var ww = Math.round(Math.min(W * 0.36, (H - 38) * WORLD.wallHalfWidth / WORLD.axisHeight + 34));
      return { wall: { x: W - ww, y: 0, w: ww, h: H }, side: { x: 0, y: 0, w: W - ww, h: H } };
    }
    var wh = Math.round(H * 0.58);
    return { wall: { x: 0, y: 0, w: W, h: wh }, side: { x: 0, y: wh, w: W, h: H - wh } };
  }

  function fitInto(r) {
    var s = Math.min(r.w / (BOUNDS.maxX - BOUNDS.minX), r.h / (BOUNDS.maxY - BOUNDS.minY));
    return {
      s: s,
      tx: r.x + (r.w - (BOUNDS.maxX - BOUNDS.minX) * s) / 2 - BOUNDS.minX * s,
      ty: r.y + (r.h - (BOUNDS.maxY - BOUNDS.minY) * s) / 2 + BOUNDS.maxY * s
    };
  }
  function sideView() { return state.phase === 'analysis' ? state.view : fitInto(regions().side); }
  function w2s(p) { var v = sideView(); return { x: p.x * v.s + v.tx, y: -p.y * v.s + v.ty }; }
  function s2w(p) { var v = sideView(); return { x: (p.x - v.tx) / v.s, y: -(p.y - v.ty) / v.s }; }

  function fitScale() { return Math.min(W / (BOUNDS.maxX - BOUNDS.minX), H / (BOUNDS.maxY - BOUNDS.minY)); }
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

  // ====================================================================
  // 繪圖小工具
  // ====================================================================

  function label(text, x, y, color, align) {
    ctx.save(); ctx.font = '600 ' + Math.round(13 * FS) + 'px system-ui, sans-serif'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,24,.9)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
  }

  function drawMarker(x, y) {
    ctx.save();
    ctx.strokeStyle = MARK_COLOR; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 19, y); ctx.lineTo(x - 7, y); ctx.moveTo(x + 7, y); ctx.lineTo(x + 19, y);
    ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 7); ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 19); ctx.stroke();
    ctx.fillStyle = MARK_COLOR; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    ctx.restore();
  }

  /**
   * 鬼的輪廓路徑（含眼、口的鏤空，配合 evenodd 填色）。
   * sx、sy = ±1：-1 表示該方向翻轉。右側有一隻小手，所以左右顛倒也看得出來。
   */
  function ghostPath(c, px, py, hw, hh, sx, sy) {
    var i;
    c.beginPath();
    for (i = 0; i <= 16; i++) {
      var a = Math.PI - (Math.PI * i) / 16;
      var x = px + sx * Math.cos(a) * hw, y = py + sy * (-(hh - hw) - Math.sin(a) * hw);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    for (i = 0; i <= 12; i++) {
      var u = 1 - i / 6;
      c.lineTo(px + sx * u * hw, py + sy * (hh - Math.abs(Math.sin((i / 12) * Math.PI * 3)) * hh * 0.22));
    }
    c.closePath();
    var e = function (ox, oy, rx, ry) { c.moveTo(px + sx * ox + rx, py + sy * oy); c.ellipse(px + sx * ox, py + sy * oy, rx, ry, 0, 0, Math.PI * 2); };
    e(-hw * 0.36, -hh * 0.3, hw * 0.16, hh * 0.16);
    e(hw * 0.36, -hh * 0.3, hw * 0.16, hh * 0.16);
    e(0, hh * 0.08, hw * 0.2, hh * 0.1);
    e(hw * 1.22, -hh * 0.05, hw * 0.24, hw * 0.24); // 小手（在鬼自己的右側）
  }

  function drawGhostSolid(c, px, py, hw, hh) {
    c.save();
    c.shadowColor = 'rgba(120,255,200,.9)'; c.shadowBlur = Math.max(4, hw * 0.6);
    c.fillStyle = GHOST_COLOR;
    ghostPath(c, px, py, hw, hh, 1, 1);
    c.fill('evenodd');
    c.restore();
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

  function strokeInfinite(line, color, width, dash) {
    var len = Math.hypot(line.d.x, line.d.y), ux = line.d.x / len, uy = line.d.y / len, R = 6000;
    var a = w2s({ x: line.p.x - ux * R, y: line.p.y - uy * R }), b = w2s({ x: line.p.x + ux * R, y: line.p.y + uy * R });
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  }

  // ====================================================================
  // 布幕正面視圖：牆上的光由幾何決定（位置、大小、倒立、模糊圓）
  // ====================================================================

  function renderWall(r) {
    var c = cfg(), pad = 10;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.fillStyle = '#0a0b16'; ctx.fillRect(r.x, r.y, r.w, r.h);
    var k = Math.min((r.w - 2 * pad) / (2 * WORLD.wallHalfWidth), (r.h - 2 * pad - 18) / (2 * WORLD.axisHeight));
    var cx = r.x + r.w / 2, cy = r.y + 18 + (r.h - 18) / 2;
    var wx = cx - WORLD.wallHalfWidth * k, wy = cy - WORLD.axisHeight * k, ww = 2 * WORLD.wallHalfWidth * k, wh = 2 * WORLD.axisHeight * k;
    // 布幕（placeholder：暗走廊裡的米白布，本身偏暗，亮的是投影上去的光）
    ctx.fillStyle = '#4a3823'; ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    var g = ctx.createRadialGradient(cx, cy, ww * 0.1, cx, cy, ww * 0.85);
    g.addColorStop(0, '#5b574c'); g.addColorStop(1, '#37342d');
    ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 1;
    for (var by = 1; by < 5; by++) { ctx.beginPath(); ctx.moveTo(wx + (ww * by) / 5, wy); ctx.quadraticCurveTo(wx + (ww * by) / 5 + 3, cy, wx + (ww * by) / 5, wy + wh); ctx.stroke(); }
    // 主光軸打在牆上的位置
    ctx.strokeStyle = 'rgba(160,175,240,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8); ctx.stroke();

    // 投影上去的光
    var wimg = wallNow();
    stats.blur = wimg ? wimg.blur : null;
    if (wimg && !state.solved) {
      ctx.save();
      ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = GHOST_COLOR;
      var hw = WORLD.ghostHalfWidth * wimg.scale * k, hh = WORLD.ghostHalfHeight * wimg.scale * k;
      var px = cx, py = cy - wimg.centerY * k, b = wimg.blur * k;
      if (isFinite(b) && wimg.blur < 600) {
        var n = b < 0.4 ? 1 : BLUR_SAMPLES;
        // 模糊圓愈大，同樣的光攤在愈大的面積上
        ctx.globalAlpha = n === 1 ? 1 : 1 / n;
        for (var i = 0; i < n; i++) {
          var rr = n === 1 ? 0 : b * Math.sqrt((i + 0.5) / n), th = i * 2.399963;
          ghostPath(ctx, px + rr * Math.cos(th), py + rr * Math.sin(th), hw, hh, -1, -1); // 倒立且左右相反
          ctx.fill('evenodd');
        }
      }
      ctx.restore();
    }
    ctx.strokeStyle = '#7a6040'; ctx.lineWidth = 2; ctx.strokeRect(wx, wy, ww, wh);
    var realMark = state.marker && !state.marker.virtual;
    if (realMark) drawMarker(cx, cy - state.marker.y * k);
    label('布幕（正面看）', r.x + 8, r.y + 12, '#aab3e6', 'left');
    if (realMark) label('實像標記', cx + 22, cy - state.marker.y * k - 18, MARK_COLOR, 'left');
    ctx.restore();
  }

  // ====================================================================
  // 「看凸透鏡」：眼睛站在布幕這邊（X = 0），隔著透鏡往鬼的方向看。
  // 佔原本布幕那一格；鏡框最大和布幕一樣寬。畫的是鬼的「像」（不是鬼本體），
  // 位置與大小按從眼睛看的視角（y ÷ 到眼睛的距離）計算。
  // ====================================================================

  var VIRTUAL_COLOR = '#b7a6ff', REAL_IMG_COLOR = '#ff9ad5';
  function renderLensView(r) {
    var c = cfg(), pad = 10;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.fillStyle = '#0a0b16'; ctx.fillRect(r.x, r.y, r.w, r.h);
    var k = Math.min((r.w - 2 * pad) / (2 * WORLD.wallHalfWidth), (r.h - 2 * pad - 18) / (2 * WORLD.axisHeight));
    var foot = Math.round(34 * FS);                              // 底部一列：直接看鬼的大小（對照）
    var cx = r.x + r.w / 2, cy = r.y + 22 + (r.h - 22 - foot) / 2;
    var maxR = Math.min(WORLD.wallHalfWidth * k, (r.h - 22 - foot) / 2 - 6); // 鏡框半徑上限 = 布幕半寬（不比布幕大）
    var eye = WORLD.eyeX, D = eye - c.object.x, dLens = eye - state.lensX;
    var angR = WORLD.lensRadius / dLens, naked = WORLD.ghostHalfHeight / D;
    var K = Math.min(maxR * 0.3 / naked, maxR / angR);          // 視角（正切）→ 畫面 px；直接看鬼時鬼的半高 = 鏡框上限的 30%
    var rad = angR * K;
    var lv = lensViewNow();
    // 鏡片（正面看是圓形；木框＋玻璃）
    ctx.fillStyle = '#5a4630'; ctx.beginPath(); ctx.arc(cx, cy, rad + 5, 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.clip();
    var gg = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.35, rad * 0.05, cx, cy, rad);
    gg.addColorStop(0, '#26304f'); gg.addColorStop(1, '#141a30');
    ctx.fillStyle = gg; ctx.fillRect(cx - rad, cy - rad, 2 * rad, 2 * rad);
    if (!state.solved && (lv.eye === 'virtual' || lv.eye === 'realInFront')) {
      var d = eye - lv.x, am = Math.abs(lv.m), virt = lv.eye === 'virtual';
      ctx.save(); ctx.globalAlpha = 0.78; ctx.fillStyle = virt ? VIRTUAL_COLOR : REAL_IMG_COLOR;
      ghostPath(ctx, cx, cy - (lv.y / d) * K, WORLD.ghostHalfWidth * am / d * K, WORLD.ghostHalfHeight * am / d * K, virt ? 1 : -1, virt ? 1 : -1);
      ctx.fill('evenodd'); ctx.restore();
    } else if (!state.solved && lv.eye === 'blur') {
      var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, 'rgba(157,255,216,.30)'); gr.addColorStop(1, 'rgba(157,255,216,.04)');
      ctx.fillStyle = gr; ctx.fillRect(cx - rad, cy - rad, 2 * rad, 2 * rad);
    }
    // 玻璃反光
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = Math.max(2, rad * 0.06);
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.78, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke();
    if (state.marker && state.marker.virtual) {
      var my = cy - (state.marker.y / (eye - state.marker.x)) * K;
      drawMarker(cx, my);
    }
    // 對照：不用透鏡、直接看鬼時看起來的大小（灰色虛線，底部一列）
    var rw = WORLD.ghostHalfWidth / D * K, rh = naked * K, fy = r.y + r.h - foot / 2;
    ctx.save(); ctx.strokeStyle = 'rgba(200,205,230,.85)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ghostPath(ctx, r.x + 10 + rw, fy, rw, rh, 1, 1); ctx.stroke(); ctx.restore();
    label('← 直接看', r.x + 10 + rw * 2.6, fy, '#aab3e6', 'left');
    label('隔著凸透鏡看', r.x + 8, r.y + 12, '#aab3e6', 'left');
    ctx.restore();
  }

  // ====================================================================
  // 走廊側視（觀察與分析共用）
  // ====================================================================

  function geomLine(l) { return l.kind === 'parallel' ? Optics.horizontalLine(l.a) : l.kind === 'vertical' ? { p: { x: l.a.x, y: l.a.y }, d: { x: 0, y: 1 } } : Optics.lineThrough(l.a, l.b); }

  /** 可吸附點：O、F、F′、實像標記，以及學生畫的線與透鏡平面的交點 P。 */
  function snapPoints() {
    var c = cfg(), lx = state.lensX;
    var pts = [
      { id: 'O', label: 'O', x: lx, y: 0 },
      { id: 'F', label: 'F', x: lx - c.f, y: 0 },
      { id: 'F2', label: 'F′', x: lx + c.f, y: 0 }
    ].filter(function (p) { return p.x <= 0; }); // 虛像題的 F′ 可能落在布幕後面：那裡畫不到，不給吸附
    if (state.marker) pts.push({ id: 'I', label: state.marker.virtual ? '虛像' : '實像', x: state.marker.x, y: state.marker.y });
    state.lines.forEach(function (l) {
      var p = Optics.intersectVertical(geomLine(l), lx);
      if (!p || Math.abs(p.y) > 400) return;
      for (var i = 0; i < pts.length; i++) if (Optics.dist(pts[i], p) < 0.5) return;
      pts.push({ id: 'P', label: 'P', x: lx, y: p.y });
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
  function studentIntersections() {
    var out = [], i, j;
    for (i = 0; i < state.lines.length; i++) for (j = i + 1; j < state.lines.length; j++) {
      var p = Optics.intersect(geomLine(state.lines[i]), geomLine(state.lines[j]));
      if (p && p.x > BOUNDS.minX - 200 && p.x < BOUNDS.maxX + 200 && Math.abs(p.y) < 500) out.push(p);
    }
    return out;
  }

  function renderSide(clipRect) {
    var c = cfg(), v = sideView(), s = v.s, analysis = state.phase === 'analysis', i, p, q;
    var G = -WORLD.axisHeight, TOP = WORLD.axisHeight, LEFT = -WORLD.corridorLength;
    ctx.save();
    ctx.beginPath(); ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h); ctx.clip();
    ctx.fillStyle = '#07080f'; ctx.fillRect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);

    // 走廊內部
    var a = w2s({ x: LEFT, y: TOP }), b = w2s({ x: 0, y: G });
    var useArt = ART.corridor.ready;
    if (useArt) {
      // 固定背景圖：牆腳線對齊地板、橫樑下緣對齊天花板
      var A = ART.corridor, ih = A.img.naturalHeight, iw = A.img.naturalWidth;
      var cmPerPx = (2 * WORLD.axisHeight) / ((A.floorAt - A.ceilAt) * ih);
      var topY = TOP + A.ceilAt * ih * cmPerPx;
      var i0 = w2s({ x: A.leftX, y: topY });
      ctx.drawImage(A.img, i0.x, i0.y, iw * cmPerPx * s, ih * cmPerPx * s);
      // 分析時把背景壓暗，讓光線與標示點清楚
      ctx.fillStyle = analysis ? 'rgba(6,8,18,.62)' : 'rgba(6,8,18,.18)';
      ctx.fillRect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
    } else {
      var gr = ctx.createLinearGradient(0, a.y, 0, b.y);
      gr.addColorStop(0, '#15131f'); gr.addColorStop(1, '#1d1a26');
      ctx.fillStyle = gr; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    // 壁燈（固定位置，與鬼無關）——只有沒有背景圖時才畫
    (useArt ? [] : [-880, -560, -240]).forEach(function (tx) {
      q = w2s({ x: tx, y: TOP - 34 });
      var rg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 120 * s);
      rg.addColorStop(0, 'rgba(255,170,80,.30)'); rg.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = rg; ctx.fillRect(q.x - 120 * s, q.y - 120 * s, 240 * s, 240 * s);
      ctx.fillStyle = '#ffc070'; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, 4 * s), 0, 7); ctx.fill();
    });

    if (analysis) {
      ctx.lineWidth = 1;
      for (var gx = LEFT; gx <= 0; gx += 50) {
        p = w2s({ x: gx, y: 0 });
        ctx.strokeStyle = gx % 100 === 0 ? 'rgba(120,135,210,.20)' : 'rgba(120,135,210,.08)';
        ctx.beginPath(); ctx.moveTo(p.x, a.y); ctx.lineTo(p.x, b.y); ctx.stroke();
      }
      for (var gy = -100; gy <= 100; gy += 50) {
        p = w2s({ x: 0, y: gy });
        ctx.strokeStyle = gy % 100 === 0 ? 'rgba(120,135,210,.20)' : 'rgba(120,135,210,.08)';
        ctx.beginPath(); ctx.moveTo(a.x, p.y); ctx.lineTo(b.x, p.y); ctx.stroke();
      }
    }

    // 天花板、地板、左端牆
    var tileH = 34 * s;
    if (!useArt) {
      ctx.fillStyle = '#2a2633';
      ctx.fillRect(a.x - 14 * s, a.y - 14 * s, b.x - a.x + 28 * s, 14 * s);
      ctx.fillRect(a.x - 14 * s, a.y, 14 * s, b.y - a.y);
      ctx.fillRect(a.x - 14 * s, b.y, b.x - a.x + 28 * s, tileH + 10 * s);
    }
    // 地板格只在分析階段出現
    if (analysis) {
      for (i = 1; i <= floor.count; i++) {
        var x0 = w2s({ x: -i * floor.width, y: G }).x, x1 = w2s({ x: -(i - 1) * floor.width, y: G }).x;
        ctx.fillStyle = useArt ? (i % 2 ? 'rgba(43,53,80,.82)' : 'rgba(35,43,66,.82)') : (i % 2 ? '#2b3550' : '#232b42');
        ctx.fillRect(x0, b.y, x1 - x0, tileH);
        if (state.selectedCell === i) {
          ctx.fillStyle = 'rgba(255,209,102,.16)'; ctx.fillRect(x0, a.y, x1 - x0, b.y - a.y);
          ctx.fillStyle = 'rgba(255,209,102,.75)'; ctx.fillRect(x0, b.y, x1 - x0, tileH);
        }
        ctx.strokeStyle = '#8b98d8'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, b.y, x1 - x0, tileH);
        if (x1 - x0 >= 18) {
          ctx.font = Math.round((x1 - x0 >= 30 ? 12 : 10) * FS) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = state.selectedCell === i ? '#201500' : '#aab3e6';
          ctx.fillText(String(i), (x0 + x1) / 2, b.y + tileH / 2);
        }
      }
    }
    if (!useArt || analysis) { ctx.strokeStyle = '#6f6a80'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, b.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

    // 投影布幕（側面看是一條薄薄的布，掛在木架上）
    var sw = Math.max(3, 8 * s);
    ctx.fillStyle = '#5a4630'; ctx.fillRect(b.x - sw * 0.5, a.y - 6 * s, sw * 2, 6 * s);
    ctx.fillRect(b.x - sw * 0.5, b.y, sw * 2, 5 * s);
    ctx.fillStyle = '#e6dfcc'; ctx.fillRect(b.x, a.y, sw, b.y - a.y);
    label('布幕', b.x + sw / 2, a.y - 6 * s - 10, '#e6dfcc', 'center');

    // 主光軸
    p = w2s({ x: 0, y: 0 });
    ctx.save(); ctx.strokeStyle = analysis ? '#7f8bc9' : 'rgba(127,139,201,.45)'; ctx.lineWidth = 1.5; ctx.setLineDash([14, 4, 3, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, p.y); ctx.lineTo(b.x, p.y); ctx.stroke(); ctx.restore();
    if (analysis) label('主光軸', Math.max(clipRect.x + 34, a.x + 40 * s), p.y - 11, '#7f8bc9');

    // 透鏡之後的光束（只畫像側；物側不畫，以免洩漏鬼的位置）
    var wimg = wallNow(), L = w2s({ x: state.lensX, y: 0 });
    if (!analysis && wimg && wimg.dImg != null && !state.solved) {
      var R = WORLD.lensRadius, yi = (-c.h * wimg.dImg) / wimg.dObj;      // 像點高度（成像處）
      var slopeTop = (yi - R) / wimg.dImg, slopeBot = (yi + R) / wimg.dImg; // 透鏡上下緣射向像點
      var t1 = w2s({ x: state.lensX, y: R }), t2 = w2s({ x: state.lensX, y: -R });
      var e1 = w2s({ x: 0, y: R + slopeTop * wimg.s }), e2 = w2s({ x: 0, y: -R + slopeBot * wimg.s });
      ctx.fillStyle = 'rgba(157,255,216,.13)';
      if (wimg.dImg > 0 && wimg.dImg < wimg.s) {
        var fp = w2s({ x: state.lensX + wimg.dImg, y: yi });
        ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(fp.x, fp.y); ctx.lineTo(t2.x, t2.y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.lineTo(t2.x, t2.y); ctx.closePath(); ctx.fill();
      }
    }

    // 凸透鏡
    if (analysis) {
      var lt = w2s({ x: state.lensX, y: WORLD.lensRadius }), lb = w2s({ x: state.lensX, y: -WORLD.lensRadius });
      if (ART.lens.ready) {
        var ah = 2 * WORLD.lensRadius * s, aw = (ah * ART.lens.img.naturalWidth) / ART.lens.img.naturalHeight;
        ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(ART.lens.img, lt.x - aw / 2, lt.y, aw, ah); ctx.restore();
      }
      ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(lt.x, lt.y); ctx.lineTo(lb.x, lb.y);
      ctx.moveTo(lt.x - 8, lt.y + 9); ctx.lineTo(lt.x, lt.y); ctx.lineTo(lt.x + 8, lt.y + 9);
      ctx.moveTo(lb.x - 8, lb.y - 9); ctx.lineTo(lb.x, lb.y); ctx.lineTo(lb.x + 8, lb.y - 9); ctx.stroke();
      label('凸透鏡', lt.x, lt.y - 4 < a.y + 12 ? a.y + 12 : lt.y - 14, '#9fd8ff');
    } else {
      // 支架與鏡片
      var base = w2s({ x: state.lensX, y: G });
      ctx.strokeStyle = '#8a7a66'; ctx.lineWidth = Math.max(2, 5 * s);
      ctx.beginPath(); ctx.moveTo(L.x, L.y + WORLD.lensRadius * s); ctx.lineTo(base.x, base.y); ctx.stroke();
      ctx.lineWidth = Math.max(2, 4 * s);
      ctx.beginPath(); ctx.moveTo(base.x - 26 * s, base.y); ctx.lineTo(base.x + 26 * s, base.y); ctx.stroke();
      if (ART.lens.ready) {
        var lh = 2 * WORLD.lensRadius * s, lw = (lh * ART.lens.img.naturalWidth) / ART.lens.img.naturalHeight;
        ctx.save(); ctx.globalAlpha = 0.92; ctx.drawImage(ART.lens.img, L.x - lw / 2, L.y - lh / 2, lw, lh); ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(159,216,255,.30)'; ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(L.x, L.y, Math.max(3, 9 * s), WORLD.lensRadius * s, 0, 0, 7); ctx.fill(); ctx.stroke();
      }
      // 拖曳提示
      ctx.fillStyle = '#9fd8ff'; ctx.font = '600 ' + Math.round(13 * FS) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('◀ 凸透鏡 ▶', L.x, b.y + tileH + 10 * s + 12);
    }

    if (analysis) {
      state.lines.forEach(function (l) {
        strokeInfinite(geomLine(l), state.replay ? 'rgba(255,255,255,.22)' : (l.kind === 'line' ? '#ffd166' : '#7dffb2'), 2, null);
      });
      if (state.drag) {
        // 拖曳中的預覽：沒吸附 = 跟手的虛線（放開會消失）；吸附 = 實線，和放開後留下的線同一條
        var dg = state.drag, qa = w2s(dg.a);
        if (dg.snap) {
          strokeInfinite(geomLine(dragAsLine(dg)), dg.snap === 'point' ? '#ffd166' : '#7dffb2', 3, null);
          if (dg.b) { q = w2s(dg.b); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, 18, 0, 7); ctx.stroke(); }
        } else {
          ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.moveTo(qa.x, qa.y); ctx.lineTo(dg.cur.x, dg.cur.y); ctx.stroke(); ctx.restore();
        }
        ctx.strokeStyle = dg.snap ? (dg.snap === 'point' ? '#ffd166' : '#7dffb2') : 'rgba(255,255,255,.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(qa.x, qa.y, 18, 0, 7); ctx.stroke();
      }
      studentIntersections().forEach(function (pt) {
        q = w2s(pt); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.stroke();
      });
      snapPoints().forEach(function (sp) {
        q = w2s(sp);
        if (sp.id === 'I') { drawMarker(q.x, q.y); label(sp.label + '標記', q.x - 22, q.y + (sp.y >= 0 ? -24 : 24), MARK_COLOR, 'right'); return; }
        ctx.fillStyle = sp.id === 'P' ? '#7dffb2' : '#fff';
        ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill();
        if (state.mode === 'draw') { ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, 14, 0, 7); ctx.stroke(); }
        if (sp.id === 'P') label('P', q.x + 14, q.y - 12, '#7dffb2');
        else label(sp.label, q.x + (sp.id === 'O' ? -11 : 0), q.y + 16, '#fff');
      });
      if (state.pending) {
        q = w2s(state.pending); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(q.x, q.y, 18, 0, 7); ctx.stroke();
      }
    } else if (state.marker) {
      q = w2s({ x: state.marker.x, y: state.marker.y });
      drawMarker(q.x, q.y);
    }

    // 封印法陣
    stats.ghostRevealed = false;
    if (analysis && state.seal) {
      var t = (performance.now() - state.seal.t0) / 1000;
      var cc = w2s({ x: floor.centerX(state.seal.cell), y: G });
      var rx = Math.max(16, floor.width * s * 0.5);
      if (state.seal.success) {
        drawMagicCircle(cc.x, cc.y + tileH * 0.4, rx * Math.min(1, t / 0.5), 1, t * 1.5);
        if (t > 0.7) {
          var gp = w2s(c.object);
          ctx.save(); ctx.globalAlpha = Math.min(1, (t - 0.7) / 0.5);
          drawGhostSolid(ctx, gp.x, gp.y, Math.max(7, WORLD.ghostHalfWidth * s), Math.max(10, WORLD.ghostHalfHeight * s));
          ctx.restore();
          label('鬼本體', gp.x, gp.y - Math.max(10, WORLD.ghostHalfHeight * s) - 12, GHOST_COLOR);
          stats.ghostRevealed = true;
        }
      } else if (t < 1.5) {
        drawMagicCircle(cc.x, cc.y + tileH * 0.4, rx * Math.min(1, t / 0.5), t < 0.8 ? 1 : 1 - (t - 0.8) / 0.7, t * 1.5);
      }
    }

    // 破關後的光路重現（正推）：鬼本體 → 兩條光線 → 凸透鏡 → 會聚 → 實像
    if (analysis && state.replay && state.solved && state.marker) {
      var spec = replaySpec();
      var tau = Math.min(spec.duration, (performance.now() - state.replay.t0) / 1000);
      if (tau > spec.imageAt) {
        var vm = state.marker.virtual;
        var mag = (state.lensX - state.marker.x) / (state.lensX - c.object.x);
        var ihw = Math.max(4, WORLD.ghostHalfWidth * mag * s), ihh = Math.max(6, WORLD.ghostHalfHeight * mag * s);
        var ip = w2s({ x: state.marker.x, y: state.marker.y });
        ctx.save(); ctx.globalAlpha = 0.7 * Math.min(1, (tau - spec.imageAt) / 0.5);
        ctx.fillStyle = vm ? VIRTUAL_COLOR : GHOST_COLOR;
        // 實像：倒立，上下、左右都相反（和布幕正面視圖、課本一致），畫在布幕左邊。虛像：正立，畫在虛像的位置
        if (vm) ghostPath(ctx, ip.x, ip.y, ihw, ihh, 1, 1); else ghostPath(ctx, ip.x - ihw - 4, ip.y, ihw, ihh, -1, -1);
        ctx.fill('evenodd');
        ctx.restore();
      }
      window.RayReplay.draw(ctx, w2s, spec, tau, clipRect);
    }

    // Debug overlay
    if (state.debug) {
      stats.debugDrawn = true;
      q = w2s(c.object); ctx.strokeStyle = '#3dff7a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x - 8, q.y - 8); ctx.lineTo(q.x + 8, q.y + 8); ctx.moveTo(q.x + 8, q.y - 8); ctx.lineTo(q.x - 8, q.y + 8); ctx.stroke();
      c.sharp.forEach(function (sp) {
        var u = w2s({ x: sp.lensX, y: G });
        ctx.fillStyle = '#3dff7a'; ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(u.x - 6, u.y + 10); ctx.lineTo(u.x + 6, u.y + 10); ctx.closePath(); ctx.fill();
      });
      if (analysis && state.marker) {
        var r = Optics.reverseConstruct(c.f, { x: state.marker.x - state.lensX, y: state.marker.y });
        var shift = function (ln) { return { p: { x: ln.p.x + state.lensX, y: ln.p.y }, d: ln.d }; };
        [r.centerLine, r.focusLine, r.parallelLine].forEach(function (ln) { strokeInfinite(shift(ln), 'rgba(61,255,122,.8)', 1, [3, 5]); });
      }
    }
    ctx.restore();
  }

  // ====================================================================
  // 互動
  // ====================================================================

  function moveLens(x) {
    var nx = clampLens(x);
    if (nx === state.lensX) return;
    state.lensX = nx;
    if (state.marker) { state.marker = null; setStatus('透鏡動了，剛才的標記已取消。重新找到清楚的像再標記。'); syncUI(); }
  }

  function markImage() {
    if (state.solved) return;
    if (state.look === 'lens') { markVirtual(); return; }
    var sp = nearestSharp();
    var w = wallNow();
    if (!sp || !w || !(w.blurRatio <= WORLD.lockBlurRatio)) {
      setStatus(!w ? '布幕上看不到鬼的光。移動透鏡，或改「看凸透鏡」。'
        : w.blurRatio < 0.5 ? '快清楚了，但輪廓還有點糊。再微調一下透鏡。' : '牆上的光還是一團模糊。移動透鏡，或改「看凸透鏡」。');
      return;
    }
    state.lensX = sp.lensX; // 對準清晰位置（相當於自動對焦的最後一小步）
    state.marker = { lensX: sp.lensX, x: 0, y: sp.imageY, virtual: false };
    setStatus('已標記牆上的「實像」——它是倒立的' + (Math.abs(sp.m) > 1 ? '、放大的' : '、縮小的') + '。鬼本體在透鏡的另一邊。接著做光路分析。');
    syncUI(); requestRender();
  }

  // 「看凸透鏡」時的標記：只有看到正立、放大的虛像才能標記；標記打在虛像的位置（透鏡左邊）。不自動移動透鏡。
  function markVirtual() {
    var lv = lensViewNow();
    if (lv.eye === 'virtual' && lv.markable) {
      state.marker = { lensX: state.lensX, x: lv.x, y: lv.y, virtual: true };
      setStatus('你：「這是，正立、放大、虛像，鬼與像都在透鏡對面。」');
      syncUI(); requestRender();
      return;
    }
    setStatus(lv.eye === 'virtual' ? '透鏡裡的鬼放大得太厲害，看不清全貌。稍微移動透鏡再試。'
      : lv.eye === 'realInFront' ? '透鏡裡看到的是倒立的像——那不是虛像。要標記倒立的實像，請改「看布幕」。'
      : lv.eye === 'none' ? '透鏡裡看不到鬼的像。移動透鏡試試。'
      : '透鏡裡模糊一片，看不清楚。移動透鏡試試。');
  }

  function setLook(v) {
    if (state.look === v || state.solved) return;
    state.look = v;
    if (state.marker) state.marker = null;
    setStatus(v === 'lens' ? '你站在布幕這邊，隔著凸透鏡往走廊看。看到清楚的鬼像就按「標記」。' : '看布幕：布幕上出現清楚的鬼像就按「標記」。');
    syncUI(); requestRender();
  }

  // 光路重現的內容：全部由配置的幾何座標組成（走廊座標）。
  //   光線 1：由鬼平行主軸射到透鏡上的 P，折射後通過像側焦點 F′，到達布幕。
  //   光線 2：由鬼射向光心 O，直線通過，到達布幕。
  //   兩條光線在布幕上會聚成實像。
  function replaySpec() {
    if (state.marker && state.marker.virtual) return replaySpecVirtual();
    var c = cfg(), o = c.object, lx = state.lensX;
    var P = { x: lx, y: o.y }, O = { x: lx, y: 0 }, I = { x: 0, y: state.marker ? state.marker.y : 0 };
    // 第三條主光線：通過物側焦點 F，打在透鏡上的 Q，折射後平行主光軸（Q 的高度 = 像高）
    var Fo = { x: lx - c.f, y: 0 }, Q = { x: lx, y: o.y + ((Fo.y - o.y) / (Fo.x - o.x)) * (lx - o.x) };
    return {
      duration: 3.2, imageAt: 2.2,
      segments: [
        { a: o, b: P, start: 0, end: 1.0, kind: 'ray' },
        { a: o, b: O, start: 0, end: 1.0, kind: 'ray' },
        { a: P, b: I, start: 1.0, end: 2.2, kind: 'ray' },
        { a: O, b: I, start: 1.0, end: 2.2, kind: 'ray' },
        { a: o, b: Q, start: 0, end: 1.0, kind: 'ray' },
        { a: Q, b: { x: 0, y: Q.y }, start: 1.0, end: 2.2, kind: 'ray' }
      ],
      points: [{ p: I, start: 2.2 }],
      captions: [
        { start: 0, text: '鬼身上發出三條光線' },
        { start: 1.0, text: '經過凸透鏡：平行的折向焦點 F′，過光心的直走，過焦點 F 的變平行' },
        { start: 2.2, text: '實際光路 → 光線會聚 → 實像位置' }
      ]
    };
  }
  // 虛像：三條主光線折射後發散，一路走到布幕（布幕上不會聚成像）；
  // 從布幕這邊看，眼睛把它們反向延長（虛線），交在透鏡左邊的虛像。
  function replaySpecVirtual() {
    var c = cfg(), o = c.object, lx = state.lensX, I = { x: state.marker.x, y: state.marker.y };
    var P = { x: lx, y: o.y }, O = { x: lx, y: 0 };
    var Fo = { x: lx - c.f, y: 0 }, Q = { x: lx, y: o.y + ((Fo.y - o.y) / (Fo.x - o.x)) * (lx - o.x) }; // 從 F 的方向來（鬼在 F 與透鏡之間）
    // 沿方向 (dx, dy) 走到布幕；先碰到地板或天花板就停在那裡
    var atWall = function (a, dy, dx) {
      var y = a.y + (dy / dx) * (0 - a.x), lim = WORLD.axisHeight;
      if (Math.abs(y) <= lim) return { x: 0, y: y };
      var yl = y > 0 ? lim : -lim;
      return { x: a.x + (yl - a.y) * dx / dy, y: yl };
    };
    return {
      duration: 4.2, imageAt: 3.2,
      segments: [
        { a: o, b: P, start: 0, end: 1.0, kind: 'ray' },
        { a: o, b: O, start: 0, end: 1.0, kind: 'ray' },
        { a: P, b: atWall(P, -o.y, c.f), start: 1.0, end: 2.2, kind: 'ray' },            // 折向 F′ 的方向
        { a: O, b: atWall(O, O.y - o.y, O.x - o.x), start: 1.0, end: 2.2, kind: 'ray' },  // 過光心直走
        { a: o, b: Q, start: 0, end: 1.0, kind: 'ray' },
        { a: Q, b: { x: 0, y: Q.y }, start: 1.0, end: 2.2, kind: 'ray' },                 // 平行主光軸
        { a: P, b: I, start: 2.2, end: 3.2, kind: 'extension' },
        { a: O, b: I, start: 2.2, end: 3.2, kind: 'extension' },
        { a: Q, b: I, start: 2.2, end: 3.2, kind: 'extension' }
      ],
      points: [{ p: I, start: 3.2 }],
      captions: [
        { start: 0, text: '鬼身上發出三條光線' },
        { start: 1.0, text: '鬼在焦點內：折射後的光線彼此分開，布幕上不會聚成像' },
        { start: 2.2, text: '從布幕這邊看，光線像是從同一點發出（反向延長的虛線）' },
        { start: 3.2, text: '虛線交點 → 正立、放大的虛像，和鬼在透鏡同一側' }
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
    if (!sp) { setStatus('線的端點要吸附在標示點上（O、F、F′、實像標記、P）。點在點的附近即可。'); return; }
    var pt = { x: sp.x, y: sp.y, label: sp.label };
    if (!state.pending) {
      state.pending = pt;
      setStatus('起點：「' + sp.label + '」。再點另一個點完成連線（會自動延長）。也可以直接從點上拖曳畫線。');
    } else if (Optics.dist(state.pending, pt) < 0.5) {
      state.pending = null; setStatus('已取消起點。');
    } else {
      state.lines.push({ kind: 'line', a: state.pending, b: pt });
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
        if (level.on) level.sealed++;
        setStatus(state.marker && state.marker.virtual
          ? '封印成功！鬼被迫顯形——透鏡裡看到的只是牠的虛像，本體和虛像都在透鏡的另一邊。看看光是怎麼走的。'
          : '封印成功！鬼被迫顯形——布幕上的只是牠的像，本體在透鏡的另一邊。看看光是怎麼走的。');
        startReplay();
      } else {
        state.selectedCell = null;
        giggle();
        if (level.on) {
          // 扣命只看「抓錯」這件事本身，訊息與畫面都不帶任何位置線索
          level.lives--;
          flashHud();
          setStatus('法陣落空，裡面什麼也沒有……（嘻）　失去一顆心。再檢查你的光線作圖。');
          if (level.lives <= 0) failLevel();
        } else {
          setStatus('法陣落空，裡面什麼也沒有……（嘻）　再檢查你的光線作圖。');
        }
      }
      syncUI(); requestRender();
    }, 1500);
  }

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

  // 拖曳畫線：從標示點開始拖，線從該點跟著手指延伸（虛線預覽）。
  // 拖曳途中符合下列任一條件就吸附、預覽變實線：碰到另一個標示點（優先）／接近水平／接近垂直。
  // 放開時是實線就留下，是虛線就消失。吸附後存的是標示點的世界座標，水平與垂直是精確的。
  // 垂直線不是主光線，沒有光學用途（使用者指定：故意放來迷惑玩家）。
  // 「碰到點」有兩種：手指進到點的吸附範圍；或是從起點往手指方向延伸的線經過某個點（線離點 THROUGH_PX 以內，
  // 手指不必真的拖到那個點上）。水平／垂直和「線經過點」同時成立時，取偏差比較小的那個，
  // 所以瞄準某個點時不會被水平吸走，刻意拉平時也不會被旁邊的點吸走。
  var AXIS_MIN_PX = 30, AXIS_TOL_PX = 8, AXIS_TOL_RATIO = 0.12, THROUGH_PX = 14;
  function pointOnDragRay(a, p) {
    var a0 = w2s(a), ux = p.x - a0.x, uy = p.y - a0.y, len = Math.hypot(ux, uy), best = null;
    if (len < AXIS_MIN_PX) return null;
    ux /= len; uy /= len;
    snapPoints().forEach(function (sp) {
      if (Optics.dist(sp, a) < 0.5) return;
      var q = w2s(sp), along = (q.x - a0.x) * ux + (q.y - a0.y) * uy, off = Math.abs((q.x - a0.x) * uy - (q.y - a0.y) * ux);
      if (along <= 0 || off > THROUGH_PX) return; // 只看手指這一側
      var gap = Math.abs(along - len);
      if (!best || off < best.off - 0.5 || (Math.abs(off - best.off) <= 0.5 && gap < best.gap)) best = { sp: sp, off: off, gap: gap };
    });
    return best;
  }
  function dragAsLine(dg) {
    return dg.snap === 'point' ? { kind: 'line', a: dg.a, b: dg.b } : { kind: dg.snap === 'h' ? 'parallel' : 'vertical', a: dg.a, b: null };
  }
  function updateDragLine(p) {
    var sp0 = gesture.snap, a = { x: sp0.x, y: sp0.y, label: sp0.label };
    var dx = Math.abs(p.x - gesture.x0), dy = Math.abs(p.y - gesture.y0);
    var hit = nearestSnap(p.x, p.y), snap = null, b = null;
    if (hit && Optics.dist(hit, a) >= 0.5) { snap = 'point'; b = { x: hit.x, y: hit.y, label: hit.label }; }
    else {
      var axis = null, axisOff = Infinity;
      if (dx >= AXIS_MIN_PX && dy <= Math.max(AXIS_TOL_PX, dx * AXIS_TOL_RATIO)) { axis = 'h'; axisOff = dy; }
      else if (dy >= AXIS_MIN_PX && dx <= Math.max(AXIS_TOL_PX, dy * AXIS_TOL_RATIO)) { axis = 'v'; axisOff = dx; }
      var thru = pointOnDragRay(a, p);
      if (thru && thru.off <= axisOff) { snap = 'point'; b = { x: thru.sp.x, y: thru.sp.y, label: thru.sp.label }; }
      else snap = axis;
    }
    var was = state.drag ? state.drag.snap + (state.drag.b ? state.drag.b.label : '') : '';
    state.drag = { a: a, snap: snap, b: b, cur: { x: p.x, y: p.y } };
    var now = snap ? snap + (b ? b.label : '') : '';
    if (now !== was) {
      setStatus(snap === 'point' ? '放開：畫出通過「' + a.label + '」與「' + b.label + '」的直線。'
        : snap === 'h' ? '放開：畫出通過「' + a.label + '」的水平線（平行主光軸）。'
        : snap === 'v' ? '放開：畫出通過「' + a.label + '」的垂直線。'
        : '虛線放開會消失。拖到另一個點上，或拉成水平／垂直，線才會留下。');
    }
  }
  function cancelDragLine() { if (state.drag) { state.drag = null; requestRender(); } }
  function finishDragLine(commit) {
    var dg = state.drag;
    state.drag = null;
    if (dg && dg.snap && commit) {
      state.lines.push(dragAsLine(dg));
      state.pending = null;
      setStatus(dg.snap === 'point' ? '已畫出通過「' + dg.a.label + '」與「' + dg.b.label + '」的直線。'
        : dg.snap === 'h' ? '已畫出通過「' + dg.a.label + '」的水平線。' : '已畫出通過「' + dg.a.label + '」的垂直線。');
    } else {
      setStatus('沒有畫線。從標示點拖到另一個點，或拉成水平／垂直再放開。');
    }
    syncUI(); requestRender();
  }

  var pointers = {}, gesture = null;
  function localPos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function pointerCount() { return Object.keys(pointers).length; }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    pointers[e.pointerId] = true;
    if (pointerCount() === 1) {
      var p = localPos(e);
      gesture = { id: e.pointerId, x0: p.x, y0: p.y, lx: p.x, ly: p.y, moved: false, multi: false, kind: null,
        snap: state.phase === 'analysis' && state.mode === 'draw' && !state.solved ? nearestSnap(p.x, p.y) : null };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else if (gesture) {
      gesture.multi = true; cancelDragLine(); // 兩指：不做任何事（縮放只用按鈕）
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!gesture || gesture.id !== e.pointerId || gesture.multi) return;
    var p = localPos(e);
    if (!gesture.moved && Math.hypot(p.x - gesture.x0, p.y - gesture.y0) > TAP_SLOP_PX) gesture.moved = true;
    if (gesture.snap) {
      // 起點在標示點上：一律是畫線，不平移畫面（從空白處拖才是平移）
      if (gesture.moved) { gesture.kind = 'draw'; updateDragLine(p); requestRender(); }
      gesture.lx = p.x; gesture.ly = p.y; return;
    }
    if (gesture.moved) {
      if (state.phase === 'analysis') {
        state.view.tx += p.x - gesture.lx; state.view.ty += p.y - gesture.ly;
        clampView();
      } else if (!state.solved) {
        // 觀察階段：在畫面任何地方左右拖曳都是移動透鏡（手指不必壓在鏡片上）
        moveLens(state.lensX + (p.x - gesture.lx) / sideView().s);
      }
      requestRender();
    }
    gesture.lx = p.x; gesture.ly = p.y;
  });
  function endPointer(e, cancelled) {
    delete pointers[e.pointerId];
    if (!gesture) return;
    if (gesture.id === e.pointerId && gesture.kind === 'draw') finishDragLine(!cancelled && !gesture.multi);
    if (gesture.id === e.pointerId && !gesture.moved && !gesture.multi && !cancelled) {
      var p = localPos(e);
      if (state.phase === 'analysis') analysisTap(p.x, p.y);
      else if (!state.marker) setStatus('左右拖曳畫面可以移動凸透鏡；也可以用下方的「微調」按鈕。');
      requestRender();
    }
    if (pointerCount() === 0) gesture = null;
  }
  canvas.addEventListener('pointerup', function (e) { endPointer(e, false); });
  canvas.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
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
    $('zoomBox').classList.toggle('low', !!state.marker && !state.marker.virtual && state.marker.y > 0); // 避開布幕上的實像標記（見 index.html）；虛像標記在走廊中間，不必避
    $('toAnalysis').disabled = !state.marker;
    $('toAnalysis').classList.toggle('primary', !!state.marker);
    $('markBtn').classList.toggle('primary', !state.marker);
    $('lookScreen').classList.toggle('on', state.look === 'screen');
    $('lookLens').classList.toggle('on', state.look === 'lens');
    $('lookScreen').setAttribute('aria-pressed', String(state.look === 'screen'));
    $('lookLens').setAttribute('aria-pressed', String(state.look === 'lens'));
    $('modeDraw').classList.toggle('on', state.mode === 'draw');
    $('modeSeal').classList.toggle('on', state.mode === 'seal');
    $('drawRow').hidden = state.mode !== 'draw';
    $('sealRow').hidden = state.mode !== 'seal';
    $('undoBtn').disabled = !state.lines.length && !state.pending;
    $('clearBtn').disabled = !state.lines.length && !state.pending;
    $('castBtn').disabled = state.selectedCell == null || state.solved || !!(state.seal && !state.seal.done);
    $('castBtn').hidden = state.solved;
    $('toExplore').hidden = state.solved; // 破關後不能回去重新對焦：那會把法陣和現身的鬼清掉，而且觀察畫面沒有「下一組配置」
    $('nextBtn').hidden = !state.solved;
    var cleared = level.on && level.sealed >= level.goal;
    $('nextBtn').textContent = !level.on ? '下一組配置' : (cleared ? '過關 ➜' : '下一隻鬼 ➜');
    $('nextBtn').classList.toggle('primary', level.on);
    $('replayBtn').hidden = !state.solved;
    // 關卡模式：左上角是愛心與封印數；配置選單與 Debug 是開發工具，只在 ?free=1 出現
    $('title').hidden = level.on; $('configSel').hidden = level.on; $('debugBtn').hidden = level.on;
    $('hud').hidden = !level.on;
    $('app').classList.toggle('lvl', level.on);
    if (level.on) {
      var hearts = $('hearts').children;
      for (var hi = 0; hi < hearts.length; hi++) hearts[hi].classList.toggle('lost', hi >= level.lives);
      $('hearts').setAttribute('aria-label', '剩下 ' + level.lives + ' 條命');
      $('sealCount').textContent = '封印 ' + level.sealed + '／' + level.goal;
    }
    $('zoomIn').disabled = state.zoomIdx >= ZOOM_STEPS.length - 1;
    $('zoomOut').disabled = state.zoomIdx <= 0;
    $('debugBtn').classList.toggle('on', state.debug);
    $('debugBtn').setAttribute('aria-pressed', String(state.debug));
    var dp = $('debugPanel');
    dp.hidden = !state.debug;
    dp.textContent = state.debug ? debugText() : ''; // 關閉時 DOM 內不留任何答案文字
  }

  function debugText() {
    var c = cfg(), f2 = function (n) { return (Math.round(n * 100) / 100).toString(); }, w = wallNow();
    return 'DEBUG 配置 ' + c.id + '（僅供開發驗證）\n' +
      '焦距 f = ' + c.f + ' cm\n' +
      '物點 = (' + f2(c.object.x) + ', ' + f2(c.object.y) + ')   目標格 = ' + c.targetCell + '\n' +
      '題型 = ' + (c.kind === 'virtual' ? '虛像（D < 4f）' : '實像') + '\n' +
      '清晰位置 lensX = ' + (c.sharp.length ? c.sharp.map(function (s) { return f2(s.lensX) + '（m=' + f2(s.m) + '）'; }).join('、') : '無') + '\n' +
      '虛像可標記 lensX = ' + (c.virtualWindow ? c.virtualWindow.from + '～' + c.virtualWindow.to : '無') + '\n' +
      '目前 lensX = ' + f2(state.lensX) + '   模糊圓 = ' + (w && isFinite(w.blur) ? f2(w.blur) + ' cm' : '—') + '\n' +
      '標記 = ' + (state.marker ? (state.marker.virtual ? '虛像' : '實像') + ' (' + f2(state.marker.x) + ', ' + f2(state.marker.y) + ')' : '—') + '\n' +
      '封印次數 = ' + state.attempts + '   線 = ' + state.lines.length;
  }

  // ====================================================================
  // 關卡流程：開場過場 → 抓鬼 → 失敗／過關（畫面用 ../shared/story-scene.js）
  // ====================================================================

  var hudTimer = null;
  function flashHud() {
    var h = $('hud'); h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit');
    clearTimeout(hudTimer); hudTimer = setTimeout(function () { h.classList.remove('hit'); }, 700);
  }
  function closeScene() { if (level.scene) { level.scene.close(); level.scene = null; } }

  function showIntro() {
    closeScene();
    level.screen = 'intro';
    level.scene = window.StoryScene.show({
      id: 'intro', background: INTRO_BG,
      lines: [
        { speaker: '你', text: '看不到鬼了……' },
        { speaker: '你', text: '這鬼似乎只能用鏡子看到。' },
        { speaker: '你', text: '咦？這裡怎麼有一個這麼大的凸透鏡？' }
      ],
      note: '走廊裡鬼影重重。' + LEVEL_LIVES + ' 條命內抓到 ' + LEVEL_GOAL + ' 隻鬼；抓錯會失去一顆心。',
      buttons: [{ id: 'startHuntBtn', label: '開始抓鬼', primary: true, onClick: startHunt }]
    });
  }
  /** 進入（或重新進入）抓鬼：命數與封印數重置，換一隻新的鬼。 */
  function startHunt() {
    closeScene();
    level.screen = 'play'; level.lives = LEVEL_LIVES; level.sealed = 0;
    state.seenAnalysisIntro = false; state.seenVirtualIntro = false;
    resetRound(nextRandomConfig());
  }
  function failLevel() {
    level.screen = 'failed';
    closeScene();
    level.scene = window.StoryScene.show({
      id: 'failed', background: INTRO_BG,
      title: '三顆心都用完了……',
      note: '鬼還躲在走廊裡。這次封印了 ' + level.sealed + ' 隻。重新挑戰會從頭算起。',
      buttons: [
        { id: 'retryBtn', label: '重新挑戰', primary: true, onClick: startHunt },
        { id: 'failMenuBtn', label: '回關卡選單', href: MENU_URL }
      ]
    });
  }
  function showCleared() {
    level.screen = 'cleared';
    if (window.GameProgress) window.GameProgress.markCleared('convex');
    // 趕鬼時間：第一關開始到這裡的牆上時間。null＝這一輪沒有從第一關依序玩過來（直接開網址、?unlock=1 跳關），不顯示也不上榜。
    var castleMs = window.Leaderboard ? window.Leaderboard.finishCastle() : null;
    var timeNote = castleMs != null ? '趕鬼時間：' + window.Leaderboard.formatTime(castleMs) + '。' : '';
    closeScene();
    level.scene = window.StoryScene.show({
      id: 'cleared', background: INTRO_BG, scatter: 7,
      lines: [
        { text: '剩下的鬼一哄而散，逃出了城堡！' },
        { speaker: '你', text: '想跑？追！' }
      ],
      title: '第二關過關！',
      note: '你在走廊封印了 ' + level.sealed + ' 隻鬼。' + timeNote + '下一站：城外的荒野（已解鎖）。',
      buttons: [
        { id: 'clearMenuBtn', label: '回關卡選單', primary: true, href: MENU_URL },
        { id: 'againBtn', label: '再玩一次', onClick: startHunt }
      ]
    });
  }

  // 隨機出題：把所有配置洗牌後依序出；出完再洗一次。同一組不會連續出現，也不會照固定順序讓人背答案。
  var deck = [], roundsStarted = 0;
  function nextRandomConfig() {
    // 牌堆只剩一張、又剛好是現在這組（自由練習手動選到最後一張）：這張已經在畫面上了，丟掉直接洗新的一疊。
    if (roundsStarted > 0 && deck.length === 1 && deck[0] === state.cfgIndex) deck = [];
    if (!deck.length) {
      deck = Cfg.all.map(function (_, i) { return i; });
      for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    }
    // 要發的牌跟現在這組一樣就改發下一張：兩疊牌交界、或自由練習用下拉選單手動選過配置（那組還留在牌堆裡）都可能撞到。
    if (roundsStarted > 0 && deck.length > 1 && deck[deck.length - 1] === state.cfgIndex) {
      var top = deck.length - 1, tmp = deck[top]; deck[top] = deck[top - 1]; deck[top - 1] = tmp;
    }
    return deck.pop();
  }

  // 透鏡的起始位置：離兩個清晰位置都夠遠，否則一開場布幕上就幾乎是清楚的像（等於不用對焦）。
  // 也不能一開場就在鬼的後面，或隔著透鏡就看得到虛像。
  function startLensX(c) {
    var best = -350, bestGap = -1;
    [-350, -200, -500, -120, -600].forEach(function (x) {
      var gap = Math.min.apply(null, c.sharp.map(function (sp) { return Math.abs(sp.lensX - x); }).concat([Infinity]));
      var lv = Cfg.lensView(c.f, c.object.x, c.h, x);
      if (lv.eye === 'none' || lv.eye === 'virtual') return;
      if (gap >= 60 && bestGap < 60) { best = x; bestGap = gap; }
    });
    return best;
  }

  function resetRound(idx) {
    state.cfgIndex = idx; roundsStarted++;
    state.phase = 'observe'; state.lensX = startLensX(Cfg.all[idx]); state.marker = null; state.look = 'screen';
    state.mode = 'draw'; state.pending = null; state.lines = []; state.drag = null;
    state.selectedCell = null; state.seal = null; state.solved = false; state.attempts = 0; state.replay = null;
    state.zoomIdx = 0;
    $('configSel').value = String(idx);
    setStatus('走廊深處有鬼，肉眼看不到。左右拖曳移動凸透鏡，找到清楚的鬼像就按「標記」。');
    layout();
  }

  function enterAnalysis() {
    if (!state.marker) return;
    state.phase = 'analysis'; state.pending = null;
    syncUI(); layout();
    var vm = state.marker.virtual;
    setStatus(state.solved ? '已封印。' : '側視圖：從「' + (vm ? '虛像' : '實像') + '標記」出發，用主光線反推鬼本體在哪一格。先選起點，再選終點。');
    if (!state.seenAnalysisIntro || (vm && !state.seenVirtualIntro)) {
      state.seenAnalysisIntro = true;
      if (vm) state.seenVirtualIntro = true;
      showBanner(vm ? '現在只看走廊的側視圖：你標記的虛像在透鏡左邊，鬼也藏在透鏡左邊的某一格。'
        : '現在只看走廊的側視圖：右邊是布幕和你標記的實像，中間是凸透鏡，鬼藏在透鏡左邊的某一格。', 5200);
    }
  }

  function layout() {
    var r = $('stage').getBoundingClientRect();
    W = Math.max(50, Math.round(r.width)); H = Math.max(50, Math.round(r.height));
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    FS = Math.min(W, H) < 420 ? 1.25 : 1;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    if (state.phase === 'analysis') {
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
    stats.frame++; stats.debugDrawn = false; stats.ghostRevealed = false;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (state.phase === 'analysis') {
      renderSide({ x: 0, y: 0, w: W, h: H });
    } else {
      var rg = regions();
      renderSide(rg.side);
      if (state.look === 'lens') renderLensView(rg.wall); else renderWall(rg.wall);
      ctx.strokeStyle = '#2c3359'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (rg.wall.y === 0 && rg.wall.x > 0) { ctx.moveTo(rg.wall.x, 0); ctx.lineTo(rg.wall.x, H); }
      else { ctx.moveTo(0, rg.wall.h); ctx.lineTo(W, rg.wall.h); }
      ctx.stroke();
    }
  }

  // ---- 控制項 ----
  Cfg.all.forEach(function (c, i) {
    var o = document.createElement('option'); o.value = String(i); o.textContent = '配置 ' + c.id; $('configSel').appendChild(o);
  });
  $('configSel').addEventListener('change', function () { resetRound(Number(this.value)); });
  $('debugBtn').addEventListener('click', function () { state.debug = !state.debug; syncUI(); requestRender(); });
  $('nudgeLeft').addEventListener('click', function () { if (!state.solved) { moveLens(state.lensX - NUDGE_CM); requestRender(); syncUI(); } });
  $('nudgeRight').addEventListener('click', function () { if (!state.solved) { moveLens(state.lensX + NUDGE_CM); requestRender(); syncUI(); } });
  $('markBtn').addEventListener('click', markImage);
  $('lookScreen').addEventListener('click', function () { setLook('screen'); });
  $('lookLens').addEventListener('click', function () { setLook('lens'); });
  $('toAnalysis').addEventListener('click', enterAnalysis);
  $('toExplore').addEventListener('click', function () {
    state.phase = 'observe'; state.pending = null; state.lines = []; state.selectedCell = null; state.seal = null; state.mode = 'draw';
    setStatus(state.solved ? '已封印。可以換下一組配置。' : '回到觀察。畫過的線已清除；移動透鏡會取消標記。');
    layout();
  });
  $('modeDraw').addEventListener('click', function () { state.mode = 'draw'; setStatus('畫線模式：點標示點來畫線。此模式下不會選到地板格。'); syncUI(); requestRender(); });
  $('modeSeal').addEventListener('click', function () { state.mode = 'seal'; state.pending = null; setStatus('封印模式：點一個地板格（整個直欄都可點），再按「施放封印法陣」。'); syncUI(); requestRender(); });
  $('menuBtn').addEventListener('click', function () { if (window.confirm('回到關卡選單？這一關目前的進度不會保留。')) location.href = '../index.html'; });
  $('toolLine').addEventListener('click', function () { setStatus('連線：從標示點拖到另一個點；拉成水平或垂直也會吸附。虛線放開會消失。也可以依序點兩個點。'); });
  $('undoBtn').addEventListener('click', function () { if (state.pending) state.pending = null; else state.lines.pop(); syncUI(); requestRender(); });
  $('clearBtn').addEventListener('click', function () { state.lines = []; state.pending = null; setStatus('已清除所有線。'); syncUI(); requestRender(); });
  $('castBtn').addEventListener('click', castSeal);
  $('nextBtn').addEventListener('click', function () {
    if (level.on && level.sealed >= level.goal) showCleared(); else resetRound(nextRandomConfig());
  });
  $('replayBtn').addEventListener('click', function () { if (state.solved) startReplay(); });
  $('zoomIn').addEventListener('click', function () { setZoom(state.zoomIdx + 1); });
  $('zoomOut').addEventListener('click', function () { setZoom(state.zoomIdx - 1); });
  $('zoomFit').addEventListener('click', function () { setZoom(0); });

  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe($('stage'));

  // 測試／開發用掛鉤（不是學生 UI）
  window.__protoConvex = {
    state: state, stats: stats, cfg: cfg, configs: Cfg, GHOST_COLOR: GHOST_COLOR, SNAP_PX: SNAP_PX,
    w2s: w2s, s2w: s2w, snapPoints: snapPoints, nearestSnap: nearestSnap, studentIntersections: studentIntersections, wallNow: wallNow, lensViewNow: lensViewNow,
    regions: regions, canvasSize: function () { return { W: W, H: H, DPR: DPR }; }, render: render,
    replaySpec: replaySpec, level: level,
    art: function () { return { pending: artPending, corridor: ART.corridor.ready, lens: ART.lens.ready }; }
  };

  resetRound(nextRandomConfig()); // 一開始也隨機，不固定從配置 A 開始
  if (level.on) showIntro();
})();

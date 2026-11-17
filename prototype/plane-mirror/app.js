/*
 * 第一關：平面鏡房間。
 *
 * 畫面 = 背景圖（牆、鏡框、燈、窗）＋ 程式畫的地板 ＋ 程式畫的鏡中畫面。
 * 鏡中畫面不是貼圖：把整個房間對鏡面鏡射後，透過鏡面那個洞再畫一次（鏡中鏡畫到第二層）。
 * 幾何全部在 ../shared/mirror-core.js；這個檔只管畫面、操作與關卡流程。
 *
 * 預設是關卡模式：開場 → 兩面鏡抓 2 次 → 鬼打碎右邊的鏡子 → 一面鏡再抓 3 次 → 過關。3 條命整關共用。
 * 網址加 ?free=1 是自由練習（開發用）：沒有過場、不計命，可指定鏡子數與鬼的位置、開 Debug。
 */
(function () {
  'use strict';
  var C = window.MirrorCore, R = window.MirrorRoom, cam = C.makeCamera(R.camera);
  var $ = function (id) { return document.getElementById(id); };
  var FREE = /[?&]free=1/.test(location.search);
  var GHOST_COLOR = '#9dffd8';
  var IW = R.image.w, IH = R.image.h;

  var canvas = $('view'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1, S = 1, OX = 0, OY = 0; // 影像座標 → 畫布：x·S + OX

  function loadArt(src) {
    var a = { img: new Image(), ready: false };
    a.img.onload = function () { a.ready = true; requestRender(); };
    a.img.src = src;
    return a;
  }
  var ART = { intact: loadArt('assets/room-intact.jpg'), broken: loadArt('assets/room-broken.jpg') };

  // ---------- 狀態 ----------
  var POOLS = { 1: C.eligibleCells(R, cam, ['back', 'right']), 2: C.eligibleCells(R, cam, ['back']) };
  var SELECTABLE = C.selectableCells(R, cam);
  var state = {
    phase: 1,          // 1 = 兩面鏡；2 = 右邊的鏡子被打碎，只剩正面那面
    ghost: null,       // {col,row} 鬼真正的位置
    selected: null,    // 玩家選的格子
    revealed: false,   // 這一次已經抓到（鬼現身）
    cast: null,        // 進行中的法陣 {cell, t0, ok}
    busy: false,
    lives: R.lives, sealed: 0, over: false,
    debug: false, fx: null, forced: null
  };
  var stats = { casts: 0, wrong: 0, mirrorTaps: 0, pans: 0, ghostRevealed: false, images: { back: false, right: false }, lastPick: null };
  var scene = null, history = [];

  function intactMirrors() { return state.phase === 1 ? ['back', 'right'] : ['back']; }
  function sameCell(a, b) { return !!a && !!b && a.col === b.col && a.row === b.row; }

  function pickGhost() {
    if (state.forced) return state.forced;
    var pool = POOLS[state.phase].filter(function (c) {
      return !history.slice(-2).some(function (h) { return sameCell(h, c); });
    });
    if (!pool.length) pool = POOLS[state.phase].filter(function (c) { return !sameCell(c, state.ghost); });
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function newGhost() {
    state.ghost = pickGhost();
    history.push(state.ghost);
    state.selected = null; state.revealed = false; state.cast = null; state.busy = false;
    stats.ghostRevealed = false;
  }

  // ---------- 版面 ----------
  function layout() {
    var r = $('stage').getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    applyView();
  }
  // 縮放只用按鈕（＋／－／全圖），放大後拖曳平移；不做雙指縮放，避免和點格子打架。
  var ZOOMS = [1, 1.5, 2, 2.5];
  var view = { zoom: 0, panX: 0, panY: 0 };
  function applyView() {
    S = Math.min(W / IW, H / IH) * ZOOMS[view.zoom];
    var mx = Math.max(0, (IW * S - W) / 2), my = Math.max(0, (IH * S - H) / 2);
    view.panX = Math.max(-mx, Math.min(mx, view.panX)); view.panY = Math.max(-my, Math.min(my, view.panY));
    OX = (W - IW * S) / 2 + view.panX; OY = (H - IH * S) / 2 + view.panY;
    if ($('zoomIn')) {
      $('zoomIn').disabled = view.zoom >= ZOOMS.length - 1;
      $('zoomOut').disabled = view.zoom <= 0; $('zoomFit').disabled = view.zoom <= 0;
    }
    requestRender();
  }
  function setZoom(z) {
    var old = ZOOMS[view.zoom];
    view.zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
    var k = ZOOMS[view.zoom] / old; // 以畫面中央為準縮放
    view.panX *= k; view.panY *= k;
    if (view.zoom === 0) { view.panX = 0; view.panY = 0; }
    applyView();
  }
  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }

  // ---------- 繪圖小工具（都在影像座標裡畫） ----------
  function path(pts) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i].x, pts[i].y); else ctx.moveTo(pts[i].x, pts[i].y); }
    ctx.closePath();
  }
  function fillPoly(pts, style) { if (pts.length < 3) return; path(pts); ctx.fillStyle = style; ctx.fill(); }
  function proj(T, p) { return C.project(cam, C.apply(T, p)); }
  function projPoly(T, pts) { return C.projectPoly(cam, pts.map(function (p) { return C.apply(T, p); })); }
  function avgDepth(pts) { var s = 0; pts.forEach(function (p) { s += p.depth; }); return s / pts.length; }
  function hash(a, b) { var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); }

  // ---------- 房間（牆、天花板、地板）：T 是鏡射，identity 就是真的房間 ----------
  function wallPolys() {
    var w = R.cols, l = R.length, c = R.ceiling;
    return {
      back: [{ x: 0, y: 0, z: 0 }, { x: w, y: 0, z: 0 }, { x: w, y: c, z: 0 }, { x: 0, y: c, z: 0 }],
      right: [{ x: w, y: 0, z: 0 }, { x: w, y: 0, z: l }, { x: w, y: c, z: l }, { x: w, y: c, z: 0 }],
      left: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: l }, { x: 0, y: c, z: l }, { x: 0, y: c, z: 0 }],
      front: [{ x: 0, y: 0, z: l }, { x: w, y: 0, z: l }, { x: w, y: c, z: l }, { x: 0, y: c, z: l }],
      ceiling: [{ x: 0, y: c, z: 0 }, { x: w, y: c, z: 0 }, { x: w, y: c, z: l }, { x: 0, y: c, z: l }]
    };
  }
  var WALLS = wallPolys();
  var WALL_COLOR = { back: '#2b1d15', right: '#24170f', left: '#221610', front: '#1d130d', ceiling: '#17100b' };

  function drawWalls(T, skip) {
    ['ceiling', 'front', 'left', 'right', 'back'].forEach(function (id) {
      if (skip.indexOf(id) >= 0) return;
      var p = projPoly(T, WALLS[id]);
      fillPoly(p, WALL_COLOR[id]);
      if (id === 'ceiling' || p.length < 3) return;
      // 直的木板縫
      ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1.5;
      var n = id === 'back' || id === 'front' ? R.cols * 2 : R.length * 2, i, a, b;
      for (i = 1; i < n; i++) {
        var t = i / 2;
        a = id === 'back' ? { x: t, y: 0, z: 0 } : id === 'front' ? { x: t, y: 0, z: R.length } : { x: id === 'left' ? 0 : R.cols, y: 0, z: t };
        b = { x: a.x, y: R.ceiling, z: a.z };
        var s = projPoly(T, [a, b]);
        if (s.length >= 2) { ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke(); }
      }
    });
    // 左牆的窗
    if (skip.indexOf('left') < 0) {
      var wd = R.window, zc = (wd.z0 + wd.z1) / 2, hw = (wd.z1 - wd.z0) / 2, pts = [], k;
      pts.push({ x: 0, y: wd.y0, z: wd.z0 });
      for (k = 0; k <= 8; k++) { var an = Math.PI * k / 8; pts.push({ x: 0, y: wd.y1 - hw * 0.9 + Math.sin(an) * hw * 0.9, z: zc - Math.cos(an) * hw }); }
      pts.push({ x: 0, y: wd.y0, z: wd.z1 });
      var wp = projPoly(T, pts);
      if (wp.length >= 3) { path(wp); ctx.fillStyle = '#31466e'; ctx.fill(); ctx.strokeStyle = '#4b3a2c'; ctx.lineWidth = 3; ctx.stroke(); }
    }
    // 玩家背後那面牆的門
    if (skip.indexOf('front') < 0) {
      var d = R.door, dp = projPoly(T, [{ x: d.x0, y: 0, z: R.length }, { x: d.x1, y: 0, z: R.length }, { x: d.x1, y: d.y1, z: R.length }, { x: d.x0, y: d.y1, z: R.length }]);
      if (dp.length >= 3) { path(dp); ctx.fillStyle = '#120b07'; ctx.fill(); ctx.strokeStyle = '#3a281b'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    // 正面牆的壁燈
    if (skip.indexOf('back') < 0) R.lamps.forEach(function (l) {
      var s = proj(T, { x: l.x, y: l.y, z: 0 });
      if (!s) return;
      var r = 0.9 * cam.f / s.depth, g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, 'rgba(255,190,110,.75)'); g.addColorStop(0.12, 'rgba(255,150,70,.38)'); g.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = g; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    });
  }

  function drawFloor(T) {
    var outline = projPoly(T, [{ x: 0, y: 0, z: 0 }, { x: R.cols, y: 0, z: 0 }, { x: R.cols, y: 0, z: R.length }, { x: 0, y: 0, z: R.length }]);
    if (outline.length < 3) return;
    ctx.save();
    path(outline); ctx.clip();
    var col, row, p, v;
    for (row = R.length; row >= 1; row--) for (col = 1; col <= R.cols; col++) {
      p = projPoly(T, C.cellPoly(col, row));
      if (p.length < 3) continue;
      // 兩種深淺交錯（西洋棋盤）：鏡子裡的格子很小，交錯的顏色比較好數
      v = hash(col, row) * 5 + ((col + row) % 2 ? 0 : 23);
      fillPoly(p, 'rgb(' + Math.round(39 + v) + ',' + Math.round(36 + v * 0.93) + ',' + Math.round(37 + v * 0.9) + ')');
    }
    // 燈光在地板上的暖色光暈（只是氣氛）
    R.lamps.forEach(function (l) {
      var s = proj(T, { x: l.x, y: 0, z: 0.9 });
      if (!s) return;
      var r = 1.7 * cam.f / s.depth;
      ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1, 0.34);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,160,80,.30)'); g.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    });
    // 格線（地磚的縫）。每條線分段畫，線寬依遠近變化。
    ctx.strokeStyle = 'rgba(205,176,142,.72)'; ctx.lineCap = 'round';
    function seam(a, b) {
      var s = projPoly(T, [a, b]);
      if (s.length < 2) return;
      ctx.lineWidth = Math.max(1, Math.min(7, 26 / ((s[0].depth + s[1].depth) / 2)));
      ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
    }
    var i, j;
    for (i = 0; i <= R.cols; i++) for (j = 0; j < R.length; j++) seam({ x: i, y: 0, z: j }, { x: i, y: 0, z: j + 1 });
    for (j = 0; j <= R.length; j++) for (i = 0; i < R.cols; i++) seam({ x: i, y: 0, z: j }, { x: i + 1, y: 0, z: j });
    // 鏡子打碎後散在地上的碎片
    if (state.phase === 2) {
      for (i = 0; i < 16; i++) {
        var sx = R.cols - 0.08 - hash(i, 3) * 0.75, sz = 1.0 + hash(i, 7) * 2.6, e = 0.03 + hash(i, 11) * 0.05, an = hash(i, 5) * 6.28;
        p = projPoly(T, [0, 2.2, 4.1].map(function (o) { return { x: sx + Math.cos(an + o) * e, y: 0, z: sz + Math.sin(an + o) * e }; }));
        fillPoly(p, 'rgba(210,222,235,' + (0.5 + hash(i, 13) * 0.4).toFixed(2) + ')');
      }
    }
    ctx.restore();
  }

  // ---------- 立在地上的人形（鬼、玩家自己）：四邊形投影後用仿射變換畫 ----------
  function drawSprite(T, quad, painter) {
    var tl = proj(T, quad.tl), tr = proj(T, quad.tr), bl = proj(T, quad.bl);
    if (!tl || !tr || !bl) return null;
    ctx.save();
    ctx.transform(tr.x - tl.x, tr.y - tl.y, bl.x - tl.x, bl.y - tl.y, tl.x, tl.y);
    painter();
    ctx.restore();
    return (tl.depth + bl.depth) / 2;
  }
  // 鬼的 placeholder：單位方格內的形狀，左右不對稱（一隻小手在牠自己的一側）
  function ghostPainter(alpha) {
    return function () {
      ctx.globalAlpha *= alpha;
      ctx.shadowColor = 'rgba(120,255,200,.9)'; ctx.shadowBlur = 14 * S * DPR;
      ctx.fillStyle = GHOST_COLOR;
      ctx.beginPath();
      ctx.moveTo(0.14, 0.97); ctx.lineTo(0.14, 0.33); ctx.bezierCurveTo(0.14, -0.03, 0.76, -0.03, 0.76, 0.33); ctx.lineTo(0.76, 0.97);
      ctx.lineTo(0.655, 0.88); ctx.lineTo(0.55, 0.97); ctx.lineTo(0.45, 0.88); ctx.lineTo(0.35, 0.97); ctx.lineTo(0.245, 0.88);
      ctx.closePath();
      var e = function (x, y, rx, ry) { ctx.moveTo(x + rx, y); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
      e(0.34, 0.30, 0.055, 0.06); e(0.56, 0.30, 0.055, 0.06); e(0.45, 0.46, 0.07, 0.04);
      e(0.90, 0.40, 0.095, 0.062);
      ctx.fill('evenodd');
    };
  }
  function playerPainter() {
    ctx.fillStyle = 'rgba(14,12,18,.9)';
    ctx.beginPath();
    ctx.ellipse(0.5, 0.1, 0.17, 0.095, 0, 0, Math.PI * 2);
    ctx.moveTo(0.14, 1); ctx.lineTo(0.12, 0.36); ctx.quadraticCurveTo(0.14, 0.22, 0.5, 0.2); ctx.quadraticCurveTo(0.86, 0.22, 0.88, 0.36); ctx.lineTo(0.86, 1);
    ctx.closePath();
    ctx.fill();
  }
  function playerQuad() {
    var e = cam.eye, w = 0.3, h = e.y + 0.12;
    return { bl: { x: e.x - w, y: 0, z: e.z }, br: { x: e.x + w, y: 0, z: e.z }, tl: { x: e.x - w, y: h, z: e.z }, tr: { x: e.x + w, y: h, z: e.z } };
  }

  // ---------- 鏡中畫面 ----------
  // chain：依序穿過哪些鏡子（例如 ['back'] 或 ['back','right']）。clip：這面鏡在畫面上的範圍。
  function drawView(chain, clip) {
    var T = C.chainT(R, chain);
    ctx.save();
    path(clip); ctx.clip();
    ctx.fillStyle = '#0a090e'; ctx.fill();
    // 視線穿過的那幾面牆不畫（它們就是鏡面所在的平面）
    drawWalls(T, chain);
    drawFloor(T);
    // 別面鏡子在這面鏡裡的樣子
    Object.keys(R.mirrors).forEach(function (id) {
      if (chain.indexOf(id) >= 0) return;
      var m = R.mirrors[id], intact = intactMirrors().indexOf(id) >= 0;
      var g = m.glass, poly3 = intact ? C.mirrorPoly(m)
        : C.mirrorPoly({ axis: m.axis, value: m.value, glass: { a: g.a, b: g.b, topA: g.topA, topB: g.topB, bottom: R.paintedBottom } });
      var p = projPoly(T, poly3);
      if (p.length < 3) return;
      if (intact && chain.length < 2) drawView(chain.concat(id), p);
      else if (intact) fillPoly(p, '#141a26');
      else drawBrokenGlass(p);
      path(p); ctx.strokeStyle = '#b8873a'; ctx.lineWidth = Math.max(2, 26 / avgDepth(p) * 2.2); ctx.lineJoin = 'round'; ctx.stroke();
    });
    // 人形：遠的先畫
    var sprites = [{ quad: playerQuad(), painter: playerPainter }];
    if (state.ghost) sprites.push({ quad: C.ghostQuad(R, state.ghost), painter: ghostPainter(state.revealed ? 1 : 0.93) });
    sprites.forEach(function (s) { var q = proj(T, s.quad.bl); s.d = q ? q.depth : -1; });
    sprites.sort(function (a, b) { return b.d - a.d; });
    sprites.forEach(function (s) { if (s.d > 0) drawSprite(T, s.quad, s.painter); });
    // 玻璃的一點反光（第一層才加）
    if (chain.length === 1) {
      var bb = bounds(clip), gr = ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
      gr.addColorStop(0, 'rgba(150,180,220,.10)'); gr.addColorStop(0.5, 'rgba(150,180,220,.02)'); gr.addColorStop(1, 'rgba(150,180,220,.08)');
      ctx.fillStyle = gr; ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    }
    ctx.restore();
  }
  function bounds(pts) {
    var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    pts.forEach(function (p) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); });
    return b;
  }
  function drawBrokenGlass(p) {
    fillPoly(p, '#07070b');
    var b = bounds(p), cx = b.x0 + (b.x1 - b.x0) * 0.62, cy = b.y0 + (b.y1 - b.y0) * 0.5, i;
    ctx.save(); path(p); ctx.clip();
    ctx.strokeStyle = 'rgba(210,220,235,.5)'; ctx.lineWidth = 1;
    for (i = 0; i < 11; i++) {
      var an = i * 0.571 + hash(i, 2) * 0.3, len = (b.x1 - b.x0 + b.y1 - b.y0);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len); ctx.stroke();
    }
    ctx.restore();
  }
  function glassScreen(id) { return C.projectPoly(cam, C.mirrorPoly(R.mirrors[id])); }

  // ---------- 法陣（畫在真的地板上；不畫進鏡子裡，理由見 findings） ----------
  function drawMagicCircle(cell, alpha, grow, spin) {
    var c = C.cellCenter(cell.col, cell.row), rad = 0.44 * grow, i, s, pts;
    if (rad <= 0.01) return;
    function ring(r) {
      pts = [];
      for (i = 0; i < 40; i++) { s = C.project(cam, { x: c.x + Math.cos(i / 40 * 6.2832) * r, y: 0, z: c.z + Math.sin(i / 40 * 6.2832) * r }); if (s) pts.push(s); }
      if (pts.length > 2) { path(pts); ctx.stroke(); }
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = '#d9a8ff'; ctx.lineWidth = 3; ctx.shadowColor = '#b060ff'; ctx.shadowBlur = 14 * S * DPR; ctx.lineJoin = 'round';
    ring(rad); ring(rad * 0.7);
    pts = [];
    for (i = 0; i < 5; i++) { var a = spin + i * 4 * Math.PI / 5; s = C.project(cam, { x: c.x + Math.cos(a) * rad * 0.7, y: 0, z: c.z + Math.sin(a) * rad * 0.7 }); if (s) pts.push(s); }
    if (pts.length === 5) { path(pts); ctx.stroke(); }
    // 往上的光柱
    var l = C.project(cam, { x: c.x - rad * 0.7, y: 0, z: c.z }), r2 = C.project(cam, { x: c.x + rad * 0.7, y: 0, z: c.z }), top = C.project(cam, { x: c.x, y: 1.0, z: c.z });
    if (l && r2 && top) {
      var gr = ctx.createLinearGradient(0, top.y, 0, l.y);
      gr.addColorStop(0, 'rgba(190,120,255,0)'); gr.addColorStop(1, 'rgba(190,120,255,.34)');
      ctx.shadowBlur = 0; ctx.fillStyle = gr; ctx.fillRect(l.x, top.y, r2.x - l.x, Math.max(l.y, r2.y) - top.y);
    }
    ctx.restore();
  }

  // ---------- 主畫面 ----------
  var CAST_GROW = 800, CAST_FADE = 600;
  function render() {
    var now = performance.now(), animating = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    var jx = 0, jy = 0, flash = 0;
    if (state.fx) {
      var ft = (now - state.fx.t0) / 650;
      if (ft >= 1) state.fx = null;
      else { animating = true; jx = Math.sin(now / 17) * 14 * (1 - ft); jy = Math.cos(now / 13) * 9 * (1 - ft); flash = Math.max(0, 0.75 - ft * 1.6); }
    }
    ctx.setTransform(DPR * S, 0, 0, DPR * S, DPR * (OX + jx * S), DPR * (OY + jy * S));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, IW, IH); ctx.clip();

    var art = state.phase === 1 ? ART.intact : ART.broken;
    if (art.ready) ctx.drawImage(art.img, 0, 0, IW, IH);
    else { ctx.fillStyle = '#1a120d'; ctx.fillRect(0, 0, IW, IH); }

    drawFloor(C.IDENTITY);
    var intact = intactMirrors();
    intact.forEach(function (id) {
      var g = glassScreen(id);
      drawView([id], g);
      // 鏡面與地板相接的那條線（數格子的基準）
      ctx.strokeStyle = 'rgba(232,186,96,.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(g[3].x, g[3].y); ctx.lineTo(g[2].x, g[2].y); ctx.stroke();
    });
    if (state.phase === 2) fillPoly(R.brokenGlassPx, 'rgba(5,5,10,.55)'); // 原圖碎鏡裡畫死的反射：壓暗
    ['back', 'right'].forEach(function (id) {
      stats.images[id] = !!state.ghost && intact.indexOf(id) >= 0 && C.visibility(R, cam, state.ghost, id).any;
    });

    // 玩家選的格子（介面標示，不是場景裡的東西，所以鏡子裡沒有）
    if (state.selected && !state.cast) {
      var sp = C.projectPoly(cam, C.cellPoly(state.selected.col, state.selected.row));
      path(sp); ctx.fillStyle = 'rgba(255,209,102,.26)'; ctx.fill();
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
    }
    if (state.cast) {
      var t = now - state.cast.t0, grow = Math.min(1, t / CAST_GROW), alpha = 1;
      if (!state.cast.ok && t > CAST_GROW) alpha = 1 - (t - CAST_GROW) / CAST_FADE;
      drawMagicCircle(state.cast.cell, alpha, 1 - Math.pow(1 - grow, 3), now / 900);
      if (state.cast.ok || t < CAST_GROW + CAST_FADE) animating = true;
    }
    if (state.revealed && state.ghost) drawSprite(C.IDENTITY, C.ghostQuad(R, state.ghost), ghostPainter(1));

    if (state.debug) drawDebug();
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flash.toFixed(3) + ')'; ctx.fillRect(0, 0, IW, IH); }
    ctx.restore();
    if (animating) requestRender();
  }

  function drawDebug() {
    ctx.save();
    ctx.lineWidth = 2; ctx.font = '22px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#00e5ff';
    ['back', 'right', 'left'].forEach(function (id) { var p = C.projectPoly(cam, WALLS[id]); if (p.length > 2) { path(p); ctx.stroke(); } });
    ctx.strokeStyle = '#ff5fd2';
    Object.keys(R.mirrors).forEach(function (id) { path(glassScreen(id)); ctx.stroke(); });
    SELECTABLE.forEach(function (c) {
      var s = C.project(cam, C.cellCenter(c.col, c.row));
      var inPool = POOLS[state.phase].some(function (p) { return sameCell(p, c); });
      ctx.fillStyle = inPool ? '#9dffb0' : '#6b7a70';
      ctx.fillText(C.cellId(c.col, c.row), s.x, s.y + 7);
    });
    if (state.ghost) {
      path(C.projectPoly(cam, C.cellPoly(state.ghost.col, state.ghost.row)));
      ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 4; ctx.stroke();
    }
    ctx.restore();
    var g = state.ghost, lines = ['[Debug] 開發用，會顯示答案'];
    if (g) {
      var c = C.cellCenter(g.col, g.row);
      lines.push('鬼本體 ' + C.cellId(g.col, g.row) + '  (x=' + c.x + ', z=' + c.z + ')');
      ['back', 'right'].forEach(function (id) {
        var im = C.imageOf(R, c, [id]), v = C.visibility(R, cam, g, id);
        lines.push(R.mirrors[id].label + (intactMirrors().indexOf(id) < 0 ? '（已碎）' : '') + ' 像 (x=' + im.x.toFixed(1) + ', z=' + im.z.toFixed(1) + ') ' +
          (v.full ? '完整' : v.core ? '腳身頭可見' : v.any ? '只露一部分' : '看不到'));
      });
    }
    lines.push('出題格 ' + POOLS[state.phase].map(function (p) { return C.cellId(p.col, p.row); }).join(' '));
    lines.push('相機 f=' + R.camera.f + ' yaw=' + R.camera.yawDeg + '° eye=(' + cam.eye.x + ',' + cam.eye.y + ',' + cam.eye.z + ')');
    $('debugPanel').textContent = lines.join('\n');
  }

  // ---------- 操作 ----------
  function toImage(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - OX) / S, y: (clientY - r.top - OY) / S };
  }
  function cellAt(p) {
    for (var i = 0; i < SELECTABLE.length; i++) {
      var c = SELECTABLE[i];
      if (C.pointInPoly(p, C.projectPoly(cam, C.cellPoly(c.col, c.row)))) return c;
    }
    return null;
  }
  function mirrorAt(p) {
    var ids = Object.keys(R.mirrors);
    for (var i = 0; i < ids.length; i++) {
      var poly = intactMirrors().indexOf(ids[i]) >= 0 ? glassScreen(ids[i]) : R.brokenGlassPx;
      if (C.pointInPoly(p, poly)) return ids[i];
    }
    return null;
  }
  function canAct() { return !state.busy && !state.revealed && !state.over && !scene; }

  var down = null, TAP_PX = 12;
  canvas.addEventListener('pointerdown', function (e) {
    if (down) return; // 第二根手指：不理會
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, panX: view.panX, panY: view.panY, dragged: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!down || down.id !== e.pointerId) return;
    var dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.dragged && Math.hypot(dx, dy) > TAP_PX) down.dragged = true;
    if (down.dragged && view.zoom > 0) { view.panX = down.panX + dx; view.panY = down.panY + dy; stats.pans++; applyView(); }
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!down || down.id !== e.pointerId) return;
    var moved = down.dragged || Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_PX;
    down = null;
    if (moved || !canAct()) return;
    var p = toImage(e.clientX, e.clientY), cell = cellAt(p);
    if (cell) {
      state.selected = cell; stats.lastPick = C.cellId(cell.col, cell.row);
      setStatus(MSG.selected);
    } else {
      var m = mirrorAt(p);
      if (m) {
        stats.mirrorTaps++;
        setStatus(intactMirrors().indexOf(m) >= 0 ? MSG.mirrorTap : MSG.brokenTap);
      }
    }
    syncUI(); requestRender();
  });
  canvas.addEventListener('pointercancel', function () { down = null; });

  var MSG = {
    start: '鬼躲在房間裡，只有鏡子照得出牠。看鏡中的像，推出牠真正站在哪一格，再點那一格地板。',
    startOne: '只剩一面鏡子了。看鏡中的像，推出鬼真正站在哪一格，再點那一格地板。',
    selected: '選好了就按「展開封印法陣」；想改就點別格。',
    mirrorTap: '鏡子裡的是像，封印不到。你看到的是鬼，還是鬼的像？請點地板的格子。',
    brokenTap: '這面鏡子已經碎了，照不出東西。',
    casting: '法陣展開中……',
    wrong: '法陣裡沒有東西……少了一顆心。鬼還躲在原地，再看一次鏡子。',
    wrongFree: '法陣裡沒有東西。鬼還躲在原地，再看一次鏡子。',
    moved: '鬼掙脫了，換了一個地方躲。'
  };
  function setStatus(t) { $('status').textContent = t; }

  function cast() {
    if (!canAct() || !state.selected) return;
    var ok = sameCell(state.selected, state.ghost);
    state.busy = true; stats.casts++;
    state.cast = { cell: state.selected, t0: performance.now(), ok: ok };
    setStatus(MSG.casting);
    syncUI(); requestRender();
    setTimeout(function () {
      if (ok) {
        state.revealed = true; stats.ghostRevealed = true; state.busy = false; state.sealed++;
        if (FREE) setStatus('抓到了！鬼就站在這一格。');
        else if (state.sealed >= R.catchesTotal) setStatus('第 ' + R.catchesTotal + ' 次抓到牠了！鬼再也待不住了……');
        else if (state.sealed === R.catchesTwoMirrors && state.phase === 1) setStatus('又抓到了！（封印 ' + state.sealed + '／' + R.catchesTotal + '）鬼氣得渾身發抖……');
        else setStatus('抓到了！（封印 ' + state.sealed + '／' + R.catchesTotal + '）可是牠正在掙脫法陣……');
      } else {
        stats.wrong++;
        giggle();
        if (!FREE) {
          state.lives--;
          $('hud').classList.remove('hit'); void $('hud').offsetWidth; $('hud').classList.add('hit');
        }
        setStatus(FREE ? MSG.wrongFree : MSG.wrong);
      }
      syncUI(); requestRender();
      if (!ok) setTimeout(function () {
        state.cast = null; state.selected = null; state.busy = false;
        if (!FREE && state.lives <= 0) { state.over = true; setTimeout(showFail, 500); }
        syncUI(); requestRender();
      }, CAST_FADE);
    }, CAST_GROW);
  }

  function next() {
    if (!state.revealed || scene) return;
    if (!FREE && state.sealed >= R.catchesTotal) { showClear(); return; }
    if (!FREE && state.phase === 1 && state.sealed >= R.catchesTwoMirrors) { showBreak(); return; }
    newGhost();
    setStatus(MSG.moved + (state.phase === 2 ? MSG.startOne : MSG.start));
    syncUI(); requestRender();
  }

  var audioCtx = null;
  // 抓錯時的短笑聲：單聲道、沒有方向，不能拿來定位
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

  function syncUI() {
    var hearts = $('hearts').children, i;
    for (i = 0; i < hearts.length; i++) hearts[i].className = i < state.lives ? '' : 'lost';
    $('hearts').setAttribute('aria-label', '剩下 ' + state.lives + ' 條命');
    $('sealCount').textContent = '封印 ' + state.sealed + '／' + R.catchesTotal;
    $('hud').hidden = FREE;
    $('castBtn').hidden = state.revealed;
    $('castBtn').disabled = !state.selected || !canAct();
    $('nextBtn').hidden = !state.revealed;
    $('nextBtn').textContent = FREE ? '換一個位置 ➜' : state.sealed >= R.catchesTotal ? '過關 ➜' : '繼續 ➜';
    $('freeTools').hidden = !FREE;
    $('debugPanel').hidden = !state.debug;
    $('debugBtn').classList.toggle('on', state.debug);
    $('debugBtn').setAttribute('aria-pressed', String(state.debug));
  }

  // ---------- 關卡流程（過場都用共用的 StoryScene） ----------
  function closeScene() { if (scene) { scene.close(); scene = null; } }
  function resetLevel() {
    state.phase = 1; state.lives = R.lives; state.sealed = 0; state.over = false; state.fx = null;
    history = [];
    newGhost();
    setStatus(MSG.start);
    syncUI(); requestRender();
  }
  function showIntro() {
    scene = window.StoryScene.show({
      id: 'intro', background: 'assets/room-intact.jpg',
      lines: [
        { text: '你受邀到一座古老的城堡過夜。' },
        { text: '半夜，有一間房間不斷傳出奇怪的聲響。' },
        { speaker: '你', text: '房間裡……明明沒有人啊？' },
        { speaker: '你', text: '等等，鏡子裡有東西！' }
      ],
      title: '第一關：鏡子房間',
      note: '鬼只有在鏡子裡才看得到。從鏡中的像推出牠真正站在哪一格，再展開封印法陣。3 條命，要抓到牠 ' + R.catchesTotal + ' 次；抓錯會失去一顆心。',
      buttons: [{ id: 'startBtn', label: '開始抓鬼', primary: true, onClick: function () { closeScene(); syncUI(); requestRender(); } }]
    });
  }
  function showBreak() {
    scene = window.StoryScene.show({
      id: 'break', background: 'assets/room-broken.jpg',
      lines: [
        { text: '鬼被抓了兩次，氣得撞向右邊的鏡子——' },
        { text: '匡啷！鏡子碎了一地。' },
        { speaker: '你', text: '只剩一面鏡子了……' }
      ],
      title: '鏡子被打碎了',
      note: '只剩正面那面鏡子。再抓到牠 ' + (R.catchesTotal - R.catchesTwoMirrors) + ' 次。',
      buttons: [{ id: 'resumeBtn', label: '繼續抓鬼', primary: true, onClick: function () {
        closeScene();
        state.phase = 2; state.fx = { t0: performance.now() };
        newGhost(); setStatus(MSG.startOne); syncUI(); requestRender();
      } }]
    });
  }
  function showFail() {
    scene = window.StoryScene.show({
      id: 'fail', background: state.phase === 1 ? 'assets/room-intact.jpg' : 'assets/room-broken.jpg',
      title: '封印失敗', note: '三顆心都用完了……鬼還躲在房間裡。',
      buttons: [
        { id: 'retryBtn', label: '重新挑戰', primary: true, onClick: function () { closeScene(); resetLevel(); } },
        { id: 'failMenuBtn', label: '回關卡選單', href: '../index.html' }
      ]
    });
  }
  function showClear() {
    scene = window.StoryScene.show({
      id: 'clear', background: 'assets/room-broken.jpg', scatter: 1,
      lines: [
        { text: '鬼被抓了五次，再也待不住了——' },
        { text: '牠尖叫著衝出房門，逃進了走廊！' },
        { speaker: '你', text: '別跑！' }
      ],
      title: '第一關過關！', note: '鬼逃進了走廊。下一關：城堡走廊。',
      buttons: [
        { id: 'toLevel2Btn', label: '前往第二關 ➜', primary: true, href: '../convex-lens/index.html' },
        { id: 'againBtn', label: '再玩一次', onClick: function () { closeScene(); resetLevel(); } },
        { id: 'clearMenuBtn', label: '回關卡選單', href: '../index.html' }
      ]
    });
  }

  // ---------- 自由練習用的工具 ----------
  function fillCellSel() {
    var sel = $('cellSel');
    sel.innerHTML = '';
    var o = document.createElement('option'); o.value = ''; o.textContent = '鬼的位置：隨機'; sel.appendChild(o);
    POOLS[state.phase].forEach(function (c) {
      o = document.createElement('option'); o.value = c.col + ',' + c.row;
      o.textContent = '第 ' + c.col + ' 欄・第 ' + c.row + ' 排（' + C.cellId(c.col, c.row) + '）';
      sel.appendChild(o);
    });
  }
  $('phaseSel').addEventListener('change', function () {
    state.phase = Number(this.value); state.forced = null; fillCellSel(); newGhost();
    setStatus(state.phase === 2 ? MSG.startOne : MSG.start); syncUI(); requestRender();
  });
  $('cellSel').addEventListener('change', function () {
    var v = this.value.split(',');
    state.forced = this.value ? { col: Number(v[0]), row: Number(v[1]) } : null;
    newGhost(); setStatus(state.phase === 2 ? MSG.startOne : MSG.start); syncUI(); requestRender();
  });
  $('debugBtn').addEventListener('click', function () { state.debug = !state.debug; syncUI(); requestRender(); });
  $('zoomIn').addEventListener('click', function () { setZoom(view.zoom + 1); });
  $('zoomOut').addEventListener('click', function () { setZoom(view.zoom - 1); });
  $('zoomFit').addEventListener('click', function () { setZoom(0); });
  $('castBtn').addEventListener('click', cast);
  $('nextBtn').addEventListener('click', next);

  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe($('stage'));

  // 測試／開發用掛鉤（不是學生 UI）
  window.__protoMirror = {
    state: state, stats: stats, room: R, core: C, cam: cam, FREE: FREE, pools: POOLS, selectable: SELECTABLE, GHOST_COLOR: GHOST_COLOR,
    intactMirrors: intactMirrors, render: render,
    scene: function () { return scene ? scene.info() : null; },
    art: function () { return { intact: ART.intact.ready, broken: ART.broken.ready }; },
    canvasInfo: function () { return { W: W, H: H, DPR: DPR, S: S, OX: OX, OY: OY, zoom: ZOOMS[view.zoom] }; },
    // 影像座標 → 網頁座標（測試用來算該點哪裡）
    toClient: function (p) { var r = canvas.getBoundingClientRect(); return { x: r.left + OX + p.x * S, y: r.top + OY + p.y * S }; },
    cellClient: function (col, row) { return this.toClient(C.project(cam, C.cellCenter(col, row))); },
    glassPoly: function (id) { return glassScreen(id); },
    setGhost: function (col, row) { state.forced = { col: col, row: row }; newGhost(); state.forced = null; syncUI(); render(); }
  };

  if (FREE) { $('title').innerHTML = '平面鏡原型 <small>自由練習</small>'; fillCellSel(); }
  layout();
  resetLevel();
  if (!FREE) showIntro();
})();

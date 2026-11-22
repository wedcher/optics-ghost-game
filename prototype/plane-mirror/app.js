/*
 * 第一關：平面鏡房間。
 *
 * 畫面 = 背景圖（牆、鏡框、燈、窗）＋ 程式畫的地板 ＋ 程式畫的鏡中畫面。
 * 鏡中畫面不是貼圖：把整個房間對鏡面鏡射後，透過鏡面那個洞再畫一次（鏡中鏡畫到第二層）。
 * 幾何全部在 ../shared/mirror-core.js；這個檔只管畫面、操作與關卡流程。
 *
 * 預設是關卡模式：開場 → 兩面鏡抓 2 次 → 鬼打碎右邊的鏡子 → 一面鏡再抓 3 次 → 過關。3 條命整關共用。
 * 第一次點地板時插一段「丟圓盤」：對話 → 鏘 → 直接在那一格展開法陣 → 結果出來後再一段對話（只在第一次）。
 * 劇本以使用者的 Google 文件《光學抓鬼遊戲 劇本初稿》為準（見 docs/story-and-flow.md「劇本修訂」）。
 * 網址加 ?free=1 是自由練習（開發用）：沒有過場、不計命，可指定鏡子數與鬼的位置、開 Debug。
 */
(function () {
  'use strict';
  var C = window.MirrorCore, R = window.MirrorRoom, cam = C.makeCamera(R.camera);
  var $ = function (id) { return document.getElementById(id); };
  var FREE = /[?&]free=1/.test(location.search);
  // ?practice=1 練習模式（選單「第一關：練習模式」）：照關卡規則、扣命，但不計時、不上排行、不播開場與丟圓盤過場。
  var PRACTICE = !FREE && /[?&]practice=1/.test(location.search);
  var LB = PRACTICE ? null : window.Leaderboard;
  var GHOST_COLOR = '#9dffd8';
  var IW = R.image.w, IH = R.image.h;

  var canvas = $('view'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1, S = 1, OX = 0, OY = 0; // 影像座標 → 畫布：x·S + OX
  var FS = 1; // 畫布文字的放大倍率：畫布短邊小（手機）時放大 1.25 倍，標準和凸、凹透鏡一致（見 layout）

  // 圖用 crossOrigin='anonymous' 載入：試玩網址（raw.githack）會把圖轉到別的網域，沒有這個設定畫布會被「污染」，
  // 過場背景的快照（toDataURL）就會丟錯、退回背景原圖——原圖的鏡面是暗的，過場裡鏡子變黑（使用者 2026-11-21）。
  // 伺服器不給 CORS 標頭導致載入失敗時，退回不帶 crossOrigin 重載（至少圖還在，快照再退回原圖）。
  function loadArt(src) {
    var a = { img: null, ready: false }, retried = false;
    function start(cors) {
      var im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.onload = function () { a.ready = true; requestRender(); if (pendingIntro && introReady()) { pendingIntro = false; showIntro(); } };
      im.onerror = function () {
        if (cors && !retried) { retried = true; start(false); return; }
        a.failed = true; if (pendingIntro && introReady()) { pendingIntro = false; showIntro(); } // 圖載不到：照樣開始（地磚退回程式畫的）
      };
      a.img = im; im.src = src;
    }
    start(true);
    return a;
  }
  var pendingIntro = false; // 開場要等圖都載好才出現（背景是遊戲畫面的快照）
  function artReady() { return ART.intact.ready && ART.broken.ready && ART.ghost.ready && ART.ghostBack.ready && (typeof floorTex === "undefined" || floorTex.ready || floorTex.failed); }
  // 開場第一幕是古堡圖：等它也載好才開始，免得先看到黑畫面再跳出古堡（使用者 2026-11-21）
  function introReady() { return artReady() && (!ART.castle || ART.castle.ready || ART.castle.failed); }
  var ART = { intact: loadArt('assets/room-intact.jpg'), broken: loadArt('assets/room-broken.jpg'), ghost: loadArt('assets/ghost.webp'), ghostBack: loadArt('assets/ghost-back.webp'),
    castle: (!FREE && !PRACTICE && window.StoryArt) ? loadArt(window.StoryArt.get('castle')) : null };
  // 測試用：把鬼畫成單一顏色的剪影，測試才能用顏色數「鬼出現在哪裡」（見 __protoMirror.setMask）
  var ghostMask = {};
  function maskImage(key) {
    if (!ghostMask[key] && ART[key].ready) {
      var cv = ghostMask[key] = document.createElement('canvas');
      cv.width = ART[key].img.width; cv.height = ART[key].img.height;
      var m = cv.getContext('2d');
      m.drawImage(ART[key].img, 0, 0);
      m.globalCompositeOperation = 'source-in'; m.fillStyle = GHOST_COLOR; m.fillRect(0, 0, cv.width, cv.height);
    }
    return ghostMask[key];
  }

  // ---------- 狀態 ----------
  // 出題格（使用者 2026-11-18 試玩回饋 M8、M9）：關卡模式第 1、2 次（兩面鏡）只出在 R.twoMirrorCells 那三格，
  // 第 3～5 次（單面鏡）避開那三格。兩組都還要通過幾何檢查（鏡中看得到），tests/check-geometry-mirror.js 驗證。
  // 自由練習（?free=1）不受這個限制，方便看所有格子。
  function inList(list, c) { return list.some(function (d) { return sameCell(d, c); }); }
  var GEO_POOLS = { 1: C.eligibleCells(R, cam, ['back', 'right']), 2: C.eligibleCells(R, cam, ['back']) };
  var POOLS = FREE ? GEO_POOLS : {
    1: GEO_POOLS[1].filter(function (c) { return inList(R.twoMirrorCells, c); }),
    2: GEO_POOLS[2].filter(function (c) { return !inList(R.twoMirrorCells, c); })
  };
  var SELECTABLE = C.selectableCells(R, cam);
  var state = {
    phase: 1,          // 1 = 兩面鏡；2 = 右邊的鏡子被打碎，只剩正面那面
    ghost: null,       // {col,row} 鬼真正的位置
    selected: null,    // 玩家選的格子
    revealed: false,   // 這一次已經抓到（鬼現身）
    cast: null,        // 進行中的法陣 {cell, t0, ok}
    busy: false,
    lives: R.lives, sealed: 0, over: false,
    debug: false, fx: null, forced: null, mask: false
  };
  var stats = { casts: 0, wrong: 0, mirrorTaps: 0, pans: 0, sides: {}, ghostRevealed: false, images: { back: false, right: false }, lastPick: null };
  var scene = null, history = [];
  var discTaught = FREE || PRACTICE; // 「丟圓盤」那段只播一次（重新挑戰、再玩一次都不再播）；自由練習不播
  var throwing = false;  // 這次施放是第一次丟圓盤：結果出來後要接後段對話

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
    state.selected = null; state.revealed = false; state.revealAt = 0; state.cast = null; state.busy = false;
    stats.ghostRevealed = false;
  }

  // ---------- 版面 ----------
  function layout() {
    var r = GameLandscape.size($('stage')); // 手機直拿時整個遊戲轉 90°：用遊戲方向的寬高（shared/landscape.js）
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    FS = Math.min(W, H) < 420 ? 1.25 : 1;
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
    var k = ZOOMS[view.zoom] / old;
    // 左右以畫面中央為準；上下以「鏡子底邊附近」（圖高的 72%）為準，放大後地板和鏡子下半才不會跑出畫面
    var sOld = Math.min(W / IW, H / IH) * old;
    view.panX *= k;
    view.panY -= (IH * 0.72 - IH / 2) * sOld * (k - 1);
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
    // 壁燈
    R.lamps.forEach(function (l) {
      var s = proj(T, l);
      if (!s) return;
      var r = 0.9 * cam.f / s.depth, g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, 'rgba(255,190,110,.75)'); g.addColorStop(0.12, 'rgba(255,150,70,.38)'); g.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = g; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    });
  }

  // ---------- 地磚貼圖（使用者 2026-11-20 給的 docs/concepts/地磚.png，一格貼一張） ----------
  // 透視貼圖：每格切成 n×n 小塊、每塊兩個三角形用仿射變換貼（canvas 沒有透視貼圖）。
  // 地板不會動，所以每個視角（直接看、各面鏡子、鏡中鏡）只算一次，存成影像座標大小的圖層。
  // 把貼圖 img 上的三角形 (u,v) 仿射到 g 畫面上的三角形 p；邊緣外擴 0.6 px 免得接縫露出細線
  function affineTri(g, img, p0, p1, p2, u0, v0, u1, v1, u2, v2) {
      var cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3;
      g.save(); g.beginPath();
      [p0, p1, p2].forEach(function (q, k) { var dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1, x = q.x + dx / l * 0.6, y = q.y + dy / l * 0.6; if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath(); g.clip();
      var d = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
      if (Math.abs(d) < 1e-9) { g.restore(); return; }
      var a = (p0.x * (v1 - v2) + p1.x * (v2 - v0) + p2.x * (v0 - v1)) / d,
          b = (p0.y * (v1 - v2) + p1.y * (v2 - v0) + p2.y * (v0 - v1)) / d,
          c = (p0.x * (u2 - u1) + p1.x * (u0 - u2) + p2.x * (u1 - u0)) / d,
          e = (p0.y * (u2 - u1) + p1.y * (u0 - u2) + p2.y * (u1 - u0)) / d,
          f = (p0.x * (u1 * v2 - u2 * v1) + p1.x * (u2 * v0 - u0 * v2) + p2.x * (u0 * v1 - u1 * v0)) / d,
          h = (p0.y * (u1 * v2 - u2 * v1) + p1.y * (u2 * v0 - u0 * v2) + p2.y * (u0 * v1 - u1 * v0)) / d;
      g.setTransform(a, b, c, e, f, h); g.drawImage(img, 0, 0); g.restore();
  }
  function viewKey(T) { return [T.sx, T.sz, T.ox, T.oz].map(function (n) { return Math.round((n || 0) * 1000); }).join(','); }
  var floorTex = loadArt('assets/floor-tile.webp'), floorCache = {};
  function floorLayer(T) {
    if (!floorTex.ready) return null;
    var key = viewKey(T);
    if (floorCache[key]) return floorCache[key];
    var cv = document.createElement('canvas'); cv.width = IW; cv.height = IH;
    var g = cv.getContext('2d'), img = floorTex.img, TW = img.width, TH = img.height;
    function tri(p0, p1, p2, u0, v0, u1, v1, u2, v2) { affineTri(g, img, p0, p1, p2, u0, v0, u1, v1, u2, v2); }
    for (var row = 1; row <= R.length; row++) for (var col = 1; col <= R.cols; col++) {
      var corners = [proj(T, { x: col - 1, y: 0, z: row - 1 }), proj(T, { x: col, y: 0, z: row - 1 }), proj(T, { x: col, y: 0, z: row }), proj(T, { x: col - 1, y: 0, z: row })];
      var size = 0;
      corners.forEach(function (q, k) { var r = corners[(k + 1) % 4]; if (q && r) size = Math.max(size, Math.hypot(q.x - r.x, q.y - r.y)); });
      if (!size) continue;
      var n = Math.max(1, Math.min(10, Math.ceil(size / 45))), P = [], i, j;
      for (j = 0; j <= n; j++) { P.push([]); for (i = 0; i <= n; i++) P[j].push(proj(T, { x: col - 1 + i / n, y: 0, z: row - 1 + j / n })); }
      for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
        var a00 = P[j][i], a10 = P[j][i + 1], a01 = P[j + 1][i], a11 = P[j + 1][i + 1];
        var u0 = i / n * TW, u1 = (i + 1) / n * TW, w0 = j / n * TH, w1 = (j + 1) / n * TH;
        if (a00 && a10 && a01) tri(a00, a10, a01, u0, w0, u1, w0, u0, w1);
        if (a10 && a11 && a01) tri(a10, a11, a01, u1, w0, u1, w1, u0, w1);
      }
      // 西洋棋盤：隔一格壓暗一點，鏡子裡的格子很小時比較好數
      if ((col + row) % 2 === 0) {
        var poly = projPoly(T, C.cellPoly(col, row));
        if (poly.length >= 3) { g.beginPath(); poly.forEach(function (q, k) { if (k) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); g.closePath(); g.fillStyle = 'rgba(0,0,0,.22)'; g.fill(); }
      }
    }
    floorCache[key] = cv;
    return cv;
  }
  function drawFloor(T) {
    var outline = projPoly(T, [{ x: 0, y: 0, z: 0 }, { x: R.cols, y: 0, z: 0 }, { x: R.cols, y: 0, z: R.length }, { x: 0, y: 0, z: R.length }]);
    if (outline.length < 3) return;
    ctx.save();
    path(outline); ctx.clip();
    var col, row, p, v;
    var layer = floorLayer(T);
    if (layer) {
      // 正式地磚貼圖（每個視角算一次後快取；圖已經是影像座標）
      ctx.drawImage(layer, 0, 0, IW, IH);
    } else for (row = R.length; row >= 1; row--) for (col = 1; col <= R.cols; col++) {
      p = projPoly(T, C.cellPoly(col, row));
      if (p.length < 3) continue;
      // 兩種深淺交錯（西洋棋盤）：鏡子裡的格子很小，交錯的顏色比較好數
      v = hash(col, row) * 5 + ((col + row) % 2 ? 0 : 23);
      fillPoly(p, 'rgb(' + Math.round(39 + v) + ',' + Math.round(36 + v * 0.93) + ',' + Math.round(37 + v * 0.9) + ')');
    }
    // 燈光在地板上的暖色光暈（只是氣氛）
    R.lamps.forEach(function (l) {
      var s = proj(T, { x: Math.max(0.6, Math.min(R.cols - 0.6, l.x)), y: 0, z: Math.max(0.6, l.z) });
      if (!s) return;
      var r = 1.7 * cam.f / s.depth;
      ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1, 0.34);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,160,80,.30)'); g.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    });
    // 格線（地磚的縫）。每條線分段畫，線寬依遠近變化。
    // 有地磚貼圖時格線改成和磚邊一樣的銅色、細一點，石紋才看得到；格線仍要清楚，數格子靠它
    ctx.strokeStyle = layer ? 'rgba(176,128,92,.7)' : 'rgba(205,176,142,.72)'; ctx.lineCap = 'round';
    function seam(a, b) {
      var s = projPoly(T, [a, b]);
      if (s.length < 2) return;
      ctx.lineWidth = Math.max(1, Math.min(layer ? 4.5 : 7, (layer ? 17 : 26) / ((s[0].depth + s[1].depth) / 2)));
      ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
    }
    var i, j;
    for (i = 0; i <= R.cols; i++) for (j = 0; j < R.length; j++) seam({ x: i, y: 0, z: j }, { x: i, y: 0, z: j + 1 });
    for (j = 0; j <= R.length; j++) for (i = 0; i < R.cols; i++) seam({ x: i, y: 0, z: j }, { x: i + 1, y: 0, z: j });
    // 鏡子打碎後散在地上的碎片
    if (state.phase === 2) {
      for (i = 0; i < 16; i++) {
        var sx = R.cols - 0.08 - hash(i, 3) * 0.75, sz = R.shards.z0 + hash(i, 7) * (R.shards.z1 - R.shards.z0), e = 0.03 + hash(i, 11) * 0.05, an = hash(i, 5) * 6.28;
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
  // 鬼：女鬼圖（已在裙襬切平，底邊就是地板）。圖還沒載入時先畫一個簡單的形狀。
  // 鬼面向玩家（朝 +z）。back = true 時畫牠的背面：背面圖已經先左右翻轉過，
  // 所以貼在同一片人形上時，牠舉起的手和正面圖在同一側（從鏡子裡看到的背影就是這樣）。
  function ghostPainter(alpha, back) {
    return function () {
      ctx.globalAlpha *= alpha;
      var key = back ? 'ghostBack' : 'ghost';
      var img = state.mask ? maskImage(key) : (ART[key].ready ? ART[key].img : null);
      if (img) { ctx.drawImage(img, 0, 0, 1, 1); return; }
      ctx.fillStyle = GHOST_COLOR;
      ctx.beginPath();
      ctx.moveTo(0.2, 1); ctx.lineTo(0.3, 0.3); ctx.bezierCurveTo(0.3, 0, 0.7, 0, 0.7, 0.3); ctx.lineTo(0.8, 1);
      ctx.closePath(); ctx.fill();
    };
  }
  // 從目前的視點（經過鏡射 T 之後）看到的是鬼的正面還是背面。
  // 鬼朝 R.ghost.facing·z（-1 = 面向正面的鏡子、背對玩家；使用者 2026-11-19：正面鏡裡看到正面、抓到的本體是背面）；
  // 鏡射後牠的朝向變成 (0, 0, facing·T.sz)。視點在牠朝向的那一側就是正面。
  function seesBack(T) {
    var c = C.apply(T, C.cellCenter(state.ghost.col, state.ghost.row));
    return (cam.eye.z - c.z) * T.sz * R.ghost.facing < 0;
  }
  // 鬼從地板冒出來的地方：格子中央一圈暗色的漩渦。有了它才看得出牠站在哪一格。
  // part = 'under'：畫在鬼的後面（整圈）；'over'：只畫靠近玩家的半圈邊，蓋在裙襬上。
  function drawPool(T, cell, part, alpha) {
    var c = C.cellCenter(cell.col, cell.row), r = R.ghost.poolRadius, pts = [], i, s, n = 36;
    var mid = proj(T, c);
    if (!mid) return;
    for (i = 0; i < n; i++) {
      s = proj(T, { x: c.x + Math.cos(i / n * 6.2832) * r, y: 0, z: c.z + Math.sin(i / n * 6.2832) * r });
      if (!s) return;
      pts.push(s);
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = state.mask ? GHOST_COLOR : 'rgba(214,228,255,.95)';
    ctx.lineWidth = Math.max(2, Math.min(7, 34 / mid.depth));
    if (part === 'under') {
      path(pts); ctx.fillStyle = state.mask ? GHOST_COLOR : 'rgba(6,8,20,.82)'; ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath();
      var started = false;
      for (i = 0; i <= n; i++) {
        s = pts[i % n];
        if (s.depth < mid.depth) { if (started) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); started = true; } }
        else started = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawGhost(T, alpha) {
    drawPool(T, state.ghost, 'under', alpha);
    var back = seesBack(T);
    if (T === C.IDENTITY) stats.sides.direct = back ? 'back' : 'front';
    drawSprite(T, C.ghostQuad(R, state.ghost), ghostPainter(alpha, back));
    drawPool(T, state.ghost, 'over', alpha);
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
      else drawBrokenGlass(p, T);
      path(p); ctx.strokeStyle = '#b8873a'; ctx.lineWidth = Math.max(2, 26 / avgDepth(p) * 2.2); ctx.lineJoin = 'round'; ctx.stroke();
    });
    // 人形：遠的先畫
    var sprites = [{ quad: playerQuad(), draw: function () { drawSprite(T, playerQuad(), playerPainter); } }];
    if (state.ghost) sprites.push({ quad: C.ghostQuad(R, state.ghost), draw: function () { drawGhost(T, state.revealed ? ghostFade : 0.95); } }); // 封印後跟著本體一起淡出（物理：像是本體反射的光）
    sprites.forEach(function (s) { var q = proj(T, s.quad.bl); s.d = q ? q.depth : -1; });
    sprites.sort(function (a, b) { return b.d - a.d; });
    sprites.forEach(function (s) { if (s.d > 0) s.draw(); });
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
  // 鏡子裡映出的那面碎鏡子（使用者 2026-11-20）：用背景圖 room-broken.jpg 裡畫好的碎玻璃，照鏡射貼進鏡中。
  // 碎鏡面上取格點：每點在「直接看」的畫面（proj(IDENTITY)）的位置當貼圖座標，在這個鏡射視角（proj(T)）的位置當目的地，
  // 分塊仿射貼（和地磚同一招），所以形狀、透視都照鏡射算。直接看時超出圖右緣的那段沒有圖可貼，維持暗色。
  var brokenCache = {};
  function brokenGlassLayer(T) {
    if (!ART.broken.ready) return null;
    var key = viewKey(T);
    if (brokenCache[key]) return brokenCache[key];
    var m = R.mirrors[R.breaks], gl = m.glass, img = ART.broken.img, sx = img.width / IW, sy = img.height / IH;
    var cv = document.createElement('canvas'); cv.width = IW; cv.height = IH;
    var g = cv.getContext('2d'), NT = 40, NY = 16, P = [], i, j, drawn = 0;
    function pt(t, y) { return m.axis === 'z' ? { x: t, y: y, z: m.value } : { x: m.value, y: y, z: t }; }
    for (j = 0; j <= NY; j++) {
      P.push([]);
      for (i = 0; i <= NT; i++) {
        var t = gl.a + (gl.b - gl.a) * i / NT, top = gl.topA + (gl.topB - gl.topA) * i / NT, q = pt(t, R.paintedBottom + (top - R.paintedBottom) * j / NY);
        var src = proj(C.IDENTITY, q), dst = proj(T, q);
        P[j].push(src && dst ? { s: src, d: dst, inImg: src.x >= 0 && src.x <= IW && src.y >= 0 && src.y <= IH } : null);
      }
    }
    // 直接看時超出圖右緣的那段：用碎鏡圖右緣附近的顏色填（使用者 2026-11-20）。
    // 每一列格點找它在圖右緣的高度，取那附近一小塊的平均色；相鄰兩列的平均色填那一列的格子，看起來是上下漸變的暗玻璃。
    var edgeCol = [], sample = null;
    try {
      var sc = document.createElement('canvas'); sc.width = IW; sc.height = IH;
      var sg = sc.getContext('2d'); sg.drawImage(img, 0, 0, IW, IH); sample = sg;
    } catch (e) { sample = null; }
    for (j = 0; j <= NY; j++) {
      var last = null;
      for (i = 0; i <= NT; i++) if (P[j][i] && P[j][i].inImg) last = P[j][i];
      var col = [7, 7, 11];
      if (last && sample) {
        try {
          var d = sample.getImageData(IW - 24, Math.max(0, Math.min(IH - 14, Math.round(last.s.y) - 7)), 20, 14).data, rr = 0, gg = 0, bb = 0, n = 0;
          for (var k = 0; k < d.length; k += 4) { rr += d[k]; gg += d[k + 1]; bb += d[k + 2]; n++; }
          col = [rr / n, gg / n, bb / n];
        } catch (e) { /* 讀不到像素就維持暗色 */ }
      }
      edgeCol.push(col);
    }
    function fillOut(a, b, c, j) {
      var c0 = edgeCol[j], c1 = edgeCol[j + 1];
      var st = 'rgb(' + Math.round((c0[0] + c1[0]) / 2) + ',' + Math.round((c0[1] + c1[1]) / 2) + ',' + Math.round((c0[2] + c1[2]) / 2) + ')';
      g.beginPath(); g.moveTo(a.d.x, a.d.y); g.lineTo(b.d.x, b.d.y); g.lineTo(c.d.x, c.d.y); g.closePath();
      g.fillStyle = st; g.fill(); g.strokeStyle = st; g.lineWidth = 1; g.stroke(); // 描邊蓋掉三角形之間的細縫
      stats.brokenFilled = (stats.brokenFilled || 0) + 1;
    }
    function tri(a, b, c, j) {
      if (!a || !b || !c) return;
      if (!a.inImg || !b.inImg || !c.inImg) { fillOut(a, b, c, j); return; }
      affineTri(g, img, a.d, b.d, c.d, a.s.x * sx, a.s.y * sy, b.s.x * sx, b.s.y * sy, c.s.x * sx, c.s.y * sy);
      drawn++;
    }
    for (j = 0; j < NY; j++) for (i = 0; i < NT; i++) {
      tri(P[j][i], P[j][i + 1], P[j + 1][i], j);
      tri(P[j][i + 1], P[j + 1][i + 1], P[j + 1][i], j);
    }
    stats.brokenTris = drawn;
    brokenCache[key] = cv;
    return cv;
  }
  function drawBrokenGlass(p, T) {
    fillPoly(p, '#07070b');
    var layer = T && brokenGlassLayer(T);
    if (layer) {
      ctx.save(); path(p); ctx.clip(); ctx.drawImage(layer, 0, 0, IW, IH); ctx.restore();
      stats.brokenTextured = true;
      return;
    }
    var b = bounds(p), cx = b.x0 + (b.x1 - b.x0) * 0.62, cy = b.y0 + (b.y1 - b.y0) * 0.5, i;
    ctx.save(); path(p); ctx.clip();
    ctx.strokeStyle = 'rgba(210,220,235,.5)'; ctx.lineWidth = 1;
    for (i = 0; i < 11; i++) {
      var an = i * 0.571 + hash(i, 2) * 0.3, len = (b.x1 - b.x0 + b.y1 - b.y0);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len); ctx.stroke();
    }
    ctx.restore();
  }
  // 鏡子底邊的金色門檻：一條貼在地板上、有寬度的金框，分清楚鏡內與鏡外。
  // 畫成地板上的長條再投影，所以近的地方粗、遠的地方細；寬度以鏡面為中線、鏡內鏡外各一半。
  // 鏡子底下的金色底框：立體的（有高度、有厚度），立在鏡面前緣，會擋住鏡中最下面一小段。
  // 使用者 2026-11-18 回饋 M10：原本的細黃線太細，要粗一點的鏡框；因為框往上立起一點，
  // 鏡子裡最靠牆那半格可能被擋到一點點，使用者接受（出題格是固定的，不重算）。
  // 只是畫面上的遮擋，鏡面範圍（configs.js 的 glass.bottom）與答案都不變。
  var FRAME_H = 0.06, FRAME_D = 0.08; // 底框高度、厚度（格）；使用者 2026-11-18 從 0.06～0.35 五種比較圖選了最薄的 0.06
  function drawBaseBar(id) {
    var m = R.mirrors[id], g = m.glass, inward = m.axis === 'z' ? 1 : -1; // 房間在鏡面哪一側：正面鏡 +z、右鏡 -x
    function pt(t, y, d) { // t：沿鏡面方向；y：高度；d：離鏡面往房間的距離
      return m.axis === 'z' ? { x: t, y: y, z: m.value + inward * d } : { x: m.value + inward * d, y: y, z: t };
    }
    var top = C.projectPoly(cam, [pt(g.a, FRAME_H, 0), pt(g.b, FRAME_H, 0), pt(g.b, FRAME_H, FRAME_D), pt(g.a, FRAME_H, FRAME_D)]);
    var front = C.projectPoly(cam, [pt(g.a, FRAME_H, FRAME_D), pt(g.b, FRAME_H, FRAME_D), pt(g.b, 0, FRAME_D), pt(g.a, 0, FRAME_D)]);
    var edge = C.projectPoly(cam, [pt(g.a, FRAME_H, FRAME_D), pt(g.b, FRAME_H, FRAME_D)]);
    var groove = C.projectPoly(cam, [pt(g.a, FRAME_H * 0.5, FRAME_D), pt(g.b, FRAME_H * 0.5, FRAME_D)]);
    ctx.lineJoin = 'round';
    if (front.length >= 3) { // 正面（面向玩家，較暗）
      path(front);
      var ys = front.map(function (q) { return q.y; }), grad = ctx.createLinearGradient(0, Math.min.apply(null, ys), 0, Math.max.apply(null, ys));
      grad.addColorStop(0, '#c99a45'); grad.addColorStop(1, '#6e4a17');
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = '#3e280a'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (top.length >= 3) { // 頂面（受光，較亮）
      path(top); ctx.fillStyle = '#e6bb62'; ctx.fill();
      ctx.strokeStyle = '#5a3d12'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (groove.length >= 2) { // 正面的一道雕刻線
      ctx.strokeStyle = 'rgba(255,226,160,.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(groove[0].x, groove[0].y); ctx.lineTo(groove[1].x, groove[1].y); ctx.stroke();
    }
    if (edge.length >= 2) { // 稜線高光
      ctx.strokeStyle = '#ffe2a0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(edge[0].x, edge[0].y); ctx.lineTo(edge[1].x, edge[1].y); ctx.stroke();
    }
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
  var ghostFade = 1; // 封印後鬼（本體＋鏡中的像）的透明度
  function render() {
    var now = performance.now(), animating = false;
    ghostFade = state.revealed && state.revealAt && window.SealFx ? window.SealFx.ghostAlpha((now - state.revealAt) / 1000) : 1;
    stats.brokenTextured = false;
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
      drawBaseBar(id);
    });
    if (state.phase === 2 && R.brokenDarken > 0) fillPoly(R.brokenGlassPx, 'rgba(5,5,10,' + R.brokenDarken + ')'); // 圖裡碎鏡若有畫死的反射：壓暗
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
    if (state.revealed && state.ghost) {
      // 封印特效（使用者 2026-11-21）：紫色螺旋往上纏繞女鬼，收緊後女鬼與鏡中的像一起淡出
      var gq = C.cellCenter(state.ghost.col, state.ghost.row), gt = (now - (state.revealAt || now)) / 1000;
      var fx = window.SealFx && { cx: gq.x, cz: gq.z, r: 0.5, h: R.ghost.height * 1.15, line: 2.6 / S, glow: 10 * DPR,
        project: function (x, y, z) { return C.project(cam, { x: x, y: y, z: z }); } };
      if (fx) window.SealFx.draw(ctx, fx, gt, 'back');
      drawGhost(C.IDENTITY, ghostFade);
      if (fx && window.SealFx.draw(ctx, fx, gt, 'front')) animating = true;
    }

    if (state.debug) drawDebug();
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flash.toFixed(3) + ')'; ctx.fillRect(0, 0, IW, IH); }
    ctx.restore();
    if (animating) requestRender();
  }

  function drawDebug() {
    ctx.save();
    // 格號：螢幕上至少 12 px，小螢幕再乘 FS（畫在影像座標裡，所以要除以縮放 S）
    var labelCss = Math.max(12, 22 * S) * FS, labelPx = labelCss / S;
    stats.labelCss = labelCss;
    ctx.lineWidth = 2; ctx.font = Math.round(labelPx) + 'px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#00e5ff';
    ['back', 'right', 'left'].forEach(function (id) { var p = C.projectPoly(cam, WALLS[id]); if (p.length > 2) { path(p); ctx.stroke(); } });
    ctx.strokeStyle = '#ff5fd2';
    Object.keys(R.mirrors).forEach(function (id) { path(glassScreen(id)); ctx.stroke(); });
    SELECTABLE.forEach(function (c) {
      var s = C.project(cam, C.cellCenter(c.col, c.row));
      var inPool = POOLS[state.phase].some(function (p) { return sameCell(p, c); });
      ctx.fillStyle = inPool ? '#9dffb0' : '#6b7a70';
      ctx.fillText(C.cellId(c.col, c.row), s.x, s.y + labelPx * 0.32);
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
  // 觸控座標一律經過 GameLandscape.toLocal（手機直拿轉 90° 時 x、y 會對調）
  function toImage(e) {
    var l = GameLandscape.toLocal(e, canvas);
    return { x: (l.x - OX) / S, y: (l.y - OY) / S };
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
  function canAct() { return !state.busy && !state.revealed && !state.over && !scene && !pendingIntro; }

  var down = null, TAP_PX = 12;
  canvas.addEventListener('pointerdown', function (e) {
    if (down) return; // 第二根手指：不理會
    var l = GameLandscape.toLocal(e, canvas);
    down = { x: l.x, y: l.y, id: e.pointerId, panX: view.panX, panY: view.panY, dragged: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!down || down.id !== e.pointerId) return;
    var l = GameLandscape.toLocal(e, canvas), dx = l.x - down.x, dy = l.y - down.y;
    if (!down.dragged && Math.hypot(dx, dy) > TAP_PX) down.dragged = true;
    if (down.dragged && view.zoom > 0) { view.panX = down.panX + dx; view.panY = down.panY + dy; stats.pans++; applyView(); }
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!down || down.id !== e.pointerId) return;
    var l = GameLandscape.toLocal(e, canvas);
    var moved = down.dragged || Math.hypot(l.x - down.x, l.y - down.y) > TAP_PX;
    down = null;
    if (moved || !canAct()) return;
    var p = toImage(e), cell = cellAt(p);
    if (cell) {
      // 重複點同一格取消選取（使用者 2026-11-21；第一次也只是選格，按「就是這裡！」才播丟圓盤劇情）
      if (state.selected && sameCell(state.selected, cell)) { state.selected = null; setStatus(MSG.deselected); }
      else {
        state.selected = cell; stats.lastPick = C.cellId(cell.col, cell.row);
        setStatus(MSG.selected); pulse($('castBtn'));
      }
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
  // 拖曳時不讓瀏覽器啟動甩動（fling）：畫布本來就 touch-action:none 不捲動，但快甩放開後瀏覽器仍進入約一秒的「甩動中」，
  // 那段時間第一次點按鈕只拿去停住甩動、不算點擊（使用者手機實測：快甩畫線後按「復原」要按兩下，2026-11-22）。
  // 只擋畫布上的 touchmove；pointer 事件（畫線、平移、點格子）照常，全螢幕的進入／離開都不受影響。
  canvas.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });

  var MSG = {
    start: '鬼躲在房間裡，只有鏡子照得出牠。看鏡中的像，推出牠真正站在哪一格，再點那一格地板。',
    startOne: '只剩一面鏡子了。看鏡中的像，推出鬼真正站在哪一格，再點那一格地板。',
    selected: '選好了。想改就點別格。',
    deselected: '已取消選取。', // 封印按鈕會閃微光提醒（使用者 2026-11-21）
    mirrorTap: '鏡子裡的是像，封印不到。你看到的是鬼，還是鬼的像？請點地板的格子。',
    brokenTap: '這面鏡子已經碎了，照不出東西。',
    casting: '法陣展開中……',
    firstCast: '展開封印法陣！', // 第一次丟圓盤（M4）
    wrong: '法陣裡沒有東西……扣一❤️，請重新推算鬼的位置。',
    wrongFree: '法陣裡沒有東西。鬼還躲在原地，再看一次鏡子。',
    moved: '鬼掙脫了，換了一個地方躲。'
  };
  function setStatus(t) { $('status').textContent = t; }

  function cast() {
    if (!canAct() || !state.selected) return;
    var ok = sameCell(state.selected, state.ghost);
    state.busy = true; stats.casts++;
    state.cast = { cell: state.selected, t0: performance.now(), ok: ok };
    setStatus(throwing ? MSG.firstCast : MSG.casting);
    syncUI(); requestRender();
    setTimeout(function () {
      if (ok) {
        state.revealed = true; state.revealAt = performance.now(); stats.ghostRevealed = true; state.busy = false; state.sealed++;
        if (FREE) setStatus('抓到了！鬼就站在這一格。');
        else if (state.sealed >= R.catchesTotal) setStatus('第 ' + R.catchesTotal + ' 次抓到牠了！鬼再也待不住了……');
        else if (state.sealed === R.catchesTwoMirrors && state.phase === 1) setStatus('又抓到了！（封印 ' + state.sealed + '／' + R.catchesTotal + '）鬼氣得渾身發抖……');
        else setStatus('抓到了！（封印 ' + state.sealed + '／' + R.catchesTotal + '）可是牠正在掙脫法陣……');
        if (throwing) setTimeout(showAfterThrow, AFTER_THROW_MS); // 等抓完鬼（鬼現身）再接
      } else {
        stats.wrong++;
        giggle();
        if (!FREE) {
          state.lives--;
          $('hud').classList.remove('hit'); void $('hud').offsetWidth; $('hud').classList.add('hit');
        }
        setStatus(FREE ? MSG.wrongFree : MSG.wrong);
        if (throwing) setTimeout(showAfterThrow, AFTER_THROW_MS); // 等魔法陣亮起、確定落空再接
      }
      syncUI(); requestRender();
      if (!ok) setTimeout(function () {
        state.cast = null; state.selected = null; state.busy = false;
        if (!FREE && state.lives <= 0) { state.over = true; setTimeout(showFail, 500); }
        syncUI(); requestRender();
      }, CAST_FADE);
    }, CAST_GROW);
  }

  // 選好格子後，封印按鈕閃一下微光（使用者 2026-11-21：比多寫一句提示有效；三關一致）
  function pulse(el) {
    if (!el || !el.animate) return;
    try {
      el.animate([{ boxShadow: '0 0 0 0 rgba(255,226,140,0)' }, { boxShadow: '0 0 16px 5px rgba(255,226,140,.9)' }, { boxShadow: '0 0 0 0 rgba(255,226,140,0)' }],
        { duration: 800, iterations: 2, easing: 'ease-in-out' });
    } catch (e) { /* 不支援就不閃 */ }
  }
  // ---------- 第一次丟圓盤（按「就是這裡！」） ----------
  var AFTER_THROW_MS = 900;
  function showThrow() {
    if (LB) LB.pauseLevel(); // 關卡中的劇情過場不算趕鬼時間
    scene = window.StoryScene.show({
      id: 'throw', overlay: true,
      lines: [
        { speaker: '你', text: '我找到鬼了！……然後咧？怎麼辦啊？' },
        { speaker: '你', text: '（拿起圓盤）用這個嗎？', image: window.StoryArt.get('disc') },
        { speaker: '你', text: '丟出去嗎？阿阿阿？' }
      ],
      onDone: function () {
        scene = null; discTaught = true; throwing = true;
        if (LB) LB.resumeLevel();
        if (window.Sfx) window.Sfx.clang();
        cast(); // 圓盤落地的那一格直接出現魔法陣
      }
    });
  }
  function showAfterThrow() {
    throwing = false;
    if (scene || state.over) return;
    if (LB) LB.pauseLevel();
    scene = window.StoryScene.show({
      id: 'afterThrow', overlay: true,
      lines: [
        { speaker: '你', text: '……' },
        { speaker: '你', text: '還真的用丟的喔！？' },
        { speaker: '你', text: '它飛回來了？', image: window.StoryArt.get('disc') }
      ],
      onDone: function () { scene = null; if (LB) LB.resumeLevel(); syncUI(); requestRender(); }
    });
    syncUI();
  }

  function next() {
    if (!state.revealed || scene) return;
    if (!FREE && state.sealed >= R.catchesTotal) { showClear(); return; }
    if (!FREE && state.phase === 1 && state.sealed >= R.catchesTwoMirrors) { showBreak(); return; }
    newGhost();
    setStatus(MSG.moved);
    syncUI(); requestRender();
  }

  var audioCtx = null;
  // 鏡子碎裂聲：一聲重擊＋一串高頻碎片聲。單聲道、沒有方向（和抓錯笑聲一樣不能拿來定位）
  function shatter() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var a = audioCtx, t0 = a.currentTime, len = Math.floor(a.sampleRate * 0.9), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0), i;
      for (i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      var src = a.createBufferSource(), hp = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; hp.type = 'highpass'; hp.frequency.value = 1800;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      src.connect(hp); hp.connect(g); g.connect(a.destination); src.start(t0);
      for (i = 0; i < 9; i++) {
        var o = a.createOscillator(), og = a.createGain(), t = t0 + 0.04 + Math.random() * 0.6;
        o.type = 'sine'; o.frequency.value = 2600 + Math.random() * 3400;
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.12, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(og); og.connect(a.destination); o.start(t); o.stop(t + 0.14);
      }
    } catch (e) { /* 沒有聲音也照常 */ }
  }
  // 抓錯時的短笑聲：單聲道、沒有方向，不能拿來定位
  function giggle() {
    if (window.Sfx && window.Sfx.giggle && window.Sfx.giggle('ghost')) return; // 真的笑聲音檔（使用者 2026-11-21）；不能播才用下面的合成音
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
    $('sealCount').textContent = (PRACTICE ? '練習　' : '') + '封印 ' + state.sealed + '／' + R.catchesTotal;
    $('hud').hidden = FREE;
    $('castBtn').hidden = state.revealed;
    $('castBtn').textContent = discTaught ? '丟圓盤封印' : '就是這裡！'; // 第一次還不知道有圓盤（使用者 2026-11-21）
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
  // 過場的背景：把房間照遊戲實際的畫法畫一張（鏡子裡有反射、有鬼的像），不用背景原圖。
  // 原圖的鏡面是一片暗色（反射是程式畫的），直接當背景時「鏡子裡有東西」會對不上畫面。
  // o.phase：1 兩面鏡、2 右鏡已碎；o.ghost：鬼的位置，null = 鏡子裡沒有鬼。
  function snapshot(id, o) {
    stats.sceneBg = { id: id, phase: o.phase, ghost: !!o.ghost, snapshot: artReady() };
    if (!artReady()) return o.phase === 1 ? 'assets/room-intact.jpg' : 'assets/room-broken.jpg';
    var k = { canvas: canvas, ctx: ctx, W: W, H: H, DPR: DPR, S: S, OX: OX, OY: OY, phase: state.phase, ghost: state.ghost, selected: state.selected,
      revealed: state.revealed, cast: state.cast, fx: state.fx, debug: state.debug, mask: state.mask };
    var cv = document.createElement('canvas'), sc = 0.75, url;
    cv.width = Math.round(IW * sc); cv.height = Math.round(IH * sc);
    canvas = cv; ctx = cv.getContext('2d'); W = cv.width; H = cv.height; DPR = 1; S = sc; OX = 0; OY = 0;
    state.phase = o.phase; state.ghost = o.ghost; state.selected = null; state.revealed = false; state.cast = null; state.fx = null; state.debug = false; state.mask = false;
    try { render(); url = cv.toDataURL('image/jpeg', 0.85); } catch (e) { url = o.phase === 1 ? 'assets/room-intact.jpg' : 'assets/room-broken.jpg'; }
    canvas = k.canvas; ctx = k.ctx; W = k.W; H = k.H; DPR = k.DPR; S = k.S; OX = k.OX; OY = k.OY;
    state.phase = k.phase; state.ghost = k.ghost; state.selected = k.selected; state.revealed = k.revealed; state.cast = k.cast; state.fx = k.fx; state.debug = k.debug; state.mask = k.mask;
    requestRender();
    return url;
  }
  function showIntro() {
    setTimeout(function () { var cv = document.getElementById('introCover'); if (cv) cv.remove(); }, 60); // 過場已蓋上，拿掉黑幕
    var A = window.StoryArt, room = snapshot('intro', { phase: 1, ghost: state.ghost });
    scene = window.StoryScene.show({
      id: 'intro', background: room,
      lines: [
        { background: A.get('castle'), text: '有一天……' },
        { text: '你受邀到一座古老的城堡過夜。' },
        { background: A.get('letter'), text: '晚餐後，你回到房間，發現桌上有一封奇怪的信：' },
        { letter: '如果你能看見牠們，代表牠們也已經發現你了。', letterOnArt: !A.placeholder('letter') },
        { letter: '別相信眼睛看到的位置。', letterOnArt: !A.placeholder('letter') },
        { letter: '找到牠真正所在之處，才能封印牠。', letterOnArt: !A.placeholder('letter') },
        { text: '有一個古老金屬圓盤壓在信件上面。', image: A.get('disc') }, // 背景圖的圓盤被對話框擋住，對話框裡附圓盤圖（使用者 2026-11-21）
        { background: 'black', text: '半夜，有一間房間不斷傳出奇怪的聲響。', onShow: function () { if (window.Sfx) window.Sfx.nightNoise(); } },
        { background: room, speaker: '你', text: '房間裡……明明沒有人啊？' },
        { speaker: '你', text: '等等，鏡子裡有東西！' },
        // 使用者 2026-11-21 新增（Google 劇本）
        { speaker: '女鬼', text: '嘻嘻', image: 'assets/story-ghost-face.webp', onShow: function () { giggle(); } },
        { speaker: '你', text: '是鬼！我看到牠了。那封信就是在說鬼嗎？' },
        { speaker: '你', text: '信上說要先找到牠的位置？' }
      ],
      title: '第一關：鏡子房間',
      note: '鬼只有在鏡子裡才看得到。請推算出牠真正所在的位置，再展開封印法陣。3 顆❤️，要抓到牠 ' + R.catchesTotal + ' 次；抓錯扣一❤️。',
      buttons: [{ id: 'startBtn', label: '開始抓鬼', primary: true, onClick: function () { closeScene(); if (LB) LB.startLevel('mirror'); syncUI(); requestRender(); } }]
    });
  }
  // 「匡啷！」那一句：碎玻璃聲＋過場畫面震動（使用者 2026-11-18 回饋 M5）
  function breakFx() {
    shatter();
    var bg = document.querySelector('.story-bg');
    if (!bg) return;
    bg.classList.remove('mirror-shake'); void bg.offsetWidth; bg.classList.add('mirror-shake');
  }
  function showBreak() {
    if (LB) LB.pauseLevel();
    scene = window.StoryScene.show({
      id: 'break', background: snapshot('break', { phase: 2, ghost: null }),
      lines: [
        { text: '鬼被抓了兩次，氣得撞向右邊的鏡子——' },
        { text: '匡啷！鏡子碎了一地。', onShow: breakFx },
        { speaker: '你', text: '只剩一面鏡子了……' }
      ],
      title: '鏡子被打碎了',
      note: '只剩正面那面鏡子。再抓到牠 ' + (R.catchesTotal - R.catchesTwoMirrors) + ' 次。',
      buttons: [{ id: 'resumeBtn', label: '繼續抓鬼', primary: true, onClick: function () {
        closeScene();
        if (LB) LB.resumeLevel();
        state.phase = 2; // 震動與碎裂聲在「匡啷！」那句（M5）；按「繼續抓鬼」後不再震（M6）
        newGhost(); setStatus(MSG.startOne); syncUI(); requestRender();
      } }]
    });
  }
  function showFail() {
    if (LB) LB.cancelLevel(); // 命用完的那一次不算；重新挑戰從 0 起算
    scene = window.StoryScene.show({
      id: 'fail', background: snapshot('fail', { phase: state.phase, ghost: state.ghost }),
      lines: [{ speaker: '你', text: '等我休息一下，再來抓你。' }], // 使用者 2026-11-21
      title: '封印失敗', note: '鬼還躲在房間裡。請重新挑戰。',
      buttons: [
        { id: 'retryBtn', label: '重新挑戰', primary: true, onClick: function () { closeScene(); resetLevel(); if (LB) LB.startLevel('mirror'); } },
        { id: 'failMenuBtn', label: '回關卡選單', href: '../index.html' }
      ]
    });
  }
  function showClear() {
    if (window.GameProgress) window.GameProgress.markCleared('mirror'); // 過關紀錄：解鎖第二關（入口頁用）
    if (LB) LB.finishMirror(); // 這一次的遊玩時間記成第一關成績（取代舊的）；趕鬼時間＝兩關最後一次過關相加
    scene = window.StoryScene.show({
      id: 'clear', background: snapshot('clear', { phase: 2, ghost: null }),
      lines: [
        { text: '女鬼終於被封印了，房間響起騷動——' },
        { text: '大量的鬼衝出房間，逃進走廊。', scatter: 14 }, // 雜魚圖：StoryScene.minionArt（story-art.js 設定）
        { speaker: '你', text: '也太多鬼了？別跑！' }
      ],
      title: '第一關過關！', note: '鬼逃進了走廊。第二關：城堡走廊（已解鎖）', // 使用者 2026-11-19 統一三關過關文字
      buttons: [
        // 過關後一律回選單、由選單進下一關（使用者 2026-11-18 回饋 Q3：換頁一定會離開全螢幕，不從這裡直接跳第二關）
        { id: 'nextLevelBtn', label: '前往第二關 ➜', primary: true, href: '../convex-lens/index.html' }, // 使用者 2026-11-21：外框頁不再退出全螢幕，改回可直接進下一關
        { id: 'clearMenuBtn', label: '回關卡選單', href: '../index.html' },
        { id: 'againBtn', label: '再玩一次', onClick: function () { closeScene(); resetLevel(); if (LB) LB.startLevel('mirror'); } }
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
  $('castBtn').addEventListener('click', function () {
    if (!discTaught) { if (state.selected && canAct()) { showThrow(); syncUI(); requestRender(); } return; } // 第一次：先播劇情，劇情結束才丟到選好的格子
    cast();
  });
  $('nextBtn').addEventListener('click', next);
  // 「☰ 回關卡」先確認（和第二、三關一致；使用者 2026-11-21）
  $('menuLink').addEventListener('click', function (e) { e.preventDefault(); var href = this.href; GameConfirm.ask({ text: '回到關卡選單？這一關目前的進度不會保留。', ok: '回關卡選單', cancel: '繼續玩' }, function () { location.href = href; }); });

  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe($('stage'));

  // 測試／開發用掛鉤（不是學生 UI）
  window.__protoMirror = {
    state: state, stats: stats, room: R, core: C, cam: cam, FREE: FREE, PRACTICE: PRACTICE, pools: POOLS, selectable: SELECTABLE, GHOST_COLOR: GHOST_COLOR,
    intactMirrors: intactMirrors, render: render, messages: MSG, setStatus: setStatus,
    scene: function () { return scene ? scene.info() : null; },
    art: function () { return { intact: ART.intact.ready, broken: ART.broken.ready, ghost: ART.ghost.ready && ART.ghostBack.ready }; },
    // 透過某一串鏡子看到的是鬼的正面還是背面（[] = 直接看）
    ghostSide: function (chain) { return seesBack(C.chainT(R, chain)) ? 'back' : 'front'; },
    setMask: function (on) { state.mask = !!on; render(); },
    canvasInfo: function () { return { W: W, H: H, DPR: DPR, S: S, OX: OX, OY: OY, zoom: ZOOMS[view.zoom] }; },
    // 影像座標 → 網頁座標（測試用來算該點哪裡）
    toClient: function (p) { return GameLandscape.toClient({ x: OX + p.x * S, y: OY + p.y * S }, canvas); },
    cellClient: function (col, row) { return this.toClient(C.project(cam, C.cellCenter(col, row))); },
    glassPoly: function (id) { return glassScreen(id); },
    setGhost: function (col, row) { state.forced = { col: col, row: row }; newGhost(); state.forced = null; syncUI(); render(); }
  };

  if (FREE) { $('title').innerHTML = '平面鏡原型 <small>自由練習</small>'; fillCellSel(); }
  layout();
  resetLevel();
  // 關卡名稱不顯示（使用者 2026-11-19：三關一致，都不寫關卡名稱；右上角留給「☰ 回關卡」）。自由練習（開發用）照舊顯示。
  $('title').hidden = !FREE;
  // 練習模式要先通過第一關；網址直接開就只顯示「還沒通過第一關」＋【回關卡選單】（使用者 2026-11-21；shared/progress.js）
  if (PRACTICE && window.GameProgress) { var gateScene = window.GameProgress.showGate('mirror', true); if (gateScene) scene = gateScene; }
  // 開場 bug（使用者 2026-11-21）：等圖載入的那段時間，底下的遊戲畫面（鏡子房間＋鏡中女鬼）會先露出來。
  // 開場前先用黑幕蓋住，開場過場出現後再拿掉。
  if (!FREE && !PRACTICE) {
    var cover = document.createElement('div');
    cover.id = 'introCover';
    cover.style.cssText = 'position:fixed;inset:0;z-index:450;background:#07080f';
    document.body.appendChild(cover);
    if (introReady()) showIntro(); else pendingIntro = true;
  }
})();

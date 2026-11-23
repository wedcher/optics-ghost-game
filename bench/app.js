/*
 * app.js — 光學實驗桌模擬器的畫面與操作。光學計算在 optics.js，數字在 config.js。
 * 畫面分兩塊：上面是側面圖（光具座、燈具、透鏡、光屏、光路、F 與 2F），
 * 下面三個小圖：燈具正面、光屏、看透鏡。
 */
(function () {
  'use strict';
  var C = BenchConfig, O = BenchOptics;
  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  var st = { lens: 'convex', objX: C.start.objX, screenX: C.start.screenX, rays: true, data: true, back: false, drag: null };
  var G = {};

  function F() { return st.lens === 'convex' ? C.f : -C.f; }
  function U() { return C.lensX - st.objX; }
  function S() { return st.screenX - C.lensX; }
  function srcY() { return Math.max.apply(null, C.lamp.windows.map(function (w) { return w.y + C.lamp.windowR; })); }

  // ---------- 小工具 ----------
  function X(x) { return G.x0 + x * G.k; }
  function Y(h) { return G.baseY - h * G.k; }
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function shade(c, t) { var to = t > 0 ? 255 : 0, a = Math.abs(t); return 'rgb(' + c.map(function (v) { return Math.round(v + (to - v) * a); }).join(',') + ')'; }
  function text(s, x, y, color, size, align, base) {
    ctx.font = 'bold ' + size + 'px ' + FONT; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = base || 'alphabetic'; ctx.fillText(s, x, y);
  }
  function line(x1, y1, x2, y2, color, w, dash) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = w || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  function arrowHead(x, y, dx, dy, size, color) {
    var a = Math.atan2(dy, dx);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - size * Math.cos(a - 0.4), y - size * Math.sin(a - 0.4)); ctx.lineTo(x - size * Math.cos(a + 0.4), y - size * Math.sin(a + 0.4)); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  // ---------- 版面 ----------
  function layout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return false;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var top = C.axisH + 10, bottom = 6.5;               // 尺上緣以上／以下要放得下的公分數
    var k = Math.min(W / (C.benchLength + 4), (H * 0.56) / (top + bottom));
    G.W = W; G.H = H; G.k = k;
    G.x0 = (W - C.benchLength * k) / 2;
    G.baseY = 6 + top * k;
    G.sideH = 6 + (top + bottom) * k;
    var py = G.sideH + 6, ph = H - py - 4, gap = 6, pw = (W - 8 - 2 * gap) / 3;
    G.panels = [0, 1, 2].map(function (i) { return { x: 4 + i * (pw + gap), y: py, w: pw, h: ph }; });
    return true;
  }

  // ---------- 側面圖 ----------
  function drawRuler() {
    var k = G.k, y0 = Y(0), h = 2.5 * k;
    var g = ctx.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#f3b8c8'); g.addColorStop(1, '#d98aa3');
    ctx.fillStyle = g; ctx.fillRect(X(-1.5), y0, (C.benchLength + 3) * k, h);
    ctx.strokeStyle = '#7a3b52'; ctx.lineWidth = 1; ctx.strokeRect(X(-1.5), y0, (C.benchLength + 3) * k, h);
    ctx.strokeStyle = '#5a2a3c';
    for (var i = 0; i <= C.benchLength; i++) {
      var len = i % 10 === 0 ? 0.95 : i % 5 === 0 ? 0.65 : 0.35;
      ctx.lineWidth = i % 10 === 0 ? 1.2 : 0.8;
      ctx.beginPath(); ctx.moveTo(X(i), y0); ctx.lineTo(X(i), y0 + len * k); ctx.stroke();
      if (i % 10 === 0) text(String(i), X(i), y0 + 1.95 * k, '#4a1f30', Math.max(9, k * 1.1), 'center');
    }
  }

  function drawFocusMarks() { // 透鏡左右兩側各一組 F 與 2F；最後才畫，不被柱子擋住
    var f = C.f, marks = [[-2 * f, '2F'], [-f, 'F'], [f, 'F'], [2 * f, '2F']], fs = Math.max(11, G.k * 1.5);
    marks.forEach(function (m) {
      var x = C.lensX + m[0], two = m[1] === '2F', ty = Y(0) - 3.2 * G.k;
      line(X(x), Y(0), X(x), ty + 4, '#ffd166', 2);
      ctx.font = 'bold ' + fs + 'px ' + FONT; var tw = ctx.measureText(m[1]).width + 8;
      rr(X(x) - tw / 2, ty - fs, tw, fs + 4, 4); ctx.fillStyle = 'rgba(16,18,27,.88)'; ctx.fill(); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1; ctx.stroke();
      text(m[1], X(x), ty + 1, two ? '#ffe9a8' : '#ffd166', fs, 'center');
    });
  }

  function base(xc, w) {
    var k = G.k, h = 1.3 * k, x = X(xc - w / 2), y = Y(0) - h;
    var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#3a3e4a'); g.addColorStop(1, '#14161c');
    rr(x, y, w * k, h, 2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#05060a'; ctx.stroke();
    return y;
  }
  function pole(xc, topH, color) {
    var k = G.k, w = 1.2 * k, x = X(xc) - w / 2, y1 = Y(0) - 1.3 * k, y2 = Y(topH);
    var g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#8d929e'); g.addColorStop(0.45, '#eef0f5'); g.addColorStop(1, '#6b7080');
    ctx.fillStyle = color || g; ctx.fillRect(x, y2, w, y1 - y2);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x, y2, w, y1 - y2);
  }
  function knob(x, y) { ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, G.k * 0.45), 0, 6.283); ctx.fillStyle = '#c9ccd6'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.stroke(); }

  function drawLensStand() {
    var k = G.k, R = C.lensRadius, xc = C.lensX, cy = Y(C.axisH);
    base(xc, 6); pole(xc, C.axisH - R - 0.4);
    var cw = 1.9 * k; rr(X(xc) - cw / 2, Y(C.axisH - R - 0.4) - 1, cw, 0.9 * k, 2); ctx.fillStyle = '#9aa0b0'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.stroke();
    knob(X(xc) + 0.95 * k + 3, Y(C.axisH - R - 0.4) + 2);
    var hw = 0.55 * k, r = R * k;
    ctx.beginPath();
    if (st.lens === 'convex') {
      ctx.moveTo(X(xc), cy - r); ctx.quadraticCurveTo(X(xc) + hw * 2, cy, X(xc), cy + r); ctx.quadraticCurveTo(X(xc) - hw * 2, cy, X(xc), cy - r);
    } else {
      ctx.moveTo(X(xc) - hw, cy - r); ctx.lineTo(X(xc) + hw, cy - r); ctx.quadraticCurveTo(X(xc) + 0.1 * k, cy, X(xc) + hw, cy + r);
      ctx.lineTo(X(xc) - hw, cy + r); ctx.quadraticCurveTo(X(xc) - 0.1 * k, cy, X(xc) - hw, cy - r);
    }
    ctx.closePath(); ctx.fillStyle = 'rgba(150,215,255,.55)'; ctx.fill(); ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 1.5; ctx.stroke();
    text(st.lens === 'convex' ? '凸透鏡' : '凹透鏡', X(xc), Y(C.axisH + R + 0.9), '#9fd8ff', Math.max(11, k * 1.4), 'center');
  }

  function drawScreenStand() {
    var k = G.k, xc = st.screenX, hh = C.screen.h / 2;
    base(xc, 6); pole(xc, C.axisH - hh);
    knob(X(xc) + 0.95 * k + 3, Y(C.axisH - hh) + 6);
    var bw = 0.7 * k, y1 = Y(C.axisH + hh), y2 = Y(C.axisH - hh);
    var g = ctx.createLinearGradient(X(xc) - bw / 2, 0, X(xc) + bw / 2, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9bdc9');
    ctx.fillStyle = g; ctx.fillRect(X(xc) - bw / 2, y1, bw, y2 - y1); ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(X(xc) - bw / 2, y1, bw, y2 - y1);
    text('光屏', X(xc), Y(C.axisH + hh + 0.8), '#e6e9f5', Math.max(11, k * 1.4), 'center');
  }

  function lampBox(x0, y0, w, h, color, dx, dy) {
    var k = G.k, x = X(x0) + dx, y = Y(y0 + h) + dy, pw = w * k, ph = h * k;
    var g = ctx.createLinearGradient(0, y, 0, y + ph); g.addColorStop(0, shade(color, 0.5)); g.addColorStop(0.4, rgba(color, 1)); g.addColorStop(1, shade(color, -0.4));
    rr(x, y, pw, ph, Math.min(pw, ph) * 0.2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(color, -0.6); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; rr(x + pw * 0.08, y + ph * 0.1, pw * 0.84, ph * 0.18, ph * 0.09); ctx.fill();
    // 燈窗那端的小圓蓋（面向透鏡）
    var cw = 0.35 * k; rr(x + pw - cw * 0.2, y + ph * 0.18, cw, ph * 0.64, cw * 0.4); ctx.fillStyle = shade(color, 0.7); ctx.fill(); ctx.strokeStyle = shade(color, -0.5); ctx.stroke();
  }

  function drawLampStand() {
    var k = G.k, L = C.lamp, xc = st.objX - L.len / 2, s = L.size;
    base(xc, 6); pole(xc, C.axisH - 0.3);
    rr(X(xc) - 0.9 * k, Y(C.axisH) - 0.35 * k, 1.8 * k, 0.55 * k, 2); ctx.fillStyle = '#9aa0b0'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.stroke();
    var w = L.windows, x0 = st.objX - L.len, off = 0.2 * k;
    // 側面照：從「正面看的左邊」看過去 → 左排（紅）最近，右排（綠、藍）在後面，稍微往左上錯開表示前後
    lampBox(x0, C.axisH, L.len, s, w[2].color, -off, -off);                 // 綠（後排下）
    lampBox(x0, C.axisH + s, L.len, s, w[0].color, -off, -off);             // 藍（後排上）
    lampBox(x0, C.axisH, L.len, s, w[1].color, 0, 0);                       // 紅（前排下）
    text('燈具', X(xc), Y(C.axisH + 2 * s + 0.9), '#ffb4a8', Math.max(11, k * 1.4), 'center');
  }

  function drawAxis() { line(X(-1.5), Y(C.axisH), X(C.benchLength + 1.5), Y(C.axisH), 'rgba(160,175,240,.4)', 1, [6, 5]); }

  function drawRays() {
    var f = F(), u = U(), R = C.lensRadius, yo = srcY(), k = G.k, xl = C.lensX, xEnd = st.screenX;
    var im = O.image(f, u), list = O.rays(f, u, yo, R);
    var colors = { parallel: '#ffe066', center: '#7ee0a0', focus: '#ff9f6b' };
    ctx.save(); ctx.beginPath(); ctx.rect(X(-1.5), 0, (C.benchLength + 3) * k, Y(0)); ctx.clip();
    ctx.beginPath(); ctx.arc(X(st.objX), Y(C.axisH + yo), 3.5, 0, 6.283); ctx.fillStyle = '#ffe066'; ctx.fill();
    list.forEach(function (r) {
      if (r.blocked) return;
      var col = colors[r.name], xP = X(xl), yP = Y(C.axisH + r.yP);
      line(X(st.objX), Y(C.axisH + yo), xP, yP, col, 1.8);
      var xe = xEnd - xl; // 光線打到光屏為止
      line(xP, yP, X(xEnd), Y(C.axisH + r.yP + r.slope * xe), col, 1.8);
      if (im.dImg < 0 && isFinite(im.dImg)) { // 虛像：反向延長線（虛線）
        var xb = Math.max(0, xl + im.dImg);
        line(xP, yP, X(xb), Y(C.axisH + r.yP + r.slope * (xb - xl)), col, 1.4, [4, 4]);
      }
    });
    ctx.restore();
    if (isFinite(im.dImg)) { // 像（箭頭）
      var xi = xl + im.dImg, yi = im.m * yo;
      if (xi >= -1 && xi <= C.benchLength + 1) {
        var virt = im.dImg < 0, col2 = virt ? '#c3a6ff' : '#ff7ad9';
        line(X(xi), Y(C.axisH), X(xi), Y(C.axisH + yi), col2, 2.4, virt ? [4, 3] : []);
        var dir = yi >= 0 ? -1 : 1; arrowHead(X(xi), Y(C.axisH + yi), 0, dir, 7, col2);
        text(virt ? '虛像' : '實像', X(xi) + (virt ? -6 : 6), Y(C.axisH + yi) + (yi >= 0 ? -4 : 12), col2, Math.max(11, k * 1.4), virt ? 'right' : 'left');
      }
    }
  }

  function drawEye() {
    var x = X(C.lensX + C.eye.dist), y = Y(C.axisH), R = C.lensRadius * G.k;
    line(x, y, X(C.lensX), y - R, 'rgba(255,255,255,.18)', 1, [3, 4]); line(x, y, X(C.lensX), y + R, 'rgba(255,255,255,.18)', 1, [3, 4]);
    ctx.beginPath(); ctx.ellipse(x, y, 9, 5.5, 0, 0, 6.283); ctx.fillStyle = 'rgba(15,18,28,.85)'; ctx.fill(); ctx.strokeStyle = '#e6e9f5'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - 2, y, 3, 0, 6.283); ctx.fillStyle = '#e6e9f5'; ctx.fill();
    text('眼睛', x, y - 10, '#e6e9f5', 11, 'center');
  }

  function dim(x1, x2, yy, label, color) {
    line(X(x1), yy, X(x2), yy, color, 1.4); arrowHead(X(x1), yy, -1, 0, 6, color); arrowHead(X(x2), yy, 1, 0, 6, color);
    line(X(x1), yy - 4, X(x1), yy + 4, color, 1.4); line(X(x2), yy - 4, X(x2), yy + 4, color, 1.4);
    text(label, (X(x1) + X(x2)) / 2, yy + 14, color, Math.max(11, G.k * 1.5), 'center');
  }
  function drawDims() {
    var yy = Y(0) + 2.5 * G.k + 8;
    dim(st.objX, C.lensX, yy, '物距 ' + U().toFixed(1) + ' cm', '#8fd6ff');
    dim(C.lensX, st.screenX, yy, '像距 ' + S().toFixed(1) + ' cm', '#ffb86b');
  }

  function drawSide() {
    ctx.fillStyle = '#10121b'; ctx.fillRect(0, 0, G.W, G.sideH);
    drawAxis(); drawRuler();
    drawScreenStand(); drawLensStand(); drawLampStand();
    drawFocusMarks();
    if (st.rays) drawRays();
    drawEye();
    if (st.data) drawDims();
    if (st.drag) { // 抓住時的光暈
      var xc = st.drag.who === 'obj' ? st.objX - C.lamp.len / 2 : st.screenX, hw = standHalfWidth();
      ctx.strokeStyle = 'rgba(255,224,102,.8)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      rr(X(xc) - hw, Y(C.axisH + 3.2), hw * 2, Y(0) - Y(C.axisH + 3.2) + 2, 8); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // ---------- 下方三個小圖 ----------
  function panel(p, title) {
    rr(p.x, p.y, p.w, p.h, 8); ctx.fillStyle = '#12141d'; ctx.fill(); ctx.strokeStyle = '#2a2e3e'; ctx.lineWidth = 1; ctx.stroke();
    text(title, p.x + 8, p.y + 14, '#9aa3cc', 11, 'left');
  }
  function spot(cx, cy, r, blur, color, strength) { // 一個發光圓點（模糊時攤成大圓、變淡）
    var R = r + blur, a = Math.min(1, (r / Math.max(R, 1e-6)) * (r / Math.max(R, 1e-6))) * (strength == null ? 1 : strength);
    if (blur < 0.3 * r + 0.3) {
      var g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2); g1.addColorStop(0, rgba(color, 0.45 * a)); g1.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(cx, cy, r * 2, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(r, 1.2), 0, 6.283); ctx.fillStyle = shade(color, 0.35); ctx.fill();
    } else {
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, rgba(color, Math.max(a, 0.08))); g.addColorStop(0.7, rgba(color, Math.max(a, 0.08) * 0.8)); g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fill();
    }
  }

  function drawFront(p) { // 燈具正面（從透鏡這側看）：三個方塊的正面 + 一點深度
    panel(p, '燈具正面（從透鏡這側看）');
    var L = C.lamp, ka = Math.min((p.w - 16) / 3.4, (p.h - 36) / 3.4), cx = p.x + p.w / 2, yb = p.y + p.h - 12;
    line(cx - ka * 2, yb, cx + ka * 2, yb, 'rgba(160,175,240,.3)', 1, [4, 4]);
    var order = [L.windows[1], L.windows[2], L.windows[0]];
    order.forEach(function (w) {
      var x = cx + (w.r - L.size / 2) * ka, y = yb - (w.y + L.size / 2) * ka, s = L.size * ka, d = 0.18 * ka;
      rr(x - d, y - d, s, s, s * 0.2); ctx.fillStyle = shade(w.color, -0.55); ctx.fill();          // 後面的燈身（深度）
      var g = ctx.createLinearGradient(0, y, 0, y + s); g.addColorStop(0, shade(w.color, 0.35)); g.addColorStop(1, shade(w.color, -0.3));
      rr(x, y, s, s, s * 0.2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(w.color, -0.6); ctx.lineWidth = 1; ctx.stroke();
      var wx = x + s / 2, wy = y + s / 2, wr = L.windowR * ka;
      ctx.beginPath(); ctx.arc(wx, wy, wr * 1.25, 0, 6.283); ctx.fillStyle = shade(w.color, -0.5); ctx.fill();
      var gg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr); gg.addColorStop(0, '#fff'); gg.addColorStop(0.6, shade(w.color, 0.55)); gg.addColorStop(1, rgba(w.color, 1));
      ctx.beginPath(); ctx.arc(wx, wy, wr, 0, 6.283); ctx.fillStyle = gg; ctx.fill();
    });
    ctx.beginPath(); ctx.arc(cx, yb, 3, 0, 6.283); ctx.fillStyle = '#a0b0ff'; ctx.fill();
    text('光軸', cx - ka * 2 - 4, yb + 4, '#a0b0ff', 10, 'right');
  }

  function drawScreenView(p) {
    var f = F(), u = U(), s = S(), R = C.lensRadius, L = C.lamp;
    panel(p, st.back ? '光屏（從光屏背面看）' : '光屏（從透鏡這側看）');
    var bw = C.screen.w, bh = C.screen.h, kb = Math.min((p.w - 16) / bw, (p.h - 44) / bh);
    var cx = p.x + p.w / 2, cy = p.y + 20 + (p.h - 40) / 2;
    ctx.fillStyle = '#23262f'; ctx.fillRect(cx - bw * kb / 2, cy - bh * kb / 2, bw * kb, bh * kb);
    line(cx - bw * kb / 2, cy, cx + bw * kb / 2, cy, 'rgba(160,175,240,.25)', 1, [3, 3]); line(cx, cy - bh * kb / 2, cx, cy + bh * kb / 2, 'rgba(160,175,240,.25)', 1, [3, 3]);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - bw * kb / 2, cy - bh * kb / 2, bw * kb, bh * kb); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
    var maxBlur = 0;
    L.windows.forEach(function (w) {
      var sp = O.screenSpot(f, u, s, R, w, L.windowR, st.back); maxBlur = Math.max(maxBlur, sp.blur);
      spot(cx + sp.r * kb, cy - sp.y * kb, sp.sharp * kb, sp.blur * kb, w.color);
    });
    ctx.restore();
    ctx.strokeStyle = '#8a91ad'; ctx.lineWidth = 2; ctx.strokeRect(cx - bw * kb / 2, cy - bh * kb / 2, bw * kb, bh * kb);
    if (st.data) {
      var msg = st.lens === 'concave' ? '凹透鏡：光屏上不會成像' : maxBlur < 0.12 ? '像很清楚' : '像模糊（移動光屏找清楚的位置）';
      text(msg, p.x + p.w / 2, p.y + p.h - 5, '#cfd5f0', 11, 'center');
    }
  }

  var NOUN = { enlarged: '放大', reduced: '縮小', same: '等大' };
  function drawLensView(p) {
    var f = F(), u = U(), d = C.eye.dist, R = C.lensRadius, L = C.lamp;
    panel(p, '看透鏡（眼睛在透鏡後 ' + d + ' cm）');
    var rc = Math.min(p.w - 20, p.h - 40) / 2, kc = rc / R, cx = p.x + p.w / 2, cy = p.y + 20 + (p.h - 40) / 2;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc); g.addColorStop(0, '#171a27'); g.addColorStop(1, '#0c0d14');
    ctx.beginPath(); ctx.arc(cx, cy, rc, 0, 6.283); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rc, 0, 6.283); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
    var spots = L.windows.map(function (w) { return { w: w, sp: O.lensSpot(f, u, d, C.eye.near, w, L.windowR) }; });
    var huge = spots.some(function (o) { return !isFinite(o.sp.Mv) || Math.abs(o.sp.Mv) > 12; });
    var focus = spots[0].sp.focusable;
    if (huge) { // 像剛好落在眼睛上：整片鏡子一團光
      spots.forEach(function (o) { spot(cx, cy, rc * 1.2, rc, o.w.color, 0.5); });
    } else {
      spots.forEach(function (o) {
        var px = cx + o.sp.r * kc, py = cy - o.sp.y * kc, rad = o.sp.size * kc;
        if (focus) spot(px, py, rad, 0, o.w.color); else spot(px, py, rad, Math.max(rad, 0.6 * kc) * 1.4, o.w.color, 0.7);
      });
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, rc, 0, 6.283); ctx.strokeStyle = '#8fd0ff'; ctx.lineWidth = 3; ctx.stroke();
    if (st.data) {
      var ds = O.describe(f, u), msg;
      if (!focus || huge) msg = '對不到焦（像在眼前太近或在眼睛後面）';
      else if (ds.kind === 'infinity') msg = '像在無限遠（平行光）';
      else msg = (ds.kind === 'real' ? '實像' : '虛像') + '・' + (ds.upright ? '正立' : '倒立') + '・' + NOUN[ds.size];
      text(msg, p.x + p.w / 2, p.y + p.h - 5, '#cfd5f0', 11, 'center');
    }
  }

  function render() {
    if (!G.k) return;
    ctx.clearRect(0, 0, G.W, G.H);
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, G.W, G.H);
    drawSide(); drawFront(G.panels[0]); drawScreenView(G.panels[1]); drawLensView(G.panels[2]);
  }
  var pending = false;
  function requestRender() { if (!pending) { pending = true; requestAnimationFrame(function () { pending = false; render(); }); } }

  // ---------- 拖曳 ----------
  function standHalfWidth() { return Math.max(4 * G.k, 34); }
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function worldX(px) { return (px - G.x0) / G.k; }
  function hit(p) {
    if (p.y > G.sideH) return null;
    var hw = standHalfWidth(), best = null, bd = 1e9;
    [{ who: 'obj', xc: st.objX - C.lamp.len / 2 }, { who: 'screen', xc: st.screenX }].forEach(function (s) {
      var d = Math.abs(p.x - X(s.xc));
      if (d <= hw && p.y >= Y(C.axisH + 5) && d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function setX(who, x) {
    if (who === 'obj') st.objX = clamp(Math.round(x * 10) / 10, C.range.objMin, C.range.objMax);
    else st.screenX = clamp(Math.round(x * 10) / 10, C.lensX + C.range.screenMinFromLens, C.range.screenMax);
  }
  canvas.addEventListener('pointerdown', function (e) {
    var p = pos(e), h = hit(p); if (!h) return;
    st.drag = { who: h.who, dx: worldX(p.x) - h.xc, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault(); requestRender();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!st.drag || e.pointerId !== st.drag.id) return;
    var x = worldX(pos(e).x) - st.drag.dx;
    setX(st.drag.who, st.drag.who === 'obj' ? x + C.lamp.len / 2 : x);
    e.preventDefault(); requestRender();
  });
  function endDrag(e) { if (st.drag && e.pointerId === st.drag.id) { st.drag = null; requestRender(); } }
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  // ---------- 按鈕 ----------
  function $(id) { return document.getElementById(id); }
  function sync() {
    $('b-convex').setAttribute('aria-pressed', st.lens === 'convex'); $('b-concave').setAttribute('aria-pressed', st.lens === 'concave');
    $('t-rays').setAttribute('aria-pressed', st.rays); $('t-data').setAttribute('aria-pressed', st.data);
    $('t-back').setAttribute('aria-pressed', st.back); $('t-back').textContent = st.back ? '光屏：背面看' : '光屏：透鏡側看';
    requestRender();
  }
  $('b-convex').onclick = function () { st.lens = 'convex'; sync(); };
  $('b-concave').onclick = function () { st.lens = 'concave'; sync(); };
  $('t-rays').onclick = function () { st.rays = !st.rays; sync(); };
  $('t-data').onclick = function () { st.data = !st.data; sync(); };
  $('t-back').onclick = function () { st.back = !st.back; sync(); };
  $('b-reset').onclick = function () { st.objX = C.start.objX; st.screenX = C.start.screenX; sync(); };

  function onResize() { if (layout()) requestRender(); }
  window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
  window.BenchDebug = { state: st, geom: G, X: X, Y: Y, render: render, layout: layout };
  onResize(); sync();
})();

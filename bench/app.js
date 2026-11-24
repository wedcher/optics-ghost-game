/*
 * app.js — 光學實驗桌模擬器的畫面與操作。光學計算在 optics.js，數字在 config.js。
 * 左邊大的側面圖（實驗桌／分析光路），右邊由上到下三張小圖：光屏、看透鏡、燈具正面。
 *
 * 流程（和遊戲一樣）：移動燈具與光屏 → 「找到像了」（實像要光屏上清楚；虛像要隔著透鏡看得到）
 *   → 「分析光路」：燈具、透鏡、光屏位置鎖住，學生從標示點（O、F、物、像…）拖曳畫線，
 *   碰到另一個點、或拉成水平／垂直，線就變實線、放開留下；虛線放開會消失。沒有任何自動畫好的光路
 *   （「對答案」按鈕才會畫出三條主光線）。
 */
(function () {
  'use strict';
  var C = BenchConfig, O = BenchOptics;
  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  var BAR_H = 36;
  var st = {
    lens: 'convex', objX: C.start.objX, screenX: C.start.screenX,
    rays: false, data: true, back: false,          // rays＝示範光路（自動畫的三條主光線，預設關）
    mode: 'obs',                                    // 'obs' 實驗桌｜'ana' 分析光路
    marker: null, lines: [], prev: null, gest: null, ans: false, ansT0: 0, drag: null, snapTo: null, snapScr: null, nudge: null
  };
  var G = {};

  function $(id) { return document.getElementById(id); }
  function F() { return st.lens === 'convex' ? C.f : -C.f; }
  function U() { return C.lensX - st.objX; }
  function S() { return st.screenX - C.lensX; }
  function srcY() { return Math.max.apply(null, C.lamp.windows.map(function (w) { return w.y + C.lamp.windowR; })); } // 物的上端（光線的出發點）

  // ---------- 小工具 ----------
  function X(x) { return G.x0 + x * G.k; }
  function Y(h) { return G.baseY - h * G.k; }                       // h：離尺上緣的高度（實驗桌視角）
  function PY(h) { return st.mode === 'ana' ? G.axisA - h * G.ky : Y(C.axisH + h); } // h：離光軸的高度（兩種視角通用）
  function KY() { return st.mode === 'ana' ? G.ky : G.k; }
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

  var msgTimer = null;
  function say(t, sticky) {
    var el = $('msg'); clearTimeout(msgTimer);
    if (!t) { el.hidden = true; return; }
    el.textContent = t; el.hidden = false;
    if (!sticky) msgTimer = setTimeout(function () { el.hidden = true; }, 4500);
  }

  // ---------- 版面 ----------
  function layout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return false;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var rightW = Math.max(190, Math.min(300, W * 0.28)), leftW = W - rightW - 8;
    var top = C.axisH + C.screen.h / 2 + 9, bottom = 6.5;          // 尺上緣以上／以下要放得下的公分數
    var availH = H - BAR_H - 8;
    var k = Math.min(leftW / (C.benchLength + 4), availH / (top + bottom));
    G.W = W; G.H = H; G.k = k; G.leftW = leftW;
    G.x0 = (leftW - C.benchLength * k) / 2;
    G.baseY = BAR_H + 4 + (availH - (top + bottom) * k) / 2 + top * k;   // 側面圖在左欄裡上下置中
    var gap = 6, ph = (H - 8 - 2 * gap) / 3, px = leftW + 4;
    G.panels = [0, 1, 2].map(function (i) { return { x: px, y: 4 + i * (ph + gap), w: rightW, h: ph }; });
    $('bar').style.width = leftW + 'px'; $('msg').style.maxWidth = (leftW - 16) + 'px';
    anaScale();
    return true;
  }
  /** 分析畫面：x 照實際比例，y 拉伸（參考圖：透鏡約 2.5 倍焦距高）；像很大時自動縮小以免超出畫面。 */
  function anaScale() {
    var availH = G.H - BAR_H - 8;
    var ext = Math.max(C.lensRadius * 1.25, srcY() * 1.3, st.marker ? Math.abs(st.marker.y) * 1.25 : 0);
    G.ky = Math.min(C.analysisStretch * G.k, (availH / 2 - 14) / ext);
    G.axisA = BAR_H + 4 + availH / 2;
  }

  // ---------- 實驗桌（側面圖） ----------
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
      if ((m[0] < 0 && st.snapTo === m[1]) || (m[0] > 0 && st.snapScr === (m[1] === 'F' ? 'F' : 'F2'))) { rr(X(x) - tw / 2 - 3, ty - fs - 3, tw + 6, fs + 10, 6); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }
    });
  }

  function base(xc, w) {
    var k = G.k, h = 1.3 * k, x = X(xc - w / 2), y = Y(0) - h;
    var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#3a3e4a'); g.addColorStop(1, '#14161c');
    rr(x, y, w * k, h, 2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#05060a'; ctx.stroke();
  }
  function pole(xc, topH) {
    var k = G.k, w = 1.2 * k, x = X(xc) - w / 2, y1 = Y(0) - 1.3 * k, y2 = Y(topH);
    var g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#8d929e'); g.addColorStop(0.45, '#eef0f5'); g.addColorStop(1, '#6b7080');
    ctx.fillStyle = g; ctx.fillRect(x, y2, w, y1 - y2);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x, y2, w, y1 - y2);
  }
  function knob(x, y) { ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, G.k * 0.45), 0, 6.283); ctx.fillStyle = '#c9ccd6'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.stroke(); }

  function lensShape(cx, cy, halfW, halfH, thin) { // 透鏡側面輪廓（凸：兩邊弧；凹：中間薄）
    ctx.beginPath();
    if (st.lens === 'convex') {
      ctx.moveTo(cx, cy - halfH); ctx.quadraticCurveTo(cx + halfW * 2, cy, cx, cy + halfH); ctx.quadraticCurveTo(cx - halfW * 2, cy, cx, cy - halfH);
    } else {
      ctx.moveTo(cx - halfW, cy - halfH); ctx.lineTo(cx + halfW, cy - halfH); ctx.quadraticCurveTo(cx + (thin || 2), cy, cx + halfW, cy + halfH);
      ctx.lineTo(cx - halfW, cy + halfH); ctx.quadraticCurveTo(cx - (thin || 2), cy, cx - halfW, cy - halfH);
    }
    ctx.closePath(); ctx.fillStyle = 'rgba(150,215,255,.55)'; ctx.fill(); ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function drawLensStand() {
    var k = G.k, R = C.lensRadius, xc = C.lensX, cy = Y(C.axisH);
    base(xc, 7); pole(xc, C.axisH - R - 0.4);
    var cw = 2.2 * k; rr(X(xc) - cw / 2, Y(C.axisH - R - 0.4) - 1, cw, 1 * k, 2); ctx.fillStyle = '#9aa0b0'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.stroke();
    knob(X(xc) + 1.1 * k + 3, Y(C.axisH - R - 0.4) + 3);
    lensShape(X(xc), cy, 0.7 * k, R * k, 0.1 * k);
    text(st.lens === 'convex' ? '凸透鏡' : '凹透鏡', X(xc), Y(C.axisH + R + 0.9), '#9fd8ff', Math.max(11, k * 1.4), 'center');
  }

  function drawScreenStand() {
    var k = G.k, xc = st.screenX, hh = C.screen.h / 2;
    base(xc, 7); pole(xc, C.axisH - hh);
    knob(X(xc) + 0.95 * k + 3, Y(C.axisH - hh) + 6);
    var bw = 0.7 * k, y1 = Y(C.axisH + hh), y2 = Y(C.axisH - hh);
    var g = ctx.createLinearGradient(X(xc) - bw / 2, 0, X(xc) + bw / 2, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9bdc9');
    ctx.fillStyle = g; ctx.fillRect(X(xc) - bw / 2, y1, bw, y2 - y1); ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(X(xc) - bw / 2, y1, bw, y2 - y1);
    text('光屏', X(xc), Y(C.axisH + hh + 0.8), '#e6e9f5', Math.max(11, k * 1.4), 'center');
  }

  function lampBox(x0, y0, w, h, color, dx, dy) { // y0：離光軸的高度（cm）；實驗桌與分析畫面通用
    var k = G.k, x = X(x0) + dx, y = PY(y0 + h) + dy, pw = w * k, ph = h * KY();
    var g = ctx.createLinearGradient(0, y, 0, y + ph); g.addColorStop(0, shade(color, 0.5)); g.addColorStop(0.4, rgba(color, 1)); g.addColorStop(1, shade(color, -0.4));
    rr(x, y, pw, ph, Math.min(pw, ph) * 0.2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(color, -0.6); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; rr(x + pw * 0.08, y + ph * 0.1, pw * 0.84, ph * 0.18, ph * 0.09); ctx.fill();
    var cw = 0.35 * k; rr(x + pw - cw * 0.2, y + ph * 0.18, cw, ph * 0.64, cw * 0.4); ctx.fillStyle = shade(color, 0.7); ctx.fill(); ctx.strokeStyle = shade(color, -0.5); ctx.stroke(); // 燈窗那端的小圓蓋（面向透鏡）
  }
  function drawLampBoxes() {
    var L = C.lamp, s = L.size, w = L.windows, x0 = st.objX - L.len, off = 0.2 * G.k;
    // 側面照：從「正面看的左邊」看過去 → 左排（紅）最近，右排（綠、藍）在後面，稍微往左上錯開表示前後
    lampBox(x0, 0, L.len, s, w[2].color, -off, -off);                 // 綠（後排下）
    lampBox(x0, s, L.len, s, w[0].color, -off, -off);                 // 藍（後排上）
    lampBox(x0, 0, L.len, s, w[1].color, 0, 0);                       // 紅（前排下）
    text('燈具', X(st.objX - L.len / 2), PY(2 * s + 0.9), '#ffb4a8', Math.max(11, G.k * 1.4), 'center');
  }
  function drawLampStand() {
    var k = G.k, L = C.lamp, xc = st.objX - L.len / 2;
    base(xc, 7); pole(xc, C.axisH - 0.3);
    rr(X(xc) - 0.9 * k, Y(C.axisH) - 0.35 * k, 1.8 * k, 0.55 * k, 2); ctx.fillStyle = '#9aa0b0'; ctx.fill(); ctx.strokeStyle = '#444'; ctx.stroke();
    drawLampBoxes();
  }

  function drawAxis() { line(X(-1.5), Y(C.axisH), X(C.benchLength + 1.5), Y(C.axisH), 'rgba(160,175,240,.4)', 1, [6, 5]); }

  /** 自動畫的三條主光線（「示範光路」與分析的「對答案」）。分析時用粗線、深色＋發光，光從物的上端「放出」（短動畫）。 */
  var BOLD = { parallel: '#ff3b3b', center: '#d500f9', focus: '#ff9100' }, animNeed = false;
  function drawRaysBold(list, im, yo, xl, xEnd) {
    var now = performance.now(), p = Math.min(1, (now - st.ansT0) / 1400), ease = 1 - Math.pow(1 - p, 3), tipX = X(st.objX), tipY = PY(yo);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, G.leftW, G.H); ctx.clip(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var hr = 26 * (1 + 0.15 * Math.sin(now / 180)), hg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, hr); // 物上端的光暈
    hg.addColorStop(0, 'rgba(255,255,255,.95)'); hg.addColorStop(0.35, 'rgba(255,214,102,.6)'); hg.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(tipX, tipY, hr, 0, 6.283); ctx.fill();
    list.forEach(function (r) {
      if (r.blocked) return;
      var col = BOLD[r.name], xP = X(xl), yP = PY(r.yP), xe = X(xEnd), ye = PY(r.yP + r.slope * (xEnd - xl));
      var pts = [[tipX, tipY], [xP, yP], [xe, ye]], l1 = Math.hypot(xP - tipX, yP - tipY), l2 = Math.hypot(xe - xP, ye - yP), left = (l1 + l2) * ease, head = [tipX, tipY];
      ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.strokeStyle = col; ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(tipX, tipY);
      [l1, l2].forEach(function (len, i) {
        if (left <= 0) return;
        var t = Math.min(1, left / len), a0 = pts[i], a1 = pts[i + 1];
        head = [a0[0] + (a1[0] - a0[0]) * t, a0[1] + (a1[1] - a0[1]) * t]; ctx.lineTo(head[0], head[1]); left -= len;
      });
      ctx.stroke(); ctx.shadowBlur = 0;
      if (p < 1) { ctx.beginPath(); ctx.arc(head[0], head[1], 6, 0, 6.283); ctx.fillStyle = '#fff'; ctx.fill(); }
      if (p >= 1 && im.dImg < 0 && isFinite(im.dImg)) { // 虛像：反向延長線（虛線）
        var xb = Math.max(0, xl + im.dImg);
        ctx.shadowColor = col; ctx.shadowBlur = 8; line(xP, yP, X(xb), PY(r.yP + r.slope * (xb - xl)), col, 4, [7, 6]); ctx.shadowBlur = 0;
      }
    });
    ctx.restore();
    if (p < 1) animNeed = true;
    return p;
  }

  function drawRays() {
    var f = F(), u = U(), R = C.lensRadius, yo = srcY(), k = G.k, xl = C.lensX, xEnd = st.screenX, ana = st.mode === 'ana';
    var im = O.image(f, u), list = O.rays(f, u, yo, ana ? Infinity : R), p = 1;
    if (ana) p = drawRaysBold(list, im, yo, xl, xEnd);
    else {
      var colors = { parallel: '#ffe066', center: '#7ee0a0', focus: '#ff9f6b' };
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, G.leftW, G.H); ctx.clip();
      ctx.beginPath(); ctx.arc(X(st.objX), PY(yo), 3.5, 0, 6.283); ctx.fillStyle = '#ffe066'; ctx.fill();
      list.forEach(function (r) {
        if (r.blocked) return;
        var col = colors[r.name], xP = X(xl), yP = PY(r.yP);
        line(X(st.objX), PY(yo), xP, yP, col, 1.8);
        line(xP, yP, X(xEnd), PY(r.yP + r.slope * (xEnd - xl)), col, 1.8);   // 光線打到光屏為止
        if (im.dImg < 0 && isFinite(im.dImg)) { // 虛像：反向延長線（虛線）
          var xb = Math.max(0, xl + im.dImg);
          line(xP, yP, X(xb), PY(r.yP + r.slope * (xb - xl)), col, 1.4, [4, 4]);
        }
      });
      ctx.restore();
    }
    if (p >= 1 && isFinite(im.dImg)) { // 像（箭頭）
      var xi = xl + im.dImg, yi = im.m * yo;
      if (xi >= -1 && xi <= C.benchLength + 1) {
        var virt = im.dImg < 0, col2 = virt ? '#c3a6ff' : '#ff7ad9';
        line(X(xi), PY(0), X(xi), PY(yi), col2, 2.4, virt ? [4, 3] : []);
        arrowHead(X(xi), PY(yi), 0, yi >= 0 ? -1 : 1, 7, col2);
        if (!ana) text(virt ? '虛像' : '實像', X(xi) + (virt ? -6 : 6), PY(yi) + (yi >= 0 ? -4 : 12), col2, Math.max(11, k * 1.4), virt ? 'right' : 'left'); // 分析畫面已有標示點的標籤
      }
    }
  }

  function drawMarker() { // 已標記的像（實驗桌視角）
    if (!st.marker) return;
    var x = X(st.marker.x), y = PY(st.marker.y), col = st.marker.virtual ? '#c3a6ff' : '#ff7ad9';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.283); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
    line(x - 11, y, x + 11, y, col, 1.5); line(x, y - 11, x, y + 11, col, 1.5);
    text(st.marker.virtual ? '虛像標記' : '實像標記', x + 12, y - 8, col, Math.max(11, G.k * 1.4), 'left');
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

  var NUDGE_STEP = 0.1;   // 微調一次移動 0.1 cm（像清楚的範圍約 ±0.4～1.6 cm，所以要細）
  function nudgeRects() { // 光屏上方的左右三角鈕（跟著光屏）；大小是手指好按的 44×48 px
    var cx = X(st.screenX), cy = Y(C.axisH + C.screen.h / 2 + 0.8) - 34;
    return [{ dir: -1, x: cx - 56, y: cy - 24, w: 48, h: 48 }, { dir: 1, x: cx + 8, y: cy - 24, w: 48, h: 48 }];
  }
  function drawNudge() {
    nudgeRects().forEach(function (r) {
      var on = st.nudge && st.nudge.dir === r.dir, cx = r.x + r.w / 2, cy = r.y + r.h / 2, d = r.dir;
      ctx.beginPath(); ctx.moveTo(cx + d * 13, cy); ctx.lineTo(cx - d * 11, cy - 17); ctx.lineTo(cx - d * 11, cy + 17); ctx.closePath();
      ctx.fillStyle = on ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.5)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }
  function nudgeScreen(dir) { setX('screen', Math.round((st.screenX + dir * NUDGE_STEP) * 10) / 10, true); sync(); }
  function nudgeStop() { if (st.nudge) { clearTimeout(st.nudge.t1); clearInterval(st.nudge.t2); st.nudge = null; requestRender(); } }

  function drawBench() {
    drawAxis(); drawRuler();
    drawScreenStand(); drawLensStand(); drawLampStand();
    drawFocusMarks(); drawNudge();
    if (st.rays) drawRays();
    drawMarker();
    drawEye();
    if (st.data) drawDims();
    if (st.drag) { // 抓住時的光暈
      var xc = st.drag.who === 'obj' ? st.objX - C.lamp.len / 2 : st.screenX, hw = standHalfWidth(), topH = C.axisH + 2 * C.lamp.size + 0.8;
      ctx.strokeStyle = 'rgba(255,224,102,.8)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      rr(X(xc) - hw, Y(topH), hw * 2, Y(0) - Y(topH) + 2, 8); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // ---------- 分析光路 ----------
  function toPx(p) { return { x: X(p.x), y: PY(p.y) }; }
  function geom(l) {
    if (l.kind === 'parallel') return { p: l.a, d: { x: 1, y: 0 } };
    if (l.kind === 'vertical') return { p: l.a, d: { x: 0, y: 1 } };
    return { p: l.a, d: { x: l.b.x - l.a.x, y: l.b.y - l.a.y } };
  }
  function atX(g, x0) { if (Math.abs(g.d.x) < 1e-9) return null; var t = (x0 - g.p.x) / g.d.x; return { x: x0, y: g.p.y + t * g.d.y }; }
  function meet(g1, g2) {
    var den = g1.d.x * g2.d.y - g1.d.y * g2.d.x; if (Math.abs(den) < 1e-9) return null;
    var t = ((g2.p.x - g1.p.x) * g2.d.y - (g2.p.y - g1.p.y) * g2.d.x) / den; return { x: g1.p.x + t * g1.d.x, y: g1.p.y + t * g1.d.y };
  }
  function strokeLine(l, color, w, dash) { // 通過標示點、自動向兩邊延長的直線
    var a = toPx(l.a), b = l.kind === 'line' ? toPx(l.b) : l.kind === 'parallel' ? { x: a.x + 1, y: a.y } : { x: a.x, y: a.y + 1 };
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); if (len < 1e-6) return; dx /= len; dy /= len;
    line(a.x - dx * 4000, a.y - dy * 4000, a.x + dx * 4000, a.y + dy * 4000, color, w, dash);
  }
  function lineColor(l) { return l.kind === 'line' ? '#ffd166' : '#7dffb2'; }

  /** 可吸附的標示點：O、F（兩側）、物（上端）、像標記，以及學生畫的線與透鏡平面的交點 P。 */
  function snapPoints() {
    var f = F(), xl = C.lensX;
    var pts = [
      { id: 'O', label: 'O', x: xl, y: 0 },
      { id: 'F', label: 'F', x: xl - f, y: 0 },
      { id: 'F2', label: 'F′', x: xl + f, y: 0 },
      { id: 'T', label: '物', x: st.objX, y: srcY() }
    ];
    if (st.marker) pts.push({ id: 'I', label: st.marker.virtual ? '虛像' : '實像', x: st.marker.x, y: st.marker.y });
    st.lines.forEach(function (l) {
      var p = atX(geom(l), xl);
      if (!p || Math.abs(p.y) > anaLensHalfPx() / G.ky) return;
      for (var i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < 0.15) return;
      pts.push({ id: 'P', label: 'P', x: xl, y: p.y });
    });
    return pts;
  }
  var SNAP_PX = 26, AXIS_MIN_PX = 30, AXIS_TOL_PX = 8, AXIS_TOL_RATIO = 0.12, THROUGH_PX = 14;
  function nearestSnap(sx, sy) {
    var best = null, bd = SNAP_PX;
    snapPoints().forEach(function (p) { var q = toPx(p), d = Math.hypot(q.x - sx, q.y - sy); if (d <= bd) { bd = d; best = p; } });
    return best;
  }
  function pointOnDragRay(a, p) { // 從起點往手指方向延伸的線經過某個點（手指不必真的拖到那個點上）
    var a0 = toPx(a), ux = p.x - a0.x, uy = p.y - a0.y, len = Math.hypot(ux, uy), best = null;
    if (len < AXIS_MIN_PX) return null;
    ux /= len; uy /= len;
    snapPoints().forEach(function (sp) {
      if (Math.hypot(sp.x - a.x, sp.y - a.y) < 0.15) return;
      var q = toPx(sp), along = (q.x - a0.x) * ux + (q.y - a0.y) * uy, off = Math.abs((q.x - a0.x) * uy - (q.y - a0.y) * ux);
      if (along <= 0 || off > THROUGH_PX) return;
      var gap = Math.abs(along - len);
      if (!best || off < best.off - 0.5 || (Math.abs(off - best.off) <= 0.5 && gap < best.gap)) best = { sp: sp, off: off, gap: gap };
    });
    return best;
  }
  function updatePreview(p) {
    var g = st.gest, a = { x: g.snap.x, y: g.snap.y, label: g.snap.label };
    var dx = Math.abs(p.x - g.x0), dy = Math.abs(p.y - g.y0), hit = nearestSnap(p.x, p.y), snap = null, b = null;
    if (hit && Math.hypot(hit.x - a.x, hit.y - a.y) >= 0.15) { snap = 'point'; b = { x: hit.x, y: hit.y, label: hit.label }; }
    else {
      var axis = null, axisOff = Infinity;
      if (dx >= AXIS_MIN_PX && dy <= Math.max(AXIS_TOL_PX, dx * AXIS_TOL_RATIO)) { axis = 'h'; axisOff = dy; }
      else if (dy >= AXIS_MIN_PX && dx <= Math.max(AXIS_TOL_PX, dy * AXIS_TOL_RATIO)) { axis = 'v'; axisOff = dx; }
      var thru = pointOnDragRay(a, p);
      if (thru && thru.off <= axisOff) { snap = 'point'; b = { x: thru.sp.x, y: thru.sp.y, label: thru.sp.label }; } else snap = axis;
    }
    var was = st.prev ? st.prev.snap + (st.prev.b ? st.prev.b.label : '') : '', now = snap ? snap + (b ? b.label : '') : '';
    st.prev = { a: a, snap: snap, b: b, cur: p };
    if (now !== was) say(snap === 'point' ? '放開：畫出通過「' + a.label + '」與「' + b.label + '」的直線。'
      : snap === 'h' ? '放開：畫出通過「' + a.label + '」的水平線（平行主光軸）。'
      : snap === 'v' ? '放開：畫出通過「' + a.label + '」的垂直線。'
      : '虛線放開會消失。拖到另一個點上，或拉成水平／垂直，線才會留下。', true);
  }
  function finishDrag(commit) {
    var pv = st.prev; st.prev = null; st.gest = null;
    if (pv && pv.snap && commit) {
      st.lines.push(pv.snap === 'point' ? { kind: 'line', a: pv.a, b: pv.b } : { kind: pv.snap === 'h' ? 'parallel' : 'vertical', a: pv.a });
      say(pv.snap === 'point' ? '已畫出通過「' + pv.a.label + '」與「' + pv.b.label + '」的直線。' : pv.snap === 'h' ? '已畫出通過「' + pv.a.label + '」的水平線。' : '已畫出通過「' + pv.a.label + '」的垂直線。');
    } else say('沒有畫線。從標示點拖到另一個點，或拉成水平／垂直再放開。');
    sync();
  }

  /** 分析畫面的透鏡高度（px）：照課本把透鏡當一整面平面畫，幾乎撐滿畫面；實驗桌視角才是真實口徑。 */
  function anaLensHalfPx() { return (G.H - BAR_H - 8) / 2 - 10; }

  function drawAnalysis() {
    var k = G.k, f = C.f, xl = C.lensX, R = C.lensRadius, ay = PY(0), fs = Math.max(14, k * 2.4), convex = st.lens === 'convex';
    ctx.fillStyle = '#0d1530'; ctx.fillRect(0, 0, G.leftW, G.H);
    // 軸線與刻度（參考圖：白色粗線、F 與 2F 大字）
    line(X(-1.5), ay, X(C.benchLength + 1.5), ay, '#ffffff', 3);
    [-2 * f, -f, 0, f, 2 * f].forEach(function (t) {
      var x = X(xl + t); line(x, ay - 12, x, ay + 12, '#ffffff', 3);
      var lab = t === 0 ? 'O' : (Math.abs(t) > f ? '2F' : 'F') + (((t > 0) === convex) ? '′' : '');
      text(lab, x, ay + 14 + fs, '#ffffff', fs, 'center');
    });
    // 光屏（細白棒）
    var sx = X(st.screenX), hh = C.screen.h / 2;
    line(sx, PY(hh), sx, PY(-hh), '#e6e9f5', 5); text('光屏', sx, PY(hh) - 6, '#e6e9f5', Math.max(12, k * 1.6), 'center');
    // 透鏡（又高又細）
    lensShape(X(xl), ay, 9, anaLensHalfPx(), 2);
    // 物（燈具側面）
    drawLampBoxes();
    // 學生畫的線（粗）與兩線交點
    st.lines.forEach(function (l) { strokeLine(l, lineColor(l), 3.5); });
    if (st.ans) drawRays();
    for (var i = 0; i < st.lines.length; i++) for (var j = i + 1; j < st.lines.length; j++) {
      var p = meet(geom(st.lines[i]), geom(st.lines[j]));
      if (!p || Math.abs(p.y) > 40 || p.x < -5 || p.x > C.benchLength + 5) continue;
      var q = toPx(p); ctx.beginPath(); ctx.arc(q.x, q.y, 4.5, 0, 6.283); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
    // 拖曳中的預覽：能吸附就是實線（放開會留下），否則虛線（放開消失）
    if (st.prev) {
      var pv = st.prev;
      if (pv.snap) strokeLine(pv.snap === 'point' ? { kind: 'line', a: pv.a, b: pv.b } : { kind: pv.snap === 'h' ? 'parallel' : 'vertical', a: pv.a }, pv.snap === 'point' ? '#ffd166' : '#7dffb2', 3.5);
      else { var a0 = toPx(pv.a); line(a0.x, a0.y, pv.cur.x, pv.cur.y, 'rgba(255,255,255,.75)', 2.5, [7, 6]); }
    }
    // 標示點
    snapPoints().forEach(function (sp) {
      var q = toPx(sp), mark = sp.id === 'I' ? (st.marker.virtual ? '#c3a6ff' : '#ff7ad9') : sp.id === 'T' ? '#ffe066' : sp.id === 'P' ? '#ffffff' : '#9fd8ff';
      ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 6.283); ctx.fillStyle = 'rgba(13,21,48,.85)'; ctx.fill(); ctx.strokeStyle = mark; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, 6.283); ctx.fillStyle = mark; ctx.fill();
      if (sp.id === 'I' || sp.id === 'T' || sp.id === 'P') text(sp.label, q.x + 10, q.y + (sp.y < 0 ? 24 : -9), mark, Math.max(12, k * 1.7), 'left');
    });
  }

  function drawSide() {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, G.leftW, G.H); ctx.clip();
    ctx.fillStyle = '#10121b'; ctx.fillRect(0, 0, G.leftW, G.H);
    if (st.mode === 'ana') drawAnalysis(); else drawBench();
    ctx.restore();
  }

  // ---------- 右欄三張小圖：圖在左、說明文字在右 ----------
  function frame(p) { rr(p.x, p.y, p.w, p.h, 8); ctx.fillStyle = '#12141d'; ctx.fill(); ctx.strokeStyle = '#2a2e3e'; ctx.lineWidth = 1; ctx.stroke(); }
  function wrap(s, x, y, maxW, lh, color, size, bold) { // 逐字折行（中文）
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var lineStr = '';
    for (var i = 0; i < s.length; i++) {
      var t = lineStr + s[i];
      if (ctx.measureText(t).width > maxW && lineStr) { ctx.fillText(lineStr, x, y); y += lh; lineStr = s[i]; } else lineStr = t;
    }
    if (lineStr) { ctx.fillText(lineStr, x, y); y += lh; }
    return y;
  }
  function sideText(p, tx, title, caption) { // 標題（灰）＋說明（亮）
    var tw = p.x + p.w - 8 - tx, y = wrap(title, tx, p.y + 18, tw, 15, '#9aa3cc', 12, true);
    if (caption) wrap(caption, tx, y + 8, tw, 16, '#e3e7fa', 13, true);
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
    frame(p);
    var L = C.lamp, span = 2 * L.size + 0.5, ka = Math.min((p.w * 0.5 - 8) / span, (p.h - 14) / span);
    var cx = p.x + 8 + (span * ka) / 2, yb = p.y + p.h - 8;
    line(cx - ka * (span / 2 + 0.2), yb, cx + ka * (span / 2 + 0.2), yb, 'rgba(160,175,240,.3)', 1, [4, 4]);
    [L.windows[1], L.windows[2], L.windows[0]].forEach(function (w) {
      var x = cx + (w.r - L.size / 2) * ka, y = yb - (w.y + L.size / 2) * ka, s2 = L.size * ka, d = 0.16 * ka;
      rr(x - d, y - d, s2, s2, s2 * 0.2); ctx.fillStyle = shade(w.color, -0.55); ctx.fill();          // 後面的燈身（深度）
      var g = ctx.createLinearGradient(0, y, 0, y + s2); g.addColorStop(0, shade(w.color, 0.35)); g.addColorStop(1, shade(w.color, -0.3));
      rr(x, y, s2, s2, s2 * 0.2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(w.color, -0.6); ctx.lineWidth = 1; ctx.stroke();
      var wx = x + s2 / 2, wy = y + s2 / 2, wr = L.windowR * ka;
      ctx.beginPath(); ctx.arc(wx, wy, wr * 1.2, 0, 6.283); ctx.fillStyle = shade(w.color, -0.5); ctx.fill();
      var gg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr); gg.addColorStop(0, '#fff'); gg.addColorStop(0.6, shade(w.color, 0.55)); gg.addColorStop(1, rgba(w.color, 1));
      ctx.beginPath(); ctx.arc(wx, wy, wr, 0, 6.283); ctx.fillStyle = gg; ctx.fill();
    });
    ctx.beginPath(); ctx.arc(cx, yb, 3, 0, 6.283); ctx.fillStyle = '#a0b0ff'; ctx.fill();
    sideText(p, p.x + 16 + span * ka, '燈具正面（透鏡側看）', '');
  }

  function drawScreenView(p) {
    var f = F(), u = U(), s = S(), R = C.lensRadius, L = C.lamp, bw = C.screen.w, bh = C.screen.h;
    var kb = Math.min((p.w * 0.5 - 8) / bw, (p.h - 14) / bh), cx = p.x + 8 + bw * kb / 2, cy = p.y + p.h / 2;
    frame(p);
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
    var msg = st.data ? (st.lens === 'concave' ? '凹透鏡：光屏上不會成像' : maxBlur < 0.12 ? '像很清楚' : '像模糊，移動光屏找清楚的位置') : '';
    sideText(p, p.x + 16 + bw * kb, st.back ? '光屏（背面看）' : '光屏（透鏡側看）', msg);
  }

  var NOUN = { enlarged: '放大', reduced: '縮小', same: '等大' };
  function drawLensView(p) {
    var f = F(), u = U(), d = C.eye.dist, R = C.lensRadius, L = C.lamp;
    frame(p);
    var rc = Math.min((p.w * 0.5 - 8) / 2, (p.h - 14) / 2), kc = rc / R, cx = p.x + 8 + rc, cy = p.y + p.h / 2;
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
    var msg = '';
    if (st.data) {
      var ds = O.describe(f, u);
      if (!focus || huge) msg = '對不到焦（像在眼前太近或在眼睛後面）';
      else if (ds.kind === 'infinity') msg = '像在無限遠（平行光）';
      else msg = (ds.kind === 'real' ? '實像' : '虛像') + '・' + (ds.upright ? '正立' : '倒立') + '・' + NOUN[ds.size];
    }
    sideText(p, p.x + 16 + 2 * rc, '看透鏡（眼睛在後 ' + d + ' cm）', msg);
  }

  function render() {
    if (!G.k) return;
    animNeed = false;
    ctx.clearRect(0, 0, G.W, G.H);
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, G.W, G.H);
    drawSide(); drawScreenView(G.panels[0]); drawLensView(G.panels[1]); drawFront(G.panels[2]);
    if (animNeed) requestRender();
  }
  var pending = false;
  function requestRender() { if (!pending) { pending = true; requestAnimationFrame(function () { pending = false; render(); }); } }

  // ---------- 標記像 ----------
  function markImage() {
    var f = F(), u = U(), s = S(), R = C.lensRadius, yo = srcY(), im = O.image(f, u);
    if (im.infinity) { say('物在焦點上，像在無限遠，無法標記。'); return; }
    var xI = C.lensX + im.dImg, yI = im.m * yo;
    if (im.dImg > 0) { // 實像：要在光屏上看得清楚
      if (R * Math.abs(1 - s / im.dImg) > 0.4) { say('光屏上的像還不夠清楚，請移動光屏再標記。'); return; }
      if (Math.abs(yI) > C.screen.h / 2 || xI > C.range.screenMax) { say('像超出光屏，無法標記。'); return; }
      st.marker = { x: xI, y: yI, virtual: false };
    } else { // 虛像：隔著透鏡看，要看得到
      var lv = O.lensSpot(f, u, C.eye.dist, C.eye.near, { r: 0, y: yo }, 0);
      if (Math.abs(lv.y) > R) { say('像太大，超出鏡片，看不到。'); return; }
      if (xI < 0) { say('像在桌面外，無法標記。'); return; }
      st.marker = { x: xI, y: yI, virtual: true };
    }
    say((st.marker.virtual ? '已標記虛像（隔著透鏡看到的位置）' : '已標記實像（光屏上清楚的位置）') + '。按「分析光路」開始畫圖。');
    sync();
  }
  function clearWork() { st.marker = null; st.lines = []; st.prev = null; st.gest = null; st.ans = false; }

  // ---------- 操作 ----------
  function standHalfWidth() { return Math.max(4 * G.k, 34); }
  function pos(e) { return BenchLandscape.toLocal(e, canvas); }
  function worldX(px) { return (px - G.x0) / G.k; }
  function hit(p) {
    if (p.x > G.leftW || p.y < BAR_H) return null;
    var hw = standHalfWidth(), best = null, bd = 1e9;
    [{ who: 'obj', xc: st.objX - C.lamp.len / 2 }, { who: 'screen', xc: st.screenX }].forEach(function (s) {
      var d = Math.abs(p.x - X(s.xc));
      if (d <= hw && p.y >= Y(C.axisH + 2 * C.lamp.size + 2) && d < bd) { bd = d; best = s; }
    });
    return best;
  }
  var SNAP_CM = 0.7;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function setX(who, x, noSnap) {
    if (who === 'obj') {
      var nx = clamp(Math.round(x * 10) / 10, C.range.objMin, C.range.objMax), snapTo = null;
      [[C.lensX - C.f, 'F'], [C.lensX - 2 * C.f, '2F']].forEach(function (t) { if (Math.abs(nx - t[0]) <= SNAP_CM) { nx = t[0]; snapTo = t[1]; } }); // 經過 F、2F 時吸附一下
      if (snapTo !== st.snapTo) { st.snapTo = snapTo; if (snapTo) { say('燈具吸附在 ' + snapTo + '（物距 ' + (C.lensX - nx) + ' cm）'); try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* ignore */ } } }
      if (nx !== st.objX) { st.objX = nx; clearWork(); }
    }
    else {
      var sx = clamp(Math.round(x * 10) / 10, C.lensX + C.range.screenMinFromLens, C.range.screenMax), ss = null;
      if (!noSnap) [[C.lensX + C.f, 'F'], [C.lensX + 2 * C.f, 'F2']].forEach(function (t) { if (Math.abs(sx - t[0]) <= SNAP_CM) { sx = t[0]; ss = t[1]; } }); // 光屏經過焦點時吸附一下
      if (ss !== st.snapScr) { st.snapScr = ss; if (ss) { say('光屏吸附在' + (ss === 'F' ? ' F' : ' 2F') + '（像距 ' + (sx - C.lensX) + ' cm）'); try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* ignore */ } } }
      st.screenX = sx;
    }
  }
  canvas.addEventListener('pointerdown', function (e) {
    var p = pos(e);
    if (st.mode === 'ana') {
      if (p.x > G.leftW) return;
      var sp = nearestSnap(p.x, p.y);
      if (!sp) { say('從標示點（O、F、物、像…）開始拖曳畫線。'); return; }
      st.gest = { id: e.pointerId, snap: sp, x0: p.x, y0: p.y, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault(); return;
    }
    var nr = nudgeRects().filter(function (r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; })[0];
    if (nr) { // 按住會連續微調
      nudgeStop(); nudgeScreen(nr.dir);
      st.nudge = { dir: nr.dir, id: e.pointerId, t1: setTimeout(function () { st.nudge.t2 = setInterval(function () { nudgeScreen(nr.dir); }, 70); }, 380), t2: null };
      try { canvas.setPointerCapture(e.pointerId); } catch (err3) { /* ignore */ }
      e.preventDefault(); requestRender(); return;
    }
    var h = hit(p); if (!h) return;
    st.drag = { who: h.who, dx: worldX(p.x) - h.xc, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (err2) { /* ignore */ }
    e.preventDefault(); requestRender();
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = pos(e);
    if (st.gest && e.pointerId === st.gest.id) {
      if (!st.gest.moved && Math.hypot(p.x - st.gest.x0, p.y - st.gest.y0) > 6) st.gest.moved = true;
      if (st.gest.moved) { updatePreview(p); requestRender(); }
      e.preventDefault(); return;
    }
    if (!st.drag || e.pointerId !== st.drag.id) return;
    var x = worldX(p.x) - st.drag.dx;
    setX(st.drag.who, st.drag.who === 'obj' ? x + C.lamp.len / 2 : x);
    e.preventDefault(); sync();
  });
  function endPointer(e, cancelled) {
    if (st.nudge && e.pointerId === st.nudge.id) { nudgeStop(); return; }
    if (st.gest && e.pointerId === st.gest.id) { if (st.gest.moved) finishDrag(!cancelled); else { st.gest = null; st.prev = null; sync(); } return; }
    if (st.drag && e.pointerId === st.drag.id) { st.drag = null; sync(); }
  }
  canvas.addEventListener('pointerup', function (e) { endPointer(e, false); });
  canvas.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // 拖曳時不讓瀏覽器啟動甩動（fling）：快甩放開後第一次點按鈕會被吃掉（遊戲本體實測過）
  canvas.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });

  // ---------- 按鈕 ----------
  function sync() {
    var ana = st.mode === 'ana';
    $('grp-obs').hidden = ana; $('grp-ana').hidden = !ana;
    $('b-convex').setAttribute('aria-pressed', st.lens === 'convex'); $('b-concave').setAttribute('aria-pressed', st.lens === 'concave');
    $('t-rays').setAttribute('aria-pressed', st.rays); $('t-data').setAttribute('aria-pressed', st.data); $('t-ans').setAttribute('aria-pressed', st.ans);
    $('t-back').setAttribute('aria-pressed', st.back); $('t-back').textContent = st.back ? '光屏：背面看' : '光屏：透鏡側看';
    $('b-undo').disabled = !st.lines.length; $('b-clear').disabled = !st.lines.length;
    if (G.k) anaScale();
    requestRender();
  }
  function setLens(l) { if (st.lens !== l) { st.lens = l; clearWork(); } sync(); }
  $('b-convex').onclick = function () { setLens('convex'); };
  $('b-concave').onclick = function () { setLens('concave'); };
  $('b-mark').onclick = markImage;
  $('b-ana').onclick = function () {
    if (!st.marker) { say('請先移動光屏找到清楚的像（凹透鏡或焦點內的虛像，則隔著透鏡看），再按「找到像了」。'); return; }
    st.mode = 'ana'; st.drag = null; sync(); say('從標示點（O、F、物、像）拖曳到另一個點，或拉成水平線，畫出光的路徑。', true);
  };
  $('b-back').onclick = function () { st.mode = 'obs'; st.prev = null; st.gest = null; st.ans = false; say(''); sync(); };
  $('b-undo').onclick = function () { st.lines.pop(); sync(); };
  $('b-clear').onclick = function () { st.lines = []; sync(); };
  $('t-ans').onclick = function () { st.ans = !st.ans; if (st.ans) st.ansT0 = performance.now(); sync(); };
  $('t-rays').onclick = function () { st.rays = !st.rays; sync(); };
  $('t-data').onclick = function () { st.data = !st.data; sync(); };
  $('t-back').onclick = function () { st.back = !st.back; sync(); };
  $('b-reset').onclick = function () { st.objX = C.start.objX; st.screenX = C.start.screenX; clearWork(); say(''); sync(); };

  function onResize() { if (layout()) requestRender(); }
  window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize); window.addEventListener('benchlandscape', function () { requestAnimationFrame(onResize); });
  window.BenchDebug = { nudgeRects: nudgeRects, state: st, geom: G, X: X, Y: Y, PY: PY, render: render, layout: layout, snapPoints: snapPoints, markImage: markImage };
  onResize(); sync();
})();

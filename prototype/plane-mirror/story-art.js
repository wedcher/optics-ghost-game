/*
 * story-art.js — 第一關開場與「丟圓盤」段落用的圖。
 *
 * 正式圖還沒生（使用者 2026-11-18：晚點生），先用程式畫的暫代圖，右下角標「暫代圖」。
 * 有正式圖之後：把檔案放進 assets/，在 FILES 填路徑（例如 'assets/story-castle.webp'），暫代圖就不會再用。
 *   castle：古堡外觀（開場第一句）
 *   letter：桌上的信＋壓在上面的古老金屬圓盤（信上的字不要畫進圖，程式會用 HTML 疊上去）
 *   disc  ：圓盤小圖（對話框左邊，透明背景）
 */
(function (root) {
  'use strict';
  var FILES = { castle: null, letter: null, disc: null };

  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function stamp(g, w, h) {
    g.font = '600 22px system-ui,sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText('暫代圖', w - 18, h - 14);
  }

  function castle() {
    var w = 1280, h = 720, c = canvas(w, h), g = c.getContext('2d');
    var sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b0f2a'); sky.addColorStop(0.7, '#27244a'); sky.addColorStop(1, '#3a2d4c');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 90; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.2 + 0.6 * ((i * 37) % 10) / 10) + ')'; g.fillRect((i * 151) % w, (i * 83) % (h * 0.55), 2, 2); }
    var mg = g.createRadialGradient(980, 140, 10, 980, 140, 160);
    mg.addColorStop(0, 'rgba(255,248,220,1)'); mg.addColorStop(0.35, 'rgba(255,240,200,.9)'); mg.addColorStop(0.4, 'rgba(255,240,200,.18)'); mg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = mg; g.fillRect(780, 0, 400, 320);
    g.fillStyle = '#120f1f';
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, 600); g.quadraticCurveTo(320, 540, 640, 575); g.quadraticCurveTo(960, 610, w, 560); g.lineTo(w, h); g.fill();
    // 城堡剪影
    g.fillStyle = '#0a0812';
    g.fillRect(380, 360, 520, 230);
    [[340, 260, 90, 330], [560, 220, 150, 370], [850, 280, 90, 310]].forEach(function (t) {
      g.fillRect(t[0], t[1], t[2], t[3]);
      for (var x = t[0]; x < t[0] + t[2]; x += 22) g.fillRect(x, t[1] - 16, 13, 16);
      g.beginPath(); g.moveTo(t[0] - 6, t[1] - 16); g.lineTo(t[0] + t[2] / 2, t[1] - 16 - t[2] * 0.9); g.lineTo(t[0] + t[2] + 6, t[1] - 16); g.fill();
    });
    for (var x2 = 380; x2 < 900; x2 += 26) g.fillRect(x2, 344, 15, 16);
    g.fillStyle = '#ffcf6b';
    [[372, 330], [612, 300], [650, 300], [470, 430], [760, 440], [880, 360]].forEach(function (p) { g.fillRect(p[0], p[1], 14, 22); });
    g.fillStyle = 'rgba(255,207,107,.15)'; g.fillRect(600, 520, 70, 70);
    stamp(g, w, h);
    return c.toDataURL('image/jpeg', 0.86);
  }

  function discOn(g, cx, cy, r) {
    var m = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    m.addColorStop(0, '#f2e3b3'); m.addColorStop(0.45, '#b8975a'); m.addColorStop(1, '#5c4422');
    g.fillStyle = m; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(60,40,15,.85)'; g.lineWidth = Math.max(1.5, r * 0.04);
    g.beginPath(); g.arc(cx, cy, r * 0.82, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * 0.5, 0, Math.PI * 2); g.stroke();
    for (var k = 0; k < 6; k++) { // 六角形的符紋，和法陣呼應
      var a1 = k * Math.PI / 3, a2 = (k + 2) * Math.PI / 3;
      g.beginPath(); g.moveTo(cx + Math.cos(a1) * r * 0.78, cy + Math.sin(a1) * r * 0.78); g.lineTo(cx + Math.cos(a2) * r * 0.78, cy + Math.sin(a2) * r * 0.78); g.stroke();
    }
    g.fillStyle = 'rgba(60,40,15,.85)'; g.beginPath(); g.arc(cx, cy, r * 0.1, 0, Math.PI * 2); g.fill();
  }

  function letter() {
    var w = 1280, h = 720, c = canvas(w, h), g = c.getContext('2d');
    var wood = g.createLinearGradient(0, 0, w, h);
    wood.addColorStop(0, '#2a1a10'); wood.addColorStop(1, '#3d2616');
    g.fillStyle = wood; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
    for (var y = 20; y < h; y += 46) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(400, y + 12, 800, y - 10, w, y + 6); g.stroke(); }
    var lamp = g.createRadialGradient(620, 300, 40, 620, 300, 620);
    lamp.addColorStop(0, 'rgba(255,200,120,.35)'); lamp.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = lamp; g.fillRect(0, 0, w, h);
    g.save(); g.translate(640, 330); g.rotate(-0.03);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-300, -205, 610, 430);
    g.fillStyle = '#e9dcbc'; g.fillRect(-310, -215, 610, 430);
    g.restore();
    discOn(g, 905, 470, 95);
    stamp(g, w, h);
    return c.toDataURL('image/jpeg', 0.86);
  }

  function disc() {
    var c = canvas(160, 160), g = c.getContext('2d');
    discOn(g, 80, 80, 70);
    return c.toDataURL('image/png');
  }

  var cache = {};
  var MAKERS = { castle: castle, letter: letter, disc: disc };
  function get(key) {
    if (FILES[key]) return FILES[key];
    if (!cache[key]) cache[key] = MAKERS[key]();
    return cache[key];
  }
  root.StoryArt = { get: get, placeholder: function (key) { return !FILES[key]; } };
})(window);

/*
 * ray-replay.js — 破關後的「光路重現」動畫（正推解答）。
 *
 * 玩家平常是由像逆推鬼的位置；封印成功後，系統把正向的成像過程演一次：
 * 鬼本體 → 光線 → 透鏡 → 像怎麼形成。
 *
 * 這個檔案只負責「依時間畫出一段一段長出來的線、標示點與說明文字」，
 * 不含任何光學計算；每一關把自己的光路（由 optics-core 算出的座標）整理成 spec 傳進來。
 *
 * spec = {
 *   duration: 秒,
 *   segments: [{ a:{x,y}, b:{x,y}, start, end, kind:'ray'|'extension' }],  // 世界座標
 *   points:   [{ p:{x,y}, start, label }],
 *   captions: [{ start, text }]
 * }
 */
(function (root) {
  'use strict';

  var RAY_COLOR = '#ffe08a';        // 實際光線：實線
  var EXT_COLOR = '#ff9be6';        // 反向延長線：虛線
  var POINT_COLOR = '#ff5fd2';

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { return t * t * (3 - 2 * t); }

  /**
   * 畫出時間 tau（秒）時的畫面。w2s：世界座標 → 螢幕座標。
   * area：{ x, y, w, h } 說明文字要置中的區域（螢幕座標）。
   */
  function draw(ctx, w2s, spec, tau, area) {
    var i;
    ctx.save();
    ctx.lineCap = 'round';
    for (i = 0; i < spec.segments.length; i++) {
      var sg = spec.segments[i];
      if (tau <= sg.start) continue;
      var k = ease(clamp01((tau - sg.start) / (sg.end - sg.start)));
      var a = w2s(sg.a), bEnd = w2s(sg.b);
      var b = { x: a.x + (bEnd.x - a.x) * k, y: a.y + (bEnd.y - a.y) * k };
      var ext = sg.kind === 'extension';
      ctx.strokeStyle = ext ? EXT_COLOR : RAY_COLOR;
      ctx.lineWidth = ext ? 2 : 3;
      ctx.setLineDash(ext ? [7, 6] : []);
      ctx.shadowColor = ext ? 'rgba(255,120,220,.6)' : 'rgba(255,220,120,.7)';
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // 實際光線在行進中的前端畫一個亮點；走完後在中段畫箭頭表示方向
      if (!ext) {
        ctx.setLineDash([]);
        if (k < 1) {
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, 7); ctx.fill();
        } else {
          var len = Math.hypot(bEnd.x - a.x, bEnd.y - a.y);
          if (len > 40) {
            var ux = (bEnd.x - a.x) / len, uy = (bEnd.y - a.y) / len, mx = a.x + ux * len * 0.55, my = a.y + uy * len * 0.55;
            ctx.fillStyle = RAY_COLOR;
            ctx.beginPath(); ctx.moveTo(mx + ux * 7, my + uy * 7);
            ctx.lineTo(mx - ux * 5 - uy * 5, my - uy * 5 + ux * 5);
            ctx.lineTo(mx - ux * 5 + uy * 5, my - uy * 5 - ux * 5);
            ctx.closePath(); ctx.fill();
          }
        }
      }
    }
    ctx.setLineDash([]); ctx.shadowBlur = 0;
    for (i = 0; i < (spec.points || []).length; i++) {
      var pt = spec.points[i];
      if (tau <= pt.start) continue;
      var q = w2s(pt.p), age = tau - pt.start;
      var pulse = age < 0.9 ? 1 - age / 0.9 : 0;
      ctx.strokeStyle = POINT_COLOR; ctx.lineWidth = 2.5;
      if (pulse > 0) { ctx.globalAlpha = pulse; ctx.beginPath(); ctx.arc(q.x, q.y, 8 + (1 - pulse) * 26, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = POINT_COLOR; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.stroke();
    }
    // 說明文字：顯示目前階段的那一句
    var text = null;
    for (i = 0; i < (spec.captions || []).length; i++) if (tau >= spec.captions[i].start) text = spec.captions[i].text;
    if (text && area) {
      ctx.font = '600 15px system-ui, -apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var tw = Math.min(area.w - 16, ctx.measureText(text).width + 28), th = 32;
      var cx = area.x + area.w / 2, cy = area.y + th / 2 + 8;
      ctx.fillStyle = 'rgba(14,12,30,.88)'; ctx.strokeStyle = '#b980ff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, 10); else ctx.rect(cx - tw / 2, cy - th / 2, tw, th);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(text, cx, cy, tw - 16);
    }
    ctx.restore();
  }

  root.RayReplay = { draw: draw, RAY_COLOR: RAY_COLOR, EXT_COLOR: EXT_COLOR };
})(typeof self !== 'undefined' ? self : this);

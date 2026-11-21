/**
 * 封印成功特效（三關共用，使用者 2026-11-21）：
 * 地上的法陣往上長出圓筒狀的紫色光，三條螺旋線一圈圈往上捲、纏繞鬼，慢慢收緊，最後淡出。
 *
 * 和場景的投影無關：各關傳一個 project(x, y, z) → { x, y, depth }（畫布座標＋深度，深度越大越遠）。
 *   x、z：地板上的位置（z 是往畫面裡的方向），y：高度。單位隨各關（第一關是格子單位，第二三關是畫布 px）。
 * 分兩次畫：鬼的後面（pass 'back'）和前面（pass 'front'），看起來像繞著鬼轉。
 *
 * 時間軸（秒，從鬼顯形那一刻起）：0～0.6 光柱往上長；0.6～2.2 旋轉並收緊；2.2～3.0 淡出。
 *   SealFx.ghostAlpha(t)：第一關的鬼本體與鏡中的像跟著在 2.2～3.0 淡出（第二三關不用，鬼留著讓學生復盤）。
 */
(function (root) {
  'use strict';
  var RISE = 0.6, TIGHT = 2.2, END = 3.0;
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(u) { return 1 - Math.pow(1 - clamp(u), 3); }

  function timeline(t) {
    return {
      height: ease(t / RISE),
      radius: 1 - 0.4 * ease((t - RISE) / (TIGHT - RISE)),
      alpha: t < 0 ? 0 : t < 0.15 ? t / 0.15 : t > TIGHT ? clamp(1 - (t - TIGHT) / (END - TIGHT)) : 1
    };
  }

  /**
   * o: { cx, cz（地板中心）, r（半徑）, h（高度）, line（線寬 px）, glow（光暈 px）, project }
   * 回傳 true＝還在播（呼叫端要繼續要求下一格畫面）。
   */
  function draw(ctx, o, t, pass) {
    if (t < 0 || t > END) return t >= 0 ? false : true;
    var tl = timeline(t), H = o.h * tl.height, R = o.r * tl.radius, spin = t * 5.2;
    if (tl.alpha <= 0 || H <= 0) return true;
    var center = o.project(o.cx, H * 0.5, o.cz);
    if (!center) return true;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = '#b060ff'; ctx.shadowBlur = o.glow || 10;
    var N = 46, strands = 3, k, i;
    for (k = 0; k < strands; k++) {
      var phase = k * Math.PI * 2 / strands, prev = null;
      for (i = 0; i <= N; i++) {
        var u = i / N, y = H * u, a = phase + spin + u * Math.PI * 4.2;
        var rr = R * (1 - 0.18 * u);
        var p = o.project(o.cx + Math.cos(a) * rr, y, o.cz + Math.sin(a) * rr);
        if (!p) { prev = null; continue; }
        if (prev) {
          var front = (p.depth + prev.depth) / 2 <= center.depth;
          if ((pass === 'front') === front) {
            // 越往上越淡，前面亮、後面暗
            var fade = tl.alpha * (1 - 0.65 * u) * (front ? 1 : 0.45);
            ctx.globalAlpha = fade;
            ctx.strokeStyle = front ? '#e6c4ff' : '#a46cff';
            ctx.lineWidth = (o.line || 2.5) * (1 - 0.4 * u);
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          }
        }
        prev = p;
      }
    }
    if (pass === 'back') {
      // 圓筒狀的淡紫光（只畫一次，在鬼後面）
      var b = o.project(o.cx, 0, o.cz), top = o.project(o.cx, H, o.cz), l = o.project(o.cx - R, 0, o.cz), rt = o.project(o.cx + R, 0, o.cz);
      if (b && top && l && rt) {
        var g = ctx.createLinearGradient(0, top.y, 0, b.y);
        g.addColorStop(0, 'rgba(190,120,255,0)'); g.addColorStop(1, 'rgba(190,120,255,.28)');
        ctx.globalAlpha = tl.alpha; ctx.shadowBlur = 0; ctx.fillStyle = g;
        ctx.fillRect(Math.min(l.x, rt.x), top.y, Math.abs(rt.x - l.x), b.y - top.y);
      }
    }
    ctx.restore();
    return true;
  }

  function ghostAlpha(t) { return t <= TIGHT ? 1 : clamp(1 - (t - TIGHT) / (END - TIGHT)); }

  root.SealFx = { draw: draw, ghostAlpha: ghostAlpha, END: END, TIGHT: TIGHT };
})(typeof window !== 'undefined' ? window : this);

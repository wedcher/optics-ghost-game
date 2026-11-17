/*
 * mirror-core.js — 平面鏡房間的純幾何計算，不含任何畫面程式。
 *
 * 瀏覽器：<script> 載入後為 window.MirrorCore。
 * Node：require() 取得同一份 API（供 tests/check-geometry-mirror.js 使用）。
 *
 * 房間座標（單位：一塊地磚的邊長）：
 *   x：沿正面牆往右，左牆 x = 0，右牆 x = cols。
 *   z：離正面牆的距離，正面牆 z = 0，往玩家的方向增加。
 *   y：高度，地板 y = 0。
 * 地板格：第 col 欄（1 起算，由左往右）是 x ∈ [col-1, col]；
 *         第 row 排（1 起算，由正面牆往玩家）是 z ∈ [row-1, row]。
 *
 * 平面鏡只有兩種：貼在正面牆（平面 z = value）或側牆（平面 x = value）。
 * 鏡射的組合寫成 T = {sx, ox, sz, oz}：x' = sx·x + ox，z' = sz·z + oz（y 不變）。
 * 「透過鏡子看到的畫面」＝ 把整個房間用 T 搬到鏡後，再透過鏡面那個洞看過去。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MirrorCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NEAR = 0.05;
  var IDENTITY = { sx: 1, ox: 0, sz: 1, oz: 0 };

  // ---------- 相機（針孔模型，只有左右轉，沒有俯仰） ----------
  function makeCamera(c) {
    var th = (c.yawDeg || 0) * Math.PI / 180;
    return { f: c.f, cx: c.cx, cy: c.cy, eye: c.eye, cos: Math.cos(th), sin: Math.sin(th) };
  }
  // 世界座標 → 相機座標（x 右、y 下、z 前）
  function toCam(cam, p) {
    var dx = p.x - cam.eye.x, dz = p.z - cam.eye.z;
    return { x: dx * cam.cos + dz * cam.sin, y: cam.eye.y - p.y, z: dx * cam.sin - dz * cam.cos };
  }
  function camToScreen(cam, q) {
    return { x: cam.cx + cam.f * q.x / q.z, y: cam.cy + cam.f * q.y / q.z, depth: q.z };
  }
  // 在相機後面（或太近）回傳 null
  function project(cam, p) {
    var q = toCam(cam, p);
    return q.z > NEAR ? camToScreen(cam, q) : null;
  }
  // 多邊形先對近平面裁切再投影；全部在相機後面時回傳空陣列
  function projectPoly(cam, pts) {
    var q = pts.map(function (p) { return toCam(cam, p); }), out = [], i, a, b, t;
    for (i = 0; i < q.length; i++) {
      a = q[i]; b = q[(i + 1) % q.length];
      if (a.z > NEAR) out.push(a);
      if ((a.z > NEAR) !== (b.z > NEAR)) {
        t = (NEAR - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
      }
    }
    return out.map(function (c) { return camToScreen(cam, c); });
  }
  // 畫面上的點 → 落在指定平面上的世界座標。plane = {axis:'x'|'y'|'z', value}
  function unproject(cam, s, plane) {
    var a = (s.x - cam.cx) / cam.f, b = (s.y - cam.cy) / cam.f;
    var d = { x: a * cam.cos + cam.sin, y: -b, z: a * cam.sin - cam.cos };
    var t = (plane.value - cam.eye[plane.axis]) / d[plane.axis];
    if (!(t > 0) || !isFinite(t)) return null;
    return { x: cam.eye.x + d.x * t, y: cam.eye.y + d.y * t, z: cam.eye.z + d.z * t };
  }

  // ---------- 鏡射 ----------
  function reflectT(T, mirror) {
    // T∘R：先對鏡面鏡射，再套用 T
    if (mirror.axis === 'x') return { sx: -T.sx, ox: 2 * mirror.value * T.sx + T.ox, sz: T.sz, oz: T.oz };
    return { sx: T.sx, ox: T.ox, sz: -T.sz, oz: 2 * mirror.value * T.sz + T.oz };
  }
  function apply(T, p) { return { x: T.sx * p.x + T.ox, y: p.y, z: T.sz * p.z + T.oz }; }
  function chainT(room, ids) {
    var T = IDENTITY;
    ids.forEach(function (id) { T = reflectT(T, room.mirrors[id]); });
    return T;
  }
  // 鏡面（玻璃）的四個角，世界座標；上緣可以略斜（照圖量的）
  function mirrorPoly(m) {
    var g = m.glass;
    if (m.axis === 'z') return [
      { x: g.a, y: g.topA, z: m.value }, { x: g.b, y: g.topB, z: m.value },
      { x: g.b, y: g.bottom, z: m.value }, { x: g.a, y: g.bottom, z: m.value }];
    return [
      { x: m.value, y: g.topA, z: g.a }, { x: m.value, y: g.topB, z: g.b },
      { x: m.value, y: g.bottom, z: g.b }, { x: m.value, y: g.bottom, z: g.a }];
  }

  // ---------- 小工具 ----------
  function pointInPoly(p, poly) {
    var inside = false, i, j, a, b;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a = poly[i]; b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function cellCenter(col, row) { return { x: col - 0.5, y: 0, z: row - 0.5 }; }
  function cellPoly(col, row) {
    return [{ x: col - 1, y: 0, z: row - 1 }, { x: col, y: 0, z: row - 1 }, { x: col, y: 0, z: row }, { x: col - 1, y: 0, z: row }];
  }
  function cellId(col, row) { return 'c' + col + 'r' + row; }

  // ---------- 鬼與像 ----------
  // 鬼是一片立在格子中央、平行正面牆的半透明人形（寬 width、高 height）。
  function ghostQuad(room, cell) {
    var c = cellCenter(cell.col, cell.row), w = room.ghost.width / 2, h = room.ghost.height;
    return {
      bl: { x: c.x - w, y: 0, z: c.z }, br: { x: c.x + w, y: 0, z: c.z },
      tl: { x: c.x - w, y: h, z: c.z }, tr: { x: c.x + w, y: h, z: c.z }
    };
  }
  // 虛像的位置（把物點對鏡面鏡射）
  function imageOf(room, p, ids) { return apply(chainT(room, ids), p); }

  // 從玩家的視點，這一格的鬼在某面鏡裡看得到多少。
  // 檢查腳、身體中央、頭頂三個點的像是否落在鏡面範圍內（等同於視線穿過鏡面）。
  function visibility(room, cam, cell, mirrorId) {
    var m = room.mirrors[mirrorId], T = reflectT(IDENTITY, m);
    var glass = projectPoly(cam, mirrorPoly(m));
    var c = cellCenter(cell.col, cell.row), h = room.ghost.height, w = room.ghost.width / 2;
    function seen(x, y) {
      var s = project(cam, apply(T, { x: x, y: y, z: c.z }));
      return !!s && pointInPoly(s, glass);
    }
    var r = {
      feet: seen(c.x, 0.02), mid: seen(c.x, h * 0.5), head: seen(c.x, h * 0.95),
      left: seen(c.x - w, h * 0.5), right: seen(c.x + w, h * 0.5)
    };
    r.core = r.feet && r.mid && r.head;          // 腳、身體、頭都看得到（左右邊緣可能被鏡框切掉一點）
    r.full = r.core && r.left && r.right;        // 整隻都在鏡面裡
    r.any = r.feet || r.mid || r.head || r.left || r.right;
    return r;
  }

  // 玩家點得到的格子：格子中央在畫面內（留一點邊）
  function selectableCells(room, cam) {
    var out = [], col, row, img = room.image, M = 20;
    for (row = 1; row <= room.rows; row++) for (col = 1; col <= room.cols; col++) {
      var s = project(cam, cellCenter(col, row));
      if (s && s.x >= M && s.x <= img.w - M && s.y >= M && s.y <= img.h - M) out.push({ col: col, row: row });
    }
    return out;
  }
  // 可以出題的格子。
  // 單鏡（mirrorIds 只有一面）：那面鏡裡看得到鬼的腳、身體、頭。
  // 雙鏡：至少一面鏡裡看得到腳、身體、頭，而且另一面鏡裡也至少看得到一部分。
  function eligibleCells(room, cam, mirrorIds) {
    return selectableCells(room, cam).filter(function (cell) {
      var v = mirrorIds.map(function (id) { return visibility(room, cam, cell, id); });
      return v.some(function (x) { return x.core; }) && v.every(function (x) { return x.any; });
    });
  }

  return {
    NEAR: NEAR, IDENTITY: IDENTITY,
    makeCamera: makeCamera, toCam: toCam, project: project, projectPoly: projectPoly, unproject: unproject,
    reflectT: reflectT, apply: apply, chainT: chainT, mirrorPoly: mirrorPoly,
    pointInPoly: pointInPoly, cellCenter: cellCenter, cellPoly: cellPoly, cellId: cellId,
    ghostQuad: ghostQuad, imageOf: imageOf, visibility: visibility,
    selectableCells: selectableCells, eligibleCells: eligibleCells
  };
});

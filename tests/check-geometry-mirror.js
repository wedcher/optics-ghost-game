#!/usr/bin/env node
/*
 * 平面鏡房間的幾何檢查（不需要瀏覽器）：node tests/check-geometry-mirror.js
 *
 *   1. 相機參數和背景圖對得上（牆角、牆腳線、鏡框內緣）。
 *   2. 鏡射本身正確：物距 = 像距、連線垂直鏡面、反射定律、兩次鏡射的組合。
 *   3. 「像在畫面上落在鏡面範圍內」和獨立的 3D 視線檢查結果一致。
 *   4. 出題的格子夠用、都點得到、鏡子裡看得到；不同的格子不會給出一樣的畫面（答案唯一）。
 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../prototype/shared/mirror-core.js'));
const R = require(path.join(__dirname, '../prototype/plane-mirror/configs.js'));
const cam = C.makeCamera(R.camera);

let failures = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (!cond) failures++;
  if (!cond || process.env.VERBOSE) console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + detail : ''));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const P = (x, y, z) => C.project(cam, { x, y, z });
const id = (c) => C.cellId(c.col, c.row);

// ---------- 1. 相機和背景圖 ----------
console.log('1. 相機參數 vs 背景圖（影像座標，px）');
[
  ['正面牆左下角', P(0, 0, 0), { x: 245, y: 570 }, 6],
  ['正面牆右下角', P(R.cols, 0, 0), { x: 1125, y: 549 }, 6],
  ['正面鏡玻璃左上角', P(R.mirrors.back.glass.a, R.mirrors.back.glass.topA, 0), { x: 432, y: 150 }, 6],
  ['正面鏡玻璃右上角', P(R.mirrors.back.glass.b, R.mirrors.back.glass.topB, 0), { x: 938, y: 172 }, 6],
  ['右鏡玻璃遠端上角', P(R.cols, R.mirrors.right.glass.topA, R.mirrors.right.glass.a), { x: 1200, y: 165 }, 6],
  ['右鏡玻璃近端上角', P(R.cols, R.mirrors.right.glass.topB, R.mirrors.right.glass.b), { x: 1578, y: 58 }, 6],
  ['原圖正面鏡下框（左）', P(R.mirrors.back.glass.a, R.paintedBottom, 0), { x: 432, y: 510 }, 8],
  ['原圖正面鏡下框（右）', P(R.mirrors.back.glass.b, R.paintedBottom, 0), { x: 938, y: 500 }, 8],
  ['原圖右鏡下框（遠）', P(R.cols, R.paintedBottom, R.mirrors.right.glass.a), { x: 1200, y: 522 }, 8],
  ['原圖右鏡下框（近）', P(R.cols, R.paintedBottom, R.mirrors.right.glass.b), { x: 1578, y: 668 }, 20] // 近端的下框量到的是 0.20 格，設定取 0.25（只用來畫碎鏡在鏡中的樣子）
].forEach(([label, got, want, tol]) => ok(got && dist(got, want) <= tol, label, got && `算出 (${got.x.toFixed(0)}, ${got.y.toFixed(0)})，圖上量到 (${want.x}, ${want.y})`));
// 牆腳線：圖上量到的直線 左 y = 570 + 0.94(245 − x)、右 y = 548 + 0.43(x − 1125)
[1, 2, 3, 4].forEach((z) => {
  const l = P(0, 0, z), r = P(R.cols, 0, z);
  ok(Math.abs(l.y - (570 + 0.94 * (245 - l.x))) <= 8, `左牆腳線 z=${z}`, `差 ${(l.y - (570 + 0.94 * (245 - l.x))).toFixed(1)} px`);
  ok(Math.abs(r.y - (548 + 0.43 * (r.x - 1125))) <= 8, `右牆腳線 z=${z}`, `差 ${(r.y - (548 + 0.43 * (r.x - 1125))).toFixed(1)} px`);
});
// unproject 是 project 的反運算
[[300, 600], [900, 700], [1500, 800]].forEach(([x, y]) => {
  const w = C.unproject(cam, { x, y }, { axis: 'y', value: 0 }), s = C.project(cam, w);
  ok(Math.abs(w.y) < 1e-9 && dist(s, { x, y }) < 1e-6, `unproject∘project (${x},${y})`);
});

// ---------- 2. 鏡射 ----------
console.log('2. 鏡射');
const allCells = [];
for (let row = 1; row <= R.rows; row++) for (let col = 1; col <= R.cols; col++) allCells.push({ col, row });
allCells.forEach((cell) => {
  const o = C.cellCenter(cell.col, cell.row);
  Object.keys(R.mirrors).forEach((mid) => {
    const m = R.mirrors[mid], im = C.imageOf(R, o, [mid]);
    const ax = m.axis, other = ax === 'x' ? 'z' : 'x';
    ok(Math.abs((m.value - o[ax]) - (im[ax] - m.value)) < 1e-9, `${id(cell)} ${mid}：物距 = 像距`);
    ok(Math.abs(o[other] - im[other]) < 1e-9 && im.y === o.y, `${id(cell)} ${mid}：物與像的連線垂直鏡面`);
    // 像落在「鏡後那一格」的正中央
    ok(Math.abs((im.x % 1 + 1) % 1 - 0.5) < 1e-9 && Math.abs((im.z % 1 + 1) % 1 - 0.5) < 1e-9, `${id(cell)} ${mid}：像在鏡後格子的正中央`);
    // 反射定律：眼 → 像 的直線交鏡面於 M；物→M 與 M→眼 對法線的夾角相等
    const e = cam.eye, t = (m.value - e[ax]) / (im[ax] - e[ax]);
    const M = { x: e.x + (im.x - e.x) * t, y: e.y + (im.y - e.y) * t, z: e.z + (im.z - e.z) * t };
    const vin = { x: M.x - o.x, y: M.y - o.y, z: M.z - o.z }, vout = { x: e.x - M.x, y: e.y - M.y, z: e.z - M.z };
    const len = (v) => Math.hypot(v.x, v.y, v.z);
    ok(Math.abs(Math.abs(vin[ax]) / len(vin) - Math.abs(vout[ax]) / len(vout)) < 1e-9, `${id(cell)} ${mid}：入射角 = 反射角`);
    // 光程：物→M→眼 = 像→眼
    ok(Math.abs(len(vin) + len(vout) - len({ x: e.x - im.x, y: e.y - im.y, z: e.z - im.z })) < 1e-9, `${id(cell)} ${mid}：光程等於眼到像的距離`);
  });
  const twice = C.imageOf(R, C.imageOf(R, o, ['back']), ['back']);
  ok(Math.abs(twice.x - o.x) < 1e-9 && Math.abs(twice.z - o.z) < 1e-9, `${id(cell)}：對同一面鏡鏡射兩次回到原位`);
  const d2 = C.imageOf(R, o, ['back', 'right']);
  ok(Math.abs(d2.x - (2 * R.cols - o.x)) < 1e-9 && Math.abs(d2.z + o.z) < 1e-9, `${id(cell)}：兩面垂直鏡的二次像 = 對牆角點對稱`);
});

// ---------- 3. 可見性：畫面上的判斷 vs 3D 視線 ----------
console.log('3. 鏡中看得到的範圍');
function seen3D(mid, p) {
  const m = R.mirrors[mid], g = m.glass, ax = m.axis, e = cam.eye, im = C.imageOf(R, p, [mid]);
  const t = (m.value - e[ax]) / (im[ax] - e[ax]);
  if (!(t > 0 && t < 1)) return false;
  const along = ax === 'z' ? e.x + (im.x - e.x) * t : e.z + (im.z - e.z) * t, y = e.y + (im.y - e.y) * t;
  if (along < g.a || along > g.b || y < g.bottom) return false;
  return y <= g.topA + (g.topB - g.topA) * (along - g.a) / (g.b - g.a);
}
allCells.forEach((cell) => Object.keys(R.mirrors).forEach((mid) => {
  const v = C.visibility(R, cam, cell, mid), c = C.cellCenter(cell.col, cell.row), h = R.ghost.height, w = R.ghost.width / 2;
  const ref = { feet: seen3D(mid, { x: c.x, y: 0.02, z: c.z }), mid: seen3D(mid, { x: c.x, y: h * 0.5, z: c.z }), head: seen3D(mid, { x: c.x, y: h * 0.95, z: c.z }),
    left: seen3D(mid, { x: c.x - w, y: h * 0.5, z: c.z }), right: seen3D(mid, { x: c.x + w, y: h * 0.5, z: c.z }) };
  ok(['feet', 'mid', 'head', 'left', 'right'].every((k) => v[k] === ref[k]), `${id(cell)} ${mid}：兩種算法一致`, JSON.stringify({ v, ref }));
}));

// ---------- 4. 出題格 ----------
console.log('4. 出題格');
const selectable = C.selectableCells(R, cam);
const pool1 = C.eligibleCells(R, cam, ['back', 'right']), pool2 = C.eligibleCells(R, cam, ['back']);
console.log('   點得到的格子 ' + selectable.length + '：' + selectable.map(id).join(' '));
console.log('   雙鏡出題格 ' + pool1.length + '：' + pool1.map(id).join(' '));
console.log('   單鏡出題格 ' + pool2.length + '：' + pool2.map(id).join(' '));
ok(selectable.length === R.cols * R.rows, '每一格都點得到', selectable.length + ' / ' + R.cols * R.rows);
ok(pool1.length >= R.catchesTwoMirrors + 2, '雙鏡出題格夠用（抓 2 次、不連續重複）', String(pool1.length));
ok(pool2.length >= (R.catchesTotal - R.catchesTwoMirrors) + 2, '單鏡出題格夠用（抓 3 次、不連續重複）', String(pool2.length));
pool1.forEach((c) => {
  const b = C.visibility(R, cam, c, 'back'), r = C.visibility(R, cam, c, 'right');
  ok((b.core || r.core) && b.any && r.any, `雙鏡 ${id(c)}：一面鏡看得到腳身頭，另一面至少露一部分`);
  ok(selectable.some((s) => id(s) === id(c)), `雙鏡 ${id(c)}：點得到`);
});
pool2.forEach((c) => {
  ok(C.visibility(R, cam, c, 'back').core, `單鏡 ${id(c)}：正面鏡看得到腳身頭`);
  ok(selectable.some((s) => id(s) === id(c)), `單鏡 ${id(c)}：點得到`);
});
// 答案唯一：兩個不同的出題格，鏡中的像在畫面上至少差一段看得出來的距離
// 比的是像的「腳」在畫面上的位置（學生就是看牠站在鏡中的哪一格）。
function picture(cell, mirrors) {
  const c = C.cellCenter(cell.col, cell.row);
  return mirrors.map((mid) => C.visibility(R, cam, cell, mid).feet ? C.project(cam, C.imageOf(R, c, [mid])) : null);
}
[[pool1, ['back', 'right'], '雙鏡'], [pool2, ['back'], '單鏡']].forEach(([pool, mirrors, label]) => {
  let minGap = Infinity, pair = '';
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = picture(pool[i], mirrors), b = picture(pool[j], mirrors);
    let gap = 0;
    // 某面鏡裡一個看得到腳、另一個看不到 → 畫面明顯不同
    a.forEach((pa, k) => { const pb = b[k]; gap = Math.max(gap, pa && pb ? dist(pa, pb) : (pa || pb) ? Infinity : 0); });
    if (gap < minGap) { minGap = gap; pair = id(pool[i]) + ' / ' + id(pool[j]); }
  }
  console.log(`   ${label}：兩個出題格的像（腳）在畫面上最少相差 ${minGap.toFixed(0)} px（${pair}）；手機橫向約 ${(minGap * 0.3985).toFixed(0)} CSS px、放大 2.5 倍後 ${(minGap * 0.3985 * 2.5).toFixed(0)} CSS px`);
  ok(minGap >= 15, `${label}：不同的格子給出不同的畫面`, minGap.toFixed(1) + ' px');
});
// 記錄用：每一排在畫面上的高度（手機 812×375 時影像縮成 0.3985 倍）
const rowH = [];
for (let row = 1; row <= R.rows; row++) rowH.push(P(2, 0, row).y - P(2, 0, row - 1).y);
console.log('   各排在影像上的高度（px）：' + rowH.map((h) => h.toFixed(0)).join('、') + '；手機橫向約 ' + rowH.map((h) => (h * 0.3985).toFixed(0)).join('、') + ' CSS px');
ok(rowH.every((h) => h > 30), '每一排在影像上至少 30 px 高');

console.log(`\n平面鏡幾何檢查：${checks - failures}/${checks} 通過`);
process.exit(failures ? 1 : 0);

// 實驗桌模擬器的光學計算檢查（純數學，不開瀏覽器）。node tests/check-bench.js
var O = require('../bench/optics.js'), C = require('../bench/config.js');
var fails = 0, n = 0;
function eq(a, b, msg, tol) { n++; if (!(Math.abs(a - b) <= (tol || 1e-6))) { fails++; console.log('FAIL', msg, a, '≠', b); } }
function ok(c, msg) { n++; if (!c) { fails++; console.log('FAIL', msg); } }

var f = C.f, R = C.lensRadius, wr = C.lamp.windowR, W = C.lamp.windows;
var blue = W[0], red = W[1], green = W[2];

// 薄透鏡公式
var i1 = O.image(f, 30); eq(i1.dImg, 15, 'u=30 → 15'); eq(i1.m, -0.5, 'm=-0.5');
var i2 = O.image(f, 20); eq(i2.dImg, 20, 'u=2f → 2f'); eq(i2.m, -1, 'm=-1');
var i3 = O.image(f, 5); eq(i3.dImg, -10, 'u=5 虛像'); eq(i3.m, 2, 'm=2');
ok(O.image(f, 10).infinity, 'u=f 像在無限遠');
var c1 = O.image(-f, 20); eq(c1.dImg, -20 / 3, '凹透鏡虛像位置', 1e-9); eq(c1.m, 1 / 3, '凹透鏡正立縮小', 1e-9);

// 光屏：像距 15、物距 30 時剛好清楚；從透鏡這側看只有上下顛倒
var sb = O.screenSpot(f, 30, 15, R, blue, wr, false);
eq(sb.blur, 0, '光屏在像上時不模糊'); eq(sb.y, -1.125, '藍燈（上）→ 在下'); eq(sb.r, 0.375, '藍燈（右）→ 仍在右（透鏡側看）');
var sr = O.screenSpot(f, 30, 15, R, red, wr, false);
eq(sr.r, -0.375, '紅燈（左）→ 仍在左'); eq(sr.y, -0.375, '紅燈（下排）→ 在光軸下方');
var sg = O.screenSpot(f, 30, 15, R, green, wr, false);
eq(sg.r, 0.375, '綠燈（右）'); eq(sg.y, -0.375, '綠燈（下排）');
// 從光屏背面看：左右也反
eq(O.screenSpot(f, 30, 15, R, blue, wr, true).r, -0.375, '背面看：藍燈跑到左邊');
// 光屏離開像的位置會模糊；到 2f 處：|1 − s/f + s/u| 以 s=20,u=30 → 0.333…
ok(O.screenSpot(f, 30, 20, R, blue, wr, false).blur > 0.9, '光屏偏離像 → 模糊');
// 物在焦點上：平行光，模糊圓 = 口徑
eq(O.screenSpot(f, 10, 25, R, blue, wr, false).blur, R * Math.abs(1 - 2.5 + 2.5), 'u=f 模糊=R');
// 凹透鏡：光屏上永遠糊
for (var s = 8; s <= 60; s += 4) ok(O.screenSpot(-f, 20, s, R, blue, wr, false).blur > 1, '凹透鏡光屏上不成清晰像 s=' + s);

// 看透鏡（眼睛 30 cm）
var d = C.eye.dist, nr = C.eye.near;
var v1 = O.lensSpot(f, 5, d, nr, blue, wr);        // 焦點內：正立放大虛像
ok(v1.upright && v1.Mv > 1 && v1.focusable, '焦點內：正立放大'); eq(v1.Mv, 1 / (1 + 5 / 30 - 0.5), 'Mv u=5');
var v2 = O.lensSpot(f, 25, d, nr, blue, wr);       // 2f 外：倒立縮小實像，在眼前 13.3 cm
ok(!v2.upright && v2.Mv < 0 && v2.focusable, '2f 外：倒立、看得清楚');
eq(v2.r, -v2.Mv * -blue.r, '倒立：左右也反（r 反號）'); ok(v2.y < 0, '倒立：上燈跑到下');
var v3 = O.lensSpot(f, 13, d, nr, blue, wr);       // 實像在眼睛後面：對不了焦
ok(!v3.focusable, '實像在眼睛後面 → 對不到焦');
var v4 = O.lensSpot(-f, 20, d, nr, blue, wr);      // 凹透鏡：正立縮小
ok(v4.upright && v4.Mv < 1 && v4.Mv > 0 && v4.focusable, '凹透鏡：正立縮小虛像');

// 說明文字分類
var d1 = O.describe(f, 30); ok(d1.kind === 'real' && !d1.upright && d1.size === 'reduced', '30 → 實、倒、縮');
var d2 = O.describe(f, 15); ok(d2.kind === 'real' && d2.size === 'enlarged', '15 → 實、放大');
var d3 = O.describe(f, 5); ok(d3.kind === 'virtual' && d3.upright && d3.size === 'enlarged', '5 → 虛、正、放大');
ok(O.describe(f, 20).size === 'same', '2f 等大');

// 側視光線：三條光穿過透鏡後都通過同一個像點
var yo = 2.8, u = 30, rs = O.rays(f, u, yo, R), im = O.image(f, u), yI = im.m * yo;
rs.forEach(function (r) { if (!r.blocked) eq(r.yP + r.slope * im.dImg, yI, '光線通過像點 ' + r.name, 1e-9); });
var u2 = 5, rv = O.rays(f, u2, yo, R), imv = O.image(f, u2);
rv.forEach(function (r) { if (!r.blocked) eq(r.yP + r.slope * imv.dImg, imv.m * yo, '虛像：反向延長通過像點 ' + r.name, 1e-9); });
var rc = O.rays(-f, 20, yo, R), imc = O.image(-f, 20);
rc.forEach(function (r) { if (!r.blocked) eq(r.yP + r.slope * imc.dImg, imc.m * yo, '凹透鏡：反向延長通過像點 ' + r.name, 1e-9); });

// 範圍：燈窗在 u ≥ 4、光屏在可動範圍內，F、2F 都在桌面上
ok(C.lensX - C.range.objMax >= 4, '物距最小 ≥ 4'); ok(C.lensX - 2 * f >= 0 && C.lensX + 2 * f <= C.benchLength, '2F 兩側都在桌面上');
ok(C.range.screenMax <= C.benchLength, '光屏範圍在桌面內');

console.log(n + ' checks, ' + fails + ' failed'); process.exit(fails ? 1 : 0);

#!/usr/bin/env node
/*
 * 幾何自動檢查：node tests/check-geometry.js
 * 對每組配置驗證薄透鏡公式、凹透鏡成像規律、兩條反推線交點＝物點、目標格唯一。
 * 另外掃描一批 (f, dObj, h) 確認反推作圖在整個參數範圍都成立。
 */
'use strict';
const path = require('path');
const Optics = require(path.join(__dirname, '../prototype/shared/optics-core.js'));
const Cfg = require(path.join(__dirname, '../prototype/concave-lens/configs.js'));

let failures = 0;
let checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) {
    console.log('  PASS  ' + label + (detail ? '  — ' + detail : ''));
  } else {
    failures++;
    console.log('  FAIL  ' + label + (detail ? '  — ' + detail : ''));
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
const pt = (p) => '(' + fmt(p.x) + ', ' + fmt(p.y) + ')';

const W = Cfg.WORLD;
const floor = Cfg.floor;
const MIN_EDGE_MARGIN = 0.3; // 交點離格線至少 0.3 格寬（0.5 = 正中央）

console.log('== 配置檢查 ==');
ok(Cfg.all.length >= 3, '至少 3 組配置', Cfg.all.length + ' 組');
ok(new Set(Cfg.all.map((c) => c.dObj)).size === Cfg.all.length, '各組物距不同');

for (const c of Cfg.all) {
  console.log('\n配置 ' + c.id + ': f=' + c.f + ' 物點=' + pt(c.object) + ' 像點=' + pt(c.image) +
    ' m=' + fmt(c.m) + ' 目標格=' + c.targetCell);

  // 1. 薄透鏡公式
  ok(near(1 / c.f, 1 / c.dObj + 1 / c.dImg, 1e-12), '薄透鏡公式 1/f = 1/do + 1/di');
  ok(near(c.m, -c.dImg / c.dObj), '放大率 m = -di/do');

  // 2. 凹透鏡成像規律
  ok(c.f < 0, '凹透鏡 f < 0');
  ok(c.dImg < 0, '虛像（與物同側）');
  ok(c.m > 0 && c.m < 1, '正立且縮小 0 < m < 1', 'm=' + fmt(c.m));
  ok(c.image.x > c.focal.objectSide.x && c.image.x < 0, '虛像介於物側焦點 F 與透鏡之間',
    'F.x=' + c.focal.objectSide.x + ' < I.x=' + fmt(c.image.x) + ' < 0');
  ok(Math.sign(c.image.y) === Math.sign(c.h) && Math.abs(c.image.y) < Math.abs(c.h), '像與物在主軸同側且較近主軸');

  // 3. 反推作圖
  const r = Optics.reverseConstruct(c.f, c.image);
  ok(near(r.P.x, 0) && near(r.P.y, c.h, 1e-9), 'F–I 連線交透鏡平面於 P = (0, h)', 'P=' + pt(r.P));
  ok(r.focus.x < c.image.x && c.image.x < r.P.x, '第二條線上順序為 F → I → P',
    fmt(r.focus.x) + ' < ' + fmt(c.image.x) + ' < ' + fmt(r.P.x));
  ok(Optics.pointOnLine(r.centerLine, c.object, 1e-9), '物點在光心線（I–O）上');
  ok(c.object.x < c.image.x, '物點在光心線上位於 I 的外側（遠離透鏡）');
  ok(r.object && Optics.dist(r.object, c.object) < 1e-9, '兩條反推線交點 = 物點',
    '交點=' + pt(r.object) + ' 誤差=' + Optics.dist(r.object, c.object).toExponential(2));

  // 4. 目標格唯一、且在格中央附近
  const cell = floor.cellAt(r.object.x);
  const hits = [];
  for (let k = 1; k <= floor.count; k++) {
    if (r.object.x > -k * floor.width && r.object.x < -(k - 1) * floor.width) hits.push(k);
  }
  ok(hits.length === 1 && hits[0] === c.targetCell && cell === c.targetCell, '交點唯一落在目標格', '格 ' + hits.join(','));
  const margin = floor.edgeMargin(r.object.x);
  ok(margin >= MIN_EDGE_MARGIN, '交點不踩格線', '離最近格線 ' + fmt(margin) + ' 格寬（0.5=正中央）');
  ok(floor.cellAt(c.image.x) !== c.targetCell, '虛像所在格 ≠ 目標格（直接封印虛像會失敗）',
    '虛像在格 ' + floor.cellAt(c.image.x));

  // 5. 兩線夾角足夠（交點不會因為近乎平行而難以判讀）
  const angle = Math.atan2(Math.abs(c.h), c.dObj) * 180 / Math.PI;
  ok(angle >= 5, '光心線與平行線夾角 ≥ 5°', fmt(angle) + '°');

  // 5b. 吸附點彼此分得開（手指可分辨；以世界單位計，畫面上還可放大）
  const sepFI = Optics.dist(c.focal.objectSide, c.image), sepIO = Optics.dist(c.image, { x: 0, y: 0 });
  ok(sepFI >= 60 && sepIO >= 60, 'F、虛像、O 兩兩相距 ≥ 60 cm', 'F–I=' + fmt(sepFI) + ' I–O=' + fmt(sepIO));

  // 6. 場景可行性
  ok(c.h - W.ghostHalfHeight > -W.eyeHeight, '鬼不沉入地面');
  ok(Math.abs(c.h) >= 2 * 20, '物點離主軸夠遠（非退化）');
  const tanCenter = Optics.apparentTanThroughLens(c.f, W.eyeToLens, c.dObj, c.h);
  const tanEdge = Optics.apparentTanThroughLens(c.f, W.eyeToLens, c.dObj,
    Math.abs(c.h) + W.ghostHalfHeight);
  ok(Math.abs(tanEdge) < W.lensRadius / W.eyeToLens, '鬼的虛像整個落在手持透鏡口徑內',
    'tan=' + fmt(tanEdge) + ' < ' + fmt(W.lensRadius / W.eyeToLens));

  // 7. 探索視角用的重映射公式與像點幾何一致
  const zEff = Optics.effectiveDepthThroughLens(c.f, W.eyeToLens, c.dObj);
  ok(near(tanCenter, c.h / zEff, 1e-12), '探索視角重映射公式 = 從眼睛看虛像點的角度');
  const nakedTan = c.h / (W.eyeToLens + c.dObj);
  ok(Math.abs(tanCenter) < Math.abs(nakedTan), '透過凹透鏡視角變小（縮小）',
    '縮為 ' + fmt(tanCenter / nakedTan) + ' 倍');
}

console.log('\n== 參數掃描（反推作圖的一般性） ==');
let sweep = 0, sweepBad = 0, worst = 0;
for (let f = -50; f >= -400; f -= 25) {
  for (let d = 30; d <= 1200; d += 45) {
    for (const h of [-150, -60, -10, 10, 45, 130]) {
      sweep++;
      const img = Optics.thinLensImage(f, d, h);
      const r = Optics.reverseConstruct(f, img.point);
      const err = Optics.dist(r.object, { x: -d, y: h });
      worst = Math.max(worst, err);
      const lawful = img.isVirtual && img.isUpright && img.m < 1 && img.point.x > f && img.point.x < 0;
      if (err > 1e-7 || !lawful) sweepBad++;
    }
  }
}
ok(sweepBad === 0, sweep + ' 組 (f, do, h) 全部：虛像正立縮小、在 F 與透鏡間、反推回原物點',
  '最大誤差 ' + worst.toExponential(2) + ' cm');

console.log('\n== 規律檢查（改變物距／焦距） ==');
{
  let mono = true, prev = null;
  for (let d = 50; d <= 2000; d += 50) {
    const img = Optics.thinLensImage(-200, d, 100);
    if (prev && !(img.dImg < prev.dImg && img.m < prev.m)) mono = false;
    prev = img;
  }
  ok(mono, '物愈遠 → 虛像愈靠近 F、愈小（單調）');
  const far = Optics.thinLensImage(-200, 1e9, 100);
  ok(near(far.dImg, -200, 1e-3), '物在極遠處 → 虛像趨近物側焦點', 'di=' + fmt(far.dImg));
  const a = Optics.thinLensImage(-100, 400, 100), b = Optics.thinLensImage(-300, 400, 100);
  ok(Math.abs(a.dImg) < Math.abs(b.dImg) && a.m < b.m, '|f| 愈小 → 虛像愈靠近透鏡、愈小');
}

console.log('\n== 共用模組的擴充性抽查（凸透鏡、平面鏡；非本輪玩法） ==');
{
  const img = Optics.thinLensImage(200, 600, 100);
  ok(!img.isVirtual && !img.isUpright && near(img.dImg, 300), '凸透鏡 f=200, do=600 → 倒立實像 di=300');
  const r = Optics.reverseConstruct(200, img.point);
  ok(Optics.dist(r.object, { x: -600, y: 100 }) < 1e-9, '同一個 reverseConstruct 對凸透鏡也能反推回物點');
  const mir = Optics.planeMirrorImage({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -3, y: 2 });
  ok(near(mir.x, 3) && near(mir.y, 2), '平面鏡像對稱、等距');
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (checks - failures) + '/' + checks + ' checks');
process.exit(failures === 0 ? 0 : 1);

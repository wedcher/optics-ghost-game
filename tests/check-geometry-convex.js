#!/usr/bin/env node
/*
 * 凸透鏡配置的幾何自動檢查：node tests/check-geometry-convex.js
 * 檢查本身寫在 prototype/convex-lens/configs.js 的 selfCheck()，
 * 瀏覽器也能呼叫同一份（window.ConvexLensConfigs.selfCheck()）。
 */
'use strict';
const path = require('path');
const Cfg = require(path.join(__dirname, '../prototype/convex-lens/configs.js'));

const results = Cfg.selfCheck();
let failures = 0;
results.forEach((r) => {
  if (!r.ok) failures++;
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.label + (r.detail ? '  — ' + r.detail : ''));
});
console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILED') + ': ' + (results.length - failures) + '/' + results.length + ' checks');
process.exit(failures === 0 ? 0 : 1);

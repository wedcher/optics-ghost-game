#!/usr/bin/env node
/*
 * 排行榜後端（backend/leaderboard/Code.gs）的規則檢查：node tests/check-leaderboard.js
 * 不需要網路或瀏覽器。用假的 SpreadsheetApp 跑真的 Code.gs。
 */
'use strict';
const { loadGas } = require('./leaderboard-gas-mock');

let checks = 0, failures = 0;
function ok(c, label, detail) {
  checks++;
  if (!c) { failures++; console.log('FAIL ' + label + (detail ? '  ' + JSON.stringify(detail) : '')); }
}
const post = (g, o) => g.post(JSON.stringify(o));
const MIN = 60 * 1000;

// 空榜
let g = loadGas();
let t = g.get();
ok(t.ok && t.castle.length === 0 && t.hunt.length === 0, '空榜回傳兩個空陣列', t);
ok(!g.get({ action: 'nope' }).ok, '未知 action 被拒');

// 基本上傳與排序
let r = post(g, { name: '小明', castleMs: 10 * MIN, hunt: 4 });
ok(r.ok && r.castle.rank === 1 && r.hunt.rank === 1 && r.castle.improved && r.hunt.improved, '第一筆成績兩榜都第 1', r);
r = post(g, { name: '小華', castleMs: 8 * MIN, hunt: 2 });
ok(r.castle.rank === 1 && r.hunt.rank === 2, '時間愈短愈前面、封印愈多愈前面', r);
t = g.get();
ok(t.castle.map((x) => x.name).join() === '小華,小明', '趕鬼時間升冪', t.castle);
ok(t.hunt.map((x) => x.name).join() === '小明,小華', '荒野封印降冪', t.hunt);

// 每個暱稱只留最佳
r = post(g, { name: '小明', castleMs: 12 * MIN, hunt: 3 });
ok(r.ok && !r.castle.improved && r.castle.best === 10 * MIN && !r.hunt.improved && r.hunt.best === 4, '較差成績不覆蓋', r);
r = post(g, { name: '小明', castleMs: 7 * MIN });
ok(r.castle.improved && r.castle.rank === 1 && r.hunt === null, '較好成績覆蓋；只傳一個榜時另一個是 null', r);
ok(g.sheets.castle.rows.length === 3 && g.sheets.hunt.rows.length === 3, '同暱稱不會多一列（含標題列）', g.sheets.castle.rows);
ok(g.get().hunt.find((x) => x.name === '小明').value === 4, '只傳時間時不影響封印榜');

// 同分：先達成的在前
post(g, { name: '阿美', hunt: 4 });
t = g.get();
ok(t.hunt[0].name === '小明' && t.hunt[1].name === '阿美', '同分時先達成的排前面', t.hunt);

// 前 10 名
g = loadGas();
for (let i = 0; i < 15; i++) post(g, { name: 'p' + i, castleMs: (20 + i) * MIN, hunt: i });
t = g.get();
ok(t.castle.length === 10 && t.hunt.length === 10, '只回傳前 10 名', [t.castle.length, t.hunt.length]);
ok(t.castle[0].name === 'p0' && t.hunt[0].name === 'p14', '前 10 名的第一名正確');
r = post(g, { name: 'p13', castleMs: 40 * MIN });
ok(r.castle.rank === 14, '榜外的人也會拿到名次', r);

// 暱稱清理
g = loadGas();
r = post(g, { name: '  <b>超級 長 的 暱稱一二三四五六七</b>  ', hunt: 1 });
const nm = g.get().hunt[0].name;
ok(r.ok && !/[<>]/.test(nm) && Array.from(nm).length <= 10, '暱稱去掉 <> 並截到 10 字', nm);
ok(post(g, { name: 'ＡＢＣ', hunt: 2 }).ok && g.get().hunt.some((x) => x.name === 'ABC'), '全形英數正規化成半形');
ok(!post(g, { name: '   ', hunt: 1 }).ok, '空白暱稱被拒');
ok(!post(g, { hunt: 1 }).ok, '沒有暱稱被拒');

// 數值檢查
const bad = [
  [{ name: 'x', castleMs: 5000 }, '少於 30 秒的趕鬼時間'],
  [{ name: 'x', castleMs: 25 * 3600 * 1000 }, '超過 24 小時'],
  [{ name: 'x', castleMs: 61234.5 }, '非整數毫秒'],
  [{ name: 'x', castleMs: '600000' }, '字串數字'],
  [{ name: 'x', hunt: -1 }, '負的封印數'],
  [{ name: 'x', hunt: 61 }, '封印數超過 60'],
  [{ name: 'x', hunt: 2.5 }, '小數封印數'],
  [{ name: 'x' }, '沒有任何成績']
];
bad.forEach(([b, label]) => ok(!post(g, b).ok, '拒絕：' + label));
ok(!g.post('not json').ok, '拒絕：壞 JSON');
ok(!g.get().hunt.some((x) => x.name === 'x'), '被拒的上傳不留紀錄');
ok(post(g, { name: '零隻', hunt: 0 }).ok, '0 隻可以上榜');

console.log((failures ? 'FAILED ' : 'OK ') + (checks - failures) + '/' + checks + ' leaderboard backend checks');
process.exit(failures ? 1 : 0);

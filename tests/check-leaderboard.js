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
const W = (x) => Array.from(x).reduce((a, c) => a + (c.charCodeAt(0) <= 0xff ? 1 : 2), 0);
ok(r.ok && !/[<>]/.test(nm) && W(nm) <= 20, '暱稱去掉 <> 並截到寬度 20（中文 10 字）', nm);

// 長度：中文 10 字、英文 20 字
g = loadGas();
post(g, { name: '一二三四五六七八九十十一', hunt: 1 });
ok(g.get().hunt[0].name === '一二三四五六七八九十', '中文截到 10 字', g.get().hunt[0].name);
g = loadGas();
post(g, { name: 'abcdefghijklmnopqrstuvwxyz', hunt: 1 });
ok(g.get().hunt[0].name === 'abcdefghijklmnopqrst', '英文截到 20 字', g.get().hunt[0].name);
g = loadGas();
post(g, { name: '小明abcdefghijklmnopq', hunt: 1 });
ok(g.get().hunt[0].name === '小明abcdefghijklmnop', '中英混合用寬度算（中文 2、英文 1）', g.get().hunt[0].name);

// 不雅字詞
g = loadGas();
['幹你娘', '靠北啦', '王 八 蛋', '白痴123', 'FUCK', 'Ｆｕｃｋ', 'f.u.c.k', 'sh1t', 'b!tch', '你媽的'].forEach((n) => {
  const res = post(g, { name: n, hunt: 1 });
  ok(!res.ok && /不能用/.test(res.error), '擋下不雅暱稱：' + n, res);
});
ok(g.get().hunt.length === 0, '被擋的暱稱不留紀錄');
['能幹的小明', '幹部', '操場', 'Cassie', 'class 701', '小白', '阿智', 'Dickson', '87'].forEach((n) => {
  ok(post(g, { name: n, hunt: 1 }).ok, '正常暱稱不誤擋：' + n);
});

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

// ---------- 2026-11-21：裝置代碼分人、分頁、找名次 ----------
g = loadGas();
const D1 = 'dev0000000000a1', D2 = 'dev0000000000b2';
post(g, { name: '小明', device: D1, hunt: 5 });
post(g, { name: '小明', device: D2, hunt: 3 });
ok(g.sheets.hunt.rows.length === 3, '同名不同裝置：分成兩筆（兩個人）', g.sheets.hunt.rows);
r = post(g, { name: '小明', device: D1, hunt: 2 });
ok(!r.hunt.improved && r.hunt.best === 5 && g.sheets.hunt.rows.length === 3, '同裝置＋同名：較差成績不多一筆', r);
r = post(g, { name: '小明', device: D1, hunt: 7 });
ok(r.hunt.improved && r.hunt.rank === 1 && r.hunt.page === 1 && g.sheets.hunt.rows.length === 3, '同裝置＋同名：較好成績覆蓋自己那一筆', r);
ok(g.sheets.hunt.rows[0][3] === 'device' && g.sheets.hunt.rows[1][3] === D1, '試算表多一欄 D 裝置代碼', g.sheets.hunt.rows[0]);
post(g, { name: '小華', device: 'bad code!', hunt: 4 });
ok(g.sheets.hunt.rows.some((x) => x[0] === '小華' && x[3] === ''), '格式不對的裝置代碼當作沒有');
// 舊資料列（沒有 D 欄）照舊以暱稱當同一人
g = loadGas();
post(g, { name: '舊同學', hunt: 3 });
g.sheets.hunt.rows[1].length = 3;
r = post(g, { name: '舊同學', hunt: 6 });
ok(r.hunt.improved && g.sheets.hunt.rows.length === 2, '沒有裝置代碼的舊資料：同名照舊覆蓋', g.sheets.hunt.rows);
// 分頁
g = loadGas();
for (let i = 0; i < 25; i++) post(g, { name: 'p' + i, device: 'dev' + String(i).padStart(12, '0'), hunt: i });
let pg = g.get({ action: 'page', board: 'hunt', page: '2' });
ok(pg.ok && pg.total === 25 && pg.pages === 3 && pg.page === 2 && pg.rows.length === 10 && pg.rows[0].rank === 11 && pg.rows[0].name === 'p14', '分頁：每頁 10 名，第 2 頁從第 11 名開始', pg);
ok(g.get({ action: 'page', board: 'hunt', page: '9' }).page === 3 && g.get({ action: 'page', board: 'hunt', page: '3' }).rows.length === 5, '頁數超過就給最後一頁；最後一頁 5 筆');
ok(pg.rows.every((x) => typeof x.at === 'number' && x.at > 0), '每一列有日期（時間戳）');
pg = g.get({ action: 'page', board: 'hunt', page: '2', device: 'dev000000000010', name: 'p10' });
ok(pg.rows.filter((x) => x.me).map((x) => x.name).join() === 'p10', '分頁：帶裝置代碼＋暱稱時標出自己那一列', pg.rows.filter((x) => x.me));
let rk = g.get({ action: 'rank', board: 'hunt', device: 'dev000000000003', name: 'p3' });
ok(rk.ok && rk.rank === 22 && rk.page === 3 && rk.total === 25, '找名次：第 22 名在第 3 頁', rk);
ok(g.get({ action: 'rank', board: 'hunt', device: 'dev000000000003', name: '別人' }).rank === 0, '找名次：裝置對、暱稱不對＝不在榜上');
ok(!g.get({ action: 'page', board: 'xx' }).ok, '分頁：不認識的榜被拒');
ok(g.get().hunt.length === 10, '舊版前端的 action=top 照舊可用');
// 伺服器忙：回 JSON 錯誤（不是 HTML 錯誤頁）
g = loadGas({ busy: true });
r = post(g, { name: '小明', hunt: 1 });
ok(!r.ok && r.error === 'busy', '等不到鎖：回 {ok:false,error:"busy"}（PENDING 21）', r);

console.log((failures ? 'FAILED ' : 'OK ') + (checks - failures) + '/' + checks + ' leaderboard backend checks');
process.exit(failures ? 1 : 0);

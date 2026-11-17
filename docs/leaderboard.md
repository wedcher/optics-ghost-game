# 排行榜

使用者 2026-11-17 決定要做（推翻原本「不做排行榜／後端」）。定案寫在 `PROJECT.md` CONFIRMED。

## 規則（已定案）

| 榜 | 內容 | 排序 |
|---|---|---|
| 趕鬼時間 | 第一關開始 → 第二關結束（抓滿 5 隻） | 愈短愈前 |
| 荒野封印 | 第三關 5 分鐘荒野狩獵封印的鬼數 | 愈多愈前 |

- **全部玩家共用**，後端是 Google 試算表 + Apps Script（使用者自己的 Google 帳號部署）。
- **趕鬼時間是牆上時間**：過場、失敗重來都算，失敗**不歸零**；重新整理頁面也不歸零。只有選單的「重新開始遊戲」會清掉。
- 沒有從第一關開始（例如直接開第二關網址）→ 沒有趕鬼時間，不上時間榜。
- 本輪第一關沒過關就玩第二關（例如入口頁 `?unlock=1` 跳關）→ 也不算。趕鬼時間要本輪計時已開始、且本輪第一關已過關（`finishMirror()`）。
- **每個暱稱只留最佳成績**，顯示**前 10 名**；同分時先達成的排前面。
- 荒野練習模式不計（練習模式不要呼叫上傳）。
- 暱稱最多 10 字，去掉 `<>"'\`` 與控制字元，全形英數轉半形。

## 檔案

| 檔案 | 作用 |
|---|---|
| `backend/leaderboard/Code.gs` | Apps Script 後端（貼進試算表的 Apps Script 編輯器） |
| `prototype/shared/leaderboard-config.js` | 填 Apps Script 網址；**留空 = 本機排行**（只存在這支手機） |
| `prototype/shared/leaderboard.js` | 計時、上傳、讀取、結算畫面 |
| `prototype/leaderboard.html` | 排行榜頁（選單有入口） |
| `tests/check-leaderboard.js` | 用假的試算表跑真的 `Code.gs`（29 項） |
| `tests/e2e-leaderboard.js` | 瀏覽器實測：計時、結算畫面、本機模式、共用模式（假伺服器跑 `Code.gs`）、斷線（32 項） |

## 部署共用排行榜（使用者做一次，約 5 分鐘）

1. 開 Google 試算表，新增一份空白試算表，命名例如「光學抓鬼排行榜」。
2. 選單【擴充功能】→【Apps Script】。
3. 把編輯器裡的 `Code.gs` 內容全部刪掉，貼上 repo 的 `backend/leaderboard/Code.gs`，按儲存。
4. 右上【部署】→【新增部署作業】→ 齒輪選【網頁應用程式】：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
5. 按【部署】，第一次會要求授權（選自己的帳號 →「進階」→「前往（不安全）」→ 允許；這是自己寫的腳本，Google 才這樣提示）。
6. 複製「網頁應用程式網址」（結尾是 `/exec`），貼給 Claude，或自己填進 `prototype/shared/leaderboard-config.js`：
   ```js
   window.LEADERBOARD_URL = 'https://script.google.com/macros/s/……/exec';
   ```
7. 推到 `main`，GitHub Pages 更新後就是共用排行。

之後若改了 `Code.gs`：【部署】→【管理部署作業】→ 鉛筆 → 版本選「新版本」→ 部署（網址不變）。

**管理**：試算表會自動出現 `castle`、`hunt` 兩個工作表（A 暱稱、B 成績、C 時間戳）。有不當暱稱就直接刪那一列。要清榜就刪掉所有資料列（保留第一列標題）。

## 接進各關（2026-11-17 已接：第一關、第二關、選單；荒野狩獵尚未實作）

每一頁先載入：

```html
<script src="../shared/leaderboard-config.js"></script>
<script src="../shared/leaderboard.js"></script>
```

| 時機 | 呼叫 | 檔案 |
|---|---|---|
| 第一關**關卡模式**開始（開場過場出現時） | `Leaderboard.startRun()` | `prototype/plane-mirror/app.js` `showIntro()`（已接） |
| 第一關過關 | `Leaderboard.finishMirror()` | `prototype/plane-mirror/app.js` `showClear()`（已接） |
| 第二關抓滿 5 隻、過關演出前 | `Leaderboard.finishCastle()`，有值就在過關畫面顯示 | `prototype/convex-lens/app.js` `showCleared()`（已接） |
| 荒野狩獵（正式，不是練習）結束：時間到或命用完 | `Leaderboard.recordHunt(n); Leaderboard.showResult({ onClose })` | 荒野狩獵（尚未實作） |
| 選單「重新開始遊戲」 | `Leaderboard.restartRun()`（和 `GameProgress.reset()` 一起） | `prototype/index.html`（已接） |

`?free=1` 的自由練習不要呼叫任何一個。`startRun()` 已經開始的話不會歸零，所以第一關失敗重來重複呼叫沒關係。

## 已知風險／限制

- **防作弊很弱**：前端送出成績，後端只檢查範圍（趕鬼時間 30 秒～24 小時、封印數 0～60 隻的整數）。會改瀏覽器資料或直接打 API 的學生能灌假成績。國中課堂排行的程度可接受；老師可在試算表刪列。
- **暱稱可冒用**：任何人輸入同一個暱稱，較好的成績就會蓋過去。沒有帳號系統（CLAUDE.md 不做帳號）。
- **沒有不雅字詞過濾**：只能由老師刪列。（PENDING：要不要做）
- Apps Script 免費額度對一個班級綽綽有餘；同時大量送出時用 `LockService` 排隊，最多等 10 秒。
- 共用模式在手機上的實際連線（Apps Script 的跨網域轉址）**還沒用真的部署測過**；e2e 用的是跑同一份 `Code.gs` 的本機假伺服器。部署後第一次要實測一次上傳與讀取。
- 計時存在 `localStorage`：換瀏覽器／無痕模式等於沒有開始紀錄；清除網站資料會讓計時消失（只會讓那一輪沒有成績，不會變快）。

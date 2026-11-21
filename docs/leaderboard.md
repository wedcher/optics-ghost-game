# 排行榜

使用者 2026-11-17 決定要做（推翻原本「不做排行榜／後端」）。定案寫在 `PROJECT.md` CONFIRMED。

## 規則（已定案）

| 榜 | 內容 | 排序 |
|---|---|---|
| 趕鬼時間 | 第一關最後一次過關的成績 ＋ 第二關最後一次過關的成績 | 愈短愈前 |
| 荒野封印 | 第三關 5 分鐘荒野狩獵封印的鬼數 | 愈多愈前 |

- **全部玩家共用**，後端是 Google 試算表 + Apps Script（使用者自己的 Google 帳號部署）。
- **趕鬼時間＝兩關「最後一次過關」的成績相加**（使用者 2026-11-18 定案，取代原本「牆上時間全部算、失敗不歸零」；2026-11-19 實作）：
  - 每一關的成績＝這一次挑戰的遊玩時間：從按「開始抓鬼」（開場過場結束）起算，到過關（按「過關 ➜」、過關演出出現）為止。
  - **不算**：開場、過關演出；關卡中的劇情過場（第一關的丟圓盤、丟完圓盤後的「……還真的用丟的喔」、打碎鏡子）；回選單的空檔；命用完的那一次（重新挑戰從 0 起算）；中途回選單／重新整理放棄的那一次；練習模式（`?practice=1`）與自由練習（`?free=1`）。
  - 「再玩一次」過關 → 新成績**取代**那一關的舊成績（就算比較慢）；再玩一次沒過關 → 保留上次過關的成績。
  - 兩關都有成績才有趕鬼時間。只有第二關成績（例如入口頁 `?unlock=1` 跳關、直接開第二關網址）→ 不顯示、不記。
  - 第二關過關後回頭重玩第一關並過關 → 趕鬼時間立刻改用新的第一關成績（「最後一次」的字面意思；是否要重新上傳見 PROJECT.md PENDING）。
  - 選單「重新開始遊戲」清掉兩關成績。
  - 進行中的那一次只放在記憶體（換頁就消失）；過關成績存在 `localStorage` 的 `ogg.run.v2`。舊規則的 `ogg.run.v1`（牆上時間）不沿用，「重新開始遊戲」時順便刪掉。
  - App 切到背景、螢幕關掉時**照算**（沒有特別暫停）。
- **同一個人只留最佳成績**（2026-11-21 改）：「同一個人」＝**同一個裝置代碼＋同一個暱稱**。裝置代碼是遊戲第一次上傳時在那支手機瀏覽器隨機產生的英數字串（`localStorage` 的 `ogg.device.v1`，不含個人資料），上傳時一起送出、記在試算表 D 欄。不同手機用同一個暱稱＝不同人，分開列。2026-11-21 以前沒有 D 欄的舊資料列，照舊以暱稱當同一個人。
  - 限制：兩個學生共用同一台裝置又打一樣的暱稱，會被當成同一人；換手機、換瀏覽器、無痕模式、清除網站資料會被當成新的人。
- **排行榜頁**（2026-11-21 改）：分頁標籤「趕鬼時間｜荒野封印」一次看一個榜；每列 名次｜暱稱｜成績｜日期（月/日，那筆最佳成績的日期）；每頁 10 名，可翻頁，全部都查得到；「找我的名次」跳到自己那一頁並標示。結算畫面的名次在第 2 頁以後會寫「（排行榜第 n 頁）」。同分時先達成的排前面。
- 後端還沒重新部署（不認得 `action=page`）時，排行榜頁自動退回舊的前 10 名，並寫「排行榜後台還沒更新」。
- 荒野練習模式不計（練習模式不要呼叫上傳）。
- 暱稱長度用寬度算：中文（全形字）算 2、英數算 1，上限 20，也就是中文 10 字或英文 20 字。去掉 `<>"'\`` 與控制字元，全形英數轉半形。
- 不雅暱稱：前端和後端各有一份**相同**的小清單（`BAD_WORDS`，在 `prototype/shared/leaderboard.js` 與 `backend/leaderboard/Code.gs`），比對前轉小寫、把常見替代字還原（0→o、1/!/|→i、3→e、4/@→a、5/$→s、7→t）、去掉空白和符號，所以「王 八 蛋」「f.u.c.k」「sh1t」也擋得到。被擋時顯示「這個暱稱不能用，請換一個」。清單刻意保守，不放會誤傷正常名字的字（單字「幹」「操」、英文 ass、dick），所以擋不完；漏網的由老師在試算表刪列。改清單時兩個檔案都要改，後端要重新部署。

## 檔案

| 檔案 | 作用 |
|---|---|
| `backend/leaderboard/Code.gs` | Apps Script 後端（貼進試算表的 Apps Script 編輯器） |
| `prototype/shared/leaderboard-config.js` | 填 Apps Script 網址；**留空 = 本機排行**（只存在這支手機） |
| `prototype/shared/leaderboard.js` | 計時（`startLevel`／`pauseLevel`／`resumeLevel`／`cancelLevel`／`finishMirror`／`finishCastle`）、上傳、讀取、結算畫面 |
| `prototype/leaderboard.html` | 排行榜頁（選單有入口） |
| `tests/check-leaderboard.js` | 用假的試算表跑真的 `Code.gs`（29 項） |
| `tests/e2e-leaderboard.js` | 瀏覽器實測：計時規則（假時鐘）、結算畫面、本機模式、共用模式（假伺服器跑 `Code.gs`）、斷線（53 項） |

## 部署共用排行榜

**已部署（2026-11-18，使用者自己的 Google 帳號）**。試算表「光學抓鬼排行榜」，網址已填進 `prototype/shared/leaderboard-config.js`：

```
https://script.google.com/macros/s/AKfycbwLRDiuQAThbMIY_tVEARySyCkIzKc6mFyKCi54TfmX4Rx_6wuovMFtz-LzSfBNj6Zg/exec
```

這個網址不是密碼（前端本來就公開它）。之後重新部署請用「管理部署作業 → 新版本」，**網址不變**；若改用「新增部署作業」會得到新網址，要再改 config。

### 步驟（照 2026-11-18 實際畫面校正過）

1. 開 https://sheets.google.com →【空白試算表】，命名「光學抓鬼排行榜」。
2. 選單【擴充功能】→【Apps Script】。新分頁左邊是 `程式碼.gs`，右邊是預設的 `function myFunction() { }`。
3. 開 https://raw.githubusercontent.com/wedcher/optics-ghost-game/main/backend/leaderboard/Code.gs ，Ctrl+A、Ctrl+C；回 Apps Script 點右邊程式區，Ctrl+A、Ctrl+V 取代，按磁碟片圖示【儲存專案】。可順便把「未命名的專案」改成「光學抓鬼排行榜」。
4. 右上【部署】→【新增部署作業】→ 左邊「選取類型」旁的齒輪 →【網頁應用程式】：
   - 執行身分：**我**
   - 誰可以存取：**所有人**（不是「所有已登入 Google 帳戶的使用者」，否則沒登入的學生上傳不了）
5. 按【部署】→ 第一次會跳「需要授權存取權」→【授予存取權】→ 選自己的帳號 →「Google 尚未驗證這個應用程式」→ 左下【進階】→【前往「光學抓鬼排行榜」（不安全）】→【允許】。
   - 為什麼可以放心：程式是自己貼的，Google 沒審核過才警告；它只要求讀寫**這份**試算表。
   - 實際畫面差異：授權完回到 Apps Script，原本的部署框可能還在；再點一次會出現**英文**頁「光學抓鬼排行榜 wants access… already has some access」，代表授權其實已成功，捲到最下面按【Continue】／【Allow】即可。
6. 出現「已成功更新部署作業」，複製「網頁應用程式 網址」（結尾 `/exec`）。找不到時：【部署】→【管理部署作業】→ 點那一筆。
7. 填進 `prototype/shared/leaderboard-config.js` 的 `window.LEADERBOARD_URL`，推到 `main`，GitHub Pages 更新後就是共用排行。

**雲端 Claude 工作階段要實測時**：預設環境的網路擋 `script.google.com`。2026-11-18 建了個人環境 `optics-ghost-game`，只多開 `script.google.com`、`script.googleusercontent.com`（Apps Script 回應會 302 轉址到後者）。

**測試不會打正式網址**：`tests/e2e-leaderboard.js` 一律用 `page.route` 蓋掉 `leaderboard-config.js`（本機模式＝空字串、共用模式＝假伺服器）。新寫的測試若會走到上傳（結算畫面輸入暱稱），也要蓋掉 config，否則會把假成績寫進正式試算表。

之後若改了 `Code.gs`：【部署】→【管理部署作業】→ 鉛筆 → 版本選「新版本」→ 部署（網址不變）。

### 2026-11-21 改版要重新部署一次（使用者做）

1. 打開 https://raw.githubusercontent.com/wedcher/optics-ghost-game/<分支或 main>/backend/leaderboard/Code.gs ，Ctrl+A、Ctrl+C（併進 main 前用分支名稱 `claude/amazing-lamport-4kx8tr`）。
2. 打開試算表「光學抓鬼排行榜」→【擴充功能】→【Apps Script】→ 點右邊程式區，Ctrl+A、Ctrl+V 取代 → 磁碟片【儲存專案】。
3. 右上【部署】→【管理部署作業】→ 點那一筆右邊的鉛筆 → 「版本」選【新版本】→【部署】。網址不變，`leaderboard-config.js` 不用改。
4. 檢查：在瀏覽器打開 `…/exec?action=page&board=hunt` 應該看到 `{"ok":true,...,"rows":[...]}`；打開排行榜頁不再寫「排行榜後台還沒更新」。
   - 沒重新部署之前：遊戲照樣能上傳（舊後端會忽略裝置代碼、照舊以暱稱合併），排行榜頁顯示舊的前 10 名。

**管理**：試算表會自動出現 `castle`、`hunt` 兩個工作表（A 暱稱、B 成績、C 時間戳、D 裝置代碼；舊的工作表第一列標題沒有 `device` 不影響，D 欄照樣寫入）。有不當暱稱就直接刪那一列。要清榜就刪掉所有資料列（保留第一列標題）。

## 接進各關（2026-11-17 已接：第一關、第二關、選單；2026-11-19 接上荒野狩獵）

每一頁先載入：

```html
<script src="../shared/leaderboard-config.js"></script>
<script src="../shared/leaderboard.js"></script>
```

| 時機 | 呼叫 | 檔案 |
|---|---|---|
| 第一關按「開始抓鬼」／失敗後「重新挑戰」／過關後「再玩一次」 | `Leaderboard.startLevel('mirror')` | `prototype/plane-mirror/app.js`（已接） |
| 第一關丟圓盤、丟完圓盤、打碎鏡子過場出現／結束 | `Leaderboard.pauseLevel()`／`Leaderboard.resumeLevel()` | `prototype/plane-mirror/app.js` `showThrow`、`showAfterThrow`、`showBreak`（已接） |
| 第一關命用完 | `Leaderboard.cancelLevel()` | `prototype/plane-mirror/app.js` `showFail()`（已接） |
| 第一關過關 | `Leaderboard.finishMirror()` | `prototype/plane-mirror/app.js` `showClear()`（已接） |
| 第二關按「開始抓鬼」／「重新挑戰」／「再玩一次」 | `Leaderboard.startLevel('convex')` | `prototype/convex-lens/app.js` `startHunt()`（已接） |
| 第二關命用完 | `Leaderboard.cancelLevel()` | `prototype/convex-lens/app.js` `failLevel()`（已接） |
| 第二關抓滿 5 隻、過關演出前 | `Leaderboard.finishCastle()`，回傳兩關相加的趕鬼時間，有值就在過關畫面顯示 | `prototype/convex-lens/app.js` `showCleared()`（已接） |
| 荒野狩獵（正式，不是練習）結束：時間到或命用完 | `Leaderboard.recordHunt(n); Leaderboard.showResult({ title, closeLabel, extraNote, buttons, onClose })` | `prototype/concave-lens/app.js` `endHunt()`／`showHuntResult()`（2026-11-19 已接） |
| 選單「重新開始遊戲」 | `Leaderboard.restartRun()`（和 `GameProgress.reset()` 一起） | `prototype/index.html`（已接） |

練習模式（`?practice=1`，兩關的 `LB = null`）和 `?free=1` 的自由練習不要呼叫任何一個。沒有 `startLevel` 的挑戰，`finishMirror()`／`finishCastle()` 回傳 `null`、不改紀錄。`pauseLevel()`／`resumeLevel()` 重複呼叫沒關係。

## 已知風險／限制

- **防作弊很弱**：前端送出成績，後端只檢查範圍（趕鬼時間 30 秒～24 小時、封印數 0～60 隻的整數）。會改瀏覽器資料或直接打 API 的學生能灌假成績。國中課堂排行的程度可接受；老師可在試算表刪列。
- **暱稱可冒用**：沒有帳號系統（CLAUDE.md 不做帳號）。2026-11-21 起別支手機用同一個暱稱只會多一列，不會蓋掉別人的成績。
- **不雅字詞過濾只擋常見的**：清單小而保守，諧音、新造字擋不到，漏網的由老師刪列（使用者 2026-11-17 定案，見上方「暱稱」規則）。
- Apps Script 免費額度對一個班級綽綽有餘；同時大量送出時用 `LockService` 排隊，最多等 10 秒。
- 真的部署已實測（2026-11-18，雲端工作階段）：curl `GET ?action=top` → `{"ok":true,...}`；照 `Code.gs` 格式 POST（text/plain JSON）→ 回傳名次、試算表自動建立 `castle`／`hunt` 並多一列；不雅暱稱 `sh1t` 被擋；GET 與 302 轉址後的回應都有 `access-control-allow-origin: *`；Playwright 開 `leaderboard.html`（用正式網址）兩個榜都讀到測試資料。測試資料已請使用者在試算表刪除。
- **還沒實測**：真的手機從遊戲過關 → 結算畫面輸入暱稱 → 上傳 → 排行榜頁看到。結算畫面只在荒野狩獵結束時出現（PENDING 22 定案）；2026-11-19 荒野狩獵做好後，**遊戲裡第一次有路徑會上傳**，要請使用者用手機實際玩一次確認（headless 只測過本機模式與假伺服器）。
- ~~`Code.gs` 小問題~~ 2026-11-21 已修（要重新部署才生效）：改用 `tryLock`，等不到鎖回 `{ok:false,error:'busy'}`。
- 過關成績存在 `localStorage`：換瀏覽器／無痕模式等於沒有成績；清除網站資料會讓成績消失（只會讓那一輪沒有趕鬼時間，不會變快）。
- 後端的合理範圍仍是 30 秒～24 小時；新規則只算遊玩時間，兩關加起來低於 30 秒實際上不可能（第一關要抓 5 次、第二關要抓 5 隻），所以 `Code.gs` 沒改、不用重新部署。

/*
 * progress.js — 過關紀錄（三關與入口頁共用）。只存在這台裝置的瀏覽器裡（localStorage），沒有後端。
 *
 * 關卡順序：mirror（平面鏡）→ convex（凸透鏡）→ concave（凹透鏡荒野）。前一關過關後，下一關才解鎖。
 * 入口頁網址加 ?unlock=1 可以暫時全部解鎖（老師／開發用，不會寫入紀錄）。
 */
(function () {
  'use strict';
  var KEY = 'opticsGhost.progress.v1', ORDER = ['mirror', 'convex', 'concave'];
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function write(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 無痕模式等：不存也能玩 */ } }
  window.GameProgress = {
    ORDER: ORDER,
    markCleared: function (id) { var o = read(); o[id] = true; write(o); },
    isCleared: function (id) { return !!read()[id]; },
    isUnlocked: function (id) { var i = ORDER.indexOf(id); return i <= 0 || !!read()[ORDER[i - 1]]; },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  };
})();

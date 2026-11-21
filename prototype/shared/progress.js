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
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
    gate: gate,
    showGate: showGate
  };

  // ---------- 跳關擋回選單（使用者 2026-11-21） ----------
  // 用網址跳過還沒過關的關卡，一律引導回選單：
  //   第 N 關（正式）要先過第 N−1 關；第 N 關練習模式要先過第 N 關（選單也是這樣才出現入口）。
  //   ?unlock=1（老師／開發）與 ?free=1（開發用自由練習）不擋。
  var NAMES = { mirror: '第一關', convex: '第二關', concave: '第三關' };
  function gate(id, practice) {
    if (/[?&](unlock|free)=1/.test(location.search)) return null;
    var need = practice ? id : ORDER[ORDER.indexOf(id) - 1];
    if (!need || !!read()[need]) return null;
    return {
      need: need,
      title: '還沒通過' + NAMES[need],
      note: practice
        ? NAMES[id] + '的練習模式要先通過' + NAMES[id] + '才會開放。請回關卡選單，照順序過關。'
        : '關卡要照順序過關（趕鬼時間也從第一關算起）。請回關卡選單，先完成' + NAMES[need] + '。'
    };
  }
  /** 需要擋就顯示「還沒通過第 N 關」＋【回關卡選單】，回傳 StoryScene 的畫面物件；不用擋回傳 null。 */
  function showGate(id, practice, background) {
    var g = gate(id, practice);
    if (!g || !window.StoryScene) return null;
    return window.StoryScene.show({
      id: 'gate', background: background,
      title: g.title, note: g.note,
      buttons: [{ id: 'gateMenuBtn', label: '回關卡選單', primary: true, href: '../index.html' }]
    });
  }
})();

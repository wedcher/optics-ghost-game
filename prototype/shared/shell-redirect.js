/* 直接開到框裡的某一頁（關卡、排行榜、製作頁）時，轉到外框頁的關卡選單。
 * 使用者 2026-11-22：任何網址進來都先進外框、到關卡選單。
 * 不轉的情況：已經在外框的 iframe 裡（top !== window）、自動化測試（webdriver）、網址有 ?noshell=1。
 * 要放在各頁 <head> 最前面，轉址才不會先載完整頁。 */
(function () {
  try {
    if (window.top !== window || navigator.webdriver || /[?&]noshell=1/.test(location.search)) return;
    var src = document.currentScript && document.currentScript.src;
    if (!src) return;
    location.replace(src.replace(/shared\/shell-redirect\.js.*$/, '') + 'game.html#index.html');
  } catch (e) { /* 留在這一頁照樣能玩 */ }
})();

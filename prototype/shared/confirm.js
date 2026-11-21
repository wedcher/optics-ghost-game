/* 頁面內的確認視窗（取代 window.confirm）。
 * 原因（使用者 2026-11-21）：系統的 confirm()／alert() 會讓 Android 離開全螢幕，也不會跟著直拿轉向。
 * 用法：GameConfirm.ask({ text, ok: '回關卡選單', cancel: '繼續玩' }, function () { …按了確定… });
 * DOM：#gameConfirm（.gc-text、#gcOk、#gcCancel）。按背景也算取消。 */
(function () {
  'use strict';
  var box = null, onOk = null;
  function build() {
    var st = document.createElement('style');
    st.textContent =
      '#gameConfirm{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(5,3,12,.72);padding:16px;font-family:inherit}' +
      '#gameConfirm[hidden]{display:none}' +
      '#gameConfirm .gc-card{max-width:min(440px,92%);background:#1d1630;border:2px solid #7a5cc8;border-radius:14px;padding:18px 18px 14px;color:#f1ecff;box-shadow:0 8px 30px rgba(0,0,0,.6)}' +
      '#gameConfirm .gc-text{font-size:16px;line-height:1.55;margin:0 0 14px}' +
      '#gameConfirm .gc-btns{display:flex;gap:10px;justify-content:flex-end}' +
      '#gameConfirm button{min-height:46px;min-width:96px;padding:6px 16px;font-size:16px;border-radius:10px;border:2px solid #6b57a8;background:#2a2147;color:#f1ecff;cursor:pointer}' +
      '#gameConfirm button.gc-primary{background:#7a4fd8;border-color:#a98cf5}';
    document.head.appendChild(st);
    box = document.createElement('div');
    box.id = 'gameConfirm'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<div class="gc-card"><p class="gc-text"></p><div class="gc-btns">' +
      '<button type="button" id="gcCancel"></button><button type="button" id="gcOk" class="gc-primary"></button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) { if (e.target === box) close(false); });
    box.querySelector('#gcCancel').addEventListener('click', function () { close(false); });
    box.querySelector('#gcOk').addEventListener('click', function () { close(true); });
  }
  function close(ok) {
    var cb = onOk; onOk = null;
    box.hidden = true;
    if (ok && cb) cb();
  }
  function ask(opts, cb) {
    if (!box) build();
    box.querySelector('.gc-text').textContent = opts.text;
    box.querySelector('#gcOk').textContent = opts.ok || '確定';
    box.querySelector('#gcCancel').textContent = opts.cancel || '取消';
    onOk = cb; box.hidden = false;
    box.querySelector('#gcCancel').focus();
  }
  window.GameConfirm = { ask: ask };
})();

/*
 * sfx.js — 過場用的合成音效（Web Audio，不用音檔）。
 *
 *   Sfx.clang()       金屬圓盤落地的「鏘——！」（第一關第一次丟圓盤）
 *   Sfx.nightNoise()  半夜隔壁房間傳來的怪聲：悶悶的敲牆聲 → 長長的木頭嘎吱聲 → 拖東西的聲音（第一關開場）
 *
 * 都是單聲道、沒有方向，不帶任何位置線索。
 * 瀏覽器要使用者點過畫面才能出聲；這兩個音效都在點擊之後才會播放（換句、點地板）。
 * 沒有 Web Audio 或出錯時安靜失敗，不影響遊戲。
 */
(function (root) {
  'use strict';

  var ac = null;
  function ctx() {
    if (!ac) ac = new (root.AudioContext || root.webkitAudioContext)();
    if (ac.state === 'suspended' && ac.resume) ac.resume();
    return ac;
  }
  var noiseBuf = null;
  function noise(a) {
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var s = a.createBufferSource();
    s.buffer = noiseBuf;
    return s;
  }
  // 包絡：t 時快速升到 peak，再以指數衰減 dur 秒
  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }

  // 金屬圓盤：一組不成整數倍的泛音（圓盤的振動模態），每個泛音配一個略偏的副本產生「嗡嗡」拍頻；前面加一下很短的撞擊雜音。
  function strike(a, out, t, level) {
    var f0 = 540;
    [[1, 1, 1.9], [2.31, 0.7, 1.5], [3.9, 0.45, 1.1], [5.73, 0.32, 0.8], [8.1, 0.2, 0.55]].forEach(function (p) {
      [0, 1].forEach(function (k) {
        var o = a.createOscillator(), g = a.createGain();
        o.type = 'sine';
        o.frequency.value = f0 * p[0] * (k ? 1.006 : 1);
        env(g, t, 0.16 * p[1] * level * (k ? 0.6 : 1), 0.004, p[2]);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + p[2] + 0.05);
      });
    });
    var n = noise(a), hp = a.createBiquadFilter(), ng = a.createGain();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    env(ng, t, 0.35 * level, 0.002, 0.05);
    n.connect(hp); hp.connect(ng); ng.connect(out);
    n.start(t); n.stop(t + 0.08);
  }
  function clang() {
    try {
      var a = ctx(), t = a.currentTime + 0.02, out = a.createGain();
      out.gain.value = 0.9; out.connect(a.destination);
      strike(a, out, t, 1);          // 鏘——
      strike(a, out, t + 0.21, 0.28); // 彈一下
      strike(a, out, t + 0.34, 0.1);
    } catch (e) { /* 沒有音效也不影響 */ }
  }

  // 隔牆聽到的聲音：全部經過一個低通濾波器（牆把高頻擋掉），音量偏小
  function knock(a, out, t) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    env(g, t, 0.7, 0.004, 0.16);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    var n = noise(a), lp = a.createBiquadFilter(), ng = a.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    env(ng, t, 0.4, 0.003, 0.08);
    n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.12);
  }
  function creak(a, out, t, dur) {
    // 鋸齒波＋不規則的音高抖動，通過窄帶通，像木門或地板慢慢被壓的嘎——吱聲
    var o = a.createOscillator(), bp = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth';
    var f = 95;
    o.frequency.setValueAtTime(f, t);
    for (var k = 1; k <= 14; k++) {
      f = Math.max(70, Math.min(170, f + (Math.random() - 0.4) * 28));
      o.frequency.linearRampToValueAtTime(f, t + dur * k / 14);
    }
    bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
    g.gain.setValueAtTime(0.5, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function drag(a, out, t, dur) {
    var n = noise(a), bp = a.createBiquadFilter(), g = a.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(260, t); bp.frequency.linearRampToValueAtTime(420, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(out);
    n.start(t); n.stop(t + dur + 0.05);
  }
  function nightNoise() {
    try {
      var a = ctx(), t = a.currentTime + 0.05;
      var wall = a.createBiquadFilter(), out = a.createGain();
      wall.type = 'lowpass'; wall.frequency.value = 1100;
      out.gain.value = 0.8;
      wall.connect(out); out.connect(a.destination);
      knock(a, wall, t); knock(a, wall, t + 0.38); knock(a, wall, t + 0.7);
      creak(a, wall, t + 1.35, 1.6);
      drag(a, wall, t + 3.2, 0.9);
      knock(a, wall, t + 4.3);
    } catch (e) { /* 沒有音效也不影響 */ }
  }

  root.Sfx = { clang: clang, nightNoise: nightNoise };
})(window);

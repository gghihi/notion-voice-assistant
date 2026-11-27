// 音效與背景配樂：全部用瀏覽器即時合成，不用下載任何音樂檔
window.Sound = (() => {
  let ctx = null, master = null, bgmTimer = null;
  const get = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
  const put = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };
  const state = { sfx: get('sfx'), bgm: get('bgm') };

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // 一個音：頻率、開始時間、長度、音量、波形
  function note(freq, at, dur, vol = 0.2, type = 'sine', out) {
    const c = audio(); if (!c) return;
    out = out || master;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + at);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    o.connect(g); g.connect(out);
    o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.05);
  }
  let fx;
  fx = {
    tap() { note(1046, 0, 0.06, 0.12, 'triangle'); note(1568, 0.025, 0.06, 0.06, 'sine'); },
    pop() { note(660, 0, 0.1, 0.15, 'triangle'); note(990, 0.05, 0.12, 0.12, 'triangle'); },
    success() { [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.09, 0.3, 0.16, 'triangle')); },
    error() { note(300, 0, 0.18, 0.15, 'square'); note(220, 0.12, 0.25, 0.12, 'square'); },
  };

  // 噪音（寫字聲、黑膠沙沙聲、鼓的 hi-hat 都用它）
  let noiseBuf = null;
  function noise() {
    const c = audio();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = c.createBufferSource(); n.buffer = noiseBuf; return n;
  }
  function hit(at, dur, vol, filterType, freq, out, q = 1) {
    const c = audio(); if (!c) return;
    const n = noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const t = c.currentTime + at;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(out || master);
    n.start(t, Math.random()); n.stop(t + dur + 0.02);
  }
  // 鉛筆在紙上寫字：一連串長短不一的沙沙聲
  fx.write = () => {
    let t = 0;
    for (let i = 0; i < 9; i++) {
      const d = 0.06 + Math.random() * 0.12;
      hit(t, d, 0.35, 'bandpass', 3000 + Math.random() * 2500, null, 1.2);
      t += d + Math.random() * 0.05;
    }
    note(1318, t + 0.05, 0.25, 0.08, 'triangle'); // 寫完「叮」一下
  };

  // 背景配樂：Lo-fi Disco（約 112 BPM：四拍大鼓、反拍 hi-hat、八度跳動貝斯、柔和電鋼琴和弦、黑膠沙沙聲）
  const BPM = 112, STEP = 60 / BPM / 4; // 一格 = 十六分音符
  const PROG = [ // 和弦（電鋼琴）與貝斯根音
    { chord: [293.7, 349.2, 440, 523.3], bass: 73.4 },   // Dm9
    { chord: [261.6, 329.6, 392, 493.9], bass: 65.4 },   // Cmaj7
    { chord: [233.1, 293.7, 349.2, 440], bass: 58.3 },   // Bbmaj7
    { chord: [220, 277.2, 329.6, 392], bass: 55 },       // A7
  ];
  const BASS = [1, 0, 2, 0, 1, 0, 2, 1, 1, 0, 2, 0, 1, 2, 0, 2]; // 1=根音 2=高八度
  let bus = null, step = 0, nextAt = 0, crackle = null;
  function kick(t) {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.32);
  }
  function tone(freq, t, dur, vol, type) {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function schedule() {
    while (nextAt < ctx.currentTime + 0.25) {
      const s = step % 16, bar = PROG[Math.floor(step / 16) % PROG.length], t = nextAt;
      if (s % 4 === 0) kick(t);                                             // 四拍大鼓
      if (s % 4 === 2) hit(t - ctx.currentTime, 0.04, 0.07, 'highpass', 9000, bus); // 反拍 hi-hat（輕一點）
      if (s === 4 || s === 12) hit(t - ctx.currentTime, 0.12, 0.1, 'bandpass', 1500, bus, 1); // 拍手（柔一點）
      if (BASS[s]) tone(bar.bass * BASS[s], t, STEP * 1.6, 0.22, 'triangle');   // 跳動貝斯
      if (s === 0 || s === 6 || s === 10) bar.chord.forEach((f) => tone(f, t, STEP * (s === 0 ? 5 : 3), 0.045, 'sine')); // 切分和弦
      if (Math.random() < 0.06) hit(t - ctx.currentTime + Math.random() * STEP, 0.008, 0.05, 'bandpass', 1500 + Math.random() * 2000, bus, 2); // 黑膠偶爾的「啵」
      nextAt += STEP; step++;
    }
  }
  function startBgm() {
    const c = audio(); if (!c || bgmTimer) return;
    bus = c.createGain(); bus.gain.value = 0.32;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; // lo-fi 悶悶的感覺
    bus.connect(lp); lp.connect(master);
    step = 0; nextAt = c.currentTime + 0.1;
    schedule(); bgmTimer = setInterval(schedule, 100);
  }
  function stopBgm() {
    clearInterval(bgmTimer); bgmTimer = null;
    if (bus) { bus.disconnect(); bus = null; }
  }

  // 瀏覽器規定要使用者先點一下才能出聲：第一次點擊時才啟動配樂
  document.addEventListener('pointerdown', () => { if (state.bgm) startBgm(); }, { once: true });

  return {
    get sfx() { return state.sfx; }, get bgm() { return state.bgm; },
    play(name) { if (state.sfx) fx[name]?.(); },
    setSfx(v) { state.sfx = v; put('sfx', v); if (v) fx.pop(); },
    setBgm(v) { state.bgm = v; put('bgm', v); v ? startBgm() : stopBgm(); },
  };
})();

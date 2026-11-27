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
  const fx = {
    tap() { note(880, 0, 0.08, 0.12, 'triangle'); },
    pop() { note(660, 0, 0.1, 0.15, 'triangle'); note(990, 0.05, 0.12, 0.12, 'triangle'); },
    success() { [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.09, 0.3, 0.16, 'triangle')); },
    error() { note(300, 0, 0.18, 0.15, 'square'); note(220, 0.12, 0.25, 0.12, 'square'); },
  };

  // 背景配樂：輕柔的和弦琶音，一直循環
  const CHORDS = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 392]];
  let bus = null;
  function startBgm() {
    const c = audio(); if (!c || bgmTimer) return;
    bus = c.createGain(); bus.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
    bus.connect(lp); lp.connect(master);
    let bar = 0;
    const play = () => {
      const ch = CHORDS[bar++ % CHORDS.length];
      note(ch[0] / 2, 0, 3.6, 0.12, 'sine', bus);
      [0, 1, 2, 3, 2, 1, 2, 3].forEach((n, i) => note(ch[n] * (i > 3 ? 2 : 1), i * 0.45, 0.9, 0.06, 'triangle', bus));
    };
    play(); bgmTimer = setInterval(play, 3600);
  }
  function stopBgm() { clearInterval(bgmTimer); bgmTimer = null; if (bus) { bus.disconnect(); bus = null; } }

  // 瀏覽器規定要使用者先點一下才能出聲：第一次點擊時才啟動配樂
  document.addEventListener('pointerdown', () => { if (state.bgm) startBgm(); }, { once: true });

  return {
    get sfx() { return state.sfx; }, get bgm() { return state.bgm; },
    play(name) { if (state.sfx) fx[name]?.(); },
    setSfx(v) { state.sfx = v; put('sfx', v); if (v) fx.pop(); },
    setBgm(v) { state.bgm = v; put('bgm', v); v ? startBgm() : stopBgm(); },
  };
})();

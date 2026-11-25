// Generative, very quiet soundscape that begins only after the first touch.
// Everything musical lives in one D-major pentatonic scale, so any touch, chime or pad note
// is always in harmony (Flower / Alto idea): water taps pluck notes chosen by where you touch,
// watering the bonsai plays a soft rising arpeggio, gusts ring a furin wind bell.
// Layers fade with the world: birds by day, crickets at night, rain when it rains.
const ROOT = 146.83; // D3
const PENTA = [0, 2, 4, 7, 9]; // major pentatonic
const note = (deg, oct = 0) => {
  const o = Math.floor(deg / 5) + oct;
  return ROOT * Math.pow(2, (PENTA[((deg % 5) + 5) % 5] + 12 * o) / 12);
};

export function createAudio() {
  let ctx = null, master = null, started = false, verb = null, verbIn = null;
  // volume buses (the game's audio settings; all 1 in the garden): user (master slider) > master (fades/breath) > music / ambience / effects
  let user = null; const bus = {}, send = {};
  const levels = { master: 1, music: 1, ambience: 1, effects: 1 };
  function applyLevels() {
    if (!ctx) return; const t = ctx.currentTime;
    user.gain.setTargetAtTime(levels.master, t, 0.08);
    for (const [k, n] of [['mus', 'music'], ['amb', 'ambience'], ['fx', 'effects']]) { bus[k].gain.setTargetAtTime(levels[n], t, 0.08); send[k].gain.setTargetAtTime(levels[n], t, 0.08); }
  }
  let rakeGain = null, windGain = null, windF = null, rainGain = null, cricketGain = null, padGain = null, waterGain = null;
  let birdsOn = 0, nightOn = 0, nextBird = 6, nextCricket = 0, nextChord = 0, chordIdx = 0, lastChime = 0;
  const pads = [];

  function noiseBuffer(c, seconds, brown) {
    const len = c.sampleRate * seconds;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  function impulse(c, seconds) {
    const len = c.sampleRate * seconds, buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }
  function loopNoise(buf, type, freq, q, gain, dest = bus.amb) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(dest); s.start();
    return { f, g };
  }

  function start() {
    if (started) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    started = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3;
      comp.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = 0;
      user = ctx.createGain(); user.connect(comp);
      master.connect(user);
      master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 5);
      // soft hall for anything musical
      verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 3.5);
      verbIn = ctx.createGain(); verbIn.gain.value = 0.55;
      const verbOut = ctx.createGain(); verbOut.gain.value = 0.8;
      verbIn.connect(verb).connect(verbOut).connect(master);
      for (const k of ['mus', 'amb', 'fx']) { bus[k] = ctx.createGain(); bus[k].connect(master); send[k] = ctx.createGain(); send[k].connect(verbIn); }
      applyLevels();

      const brown = noiseBuffer(ctx, 6, true);
      const white = noiseBuffer(ctx, 3, false);
      const w = loopNoise(brown, 'lowpass', 420, 0.6, 0.03); windGain = w.g; windF = w.f;
      const wt = loopNoise(white, 'bandpass', 1800, 1.2, 0.005); waterGain = wt.g;
      const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.7;
      const lfo3G = ctx.createGain(); lfo3G.gain.value = 500;
      lfo3.connect(lfo3G).connect(wt.f.frequency); lfo3.start();
      const rk = loopNoise(white, 'bandpass', 2600, 0.8, 0, bus.fx); rakeGain = rk.g;
      const rn = loopNoise(white, 'lowpass', 5200, 0.3, 0); rainGain = rn.g;
      // crickets: a high carrier pulsed by a fast gate, faded in at night
      cricketGain = ctx.createGain(); cricketGain.gain.value = 0;
      cricketGain.connect(bus.amb);

      // pad: three slow voices, low-passed, one gentle chord change every ~20 s
      padGain = ctx.createGain(); padGain.gain.value = 0.0;
      const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900; pf.Q.value = 0.4;
      padGain.connect(pf); pf.connect(bus.mus); pf.connect(send.mus);
      padGain.gain.linearRampToValueAtTime(0.022, ctx.currentTime + 12);
      for (let i = 0; i < 3; i++) {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sine'; o2.type = 'triangle'; o2.detune.value = 6;
        const g = ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.33;
        const g2 = ctx.createGain(); g2.gain.value = 0.35;
        o1.connect(g); o2.connect(g2).connect(g); g.connect(padGain);
        o1.start(); o2.start();
        pads.push([o1, o2]);
      }
      setChord(0, true);
    } catch (e) { ctx = null; }
  }
  const CHORDS = [[0, 2, 4], [-2, 0, 2], [1, 3, 5], [-1, 1, 4], [0, 3, 5]];
  function setChord(i, now) {
    const t = ctx.currentTime;
    CHORDS[i].forEach((deg, k) => {
      const f = note(deg, k === 0 ? -1 : 0);
      for (const o of pads[k]) o.frequency.setTargetAtTime(f, t, now ? 0.01 : 4);
    });
  }

  function out(node, wet = 0.6, b = 'fx') {
    node.connect(bus[b]);
    const s = ctx.createGain(); s.gain.value = wet; node.connect(s).connect(send[b]);
  }
  // kalimba-like pluck: sine + soft 3rd partial with quick decay
  function pluck(freq, vol, t0 = 0, len = 1.6) {
    const t = ctx.currentTime + t0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 3.01;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); o2.connect(g2).connect(g); out(g, 0.7);
    o.start(t); o2.start(t); o.stop(t + len + 0.1); o2.stop(t + len + 0.1);
  }
  // bell (furin / chime): inharmonic partials, long tail
  function bell(freq, vol, t0 = 0) {
    const t = ctx.currentTime + t0;
    [[1, 1, 3.2], [2.76, 0.4, 1.6], [5.4, 0.2, 0.8], [8.9, 0.08, 0.4]].forEach(([m, a, d]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); out(g, 0.8); o.start(t); o.stop(t + d + 0.05);
    });
  }

  // water tap: note from the scale picked by where on the pond you touched (0..1)
  function plink(pos = 0.5, vol = 0.04) {
    if (!ctx) return;
    const deg = 5 + Math.round(pos * 7);
    pluck(note(deg), vol * 0.9, 0, 1.4);
    // little droplet blip on top
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(bus.fx); o.start(t); o.stop(t + 0.3);
  }
  function chime() {
    if (!ctx) return;
    const base = 7 + Math.floor(Math.random() * 3);
    [0, 1, 2, 4].forEach((d, i) => bell(note(base + d), 0.016 * (1 - i * 0.12), i * 0.16));
  }
  function shimmer() {
    if (!ctx) return;
    [10, 12, 14].forEach((d, i) => bell(note(d), 0.006, i * 0.22));
  }
  function craneCall() {
    if (!ctx) return;
    // distant, soft two-note call (far away and heavily reverberated)
    [0, 0.45].forEach((t0, i) => {
      const t = ctx.currentTime + 1.5 + t0;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(i ? 820 : 760, t); o.frequency.linearRampToValueAtTime(i ? 700 : 690, t + 0.35);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.006, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(f).connect(g); out(g, 1.2); o.start(t); o.stop(t + 0.55);
    });
  }
  function splash() { if (ctx) { plink(Math.random(), 0.03); } }
  // snapdragon chomp: a tiny soft wooden 'pok' pitched in the scale, plus a breath of air
  function chomp(deg = 7, vol = 0.03) {
    if (!ctx) return;
    const t = ctx.currentTime, f = note(deg + 5);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); out(g, 0.35); o.start(t); o.stop(t + 0.2);
    pluck(f * 2, vol * 0.25, 0.09, 0.5);
  }
  // a find lifted from the sand: a little rising three-note figure
  function pickup(rare = 0) {
    if (!ctx) return;
    const b = 7 + Math.floor(Math.random() * 3);
    [0, 2, 4].forEach((d, i) => pluck(note(b + d), 0.03 * (1 - i * 0.15), i * 0.14, 2.2));
    if (rare) [9, 11].forEach((d, i) => bell(note(b + d), 0.008, 0.5 + i * 0.25));
  }
  function place() { if (ctx) pluck(note(4), 0.022, 0, 1.2); }
  function turn() { if (ctx) bell(note(11 + Math.floor(Math.random() * 3)), 0.006); }
  // lizard scurry: a few tiny dry ticks
  function skitter() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const t0 = t + i * 0.045;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 2400 + Math.random() * 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.004, t0 + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
      o.connect(g).connect(bus.fx); o.start(t0); o.stop(t0 + 0.04);
    }
  }
  // breathing: soundscape softens; each inhale lifts a low pad note, each exhale lets it go
  let breathK = 0;
  function breath(on, inhale) {
    if (!ctx) return;
    breathK = on ? 1 : 0;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(on ? 0.7 : 0.9, t, 2);
    if (on && inhale != null) {
      const f = note(inhale ? 2 : 0, -1);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const L = inhale ? 4 : 6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + L * 0.45); g.gain.linearRampToValueAtTime(0, t + L);
      o.connect(g); out(g, 0.9); o.start(t); o.stop(t + L + 0.1);
    }
  }
  function lotus() { if (ctx) [0, 2, 4, 7].forEach((d, i) => bell(note(7 + d), 0.01, i * 0.35)); }
  function rake(speed) {
    if (!rakeGain) return;
    rakeGain.gain.setTargetAtTime(Math.min(0.03, speed * 0.004), ctx.currentTime, 0.08);
  }
  function bird() {
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.11 + Math.random() * 0.06);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), t0 + 0.07);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.0045 * birdsOn, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.connect(g); out(g, 0.9, 'amb'); o.start(t0); o.stop(t0 + 0.1);
    }
  }
  function cricket() {
    const t = ctx.currentTime, f = 4300 + Math.random() * 600;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.055;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.008); g.gain.linearRampToValueAtTime(0, t0 + 0.035);
      o.connect(g).connect(cricketGain); o.start(t0); o.stop(t0 + 0.04);
    }
  }

  // called every frame with the world state
  function update(dt, { gust = 1, night = 0, rain = 0, mist = 0 }) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    windGain.gain.setTargetAtTime(0.012 + 0.03 * gust + rain * 0.01, t, 0.5);
    windF.frequency.setTargetAtTime(260 + 260 * gust, t, 0.5);
    rainGain.gain.setTargetAtTime(rain * 0.035, t, 1.5);
    waterGain.gain.setTargetAtTime(0.005 * (1 - rain * 0.5), t, 1);
    nightOn = night;
    birdsOn = (1 - night) * (1 - rain) * (1 - mist * 0.5) * (1 - breathK * 0.7);
    cricketGain.gain.setTargetAtTime(0.0035 * night * (1 - rain), t, 2);
    nextBird -= dt;
    if (nextBird < 0) { nextBird = 7 + Math.random() * 16; if (birdsOn > 0.2) bird(); }
    nextCricket -= dt;
    if (nextCricket < 0) { nextCricket = 0.6 + Math.random() * 1.4; if (nightOn > 0.2) cricket(); }
    nextChord -= dt;
    if (nextChord < 0) { nextChord = 18 + Math.random() * 10; chordIdx = (chordIdx + 1 + Math.floor(Math.random() * 2)) % CHORDS.length; setChord(chordIdx); }
    // a gust strong enough rings the wind bell, now and then
    lastChime -= dt;
    if (gust > 1.15 && lastChime < 0 && Math.random() < dt * 0.6) {
      lastChime = 9 + Math.random() * 14;
      bell(note(10 + Math.floor(Math.random() * 5)), 0.007);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
  function setLevels(l) { Object.assign(levels, l); applyLevels(); }
  return { setLevels, start, plink, chime, rake, shimmer, craneCall, splash, update, chomp, pickup, place, turn, skitter, breath, lotus, raw: () => ({ ctx, master, out }) };
}

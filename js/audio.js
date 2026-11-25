// Garden sound: a generative, very quiet D-major-pentatonic bed (Flower / Alto idea)
// that begins on the first touch, plus a sampled mixer used by the exploration game.
//
// Public API is stable. Existing calls (plink, chime, rake, splash, update, ...)
// keep working. New hooks for the settings menu (BMSG-9) and movement/physics (BMSG-11):
//   audio.setVolumes({ master, music, ambience, effects, voice }) / getVolumes()
//   audio.footstep(material, speed), audio.impact(material, force), audio.break(material)
// Spatial sounds use PannerNode (HRTF on PC, equalpower on phones) with distance
// falloff and a light low-pass when a source is behind the listener or occluded.
// Reverb zones: garden, open, forest, cave, interior, space.
import { isGameWorld } from './game/flags.js';
import { createLoader } from './audio-load.js';
import { createMusic } from './audio-music.js';

const ROOT = 146.83; // D3
const PENTA = [0, 2, 4, 7, 9];
const note = (deg, oct = 0) => {
  const o = Math.floor(deg / 5) + oct;
  return ROOT * Math.pow(2, (PENTA[((deg % 5) + 5) % 5] + 12 * o) / 12);
};

const VOL_DEF = { master: 1, music: 0.8, ambience: 1, effects: 1, voice: 1 };
const ZONE_IR = {
  // seconds, decay exponent, lowpass on the impulse, send amount
  garden:    [3.5, 3.2, 9000, 0.55],
  open:      [2.6, 3.0, 8000, 0.4],
  forest:    [2.2, 2.6, 4200, 0.5],
  cave:      [4.4, 2.2, 5500, 0.7],
  interior:  [0.85, 4.5, 3500, 0.28],
  space:     [0.4, 5.0, 2000, 0.08],
};

export function createAudio(opts = {}) {
  const P = opts.P || {};
  const phone = P.cls ? P.cls !== 'pc' : !!opts.phone;
  const game = opts.game != null ? !!opts.game : isGameWorld();
  const MAX = phone ? 10 : 26;
  const vol = { ...VOL_DEF, ...(opts.volumes || {}) };
  let muted = false;

  let ctx = null, started = false;
  let master, musicBus, ambBus, fxBus, voiceBus, duckGain;
  let verbA, verbB, verbSendA, verbSendB, verbOut, verbWhich = 0;
  let zone = 'garden', zoneTarget = 'garden';
  let rakeGain = null, windGain = null, windF = null, rainGain = null, cricketGain = null, padGain = null, waterGain = null;
  let sampRain = null, sampWater = null, sampWind = null; // { src, gain }
  let birdsOn = 0, nightOn = 0, nextBird = 6, nextCricket = 0, nextChord = 0, chordIdx = 0, lastChime = 0, nextThunder = 18;
  const pads = [];
  let voices = 0, duckAmt = 0, rumbleNode = null;
  const spatial = []; // { lp, panner, occlude, outdoor }
  const attached = []; // { object, panner }
  let lastCam = null, lastState = {};
  const loader = createLoader();
  const music = createMusic({ getBus: () => musicBus, load: loader, phone, game });

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
  function impulse(c, seconds, exp = 3.2, lp = 0) {
    const len = Math.max(32, Math.floor(c.sampleRate * seconds));
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, exp);
    }
    // a gentle tilt off the top for darker rooms (applied as a one-pole on the IR)
    if (lp > 0 && lp < 18000) {
      const a = Math.exp(-2 * Math.PI * lp / c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch); let y = 0;
        for (let i = 0; i < len; i++) { y = (1 - a) * d[i] + a * y; d[i] = y; }
      }
    }
    return buf;
  }

  function applyVolumes(t = 0.05) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const m = muted ? 0 : 1;
    master.gain.setTargetAtTime(0.9 * vol.master * m, now, t);
    if (duckGain) duckGain.gain.setTargetAtTime(vol.music * (1 - duckAmt), now, t);
    ambBus.gain.setTargetAtTime(vol.ambience, now, t);
    fxBus.gain.setTargetAtTime(vol.effects, now, t);
    voiceBus.gain.setTargetAtTime(vol.voice, now, t);
  }

  function makeVerb(ir) {
    const v = ctx.createConvolver(); v.buffer = ir;
    const send = ctx.createGain(); send.gain.value = 0;
    const out = ctx.createGain(); out.gain.value = 0.8;
    send.connect(v).connect(out).connect(master);
    return { v, send, out };
  }

  function setZone(name) {
    const z = ZONE_IR[name] ? name : 'open';
    zoneTarget = z;
    if (!ctx || z === zone) { zone = z; return; }
    const spec = ZONE_IR[z];
    const ir = impulse(ctx, phone ? Math.min(1.2, spec[0]) : spec[0], spec[1], spec[2]);
    const now = ctx.currentTime;
    const fade = 0.9;
    if (verbWhich === 0) {
      verbB.buffer = ir;
      verbSendB.gain.setTargetAtTime(spec[3], now, fade);
      verbSendA.gain.setTargetAtTime(0, now, fade);
      verbWhich = 1;
    } else {
      verbA.buffer = ir;
      verbSendA.gain.setTargetAtTime(spec[3], now, fade);
      verbSendB.gain.setTargetAtTime(0, now, fade);
      verbWhich = 0;
    }
    zone = z;
  }

  function loopNoise(buf, type, freq, q, gain, dest) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(dest || ambBus);
    s.start();
    return { f, g, s };
  }

  function start() {
    if (started) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    started = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3; comp.knee.value = 12;
      comp.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = 0; master.connect(comp);
      musicBus = ctx.createGain(); musicBus.gain.value = 1;
      duckGain = ctx.createGain(); duckGain.gain.value = vol.music;
      musicBus.connect(duckGain).connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = vol.ambience; ambBus.connect(master);
      fxBus = ctx.createGain(); fxBus.gain.value = vol.effects; fxBus.connect(master);
      voiceBus = ctx.createGain(); voiceBus.gain.value = vol.voice; voiceBus.connect(master);

      const garden = ZONE_IR.garden;
      const A = makeVerb(impulse(ctx, phone ? 1.4 : garden[0], garden[1], garden[2]));
      const B = makeVerb(impulse(ctx, 0.8, 4, 4000));
      verbA = A.v; verbSendA = A.send; verbB = B.v; verbSendB = B.send; verbOut = A.out;
      verbSendA.gain.value = garden[3];
      verbSendB.gain.value = 0;

      // fade the whole garden in slowly, the way it always has
      master.gain.linearRampToValueAtTime(0.9 * vol.master, ctx.currentTime + 5);

      const brown = noiseBuffer(ctx, 6, true);
      const white = noiseBuffer(ctx, 3, false);
      const w = loopNoise(brown, 'lowpass', 420, 0.6, 0.03);
      windGain = w.g; windF = w.f;
      const wt = loopNoise(white, 'bandpass', 1800, 1.2, 0.005);
      waterGain = wt.g;
      const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.7;
      const lfo3G = ctx.createGain(); lfo3G.gain.value = 500;
      lfo3.connect(lfo3G).connect(wt.f.frequency); lfo3.start();
      const rk = loopNoise(white, 'bandpass', 2600, 0.8, 0, fxBus); rakeGain = rk.g;
      const rn = loopNoise(white, 'lowpass', 5200, 0.3, 0); rainGain = rn.g;
      cricketGain = ctx.createGain(); cricketGain.gain.value = 0; cricketGain.connect(ambBus);

      padGain = ctx.createGain(); padGain.gain.value = 0.0;
      const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900; pf.Q.value = 0.4;
      padGain.connect(pf); pf.connect(ambBus); pf.connect(verbSendA);
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

      music.attach(ctx);
      if (game) {
        loader.manifest().then(() => {
          music.preload('earth');
          // sampled rain / pond / wind sit under the synthesised beds
          bootLoop('amb-rain', (n) => { sampRain = n; });
          bootLoop('amb-water', (n) => { sampWater = n; });
          bootLoop('amb-wind', (n) => { sampWind = n; });
          const steps = ['grass', 'sand', 'stone', 'wood', 'gravel', 'snow', 'metal', 'regolith'];
          loader.warmup(ctx, 'sfx', steps.flatMap((m) => [0, 1, 2].map((i) => `step-${m}-${i}`)));
        }).catch(() => {});
      }
    } catch (e) { ctx = null; }
  }

  function bootLoop(id, assign) {
    loader.get(ctx, 'amb', id).then((rec) => {
      if (!rec || !ctx) return;
      const src = ctx.createBufferSource(); src.buffer = rec.buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(g).connect(ambBus);
      g.connect(verbSendA);
      src.start();
      assign({ src, gain: g, rec });
    }).catch(() => {});
  }

  const CHORDS = [[0, 2, 4], [-2, 0, 2], [1, 3, 5], [-1, 1, 4], [0, 3, 5]];
  function setChord(i, now) {
    const t = ctx.currentTime;
    CHORDS[i].forEach((deg, k) => {
      const f = note(deg, k === 0 ? -1 : 0);
      for (const o of pads[k]) o.frequency.setTargetAtTime(f, t, now ? 0.01 : 4);
    });
  }

  function out(node, wet = 0.6) {
    node.connect(fxBus);
    const s = ctx.createGain(); s.gain.value = wet;
    node.connect(s).connect(verbSendA);
  }
  function takeVoice() { if (voices >= MAX) return false; voices++; return true; }
  function endVoice() { voices = Math.max(0, voices - 1); }

  function duck(amount = 0.32) { duckAmt = Math.max(duckAmt, amount); }

  function setPannerPos(p, x, y, z) {
    if (p.positionX) { p.positionX.setValueAtTime(x, ctx.currentTime); p.positionY.setValueAtTime(y, ctx.currentTime); p.positionZ.setValueAtTime(z, ctx.currentTime); }
    else if (p.setPosition) p.setPosition(x, y, z);
  }
  function setListener(cam) {
    if (!ctx || !cam) return;
    lastCam = cam;
    const L = ctx.listener;
    const p = cam.position;
    cam.updateMatrixWorld?.();
    const e = cam.matrixWorld && cam.matrixWorld.elements;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      if (e) {
        // three.js camera looks down -Z; listener forward is the third column, negated
        L.forwardX.setValueAtTime(-e[8], t); L.forwardY.setValueAtTime(-e[9], t); L.forwardZ.setValueAtTime(-e[10], t);
        L.upX.setValueAtTime(e[4], t); L.upY.setValueAtTime(e[5], t); L.upZ.setValueAtTime(e[6], t);
      }
    } else if (L.setPosition) {
      L.setPosition(p.x, p.y, p.z);
      if (e && L.setOrientation) L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  function playBuf(buf, opts = {}) {
    if (!ctx || !buf || !takeVoice()) return null;
    const t = ctx.currentTime + (opts.when || 0);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = !!opts.loop;
    if (opts.rate) src.playbackRate.value = opts.rate;
    const g = ctx.createGain();
    g.gain.value = opts.vol == null ? 1 : opts.vol;
    const dest = opts.bus || fxBus;
    let lp = null, panner = null;
    if (opts.x != null) {
      lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = opts.occlude ? 1100 : 16000;
      panner = ctx.createPanner();
      panner.panningModel = phone ? 'equalpower' : 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.refDistance || 2.5;
      panner.maxDistance = opts.maxDistance || 48;
      panner.rolloffFactor = opts.rolloff || 1.15;
      setPannerPos(panner, opts.x, opts.y || 0, opts.z);
      src.connect(lp).connect(panner).connect(g);
      const rec = { lp, panner, occlude: opts.occlude || 0, outdoor: !!opts.outdoor };
      spatial.push(rec);
      src.onended = () => { endVoice(); const i = spatial.indexOf(rec); if (i >= 0) spatial.splice(i, 1); opts.onend && opts.onend(); };
    } else {
      src.connect(g);
      src.onended = () => { endVoice(); opts.onend && opts.onend(); };
    }
    g.connect(dest);
    if (opts.wet) { const s = ctx.createGain(); s.gain.value = opts.wet; g.connect(s).connect(verbSendA); }
    try { src.start(t, opts.offset || 0, opts.duration); } catch (e) { try { src.start(t); } catch (err) { endVoice(); return null; } }
    return { src, gain: g, panner, lp };
  }

  function playAt(id, pos, opts = {}) {
    if (!ctx) return;
    const kind = opts.kind || 'sfx';
    loader.get(ctx, kind, id).then((rec) => {
      if (!rec) return;
      playBuf(rec.buf, { ...opts, x: pos && pos.x, y: pos && pos.y, z: pos && pos.z, vol: (opts.vol == null ? 1 : opts.vol) * (rec.vol || 1) });
    }).catch(() => {});
  }

  function attach(object, id, opts = {}) {
    if (!ctx || !object) return { stop() {} };
    let handle = { object, panner: null, src: null };
    loader.get(ctx, opts.kind || 'amb', id).then((rec) => {
      if (!rec) return;
      const n = playBuf(rec.buf, { ...opts, loop: true, x: object.position.x, y: object.position.y, z: object.position.z });
      if (!n) return;
      handle.src = n.src; handle.panner = n.panner;
      attached.push(handle);
    }).catch(() => {});
    return { stop() { try { handle.src && handle.src.stop(); } catch (e) { /* */ } const i = attached.indexOf(handle); if (i >= 0) attached.splice(i, 1); } };
  }

  // kalimba-like pluck: sine + soft 3rd partial with quick decay
  function pluck(freq, vol, t0 = 0, len = 1.6) {
    if (!ctx || !takeVoice()) return;
    const t = ctx.currentTime + t0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 3.01;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); o2.connect(g2).connect(g); out(g, 0.7);
    o.start(t); o2.start(t); o.stop(t + len + 0.1); o2.stop(t + len + 0.1);
    o.onended = endVoice;
  }
  function bell(freq, vol, t0 = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + t0;
    [[1, 1, 3.2], [2.76, 0.4, 1.6], [5.4, 0.2, 0.8], [8.9, 0.08, 0.4]].forEach(([m, a, d], i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); out(g, 0.8); o.start(t); o.stop(t + d + 0.05);
      if (i === 0) { if (!takeVoice()) return; o.onended = endVoice; }
    });
  }

  function plink(pos = 0.5, vol = 0.04) {
    if (!ctx) return;
    const deg = 5 + Math.round(pos * 7);
    pluck(note(deg), vol * 0.9, 0, 1.4);
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(fxBus); o.start(t); o.stop(t + 0.3);
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
    [0, 0.45].forEach((t0, i) => {
      const t = ctx.currentTime + 1.5 + t0;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(i ? 820 : 760, t); o.frequency.linearRampToValueAtTime(i ? 700 : 690, t + 0.35);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.006, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(f).connect(g); out(g, 1.2); o.start(t); o.stop(t + 0.55);
    });
  }
  function splash() { if (ctx) plink(Math.random(), 0.03); }
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
  function pickup(rare = 0) {
    if (!ctx) return;
    const b = 7 + Math.floor(Math.random() * 3);
    [0, 2, 4].forEach((d, i) => pluck(note(b + d), 0.03 * (1 - i * 0.15), i * 0.14, 2.2));
    if (rare) { [9, 11].forEach((d, i) => bell(note(b + d), 0.008, 0.5 + i * 0.25)); if (game) music.setActivity('discover', 8); duck(0.2); }
  }
  function place() { if (ctx) pluck(note(4), 0.022, 0, 1.2); }
  function turn() { if (ctx) bell(note(11 + Math.floor(Math.random() * 3)), 0.006); }
  function skitter() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const t0 = t + i * 0.045;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 2400 + Math.random() * 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.004, t0 + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
      o.connect(g).connect(fxBus); o.start(t0); o.stop(t0 + 0.04);
    }
  }
  let breathK = 0;
  function breath(on, inhale) {
    if (!ctx) return;
    breathK = on ? 1 : 0;
    const t = ctx.currentTime;
    if (duckGain) duckGain.gain.setTargetAtTime(vol.music * (on ? 0.55 : 1), t, 2);
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
      o.connect(g); out(g, 0.9); o.start(t0); o.stop(t0 + 0.1);
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

  // ---- footsteps, impacts (samples when ready, quiet synth otherwise)
  const SURF = {
    grass:    ['bandpass', 1900, 0.7, 0.16, 0.035, 0],
    gravel:   ['bandpass', 2600, 0.9, 0.2, 0.05, 5],
    sand:     ['lowpass', 1300, 0.6, 0.22, 0.04, 0],
    regolith: ['lowpass', 520, 0.8, 0.2, 0.06, 2],
    snow:     ['bandpass', 1500, 1.2, 0.24, 0.045, 3],
    stone:    ['highpass', 900, 0.7, 0.07, 0.03, 0],
    wood:     ['lowpass', 700, 2.5, 0.09, 0.05, 0],
    metal:    ['bandpass', 2200, 1.4, 0.08, 0.045, 2],
  };
  const MAT_ALIAS = { dirt: 'grass', mud: 'sand', ice: 'snow', water: 'sand', concrete: 'stone', rock: 'stone', soil: 'sand', leaves: 'grass', crystal: 'stone' };
  const stepIx = {}, stepBuf = { n: 0 };
  function noiseStep() {
    if (stepBuf.buf) return stepBuf.buf;
    if (!ctx) return null;
    const n = Math.floor(ctx.sampleRate * 0.4); const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0); let b = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b = 0.7 * b + 0.3 * w; d[i] = b * 1.6; }
    stepBuf.buf = buf; return buf;
  }
  function synthStep(surface, k) {
    if (!ctx || ctx.state !== 'running') return;
    const s = SURF[surface] || SURF.grass;
    const t = ctx.currentTime + 0.005; stepBuf.n ^= 1;
    const vol = s[4] * Math.min(1.3, 0.55 + 0.45 * k) * (0.8 + Math.random() * 0.4) * (stepBuf.n ? 1 : 0.85);
    const src = ctx.createBufferSource(); src.buffer = noiseStep();
    const f = ctx.createBiquadFilter(); f.type = s[0]; f.frequency.value = s[1] * (0.85 + Math.random() * 0.3); f.Q.value = s[2];
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(vol * 0.25, t + s[3] * 0.4);
    g.gain.linearRampToValueAtTime(vol * 0.6, t + s[3] * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + s[3]);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = stepBuf.n ? 0.12 : -0.12;
    src.connect(f).connect(g); (pan ? g.connect(pan) : g).connect(fxBus);
    src.start(t, Math.random() * 0.15, s[3] + 0.05);
  }
  function footstep(material, speed = 1) {
    const mat = MAT_ALIAS[material] || material || 'grass';
    const k = typeof speed === 'number' ? speed : 1;
    if (!ctx) return;
    const ix = stepIx[mat] = ((stepIx[mat] || 0) + 1) % 3;
    const id = `step-${mat}-${ix}`;
    const buf = loader.peek('sfx', id);
    if (buf) {
      playBuf(buf, { vol: 0.22 * Math.min(1.3, 0.55 + 0.45 * k), rate: 0.94 + Math.random() * 0.12, wet: 0.15 });
      return;
    }
    synthStep(mat, k);
    if (ctx) loader.get(ctx, 'sfx', id).catch(() => {});
  }
  function hit(kind, material, force = 1) {
    const mat = MAT_ALIAS[material] || material || 'stone';
    const id = `${kind}-${mat}`;
    const k = Math.min(1.6, 0.45 + 0.7 * (force || 1));
    const buf = loader.peek('sfx', id);
    if (buf) { playBuf(buf, { vol: 0.35 * k, rate: 0.92 + Math.random() * 0.16, wet: 0.3 }); duck(0.15 * k); return; }
    // tiny fallback: a filtered noise burst
    if (!ctx) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseStep();
    const f = ctx.createBiquadFilter(); f.type = mat === 'metal' ? 'bandpass' : 'lowpass'; f.frequency.value = mat === 'wood' ? 700 : mat === 'metal' ? 1800 : 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08 * k, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    src.connect(f).connect(g).connect(fxBus); src.start(t, 0, 0.3);
    if (ctx) loader.get(ctx, 'sfx', id).catch(() => {});
  }
  function impact(material, force) { hit('impact', material, force); }
  function brk(material, force) { hit('break', material, force); }

  function rumble(level) {
    if (!ctx) return;
    const k = Math.max(0, Math.min(1, level || 0));
    if (k <= 0) {
      if (rumbleNode) { rumbleNode.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6); const n = rumbleNode; rumbleNode = null; setTimeout(() => { try { n.src.stop(); } catch (e) { /* */ } }, 2500); }
      return;
    }
    if (!rumbleNode) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 2, true); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(fxBus); src.start();
      rumbleNode = { src, gain: g, f };
    }
    rumbleNode.gain.gain.setTargetAtTime(0.28 * k, ctx.currentTime, 0.25);
    if (k > 0.4) duck(0.25);
  }

  function ui(name) {
    if (!ctx) return;
    if (name === 'hover' || name === 'tick') { pluck(note(11), 0.008, 0, 0.4); return; }
    if (name === 'back') { pluck(note(4), 0.016, 0, 0.7); return; }
    if (name === 'confirm' || name === 'open') { pluck(note(7), 0.02, 0, 1.0); bell(note(11), 0.006, 0.08); return; }
    pluck(note(5), 0.014, 0, 0.7);
  }

  function creature(species, opts = {}) {
    if (!ctx) return;
    const plan = typeof species === 'string' ? species : (species && (species.plan || species.label || species.name)) || 'quad';
    const mood = opts.mood || 'call';
    const seed = opts.seed || 0;
    const size = opts.size || 1;
    // hash a stable pitch offset per individual
    const jitter = ((Math.sin(seed * 12.9898) * 43758.5453) % 1);
    const pitch = (opts.pitch || 1) * (0.9 + 0.2 * jitter) * (0.85 + 0.15 / Math.max(0.5, size));
    const t = ctx.currentTime + 0.02;
    const vol = (mood === 'startle' ? 0.045 : mood === 'curious' ? 0.02 : 0.028) * (opts.vol || 1);
    // body-plan colour: quads are low and breathy, striders pipe, crawlers rasp
    const base = /strider|bird|tall/i.test(plan) ? 620 : /crawl|monitor|lizard/i.test(plan) ? 240 : 340;
    const f0 = base * pitch;
    const n = mood === 'startle' ? 3 : mood === 'curious' ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (mood === 'startle' ? 0.07 : 0.18);
      const o = ctx.createOscillator(); o.type = /crawl/i.test(plan) ? 'square' : 'triangle';
      o.frequency.setValueAtTime(f0 * (i ? 0.85 : 1), t0);
      o.frequency.linearRampToValueAtTime(f0 * (mood === 'startle' ? 1.25 : 0.92) * (i ? 0.9 : 1), t0 + 0.16);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = f0 * 2.4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o.connect(f).connect(g);
      if (opts.x != null) {
        const p = ctx.createPanner(); p.panningModel = phone ? 'equalpower' : 'HRTF';
        p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 36; p.rolloffFactor = 1.2;
        setPannerPos(p, opts.x, opts.y || 0, opts.z);
        g.connect(p).connect(fxBus); p.connect(verbSendA);
      } else out(g, 0.7);
      o.start(t0); o.stop(t0 + 0.35);
    }
    if (mood === 'startle' && game) duck(0.12);
  }

  function thunder(kind) {
    if (!ctx || phone && kind === 'near') { kind = 'far'; }
    const id = kind === 'near' ? 'thunder-near' : 'thunder-far';
    loader.get(ctx, 'amb', id).then((rec) => {
      if (!rec) return;
      const cam = lastCam && lastCam.position;
      const ang = Math.random() * Math.PI * 2, dist = kind === 'near' ? 18 + Math.random() * 16 : 40 + Math.random() * 30;
      const x = (cam ? cam.x : 0) + Math.cos(ang) * dist;
      const z = (cam ? cam.z : 0) + Math.sin(ang) * dist;
      playBuf(rec.buf, { vol: kind === 'near' ? 0.55 : 0.32, x, y: 8, z, wet: 0.4, outdoor: true, maxDistance: 80, refDistance: 14 });
      duck(kind === 'near' ? 0.4 : 0.22);
    }).catch(() => {});
  }

  function tickSpatial(state) {
    if (!lastCam) return;
    lastCam.updateMatrixWorld?.();
    const e = lastCam.matrixWorld && lastCam.matrixWorld.elements;
    const fx = e ? -e[8] : 0, fy = e ? -e[9] : 0, fz = e ? -e[10] : 1;
    const px = lastCam.position.x, py = lastCam.position.y, pz = lastCam.position.z;
    const indoors = !!state.indoors;
    for (const s of spatial) {
      const p = s.panner; if (!p || !p.positionX) continue;
      const dx = p.positionX.value - px, dy = p.positionY.value - py, dz = p.positionZ.value - pz;
      const len = Math.hypot(dx, dy, dz) || 1;
      const behind = (dx * fx + dy * fy + dz * fz) / len < -0.15;
      let cut = 16000;
      if (behind) cut = Math.min(cut, 2400);
      if (s.occlude) cut = Math.min(cut, 1100);
      if (indoors && s.outdoor) cut = Math.min(cut, 800);
      s.lp && s.lp.frequency.setTargetAtTime(cut, ctx.currentTime, 0.08);
    }
    for (const a of attached) {
      if (!a.panner || !a.object || !a.object.position) continue;
      const q = a.object.position;
      setPannerPos(a.panner, q.x, q.y, q.z);
    }
  }

  function update(dt, state = {}) {
    lastState = state;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const gust = state.gust == null ? 1 : state.gust;
    const night = state.night || 0;
    const rain = state.rain || 0;
    const mist = state.mist || 0;
    const snow = state.snow || 0;
    const speed = state.speed || 0;
    const alt = state.altitude != null ? state.altitude : (lastCam ? lastCam.position.y : 1.6);
    const nearWater = state.nearWater || 0;
    if (state.camera) setListener(state.camera);
    if (state.zone && state.zone !== zoneTarget) setZone(state.zone);

    const windWant = 0.012 + 0.03 * gust + rain * 0.01 + Math.min(0.03, Math.max(0, alt - 4) * 0.004) + Math.min(0.02, speed * 0.004);
    windGain && windGain.gain.setTargetAtTime(windWant, t, 0.5);
    windF && windF.frequency.setTargetAtTime(260 + 260 * gust + Math.min(400, speed * 40), t, 0.5);
    rainGain && rainGain.gain.setTargetAtTime(rain * 0.035, t, 1.5);
    waterGain && waterGain.gain.setTargetAtTime(0.005 * (1 - rain * 0.5) + nearWater * 0.02, t, 1);
    if (sampRain) sampRain.gain.gain.setTargetAtTime(rain * 0.45, t, 1.4);
    if (sampWater) sampWater.gain.gain.setTargetAtTime(nearWater * 0.35 * (1 - rain * 0.4), t, 0.8);
    if (sampWind) sampWind.gain.gain.setTargetAtTime(Math.min(0.35, windWant * 4), t, 0.8);

    nightOn = night;
    birdsOn = (1 - night) * (1 - rain) * (1 - mist * 0.5) * (1 - breathK * 0.7);
    cricketGain && cricketGain.gain.setTargetAtTime(0.0035 * night * (1 - rain), t, 2);
    nextBird -= dt;
    if (nextBird < 0) { nextBird = 7 + Math.random() * 16; if (birdsOn > 0.2) bird(); }
    nextCricket -= dt;
    if (nextCricket < 0) { nextCricket = 0.6 + Math.random() * 1.4; if (nightOn > 0.2) cricket(); }
    nextChord -= dt;
    if (nextChord < 0 && pads.length) { nextChord = 18 + Math.random() * 10; chordIdx = (chordIdx + 1 + Math.floor(Math.random() * 2)) % CHORDS.length; setChord(chordIdx); }
    lastChime -= dt;
    if (gust > 1.15 && lastChime < 0 && Math.random() < dt * 0.6) {
      lastChime = 9 + Math.random() * 14;
      bell(note(10 + Math.floor(Math.random() * 5)), 0.007);
    }
    // thunder, only when it's really raining, and never in mom's preview often — game gets the samples
    if (game && rain > 0.55 && !state.indoors && zone !== 'interior' && zone !== 'space') {
      nextThunder -= dt;
      if (nextThunder < 0) {
        nextThunder = 14 + Math.random() * 28;
        thunder(Math.random() < 0.28 ? 'near' : 'far');
      }
    } else if (rain < 0.2) nextThunder = Math.min(nextThunder, 8);

    if (duckAmt > 0) { duckAmt = Math.max(0, duckAmt - dt * 0.35); applyVolumes(0.25); }
    music.update(dt, state);
    tickSpatial(state);
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  function setVolumes(v = {}) {
    if (v.master != null) vol.master = +v.master;
    if (v.music != null) vol.music = +v.music;
    if (v.ambience != null) vol.ambience = +v.ambience;
    if (v.effects != null) vol.effects = +v.effects;
    if (v.voice != null) vol.voice = +v.voice;
    applyVolumes(0.08);
  }

  return {
    start,
    plink, chime, rake, shimmer, craneCall, splash, update, chomp, pickup, place, turn, skitter, breath, lotus,
    raw: () => ({ ctx, master: fxBus || master, out, buses: { master, music: musicBus, ambience: ambBus, effects: fxBus, voice: voiceBus } }),
    // settings menu (BMSG-9): wire sliders to these. Keys: master, music, ambience, effects, voice (0..1)
    setVolumes, setLevels: setVolumes, getVolumes: () => ({ ...vol, muted }), setMuted(on) { muted = !!on; applyVolumes(0.05); },
    // movement / physics (BMSG-11)
    footstep, impact, break: brk, rumble,
    // spatial / world
    setListener, playAt, attach, setZone, setWorld(id) { music.setWorld(id); if (id === 'space') setZone('space'); else if (id === 'moon') setZone('open'); else if (id === 'planet') setZone('open'); else setZone('garden'); music.preload(id); },
    setActivity: (n, s) => music.setActivity(n, s),
    creature, thunder, ui, collect: pickup,
  };
}

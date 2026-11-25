// Footsteps, synthesised: a short filtered-noise crunch shaped per surface. Quiet and a little
// different every step. Needs the shared audio (audio.raw() -> { ctx, master }); silent until started.
//   const steps = createSteps(audio); steps.play('grass' | 'gravel' | 'sand' | 'regolith' | 'snow' | 'stone' | 'wood', k)
const SURF = {
  //        filter  freq  q    len   vol   grains  (grains: little sub-clicks, for crunchy ground)
  grass:    ['bandpass', 1900, 0.7, 0.16, 0.035, 0],
  gravel:   ['bandpass', 2600, 0.9, 0.2, 0.05, 5],
  sand:     ['lowpass', 1300, 0.6, 0.22, 0.04, 0],
  regolith: ['lowpass', 520, 0.8, 0.2, 0.06, 2], // no air on the moon: what you'd hear is through the suit
  snow:     ['bandpass', 1500, 1.2, 0.24, 0.045, 3],
  stone:    ['highpass', 900, 0.7, 0.07, 0.03, 0],
  wood:     ['lowpass', 700, 2.5, 0.09, 0.05, 0],
};
export function createSteps(audio) {
  let buf = null, foot = 0;
  function noise(ctx) {
    if (buf) return buf;
    const n = Math.floor(ctx.sampleRate * 0.4); buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0); let b = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b = 0.7 * b + 0.3 * w; d[i] = b * 1.6; }
    return buf;
  }
  function play(surface = 'grass', k = 1) {
    if (audio && audio.footstep) { audio.footstep(surface, k); return; }
    const a = audio && audio.raw && audio.raw(); if (!a || !a.ctx || a.ctx.state !== 'running') return;
    const { ctx, master } = a; const s = SURF[surface] || SURF.grass;
    const t = ctx.currentTime + 0.005; foot ^= 1;
    const vol = s[4] * Math.min(1.3, 0.55 + 0.45 * k) * (0.8 + Math.random() * 0.4) * (foot ? 1 : 0.85);
    const src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = s[0]; f.frequency.value = s[1] * (0.85 + Math.random() * 0.3); f.Q.value = s[2];
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    // heel then toe: two soft swells
    g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(vol * 0.25, t + s[3] * 0.4);
    g.gain.linearRampToValueAtTime(vol * 0.6, t + s[3] * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + s[3]);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = foot ? 0.12 : -0.12;
    src.connect(f).connect(g); (pan ? g.connect(pan) : g).connect(master);
    src.start(t, Math.random() * 0.15, s[3] + 0.05);
    for (let i = 0; i < s[5]; i++) {
      const tt = t + Math.random() * s[3] * 0.8, gs = ctx.createBufferSource(); gs.buffer = buf;
      const gf = ctx.createBiquadFilter(); gf.type = 'highpass'; gf.frequency.value = 3500 + Math.random() * 3000;
      const gg = ctx.createGain(); gg.gain.setValueAtTime(vol * 0.5, tt); gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.015);
      gs.connect(gf).connect(gg).connect(master); gs.start(tt, Math.random() * 0.3, 0.02);
    }
  }
  // water from a can's rose: a soft hiss with a little patter
  function pour(secs = 0.4) {
    const a = audio && audio.raw && audio.raw(); if (!a || !a.ctx || a.ctx.state !== 'running') return;
    const { ctx, master } = a; const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + 0.06); g.gain.setTargetAtTime(0, t + secs, 0.08);
    src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + secs + 0.6);
  }
  return { play, pour };
}

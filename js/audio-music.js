// Adaptive music director: layered stems that crossfade with the world, biome,
// time of day, weather and what she's doing. Game-only; mom's garden stays on the
// generative pads in audio.js. Stems are original, in the same D-pentatonic as the chimes.
const FADE = 4.5; // seconds to crossfade a layer
const PHONE_MAX = 2;

export function createMusic({ getBus, load, phone, game }) {
  const layers = new Map(); // name -> { src, gain, rec }
  let world = 'earth', biome = 'garden', zone = 'garden', night = 0, rain = 0;
  let activity = 'explore', activityT = 0, started = false, ctx = null;
  let discoverOnce = 0;

  function bus() { return getBus(); }

  function choose() {
    // target gains, 0..1, already including "how present should this stem be"
    const t = {};
    if (!game || !started) return t;
    const isEarth = world === 'earth';
    const isMoon = world === 'moon';
    const isSpace = world === 'space';
    const isPlanet = world === 'planet';
    const interior = zone === 'interior' || zone === 'cave';
    if (isEarth) {
      t['garden-pad'] = 0.55;
      if (night > 0.45) t['garden-night'] = 0.35 + 0.4 * night;
      else t['garden-melody'] = 0.42 * (1 - night) * (1 - rain * 0.55);
    } else if (isSpace) {
      t['space-pad'] = 0.62;
    } else if (isMoon) {
      if (interior) t['interior-pad'] = 0.58;
      else t['space-pad'] = 0.48;
    } else if (isPlanet) {
      if (biome === 'forest' || biome === 'shore') {
        t['forest-pad'] = 0.55;
        if (night < 0.4) t['garden-melody'] = 0.18 * (1 - night);
      } else if (biome === 'ice' || biome === 'crystal' || biome === 'salt') {
        t['space-pad'] = 0.5;
      } else {
        t['forest-pad'] = 0.4;
        t['garden-pad'] = 0.2;
      }
    }
    if (activity === 'build') t.build = 0.4;
    if (activity === 'launch') {
      // launch takes over: drop the garden beds, raise the drone
      for (const k of Object.keys(t)) t[k] *= 0.25;
      t.launch = 0.75;
    }
    if (activity === 'discover') t['garden-melody'] = Math.max(t['garden-melody'] || 0, 0.2);
    // phone: keep the two loudest stems
    if (phone) {
      const ranked = Object.entries(t).sort((a, b) => b[1] - a[1]);
      const keep = new Set(ranked.slice(0, PHONE_MAX).map((e) => e[0]));
      for (const k of Object.keys(t)) if (!keep.has(k)) delete t[k];
    }
    return t;
  }

  async function startLayer(name, rec) {
    if (!ctx || layers.has(name) || !rec || !rec.buf) return;
    const src = ctx.createBufferSource();
    src.buffer = rec.buf;
    src.loop = rec.loop !== false;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(bus());
    try { src.start(); } catch (e) { return; }
    layers.set(name, { src, gain: g, rec });
    src.onended = () => { const L = layers.get(name); if (L && L.src === src) layers.delete(name); };
  }

  async function ensure(name) {
    if (!ctx || layers.has(name)) return layers.get(name);
    try {
      const rec = await load.get(ctx, 'music', name);
      if (rec) await startLayer(name, rec);
    } catch (e) { /* missing stem is fine; generative bed covers it */ }
    return layers.get(name);
  }

  function setGains(targets, dt) {
    const k = 1 - Math.exp(-(dt || 0.05) / FADE);
    for (const [name, L] of layers) {
      const want = targets[name] || 0;
      const vol = (L.rec.vol || 1) * want;
      const now = L.gain.gain.value;
      L.gain.gain.setTargetAtTime(vol, ctx.currentTime, FADE * 0.25);
      // if already fading to 0 and silent, stop to free the voice
      if (want <= 0 && now < 0.002) {
        try { L.src.stop(); } catch (e) { /* */ }
        layers.delete(name);
      }
    }
    void k;
  }

  function playDiscover() {
    if (!ctx || discoverOnce > 0) return;
    discoverOnce = 8;
    load.get(ctx, 'music', 'discover').then((rec) => {
      if (!rec || !ctx) return;
      const src = ctx.createBufferSource(); src.buffer = rec.buf;
      const g = ctx.createGain(); g.gain.value = rec.vol || 0.5;
      src.connect(g).connect(bus());
      src.start();
    }).catch(() => {});
  }

  return {
    attach(c) { ctx = c; started = true; },
    setWorld(id) { world = id || 'earth'; },
    setActivity(name, seconds) {
      activity = name || 'explore';
      activityT = seconds == null ? (name === 'launch' ? 24 : name === 'discover' ? 8 : 6) : seconds;
      if (name === 'discover') playDiscover();
    },
    update(dt, state = {}) {
      if (state.world) world = state.world;
      if (state.biome) biome = state.biome;
      if (state.zone) zone = state.zone;
      if (state.night != null) night = state.night;
      if (state.rain != null) rain = state.rain;
      if (activityT > 0) {
        activityT -= dt;
        if (activityT <= 0) { activity = 'explore'; activityT = 0; }
      }
      if (discoverOnce > 0) discoverOnce -= dt;
      if (!game || !started || !ctx) return;
      const targets = choose();
      for (const name of Object.keys(targets)) if (targets[name] > 0.02 && !layers.has(name)) ensure(name);
      if (ctx) setGains(targets, dt);
    },
    preload(id) {
      if (!game || !ctx) return;
      const names = id === 'moon' || id === 'space' ? ['space-pad', 'interior-pad', 'launch']
        : id === 'planet' ? ['forest-pad', 'space-pad', 'garden-melody']
          : ['garden-pad', 'garden-melody', 'garden-night'];
      names.forEach((n) => load.get(ctx, 'music', n).catch(() => {}));
    },
  };
}

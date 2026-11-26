// Sea surface waves from the world's own physics (pure maths, no three.js, so node tests can run it).
//
// Deep-water waves obey the dispersion relation w^2 = g k: on a light world the same wind raises
// taller, slower swells; on a heavy one they are short and quick. The sea state comes from the wind
// (Pierson-Moskowitz, fully developed sea): significant height Hs = 0.21 U^2 / g and peak frequency
// w_p = 0.877 g / U, scaled by how dense the air is (thin air pushes the water less). Four wave trains
// around the wind direction make the surface. Their phases are computed here from the wall clock,
// so every player on the world sees the same waves, and the shader gets exact phases (no float drift).
//
// The JS height() and the water shader use the same sum, so a swimmer bobs on the wave she sees.
// orbital() is the water's own motion under a wave (it falls off as e^{k z} with depth): kelp sways,
// drifting things and swimmers are carried by it.
const TAU = Math.PI * 2;
// four trains: [fraction of the peak frequency, direction offset from the wind (rad), share of Hs]
const TRAINS = [[1.0, 0.0, 0.55], [1.35, 0.55, 0.3], [0.78, -0.4, 0.35], [1.9, 1.2, 0.18]];

export function createWaves({ gravity = 9.81, airK = 1, seed = 1 } = {}) {
  const g = Math.max(0.5, gravity);
  const W = { a: [0, 0, 0, 0], k: [0, 0, 0, 0], w: [0, 0, 0, 0], dx: [1, 0, 0, 0], dz: [0, 1, 0, 0], ph: [0, 0, 0, 0], p0: [0, 0, 0, 0], wind: 0, dir: 0, hs: 0 };
  for (let i = 0; i < 4; i++) W.p0[i] = ((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1) * TAU;
  let U = -1, dirS = 0;
  // wind (m/s, direction rad). The sea answers slowly (a sea state takes minutes to build here, hours on Earth)
  function setWind(u, dir, dt = 1e9) {
    const k = 1 - Math.exp(-Math.max(0, dt) / 40);
    U = U < 0 ? u : U + (u - U) * k;
    dirS = U < 0 ? dir : dirS + (((dir - dirS + Math.PI) % TAU + TAU) % TAU - Math.PI) * k;
    const Ue = Math.max(0.8, U) * Math.sqrt(Math.max(0, Math.min(2, airK)));
    // a calm sea still carries a long low swell from storms far away
    const hs = Math.min(1.6, 0.21 * Ue * Ue / g + 0.12), wp = Math.min(3.2, 0.877 * g / Math.max(2, Ue));
    W.wind = U; W.dir = dirS; W.hs = hs;
    for (let i = 0; i < 4; i++) {
      const [fw, da, sh] = TRAINS[i], w = wp * fw;
      W.w[i] = w; W.k[i] = (w * w) / g; W.a[i] = (hs / 2) * sh;
      // steepness cap (a k < 0.12): steeper waves would break
      W.a[i] = Math.min(W.a[i], 0.12 / W.k[i]);
      W.dx[i] = Math.sin(dirS + da); W.dz[i] = Math.cos(dirS + da);
    }
  }
  // phases from the wall clock (seconds): shared by everyone on the world
  function tick(tSec) { for (let i = 0; i < 4; i++) W.ph[i] = (W.w[i] * (tSec % 86400) + W.p0[i]) % TAU; }
  function height(x, z) { let h = 0; for (let i = 0; i < 4; i++) h += W.a[i] * Math.sin(W.k[i] * (W.dx[i] * x + W.dz[i] * z) - W.ph[i]); return h; }
  // surface slope (dh/dx, dh/dz)
  function slope(x, z, out = [0, 0]) { let sx = 0, sz = 0; for (let i = 0; i < 4; i++) { const c = W.a[i] * W.k[i] * Math.cos(W.k[i] * (W.dx[i] * x + W.dz[i] * z) - W.ph[i]); sx += c * W.dx[i]; sz += c * W.dz[i]; } out[0] = sx; out[1] = sz; return out; }
  // water particle velocity under the waves at depth d below the still level (Airy linear theory)
  function orbital(x, z, d, out = [0, 0, 0]) {
    let u = 0, v = 0, wv = 0;
    for (let i = 0; i < 4; i++) {
      const th = W.k[i] * (W.dx[i] * x + W.dz[i] * z) - W.ph[i], e = W.a[i] * W.w[i] * Math.exp(-W.k[i] * Math.max(0, d));
      const c = Math.sin(th) * e; u += c * W.dx[i]; v += c * W.dz[i]; wv -= Math.cos(th) * e;
    }
    out[0] = u; out[1] = wv; out[2] = v; return out;
  }
  return { state: W, setWind, tick, height, slope, orbital, get hs() { return W.hs; }, get period() { return W.w[0] > 0 ? TAU / W.w[0] : 0; } };
}

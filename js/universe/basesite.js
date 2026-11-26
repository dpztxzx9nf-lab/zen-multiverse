// The home sites are places on the whole Earth and the whole Moon, not islands: the garden and the moon
// base sit on the sphere worlds (planet.js) at each one's arrival spot, with the ground there matched to
// the hand-built world (flat lawn and salt flat around the garden; the base survey ground and its craters
// on the Moon). Walking past the edge of the hand-built world carries on, without a fade, onto the sphere
// world at the same spot and heading; walking back in returns. The moon ground is shared code so both
// worlds have the same craters to the centimetre.
export const GARDEN = { cx: 1.5, cz: -0.5, out: 60, back: 52, flat: 85, blend: 340 };
export const MOONBASE = { out: 380, back: 340, flat: 400, blend: 680, LZ: { x: -9, z: 7 },
  DEF: { habitat: { x: 6, z: -5, ry: 0.35 }, greenhouse: { x: 13.5, z: 6.5, ry: -0.5 }, antenna: { x: -2, z: -15, ry: 0 }, solar: { x: 1.5, z: 12, ry: 0.25 } } };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hashN = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hashN(ix, iz), b = hashN(ix + 1, iz), c = hashN(ix, iz + 1), d = hashN(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz; };
export const fbm = (x, z, o = 4) => { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return s; };
// the moon base ground (relative to the base centre); R: the moon world's rng(4242), consumed in order
export function moonGround(R) {
  const craters = [
    { x: -92, z: 96, r: 52, d: 0.2 },   // the big old crater: its floor stays in shadow (ice)
    { x: 58, z: -38, r: 17, d: 0.22, young: true }, // a young crater with bright rays (moon glass)
  ];
  for (let i = 0; i < 110; i++) {
    const r = 2.5 + Math.pow(R(), 2.4) * 46, a = R() * Math.PI * 2, dist = 40 + Math.pow(R(), 0.8) * 900;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    if (Math.hypot(x, z) < 36 + r) continue;
    if (craters.some((c) => Math.hypot(c.x - x, c.z - z) < (c.r + r) * 0.7)) continue;
    craters.push({ x, z, r, d: 0.15 + R() * 0.07 });
  }
  for (let i = 0; i < 46; i++) { const a = R() * Math.PI * 2, dist = 24 + R() * 110; craters.push({ x: Math.cos(a) * dist, z: Math.sin(a) * dist, r: 0.8 + R() * 3, d: 0.18 }); }
  function hRaw(x, z) {
    let h = (fbm(x / 110 + 7, z / 110) - 0.5) * 9 + (fbm(x / 26, z / 26 + 3) - 0.5) * 1.6;
    for (const c of craters) {
      const dx = x - c.x, dz = z - c.z, q = dx * dx + dz * dz, rr = c.r * 2.2;
      if (q > rr * rr) continue;
      const d = Math.sqrt(q) / c.r;
      if (d < 1) h += c.r * c.d * (d * d - 1) * (1 - 0.25 * (1 - d * d));
      h += c.r * 0.065 * Math.exp(-(((d - 1) / 0.3) ** 2));
    }
    return h;
  }
  // flat (no baked curvature: both worlds bend the view with the same shader at the Moon's radius)
  function height(x, z) {
    const dist = Math.hypot(x, z), k = smooth(20, 48, dist);
    const site = (fbm(x / 9, z / 9) - 0.5) * 0.25;
    return site + hRaw(x, z) * k;
  }
  return { craters, hRaw, height };
}

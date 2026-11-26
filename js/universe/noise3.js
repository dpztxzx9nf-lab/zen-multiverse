// Seeded 3D gradient noise (Perlin-style, quintic fade). Used for sphere planets: the ground is sampled
// at a point on the planet's surface, so there are no seams, edges or wrap lines anywhere on the globe.
import { rng } from '../game/names.js';

const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
export function perlin3(seed) {
  const r = rng(seed >>> 0), p = new Uint8Array(512), base = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const gx = new Float32Array(12), gy = new Float32Array(12), gz = new Float32Array(12);
  G3.forEach((g, i) => { gx[i] = g[0]; gy[i] = g[1]; gz[i] = g[2]; });
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz, X = ix & 255, Y = iy & 255, Z = iz & 255;
    const u = f(fx), v = f(fy), w = f(fz);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const d = (h, x0, y0, z0) => { const k = h % 12; return gx[k] * x0 + gy[k] * y0 + gz[k] * z0; };
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(d(p[AA], fx, fy, fz), d(p[BA], fx - 1, fy, fz), u), l(d(p[AB], fx, fy - 1, fz), d(p[BB], fx - 1, fy - 1, fz), u), v),
      l(l(d(p[AA + 1], fx, fy, fz - 1), d(p[BA + 1], fx - 1, fy, fz - 1), u), l(d(p[AB + 1], fx, fy - 1, fz - 1), d(p[BB + 1], fx - 1, fy - 1, fz - 1), u), v),
      w) * 1.05; // ~[-1, 1]
  };
}
export function fbm3(n, x, y, z, oct, lac = 2.02) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); f *= lac; a *= 0.5; } return s; }

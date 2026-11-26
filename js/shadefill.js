// Shade fill from the real sky and the real ground (art bible 1.3: "shadows take the sky's hue"; and what the
// ground throws back). The garden's photo HDRIs are "pure sky": their lower half is more sky, so surfaces facing
// sideways and down were filled by blue from below and driftwood, kerbs and walls went slate-blue in shade.
// Here the lower hemisphere of the environment becomes what a Lambert ground really sends up: its albedo times
// the light falling on it (the sky's irradiance plus the sun on the sunlit share of the ground).
//   L_ground = albedo * (Lsky + sunlit * I_sun * sin(elev) / (pi * envIntensity))   (env units)
// Lsky is the cosine-weighted mean radiance of the upper hemisphere (E/pi). The hemisphere light's ground colour
// follows the same rule, so the fallback (no photo) agrees with it.
export const GROUND_ALBEDO = {
  // linear albedo of what lies around the home garden: lawn and moss (~0.2, green), raked granite sand (~0.42,
  // cream) and the salt flat beyond the walls (~0.62, cream-white), weighted roughly by how much of each you see
  garden: [0.36, 0.355, 0.29],
};
export const SUNLIT = 0.75; // share of the ground in sun (walls, bamboo and stones shade the rest)

// cosine-weighted mean radiance of the upper hemisphere of an equirect RGBA float image (row 0 = zenith)
export function skyMean(data, W, H) {
  let r = 0, g = 0, b = 0, ws = 0;
  for (let y = 0; y < H / 2; y++) {
    const th = ((y + 0.5) / H) * Math.PI, w = Math.sin(th) * Math.cos(th); if (w <= 0) continue;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; ws += w; }
  }
  return [r / ws, g / ws, b / ws];
}
// the radiance the ground sends up, in environment units; sun: linear colour [r,g,b], I: its intensity
export function groundBounce({ sky, sun = [1, 1, 1], I = 0, elev = 0, envI = 1, albedo = GROUND_ALBEDO.garden, sunlit = SUNLIT }) {
  const s = Math.max(0, Math.sin((elev * Math.PI) / 180)) * I * sunlit / (Math.PI * Math.max(0.05, envI));
  return [0, 1, 2].map((k) => albedo[k] * (sky[k] + s * sun[k]));
}
// rewrite the rows below the horizon with the ground's bounce, blending over `blend` degrees under the horizon
// (the far ground meets the sky in haze); writes into `out` (may be the same array as `src`)
export function relightGround(src, out, W, H, bounce, blend = 5) {
  const y0 = Math.floor(H / 2), span = Math.max(1, Math.round((blend / 180) * H));
  for (let y = y0; y < H; y++) {
    const k = Math.min(1, (y - y0 + 1) / span), e = k * k * (3 - 2 * k);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out[i] = src[i] + (bounce[0] - src[i]) * e; out[i + 1] = src[i + 1] + (bounce[1] - src[i + 1]) * e; out[i + 2] = src[i + 2] + (bounce[2] - src[i + 2]) * e;
      if (out !== src) out[i + 3] = src[i + 3];
    }
  }
  if (out !== src) out.set(src.subarray(0, y0 * W * 4), 0);
  return out;
}
// the hemisphere light's ground colour by the same rule. three.js treats colour * intensity of a hemisphere or
// directional light as irradiance, so the ground's return (as irradiance on a face looking down) is
// albedo * (hemi sky irradiance + sun irradiance on the sunlit share), divided back by the light's intensity
export function hemiGround({ skyColor, hemiI, sun = [1, 1, 1], I = 0, elev = 0, albedo = GROUND_ALBEDO.garden, sunlit = SUNLIT }) {
  const hi = Math.max(0.05, hemiI), s = Math.max(0, Math.sin((elev * Math.PI) / 180)) * I * sunlit;
  return [0, 1, 2].map((k) => albedo[k] * (skyColor[k] * hi + s * sun[k]) / hi);
}
// keep a hand-tuned colour's brightness, take the hue from the physical one (luminance-matched)
export function withHueOf(base, phys) {
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], lb = lum(base), lp = Math.max(1e-6, lum(phys));
  return phys.map((v) => (v * lb) / lp);
}
// the fill's two colours as irradiance (three.js light units): the sky's diffuse share of daylight (a clear-sky
// diffuse fraction that grows toward the horizon and under cloud), and what the ground returns of sun + sky.
// skyHue: the sky's colour (any scale); sun: linear sun colour; I: sun intensity; floor: twilight / night sky level
export function diffuseFraction(elev, overcast = 0) {
  const clear = 0.12 + 0.55 * Math.exp(-Math.max(0, elev) / 7);
  return Math.min(0.97, clear + (1 - clear) * Math.min(1, overcast) * 0.85);
}
export function fillColours({ skyHue, sun = [1, 1, 1], I = 0, elev = 0, overcast = 0, floor = 0.05, albedo = GROUND_ALBEDO.garden, sunlit = SUNLIT }) {
  const Esun = Math.max(0, Math.sin((elev * Math.PI) / 180)) * I, kd = diffuseFraction(elev, overcast);
  const Esky = Math.max(floor, (kd / (1 - kd)) * Esun);
  const hl = Math.max(1e-6, 0.2126 * skyHue[0] + 0.7152 * skyHue[1] + 0.0722 * skyHue[2]);
  const sky = skyHue.map((v) => (v / hl) * Esky);
  const ground = [0, 1, 2].map((k) => albedo[k] * (sunlit * Esun * sun[k] + sky[k]));
  return { sky, ground, kd };
}

// The medium sound travels through. Pure functions (no WebAudio) so the physics can be tested in node.
//
//   air(pKPa)            how well this air carries sound, relative to Earth at sea level (0 in vacuum).
//                        Amplitude follows pressure (the acoustic impedance rho*c falls with it), so a 1 kPa
//                        world is ~40 dB quieter and a vacuum is silent. Sounds through the ship or the suit
//                        (contact, not air) do not use this.
//   busCutoff(air)       thin air also loses its highs first: the whole outdoor bus gets a low-pass that
//                        closes as the air thins (Mars-like air sounds dull and far away).
//   absorbCutoff(d, air) air absorption over distance: high frequencies die first (ISO 9613-1 in spirit:
//                        ~0.1 dB/m at 8 kHz in normal air, more per metre in thinner air).
//   soundSpeed(tC)       331.3 + 0.606 T m/s; delay(d, tC) for far events (thunder, explosions).
//   doppler(vRel, c)     playback rate for a source closing at vRel m/s (positive = approaching).
//   chirpRate(tC)        Dolbear's law: chirps per minute = 4 (T_F - 40) (snowy tree cricket); silent below ~12 C.
//   terrainOcclusion     fraction of the straight line from source to ear that runs under the ground.
export const EARTH_KPA = 101.325;
export function air(pKPa) { return pKPa > 0 ? Math.min(1.3, pKPa / EARTH_KPA) : 0; }
export function busCutoff(a) { return a <= 0 ? 200 : Math.min(18000, 400 + 17600 * Math.pow(Math.min(1, a), 0.6)); }
export function absorbCutoff(d, a) { const k = 1 / Math.max(0.05, Math.min(1, a)); return Math.max(500, 18000 / (1 + (d * k) / 70)); }
export function soundSpeed(tC = 15) { return 331.3 + 0.606 * tC; }
export function delay(d, tC = 15) { return d / soundSpeed(tC); }
export function doppler(vRel, c = 343) { return Math.max(0.5, Math.min(2, c / Math.max(c * 0.25, c - vRel))); }
export function chirpRate(tC) { const n = 4 * (tC * 1.8 + 32 - 40); return tC < 12 ? 0 : Math.max(0, Math.min(220, n)); }
// rain, snow and blowing dust need air: they fall from clouds in the lower atmosphere, so where the ear (or the
// camera) is matters. airRel is the local pressure over the surface pressure (0 in vacuum, 1 on the ground);
// the 4th power keeps weather in the bottom few km (Earth: half the air is below 5.5 km, rain mostly below 3).
export function precipK(airRel) { const a = Math.max(0, Math.min(1, airRel || 0)); return a * a * a * a; }
export function terrainOcclusion(height, a, b, steps = 10) {
  if (!height) return 0;
  let under = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
    if (height(x, z) > y) under++;
  }
  return under / (steps - 1);
}

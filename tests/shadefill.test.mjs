// node tests/shadefill.test.mjs : shade fill from the real sky and ground (js/shadefill.js)
import { skyMean, groundBounce, relightGround, hemiGround, fillColours, diffuseFraction, GROUND_ALBEDO } from '../js/shadefill.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// a uniform blue sky over a blue "pure sky" lower half
const W = 64, H = 32, d = new Float32Array(W * H * 4);
for (let i = 0; i < W * H; i++) { d[i * 4] = 0.4; d[i * 4 + 1] = 0.6; d[i * 4 + 2] = 1.2; d[i * 4 + 3] = 1; }
const sky = skyMean(d, W, H);
ok(Math.abs(sky[0] - 0.4) < 1e-6 && Math.abs(sky[2] - 1.2) < 1e-6, 'uniform sky: the mean is its radiance');
const night = groundBounce({ sky, I: 0, elev: -10, envI: 0.75 });
ok(night.every((v, k) => Math.abs(v - GROUND_ALBEDO.garden[k] * sky[k]) < 1e-9), 'no sun: the ground only returns the sky light it gets');
const day = groundBounce({ sky, sun: [1, 0.95, 0.88], I: 3.4, elev: 30, envI: 0.75 });
ok(day[2] / day[0] < sky[2] / sky[0] * 0.6, `afternoon: the bounce is much warmer than the sky (b/r ${(day[2] / day[0]).toFixed(2)} vs ${(sky[2] / sky[0]).toFixed(2)})`);
ok(day[0] > night[0] * 1.5, 'and brighter: the sunlit ground lights the shade');
const o = new Float32Array(d.length); relightGround(d, o, W, H, day);
const at = (y) => [o[(y * W) * 4], o[(y * W) * 4 + 2]];
ok(at(0)[0] === d[0] && at(H / 2 - 1)[1] === d[2], 'the sky half is untouched');
ok(Math.abs(at(H - 1)[0] - day[0]) < 1e-6 && Math.abs(at(H - 1)[1] - day[2]) < 1e-6, 'straight down: the ground bounce');
const hg = hemiGround({ skyColor: [0.45, 0.58, 0.85], hemiI: 0.8, sun: [1, 0.95, 0.88], I: 3.4, elev: 30 });
ok(hg[2] < hg[0], `hemisphere ground colour is warm (${hg.map((v) => v.toFixed(2)).join(', ')})`);
{ // the fill colours: on a sunny afternoon a wall's shade side is lit mostly by the warm ground, at dusk by the sky
  const sun = [1, 0.93, 0.82], skyHue = [0.45, 0.62, 0.95];
  const pm = fillColours({ skyHue, sun, I: 3.2, elev: 25 }), side = pm.sky.map((v, k) => 0.5 * v + 0.5 * pm.ground[k]);
  ok(side[2] / side[0] < 1.25, `afternoon: a vertical face's fill is near neutral, not slate-blue (b/r ${(side[2] / side[0]).toFixed(2)})`);
  ok(pm.ground[0] > pm.sky[0], 'the ground returns more than the sky gives (sunny day)');
  const dusk = fillColours({ skyHue, sun: [1, 0.6, 0.35], I: 1.0, elev: 2 }), ds = dusk.sky.map((v, k) => 0.5 * v + 0.5 * dusk.ground[k]);
  ok(ds[2] / ds[0] > side[2] / side[0], `dusk: the shade turns bluer (b/r ${(ds[2] / ds[0]).toFixed(2)})`);
  ok(diffuseFraction(30, 1) > 0.85 && diffuseFraction(30, 0) < 0.2, 'overcast light is nearly all sky; a clear afternoon mostly sun');
}
console.log(fails ? `${fails} FAILED` : 'all ok'); process.exit(fails ? 1 : 0);

// node tests/rocket-sim.test.mjs
import { designFrom, readout, createFlight, EARTH_RULES, MOON_RULES } from '../js/game/rocket-sim.js';
const classic = { parts: ['body', 'engine', 'fins', 'capsule', 'nose'] };
const full = (R) => { const d = designFrom(R); d.stages.forEach((s) => { s.fuel = s.loads; }); return d; };
const show = (name, d, rules = EARTH_RULES, seed = 1) => {
  const r = readout(d, rules); const f = createFlight(d, rules, { seed }).run();
  console.log(name.padEnd(28), 'm', (r.mass / 1000).toFixed(1) + 't', 'TWR', r.twr.toFixed(2), 'dv', Math.round(r.dv), '/', Math.round(r.need), 'margin', r.margin.toFixed(2), '->', f.outcome, 'alt', Math.round(f.alt / 1000) + 'km', 'v', Math.round(f.speed), 'apo', Math.round(f.apo / 1000), 'peri', Math.round(f.peri / 1000), 'maxQ', Math.round(f.maxQ), 'wob', f.maxWobble.toFixed(3), 't', Math.round(f.t), f.events.map((e) => e.kind).join(','));
  return f;
};
const A = [];
const ok = (c, m) => { A.push([c, m]); if (!c) console.log('FAIL', m); };
let f;
f = show('classic, empty', designFrom(classic)); ok(f.outcome === 'pad', 'empty tanks stay on the pad');
f = show('classic, full', full(classic)); ok(f.outcome !== 'orbit', 'classic alone cannot reach Earth orbit');
f = show('classic, no fins', full({ parts: ['body', 'engine', 'capsule', 'nose'] })); ok(f.outcome === 'tumble' || f.maxWobble > 0.05, 'no fins: wobbles or tips');
const big = { ...classic, engine: 'vac', stages: [{ tanks: 12, engines: 5, engine: 'pump', fins: 4 }, { tanks: 4, engines: 1, engine: 'pump', fins: 0 }] };
f = show('3 stage', full(big)); ok(f.outcome === 'orbit', '3-stage reaches orbit');
f = show('3 stage no booster fins', full({ ...big, stages: [{ ...big.stages[0], fins: 0 }, big.stages[1]] }));
f = show('heavy, 1 pump', full({ ...classic, stages: [{ tanks: 10, engines: 1, engine: 'pump', fins: 4 }] })); ok(f.outcome === 'pad', 'too heavy: TWR<1');
f = show('bad mounts', full({ ...big, stages: [{ ...big.stages[0], err: [0.05, 0.04, 0.05, 0.03, 0.05] }, big.stages[1]] })); ok(f.outcome === 'tumble' || f.maxWobble > 0.05, 'bad mounts wobble/tip');
f = show('upper engine way off line', full({ ...big, err: [0.12] })); ok(f.outcome !== 'orbit', 'a mount beyond the gimbal range cannot fly straight');
f = show('classic on the moon', full(classic), MOON_RULES); ok(f.outcome === 'orbit', 'classic reaches lunar orbit');
console.log(A.filter((a) => a[0]).length + '/' + A.length + ' ok');
process.exit(A.every((a) => a[0]) ? 0 : 1);

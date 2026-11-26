// WorldRules for the hand-built home worlds (the garden on Earth, the moon base), so every system can
// read core.worldRules / worldRules.rules the same way there as on generated planets.
import { starsIn, planetsOf, moonsOf, HOME, addrKey } from './universe.js';
import { makeWorldRules } from './rules.js';
import { setCurrentRules } from './current.js';
export function homeBody(which) {
  const sun = starsIn(HOME.g, 0, 0)[0], earth = planetsOf(sun)[2];
  if (which === 'earth') return { star: sun, body: earth, addr: addrKey({ ...HOME, planet: 2 }) };
  if (which === 'moon') return { star: sun, body: moonsOf(sun, earth)[0], addr: addrKey({ ...HOME, planet: 2, moon: 0 }) };
  return null;
}
export function setHomeRules(world) {
  const h = homeBody(world);
  if (!h) { setCurrentRules(null, { world }); return null; }
  const rules = makeWorldRules({ seed: h.body.seed, body: { ...h.body }, star: h.star, era: 'present' });
  setCurrentRules(rules, { world, pk: world, era: 'present' });
  return rules;
}

// The opening walk with Ula (server/src/opening.js decides; this is the shared wording).
// Five things the garden asks of newcomers, each proven by the real system that does it:
// gather (a driftwood log or reed bed answers, places.js), craft (a recipe made, at the bench if it needs one),
// fish (the cove's shared stock gives one up), build (two pieces standing by the cove, builds.js) and deliver
// (a fish handed to a camp that asked for it, factions.js, who pay from their own cache).
// Nothing here is granted: the reward is what the camp pays and what you now know how to do.
export const OPEN_STEPS = [
  { id: 'gather', short: 'Gather driftwood or reeds',
    ask: 'Ula: Two pairs of hands. Good. The garden feeds whoever works it. The cove throws up driftwood and the bank grows reeds: go and take some, together if you like.' },
  { id: 'craft', short: 'Make a spear or a rod',
    ask: 'Ula: Wood and fibre. Now make something with them: a spear or a rod, in your hands or at the workshop bench by the shed.' },
  { id: 'fish', short: 'Catch a fish at the cove',
    ask: 'Ula: Take it to the cove. The fish come in schools; wait for one, get close, lead it. The cove only has so many.' },
  { id: 'build', short: 'Raise two pieces by the cove', need: 2,
    ask: 'Ula: A fish in the sun is a bad fish by noon. Put something up by the water, two pieces at least, standing on the ground or on each other.' },
  { id: 'deliver', short: 'Carry a fish to a camp',
    ask: 'Ula: Now carry a fish to a camp. Ivo\u2019s people and Dagna\u2019s both ask for food. Hand it over yourself; they pay from what they have.' },
];
export const OPEN_DONE = 'Ula: Gather, make, catch, build, carry. That is the whole garden; the rest is doing it again. Come back when you want something stranger.';
export const OPEN_TOGETHER_R = 15;   // metres: a partner this close on the same step shares the work
export const OPEN_BUILD_R = 16;      // metres from the cove's edge that count as "by the water"
export const OPEN_BENCH_R = 4;       // metres from a workbench (the shed's, or one built in the garden)
export function openText(step) { return step >= 1 && step <= OPEN_STEPS.length ? OPEN_STEPS[step - 1] : null; }
export const WORKSHOP = { x: 20.2, z: 2.6 }; // the shed's bench (js/game/earth-rocket.js SHED; kept in step by tests/opening.test.mjs)

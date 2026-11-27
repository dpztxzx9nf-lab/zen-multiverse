// Second draw of the first-person arms+gun, after the world has already been
// composited. The pass clears depth so the viewmodel never clips through world
// geometry, and uses its own camera / FOV.
let pass = null;
export function setViewmodelPass(fn) { pass = typeof fn === 'function' ? fn : null; }
export function renderViewmodel(renderer) { if (pass && renderer) pass(renderer); }

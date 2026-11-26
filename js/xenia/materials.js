// Real materials: the one table every object in Xenia points at (obj.userData.mat = 'wood' etc.).
// What a thing is made of decides what the world does to it, with no special cases per item:
// burning (ignites, burn rate), breaking (toughness: the hit energy in J it takes to break it),
// floating (density against water's 1000 kg/m3), conducting (heat and electricity) and crafting
// (what it yields when broken down). Phase 1 lays the table; fire, breaking, buoyancy and circuits
// read from it as they come online (see mom-garden-notes/xenia-progress.md, "material foundation").
export const WATER_RHO = 1000;
export const MATERIALS = {
  //          kg/m3  ignites at C   burn kg/s/m2   J to break      conducts (0..1) heat / power   breaks into
  wood:     { rho: 600, ignite: 300, burn: 0.012, tough: 900, heat: 0.05, power: 0, yields: { 'mat:wood': 1 } },
  plank:    { rho: 550, ignite: 300, burn: 0.014, tough: 600, heat: 0.05, power: 0, yields: { 'mat:wood': 1 } },
  fibre:    { rho: 300, ignite: 250, burn: 0.03, tough: 80, heat: 0.03, power: 0, yields: { fibre: 1 } },
  cloth:    { rho: 350, ignite: 260, burn: 0.025, tough: 150, heat: 0.03, power: 0, yields: { fibre: 1 } },
  leather:  { rho: 860, ignite: 400, burn: 0.008, tough: 400, heat: 0.04, power: 0, yields: { cloth: 1 } },
  plastic:  { rho: 950, ignite: 350, burn: 0.02, tough: 350, heat: 0.04, power: 0, yields: {} },
  rubber:   { rho: 1100, ignite: 350, burn: 0.015, tough: 500, heat: 0.03, power: 0, yields: {} },
  stone:    { rho: 2600, ignite: null, burn: 0, tough: 6000, heat: 0.15, power: 0, yields: { 'mat:stone': 1 } },
  concrete: { rho: 2400, ignite: null, burn: 0, tough: 5000, heat: 0.12, power: 0, yields: { 'mat:stone': 1 } },
  glass:    { rho: 2500, ignite: null, burn: 0, tough: 120, heat: 0.1, power: 0, yields: { sand: 1 } },
  crystal:  { rho: 2650, ignite: null, burn: 0, tough: 800, heat: 0.12, power: 0, yields: { crystal: 1 } },
  ore:      { rho: 3500, ignite: null, burn: 0, tough: 5000, heat: 0.2, power: 0.05, yields: { 'mat:ore': 1 } },
  steel:    { rho: 7850, ignite: null, burn: 0, tough: 40000, heat: 0.5, power: 0.8, yields: { 'mat:metal': 1 } },
  aluminium:{ rho: 2700, ignite: null, burn: 0, tough: 15000, heat: 0.9, power: 0.9, yields: { 'mat:metal': 1 } },
  copper:   { rho: 8960, ignite: null, burn: 0, tough: 20000, heat: 1, power: 1, yields: { 'mat:metal': 1 } },
  soil:     { rho: 1500, ignite: null, burn: 0, tough: 200, heat: 0.08, power: 0.02, yields: { 'mat:soil': 1 } },
  sand:     { rho: 1600, ignite: null, burn: 0, tough: 100, heat: 0.08, power: 0, yields: { sand: 1 } },
  ice:      { rho: 917, ignite: null, burn: 0, tough: 700, heat: 0.6, power: 0, melts: 0, yields: {} },
  water:    { rho: 1000, ignite: null, burn: 0, tough: 0, heat: 0.15, power: 0.3, fluid: true, yields: {} },
  flesh:    { rho: 1050, ignite: 400, burn: 0.004, tough: 250, heat: 0.12, power: 0.3, yields: { hide: 1 } },
  plant:    { rho: 700, ignite: 280, burn: 0.02, tough: 120, heat: 0.05, power: 0.1, yields: { fibre: 1 } },
};
export const matOf = (k) => MATERIALS[k] || null;
// a solid of this material (and this much air inside it, 0..1 of its volume) floats if it is lighter than water
export const floats = (k, hollow = 0) => { const m = matOf(k); return !!m && !m.fluid && m.rho * (1 - hollow) < WATER_RHO; };
export const burns = (k) => { const m = matOf(k); return !!m && m.ignite != null; };
export const conducts = (k, min = 0.5) => { const m = matOf(k); return !!m && m.power >= min; };
// breaks when a hit carries more energy than the material takes (½ m v², summed over hits until it gives way)
export const breaks = (k, joules) => { const m = matOf(k); return !!m && !m.fluid && joules >= m.tough; };

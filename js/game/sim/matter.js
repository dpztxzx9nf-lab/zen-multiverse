// What everything is made of, with real properties (SI units; a few game-tuned, marked ~).
// One table for the ground (by the voxel material codes in g7/materials.js), solids (props and
// build pieces) and fuels. Pure data: the sim, the server and the renderer all read it.
//   ρ kg/m3, k W/mK, c J/kgK, temperatures °C, sigma S/m, porosity 0..1 (water it can hold)
export const G = 9.81;
export const L_VAP = 2.26e6, L_FUS = 3.34e5, C_WATER = 4186;
// ground materials (codes match g7 MAT: 1 soil 2 sand 3 stone 4 ice 5 ore 6 crystal 7 packed 8 snow) + 9 clay (baked mud)
export const GROUND = {
  1: { id: 'soil', rho: 1500, k: 1.0, c: 1200, por: 0.45, ksat: 1.0, sigma: 0.01, friction: 0.9, soft: 0.35, bear: 150, grows: 1, erode: 1, step: 'grass', melt: 1200 },
  2: { id: 'sand', rho: 1600, k: 0.3, c: 830, por: 0.38, ksat: 4.0, sigma: 0.001, friction: 0.8, soft: 0.85, bear: 100, grows: 0.35, erode: 1.6, step: 'sand', melt: 1700 },
  3: { id: 'stone', rho: 2600, k: 2.5, c: 790, por: 0.02, ksat: 0, sigma: 1e-6, friction: 0.85, soft: 0, bear: 5000, grows: 0, erode: 0, step: 'stone', melt: 1200 },
  4: { id: 'ice', rho: 917, k: 2.2, c: 2100, por: 0, ksat: 0, sigma: 0, friction: 0.06, soft: 0.05, bear: 800, grows: 0, erode: 0.2, step: 'snow', melt: 0 },
  5: { id: 'ore', rho: 4000, k: 4, c: 600, por: 0.02, ksat: 0, sigma: 1e3, friction: 0.85, soft: 0, bear: 5000, grows: 0, erode: 0, step: 'stone', melt: 1085 },
  6: { id: 'crystal', rho: 2650, k: 6, c: 740, por: 0, ksat: 0, sigma: 0, friction: 0.5, soft: 0, bear: 5000, grows: 0, erode: 0, step: 'stone', melt: 1670 },
  7: { id: 'packed', rho: 1800, k: 1.2, c: 1100, por: 0.3, ksat: 0.25, sigma: 0.01, friction: 0.9, soft: 0.12, bear: 300, grows: 0.5, erode: 0.6, step: 'gravel', melt: 1200 },
  8: { id: 'snow', rho: 300, k: 0.2, c: 2100, por: 0.7, ksat: 2.0, sigma: 0, friction: 0.5, soft: 1, bear: 10, grows: 0, erode: 1.2, step: 'snow', melt: 0 },
  9: { id: 'clay', rho: 1900, k: 1.3, c: 900, por: 0.1, ksat: 0.05, sigma: 0.001, friction: 0.95, soft: 0.02, bear: 1500, grows: 0.2, erode: 0.2, step: 'stone', melt: 1300 },
};
export const MUD = { friction: 0.42, speed: 0.72, sink: 0.07, bear: 25, step: 'mud' };
// solids (props, build pieces): thermal + electrical + burning
export const SOLIDS = {
  wood: { rho: 600, k: 0.15, c: 1700, ignite: 300, heat: 16e6, sigma: 0, charTo: 'charcoal', tough: 1 },
  stone: { rho: 2500, k: 2.5, c: 790, sigma: 1e-6, melt: 1200, tough: 2.2 },
  metal: { rho: 8000, k: 300, c: 450, sigma: 6e7, melt: 1085, tough: 6 },
  ore: { rho: 4000, k: 4, c: 600, sigma: 1e3, smelt: 1085, tough: 3 },
  ice: { rho: 917, k: 2.2, c: 2100, sigma: 0, melt: 0, tough: 0.8 },
  crystal: { rho: 2650, k: 6, c: 740, sigma: 0, melt: 1670, tough: 1.6, solar: 0.18 },
  shell: { rho: 1200, k: 0.5, c: 900, sigma: 0, tough: 0.6 },
};
// fuels on the ground (kg/m2 per cell). heat MJ/kg, ignition °C, flame temperature °C
export const FUEL = {
  grass: { heat: 15e6, ignite: 260, flame: 850 },
  wood: { heat: 16e6, ignite: 300, flame: 950 },
  charcoal: { heat: 30e6, ignite: 350, flame: 1150 }, // + forced air (wind/bellows) reaches ~1300
};
// air by biome (°C at the surface, midday), and how much grows there (vegetation cap, soil moisture)
export const CLIMATE = {
  forest: { air: 17, veg: 1, moist: 0.42, fuel: 0.35 },
  shore: { air: 21, veg: 0.35, moist: 0.3, fuel: 0.1 },
  salt: { air: 31, veg: 0.06, moist: 0.05, fuel: 0.02 },
  crystal: { air: 9, veg: 0.55, moist: 0.3, fuel: 0.15 },
  ice: { air: -9, veg: 0.02, moist: 0.5, fuel: 0, snow: 0.25 },
};

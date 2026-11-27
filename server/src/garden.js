// The home garden's no-go ground, server side (tile null = the garden frame): where the vault, the geode,
// contest stones, set-down things and build pieces may land. One shared rule with the animals
// (js/garden-rules.js), built on the garden's own solids and shapes, not a copy of the layout.
import { gardenNoGo } from '../../js/garden-rules.js';
export { pondRadius } from '../../js/garden-shapes.js';
export { SAND } from '../../js/garden-shapes.js';

// why a garden spot is not open ground (null = fine). m = clearance in metres (an object's radius).
export function gardenBlock(x, z, m = 0) { return gardenNoGo(x, z, m); }
// p = {x, z, tile}: open ground anywhere off the garden frame; inside it, clear of the no-go zones
export const openGround = (p, m = 0) => !!p && ((p.tile || null) !== null || !gardenBlock(p.x, p.z, m));

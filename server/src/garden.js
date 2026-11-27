// The home garden's no-go ground. The garden is a place on the home Earth globe
// (tile 1:1:1, next to the city). Leftover garden-frame poses (tile null) still
// convert with gardenLocal / liftGardenPose.
import { gardenNoGo } from '../../js/garden-rules.js';
import { SHARED_HOME } from '../../js/spawn.js';
import { gardenLocal, inGardenArea, isLegacyGardenTile, liftGardenPose } from '../../js/hub.js';
export { pondRadius } from '../../js/garden-shapes.js';
export { SAND } from '../../js/garden-shapes.js';
export { gardenLocal, inGardenArea, isLegacyGardenTile, liftGardenPose };

// why a garden spot is not open ground (null = fine). m = clearance in metres (an object's radius).
// x, z are garden-local metres.
export function gardenBlock(x, z, m = 0) { return gardenNoGo(x, z, m); }
// p = {x, z, tile}: open ground anywhere off the garden; inside it, clear of the no-go zones
export const openGround = (p, m = 0) => {
  if (!p) return false;
  const g = gardenLocal(p);
  if (g) return !gardenBlock(g.x, g.z, m);
  return true;
};
export function inSharedGarden(a, r) {
  return !!(a && (a.world || '').split('#')[0] === SHARED_HOME && inGardenArea(a, r));
}

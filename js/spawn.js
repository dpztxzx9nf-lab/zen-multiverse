// The one shared world's spawn (pure data, used by the game and by the server).
// New players, the home-beacon default and invite joins (when the inviter is offline)
// land at the Xenia city hub on the home Earth globe. The garden is a place on that
// same globe, just inland of the city (GARDEN_ARRIVAL_PLANET); leftover garden-frame
// saves are lifted there so walking to the streets is continuous.
import { HUB_SPAWN, GARDEN_ARRIVAL } from './hub.js';
export { GARDEN_ARRIVAL };
// New arrivals used to land at the greybox plaza. The planet redirects that
// plaza to a frontier biome via pickFrontierSpawn; this constant stays as the
// known city coordinate so enterHub still has a default, and existing saves
// at other coordinates are left alone.
export const WORLD_SPAWN = HUB_SPAWN;
// the shared world for now (regional and skill-based servers come later): owner id 0
export const WORLD_OWNER = '0'.repeat(32);
export const SHARED_HOME = `home:${WORLD_OWNER}`;
export const SHARED_MOON = `moon:${WORLD_OWNER}`;

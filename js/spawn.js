// The one shared world's spawn (pure data, used by the game and by the server).
// New players, the home-beacon default and invite joins (when the inviter is offline)
// land at the Xenia city hub on the home Earth globe. The garden's arrival stone is
// still there (GARDEN_ARRIVAL) if you walk in from the streets.
import { HUB_SPAWN, GARDEN_ARRIVAL } from './hub.js';
export { GARDEN_ARRIVAL };
export const WORLD_SPAWN = HUB_SPAWN;
// the shared world for now (regional and skill-based servers come later): owner id 0
export const WORLD_OWNER = '0'.repeat(32);
export const SHARED_HOME = `home:${WORLD_OWNER}`;
export const SHARED_MOON = `moon:${WORLD_OWNER}`;

// The one shared world's spawn (pure data, used by the game and by the server).
// Everyone lands here the first time, the home beacon returns you here, and an invite join lands
// here when the inviter is offline. Solid open ground on the garden's front lawn, east of the beds: off the path,
// clear of the raked sand, the pond, the beds and the bonsai (server/src/garden.js checks it).
export const WORLD_SPAWN = { x: 3.5, z: 9.8, yaw: Math.PI * 0.92 };
// the shared world for now (regional and skill-based servers come later): owner id 0
export const WORLD_OWNER = '0'.repeat(32);
export const SHARED_HOME = `home:${WORLD_OWNER}`;
export const SHARED_MOON = `moon:${WORLD_OWNER}`;

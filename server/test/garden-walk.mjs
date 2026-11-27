// Shared walk for live tests: new players start at the city hub. Walk them onto the garden
// on the same globe tile, at a legal pace.
import { EARTH_SITE, HUB_SPAWN, liftGardenPose } from '../../js/hub.js';
export const at = (x, z, y = 0) => liftGardenPose({ x, y, z, tile: null });
export function fromHello(c, hi) {
  const r = (hi && hi.resume) || HUB_SPAWN;
  c.x = r.x; c.y = r.y ?? HUB_SPAWN.y; c.z = r.z; c.tile = r.tile || EARTH_SITE.tile;
  return c;
}
export async function walkPlanet(c, tx, tz, sleep, y) {
  const gy = y ?? c.y ?? HUB_SPAWN.y;
  while (Math.hypot(tx - c.x, tz - c.z) > 0.05) {
    const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(1.0, d);
    c.x += (tx - c.x) / d * s; c.z += (tz - c.z) / d * s;
    c.seq = (c.seq || 0) + 1;
    c.ws.send(JSON.stringify({ t: 'p', x: c.x, y: gy, z: c.z, yaw: Math.atan2(tx - c.x, tz - c.z), s: c.seq, tile: c.tile || EARTH_SITE.tile }));
    await sleep(160);
  }
  c.y = gy;
  await sleep(300);
}
export async function walkTo(c, lx, lz, sleep, y) {
  const p = at(lx, lz, y ?? 0);
  return walkPlanet(c, p.x, p.z, sleep, p.y);
}

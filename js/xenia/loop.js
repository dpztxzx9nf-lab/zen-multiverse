// Xenia's core loop, the rules both sides share (no three.js: the server, the client and tests import this).
// Greybox first (Brock's rule): plain shapes, prove the loop is fun and solid before any models.
//
//   explore the regions -> loot supply crates -> craft at stations -> fight (melee, then the first gun)
//   -> build a base -> defend it from raids
//
// The server (server/src/loop.js) is the only one that decides: what you carry for fighting (the kit), your
// health, every hit (reach, facing, rewound positions), every shot (ammo in the magazine, fire rate, reloads,
// recoil), and what a raid may break. The client draws plain shapes and sends intents.
import { MELEE, hitEnergy } from '../game/g7/melee.js';

export const HP = 100;
export const RESPAWN_MS = 5000;          // down this long, then back at the hub's arrival stone
export const REGEN_AFTER = 8000;         // ms out of the fight before health comes back
export const REGEN = 4;                  // health per second after that
export const CB_RATE = 14, CB_BURST = 16; // combat intents per second (a pistol at full rate is ~6/s)

// ---- the kit: the fighting things the server counts for you (weapons, ammo). Item ids as boxes store them.
export const WEAPONS = { w_knife: 'knife', w_bat: 'bat', w_crowbar: 'crowbar', w_machete: 'machete', w_pistol: 'pistol' };
export const AMMO = { ammo_9mm: '9mm rounds' };
export const KIT_ITEMS = [...Object.keys(WEAPONS), ...Object.keys(AMMO)];
export const isKit = (k) => KIT_ITEMS.includes(k);
export const KIT_NAMES = { w_knife: 'Knife', w_bat: 'Baseball bat', w_crowbar: 'Crowbar', w_machete: 'Machete', w_pistol: '9mm pistol', ammo_9mm: '9mm rounds' };

// ---- melee on people: the swing's real energy (melee.js) against flesh, as health. Bare hands are a shove-punch.
export const HAND = { label: 'fists', reach: 1.2, every: 0.5 };
export const FACING = 70 * Math.PI / 180; // a swing lands within this of where you face
export const BODY_R = 0.4;                 // the target's body adds this to reach
export function meleeDamage(w) {
  if (w === 'hand' || !MELEE[w]) return 8;
  return Math.round(Math.min(60, 6 * Math.sqrt(hitEnergy(w, 'flesh'))));
}
export const meleeSpec = (w) => (w === 'hand' ? HAND : MELEE[w] || null);

// ---- guns: real handling. The magazine and the reserve are counted by the server; a reload takes time and
// moves rounds from the reserve; each shot kicks the barrel (the server adds the kick to your aim, so you pull
// down against it like a real gun); a shot further than `near` loses damage down to `farK` at `range`.
export const GUNS = {
  pistol: { label: '9mm pistol', item: 'w_pistol', ammo: 'ammo_9mm', mag: 12, every: 0.16, reload: 1.8, dmg: 34, head: 2,
    near: 15, range: 60, farK: 0.5, kick: 0.03, kickMax: 0.18, settle: 0.45, sway: [0, 0.6, -0.4, 0.8, -0.9, 0.5, -0.3, 1] },
};
export const EYE = 1.6, CAP_R = 0.35, CAP_H = 1.75, HEAD_Y = 1.45;
// the kick after n quick shots (n = 0 for the first): radians of barrel rise and of sideways walk
export function recoil(g, n) {
  const G = GUNS[g]; if (!G || n <= 0) return { pitch: 0, yaw: 0 };
  return { pitch: Math.min(G.kickMax, G.kick * n), yaw: G.kick * 0.35 * G.sway[n % G.sway.length] };
}
// aim (unit vector, y up) turned up by pitch and sideways by yaw: what leaves the barrel
export function kickAim(d, k) {
  if (!k.pitch && !k.yaw) return d;
  const h = Math.hypot(d[0], d[2]) || 1e-6; let el = Math.atan2(d[1], h), az = Math.atan2(d[0], d[2]);
  el = Math.min(1.5, el + k.pitch); az += k.yaw;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}
export function gunDamage(g, dist, head) {
  const G = GUNS[g]; if (!G || dist > G.range) return 0;
  const k = dist <= G.near ? 1 : 1 - (1 - G.farK) * (dist - G.near) / (G.range - G.near);
  return Math.round(G.dmg * k * (head ? G.head : 1));
}
// a ray against a standing body (vertical capsule from feet p to p + h): distance along the ray and hit height, or null
export function rayBody(o, d, p, r = CAP_R, h = CAP_H, maxD = 1e9) {
  // closest points between the ray o + s d (|d| = 1) and the axis p + t up, t in [0, h]
  const wx = o[0] - p[0], wy = o[1] - p[1], wz = o[2] - p[2];
  const b = d[1], dw = d[0] * wx + d[1] * wy + d[2] * wz, den = 1 - b * b;
  let t = den < 1e-6 ? wy : (wy - b * dw) / den;
  t = Math.max(0, Math.min(h, t));
  const s = Math.max(0, Math.min(maxD, (p[0] - o[0]) * d[0] + (p[1] + t - o[1]) * d[1] + (p[2] - o[2]) * d[2]));
  t = Math.max(0, Math.min(h, o[1] + d[1] * s - p[1])); // the axis point nearest that spot on the ray
  const cx = o[0] + d[0] * s - p[0], cy = o[1] + d[1] * s - (p[1] + t), cz = o[2] + d[2] * s - p[2];
  if (cx * cx + cy * cy + cz * cz > r * r) return null;
  return { d: s, y: o[1] + d[1] * s - p[1] };
}

// ---- regions decide what's allowed (js/xenia/xenia.js REGIONS risk)
//   safe       Home Valley: nobody hurts anybody, nothing is raided
//   guarded    the Rangers keep the peace: no fights between players, no raids
//   contested  fights anywhere; a base can be raided only while one of its builders has been on in the last
//              OFFLINE_SHIELD (no breaking into a sleeping player's house)
//   wild       fights anywhere, raids any time
export const OFFLINE_SHIELD = 30 * 60e3;
export const pvpOk = (risk) => risk === 'contested' || risk === 'wild';
export function raidOk(risk, ownerSeenAgo) {
  if (risk === 'wild') return true;
  if (risk === 'contested') return ownerSeenAgo <= OFFLINE_SHIELD;
  return false;
}
// what a build piece takes before it gives way, in joules of blows (a crowbar swing on wood is ~110 J)
export const PIECE_J = { wood: 1500, stone: 4000, metal: 9000, ice: 1200, crystal: 3000 };
export const pieceHitJ = (w, mat) => (w === 'hand' ? 5 : hitEnergy(w, mat === 'metal' ? 'steel' : mat));
export const REPAIR_K = 0.25;            // a repair (the builder, at the piece) takes back this share of the piece's strength

// ---- supply crates: plain crates the world fills and refills; what's in them depends on the region's risk
export const LOOT_MS = 10 * 60e3;        // an emptied crate fills again after this
export const LOOT = {
  safe: [['mat:wood', 4, 1], ['fibre', 3, 1], ['mat:stone', 3, 0.8], ['w_knife', 1, 0.35], ['w_bat', 1, 0.25]],
  guarded: [['mat:metal', 2, 0.9], ['mat:wood', 4, 0.8], ['w_crowbar', 1, 0.35], ['w_machete', 1, 0.25], ['ammo_9mm', 12, 0.4]],
  contested: [['mat:metal', 4, 1], ['ammo_9mm', 24, 0.9], ['w_pistol', 1, 0.5], ['w_crowbar', 1, 0.3]],
  wild: [['mat:metal', 6, 1], ['ammo_9mm', 36, 1], ['w_pistol', 1, 0.8], ['mat:crystal', 2, 0.6]],
};
export function rollLoot(risk, rnd = Math.random) {
  const inv = {};
  for (const [k, n, p] of LOOT[risk] || LOOT.safe) if (rnd() < p) inv[k] = (inv[k] || 0) + Math.max(1, Math.round(n * (0.6 + rnd() * 0.8)));
  if (!Object.keys(inv).length) inv['mat:wood'] = 2;
  return inv;
}
// where the crates stand (hub metres; the region each is in is worked out from the spot, never typed)
export const CRATE_SPOTS = [
  { id: 'L-town', x: 24, z: -38 }, { id: 'L-camps', x: -262, z: 30 },      // Home Valley: by spawn, by the camps
  { id: 'L-ruins', x: -1278, z: -318 },                                    // Home Valley's edge: the old ruins
  { id: 'L-wreck', x: 1012, z: 1744 },                                     // Salt Coast: the wreck
  { id: 'L-cedar', x: -2200, z: -900 },                                    // Cedar Highlands
  { id: 'L-ridge', x: 1250, z: -1700 }, { id: 'L-pass', x: 1700, z: -2600 }, // Grey Ridge: the way up Grey Peak
];

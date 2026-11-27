// Procedural POIs, Minecraft-jigsaw style. Small template pieces with tagged connectors
// are assembled from the world seed. Nothing here is a hand-placed coordinate on the globe:
// a structure only exists if the seed, the biome and the terrain accept it.
import { rng, hash } from './names.js';

export const CELL = 160; // metres between structure region checks
export const TYPES = ['halvorsen', 'rattler', 'choir', 'wreck'];
// Per-biome pools. Keys match planetgen. The Hollow is underground and not a surface POI type.
export const BIOME_TYPES = {
  salt: ['wreck', 'halvorsen'],      // Bleachflats
  forest: ['halvorsen', 'rattler'],  // Rustmesa
  crystal: ['choir', 'rattler'],     // Glasswood
  ice: ['halvorsen', 'choir'],       // Snow Peaks
  shore: ['wreck', 'rattler'],       // Shatter Coast
};
export const TYPE_PURPOSE = {
  halvorsen: 'A Halvorsen post: rooms, halls and a tower of painted salvage',
  rattler: 'A Rattler camp: tight rooms and a watch post',
  choir: 'A Choir shrine: a chamber, a hall and a spire that hums',
  wreck: 'A wreck: hull, wing and tail settled on the ground',
};

const TH = 0.4;
const faces = {
  n: { x: 0, z: 1, yaw: 0, along: 'x' },
  s: { x: 0, z: -1, yaw: Math.PI, along: 'x' },
  e: { x: 1, z: 0, yaw: Math.PI / 2, along: 'z' },
  w: { x: -1, z: 0, yaw: -Math.PI / 2, along: 'z' },
};

function room(id, type, sx, sy, sz, doorFaces, opts = {}) {
  const boxes = [{ x: 0, y: 0.12, z: 0, sx, sy: 0.24, sz, role: 'floor' }];
  if (opts.roof) boxes.push({ x: 0, y: sy - 0.12, z: 0, sx, sy: 0.24, sz, role: 'roof' });
  const doorW = opts.doorW || 1.8, wallH = sy - 0.24, wallY = 0.24 + wallH / 2;
  const doors = new Set(doorFaces);
  const connectors = [];
  for (const [name, f] of Object.entries(faces)) {
    const fx = f.x * (sx / 2), fz = f.z * (sz / 2), len = f.along === 'x' ? sx : sz;
    if (doors.has(name)) {
      const side = (len - doorW) / 2;
      if (side > 0.2) {
        if (f.along === 'x') {
          boxes.push({ x: -len / 2 + side / 2, y: wallY, z: fz, sx: side, sy: wallH, sz: TH, role: 'wall' });
          boxes.push({ x: len / 2 - side / 2, y: wallY, z: fz, sx: side, sy: wallH, sz: TH, role: 'wall' });
        } else {
          boxes.push({ x: fx, y: wallY, z: -len / 2 + side / 2, sx: TH, sy: wallH, sz: side, role: 'wall' });
          boxes.push({ x: fx, y: wallY, z: len / 2 - side / 2, sx: TH, sy: wallH, sz: side, role: 'wall' });
        }
      }
      connectors.push({ id: `${id}-${name}`, x: fx, y: 0, z: fz, yaw: f.yaw, tag: 'door' });
    } else if (f.along === 'x') boxes.push({ x: 0, y: wallY, z: fz, sx: len, sy: wallH, sz: TH, role: 'wall' });
    else boxes.push({ x: fx, y: wallY, z: 0, sx: TH, sy: wallH, sz: len, role: 'wall' });
  }
  if (opts.tower) {
    const w = Math.min(sx, sz, 3.4);
    boxes.push({ x: 0, y: sy + 1.6, z: 0, sx: w, sy: 3.2, sz: w, role: 'tower' });
  }
  if (opts.spire) boxes.push({ x: 0, y: sy + 2.4, z: 0, sx: 1.2, sy: 4.8, sz: 1.2, role: 'spire' });
  return { id, type, sx, sy, sz, connectors, boxes };
}

function hull(id, type, sx, sy, sz, joints) {
  const boxes = [
    { x: 0, y: sy / 2, z: 0, sx, sy, sz, role: 'hull' },
  ];
  const connectors = joints.map((j) => {
    const f = faces[j];
    return { id: `${id}-${j}`, x: f.x * (sx / 2), y: 0, z: f.z * (sz / 2), yaw: f.yaw, tag: 'joint' };
  });
  return { id, type, sx, sy, sz, connectors, boxes };
}

export const PIECES = [
  room('hal-start', 'halvorsen', 7, 3.6, 7, ['n', 'e'], { roof: true }),
  room('hal-hall', 'halvorsen', 3.4, 3.2, 8, ['n', 's'], { roof: true, doorW: 1.6 }),
  room('hal-room', 'halvorsen', 8, 3.6, 6.5, ['s', 'w'], { roof: true }),
  room('hal-tower', 'halvorsen', 4.2, 4.2, 4.2, ['s'], { roof: true, tower: true, doorW: 1.6 }),
  room('rat-start', 'rattler', 6, 3.0, 6, ['n', 'w']),
  room('rat-hall', 'rattler', 3.0, 2.8, 7, ['n', 's'], { doorW: 1.5 }),
  room('rat-room', 'rattler', 6.5, 3.0, 5.5, ['s', 'e']),
  room('rat-tower', 'rattler', 3.6, 3.4, 3.6, ['s'], { tower: true, doorW: 1.5 }),
  room('choir-start', 'choir', 7, 4.2, 7, ['n', 'e'], { roof: true }),
  room('choir-hall', 'choir', 3.6, 3.8, 8, ['n', 's'], { roof: true, doorW: 1.7 }),
  room('choir-room', 'choir', 6.5, 4.2, 6.5, ['s', 'w'], { roof: true }),
  room('choir-spire', 'choir', 3.8, 4.6, 3.8, ['s'], { roof: true, spire: true, doorW: 1.6 }),
  hull('wreck-start', 'wreck', 8.5, 2.6, 3.6, ['n', 'e']),
  hull('wreck-wing', 'wreck', 5.5, 1.6, 3.2, ['s']),
  hull('wreck-tail', 'wreck', 4.2, 2.2, 3.0, ['s']),
];

const BY_TYPE = {};
for (const p of PIECES) (BY_TYPE[p.type] ||= []).push(p);
export function piecesFor(type) { return BY_TYPE[type] || []; }

export function rot(x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c - z * s, x * s + z * c];
}

function worldConn(px, pz, yaw, c) {
  const [x, z] = rot(c.x, c.z, yaw);
  return { x: px + x, z: pz + z, yaw: yaw + c.yaw };
}

export function attachPose(placed, connA, pieceB, connB) {
  const a = worldConn(placed.x, placed.z, placed.yaw, connA);
  const yaw = a.yaw + Math.PI - connB.yaw;
  const [ox, oz] = rot(connB.x, connB.z, yaw);
  return { x: a.x - ox, z: a.z - oz, yaw };
}

function corners(piece, x, z, yaw) {
  const hx = piece.sx / 2, hz = piece.sz / 2, out = [];
  for (const [lx, lz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [0, 0]]) {
    const [wx, wz] = rot(lx, lz, yaw); out.push([x + wx, z + wz]);
  }
  return out;
}

export function aabbOf(piece, x, z, yaw) {
  const pts = corners(piece, x, z, yaw);
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const [px, pz] of pts) { if (px < minx) minx = px; if (px > maxx) maxx = px; if (pz < minz) minz = pz; if (pz > maxz) maxz = pz; }
  return { minx, maxx, minz, maxz };
}

export function aabbOverlap(a, b, slack = 0.25) {
  return a.minx < b.maxx - slack && a.maxx > b.minx + slack && a.minz < b.maxz - slack && a.maxz > b.minz + slack;
}

// Rotated room footprints (not their inflated AABBs). Slack lets doorways touch.
export function obbOverlap(A, B, slack = 0.2) {
  const axes = [];
  for (const yaw of [A.yaw, B.yaw]) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    axes.push([c, s], [-s, c]);
  }
  const proj = (P, ax, az) => {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
    const mid = P.x * ax + P.z * az;
    const r = Math.abs(c * ax + s * az) * (P.piece.sx / 2) + Math.abs(-s * ax + c * az) * (P.piece.sz / 2);
    return [mid, r];
  };
  for (const [ax, az] of axes) {
    const [c1, r1] = proj(A, ax, az), [c2, r2] = proj(B, ax, az);
    if (Math.abs(c1 - c2) >= r1 + r2 - slack) return false;
  }
  return true;
}

export function fitY(ground, { hasSea, sea, type }, piece, x, z, yaw) {
  if (!ground) return 0;
  const hs = corners(piece, x, z, yaw).map(([wx, wz]) => ground(wx, wz));
  if (hs.some((h) => !Number.isFinite(h))) return null;
  const min = Math.min(...hs), max = Math.max(...hs), y = (min + max) / 2;
  const rough = type === 'wreck' ? 2.8 : 1.9;
  if (max - min > rough) return null;
  if (hasSea && sea != null && y < sea + 0.4 && type !== 'wreck') return null;
  if (hasSea && sea != null && type === 'wreck' && y < sea - 1.2) return null;
  for (const h of hs) {
    if (y - h > 1.5) return null; // floor floats over a drop
    if (h - y > 1.3) return null; // buried in a rise
  }
  return y;
}

function blockedAny(blocked, piece, x, z, yaw) {
  if (!blocked) return false;
  return corners(piece, x, z, yaw).some(([wx, wz]) => blocked(wx, wz));
}

function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// Grow a structure from a start piece at (x, z, yaw). Pure: same inputs, same parts.
export function assemble(type, seed, x, z, yaw, ground, blocked, world = {}) {
  const catalog = piecesFor(type);
  const start = catalog.find((p) => p.id.endsWith('-start'));
  if (!start) return null;
  const y0 = fitY(ground, { ...world, type }, start, x, z, yaw);
  if (y0 == null || blockedAny(blocked, start, x, z, yaw)) return null;
  const parts = [{ piece: start, x, y: y0, z, yaw }];
  const used = [{ i: 0, c: 0 }, { i: 0, c: 1 }].filter((u) => start.connectors[u.c]);
  const budget = type === 'wreck' ? 3 : 5;
  const r = rng(hash(seed, type.length, Math.floor(x * 10), Math.floor(z * 10), 71));
  while (used.length && parts.length < budget) {
    const next = used.shift();
    const host = parts[next.i], connA = host.piece.connectors[next.c];
    if (!connA) continue;
    const cands = shuffle(catalog.filter((p) => p.id !== start.id), r);
    let placed = false;
    for (const piece of cands) {
      const matches = piece.connectors.filter((c) => c.tag === connA.tag);
      for (const connB of shuffle(matches, r)) {
        const pose = attachPose(host, connA, piece, connB);
        const y = fitY(ground, { ...world, type }, piece, pose.x, pose.z, pose.yaw);
        if (y == null) continue;
        if (blockedAny(blocked, piece, pose.x, pose.z, pose.yaw)) continue;
        const box = aabbOf(piece, pose.x, pose.z, pose.yaw);
        if (parts.some((p) => obbOverlap({ piece, x: pose.x, z: pose.z, yaw: pose.yaw }, p))) continue;
        const idx = parts.length;
        parts.push({ piece, x: pose.x, y, z: pose.z, yaw: pose.yaw });
        for (let c = 0; c < piece.connectors.length; c++) if (piece.connectors[c] !== connB) used.push({ i: idx, c });
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  if (parts.length < 2) return null;
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const p of parts) {
    const a = aabbOf(p.piece, p.x, p.z, p.yaw);
    if (a.minx < minx) minx = a.minx; if (a.maxx > maxx) maxx = a.maxx;
    if (a.minz < minz) minz = a.minz; if (a.maxz > maxz) maxz = a.maxz;
  }
  return { type, x, z, yaw, parts, aabb: { minx, maxx, minz, maxz }, purpose: TYPE_PURPOSE[type], loot: makeLoot(type, parts, seed, x, z) };
}

const LOOT = {
  rattler: (r) => ({ 'mat:scrap': 2 + Math.floor(r() * 3), 'mat:ore': 1 + Math.floor(r() * 2) }),
  halvorsen: (r) => ({ 'mat:ore': 2 + Math.floor(r() * 2), 'mat:scrap': 1 + Math.floor(r() * 2) }),
  choir: (r) => ({ 'mat:crystal': 2 + Math.floor(r() * 2), 'mat:resonite': r() < 0.4 ? 1 : 0 }),
  wreck: (r) => ({ 'mat:scrap': 3 + Math.floor(r() * 2), 'mat:metal': 1 }),
};

function makeLoot(type, parts, seed, x, z) {
  const r = rng(hash(seed, Math.floor(x), Math.floor(z), 82));
  const rooms = parts.filter((p) => !/-hall$/.test(p.piece.id));
  const roll = rooms.length ? rooms : parts;
  const n = Math.max(1, Math.min(roll.length, type === 'rattler' ? 2 : 1 + (r() < 0.45 ? 1 : 0)));
  const table = LOOT[type] || LOOT.rattler;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = roll[i];
    const items = table(r);
    for (const k of Object.keys(items)) if (!items[k]) delete items[k];
    out.push({ i, x: p.x, y: p.y + 0.5, z: p.z, items });
  }
  return out;
}

export function typeForCell(biome, seed, cx, cz) {
  const list = BIOME_TYPES[biome] || BIOME_TYPES.salt;
  const r = rng(hash(seed, cx, cz, 34));
  if (r() > 0.55) return null;
  return list[Math.floor(r() * list.length)];
}

export function cellOrigin(seed, cx, cz) {
  const r = rng(hash(seed, cx, cz, 35));
  return {
    x: (cx + 0.18 + r() * 0.64) * CELL,
    z: (cz + 0.18 + r() * 0.64) * CELL,
    yaw: r() * Math.PI * 2,
  };
}

const cache = new Map();
export function clearJigsawCache() { cache.clear(); }

// One candidate per region cell, grown from the seed. Cached per (seed, tile, cell).
export function siteInCell({ seed, tile = '', cx, cz, biome, ground, blocked, hasSea, sea }) {
  const k = `${seed}|${tile}|${cx}|${cz}`;
  if (cache.has(k)) return cache.get(k);
  const type = typeForCell(biome, seed, cx, cz);
  let site = null;
  if (type) {
    const r = rng(hash(seed, cx, cz, 36));
    for (let attempt = 0; attempt < 5 && !site; attempt++) {
      const o = cellOrigin(seed, cx, cz);
      const x = o.x + (attempt ? (r() - 0.5) * 36 : 0);
      const z = o.z + (attempt ? (r() - 0.5) * 36 : 0);
      site = assemble(type, seed, x, z, o.yaw, ground, blocked, { hasSea, sea });
    }
  }
  if (site) { site.cx = cx; site.cz = cz; site.seed = seed; }
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  cache.set(k, site);
  return site;
}

// One Rattler camp near a known hub, so the first playable loop does not depend on a lucky cell.
// It is still grown from the seed with the same pieces and terrain checks; not a hand-placed building.
export function starterRattlerNear({ seed, tile = '', hubX, hubZ, ground, blocked, hasSea, sea }) {
  const k = `starter|${seed}|${tile}`;
  if (cache.has(k)) return cache.get(k);
  const hcx = Math.floor(hubX / CELL), hcz = Math.floor(hubZ / CELL);
  let site = null;
  for (let ring = 1; ring <= 8 && !site; ring++) {
    for (let dz = -ring; dz <= ring && !site; dz++) {
      for (let dx = -ring; dx <= ring && !site; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const cx = hcx + dx, cz = hcz + dz;
        const o = cellOrigin(seed, cx, cz);
        if (blocked && blocked(o.x, o.z)) continue;
        const built = assemble('rattler', hash(seed, 90, cx, cz), o.x, o.z, o.yaw, ground, blocked, { hasSea, sea });
        if (!built) continue;
        built.cx = cx; built.cz = cz; built.seed = seed; built.starter = true;
        site = built;
      }
    }
  }
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  cache.set(k, site);
  return site;
}

export function sitesNear(world, x, z, radius, hooks = {}) {
  const r = radius ?? 200, seed = world.seed, tile = (world.tile || '') + '';
  const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL);
  const c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
  const out = [];
  const starter = hooks.hubX != null ? starterRattlerNear({ seed, tile, hubX: hooks.hubX, hubZ: hooks.hubZ, ground: hooks.ground, blocked: hooks.blocked, hasSea: hooks.hasSea ?? world.hasSea, sea: hooks.sea ?? world.sea }) : null;
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
    if (starter && starter.cx === cx && starter.cz === cz) continue;
    const ox = (cx + 0.5) * CELL, oz = (cz + 0.5) * CELL;
    const h = hooks.height ? hooks.height(ox, oz) : 0;
    const biome = hooks.biome ? hooks.biome(ox, oz, h) : 'salt';
    const site = siteInCell({ seed, tile, cx, cz, biome, ground: hooks.ground, blocked: hooks.blocked, hasSea: hooks.hasSea ?? world.hasSea, sea: hooks.sea ?? world.sea });
    if (site && Math.hypot(site.x - x, site.z - z) <= r + 48) out.push(site);
  }
  if (starter && Math.hypot(starter.x - x, starter.z - z) <= r + 48) out.push(starter);
  return out;
}

export function inFootprint(site, x, z, pad = 1.2) {
  const a = site.aabb;
  return x >= a.minx - pad && x <= a.maxx + pad && z >= a.minz - pad && z <= a.maxz + pad;
}

export function structureAt(world, x, z, hooks = {}) {
  const tile = (world.tile || '') + '';
  if (hooks.hubX != null) {
    const starter = starterRattlerNear({ seed: world.seed, tile, hubX: hooks.hubX, hubZ: hooks.hubZ, ground: hooks.ground, blocked: hooks.blocked, hasSea: hooks.hasSea ?? world.hasSea, sea: hooks.sea ?? world.sea });
    if (starter && inFootprint(starter, x, z)) return 'This Rattler camp stands on ground nobody can dig';
  }
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (hooks.hubX != null) {
      const starter = cache.get(`starter|${world.seed}|${tile}`);
      if (starter && starter.cx === cx + dx && starter.cz === cz + dz) continue;
    }
    const ox = (cx + dx + 0.5) * CELL, oz = (cz + dz + 0.5) * CELL;
    const h = hooks.height ? hooks.height(ox, oz) : 0;
    const biome = hooks.biome ? hooks.biome(ox, oz, h) : 'salt';
    const site = siteInCell({ seed: world.seed, tile, cx: cx + dx, cz: cz + dz, biome, ground: hooks.ground, blocked: hooks.blocked, hasSea: hooks.hasSea ?? world.hasSea, sea: hooks.sea ?? world.sea });
    if (site && inFootprint(site, x, z)) return `This ${site.type} stands on ground nobody can dig`;
  }
  return null;
}

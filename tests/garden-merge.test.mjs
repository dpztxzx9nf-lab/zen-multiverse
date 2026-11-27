// node tests/garden-merge.test.mjs: leftover garden-frame poses lift onto the globe; migrate is idempotent.
import { EARTH_SITE, GARDEN_ARRIVAL, GARDEN_ARRIVAL_PLANET, HUB_PAD_Y, liftGardenPose, isLegacyGardenTile, gardenLocal, inGardenArea } from '../js/hub.js';
import { migrateGardenFrame } from '../server/src/garden-migrate.js';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };

ok(isLegacyGardenTile(null) && isLegacyGardenTile('') && !isLegacyGardenTile(EARTH_SITE.tile), 'empty tiles are leftover garden-frame poses');
ok(inGardenArea({ x: GARDEN_ARRIVAL.x, z: GARDEN_ARRIVAL.z, tile: null }), 'a leftover arrival pose is in the garden');
ok(inGardenArea(GARDEN_ARRIVAL_PLANET), 'the lifted arrival is in the garden');
ok(!inGardenArea({ x: 99999, z: 99999, tile: EARTH_SITE.tile }), 'far away on the same tile is not the garden');

function memSql(rows = {}) {
  const db = { lastpos: rows.lastpos || [], spot: rows.spot || [], items: rows.items || [], course: rows.course || [], fixtures: rows.fixtures || [], vault: rows.vault || [], garden_builds: rows.garden_builds || [] };
  const parse = (q) => q.replace(/\s+/g, ' ').trim();
  return {
    db,
    exec(q, ...p) {
      const s = parse(q);
      const all = (k) => ({ toArray: () => db[k] });
      if (/^ALTER TABLE /i.test(s)) return { toArray: () => [] };
      if (/^SELECT aid, x, y, z, tile FROM lastpos/i.test(s)) return all('lastpos');
      if (/^SELECT k, x, z, tile FROM spot/i.test(s)) return all('spot');
      if (/^SELECT id, x, z, tile FROM items/i.test(s)) return all('items');
      if (/^SELECT i, x, y, z, tile FROM course/i.test(s)) return all('course');
      if (/^SELECT id, x, y, z, tile FROM fixtures/i.test(s)) return all('fixtures');
      if (/^SELECT id, x, y, z, tile FROM garden_builds/i.test(s)) return all('garden_builds');
      if (/^SELECT data FROM vault/i.test(s)) return { toArray: () => db.vault };
      if (/^UPDATE lastpos SET/i.test(s)) { const r = db.lastpos.find((x) => x.aid === p[4]); if (r) Object.assign(r, { x: p[0], y: p[1], z: p[2], tile: p[3] }); return { toArray: () => [] }; }
      if (/^UPDATE spot SET/i.test(s)) { const r = db.spot.find((x) => x.k === p[3]); if (r) Object.assign(r, { x: p[0], z: p[1], tile: p[2] }); return { toArray: () => [] }; }
      if (/^UPDATE items SET/i.test(s)) { const r = db.items.find((x) => x.id === p[3]); if (r) Object.assign(r, { x: p[0], z: p[1], tile: p[2] }); return { toArray: () => [] }; }
      if (/^UPDATE fixtures SET/i.test(s)) { const r = db.fixtures.find((x) => x.id === p[4]); if (r) Object.assign(r, { x: p[0], y: p[1], z: p[2], tile: p[3] }); return { toArray: () => [] }; }
      if (/^UPDATE garden_builds SET/i.test(s)) { const r = db.garden_builds.find((x) => x.id === p[4]); if (r) Object.assign(r, { x: p[0], y: p[1], z: p[2], tile: p[3] }); return { toArray: () => [] }; }
      if (/^INSERT OR REPLACE INTO vault/i.test(s)) { db.vault = [{ data: p[0] }]; return { toArray: () => [] }; }
      return { toArray: () => [] };
    },
  };
}

const sql = memSql({
  lastpos: [{ aid: 'a', x: GARDEN_ARRIVAL.x, y: 0, z: GARDEN_ARRIVAL.z, tile: '' }],
  items: [{ id: 'i1', x: 6, z: 4, tile: null }],
  spot: [{ k: 'keeper', x: GARDEN_ARRIVAL.x + 2.5, z: GARDEN_ARRIVAL.z + 1.5, tile: '' }],
  fixtures: [{ id: 'g-bench', x: 6.8, y: 0, z: -23.2, tile: '' }],
  vault: [{ data: JSON.stringify({ x: 10, z: 8, tile: null, locked: true }) }],
});
const n = migrateGardenFrame(sql);
ok(n >= 5, `migrate touched leftover rows (got ${n})`);
ok(sql.db.lastpos[0].tile === EARTH_SITE.tile, 'lastpos is on the globe tile');
ok(Math.abs(sql.db.lastpos[0].x - GARDEN_ARRIVAL_PLANET.x) < 1e-6, 'lastpos x was lifted');
ok(Math.abs(sql.db.lastpos[0].y - HUB_PAD_Y) < 1e-6, 'lastpos y sits on the pad');
ok(sql.db.items[0].tile === EARTH_SITE.tile, 'ground items were lifted');
ok(sql.db.spot[0].tile === EARTH_SITE.tile, 'Ula\'s spot was lifted');
ok(sql.db.fixtures[0].tile === EARTH_SITE.tile, 'garden fixtures were lifted');
ok(JSON.parse(sql.db.vault[0].data).tile === EARTH_SITE.tile, 'the vault was lifted');
const n2 = migrateGardenFrame(sql);
ok(n2 === 0, `a second migrate is a no-op (got ${n2})`);

const already = memSql({ lastpos: [{ aid: 'b', x: GARDEN_ARRIVAL_PLANET.x, y: HUB_PAD_Y, z: GARDEN_ARRIVAL_PLANET.z, tile: EARTH_SITE.tile }] });
ok(migrateGardenFrame(already) === 0, 'already-lifted lastpos is left alone');

console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
process.exit(bad ? 1 : 0);

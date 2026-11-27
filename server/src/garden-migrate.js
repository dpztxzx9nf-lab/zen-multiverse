// One-time lift of leftover garden-frame rows (tile null / '') onto the home Earth
// globe (tile 1:1:1), so a save from the old garden frame keeps its items, spots,
// storage, vault and last position without a disconnect.
import { isLegacyGardenTile, liftGardenPose, EARTH_SITE } from '../../js/hub.js';

const r2 = (v) => Math.round(v * 100) / 100;

function liftRow(x, y, z, tile) {
  if (!isLegacyGardenTile(tile) || x == null || z == null) return null;
  return liftGardenPose({ x, y: y == null ? 0 : y, z, tile: null });
}

export function migrateGardenFrame(sql) {
  if (!sql) return;
  let n = 0;
  const bump = () => { n++; };

  // lastpos (tile column added later; empty / missing means the garden frame)
  try {
    for (const r of sql.exec('SELECT aid, x, y, z, tile FROM lastpos').toArray()) {
      const p = liftRow(r.x, r.y, r.z, r.tile);
      if (!p) continue;
      sql.exec('UPDATE lastpos SET x = ?, y = ?, z = ?, tile = ? WHERE aid = ?', p.x, p.y, p.z, p.tile, r.aid);
      bump();
    }
  } catch (e) { /* table/column not ready */ }

  try {
    for (const r of sql.exec('SELECT k, x, z, tile FROM spot').toArray()) {
      const p = liftRow(r.x, 0, r.z, r.tile);
      if (!p) continue;
      sql.exec('UPDATE spot SET x = ?, z = ?, tile = ? WHERE k = ?', r2(p.x), r2(p.z), p.tile, r.k);
      bump();
    }
  } catch (e) { /* */ }

  try {
    for (const r of sql.exec('SELECT id, x, z, tile FROM items').toArray()) {
      const p = liftRow(r.x, 0, r.z, r.tile);
      if (!p) continue;
      sql.exec('UPDATE items SET x = ?, z = ?, tile = ? WHERE id = ?', r2(p.x), r2(p.z), p.tile, r.id);
      bump();
    }
  } catch (e) { /* */ }

  try {
    for (const r of sql.exec('SELECT i, x, y, z, tile FROM course').toArray()) {
      const p = liftRow(r.x, r.y, r.z, r.tile);
      if (!p) continue;
      sql.exec('UPDATE course SET x = ?, y = ?, z = ?, tile = ? WHERE i = ?', p.x, p.y, p.z, p.tile, r.i);
      bump();
    }
  } catch (e) { /* */ }

  try {
    for (const r of sql.exec('SELECT id, x, y, z, tile FROM fixtures').toArray()) {
      const p = liftRow(r.x, r.y, r.z, r.tile);
      if (!p) continue;
      sql.exec('UPDATE fixtures SET x = ?, y = ?, z = ?, tile = ? WHERE id = ?', p.x, p.y, p.z, p.tile, r.id);
      bump();
    }
  } catch (e) { /* */ }

  try {
    const r = sql.exec("SELECT data FROM vault WHERE k = 'v'").toArray()[0];
    if (r) {
      const v = JSON.parse(r.data);
      if (v && isLegacyGardenTile(v.tile) && v.x != null) {
        const p = liftGardenPose(v);
        sql.exec("INSERT OR REPLACE INTO vault (k, data) VALUES ('v', ?)", JSON.stringify(p));
        bump();
      }
    }
  } catch (e) { /* */ }

  // garden_builds had no tile column: they were garden-local metres
  try { sql.exec('ALTER TABLE garden_builds ADD COLUMN tile TEXT'); } catch { /* already there */ }
  try {
    for (const r of sql.exec('SELECT id, x, y, z, tile FROM garden_builds').toArray()) {
      const p = liftRow(r.x, r.y, r.z, r.tile);
      if (!p) continue;
      sql.exec('UPDATE garden_builds SET x = ?, y = ?, z = ?, tile = ? WHERE id = ?', p.x, p.y, p.z, p.tile, r.id);
      bump();
    }
  } catch (e) { /* */ }

  return n;
}

export { EARTH_SITE };

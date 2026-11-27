// Drop voxel digs and shared place-digs when the world generation changes, so
// griefed test land does not come back. Accounts, last positions, chat, blocks
// and placed builds are left alone.
import { WORLD_GEN } from '../../js/world-gen.js';

export function wipeStaleTerrain(sql, gen = WORLD_GEN) {
  sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  const row = sql.exec("SELECT v FROM meta WHERE k = 'world_gen'").toArray()[0];
  const prev = row ? Number(row.v) : 0;
  if (prev >= gen) return { wiped: false, from: prev, to: gen };
  try { sql.exec('DELETE FROM vox'); } catch { /* */ }
  try { sql.exec('DELETE FROM place_dig'); } catch { /* */ }
  sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('world_gen', ?)", String(gen));
  return { wiped: true, from: prev, to: gen };
}

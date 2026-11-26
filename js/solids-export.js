// Measures the collision the server needs from the live game (tools/ci/collision.py --export writes it to
// js/solids-data.js, and --check fails CI when that file no longer matches what the game bakes):
//   garden:   the fixed scenery grids, exactly as baked from the visible meshes
//   prefabs:  each camp prop kind baked once at the origin (the server places them where its camps are)
//   gate:     the storehouse gate leaf as a box in its hinge frame (a movable prop)
//   fixtures: each storage fixture kind's rigid-body box (crates, lockers, stations)
import { bakeSolids, bodyBox, solid } from './solids-bake.js';
import { cellsToJSON } from './solids.js';
import { createColliders } from './colliders.js';
import { fixtureModels } from './storage.js';

export const STATIC_TAG = (t) => typeof t === 'string' && (/^garden:/.test(t) || /^beds/.test(t) || ['places', 'cove', 'rack', 'shed', 'pad', 'spawn'].includes(t));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const slim = (c) => { const j = cellsToJSON(c); const o = { name: c.name, kind: c.kind || 'solid' }; for (const k of ['type', 'x0', 'z0', 'cs', 'nx', 'nz', 'pack', 'bits', 'top', 'bottom']) if (j[k] != null) o[k] = j[k]; return o; };
const boxOf = (b, dx = 0, dz = 0) => ({ type: 'box', kind: 'solid', x: r4(b.x - dx), z: r4(b.z - dz), hw: r4(b.hw), hd: r4(b.hd), ry: r4(b.ry), top: r4(b.top), bottom: r4(b.bottom) });
export const keyOf = (c) => [c.name, c.x0, c.z0, c.nx, c.nz, c.bits].join('|');

export function exportSolids(w) {
  const g = w.debug.game || w.debug.core, cols = g.player.colliders;
  const garden = cols.list.filter((c) => c.kind === 'solid' && c.type === 'cells' && STATIC_TAG(c.tag)).map(slim);
  // camp props: each kind baked at the origin (all props of a kind must come out the same)
  const prefabs = {}, mismatch = [];
  let gate = null;
  const props = [];
  w.scene.traverse((o) => { const ph = o.userData && o.userData.phys; if (/^camp-/.test(o.name) && ph && ph.k === 'solid' && !ph.body && !(o.parent && /^camp-/.test(o.parent.name))) props.push(o); });
  for (const o of props) {
    const at = o.position.clone(); o.position.set(0, 0, 0); o.updateMatrixWorld(true);
    const tmp = createColliders(); bakeSolids(o, tmp, { ground: () => 0, tag: 'p' });
    const gl = o.getObjectByName('camp-gate');
    if (gl && !gate) {
      const ry = gl.rotation.y, hz = gl.userData.hinge; gl.rotation.y = 0; const b = bodyBox(gl); gl.rotation.y = ry;
      if (b && hz) gate = { hinge: hz, box: boxOf(b, gl.position.x, gl.position.z) };
    }
    o.position.copy(at); o.updateMatrixWorld(true);
    const grids = tmp.list.map(slim).sort((a, b) => keyOf(a) < keyOf(b) ? -1 : 1);
    const k = o.name;
    if (!prefabs[k]) prefabs[k] = grids;
    else if (JSON.stringify(prefabs[k]) !== JSON.stringify(grids)) mismatch.push(k);
  }
  const M = fixtureModels(), fixtures = {};
  for (const k of Object.keys(M)) { const m = M[k](); solid(m, { name: k, body: true }); const b = bodyBox(m); if (b) fixtures[k] = boxOf(b); }
  return { garden, prefabs, gate, fixtures, mismatch };
}

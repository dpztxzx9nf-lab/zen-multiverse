// Phone twin of a LOD-kit GLB: keep only the farthest LOD of each variant (renamed to lod0), drop the rest.
// Phones only ever draw that level (js/nature.js placeScan), so they stop downloading the near meshes.
// usage: node far-lod-glb.mjs in.glb out.glb     (keeps meshopt + quantization + textures as they are)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const re = /_v(\d+)_lod(\d+)/;
const nodes = doc.getRoot().listNodes().filter((n) => re.test(n.getName()) || (n.getMesh() && re.test(n.getMesh().getName())));
const key = (n) => re.exec(n.getName()) || re.exec(n.getMesh().getName());
const far = new Map();
for (const n of nodes) { const [, v, l] = key(n); if (!far.has(v) || +l > far.get(v)) far.set(v, +l); }
for (const n of nodes) {
  const [, v, l] = key(n);
  if (+l !== far.get(v)) { n.dispose(); continue; }
  n.setName(n.getName().replace(re, `_v${v}_lod0`)); if (n.getMesh()) n.getMesh().setName(n.getMesh().getName().replace(re, `_v${v}_lod0`));
}
await doc.transform(prune());
await io.write(out, doc);
console.log(out, [...far.entries()].map(([v, l]) => `v${v}: lod${l}`).join(' '));

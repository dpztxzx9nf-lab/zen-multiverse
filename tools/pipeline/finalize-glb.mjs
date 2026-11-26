// Blender export (JPEG/PNG, float) -> game GLB: WebP textures (q82, max --size px), quantized + meshopt.
// usage: node finalize-glb.mjs in.glb out.glb [size=1024]   (then node ktx2-glb.mjs out.glb for the .k.glb)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, meshopt, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptEncoder.ready;
const [src, out, size = '1024'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+size, +size], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
const fs = await import('fs'); console.log(out.split('/').pop(), (fs.statSync(out).size / 1e6).toFixed(2), 'MB');

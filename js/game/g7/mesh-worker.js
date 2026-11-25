// Mesh worker: voxel blocks in, triangle meshes out (keeps the main thread smooth while digging).
import { surfaceNets } from './surfacenets.js';
self.onmessage = (e) => {
  const { id, fill, mat, N, vs } = e.data;
  const m = surfaceNets(fill, mat, N, vs);
  self.postMessage({ id, ...m }, [m.pos.buffer, m.nor.buffer, m.mat.buffer, m.idx.buffer]);
};

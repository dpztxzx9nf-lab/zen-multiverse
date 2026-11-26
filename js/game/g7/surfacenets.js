// Surface nets over a padded voxel block (pure function: runs in the mesh worker and, for tests,
// on the main thread). fill: 0 air .. 255 solid, iso at 127.5; mat: material id per sample.
// Block: N³ samples, sample (i,j,k) sits at ((i - 1) * vs, ...) relative to the chunk origin,
// quads are made for edges at samples 1..N-2, so a chunk overlaps its neighbour by one voxel (no seams).
export function surfaceNets(fill, mat, N, vs) {
  const ISO = 127.5, N2 = N * N;
  const at = (x, y, z) => fill[(z * N + y) * N + x];
  const cellV = new Int32Array((N - 1) * (N - 1) * (N - 1)).fill(-1);
  const C = N - 1, cid = (x, y, z) => (z * C + y) * C + x;
  const pos = [], nor = [], mats = [], idx = [];
  const v = new Float32Array(8);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cx = [0, 1, 0, 1, 0, 1, 0, 1], cy = [0, 0, 1, 1, 0, 0, 1, 1], cz = [0, 0, 0, 0, 1, 1, 1, 1];
  for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    let mask = 0, mi = 0, mv = -1;
    for (let k = 0; k < 8; k++) { const i = ((z + cz[k]) * N + y + cy[k]) * N + x + cx[k]; v[k] = fill[i]; if (v[k] > ISO) mask |= 1 << k; if (v[k] > mv) { mv = v[k]; mi = i; } }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      const ia = v[a] > ISO, ib = v[b] > ISO; if (ia === ib) continue;
      const t = (ISO - v[a]) / (v[b] - v[a]);
      sx += cx[a] + (cx[b] - cx[a]) * t; sy += cy[a] + (cy[b] - cy[a]) * t; sz += cz[a] + (cz[b] - cz[a]) * t; n++;
    }
    sx /= n; sy /= n; sz /= n;
    // normal: minus the gradient of fill (fill grows into the solid)
    const gx = (v[1] - v[0]) + (v[3] - v[2]) + (v[5] - v[4]) + (v[7] - v[6]);
    const gy = (v[2] - v[0]) + (v[3] - v[1]) + (v[6] - v[4]) + (v[7] - v[5]);
    const gz = (v[4] - v[0]) + (v[5] - v[1]) + (v[6] - v[2]) + (v[7] - v[3]);
    const gl = Math.hypot(gx, gy, gz) || 1;
    cellV[cid(x, y, z)] = pos.length / 3;
    pos.push((x + sx - 1) * vs, (y + sy - 1) * vs, (z + sz - 1) * vs);
    nor.push(-gx / gl, -gy / gl, -gz / gl);
    mats.push(mat[mi]);
  }
  // quads across every sign-changing edge owned by this chunk (samples 1..N-2)
  const quad = (a, b, c, d, nx, ny, nz) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // orient so the face points out of the solid
    const ax = pos[b * 3] - pos[a * 3], ay = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2];
    const bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    if (fx * nx + fy * ny + fz * nz >= 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  };
  for (let z = 1; z < N - 1; z++) for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const s0 = at(x, y, z) > ISO;
    if (x < N - 1 && (at(x + 1, y, z) > ISO) !== s0) { const d = s0 ? 1 : -1; quad(cellV[cid(x, y - 1, z - 1)], cellV[cid(x, y, z - 1)], cellV[cid(x, y, z)], cellV[cid(x, y - 1, z)], d, 0, 0); }
    if (y < N - 1 && (at(x, y + 1, z) > ISO) !== s0) { const d = s0 ? 1 : -1; quad(cellV[cid(x - 1, y, z - 1)], cellV[cid(x - 1, y, z)], cellV[cid(x, y, z)], cellV[cid(x, y, z - 1)], 0, d, 0); }
    if (z < N - 1 && (at(x, y, z + 1) > ISO) !== s0) { const d = s0 ? 1 : -1; quad(cellV[cid(x - 1, y - 1, z)], cellV[cid(x, y - 1, z)], cellV[cid(x, y, z)], cellV[cid(x - 1, y, z)], 0, 0, d); }
  }
  void N2;
  const P = new Float32Array(pos), Nn = new Float32Array(nor), Mt = new Uint8Array(mats);
  const I = P.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { pos: P, nor: Nn, mat: Mt, idx: I };
}

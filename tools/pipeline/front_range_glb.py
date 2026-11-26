# Front Range heightfield (assets/terrain/front-range-pc.bin, same maths as js/mountains.js) -> a plain
# glTF grid (positions in the game's far-group metres) for lodkit.py to decimate.
#   python3 front_range_glb.py REPO OUT.glb [pc|phone]
import json, math, struct, sys
import numpy as np
repo, out = sys.argv[1], sys.argv[2]; tier = sys.argv[3] if len(sys.argv) > 3 else 'pc'
meta = json.load(open(f'{repo}/assets/terrain/front-range.json')); spec = meta[tier]; ns, ew = spec['ns'], spec['ew']
u16 = np.fromfile(f'{repo}/assets/terrain/front-range-{tier}.bin', dtype='<u2').reshape(ns, ew).astype(np.float64)
EXAG, YAW = 1.65, 12.57 * math.pi / 180
ss = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
j, i = np.mgrid[0:ns, 0:ew]
north = meta['northMin'] + (meta['northMax'] - meta['northMin']) * (j / (ns - 1))
east = meta['eastMin'] + (meta['eastMax'] - meta['eastMin']) * (i / (ew - 1))
e = meta['elev0'] + u16 * meta['scale']; ve = meta['viewer']['elev']
drop = np.maximum.reduce([1 - ss(0, 0.08, i / (ew - 1)), (1 - ss(0, 0.06, j / (ns - 1))) * 0.7, (1 - ss(0, 0.06, 1 - j / (ns - 1))) * 0.7])
e = e * (1 - drop) + ve * drop
cy, sy = math.cos(YAW), math.sin(YAW)
x = north * cy + east * sy; z = -north * sy + east * cy; y = (e - ve) * EXAG
pos = np.stack([x, y, z], -1).reshape(-1, 3).astype(np.float32)
a = (j[:-1, :-1] * ew + i[:-1, :-1]).ravel(); b = a + 1; c = a + ew; d = c + 1
idx = np.stack([a, c, b, b, c, d], -1).ravel().astype(np.uint32)
# make it face up (same flip test as the game)
v0, v1, v2 = pos[idx[0::3]], pos[idx[1::3]], pos[idx[2::3]]
if np.cross(v1 - v0, v2 - v0)[:, 1].sum() < 0: idx = idx.reshape(-1, 3)[:, [0, 2, 1]].ravel()
pb, ib = pos.tobytes(), idx.tobytes()
gl = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'frontRange'}],
      'meshes': [{'name': 'frontRange', 'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
      'buffers': [{'byteLength': len(pb) + len(ib)}],
      'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(pb), 'target': 34962}, {'buffer': 0, 'byteOffset': len(pb), 'byteLength': len(ib), 'target': 34963}],
      'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()},
                    {'bufferView': 1, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'}]}
js = json.dumps(gl).encode(); js += b' ' * (-len(js) % 4); bin_ = pb + ib; bin_ += b'\0' * (-len(bin_) % 4)
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js); f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)
print(out, len(pos), 'verts', len(idx) // 3, 'tris')

// The M4 is a camera viewmodel. Three.js only draws objects in the scene graph,
// and the walk camera is not in the scene, so parenting the gun to the camera
// alone leaves it invisible. mountViewmodel must put the camera in the scene first.
import { mountViewmodel } from '../js/game/mount-viewmodel.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function node(name) {
  const n = {
    name,
    parent: null,
    children: [],
    frustumCulled: true,
    add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); },
    remove(c) { this.children = this.children.filter((x) => x !== c); if (c.parent === this) c.parent = null; },
  };
  return n;
}
function inGraph(root, obj) {
  if (root === obj) return true;
  return (root.children || []).some((c) => inGraph(c, obj));
}

const scene = node('scene'), camera = node('camera'), gun = node('m4');
camera.add(gun);
ok(!inGraph(scene, gun), 'a gun parented only to the camera is not in the scene graph');
ok(mountViewmodel(gun, camera, scene) === true, 'mountViewmodel reports the gun is now in the scene');
ok(camera.parent === scene, 'the walk camera is added to the scene');
ok(gun.parent === camera, 'the gun stays a child of the camera');
ok(inGraph(scene, gun), 'the gun is reachable from the scene, so it can be drawn');
ok(gun.frustumCulled === false, 'the viewmodel is not frustum-culled');

const scene2 = node('scene'), cam2 = node('camera'), gun2 = node('m4');
scene2.add(node('world'));
ok(mountViewmodel(gun2, cam2, scene2) && inGraph(scene2, gun2), 'mounting still works when the scene already has world objects');
ok(mountViewmodel(gun2, cam2, scene2) && gun2.parent === cam2, 'a second mount is a no-op and keeps the same parent');
ok(!mountViewmodel(null, cam2, scene2), 'mounting without a mesh fails safely');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);

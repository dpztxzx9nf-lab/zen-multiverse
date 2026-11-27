// Three.js only draws objects in the scene graph. The walk camera is the view,
// but it is never added to the scene, so a mesh parented only to the camera is
// invisible (held tools still show because they live on the character in the
// scene). Put the camera in the scene first, then parent the viewmodel to it.
export function mountViewmodel(obj, camera, scene) {
  if (!obj || !camera) return false;
  if (scene && !camera.parent) scene.add(camera);
  if (obj.parent !== camera) camera.add(obj);
  obj.frustumCulled = false;
  return !!(scene && camera.parent === scene && obj.parent === camera);
}

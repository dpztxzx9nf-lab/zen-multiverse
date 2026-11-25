// Shared "walk somewhere" core for the away worlds (the moon, the procedural planets):
// one player, proximity interactions, drag-to-look, the bag, a drift (ambient) mode and the HUD wiring.
// The world supplies its ground(x, z), gravity and colliders; the core does the rest.
import * as THREE from 'three';
import { createPlayer } from './player.js';
import { createInteractor } from './interact.js';
import { getHud, setActive } from './session.js';
import { game } from './store.js';

export function createWalkCore({ scene, camera, P, canvas, ground, gravity = 9.81, jumpV = 3.3, walk, run, start = { x: 0, z: 0, yaw: 0 }, bounds = null, colliders = null, extraTabs = [], onMap = null, palette, helmet = false }) {
  const hud = getHud(P);
  const opts = { scene, camera, hud, P, colliders, ground, gravity, start, bounds, jumpV, palette };
  if (walk) opts.walk = walk; if (run) opts.run = run;
  const player = createPlayer(opts);
  const interact = createInteractor({ hud, player });
  // a glass bubble helmet over the sun hat (whimsical, and the hat stays on)
  if (helmet) {
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.25, 28, 20), new THREE.MeshPhysicalMaterial({ color: '#dff2ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1, specularIntensity: 1 }));
    glass.position.y = 0.06; glass.renderOrder = 3; player.character.head.add(glass);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.5, metalness: 0.3 }));
    collar.position.y = -0.13; player.character.head.add(collar);
    const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.2, 4, 12).scale(1.15, 1, 0.62).translate(0, 0.27, -0.19), new THREE.MeshStandardMaterial({ color: '#f1ede6', roughness: 0.55 }));
    player.character.head.parent.add(pack);
  }
  let drift = false, driftT = 0, active = false;
  const extra = extraTabs;
  function openBag(which) {
    hud.openPanel([{ id: 'bag', label: 'Bag', icon: 'bag', render: (b) => { b.innerHTML = hud.itemsHtml(); } }, ...extra], which);
  }
  function setDrift(on) { drift = on; hud.setMode(on ? 'ambient' : 'walk'); }
  const activeApi = {
    primary: () => { if (hud.dialogOpen || drift || core.cinematic) return; interact.run(0); },
    secondary: () => !drift && !core.cinematic && interact.run(1),
    jump: () => !drift && !core.cinematic && player.jump(),
    bag: () => !core.cinematic && openBag(),
    mode: () => !core.cinematic && setDrift(!drift),
    map: () => onMap && !core.cinematic && onMap(),
    tool: () => {},
  };
  // drag to look (one finger / mouse); the joystick and buttons are HUD elements on their own
  let drag = null;
  const input = {
    down(e) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; },
    move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const s = 2.2 / Math.max(innerWidth, innerHeight);
      if (!drift) player.look((e.clientX - drag.x) * s * 1.6, (e.clientY - drag.y) * s * 0.9);
      drag.x = e.clientX; drag.y = e.clientY;
    },
    up(e) { if (drag && e.pointerId === drag.id) drag = null; },
    leave() { drag = null; },
  };
  canvas.addEventListener('wheel', (e) => { if (active && !drift) player.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: true });
  const dv = new THREE.Vector3();
  const core = {
    hud, player, interact, input, openBag, extraTabs: extra, cinematic: false,
    get drift() { return drift; },
    setDrift,
    activate() { active = true; setActive(activeApi); hud.showJump(true); hud.showMap(game.unlocked('warp')); hud.setMode(drift ? 'ambient' : 'walk'); },
    deactivate() { active = false; },
    update(dt) {
      if (core.cinematic) { player.character.update(dt, {}); return; }
      if (!drift && !hud.panelOpen && !hud.dialogOpen) player.update(dt);
      else player.character.update(dt, {});
      interact.update();
      hud.tick(dt, player.speed > 0.2);
    },
    // drift: a slow, wide orbit around wherever she is standing
    updateCamera(dt) {
      if (core.cinematic) return;
      if (!drift) { player.updateCamera(dt); return; }
      driftT += dt;
      const p = player.position, a = driftT * 0.035 + player.cam.yaw, r = 16 + Math.sin(driftT * 0.05) * 4;
      dv.set(p.x + Math.sin(a) * r, 0, p.z + Math.cos(a) * r);
      dv.y = Math.max(ground(dv.x, dv.z) + 2, p.y + 4.5 + Math.sin(driftT * 0.07) * 1.5);
      camera.position.lerp(dv, 1 - Math.exp(-dt * 0.8));
      camera.lookAt(p.x, p.y + 1.2, p.z);
    },
  };
  return core;
}

// Shared "walk somewhere" core for the away worlds (the moon, the procedural planets):
// one first-person walker, gaze interactions, drag-to-look, the bag, a drift (ambient) mode and the HUD wiring.
// The world supplies its ground(x, z), gravity and colliders; the core does the rest.
import * as THREE from 'three';
import { createPlayer } from './player.js';
import { createInteractor, lookInput } from './interact.js';
import { getHud, setActive } from './session.js';
import { game } from './store.js';
import { createSteps } from './steps.js';

export function createWalkCore({ scene, camera, P, canvas, ground, gravity = 9.81, jumpV = 3.3, walk, run, start = { x: 0, z: 0, yaw: 0 }, bounds = null, colliders = null, extraTabs = [], onMap = null, palette, helmet = false, audio = null, surface = 'grass' }) {
  void helmet; // first person now: no body, so no helmet to show
  const hud = getHud(P);
  const steps = createSteps(audio);
  const onStep = (p, k) => steps.play(typeof surface === 'function' ? surface(p.x, p.z) : surface, k);
  const opts = { scene, camera, hud, P, colliders, ground, gravity, start, bounds, jumpV, palette, onStep };
  if (walk) opts.walk = walk; if (run) opts.run = run;
  const player = createPlayer(opts);
  const interact = createInteractor({ hud, player });
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
  // drag to look (mouse / right-hand finger); a tap or click that barely moves acts on what she looks at
  const input = lookInput({ player, look: () => !drift, tap: () => activeApi.primary() });
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

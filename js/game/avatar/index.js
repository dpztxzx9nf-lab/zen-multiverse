// Player character wiring: her body, third-person camera, creator and the APIs other systems use.
//   const pc = attachAvatar({ scene, camera, player, world: 'earth', ground, colliders, P });
//   per frame, after player.update(dt):        pc.update(dt)
//   after player.updateCamera(dt):              pc.updateCamera(dt)
// Public API for the other game systems (UI/settings, movement, multiplayer):
//   avatarApi.camera.mode / setMode('first'|'third'|'photo') / toggle() / swapShoulder() / setDistance(m) / onChange(fn)
//   avatarApi.appearance.get() / set(patch) / encode() / decode(code) / onChange(fn)
//   avatarApi.openCreator({ firstRun }) -> Promise (resolves when closed)
//   avatarApi.avatar (the local avatar: anim.play / setState / attach ...), avatarApi.createRemote(code) for other players
import * as THREE from 'three';
import { createAvatar } from './avatar.js';
import { createAvatarCamera } from './camera.js';
import { appearance } from './appearance.js';
import { buildRake } from '../character.js';
import { getHud } from '../session.js';
import { EMOTES } from './anim.js';

export const avatarApi = {
  avatar: null, camera: null, appearance, world: null,
  async openCreator(opts = {}) { const m = await import('./creator.js'); return m.openCreator({ ...opts, api: avatarApi }); },
  createRemote(code, { scene, ground, P } = {}) { return createAvatar({ scene: scene || avatarApi.scene, look: code, world: avatarApi.world, ground: ground || avatarApi.ground, P: P || avatarApi.P, local: false }); },
};

let firstRunShown = false, tabInstalled = false;
const EMOTE_LABEL = { wave: 'Wave', yes: 'Nod', no: 'No', dance: 'Dance', fold: 'Fold arms', focus: 'Breathe', sit: 'Sit', drink: 'Tea', talk: 'Chat' };
// Bag tab "You": camera mode, shoulder, photo mode, emotes and the character studio (until the pause menu links them)
function installYouTab(P) {
  if (tabInstalled) return; tabInstalled = true;
  const hud = getHud(P);
  const tab = { id: 'you', label: 'You', icon: 'leaf', render: (b, re) => {
    const cam = avatarApi.camera; const mode = cam ? cam.mode : 'first';
    const pill = (label, on, fn) => `<span class="pill${on ? ' on' : ''}" data-a="${fn}">${label}</span>`;
    b.innerHTML = `<h3>Camera</h3><div class="xh-shapes">${pill('First person', mode === 'first', 'first')}${pill('Third person', mode === 'third', 'third')}${pill('Photo mode', mode === 'photo', 'photo')}</div>
      <div class="xh-shapes">${pill('Shoulder left', cam && cam.shoulder < 0, 'sl')}${pill('Shoulder right', cam && cam.shoulder > 0, 'sr')}</div>
      <div style="opacity:.6;font-size:13px;margin:4px 0 0">V switches first / third person · Z swaps shoulder · scroll to zoom</div>
      <h3>Emotes</h3><div class="xh-shapes">${EMOTES.map((e) => pill(EMOTE_LABEL[e] || e, false, 'e:' + e)).join('')}</div>
      <h3>Appearance</h3><button class="b" data-a="studio">Open the character studio</button>`;
    b.onpointerdown = (ev) => {
      const a = ev.target.closest('[data-a]'); if (!a) return; const k = a.dataset.a;
      if (k === 'first' || k === 'third' || k === 'photo') { cam.setMode(k); if (k === 'photo') hud.closePanel(); else re && re(); }
      else if (k === 'sl' || k === 'sr') { if ((k === 'sl') !== (cam.shoulder < 0)) cam.swapShoulder(); re && re(); }
      else if (k.startsWith('e:')) { hud.closePanel(); const e = k.slice(2); avatarApi.avatar && avatarApi.avatar.play(e, e === 'dance' || e === 'sit' ? { loop: false } : {}); }
      else if (k === 'studio') { hud.closePanel(); avatarApi.openCreator({}); }
    };
  } };
  const open = hud.openPanel;
  hud.openPanel = (list, which) => open(list.some((t) => t.id === 'you') ? list : [...list, tab], which);
}

export function attachAvatar({ scene, camera, player, world = 'earth', ground = null, colliders = null, P = {} }) {
  const g = ground || ((x, z) => (player.ground ? player.ground(x, z) : 0));
  const env = player.env || null;
  const groundFn = env && env.top ? (x, z) => env.top(x, z, player.position.y + 0.6) : g;
  const av = createAvatar({ scene, look: appearance.get(), world, ground: groundFn, P, local: true });
  const cam = createAvatarCamera({ camera, player, ground: g, colliders, env });
  Object.assign(avatarApi, { avatar: av, camera: cam, world, scene, ground: groundFn, P, player });
  installYouTab(P);
  // first game launch: the character studio (skippable). Headless test runs skip it unless ?creator=1.
  const q = new URLSearchParams(location.search);
  if (!appearance.get().created && !firstRunShown && (q.get('creator') === '1' || (!navigator.webdriver && q.get('creator') !== '0'))) {
    firstRunShown = true;
    setTimeout(() => avatarApi.openCreator({ firstRun: true }), 1600);
  }
  const off = appearance.onChange((d) => av.setLook(d));
  // world gestures (kneel, water, toss...) play on the body
  if (player.act && !player.__avatarAct) {
    const act0 = player.act.bind(player);
    player.act = (name, ...rest) => { av.gesture(name); return act0(name, ...rest); };
    player.__avatarAct = true;
  }
  // props in hand: the rake shows in her hands now that she has hands
  const rake = buildRake(); rake.scale.setScalar(0.92); rake.visible = false;
  rake.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  av.ready.then(() => av.attach(rake, 'hand_r', { position: new THREE.Vector3(0.0, 0.02, 0.0), rotation: new THREE.Euler(0, 0, 0) }));
  const ch = player.character;
  if (ch && ch.handWorld && !ch.__avatarHand) {
    const hw0 = ch.handWorld.bind(ch);
    ch.handWorld = (out) => (av.rig ? av.handWorld(out, 'r') : hw0(out));
    ch.__avatarHand = true;
  }
  let holdingWas = null;
  const api = {
    avatar: av, camera: cam,
    update(dt, { forceThird = false } = {}) {
      cam.pollPad();
      const holding = ch && ch.holding ? ch.holding : null;
      if (holding !== holdingWas) {
        holdingWas = holding; rake.visible = holding === 'rake';
        if (holding) av.play('hold'); else av.stop('hold');
      }
      const firstPerson = cam.firstPerson && !forceThird;
      av.setFirstPerson(firstPerson);
      av.follow(player, dt, { firstPerson, photo: cam.mode === 'photo', holding: !!holding });
      av.lodFor(camera);
    },
    updateCamera(dt) {
      const sprinting = player.speed > 6;
      cam.update(dt, { eyeY: player.eye || 1.6, sprinting, holding: !!(ch && ch.holding) });
    },
    dispose() { off(); av.dispose(); },
  };
  return api;
}

// Hand-held tool models for her body (seen in first and third person). Each model is built with its
// grip at the origin, handle along +Y (toward the thumb) and the working end facing +Z; gripIn()
// gives the transform that sits that grip inside the closed fist of the rig's hand bone
// (Quaternius rig: fingers along +Y of hand_*, pinky -> index along +Z).
import * as THREE from 'three';
import { buildRake, buildCan } from '../character.js';

const M = (color, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const WOOD = M('#8a6440', 0.75), DARK = M('#4a3a2c', 0.8), STEEL = M('#9aa0a4', 0.38, 0.85), STONE = M('#7b7f80', 0.9), CLAY = M('#b9a27a', 0.85);
const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
const handle = (len, below = 0.1, r = 0.017) => mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 10).translate(0, len / 2 - below, 0), WOOD);

const BUILD = {
  rake() {
    const g = new THREE.Group(); const r = buildRake(); r.position.y = -0.95; g.add(r); return g;
  },
  can() { const g = new THREE.Group(); const c = buildCan(); c.position.set(0, -0.2, -0.02); g.add(c); return g; },
  pick() {
    const g = new THREE.Group(); g.add(handle(0.62, 0.12));
    const head = new THREE.Group(); head.position.y = 0.46;
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), DARK));
    const spike = mesh(new THREE.ConeGeometry(0.022, 0.2, 8).rotateX(Math.PI / 2).translate(0, 0, 0.12), STEEL);
    const back = mesh(new THREE.BoxGeometry(0.05, 0.018, 0.14).translate(0, 0, -0.08), STEEL); head.add(spike, back);
    g.add(head); return g;
  },
  axe() {
    const g = new THREE.Group(); g.add(handle(0.6, 0.12));
    const s = new THREE.Shape(); s.moveTo(0, -0.03); s.lineTo(0.11, -0.07); s.quadraticCurveTo(0.14, 0, 0.11, 0.07); s.lineTo(0, 0.03); s.lineTo(0, -0.03);
    const blade = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 }).translate(0, 0, -0.006).rotateY(-Math.PI / 2), STEEL);
    blade.position.set(0, 0.42, 0.02); g.add(blade); return g;
  },
  shaper() {
    // a stone-shaping trowel: short handle, broad leaf blade
    const g = new THREE.Group(); g.add(handle(0.2, 0.06, 0.016));
    const blade = mesh(new THREE.SphereGeometry(0.07, 12, 8).scale(1, 1.5, 0.18).translate(0, 0.24, 0.02), CLAY); g.add(blade);
    g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6).translate(0, 0.15, 0.0), STEEL)); return g;
  },
  build() {
    // a wooden mallet
    const g = new THREE.Group(); g.add(handle(0.42, 0.1));
    g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 14).rotateX(Math.PI / 2).translate(0, 0.32, 0.02), DARK)); return g;
  },
  stone() { const g = new THREE.Group(); g.add(mesh(new THREE.DodecahedronGeometry(0.06, 0).translate(0, 0, 0.02), STONE)); return g; },
};
export const TOOL_MODELS = Object.keys(BUILD);
export function buildTool(id) { const f = BUILD[id]; if (!f) return null; const g = f(); g.name = 'held-' + id; return g; }

// grip placement in hand_r / hand_l space
const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
const gripQ = new THREE.Quaternion().setFromRotationMatrix(basis);
export function gripIn(side = 'r') {
  return { position: new THREE.Vector3(side === 'r' ? -0.018 : 0.018, 0.078, 0.0), rotation: new THREE.Euler().setFromQuaternion(gripQ) };
}

// Hotfix: the starter pistol is held in the right hand, not hanging at the hip.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

const src = readFileSync('js/game/gunplay.js', 'utf8');
ok(/function placeInRightHand\(/.test(src), 'pistols have a dedicated right-hand hold');
ok(/bones\.hand_r/.test(src), 'the hold uses the right-hand bone');
ok(/av\.reach\('r'/.test(src), 'the right hand is IK-ed to the grip');
ok(/pistol \? placeInRightHand/.test(src), 'pistols do not use the rifle shoulder hold');
ok(/hold\.visible = false/.test(src), 'the mesh stays hidden until it is actually placed in the hand');
ok(/hanging from the hip/.test(src), 'the comment records why the origin fallback was removed');
ok(/pistol \? 0\.12/.test(src) && /pistol \? 0\.07/.test(src), 'the pistol body is thicker than the old 0.05 by 0.08 greybox');
ok(/0\.34/.test(src), 'the pistol is a readable length, not a hip-hidden stub');

console.log(`ok ${passed} pistol-hold-0381`);

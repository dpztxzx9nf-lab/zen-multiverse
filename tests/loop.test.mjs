// js/xenia/loop.js: the shared rules of Xenia's core loop (damage, recoil, ray vs body, regions, loot)
import assert from 'node:assert/strict';
import { meleeDamage, GUNS, recoil, kickAim, gunDamage, rayBody, pvpOk, raidOk, OFFLINE_SHIELD, rollLoot, PIECE_J, pieceHitJ, CRATE_SPOTS, isKit } from '../js/xenia/loop.js';
import { regionAt, hubFrame } from '../js/xenia/xenia.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
// melee: heavier, faster swings hurt more; a knife needs more cuts than a bat; nothing one-shots
const k = meleeDamage('knife'), b = meleeDamage('bat'), c = meleeDamage('crowbar'), hand = meleeDamage('hand');
ok(hand < k && k < b && Math.max(k, b, c, meleeDamage('machete')) <= 60, `melee damage: hand ${hand} < knife ${k} < bat ${b}; crowbar ${c}`);
// guns: falloff, headshots, range
ok(gunDamage('pistol', 5, false) === GUNS.pistol.dmg && gunDamage('pistol', 5, true) === GUNS.pistol.dmg * 2, 'pistol: full damage close, double to the head');
ok(gunDamage('pistol', 60, false) === Math.round(GUNS.pistol.dmg * GUNS.pistol.farK) && gunDamage('pistol', 61, false) === 0, 'pistol: half at 60 m, nothing past range');
// recoil climbs with quick shots, capped, and turns the aim up
const r1 = recoil('pistol', 1), r9 = recoil('pistol', 9);
ok(recoil('pistol', 0).pitch === 0 && r1.pitch > 0 && r9.pitch === GUNS.pistol.kickMax, 'recoil: first shot true, then climbs to a cap');
const up = kickAim([0, 0, 1], { pitch: 0.1, yaw: 0 });
ok(up[1] > 0.09 && Math.abs(Math.hypot(...up) - 1) < 1e-9, 'kick turns the barrel up and keeps it a unit vector');
// ray vs body
const hit = rayBody([0, 1.6, 0], [0, 0, 1], [0.1, 0, 10]);
ok(hit && Math.abs(hit.d - 10) < 0.5 && hit.y > 1.5, 'a level shot at a body 10 m ahead hits it high (head height)');
ok(rayBody([0, 1.6, 0], [0, 0, 1], [1.0, 0, 10]) === null, 'a metre to the side misses');
ok(rayBody([0, 1.6, 0], [0, 0, -1], [0, 0, 10]) === null, 'nothing behind you');
const low = kickAim([0, 0, 1], { pitch: -0.12, yaw: 0 });
const lh = rayBody([0, 1.6, 0], low, [0, 0, 10]); ok(lh && lh.y < 1.0, 'aimed low hits the body low');
// regions
ok(!pvpOk('safe') && !pvpOk('guarded') && pvpOk('contested') && pvpOk('wild'), 'fights only on contested and wild ground');
ok(!raidOk('safe', 0) && !raidOk('guarded', 0) && raidOk('contested', 1000) && !raidOk('contested', OFFLINE_SHIELD + 1) && raidOk('wild', 1e12), 'raids: contested only while a builder was on lately; wild always');
ok(pieceHitJ('crowbar', 'wood') > pieceHitJ('knife', 'wood') && PIECE_J.metal > PIECE_J.stone && PIECE_J.stone > PIECE_J.wood, 'pieces: crowbar beats knife on wood; metal > stone > wood');
// loot
let pistols = 0; for (let i = 0; i < 400; i++) if (rollLoot('contested').w_pistol) pistols++;
ok(pistols > 120 && pistols < 280, `contested crates hold a pistol about half the time (${pistols}/400)`);
let safeP = 0; for (let i = 0; i < 400; i++) if (rollLoot('safe').w_pistol) safeP++;
ok(safeP === 0 && Object.keys(rollLoot('safe')).length > 0, 'no guns in Home Valley crates, never an empty crate');
ok(isKit('w_pistol') && isKit('ammo_9mm') && !isKit('mat:wood'), 'kit items are weapons and ammo');
// crate spots: each in the region its loot says (worked out from the spot); at least one of each of the first three risks
const F = hubFrame(), risks = CRATE_SPOTS.map((s) => regionAt(F.toDir(s.x, s.z)).risk);
ok(['safe', 'guarded', 'contested'].every((r) => risks.includes(r)), `crates span safe, guarded and contested ground (${risks.join(', ')})`);
console.log(`loop: ${n} ok`);

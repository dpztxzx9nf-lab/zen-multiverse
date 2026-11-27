// Xenia's core loop on the server (server/src/loop.js) with two headless clients against local `wrangler dev`
// (LOCAL_DEV=1: a 'dev' intent may set a test region and kit, nothing else). Covers: supply crates fill the
// server-counted kit, crafting at a real station grants the weapon, melee reach / facing / swing rate / regions,
// the pistol's magazine, reserve, reload time, fire rate and recoil, downs and respawns, and raid rules on build
// pieces (safe/guarded refuse; contested/wild break by the material's strength; builders patch). Bad intents are
// answered, never a kick.
//   MP=http://127.0.0.1:8797 node server/test/loop.mjs
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; return c; };
async function api(path, body, token) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function signIn(email, name) {
  const s = await api('/auth/start', { email, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
  const v = await api('/auth/verify', { email, code: s.devCode, name });
  return { ...v.account, token: v.token };
}
function connect(ticket, name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`);
    const c = { name, ws, msgs: [], seq: 0, pos: null, g: null, on: (t, k) => c.msgs.filter((m) => m.t === t && (!k || m.k === k)) };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data); c.msgs.push(m);
      if (m.t === 'g' && (m.k === 'state' || m.k === 'hello')) c.g = m.game;
      if (m.t === 'fix') { c.pos = { ...c.pos, x: m.x, y: m.y, z: m.z }; c.acked = m.id; }
    };
    ws.onopen = () => res(c);
    ws.onerror = () => rej(new Error('ws error'));
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
function pose(c, x, z, yaw = 0) {
  c.seq++; const m = { t: 'p', x, y: 0, z, yaw, s: c.seq }; if (c.acked) m.r = c.acked;
  send(c, m); c.pos = { x, y: 0, z, yaw };
}
// walk at a legal pace (5 m/s, a pose every 100 ms) like the real client
async function walk(c, x, z, speed = 5) {
  const f0 = c.msgs.filter((m) => m.t === 'fix').length;
  for (let i = 0; i < 800; i++) {
    const p = c.pos, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    if (c.msgs.filter((m) => m.t === 'fix').length > f0) return false; // refused (a wall): stop like a player would
    const s = Math.min(d, speed * 0.1);
    pose(c, +(p.x + dx / d * s).toFixed(3), +(p.z + dz / d * s).toFixed(3), p.yaw);
    await sleep(100);
  }
}
const cb = (c, m) => send(c, { t: 'cb', ...m });
const g = (c, m) => send(c, { t: 'g', ...m });
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); } return false; };
const st = (c) => c.on('cb', 'st').at(-1);
const nos = (c) => c.on('cb', 'no').map((m) => m.why);
const lastNo = (c) => nos(c).at(-1) || '';
const face = (c, o) => { c.pos.yaw = Math.atan2(o.pos.x - c.pos.x, o.pos.z - c.pos.z); pose(c, c.pos.x, c.pos.z, c.pos.yaw); };
import { meleeDamage, GUNS, HP, RESPAWN_MS, CRATE_SPOTS, isKit, PIECE_J } from '../../js/xenia/loop.js';
import { GARDEN_FIXTURES } from '../src/storage.js';
const tag = Date.now().toString(36);
const A = await signIn(`brock+l${tag}@example.com`, 'Brock');
const B = await signIn(`cousin+l${tag}@example.com`, 'Cousin');
const inv = await api('/invite', {}, A.token); const red = await api('/invite/redeem', { code: inv.code }, B.token);
// the shared home (Xenia's hub with the garden's own bench, fire and smelter)
const ca = await connect((await api('/ticket', { world: red.world }, A.token)).ticket, 'A'); await sleep(200);
const cbb = await connect((await api('/ticket', { world: red.world }, B.token)).ticket, 'B'); await sleep(300);
ok(ca.on('hi')[0]?.cb === 1, 'Xenia advertises the core loop');
pose(ca, 0, 0); pose(cbb, 2, 0); await sleep(300);
cb(ca, { k: 'hello' }); cb(cbb, { k: 'hello' });
ok(await waitFor(() => st(ca) && st(cbb)), 'both get their fighting state');
ok(st(ca).hp === HP && !Object.keys(st(ca).kit).length, `fresh: ${HP} health, empty kit`);

// ---- loot: the supply crate by the spawn town
const town = CRATE_SPOTS.find((c) => c.id === 'L-town');
await walk(ca, town.x + 1.2, town.z, 7);
g(ca, { k: 'sopen', id: town.id });
ok(await waitFor(() => ca.on('g', 'sbox').some((m) => m.id === town.id)), 'the supply crate opens for anyone');
const box = ca.on('g', 'sbox').filter((m) => m.id === town.id).at(-1);
ok(box.kind === 'loot' && Object.keys(box.inv).length > 0, `it holds something: ${JSON.stringify(box.inv)}`);
ok(!Object.keys(box.inv).includes('w_pistol'), 'no guns in Home Valley crates');
for (const [k, n] of Object.entries(box.inv)) { g(ca, { k: 'stake', id: town.id, item: k, n }); await sleep(260); }
await sleep(300);
const got = Object.assign({}, ...ca.on('g', 'sgot').map((m) => m.give));
ok(Object.entries(box.inv).every(([k, n]) => got[k] === n), 'everything taken arrived');
const kitIn = Object.entries(box.inv).filter(([k]) => isKit(k));
ok(kitIn.every(([k, n]) => st(ca).kit[k] === n), `weapons and ammo from the crate are in the server's kit (${kitIn.map(([k]) => k).join(', ') || 'none this time'})`);
g(ca, { k: 'sput', id: town.id, item: 'mat:wood', n: 1 }); await sleep(250);
ok(/for taking from/.test(ca.on('g', 'sno').at(-1)?.text || ''), 'nothing goes into a supply crate');
g(ca, { k: 'splace', kind: 'loot', x: town.x + 2, y: 0, z: town.z + 2, yaw: 0, tile: '' }); await sleep(250);
ok(/belong to the world/.test(ca.on('g', 'sno').at(-1)?.text || ''), 'nobody sets down a supply crate');
g(ca, { k: 'splace', kind: 'chest', x: town.x + 2.5, y: 0, z: town.z + 1, yaw: 0, tile: '', ref: 'c1' }); await sleep(300);
const chest = ca.on('g', 'sone').map((m) => m.f).find((f) => f && f[1] === 'chest');
g(ca, { k: 'sput', id: chest?.[0], item: 'w_pistol', n: 1 }); await sleep(250);
ok(/don't have that/.test(ca.on('g', 'sno').at(-1)?.text || ''), 'a pistol the server never gave can\'t be put in a box');

// ---- crafting at a real station grants the weapon (the garden's smelter by the shed)
const forge = GARDEN_FIXTURES.find((f) => f.kind === 'forge');
await walk(ca, forge.x - 1.5, forge.z, 7);
g(ca, { k: 'scraft', r: 'crowbar', ref: 'k1' }); await sleep(400);
ok(ca.on('g', 'scraft').at(-1)?.ok === true && st(ca).kit.w_crowbar >= 1, `a crowbar made at the smelter is in the kit (${JSON.stringify(ca.on('g', 'scraft').at(-1))} ${JSON.stringify(st(ca).kit)})`);

// ---- melee
await walk(cbb, forge.x - 1.5, forge.z + 1.4, 7); await walk(ca, forge.x - 1.5, forge.z, 7);
cb(ca, { k: 'eq', w: 'crowbar' }); await sleep(150);
ok(st(ca).w === 'crowbar', 'crowbar in hand');
cb(ca, { k: 'eq', w: 'machete' }); await sleep(150);
ok(/no machete/.test(lastNo(ca)) && st(ca).w === 'crowbar', 'can\'t hold a machete the server never gave');
face(ca, cbb); await sleep(150);
cb(ca, { k: 'sw', id: B.id }); await sleep(250);
ok(/No fighting here/.test(lastNo(ca)) && st(cbb).hp === HP, 'Home Valley is safe: the swing does nothing');
cb(ca, { k: 'dev', risk: 'contested' }); cb(cbb, { k: 'dev', risk: 'contested' }); await sleep(900);
const hits0 = cbb.on('cb', 'hit').length;
cb(ca, { k: 'sw', id: B.id }); await sleep(250);
const h1 = cbb.on('cb', 'hit').at(-1);
ok(h1 && h1.dmg === meleeDamage('crowbar') && st(cbb).hp === HP - h1.dmg, `contested ground: the crowbar lands for ${h1?.dmg}`);
cb(ca, { k: 'sw', id: B.id }); await sleep(150);
ok(cbb.on('cb', 'hit').length === hits0 + 1, 'a second swing faster than a crowbar swings does nothing');
await sleep(700); ca.pos.yaw += Math.PI; pose(ca, ca.pos.x, ca.pos.z, ca.pos.yaw); await sleep(150);
cb(ca, { k: 'sw', id: B.id }); await sleep(250);
ok(/Face them/.test(lastNo(ca)), 'a swing behind you misses');
await walk(cbb, cbb.pos.x, cbb.pos.z + 4, 6); face(ca, cbb); await sleep(800);
cb(ca, { k: 'sw', id: B.id }); await sleep(250);
ok(/Out of reach/.test(lastNo(ca)), 'out of reach from 5 m');

// ---- the pistol
cb(ca, { k: 'dev', kit: { w_pistol: 1, ammo_9mm: 30, w_crowbar: 1 } }); await sleep(150);
cb(ca, { k: 'eq', w: 'pistol' }); await sleep(150);
await walk(cbb, ca.pos.x, ca.pos.z + 10, 6); face(ca, cbb); await sleep(300);
const aim = () => { const dx = cbb.pos.x - ca.pos.x, dz = cbb.pos.z - ca.pos.z, dy = 1.1 - 1.6, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
cb(ca, { k: 'fire', d: aim() }); await sleep(200);
ok(ca.on('cb', 'click').length === 1, 'empty magazine: click');
cb(ca, { k: 'rl' }); await sleep(300);
cb(ca, { k: 'fire', d: aim() }); await sleep(150);
ok(/Reloading/.test(lastNo(ca)), 'no shooting mid-reload');
await sleep(GUNS.pistol.reload * 1000); cb(ca, { k: 'hello' }); await sleep(200);
ok(st(ca).mag.pistol === GUNS.pistol.mag && st(ca).kit.ammo_9mm === 30 - GUNS.pistol.mag, `reloaded: ${st(ca).mag.pistol} in, ${st(ca).kit.ammo_9mm} in reserve`);
const hp0 = st(cbb).hp, nh = cbb.on('cb', 'hit').length;
cb(ca, { k: 'fire', d: aim() }); await sleep(30); cb(ca, { k: 'fire', d: aim() }); await sleep(300);
const shot = cbb.on('cb', 'hit').at(-1);
ok(cbb.on('cb', 'hit').length === nh + 1 && shot.dmg === GUNS.pistol.dmg && st(cbb).hp === Math.max(0, hp0 - shot.dmg), `a body shot at 10 m: ${shot?.dmg}`);
ok(st(ca).mag.pistol === GUNS.pistol.mag - 1, 'the shot faster than the gun cycles was dropped (one round spent)');
// recoil: hold the same aim and fire fast: the barrel climbs off him
const before = cbb.on('cb', 'hit').length; let fired = 0;
for (let i = 0; i < 6; i++) { await sleep(GUNS.pistol.every * 1000 + 30); cb(ca, { k: 'fire', d: aim() }); fired++; }
await sleep(300);
const shots = ca.on('cb', 'shot').slice(-fired);
ok(shots.at(-1).d[1] > shots[0].d[1] + 0.05, `recoil climbs (dy ${shots[0].d[1]} -> ${shots.at(-1).d[1]})`);
ok(cbb.on('cb', 'hit').length - before < fired, `held aim: ${cbb.on('cb', 'hit').length - before} of ${fired} quick shots land`);
// down and back
while (!cbb.on('cb', 'ko').length && (st(ca).mag.pistol > 0)) { await sleep(GUNS.pistol.settle * 1000 + 50); cb(ca, { k: 'fire', d: aim() }); await sleep(150); }
ok(cbb.on('cb', 'ko').length === 1 && st(cbb).hp === 0, 'Cousin goes down at 0');
cb(cbb, { k: 'up' }); await sleep(200);
ok(/Not yet/.test(lastNo(cbb)), 'no instant respawn');
await sleep(RESPAWN_MS);
const fixes = cbb.on('fix').length; cb(cbb, { k: 'up' });
ok(await waitFor(() => cbb.on('fix').length > fixes) && cbb.on('fix').at(-1).why === 'respawn' && st(cbb).hp === HP, 'back at the arrival stone with full health');
cb(ca, { k: 'dev', risk: 'safe' }); await sleep(100); cb(ca, { k: 'fire', d: aim() }); await sleep(200);
ok(/Holstered/.test(lastNo(ca)), 'no shooting in a safe region');

// ---- raids on build pieces
pose(cbb, cbb.pos.x, cbb.pos.z); await sleep(200);
await walk(cbb, town.x - 6, town.z - 4, 7); await walk(ca, town.x - 6, town.z - 6, 7);
send(cbb, { t: 'e', k: 'build', tile: '', op: 'place', id: 'lw' + tag, lid: 'lw' + tag, piece: ['wall', 'wood', town.x - 6, 0, town.z - 5, 0] });
ok(await waitFor(() => cbb.on('e').some((m) => m.k === 'build' && m.id === 'lw' + tag)), 'Cousin builds a wooden wall');
cb(ca, { k: 'eq', w: 'crowbar' }); await sleep(800);
cb(ca, { k: 'sw', piece: 'lw' + tag }); await sleep(250);
ok(/Nobody raids here/.test(lastNo(ca)), 'safe ground: no raids');
cb(ca, { k: 'dev', risk: 'guarded' }); await sleep(800); cb(ca, { k: 'sw', piece: 'lw' + tag }); await sleep(250);
ok(/Nobody raids here/.test(lastNo(ca)), 'guarded ground: no raids');
cb(cbb, { k: 'sw', piece: 'lw' + tag }); await sleep(250);
ok(/Your own/.test(lastNo(cbb)), 'your own piece: take it down with the kit');
cb(ca, { k: 'dev', risk: 'contested' }); await sleep(800); cb(ca, { k: 'sw', piece: 'lw' + tag }); await sleep(300);
const ph = ca.on('cb', 'ph').at(-1);
ok(ph && ph.id === 'lw' + tag && ph.left < 1 && cbb.on('cb', 'raid').length === 1, `contested, builder on: the wall takes it (${ph?.left} left) and Cousin is told`);
cb(cbb, { k: 'fix', piece: 'lw' + tag }); await sleep(300);
ok(ca.on('cb', 'ph').at(-1).left > ph.left, 'the builder patches it');
cb(ca, { k: 'dev', risk: 'wild' }); let swings = 0;
while (!ca.on('e').some((m) => m.k === 'build' && m.op === 'remove' && m.id === 'lw' + tag) && swings < 40) { await sleep(800); cb(ca, { k: 'sw', piece: 'lw' + tag }); swings++; }
ok(ca.on('e').some((m) => m.k === 'build' && m.op === 'remove' && m.id === 'lw' + tag), `wild ground: the wall breaks after ${swings} crowbar swings (wood ${PIECE_J.wood} J)`);

// ---- bad intents are answered, never a kick
for (const m of [{ k: 'zap' }, { k: 'fire', d: 'x' }, { k: 'sw', id: 7 }, { k: 'eq', w: { a: 1 } }, { k: 'fix', piece: 3 }]) cb(ca, m);
await sleep(400);
ok(ca.ws.readyState === 1, 'junk combat messages never close the socket');
ca.ws.close(); cbb.ws.close();
console.log(fails ? `loop: ${fails} failed` : 'loop: ALL PASSED');
process.exit(fails ? 1 : 0);

// node tests/factions-sim.test.mjs — memory, perception, gossip, couriers and trackers (no reputation numbers)
import { readFileSync } from 'node:fs';
import { createScene, createSim, perceive, heardDb, transitMs, mind, pos, migrateScene } from '../js/factions/sim.js';
const DX = JSON.parse(readFileSync(new URL('../js/factions/factions.json', import.meta.url), 'utf8'));
// the sim's rules don't depend on where the camps stand: run them at the scene's own coordinates (offset 0, as
// before Xenia moved the camps out of the garden); the offset itself is checked at the end
const D = { ...DX, scenes: { ...DX.scenes, home: { ...DX.scenes.home, offset: [0, 0] } } };
const A = []; const ok = (c, m) => { A.push([c, m]); console.log(c ? ' ok ' : 'FAIL', m); };
const T0 = Date.UTC(2026, 10, 25, 20, 0, 0);
const fresh = (kind = 'home', o = {}) => { const st = createScene(D, kind); const sim = createSim(D, st, { world: 'home:' + 'a'.repeat(32), ...o }); sim.advance(T0); return sim; };
const me = 'f'.repeat(32), you = 'e'.repeat(32);
// walk a player along a straight line, posing every 0.5 s (footprints) and advancing the world
function walk(sim, aid, from, to, t, speed = 1.4) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]), secs = d / speed;
  for (let s = 0; s <= secs; s += 0.5) { const k = Math.min(1, s / secs); sim.pose(aid, from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, t + s * 1000); sim.advance(t + s * 1000); }
  return t + secs * 1000 + 500;
}

// --- physics of the senses
ok(heardDb(D, 58, 40) > D.senses.hearDb && heardDb(D, 58, 120) < D.senses.hearDb, 'a struggle carries ~40 m, not 120 m');
ok(heardDb(D, 58, 2, 0) === -Infinity, 'no air, no sound (moon)');
{
  const sim = fresh(); const st = sim.st; st.occ = []; const n = st.npcs['w-oskar'];
  const p = pos(st, n, T0);
  const ahead = { x: p.x + Math.sin(p.yaw) * 20, z: p.z + Math.cos(p.yaw) * 20 }, behind = { x: p.x - Math.sin(p.yaw) * 12, z: p.z - Math.cos(p.yaw) * 12 };
  ok(perceive(D, st, n, ahead, 20, T0) === 'saw', 'sees a quiet act in front of him');
  ok(perceive(D, st, n, behind, 20, T0) === null, 'misses a quiet act behind his back');
  ok(perceive(D, st, n, behind, 46, T0) === 'heard', 'hears a loud one behind his back');
}

// --- helping Sela: she remembers, walks home at a limp, and the camp learns it from HER (contact), not instantly
{
  const sim = fresh(); const st = sim.st; let t = T0 + 1000;
  const sela = st.npcs['w-sela'], maren = st.npcs['w-maren'];
  t = walk(sim, me, [-30, -20], [-40.2, -13.6], t);
  const r = sim.act(me, 'help', 'w-sela', { x: -40.2, z: -13.6 }, t, 'Brock');
  ok(r.ok && r.seen.some((s) => s.id === 'w-sela'), 'help: Sela knows who helped her');
  ok(mind(D, st, sela, me, t).stance === 'grateful', 'Sela is grateful (she remembers being helped)');
  ok(mind(D, st, maren, me, t).stance === 'stranger', 'Maren at camp does not know yet');
  const far = sim.act(me, 'help', 'w-sela', { x: 0, z: 0 }, t + 10, 'Brock');
  ok(!far.ok, 'cannot help again / from afar (state + reach checked)');
  const dist = Math.hypot(sela.home[0] - (-41), sela.home[1] - (-14));
  const eta = dist / D.travel.limp * 1000;
  sim.advance(t + eta * 0.5);
  ok(mind(D, st, maren, me, t + eta * 0.5).stance === 'stranger', `halfway home (${Math.round(eta / 1000)} s limp): camp still does not know`);
  sim.advance(t + eta + 5000);
  ok(mind(D, st, maren, me, t + eta + 5000).stance === 'friendly', 'Sela got home and told them: Maren is friendly');
  const tk = sim.talk('w-maren', me, t + eta + 6000, {});
  ok(tk.offers.includes('teach') && /Sela told me/.test(tk.lines.join(' ')), 'Maren will teach, and says who told her: ' + tk.lines[0]);
  const og = sim.talk('w-oskar', me, t + eta + 6000, {});
  ok(og.offers.includes('gate'), 'Oskar opens the gate');
}

// --- killing Brann where nobody sees: the camp only hears it; Kesh finds the body + fresh tracks and hunts you
{
  const sim = fresh(); const st = sim.st; let t = T0 + 1000;
  const brann = st.npcs['r-brann'], kesh = st.npcs['r-kesh'], dagna = st.npcs['r-dagna'];
  // wait for Kesh to be far from the gully
  const kAt = (tt) => pos(st, kesh, tt), gully = { x: 10.5, z: 44.2 };
  while (Math.hypot(kAt(t).x - gully.x, kAt(t).z - gully.z) < 45) t += 1000;
  sim.advance(t);
  t = walk(sim, me, [0, 30], [10.2, 43.4], t);
  const r = sim.act(me, 'kill', 'r-brann', { x: 10.2, z: 43.4 }, t, 'Brock');
  ok(r.ok && brann.st === 'dead', 'kill: Brann is dead (body stays where he lay)');
  ok(!r.seen.some((s) => s.knows), 'nobody saw it, nobody close enough to know who: ' + JSON.stringify(r.seen.map((s) => s.name + ':' + s.by)));
  ok(mind(D, st, dagna, me, t).stance === 'stranger', 'Dagna has no idea it was you');
  t = walk(sim, me, [10.2, 43.4], [0, 20], t);
  // Kesh's loop takes him past the gully within a few minutes
  let found = null;
  for (let tt = t; tt < t + 6 * 60e3; tt += 1000) { sim.pose(me, 0, 20, tt); sim.advance(tt); if (mind(D, st, kesh, me, tt).hunts) { found = tt; break; } }
  ok(!!found, `Kesh found the body and your fresh tracks ${found ? Math.round((found - t) / 1000) + ' s' : ''} later, and now hunts you`);
  const fm = st.mem['r-kesh'].find((m) => m.by === 'found');
  ok(fm && fm.s === me, 'his memory: found dead, tracks led away (not "saw")');
  // stand still where the trail ends: he follows the footprints and catches up
  let amb = null, trk = false;
  for (let tt = found; tt < found + 6 * 60e3; tt += 1000) {
    sim.pose(me, 0, 20, tt); sim.advance(tt);
    for (const e of sim.drainEvents()) { if (e.k === 'tracking') trk = true; if (e.k === 'ambush') amb = e; }
    if (amb) break;
  }
  ok(trk, 'he picked up the trail');
  ok(amb && amb.rough, 'he followed it to you and roughed you up (nothing of theirs to seize)');
}

// --- cold trail: if the tracks are older than the scent window he cannot follow
{
  const sim = fresh(); const st = sim.st; const kesh = st.npcs['r-kesh'];
  st.mem['r-kesh'].push({ id: 'x1', s: me, act: 'steal', v: 'cache-reavers', vf: 'reavers', vn: 'the Reavers', by: 'saw', at: T0, t: T0 });
  const p = pos(st, kesh, T0 + 60e3);
  st.trails[me] = [[p.x, p.z, T0 - 60 * 60e3]]; st.last[me] = { x: p.x, z: p.z, t: T0 - 60 * 60e3 };
  sim.advance(T0 + 61e3);
  ok(kesh.mv.k !== 'track', 'an hour-old trail is cold: no tracking');
  (st.trails[me] = st.trails[me] || []).push([pos(st, kesh, T0 + 90e3).x, pos(st, kesh, T0 + 90e3).z, T0 + 85e3]);
  sim.advance(T0 + 91e3);
  ok(kesh.mv.k === 'track', 'a fresh print on his path: he follows');
}

// --- stealing from the reaver cache: what you took is owed; settle it and they call it square
{
  const sim = fresh(); const st = sim.st; let t = T0 + 1000;
  const c = st.caches['cache-reavers'];
  const r = sim.act(me, 'steal', 'cache-reavers', { x: c.x + 1, z: c.z }, t, 'Brock');
  ok(r.ok && r.give && Object.values(r.give)[0] === 2, 'steal: you get 2 of what they had most of');
  ok(st.owed[me] && st.owed[me].reavers, 'it is theirs and they will want it back');
  const knows = r.seen.filter((s) => s.knows).map((s) => s.name);
  console.log('    witnesses who know:', knows.join(', ') || 'none');
}

// --- spoofing: acts must be possible where the authority saw you
{
  const sim = fresh(); const t = T0 + 1000;
  ok(!sim.act(me, 'kill', 'w-maren', { x: -29.5, z: 36.8 }, t).ok, 'cannot "kill" someone who is not downed');
  ok(!sim.act(me, 'free', 'w-tove', { x: 0, z: 0 }, t).ok, 'cannot free the captive from 50 m away');
  ok(!sim.act(me, 'seized', 'r-kesh', { x: 0, z: 0 }, t).ok, 'events are not player acts');
  ok(!sim.act(me, 'return', 'w-ivo', { x: -27, z: 37 }, t).ok, 'cannot return a pack you never picked up');
}

// --- couriers: news leaves on foot, then crosses worlds at ship speed; a fresh outpost elsewhere learns it later
{
  const sim = fresh(); const st = sim.st; let t = T0 + 1000;
  const tove = st.npcs['w-tove'];
  const r = sim.act(me, 'free', 'w-tove', { x: 44.6, z: 29.2 }, t, 'Brock');
  ok(r.ok, 'free Tove');
  let out = [];
  for (let tt = t; tt < t + 40 * 60e3 && !out.length; tt += 5000) { sim.advance(tt); out = sim.drainOut().filter((n) => n.act === 'free' && n.f === 'wardens'); }
  ok(out.length > 0, 'Tove walked home, told the camp, and the courier carried it to the road: ' + (out[0] ? out[0].via : ''));
  const away = createSim(D, createScene(D, 'outpost', { x: 100, z: 100 }), { world: 'moon:' + 'a'.repeat(32) });
  away.advance(T0);
  const hale = away.st.npcs['w-hale'];
  const lag = transitMs(D, 'home:' + 'a'.repeat(32), 'moon:' + 'a'.repeat(32));
  ok(Math.abs(lag / 3600e3 - 3.56) < 0.05, `Earth to Moon by courier ship: ${(lag / 3600e3).toFixed(2)} h`);
  away.receive(out.map((n) => ({ ...n, originName: 'Earth' })), out[0].dep + lag);
  for (let tt = out[0].dep + lag; tt < out[0].dep + lag + 5 * 60e3; tt += 2000) away.advance(tt);
  const m = mind(D, away.st, hale, me, out[0].dep + lag + 5 * 60e3);
  ok(m.stance === 'friendly', 'on the Moon, Hale heard it from the courier: ' + (m.right && m.right.from));
  ok(transitMs(D, 'home:' + 'a'.repeat(32), 'planet:prime:5') === D.travel.jumpHours * 3600e3, 'to another system: a void jump');
}

// --- witnesses who die take the story with them
{
  const sim = fresh(); const st = sim.st; const t = T0 + 1000;
  st.mem['r-brann'].push({ id: 'z', s: me, act: 'steal', v: 'cache-reavers', vf: 'reavers', vn: 'the Reavers', by: 'saw', at: t, t });
  const r = sim.act(me, 'kill', 'r-brann', { x: 10.2, z: 43.4 }, t + 1000);
  ok(r.ok, 'the only witness of the theft is killed');
  sim.advance(t + 30 * 60e3);
  ok(!Object.entries(st.mem).some(([id, l]) => id !== 'r-brann' && l.some((m) => m.id === 'z')), 'nobody else ever learned of the theft');
}
// Xenia: the home camps stand at the scene offset; an old save (camps at the old garden spots) moves with them
{ const off = DX.scenes.home.offset, st = createScene(DX, 'home'), old = createScene(D, 'home');
  ok(Math.abs(st.anchor.x - off[0]) < 0.01 && Math.abs(st.anchor.z - off[1]) < 0.01, 'the home scene stands at its Xenia offset');
  old.packs.test = { x: 5, z: 6 }; old.mem = { x: 1 };
  const m = migrateScene(DX, old);
  ok(m !== old && Math.abs(m.packs.test.x - (5 + off[0])) < 0.01 && m.mem.x === 1, 'an old home scene moves to the offset and keeps its memories');
  ok(migrateScene(DX, m) === m, 'and is migrated only once'); }
const fails = A.filter((x) => !x[0]).length;
console.log(`${A.length - fails}/${A.length} sim checks passed`);
process.exit(fails ? 1 : 0);

// Two headless clients play every compete / co-op mode against a local `wrangler dev` (LOCAL_DEV=1:
// rounds run 8x shorter and a 'dbg' peek reveals the geode for the test). Every score is the server's.
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
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
  for (;;) {
    const p = c.pos, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const s = Math.min(d, speed * 0.1);
    pose(c, +(p.x + dx / d * s).toFixed(3), +(p.z + dz / d * s).toFixed(3), p.yaw);
    await sleep(100);
  }
}
const g = (c, m) => send(c, { t: 'g', ...m });
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); } return false; };
const near = (c, list) => list.slice().sort((a, b) => Math.hypot(a.x - c.pos.x, a.z - c.pos.z) - Math.hypot(b.x - c.pos.x, b.z - c.pos.z))[0];

const tag = Date.now().toString(36);
const A = await signIn(`brock+c${tag}@example.com`, 'Brock');
const B = await signIn(`cousin+c${tag}@example.com`, 'Cousin');
const inv = await api('/invite', {}, A.token);
const red = await api('/invite/redeem', { code: inv.code }, B.token);
ok(red.world === `home:${A.id}`, 'cousin joins Brock\'s world with the invite code');
const ca = await connect((await api('/ticket', { world: `home:${A.id}` }, A.token)).ticket, 'A');
await sleep(200);
const cb = await connect((await api('/ticket', { world: `home:${A.id}` }, B.token)).ticket, 'B');
await sleep(300);
ok(cb.on('hi')[0]?.games === 1 && cb.on('g', 'hello').length === 1, 'server advertises games and sends a hello');
pose(ca, 0, 0); pose(cb, 3, 0); await sleep(300);
await walk(ca, 0.5, 0); await walk(cb, 3.5, 0);
ok(await waitFor(() => ca.on('g', 'keeper').length || ca.on('g', 'hello')[0]?.keeper), 'the stone-keeper camps near where people first walked');

// ---------------- race
g(ca, { k: 'clr' }); await sleep(150);
g(ca, { k: 'ch', mode: 'race', to: B.id }); await sleep(200);
ok(ca.on('g', 'say').some((m) => /Lay at least 2 gates/.test(m.text)), 'a race needs a laid course');
const gatesAt = [[0.5, 0], [0.5, 10], [10.5, 10]];
for (const [x, z] of gatesAt) { await walk(ca, x, z); g(ca, { k: 'gate' }); await sleep(150); }
g(ca, { k: 'gate' }); await sleep(150);
ok(ca.on('g', 'say').some((m) => /Walk at least/.test(m.text)), 'gates must be spaced out');
const course = ca.on('g', 'course').at(-1)?.gates || [];
ok(course.length === 3 && course[2].x === 10.5, `course laid from the server's own positions (${course.length} gates)`);
await walk(ca, 0.5, 0); await walk(cb, 1.5, 0);
g(ca, { k: 'ch', mode: 'race', to: B.id });
ok(await waitFor(() => cb.on('g', 'invite').some((m) => m.mode === 'race')), 'cousin gets the race challenge');
g(cb, { k: 'ac' });
ok(await waitFor(() => cb.g?.phase === 'count'), 'both accepted: countdown starts');
ok(await waitFor(() => cb.g?.phase === 'live', 5000), 'race goes live on the server clock');
await sleep(100);
// B cuts the corner: skips gate 2 and heads to the finish first
const pB = walk(cb, 10.5, 10, 6.5);
await walk(ca, 0.5, 10, 7); await walk(ca, 10.5, 10, 7);
await pB;
await sleep(300);
let gs = ca.g;
ok(gs.players[A.id].fin != null, `Brock finished in ${(gs.players[A.id].fin / 1000).toFixed(2)} s`);
ok(gs.players[B.id].fin == null && gs.players[B.id].gi === 1, 'cutting the corner does not count (gate 2 missed)');
await walk(cb, 0.5, 10, 6); await walk(cb, 10.5, 10, 6);
ok(await waitFor(() => ca.g?.phase === 'done'), 'race ends when everyone has finished');
ok(ca.g?.result?.winner === A.id, 'winner decided by the server (Brock)');
await sleep(300);
const board1 = ca.on('g', 'board').at(-1)?.board || [];
ok(board1.some((r) => r.aid === A.id && r.wins >= 1 && r.best_ms > 0), 'scoreboard has the win and the best time');

// ---------------- stone hunt (compete, with raiding and shoving)
await waitFor(() => !ca.g, 25000);
await walk(ca, 0.5, 0); await walk(cb, 1.5, 1);
g(cb, { k: 'ch', mode: 'hunt' });
await waitFor(() => ca.on('g', 'invite').some((m) => m.mode === 'hunt'));
g(ca, { k: 'ac' });
ok(await waitFor(() => ca.g?.phase === 'live', 6000), 'stone hunt is live');
const far = ca.g.stones.slice().sort((a, b) => Math.hypot(b.x - ca.pos.x, b.z - ca.pos.z) - Math.hypot(a.x - ca.pos.x, a.z - ca.pos.z))[0];
g(ca, { k: 'grab', sid: far.id }); await sleep(250);
ok(ca.g.players[A.id].carry.length === 0 && ca.g.stones.some((s) => s.id === far.id), 'grabbing a stone out of reach is refused');
for (let i = 0; i < 2; i++) { const s = near(ca, ca.g.stones); await walk(ca, s.x, s.z, 7); g(ca, { k: 'grab', sid: s.id }); await sleep(200); }
ok(ca.g.players[A.id].carry.length === 2, 'Brock picked up 2 stones by walking to them');
const myCache = ca.g.caches[A.id];
await walk(ca, myCache.x, myCache.z, 7); g(ca, { k: 'bank' }); await sleep(250);
const scoreA = ca.g.players[A.id].score;
ok(scoreA > 0 && ca.g.caches[A.id].n.length === 2, `banked at his cache for ${scoreA} points (rarer stones score more)`);
// cousin raids Brock's cache
await walk(cb, myCache.x + 0.8, myCache.z, 7); g(cb, { k: 'raid' }); await sleep(250);
ok(cb.g.players[B.id].carry.length === 1 && cb.g.players[A.id].score < scoreA, 'cousin raided a stone from Brock\'s cache');
g(cb, { k: 'raid' }); await sleep(250);
ok(cb.g.players[B.id].carry.length === 1, 'raiding has a cooldown');
// Brock shoves the cousin: knockback + the carried stone falls
const stonesBefore = ca.g.stones.length;
g(ca, { k: 'shove', ago: 50 });
ok(await waitFor(() => cb.on('g', 'kb').length === 1), 'shove lands: cousin gets the knockback from the server');
const kb = cb.on('g', 'kb')[0];
ok(kb.v > 3 && Math.hypot(kb.dx, kb.dz) > 0.9, `knockback points away from Brock (v ${kb.v} m/s)`);
await sleep(200);
ok(cb.g.players[B.id].carry.length === 0 && ca.g.stones.length === stonesBefore + 1, 'the shove knocked the stolen stone loose');
g(ca, { k: 'shove' }); await sleep(250);
ok(cb.on('g', 'kb').length === 1, 'shove cooldown holds');
// knocked-back movement passes the anti-cheat: cousin flies 1.6 m in 0.3 s
const fixesBefore = cb.on('fix').length;
const p0 = cb.pos; pose(cb, p0.x + kb.dx * 0.9, p0.z + kb.dz * 0.9); await sleep(100); pose(cb, p0.x + kb.dx * 1.6, p0.z + kb.dz * 1.6); await sleep(300);
ok(cb.on('fix').length === fixesBefore, 'the knockback slide is not flagged as speed hacking');
await walk(cb, cb.pos.x + 6, cb.pos.z, 6);
await sleep(1300);
g(ca, { k: 'shove' }); await sleep(250);
ok(cb.on('g', 'kb').length === 1, 'a shove from 6 m away does nothing');
ok(await waitFor(() => ca.g?.phase === 'done', 20000), 'hunt ends on the server timer');
ok(ca.g.result.winner === A.id, 'hunt winner is Brock by banked points');

// ---------------- cairn (co-op, hand-over)
await waitFor(() => !ca.g, 25000);
await walk(ca, 0.5, 0); await walk(cb, 1.5, 0);
g(ca, { k: 'ch', mode: 'cairn' });
await waitFor(() => cb.on('g', 'invite').some((m) => m.mode === 'cairn'));
g(cb, { k: 'ac' });
ok(await waitFor(() => ca.g?.phase === 'live', 6000), `cairn is live (goal ${ca.g?.cairn?.goal} stones together)`);
const goal = ca.g.cairn.goal;
// cousin gathers and hands stones to Brock, who carries them to the cairn
for (let i = 0; i < 2; i++) { const s = near(cb, cb.g.stones); await walk(cb, s.x, s.z, 7); g(cb, { k: 'grab', sid: s.id }); await sleep(200); }
await walk(ca, cb.pos.x + 1, cb.pos.z, 7);
g(cb, { k: 'give', to: A.id }); await sleep(200); g(cb, { k: 'give', to: A.id }); await sleep(250);
ok(ca.g.players[A.id].carry.length === 2 && ca.g.players[B.id].carry.length === 0, 'cousin handed 2 stones to Brock');
await walk(ca, ca.g.cairn.x, ca.g.cairn.z, 7); g(ca, { k: 'bank' }); await sleep(250);
ok(ca.g.cairn.n === 2, 'the shared cairn grows');
while (ca.g && ca.g.phase === 'live' && ca.g.cairn.n < goal) { const s = near(ca, ca.g.stones); await walk(ca, s.x, s.z, 7); g(ca, { k: 'grab', sid: s.id }); await sleep(150); await walk(ca, ca.g.cairn.x, ca.g.cairn.z, 7); g(ca, { k: 'bank' }); await sleep(200); }
ok(await waitFor(() => ca.g?.phase === 'done'), 'cairn round closes');
ok(ca.g?.result?.team === true, `team raised the cairn (${ca.g?.result?.cairn}/${goal})`);

// ---------------- sparring ring
await waitFor(() => !ca.g, 25000);
await walk(ca, 0.5, 0); await walk(cb, 2, 0);
g(ca, { k: 'ch', mode: 'ring', to: B.id });
await waitFor(() => cb.on('g', 'invite').some((m) => m.mode === 'ring'));
g(cb, { k: 'ac' });
ok(await waitFor(() => ca.g?.phase === 'wait' || ca.g?.phase === 'count'), 'ring waits for both inside');
await walk(ca, 0.6, 0);
ok(await waitFor(() => ca.g?.phase === 'live', 6000), 'sparring round 1 live');
await walk(cb, 7, 0, 6);
ok(await waitFor(() => ca.g?.players?.[A.id]?.wins === 1), 'cousin stepped out: round to Brock');
await walk(cb, 2, 0, 6); await walk(ca, 0.7, 0);
ok(await waitFor(() => ca.g?.phase === 'live', 8000), 'round 2 live after both are back inside');
await walk(cb, 7, 0, 6);
ok(await waitFor(() => ca.g?.phase === 'done'), 'best of three decided');
ok(ca.g?.result?.winner === A.id, 'sparring winner Brock');

// ---------------- Easter egg: the standoff
await waitFor(() => !ca.g, 25000);
await walk(ca, 0, 0); await walk(cb, 1.0, 0);
pose(ca, 0.01, 0); // a tiny shuffle starts the hold
ok(await waitFor(() => ca.on('g', 'egg').some((m) => m.e === 'standoff'), 7000), 'Easter egg: standing face to face, still, starts a standoff');
await sleep(900);
await walk(cb, 1.6, 0);
ok(await waitFor(() => ca.on('g', 'egg').some((m) => m.e === 'standoff-end' && m.winner === A.id)), 'cousin moved first: standoff to Brock');

// ---------------- the stone-keeper quest + the hidden geode
g(ca, { k: 'dbg' }); g(cb, { k: 'dbg' }); await sleep(200);
const dbg = ca.on('g', 'dbg').at(-1);
ok(dbg && dbg.geode && dbg.keeper, 'geode and keeper are placed (test peek, local dev only)');
await walk(ca, dbg.keeper.x - 1, dbg.keeper.z, 7); g(ca, { k: 'talk' });
await walk(cb, dbg.keeper.x + 1, dbg.keeper.z, 7); g(cb, { k: 'talk' });
ok(await waitFor(() => ca.on('g', 'npc').some((m) => m.quest === 1) && cb.on('g', 'npc').some((m) => m.quest === 1)), 'Ula gives both the geode quest');
await walk(ca, dbg.geode.x + 6, dbg.geode.z, 7);
await walk(ca, dbg.geode.x, dbg.geode.z, 3);
ok(ca.on('g', 'warm').length >= 1, 'walking closer gives a glint hint');
ok(await waitFor(() => cb.on('g', 'egg').some((m) => m.e === 'geode' && m.id === A.id)), 'Brock found the hidden geode (everyone is told)');
await walk(ca, dbg.keeper.x - 1, dbg.keeper.z, 7); g(ca, { k: 'talk' });
ok(await waitFor(() => ca.on('g', 'npc').some((m) => m.quest === 3)), 'quest complete for Brock, with the real geology');
ok(await waitFor(() => cb.on('g', 'npc').some((m) => m.quest === 3)), 'co-op credit: the cousin standing with him completes it too');
g(ca, { k: 'board' }); await sleep(300);
const fin = ca.on('g', 'board').at(-1).board;
const ra = fin.find((r) => r.aid === A.id), rb = fin.find((r) => r.aid === B.id);
ok(ra && ra.eggs >= 2 && ra.quests === 1 && rb && rb.quests === 1, `final board: Brock ${ra?.wins} wins, ${ra?.eggs} eggs; cousin ${rb?.wins} wins, ${rb?.cairns} cairns`);
ok(!ca.on('fix').length || ca.on('fix').every((f) => f.why !== 'teleport'), 'no false teleport flags all session');
ok(ca.ws.readyState === 1 && cb.ws.readyState === 1, 'both still connected (never kicked)');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
ca.ws.close(); cb.ws.close();
process.exit(fails ? 1 : 0);

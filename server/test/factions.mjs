// Factions end to end against a local `wrangler dev` (LOCAL_DEV=1: news crosses worlds FA_TIME_SCALE times faster).
// Two players in A's home: B helps the hurt warden, A robs the warden cache in front of the gatekeeper. Checks the
// server decides (reach, state, spoofed acts flagged), memories travel by contact (B is only trusted at camp once
// Sela has limped home and told them), what Maren teaches B persists, and news of A's theft is carried by the
// courier off the world and reaches A's Moon only after the ship has had time to get there.
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
function connect(ticket) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`);
    const c = { ws, msgs: [], closed: null, seq: 0, on: (t) => c.msgs.filter((m) => m.t === t), fa: (k) => c.msgs.filter((m) => m.t === 'fa' && m.k === k) };
    ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
    ws.onclose = (e) => { c.closed = { code: e.code, reason: e.reason }; };
    ws.onopen = () => res(c);
    ws.onerror = () => rej(new Error('ws error'));
  });
}
const send = (c, m) => { if (m.t === 'p') { c.seq++; m.s = c.seq; } c.ws.send(JSON.stringify(m)); };
async function walk(c, from, to, speed = 2.8) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(1, Math.ceil(d / (speed * 0.1)));
  for (let i = 1; i <= n; i++) { send(c, { t: 'p', x: from[0] + (to[0] - from[0]) * i / n, y: 0, z: from[1] + (to[1] - from[1]) * i / n, yaw: 0 }); await sleep(100); }
  return to;
}
async function ask(c, m, k, ms = 3000) {
  const before = c.fa(k).length; send(c, { t: 'fa', ...m });
  const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c.fa(k).length > before) return c.fa(k).at(-1); await sleep(50); }
  return null;
}
const stanceOf = (c, id) => c.fa('view').at(-1)?.view.npcs.find((n) => n.id === id)?.stance;
async function waitFor(fn, ms, every = 1500, tick = null) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (tick) await tick(); if (await fn()) return Date.now() - t0; await sleep(every); } return null; }

const tag = Date.now().toString(36);
const A = await signIn(`brock+fa${tag}@example.com`, 'Brock');
const B = await signIn(`cousin+fa${tag}@example.com`, 'Cousin');
await api('/friends/request', { name: B.name, tag: B.tag }, A.token);
await api('/friends/respond', { id: A.id, accept: true }, B.token);
const home = `home:${A.id}`;
let ca = await connect((await api('/ticket', { world: home }, A.token)).ticket);
let cb = await connect((await api('/ticket', { world: (await api('/join-friend', { id: A.id }, B.token)).world }, B.token)).ticket);
await sleep(400);
ok(ca.on('hi')[0]?.fa === 1 && cb.on('hi')[0]?.fa === 1, 'server offers factions in hi (fa:1); older clients just ignore it');
ok(!ca.msgs.some((m) => m.t === 'fa'), 'nothing faction-related is sent before a client says hello (old clients never see t:fa)');

// positions first (the first pose is free), then hello
let pa = [0, 6], pb = [-39.6, -13.2];
send(ca, { t: 'p', x: pa[0], y: 0, z: pa[1], yaw: 0 }); send(cb, { t: 'p', x: pb[0], y: 0, z: pb[1], yaw: 0 });
await sleep(300);
send(cb, { t: 'fa', k: 'act', act: 'help', id: 'w-sela' }); await sleep(300);
ok(!cb.fa('did').length, 'an act before hello is ignored (and costs a strike)');
const va = await ask(ca, { k: 'hello' }, 'view'), vb = await ask(cb, { k: 'hello' }, 'view');
ok(va && va.view.npcs.length === 10 && va.view.kind === 'home', `A sees the home scene: ${va?.view.npcs.map((n) => n.name).join(', ')}`);
ok(vb && vb.view.npcs.every((n) => n.stance === 'stranger' || n.stance === 'gone'), 'to B everyone is a stranger (no memories of B yet)');
ok(Array.isArray(vb.known) && !vb.known.length, 'B knows no crafts yet');

// B helps Sela; she remembers B. A tries to free Tove from 50 m away (spoof)
let r = await ask(cb, { k: 'act', act: 'help', id: 'w-sela' }, 'did');
ok(r?.ok && r.seen.some((s) => s.name === 'Sela' && s.by === 'saw'), `B helped Sela; who knows: ${r?.seen.map((s) => `${s.name} (${s.by})`).join(', ')}`);
const tHelp = Date.now();
r = await ask(ca, { k: 'act', act: 'free', id: 'w-tove' }, 'did');
ok(r && !r.ok && r.why === 'too-far', 'A cannot free the captive from across the map (server checks reach where IT saw A)');
r = await ask(ca, { k: 'act', act: 'kill', id: 'w-maren' }, 'did');
ok(r && !r.ok, 'A cannot "kill" a warden who is not downed (state checked)');
send(ca, { t: 'fa', k: 'act', act: 'teleport-loot', id: 'cache-wardens' }); await sleep(300);
ok(!ca.closed, 'made-up acts are struck, not crashed on');

// A walks to the warden cache and robs it in front of Oskar
pa = await walk(ca, pa, [-34.4, 38.2]);
await sleep(800);
r = await ask(ca, { k: 'act', act: 'steal', id: 'cache-wardens' }, 'did');
ok(r?.ok && r.give && r.seen.some((s) => s.name === 'Oskar'), `A stole ${JSON.stringify(r?.give)}; seen by: ${r?.seen.map((s) => `${s.name} (${s.by})`).join(', ')}`);
await sleep(1300);
const ga = await ask(ca, { k: 'gate', id: 'w-oskar' }, 'gate');
ok(ga && ga.open === false, 'Oskar keeps the gate shut for A');
await sleep(300);
const ta = await ask(ca, { k: 'talk', id: 'w-oskar' }, 'talk');
ok(ta && /I saw you/.test(ta.lines.join(' ')), `Oskar says why: ${ta?.lines.join(' ')}`);

// B walks to camp. Maren only trusts B once Sela has limped home and told her (contact, not broadcast)
pb = await walk(cb, pb, [-30.2, 35.0]);
await sleep(1300);
let tm = await ask(cb, { k: 'talk', id: 'w-maren' }, 'talk');
const early = tm && !tm.offers.includes('teach');
ok(early, `right after: Maren does not know B yet (${tm?.stance})`);
const dt = await waitFor(async () => { await sleep(1300); tm = await ask(cb, { k: 'talk', id: 'w-maren' }, 'talk'); return tm && tm.offers.includes('teach'); }, 180e3, 2000, async () => { send(cb, { t: 'p', x: pb[0] + Math.random() * 0.05, y: 0, z: pb[1], yaw: 0 }); });
ok(dt != null, `Maren will teach B ${Math.round((Date.now() - tHelp) / 1000)} s after the help (Sela limped ~51 m home first): "${tm?.lines[0]}"`);
await sleep(800);
const tt = await ask(cb, { k: 'learn', id: 'w-maren' }, 'taught');
ok(tt?.ok && tt.skill === 'tracking', 'Maren teaches B to read tracks');
await sleep(800);
const gb = await ask(cb, { k: 'gate', id: 'w-oskar' }, 'gate');
ok(gb?.open === true, 'Oskar opens the gate for B');

// reload: B reconnects; the craft and the camp's memory are still there
cb.ws.close(); await sleep(11000);
cb = await connect((await api('/ticket', { world: home }, B.token)).ticket); await sleep(300);
send(cb, { t: 'p', x: pb[0], y: 0, z: pb[1], yaw: 0 }); await sleep(300);
const vb2 = await ask(cb, { k: 'hello' }, 'view');
ok(vb2?.known?.some((k) => k.kind === 'tracking' && k.npc === 'Maren'), 'after a reload B still knows tracking (D1, per player)');
ok(['friendly', 'grateful'].includes(vb2?.view.npcs.find((n) => n.id === 'w-maren').stance), 'and Maren still remembers (world memory persists)');

// A's theft leaves with the courier; A goes to the Moon. The outpost there learns only when the ship gets in.

const tSteal = Date.now();
ca.ws.close(); await sleep(11000);
const moon = `moon:${A.id}`;
ca = await connect((await api('/ticket', { world: moon }, A.token)).ticket); await sleep(300);
send(ca, { t: 'p', x: 0, y: 0, z: 0, yaw: 0 }); await sleep(300);
const vm = await ask(ca, { k: 'hello' }, 'view');
ok(vm?.view.kind === 'outpost' && vm.view.npcs.some((n) => n.name === 'Hale'), 'on the Moon: a warden outpost near where A landed');
ok(vm.view.npcs.find((n) => n.id === 'w-hale').stance === 'stranger', 'Hale has not heard anything yet');
pa = await walk(ca, [0, 0], [vm.view.anchor.x + 2.2, vm.view.anchor.z - 3.2]);
let th = null;
const dm = await waitFor(async () => { th = await ask(ca, { k: 'talk', id: 'w-hale' }, 'talk'); return th && th.stance === 'wary'; }, 200e3, 2500, async () => { send(ca, { t: 'p', x: pa[0] + Math.random() * 0.05, y: 0, z: pa[1], yaw: 0 }); send(ca, { t: 'fa', k: 'look' }); });
ok(dm != null, `Hale turns wary ${Math.round((Date.now() - tSteal) / 1000)} s after A left Earth (courier walk + Earth-Moon ship at dev speed): "${th?.lines[0]}"`);
ok(/courier|Runa/.test(th?.lines.join(' ') || ''), 'and says how he knows');
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'all factions checks passed');
process.exit(fails ? 1 : 0);

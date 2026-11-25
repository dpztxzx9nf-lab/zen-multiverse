// End-to-end check against a local `wrangler dev` (MAIL_MODE=dev): two accounts sign in with email codes,
// become friends, one invites the other home, both connect, move, chat; then the anti-cheat and
// moderation paths are poked (speed hack, teleport, bounds, flood, filter, block, bad ticket).
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
    const c = { ws, msgs: [], closed: null, on: (t) => c.msgs.filter((m) => m.t === t) };
    ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
    ws.onclose = (e) => { c.closed = { code: e.code, reason: e.reason }; };
    ws.onopen = () => res(c);
    ws.onerror = (e) => rej(new Error('ws error'));
  });
}
// like the real client: number every move, and after a correction confirm it (r = fix id)
const send = (c, m) => {
  if (m.t === 'p') { c.seq = (c.seq || 0) + 1; m.s = c.seq; const f = c.msgs.filter((x) => x.t === 'fix').at(-1); if (f && f.id !== c.acked) { c.acked = f.id; m.x = f.x ?? m.x; m.y = f.y ?? m.y; m.z = f.z ?? m.z; } if (c.acked) m.r = c.acked; }
  c.ws.send(JSON.stringify(m));
};

const tag = Date.now().toString(36);
const A = await signIn(`brock+${tag}@example.com`, 'Brock');
const B = await signIn(`mom+${tag}@example.com`, 'Garden Mom');
ok(A.token && B.token && A.id !== B.id, `two accounts signed in (${A.name}#${A.tag}, ${B.name}#${B.tag})`);
ok((await api('/auth/verify', { email: `x+${tag}@example.com`, code: '000000', name: 'X' })).status === 401, 'wrong / unrequested code is refused');
ok((await api('/me', null, 'nottoken')).status === 401, 'bad session token is refused');
ok((await api('/auth/start', { email: `t+${tag}@example.com`, turnstile: '' })).status === 403, 'sign-up without a Turnstile token is refused');

// friends
await api('/friends/request', { name: B.name, tag: B.tag }, A.token);
const inc = await api('/friends', null, B.token);
ok(inc.incoming.some((f) => f.id === A.id), 'B sees A\'s friend request');
await api('/friends/respond', { id: A.id, accept: true }, B.token);
const fa = await api('/friends', null, A.token);
ok(fa.friends.some((f) => f.id === B.id), 'A and B are friends');

// strangers can't walk into A's home without being a friend / invite holder
const C = await signIn(`stranger+${tag}@example.com`, 'Stranger');
ok((await api('/ticket', { world: `home:${A.id}` }, C.token)).status === 403, 'a stranger cannot get a ticket to A\'s garden');
const inv = await api('/invite', {}, A.token);
ok(/^[0-9A-Z]{8}$/.test(inv.code), `A made invite code ${inv.code}`);
const red = await api('/invite/redeem', { code: inv.code.toLowerCase() }, C.token);
ok(red.world === `home:${A.id}`, 'invite code lets C in (case-insensitive)');

// A goes home, B joins A via the friend list
const ta = await api('/ticket', { world: `home:${A.id}` }, A.token);
const ca = await connect(ta.ticket);
await sleep(300);
const jf = await api('/join-friend', { id: A.id }, B.token);
ok(jf.world === `home:${A.id}`, 'B can "join friend" and gets A\'s world');
const tb = await api('/ticket', { world: jf.world }, B.token);
const cb = await connect(tb.ticket);
await sleep(300);
ok(cb.on('hi')[0]?.others.some((o) => o.id === A.id), 'B\'s welcome lists A in the world');
ok(ca.on('join').some((j) => j.id === B.id && j.name === 'Garden Mom'), 'A is told B joined, with the server-side name');
const replay = await connect(tb.ticket).then((c) => sleep(200).then(() => c)).catch(() => null);
ok(!replay || replay.closed || !replay.on('hi').length, 'a used ticket cannot be replayed');

// movement: legit walk at run speed for 2 s
let x = 0, z = 6;
send(ca, { t: 'p', x, y: 0, z, yaw: 0 });
for (let i = 0; i < 20; i++) { await sleep(100); x += 0.3; send(ca, { t: 'p', x, y: 0, z, yaw: 1 }); }
await sleep(300);
const seen = cb.on('p').filter((p) => p.id === A.id);
ok(seen.length >= 18 && Math.abs(seen.at(-1).x - x) < 0.01, `B saw A walk (${seen.length} updates, last x=${seen.at(-1)?.x})`);
ok(!ca.on('fix').length, 'a legit walk is never corrected');
ok(ca.on('a').length > 0 && ca.on('a').at(-1).s > 10, `server acks accepted moves for reconciliation (last ack seq ${ca.on('a').at(-1)?.s})`);

// chat + filter
send(cb, { t: 'c', text: 'hi honey, love the pond' });
send(cb, { t: 'c', text: 'you are a b1tch' }); await sleep(1300);
send(cb, { t: 'c', text: 'add me on discord' });
await sleep(400);
const chats = ca.on('c').map((c) => c.text);
ok(chats.includes('hi honey, love the pond'), 'chat reaches the other player');
ok(chats.includes('you are a *****') && !chats.some((t) => /b1tch/.test(t)), 'swears are masked server-side');
ok(!chats.some((t) => /discord/i.test(t)) && cb.on('sys').length > 0, 'contact sharing is blocked with a calm note');
send(cb, { t: 'c', text: 'x'.repeat(5000) }); await sleep(300);
ok(cb.closed?.code === 1009, 'an oversize message closes the socket');

// speed hack: 3x run speed
const tb2 = await api('/ticket', { world: jf.world }, B.token); const cb2 = await connect(tb2.ticket); await sleep(200);
// a raw cheat client that never confirms corrections: its moves after the first fix are ignored
const raw = (m) => { ca.seq++; ca.ws.send(JSON.stringify({ ...m, s: ca.seq })); };
for (let i = 0; i < 10; i++) { await sleep(100); x += 1.4; raw({ t: 'p', x, y: 0, z, yaw: 1 }); }
await sleep(300);
const fixes = ca.on('fix');
ok(fixes.length > 0, `speed hack is corrected (${fixes.length} snap-backs, why=${fixes[0]?.why})`);
const lastSeen = cb2.on('p').filter((p) => p.id === A.id).at(-1);
ok(!lastSeen || lastSeen.x < x - 5, `others never see the hacked position (seen x=${lastSeen?.x}, hacked x=${x.toFixed(1)})`);
ok(ca.on('fix').length === 1, 'moves still in flight after a correction are ignored, not double-punished');
// teleport + bounds (now confirming corrections, so each one is checked again)
send(ca, { t: 'p', x: 13, y: 0, z, yaw: 0 }); await sleep(150);
send(ca, { t: 'p', x: 40, y: 0, z: 40, yaw: 0 }); await sleep(200);
ok(ca.on('fix').some((f) => f.why === 'teleport' || f.why === 'bounds'), 'teleport is refused');
send(ca, { t: 'p', x: 13, y: 0, z, yaw: 0 }); await sleep(150);
send(ca, { t: 'p', x: 9999, y: 0, z: 0, yaw: 0 }); await sleep(200);
ok(ca.on('fix').some((f) => f.why === 'bounds'), 'out-of-world position is refused');
for (let i = 0; i < 3; i++) { send(ca, { t: 'p', x: 13, y: 0, z, yaw: 0 }); await sleep(120); send(ca, { t: 'p', x: 60, y: 0, z: 60, yaw: 0 }); await sleep(120); }
await sleep(300);
ok(ca.closed?.code === 4003, `repeat cheating gets kicked (close ${ca.closed?.code} ${ca.closed?.reason})`);

// session resume: drop the socket, reconnect with resume:true -> server puts her back where it last accepted her
const tr1 = await api('/ticket', { world: `home:${B.id}` }, B.token); const r1 = await connect(tr1.ticket); await sleep(150);
send(r1, { t: 'p', x: 2, y: 0, z: 3, yaw: 0 }); for (let i = 1; i <= 5; i++) { await sleep(100); send(r1, { t: 'p', x: 2 + i * 0.3, y: 0, z: 3, yaw: 0 }); }
await sleep(200); r1.ws.close(); await sleep(400);
const tr2 = await api('/ticket', { world: `home:${B.id}`, resume: true }, B.token); const r2 = await connect(tr2.ticket); await sleep(300);
const hiR = r2.on('hi')[0];
ok(hiR && hiR.resume && Math.abs(hiR.resume.x - 3.5) < 0.01, `reconnect resumes at the server's last spot (${JSON.stringify(hiR?.resume)})`);
send(r2, { t: 'p', x: 30, y: 0, z: 3, yaw: 0 }); await sleep(200);
ok(r2.on('fix').some((f) => f.why === 'teleport' || f.why === 'speed'), 'a resumed session can\'t jump away from that spot');
r2.ws.close();

// flood
const ta3 = await api('/ticket', { world: `home:${A.id}` }, A.token); const ca3 = await connect(ta3.ticket); await sleep(200);
for (let i = 0; i < 200; i++) ca3.ws.send('{"t":"hb"}');
await sleep(500);
ok(ca3.closed?.code === 4008, 'message flood closes the socket');

// block: after B blocks A, A's chat no longer reaches B
const ta4 = await api('/ticket', { world: `home:${A.id}` }, A.token); const ca4 = await connect(ta4.ticket); await sleep(200);
await api('/block', { id: A.id }, B.token); await sleep(200);
const before = cb2.on('c').length;
send(ca4, { t: 'c', text: 'can you see this' }); await sleep(400);
ok(cb2.on('c').length === before, 'blocked player\'s chat is not delivered');
ok((await api('/ticket', { world: `home:${A.id}` }, B.token)).status === 403, 'blocking also closes A\'s garden to B');
ok((await api('/report', { id: A.id, reason: 'chat' }, B.token)).ok, 'report filed with chat context');

// forged ticket
const bad = ta4.ticket.slice(0, -3) + 'AAA';
const fc = await connect(bad).then(() => 'opened').catch(() => 'refused');
ok(fc === 'refused', 'a forged ticket cannot open a socket');
// planet shards are public
const tp = await api('/ticket', { world: 'planet:prime:8' }, C.token);
ok(!!tp.ticket, 'anyone signed in can enter a public planet');
ok((await api('/ticket', { world: 'planet:evil:8' }, C.token)).status === 400, 'unknown world keys are refused');

for (const c of [ca, cb, cb2, ca3, ca4]) try { c.ws.close(); } catch { /* */ }
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);

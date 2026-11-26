# Two headless browsers play the compete / co-op / vault build against a local `wrangler dev` (port 8787,
# LOCAL_DEV=1). Serves the repo on 8090 and writes shots/compete-*.png. Run when the box is quiet.
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.environ.get('MG_DIR', '/workspace/mp-zen'); OUT = ROOT + '/shots/'
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mp=1&device=tablet&mode=walk&hour=16.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&qlevel=8'
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8090', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
errors = []
ONLY = set(filter(None, os.environ.get('SHOTS', '').split(',')))
HELP = r"""
window.__w = {
  P: () => __garden.game.player,
  walk(x, z, sp = 6) { return new Promise((res) => { const P = this.P(); const id = setInterval(() => { const p = P.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 0.08) { clearInterval(id); res(1); return; } const s = Math.min(d, sp * 0.1); P.teleport(p.x + dx / d * s, p.z + dz / d * s, Math.atan2(dx, dz) + Math.PI); }, 100); }); },
  look(x, y, z) { const P = this.P(); P.lookAtPoint(x, y, z); P.snapCamera(); return 1; },
  g: (o) => __net.games.send(o),
  S: () => __net.games.state,
};
"""
async def page(b, who):
    ctx = await b.new_context(viewport={'width': 1024, 'height': 576})
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'[{who}] {m.type}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'[{who}] PAGEERROR {e}'))
    await pg.goto('http://127.0.0.1:8090/' + Q, wait_until='commit', timeout=600000)
    await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__net", timeout=600000, polling=1000)
    await pg.wait_for_timeout(2000)
    await pg.evaluate(HELP)
    return pg
async def ev(pg, js, label=None):
    r = await pg.evaluate(js)
    if label: print(label, json.dumps(r)[:300], flush=True)
    return r
async def shot(pg, name):
    if ONLY and name not in ONLY: return
    await pg.wait_for_timeout(1500)
    await pg.screenshot(path=OUT + f'compete-{name}.png', timeout=300000); print('shot', name, flush=True)
async def run():
    tag = str(int(time.time()))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        A = await page(b, 'A'); B = await page(b, 'B')
        await ev(A, f"__net.signInDev('brock+{tag}@example.com','Brock').then(r=>r.account.name)", 'A')
        await ev(B, f"__net.signInDev('cousin+{tag}@example.com','Cousin').then(r=>r.account.name)", 'B')
        await ev(A, "(()=>{const P=__w.P();P.teleport(-1.6,4.2,0);P.snapCamera();return 1})()")
        await ev(B, "(()=>{const P=__w.P();P.teleport(-3.2,7.4,0);P.snapCamera();return 1})()")
        code = await ev(A, "__net.api('/invite',{}).then(r=>r.code)", 'invite')
        await ev(B, f"__net.redeem('{code}').then(r=>r.world)", 'B joined')
        await A.wait_for_function("__net.state.open && __net.state.n>=2 && __net.games", timeout=120000, polling=500)
        await B.wait_for_function("__net.state.open && __net.state.n>=2 && __net.games", timeout=120000, polling=500)
        await ev(A, "__w.walk(-1.2,4.6)"); await ev(B, "__w.walk(-2.8,7.0)")
        await A.wait_for_function("__w.S().keeper", timeout=60000, polling=500)
        dbg = await ev(A, """new Promise((res)=>{const g=__net.games;const old=g.onMsg;g.onMsg=(m)=>{if(m.k==='dbg'){g.onMsg=old;res(m);}else old(m);};__w.g({k:'dbg'});})""", 'dbg')
        K, G, V = dbg['keeper'], dbg['geode'], dbg['vault']
        # 1. Ula notices Brock and turns
        await ev(A, f"__w.walk({K['x']}-2.6,{K['z']}-1.2,2)"); await ev(A, f"__w.look({K['x']},1.5,{K['z']})")
        await ev(B, f"__w.walk({K['x']}-2.2,{K['z']}+1.4,2)")
        await ev(A, "(__w.g({k:'talk'}),1)"); await A.wait_for_timeout(1500)
        await shot(A, 'ula-quest')
        # 2. race: Brock lays a course, challenges, both race
        gates = [(K['x'] - 4, K['z'] - 4), (K['x'] - 4, K['z'] - 14), (K['x'] + 6, K['z'] - 14)]
        await ev(A, "(__w.g({k:'clr'}),1)")
        for (x, z) in gates:
            await ev(A, f"__w.walk({x},{z},6)"); await A.wait_for_timeout(300); await ev(A, "(__w.g({k:'gate'}),1)"); await A.wait_for_timeout(400)
        await ev(A, f"__w.walk({gates[0][0]},{gates[0][1]}+1.5,6)"); await ev(B, f"__w.walk({gates[0][0]}+1.2,{gates[0][1]}+1.5,6)")
        await ev(A, f"__w.look({gates[1][0]},1.2,{gates[1][1]})"); await ev(B, f"__w.look({gates[1][0]},1.2,{gates[1][1]})")
        await ev(A, f"(__w.g({{k:'ch',mode:'race'}}),1)")
        await B.wait_for_timeout(1200); await ev(B, "(__w.g({k:'ac',yes:true}),1)")
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='count'", timeout=30000, polling=500)
        await shot(A, 'race-countdown')
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='live'", timeout=30000, polling=500)
        ra = ev(A, " (async()=>{for(const [x,z] of %s) await __w.walk(x,z,7); return 1})()" % json.dumps(gates))
        rb = ev(B, " (async()=>{for(const [x,z] of %s) await __w.walk(x+0.8,z,6.4); return 1})()" % json.dumps(gates))
        await B.wait_for_timeout(1500); await ev(B, f"__w.look({gates[1][0]},1.2,{gates[1][1]})")
        await shot(B, 'race-live')
        await ra; await rb
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='done'", timeout=60000, polling=500)
        await shot(A, 'race-result')
        await A.wait_for_function("!__w.S().game", timeout=60000, polling=500)
        # 3. stone hunt
        cx, cz = K['x'] - 6, K['z'] - 8
        await ev(A, f"__w.walk({cx},{cz},6)"); await ev(B, f"__w.walk({cx}+1.5,{cz}+1,6)")
        await ev(B, "(__w.g({k:'ch',mode:'hunt'}),1)"); await A.wait_for_timeout(1200); await ev(A, "(__w.g({k:'ac',yes:true}),1)")
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='live'", timeout=30000, polling=500)
        st = await ev(A, "(()=>{const g=__w.S().game;const P=__w.P().position;return g.stones.slice().sort((a,b)=>Math.hypot(a.x-P.x,a.z-P.z)-Math.hypot(b.x-P.x,b.z-P.z))[0]})()")
        await ev(A, f"__w.walk({st['x']}-1.2,{st['z']}-1.2,7)"); await ev(A, f"__w.look({st['x']},0,{st['z']})")
        await shot(A, 'hunt-live')
        await ev(A, f"__w.walk({st['x']},{st['z']},4)"); await ev(A, "(__net.games.context()?.go(),1)"); await A.wait_for_timeout(600)
        await ev(B, "(()=>{const P=__w.P().position;const A=__net.state.peers[0];return 1})()")
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='done'", timeout=60000, polling=500)
        await A.wait_for_function("!__w.S().game", timeout=60000, polling=500)
        # 4. cairn (co-op)
        await ev(A, f"__w.walk({cx},{cz},6)"); await ev(B, f"__w.walk({cx}+1.5,{cz}+1,6)")
        await ev(A, "(__w.g({k:'ch',mode:'cairn'}),1)"); await B.wait_for_timeout(1200); await ev(B, "(__w.g({k:'ac',yes:true}),1)")
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='live'", timeout=30000, polling=500)
        for who in (A, B):
            for _ in range(2):
                st = await ev(who, "(()=>{const g=__w.S().game;const P=__w.P().position;return g.stones.slice().sort((a,b)=>Math.hypot(a.x-P.x,a.z-P.z)-Math.hypot(b.x-P.x,b.z-P.z))[0]})()")
                await ev(who, f"__w.walk({st['x']},{st['z']},7)"); await ev(who, "(__net.games.context()?.go(),1)"); await who.wait_for_timeout(500)
            await ev(who, f"__w.walk({cx}+0.9,{cz}+0.4,7)"); await ev(who, "(__net.games.context()?.go(),1)"); await who.wait_for_timeout(600)
        await ev(A, f"__w.walk({cx}-2.5,{cz}-2.5,4)"); await ev(A, f"__w.look({cx},0.6,{cz})")
        await shot(A, 'cairn-coop')
        await A.wait_for_function("!__w.S().game", timeout=90000, polling=500)
        # 5. sparring ring
        await ev(A, f"__w.walk({cx},{cz},6)"); await ev(B, f"__w.walk({cx}+1.4,{cz},6)")
        await ev(A, "(__w.g({k:'ch',mode:'ring'}),1)"); await B.wait_for_timeout(1200); await ev(B, "(__w.g({k:'ac',yes:true}),1)")
        await A.wait_for_function("__w.S().game && __w.S().game.phase==='live'", timeout=30000, polling=500)
        await ev(A, f"__w.walk({cx}+0.5,{cz},2)"); await ev(A, f"__w.look({cx}+1.4,1.2,{cz})")
        await ev(A, "(__net.games.shove(),1)"); await A.wait_for_timeout(300)
        await shot(A, 'ring-shove')
        await ev(B, f"__w.walk({cx}+7,{cz},5)")
        await A.wait_for_timeout(1500)
        await ev(A, "(__w.g({k:'quit'}),1)")
        await A.wait_for_function("!__w.S().game || __w.S().game.phase==='done'", timeout=60000, polling=500)
        # 6. geode -> Ula -> vault
        await ev(A, f"__w.walk({G['x']}+3,{G['z']},7)"); await ev(A, f"__w.walk({G['x']},{G['z']},2)")
        await A.wait_for_function("(__w.S().items.carried[__net.state.me.id]||[]).some(i=>i.k==='geode')", timeout=30000, polling=500)
        await ev(A, f"__w.walk({K['x']}-1.5,{K['z']},7)"); await ev(B, f"__w.walk({K['x']}-1.2,{K['z']}+1.3,7)")
        await ev(A, f"__w.look({K['x']},1.5,{K['z']})")
        await ev(A, "(__w.g({k:'talk'}),1)"); await A.wait_for_timeout(1200)
        await shot(A, 'ula-reads-map')
        await A.wait_for_function("__w.S().vault", timeout=30000, polling=500)
        side = lambda x, z: f"(async()=>{{const P=__w.P().position;const vx={V['x']},vz={V['z']};const tx={x},tz={z};const L=Math.hypot(tx-P.x,tz-P.z)||1;const k=Math.max(0,Math.min(1,((vx-P.x)*(tx-P.x)+(vz-P.z)*(tz-P.z))/(L*L)));const cx=P.x+(tx-P.x)*k,cz=P.z+(tz-P.z)*k;if(Math.hypot(cx-vx,cz-vz)<6){{const nx=-(tz-P.z)/L,nz=(tx-P.x)/L,s=((cx-vx)*nx+(cz-vz)*nz)>=0?1:-1;await __w.walk(vx+nx*9*s,vz+nz*9*s,7);}}await __w.walk(tx,tz,7);return 1}})()"
        await ev(A, side(V['x'] + 3.6, V['z'] + 2.2)); await ev(B, side(V['x'] + 8, V['z'] + 3))
        await ev(A, f"__w.walk({V['x']}+3.6,{V['z']}+2.0,3)")
        await ev(A, "(__w.g({k:'unlock'}),1)"); await A.wait_for_timeout(1200)
        await ev(B, f"__w.walk({V['x']}+5,{V['z']},3)")
        await A.wait_for_function("__w.S().vault && __w.S().vault.open", timeout=30000, polling=500)
        await ev(A, f"__w.walk({V['x']}+7,{V['z']}+4,4)"); await ev(A, f"__w.look({V['x']},1.2,{V['z']})")
        await A.wait_for_timeout(2500)
        await shot(A, 'vault-open')
        await ev(A, f"__w.walk({V['x']}+3.6,{V['z']}+0.3,3)"); await ev(A, f"__w.walk({V['x']}+1.2,{V['z']}+0.2,3)")
        await ev(A, f"__w.look({V['x']}-1,0.2,{V['z']})")
        await shot(A, 'vault-inside-relics')
        await ev(A, "(__net.games.context()?.go(),1)"); await A.wait_for_timeout(800)
        await ev(B, f"__w.walk({V['x']}+8,{V['z']}+2,3)")
        await A.wait_for_function("__w.S().vault && !__w.S().vault.open", timeout=30000, polling=500)
        await ev(A, f"__w.look({V['x']}+3.3,1.0,{V['z']})"); await A.wait_for_timeout(2500)
        await shot(A, 'vault-shut-in')
        await ev(A, "document.querySelector('#cmp .chip').click()"); await A.wait_for_timeout(800)
        await shot(A, 'panel')
        print('A state', await ev(A, "(()=>{const s=__w.S();return {quest:s.quest,carried:s.items.carried,vault:s.vault&&{locked:s.vault.locked,open:s.vault.open},board:s.board}})()"))
        await b.close()
try:
    asyncio.run(run())
except Exception as e:
    print('FAIL', e)
finally:
    srv.kill()
    print('ERRORS', json.dumps(errors[:30], indent=1))

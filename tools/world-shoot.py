# One headless game window: the world spawn, the points of interest around it (offline, before signing in),
# the escape pod + wreck flow on a planet, then signing in to the shared server and arriving at the spawn.
# Needs `wrangler dev` on 8787 (LOCAL_DEV=1) for the last step. Writes shots/world-*.png.
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.environ.get('MG_DIR', '/workspace/mp-zen'); OUT = ROOT + '/shots/'
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mp=1&device=tablet&mode=walk&hour=16.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&qlevel=8'
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8090', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ONLY = set(filter(None, os.environ.get('SHOTS', '').split(',')))
errors = []; T0 = time.time()
G = "__garden.worlds.current.debug"
async def shot(pg, name, settle=1500):
    print(f'[{int(time.time()-T0)}s] at', name, flush=True)
    if ONLY and name not in ONLY: return
    await pg.wait_for_timeout(settle); t = time.time()
    await pg.screenshot(path=OUT + f'world-{name}.png', timeout=300000); print('shot', name, f'({time.time()-t:.0f}s)', flush=True)
async def ev(pg, js, label=None):
    r = await pg.evaluate(js)
    if label: print(label, json.dumps(r)[:400], flush=True)
    return r
def tp(x, z, lx, ly, lz):
    return f"(()=>{{const P=__garden.game.player;P.teleport({x},{z});P.lookAtPoint({lx},{ly},{lz});P.snapCamera();return 1}})()"
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1024, 'height': 576}); pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'))
        await pg.goto('http://127.0.0.1:8090/' + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__net && __garden.game", timeout=600000, polling=1000)
        await pg.wait_for_timeout(2000)
        # 1. the arrival stone (offline: nobody signed in yet)
        await ev(pg, tp(3.5, 13.5, 3.5, 0.3, 9.8)); await shot(pg, 'spawn')
        # 2. points of interest: not on the map before you find them
        await ev(pg, "__garden.game.places.list().filter(p=>p.known).length", 'known before')
        await ev(pg, tp(-24, -26, -24, 0.8, -36)); await shot(pg, 'ruins')
        await ev(pg, tp(-24, -34.5, -24, 0.2, -36.8))
        await pg.wait_for_timeout(1200)
        for i in range(4): await ev(pg, "(()=>{const it=__garden.game.interact.get('dig-ruins');it.actions()[0].run();return 1})()")
        await ev(pg, "__garden.game.places.list().filter(p=>p.known).map(p=>p.id)", 'known after digging'); await shot(pg, 'ruins-dug', 500)
        await ev(pg, tp(-44, 6, -44, 0.6, -4)); await shot(pg, 'wreck')
        await ev(pg, tp(30, -34, 0, 0, 0)); await pg.wait_for_timeout(2500)
        await ev(pg, "__garden.game.places.list().filter(p=>p.known).map(p=>p.id)", 'known after the lookout')
        await ev(pg, "(()=>{const P=__garden.game.player;P.lookAtPoint(-20,0,10);P.snapCamera();return P.position.y})()", 'height on the hill'); await shot(pg, 'lookout')
        await pg.keyboard.press('KeyN'); await shot(pg, 'map', 2500); await pg.keyboard.press('Escape')
        # 3. escape pod on a planet: take the helm of the landed ship, pull the pod twice, fly home
        await ev(pg, "__garden.worlds.go('planet',{from:'debug',seed:8}).then(()=>1)")
        await pg.wait_for_function(f"__garden.worlds.currentId==='planet' && {G}.shipAt", timeout=600000, polling=1000)
        await pg.wait_for_timeout(3000)
        await ev(pg, f"(()=>{{const d={G};const s=d.shipAt;d.player.teleport(s.x+5,s.z+5);d.player.lookAtPoint(s.x,s.y,s.z);d.player.snapCamera();return [s.x,s.z]}})()", 'ship at')
        await shot(pg, 'pod-before')
        await ev(pg, f"(()=>{{const b=document.querySelector('[data-a=pod]');return !!b}})()", 'pod button exists')
        await ev(pg, f"({G}.launchPod(null), 1)", 'pod launched (as the pilot UI does on the second press)')
        await pg.wait_for_function("__garden.worlds.currentId==='earth'", timeout=600000, polling=1000); await pg.wait_for_timeout(2500)
        await ev(pg, "(()=>{const P=__garden.game.player.position;return [+P.x.toFixed(2),+P.z.toFixed(2)]})()", 'home at')
        await shot(pg, 'pod-home', 500)
        await ev(pg, "__garden.worlds.go('planet',{from:'debug',seed:8}).then(()=>1)")
        await pg.wait_for_function(f"__garden.worlds.currentId==='planet' && {G}.shipAt", timeout=600000, polling=1000); await pg.wait_for_timeout(3000)
        await ev(pg, f"(()=>{{const d={G};const s=d.shipAt;d.player.teleport(s.x+6,s.z+4);d.player.lookAtPoint(s.x,s.y-1,s.z);d.player.snapCamera();return d.interact.items().map(i=>i.id).filter(i=>/wreck|ship/.test(i))}})()", 'wreck items')
        await shot(pg, 'pod-wreck')
        # 4. sign in: the shared server puts a new player at the world spawn
        await ev(pg, "__garden.worlds.go('earth',{from:'visit'}).then(()=>1)"); await pg.wait_for_timeout(3000)
        await ev(pg, f"__net.signInDev('spawn+{int(time.time())}@example.com','Brock').then(r=>r.account.name)", 'signed in')
        await pg.wait_for_function("__net.state.open", timeout=120000, polling=500); await pg.wait_for_timeout(2500)
        await ev(pg, "(()=>{const P=__garden.game.player.position;return {world:__net.state.world,at:[+P.x.toFixed(2),+P.z.toFixed(2)]}})()", 'online at')
        await shot(pg, 'spawn-online')
        print('ERRORS', errors[:12], flush=True)
        await b.close()
try: asyncio.run(run())
except Exception as e: print('FAIL', e, 'ERRORS', errors[:12], flush=True)
finally: srv.terminate()

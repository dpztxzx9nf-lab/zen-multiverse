# Escape pod + wreck on a real star-map planet (Mars, home system), offline, one headless window.
# Prints the save state at each step and writes shots/wreck-*.png.
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.environ.get('MG_DIR', '/workspace/mp-zen'); OUT = ROOT + '/shots/'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&device=tablet&mode=walk&hour=13&weather=clear&season=summer&debug&noadapt&fastdt&noresume&qlevel=8'
PORT = os.environ.get('PORT', '8091')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', PORT, '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
errors = []; T0 = time.time()
G = "__garden.worlds.current.debug"
MARS = "{from:'warp',seed:789253,addr:'g0,0/s0,0/home/3',dim:'prime'}"
STATE = "(async()=>{const R=await import('./js/universe/rescue.js');const T=await import('./js/universe/travel.js');const w=R.wreck();return {world:__garden.worlds.currentId,fuel:T.fuelState(),wreck:w&&{at:w.at,space:!!w.space,why:w.why},ship:(()=>{try{const d=__garden.worlds.current.debug;return d.shipAt?[+d.shipAt.x.toFixed(1),+d.shipAt.z.toFixed(1)]:null}catch(e){return null}})()}})()"
async def ev(pg, js, label=None):
    r = await pg.evaluate(js)
    if label: print(f'[{int(time.time()-T0)}s]', label, json.dumps(r)[:500], flush=True)
    return r
async def shot(pg, name):
    await pg.wait_for_timeout(1200); await pg.screenshot(path=OUT + f'wreck-{name}.png', timeout=600000); print('shot', name, flush=True)
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        pg = await (await b.new_context(viewport={'width': 960, 'height': 540})).new_page()
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await pg.goto(f'http://127.0.0.1:{PORT}/' + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && __garden.game", timeout=600000, polling=1000)
        await ev(pg, f"__garden.worlds.go('planet',{MARS}).then(()=>1)")
        await pg.wait_for_function(f"__garden.worlds.currentId==='planet' && {G}.shipAt", timeout=600000, polling=1000); await pg.wait_for_timeout(2500)
        await ev(pg, STATE, 'on Mars')
        await ev(pg, f"(()=>{{const d={G};const s=d.shipAt;d.player.teleport(s.x+7,s.z+5);d.player.lookAtPoint(s.x,s.y,s.z);d.player.snapCamera();return 1}})()")
        await shot(pg, 'mars-before')
        await ev(pg, f"({G}.launchPod(null),1)")
        await pg.wait_for_function("__garden.worlds.currentId==='earth'", timeout=600000, polling=1000); await pg.wait_for_timeout(1500)
        await ev(pg, STATE, 'home after the pod')
        await ev(pg, f"__garden.worlds.go('planet',{MARS}).then(()=>1)")
        await pg.wait_for_function(f"__garden.worlds.currentId==='planet' && {G}.shipAt", timeout=600000, polling=1000); await pg.wait_for_timeout(3000)
        await ev(pg, STATE, 'back on Mars')
        r = await ev(pg, f"(()=>{{const d={G};const it=d.interact.items().filter(i=>/wreck|ship/.test(i.id));const w=it.find(i=>i.id=='wreck')||it[0];if(w){{d.player.teleport(w.x+7,w.z+5);d.player.lookAtPoint(w.x,d.ground(w.x,w.z)+0.8,w.z);d.player.snapCamera();}}return it}})()", 'items')
        await ev(pg, f"(()=>{{const d={G};let vis=null;d.core&&0;return {{shipItem: d.interact.items().some(i=>i.id==='ship'), wreckItem: d.interact.items().some(i=>i.id==='wreck')}}}})()", 'ship mesh')
        await shot(pg, 'mars-after')
        print('ERRORS', errors[:10], flush=True)
        await b.close()
try: asyncio.run(run())
except Exception as e: print('FAIL', e, errors[:10], flush=True)
finally: srv.terminate()

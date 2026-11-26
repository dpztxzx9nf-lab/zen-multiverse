# The salt cove and the sea cave, offline (no server): shore, swimming, the tunnel under the headland, the chamber.
# Writes shots/cove-*.png and prints what the walker feels (swimming, depth, ground) at each spot.
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.environ.get('MG_DIR', '/workspace/mp-zen'); OUT = ROOT + '/shots/'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&device=tablet&mode=walk&hour=15&weather=clear&season=summer&debug&noadapt&fastdt&noresume&qlevel=8'
PORT = os.environ.get('PORT', '8092')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', PORT, '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
errors = []; T0 = time.time()
STATE = "(()=>{const P=__garden.game.player,p=P.position;const L=__garden.game.cove&&__garden.game.cove.life;return {fish:L?L.fish.filter(f=>f.alive).length:-1,plants:L&&L.plants?L.plants.ng+'/'+L.plants.nk:null,x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2),swimming:P.swimming,depth:P.water?+P.water.depth.toFixed(2):null,known:(__garden.game.places||{}).list?__garden.game.places.list().filter(q=>q.known).map(q=>q.id):null}})()"
def go(x, z, lx, ly, lz, y=None):
    sety = f"P.position.y={y};" if y is not None else ""
    return f"(()=>{{const P=__garden.game.player;P.teleport({x},{z});{sety}P.lookAtPoint({lx},{ly},{lz});P.snapCamera();return 1}})()"
async def ev(pg, js, label=None):
    r = await pg.evaluate(js)
    if label: print(f'[{int(time.time()-T0)}s]', label, json.dumps(r)[:400], flush=True)
    return r
async def shot(pg, name):
    await pg.wait_for_timeout(1500); await pg.screenshot(path=OUT + f'cove-{name}.png', timeout=600000); print('shot', name, flush=True)
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        pg = await (await b.new_context(viewport={'width': 960, 'height': 540})).new_page()
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await pg.goto(f'http://127.0.0.1:{PORT}/' + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && __garden.game && __garden.game.player", timeout=600000, polling=1000)
        await pg.wait_for_timeout(3000)
        await ev(pg, go(2, -21.5, 2, 1.5, -47)); await pg.wait_for_timeout(1500); await ev(pg, STATE, 'north shore'); await shot(pg, 'shore')
        await ev(pg, go(-11.5, -31, 2, 0.5, -46)); await pg.wait_for_timeout(1500); await ev(pg, STATE, 'west bank'); await shot(pg, 'reeds')
        await ev(pg, go(2, -32, 2, 0, -47)); await pg.wait_for_timeout(5000); await ev(pg, STATE, 'in the water'); await shot(pg, 'swim')
        await ev(pg, go(2, -39.5, 2, -2.4, -48, -3.0)); await pg.wait_for_timeout(600); await ev(pg, STATE, 'at the tunnel mouth'); await shot(pg, 'tunnel')
        await ev(pg, go(2, -51.6, 2, -0.2, -46, 0.1)); await pg.wait_for_timeout(1500); await ev(pg, STATE, 'on the shelf'); await shot(pg, 'chamber')
        await ev(pg, go(2, -46.5, 2, 3.2, -49)); await pg.wait_for_timeout(1000); await ev(pg, STATE, 'on top of the headland')
        print('ERRORS', [e for e in errors if 'favicon' not in e][:12], flush=True)
        await b.close()
try: asyncio.run(run())
except Exception as e: print('FAIL', e, errors[:10], flush=True)
finally: srv.terminate()

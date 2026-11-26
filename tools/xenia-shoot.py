# Xenia shots (headless, offline): the spawn view, Grey Peak from spawn, a far region (the Red Badlands and
# the Raider fort) and the map. Serves this checkout on PORT (default 8093) and writes OUT/xenia-*.png.
#   python3 tools/xenia-shoot.py [OUT_DIR]
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = (sys.argv[1] if len(sys.argv) > 1 else '/workspace/mp-zen/shots').rstrip('/') + '/'
PORT = int(os.environ.get('PORT', '8093'))
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = f'http://127.0.0.1:{PORT}/index.html?game=1&device=tablet&mode=walk&hour=16.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&qlevel=8&mpserver=http://127.0.0.1:1'
NOISE = ('127.0.0.1:1', 'ERR_CONNECTION_REFUSED', 'net::ERR_FAILED')
T0 = time.time(); errors = []
TP = """async ([x, z, lx, ly, lz]) => { const P = __garden.game.player; P.teleport(x, z); P.lookAtPoint(lx, ly, lz); P.snapCamera(); return [P.position.x, P.position.y, P.position.z]; }"""
async def shot(pg, name, settle=6000):
    await pg.wait_for_timeout(settle)
    await pg.screenshot(path=OUT + f'xenia-{name}.png', timeout=300000); print(f'[{int(time.time()-T0)}s] shot', name, flush=True)
async def run():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
            pg = await (await b.new_context(viewport={'width': 1280, 'height': 720})).new_page()
            pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' and not any(s in m.text for s in NOISE) else None)
            pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)[:300]))
            await pg.goto(Q, wait_until='commit', timeout=600000)
            await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000, polling=250)
            X = await pg.evaluate("(async()=>{const m=await import('/js/xenia/xenia.js');const s=await import('/js/spawn.js');return {peak:m.PEAK,fort:m.FORT,spawn:s.WORLD_SPAWN||{x:0,z:0}}})()")
            sp, pk, ft = X['spawn'], X['peak'], X['fort']
            # 1) spawn: standing at the arrival stone, looking down the valley toward the garden
            await pg.evaluate(TP, [sp['x'], sp['z'], 0, 1.2, 0]); await shot(pg, 'spawn')
            # 2) Grey Peak from spawn (900 m, ~3 km north-east)
            await pg.evaluate(TP, [sp['x'], sp['z'], pk['x'], pk['top'] * 0.7, pk['z']]); await shot(pg, 'greypeak')
            # 3) a far region: the Red Badlands, the Raider fort's mesa ahead
            fx, fz = ft['x'] * 0.93, ft['z'] * 0.93
            await pg.evaluate(TP, [fx - 120, fz + 60, ft['x'], ft['top'] * 0.8, ft['z']]); await shot(pg, 'far', 15000)
            reg = await pg.evaluate("(()=>{const t=document.body.innerText;const m=t.match(/(Red Badlands|Grey Ridge|Salt Coast|Warm Sea|North Ice|Cedar Highlands|Ember Highlands|Home Valley)/);return m?m[0]:null})()")
            print('region on screen:', reg, flush=True)
            # 4) the map (M)
            await pg.evaluate(TP, [sp['x'], sp['z'], 0, 1.2, 0]); await pg.wait_for_timeout(4000)
            await pg.keyboard.press('m'); await shot(pg, 'map', 3000)
            await b.close()
    finally:
        srv.terminate(); srv.wait()
    for e in errors[:15]: print('ERR', e)
    print('done', len(errors), 'errors')
asyncio.run(run())

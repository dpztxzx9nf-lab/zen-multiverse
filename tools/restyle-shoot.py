# Restyle before/after: the same six cameras on any build (desktop preset, SwiftShader, offline).
#   python3 tools/restyle-shoot.py <repo dir> <tag> [view,view]   -> $OUT/restyle-<view>-<tag>.png
# views: garden cove planet camp player underwater
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = sys.argv[1]; TAG = sys.argv[2]; ONLY = set(filter(None, (sys.argv[3] if len(sys.argv) > 3 else '').split(',')))
OUT = os.environ.get('OUT', '/workspace/mp-zen/shots/'); os.makedirs(OUT, exist_ok=True)
DEV = os.environ.get('DEV', 'pc'); EXTRA = os.environ.get('EXTRA', '')
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = f'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle&mpserver=http://127.0.0.1:1&creator=0&device={DEV}{EXTRA}'
PORT = os.environ.get('PORT', '8097')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', PORT, '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
errors = []; T0 = time.time()
def tp(x, z, lx, ly, lz, y=None):
    sety = f"P.position.y={y};" if y is not None else ""
    return f"(()=>{{const P=__garden.game.player;P.teleport({x},{z});{sety}P.lookAtPoint({lx},{ly},{lz});P.snapCamera();return 1}})()"
async def ev(pg, js):
    try: return await pg.evaluate(js)
    except Exception as e: print('EVAL FAIL', js[:90].replace(chr(10), ' '), str(e)[:200], flush=True); raise
async def shot(pg, name, settle=2500):
    if ONLY and name not in ONLY: return
    await pg.wait_for_timeout(settle)
    p = f'{OUT}restyle-{name}-{TAG}.png'; await pg.screenshot(path=p, timeout=600000); print(f'[{int(time.time()-T0)}s] shot', p, flush=True)
def want(n): return not ONLY or n in ONLY
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        pg = await (await b.new_context(viewport={'width': 1280, 'height': 720})).new_page()
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'[:300]))
        pg.on('console', lambda m: errors.append(m.text[:300]) if m.type == 'error' else None)
        await pg.goto(f'http://127.0.0.1:{PORT}/' + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && __garden.game && __garden.game.player", timeout=900000, polling=1000)
        await pg.wait_for_timeout(4000)
        HIDE = "(()=>{let st=document.getElementById('rs-hide');if(!st){st=document.createElement('style');st.id='rs-hide';st.textContent='#hud,#zen-lockhint,.chip{visibility:hidden!important}';document.head.appendChild(st)}return 1})()"
        await ev(pg, HIDE)
        if want('garden'): await ev(pg, tp(-6, 9, 1.5, 1.0, -0.5)); await shot(pg, 'garden')
        if want('cove'): await ev(pg, tp(2, -21.5, 2, 1.5, -47)); await shot(pg, 'cove')
        if want('camp'): await ev(pg, tp(-21, 29, -29, 1.3, 37.5)); await shot(pg, 'camp')
        if want('player'):
            await ev(pg, tp(-3, 11, -3, 1.4, 4)); await pg.wait_for_timeout(800)
            await ev(pg, "(()=>{const A=window.__avatar,P=__garden.game.player;A.camera.photo(true,{dist:2.3});P.aim(P.heading+Math.PI*0.82,-0.12);A.camera.snap();return 1})()")
            await shot(pg, 'player', 3500)
            await ev(pg, "(()=>{window.__avatar.camera.photo(false);return 1})()")
        if want('underwater'): await ev(pg, tp(2, -31, 2, -2.6, -44, -2.9)); await pg.wait_for_function("__garden.game.cove && __garden.game.cove.ocean ? __garden.game.cove.ocean.cameraDepth() > 0.05 : true", timeout=60000, polling=100); await shot(pg, 'underwater', 400)
        if want('planet'):
            await ev(pg, "import('./js/universe/home.js').then((m)=>{const h=m.homeBody('earth');return __garden.worlds.go('planet',{site:'earth',seed:h.body.seed,star:0,index:2,addr:h.addr,dim:'prime',from:'walk',x:265,z:219,yaw:5.2})}).then(()=>1)")
            await pg.wait_for_function("__garden.worlds.current && __garden.worlds.current.id==='planet' && __garden.worlds.current.debug && __garden.worlds.current.debug.player && __garden.worlds.current.debug.W", timeout=600000, polling=1000)
            await pg.wait_for_timeout(6000)
            # a fixed shore: walk out from the arrival point to the first sea, stand on the beach facing it
            sea = [265.01, 219.44, 5.2358]  # the home Earth's first beach east of the arrival point (found once by walking out to the sea)
            print('planet sea', sea, flush=True)
            if sea:
                await ev(pg, f"(async()=>{{const d=__garden.worlds.current.debug;d.player.teleport({sea[0]},{sea[1]},{sea[2]});d.player.snapCamera();await d.trek(0.01,0.01,2);d.player.aim({sea[2]}+0.5,-0.06);return 1}})()")
            await ev(pg, HIDE)
            await shot(pg, 'planet', 6000)
        print('ERRORS', [e for e in errors if 'favicon' not in e and '127.0.0.1:1' not in e][:12], flush=True)
        await b.close()
try: asyncio.run(run())
except Exception as e: print('FAIL', e, errors[:10], flush=True)
finally: srv.terminate()

# Shots for the art-bible section 12 gaps (pond, de-lit ground and mountains, UI enso, far trees).
# usage: MG_DIR=... bash serve.sh tools/art-gaps.py <tag>   env: VIEWS=pond,ground,mountains,ui,planet  DEV=pc|phone|both
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1]; TAG = sys.argv[2] if len(sys.argv) > 2 else 'x'
OUT = os.environ.get('OUT', '/workspace/mom-garden-notes/art-shots/gaps/'); os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle'
VIEWS = os.environ.get('VIEWS', 'pond,ground,mountains,ui,planet').split(',')
DEVS = ['pc', 'phone'] if os.environ.get('DEV', 'both') == 'both' else [os.environ['DEV']]
errors = []
async def ev(pg, js): return await pg.evaluate(js)
async def stand(pg, x, z, lx, ly, lz, w=1800):
    await ev(pg, f"(()=>{{const g=__garden.game;g.player.teleport({x},{z},0);g.player.lookAtPoint({lx},{ly},{lz});g.player.snapCamera();return 1}})()")
    await pg.wait_for_timeout(w)
async def shot(pg, name, clip=None):
    p = f'{OUT}{TAG}-{name}.png'; await pg.screenshot(path=p, timeout=240000, clip=clip); print('shot', p, flush=True)
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        for dev in DEVS:
            vp = {'width': 1280, 'height': 720} if dev == 'pc' else {'width': 844, 'height': 390}
            ctx = await b.new_context(viewport=vp); pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}'[:300]) if m.type in ('error', 'warning') and ('look' in m.text or 'Error' in m.text) else None)
            pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'[:300]))
            await pg.goto(BASE + '/' + Q + '&device=' + dev, wait_until='commit', timeout=600000)
            if 'ui' in VIEWS:  # the loading veil, a moment in
                await pg.wait_for_timeout(1200); await shot(pg, f'{dev}-loading')
            await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
            await pg.wait_for_timeout(3000)
            if 'pond' in VIEWS:
                await stand(pg, 5.6, 4.6, 10.2, -0.3, 1.2, 600)
                # taps: real ripples (the cause of the rings)
                await ev(pg, "(()=>{const d=__garden.worlds.current.debug; d.ripple(9.4,1.6,0.7); d.ripple(11.2,0.4,0.6); return 1})()")
                await pg.wait_for_timeout(900); await shot(pg, f'{dev}-pond')
                await stand(pg, 7.0, 6.5, 10.2, -0.3, 0.6, 1500); await shot(pg, f'{dev}-pond-calm')
            if 'ground' in VIEWS:
                await stand(pg, -2, -6, 2, -0.6, -14, 1500); await shot(pg, f'{dev}-lawn')
            if 'mountains' in VIEWS:
                await stand(pg, 0, 4, 0, 6, -60, 1500); await shot(pg, f'{dev}-mountains')
            if 'ui' in VIEWS:
                await stand(pg, -6, 9, 1.5, 1.0, -0.5, 1200)
                vw = vp['width']; await shot(pg, f'{dev}-compass', {'x': vw - 260, 'y': 0, 'width': 260, 'height': 220})
            if 'planet' in VIEWS:
                for s in ([int(os.environ['SEED'])] if os.environ.get('SEED') else [34]):
                    await ev(pg, f"window.__garden.worlds.go('planet', {{ from: 'warp', seed: {s} }}).then(() => true)")
                await pg.wait_for_timeout(4000)
                await ev(pg, "(()=>{const d=__garden.worlds.current.debug; d.player.aim(d.player.heading, -0.05); return 1})()")
                await pg.wait_for_timeout(2500); await shot(pg, f'{dev}-planet-far')
                await ev(pg, "(()=>{const d=__garden.worlds.current.debug; d.player.aim(d.player.heading+1.6, -0.55); return 1})()")
                await pg.wait_for_timeout(2500); await shot(pg, f'{dev}-planet-ground')
            await ctx.close()
        await b.close()
    print('ERRORS', json.dumps(errors[:20], indent=1))
asyncio.run(run())

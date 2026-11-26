# Phone-preset frame cost of the Raked Light look: same build, ?look=0 vs on, same views.
# SwiftShader on the box is a CPU rasterizer, so only the relative difference means anything.
# usage: MG_DIR=/workspace/zm-art bash /workspace/mom-garden-tools/serve.sh tools/art-cost.py
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1]
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle&device=phone'
VIEWS = [('garden', (-6, 9, 1.5, 1.0, -0.5)), ('trees', (10, 10, -4, 3.5, -8)), ('warden-camp', (-14, 24, -29, 1.4, 37.5))]
FM = """new Promise((res)=>{let n=0,t0=performance.now();const f=()=>{n++; if(performance.now()-t0<%d) requestAnimationFrame(f); else res(+((performance.now()-t0)/n).toFixed(1));}; requestAnimationFrame(f);})"""
async def run():
    out = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        for look in ['&look=0', '', '&look=0', '']:
            ctx = await b.new_context(viewport={'width': 844, 'height': 390}); pg = await ctx.new_page()
            await pg.goto(BASE + '/' + Q + look, wait_until='commit', timeout=600000)
            await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
            await pg.wait_for_timeout(3000)
            for name, v in VIEWS:
                await pg.evaluate(f"(()=>{{const g=__garden.game;g.player.teleport({v[0]},{v[1]},0);g.player.lookAtPoint({v[2]},{v[3]},{v[4]});g.player.snapCamera();return 1}})()")
                await pg.wait_for_timeout(2500)
                ms = await pg.evaluate(FM % 8000)
                k = ('off' if look else 'on') + '-' + name; out.setdefault(k, []).append(ms); print(k, ms, flush=True)
            await ctx.close()
        await b.close()
    print('RESULT', json.dumps(out))
asyncio.run(run())

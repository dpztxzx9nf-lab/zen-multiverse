# Perf pass (release checklist): cold load time and phone-preset frame cost, same views, for one or
# more builds served side by side. SwiftShader on the box is a CPU rasterizer: compare builds, don't
# read the ms as phone ms.
#   python3 tools/perf-pass.py name=http://127.0.0.1:PORT [name2=URL2 ...]   -> JSON on stdout
import asyncio, json, sys, time
from playwright.async_api import async_playwright
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle&mpserver=http://127.0.0.1:1&device='
import os
VIEWS = [('garden', (-6, 9, 1.5, 1.0, -0.5)), ('trees', (10, 10, -4, 3.5, -8)), ('warden-camp', (-14, 24, -29, 1.4, 37.5))]
# Xenia (0.2.20+): the camps moved 0.3 km west and the hub opens onto real terrain. PERF_VIEWS=xenia measures there.
if os.environ.get('PERF_VIEWS') == 'xenia':
    VIEWS = [('garden', (-6, 9, 1.5, 1.0, -0.5)), ('trees', (10, 10, -4, 3.5, -8)), ('ranger-camp', (-312, 92, -330, 1.4, 98)), ('valley-out', (60, -140, 400, 60, -900))]
FM = "(ms)=>new Promise((res)=>{let n=0,t0=performance.now();const f=()=>{n++; if(performance.now()-t0<ms) requestAnimationFrame(f); else res(+((performance.now()-t0)/n).toFixed(1));}; requestAnimationFrame(f);})"
async def one(b, base, device, vp):
    ctx = await b.new_context(viewport=vp); pg = await ctx.new_page()
    nbytes = [0]
    pg.on('response', lambda r: None)
    cdp = await ctx.new_cdp_session(pg); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    cdp.on('Network.loadingFinished', lambda e: nbytes.__setitem__(0, nbytes[0] + e.get('encodedDataLength', 0)))
    t0 = time.time()
    await pg.goto(base + '/' + Q + device, wait_until='commit', timeout=600000)
    await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000, polling=100)
    load = time.time() - t0
    await pg.wait_for_timeout(3000)
    out = {'load_s': round(load, 1), 'MB': round(nbytes[0] / 1e6, 1)}
    for name, (x, z, lx, ly, lz) in VIEWS:
        await pg.evaluate(f"(()=>{{const g=__garden.game;g.player.teleport({x},{z},0);g.player.lookAtPoint({lx},{ly},{lz});g.player.snapCamera();return 1}})()")
        await pg.wait_for_timeout(2000)
        out[name + '_ms'] = await pg.evaluate(FM, 6000)
    out['heapMB'] = await pg.evaluate("performance.memory?Math.round(performance.memory.usedJSHeapSize/1e6):null")
    out['tris'] = await pg.evaluate("__garden.renderer.info.render.triangles")
    await ctx.close(); return out
async def run():
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        for rnd in range(2):  # alternate builds twice to even out box noise
            for arg in sys.argv[1:]:
                name, base = arg.split('=', 1)
                for device, vp in [('phone', {'width': 844, 'height': 390}), ('pc', {'width': 1280, 'height': 720})]:
                    r = await one(b, base, device, vp)
                    res.setdefault(f'{name}/{device}', []).append(r); print(name, device, rnd, json.dumps(r), file=sys.stderr, flush=True)
        await b.close()
    print(json.dumps(res, indent=1))
asyncio.run(run())

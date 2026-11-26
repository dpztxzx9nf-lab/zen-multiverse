# Art pass before/after shots + phone-preset frame cost (SwiftShader: relative only).
# usage: MG_DIR=/workspace/zm-art bash /workspace/mom-garden-tools/serve.sh tools/art-shoot.py <tag> [pc|phone|both]
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright
BASE = sys.argv[1]; TAG = sys.argv[2] if len(sys.argv) > 2 else 'x'; WHICH = sys.argv[3] if len(sys.argv) > 3 else 'both'
OUT = os.environ.get('OUT', '/workspace/mom-garden-notes/art-shots/'); os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle'
ONLY = os.environ.get('ONLY', '')
errors = []
async def ev(pg, js):
    return await pg.evaluate(js)
async def stand(pg, x, z, lx, ly, lz, w=1800):
    await ev(pg, f"(()=>{{const g=__garden.game;g.player.teleport({x},{z},0);g.player.lookAtPoint({lx},{ly},{lz});g.player.snapCamera();return 1}})()")
    await pg.wait_for_timeout(w)
async def frame_ms(pg, secs=4):
    return await ev(pg, f"""new Promise((res)=>{{let n=0,t0=performance.now();const f=()=>{{n++; if(performance.now()-t0<{secs*1000}) requestAnimationFrame(f); else res(+((performance.now()-t0)/n).toFixed(1));}}; requestAnimationFrame(f);}})""")
async def shot(pg, name, cost=None):
    p = f'{OUT}{TAG}-{name}.png'; await pg.screenshot(path=p, timeout=240000); print('shot', p, cost if cost is not None else '', flush=True)
async def boot(b, dev):
    vp = {'width': 1280, 'height': 720} if dev == 'pc' else {'width': 844, 'height': 390}
    ctx = await b.new_context(viewport=vp)
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}'[:300]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'[:300]))
    await pg.goto(BASE + '/' + Q + '&device=' + dev, wait_until='commit', timeout=600000)
    await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
    await pg.wait_for_timeout(3000)
    return ctx, pg
VIEWS = [
    ('garden', (-6, 9, 1.5, 1.0, -0.5)),
    ('trees', (10, 10, -4, 3.5, -8)),
    ('pond', (-3, 3.5, 3, 0.2, -5)),
    ('warden-camp', (-14, 24, -29, 1.4, 37.5)),
    ('reaver-post', (26, 12, 40, 1.4, 25)),
]
async def run():
    costs = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        for dev in (['pc', 'phone'] if WHICH == 'both' else [WHICH]):
            ctx, pg = await boot(b, dev)
            if ONLY != 'planet':
                for name, v in VIEWS:
                    await stand(pg, *v)
                    ms = await frame_ms(pg) if dev == 'phone' else None
                    costs[f'{dev}-{name}'] = ms
                    await shot(pg, f'{dev}-{name}', ms)
            if ONLY == 'earth': await ctx.close(); continue
            # a planet: forest out to the horizon (impostors) and a sea
            for s in ([int(os.environ['SEED'])] if os.environ.get('SEED') else range(2, 40)):
                await ev(pg, f"window.__garden.worlds.go('planet', {{ from: 'warp', seed: {s} }}).then(() => true)")
                ok = await ev(pg, "(()=>{const d=__garden.worlds.current.debug, W=d.W; return !!(W.hasSea && d.floraStats && d.floraStats().imp > 50)})()")
                if ok: break
            await pg.wait_for_timeout(3000)
            info = await ev(pg, "(()=>{const d=__garden.worlds.current.debug; return {seed: d.W.seed, fl: d.floraStats()}})()")
            print('planet', dev, json.dumps(info), flush=True)
            await ev(pg, "(()=>{const d=__garden.worlds.current.debug; d.player.aim(d.player.heading, -0.05); return 1})()")
            await pg.wait_for_timeout(2500)
            ms = await frame_ms(pg) if dev == 'phone' else None; costs[f'{dev}-planet'] = ms
            await shot(pg, f'{dev}-planet', ms)
            sea = await ev(pg, """(()=>{const d=__garden.worlds.current.debug,W=d.W,ox=d.player.position.x,oz=d.player.position.z;
              for(let r=20;r<1500;r+=15)for(let k=0;k<24;k++){const a=k/24*6.283,x=ox+Math.sin(a)*r,z=oz+Math.cos(a)*r;if(W.height(x,z)>W.sea-2)continue;
                for(let t=0;t<80;t++){const xx=x-Math.sin(a)*t,zz=z-Math.cos(a)*t;if(W.height(xx,zz)>W.sea+1.5){return [xx-Math.sin(a)*4,zz-Math.cos(a)*4,a]}}}return null})()""")
            if sea:
                await ev(pg, f"(async()=>{{const d=__garden.worlds.current.debug;d.player.teleport({sea[0]},{sea[1]},{sea[2]});d.player.snapCamera();await d.trek(0.01,0.01,2);d.player.aim({sea[2]},-0.12);return 1}})()")
                await pg.wait_for_timeout(3500)
                ms = await frame_ms(pg) if dev == 'phone' else None; costs[f'{dev}-sea'] = ms
                await shot(pg, f'{dev}-sea', ms)
            await ctx.close()
        await b.close()
    print('COSTS', json.dumps(costs))
    with open(f'{OUT}{TAG}-costs.json', 'w') as f: json.dump(costs, f, indent=1)
    print('ERRORS', json.dumps(errors[:20], indent=1))
asyncio.run(run())

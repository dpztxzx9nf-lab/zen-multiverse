# Leak probe: stand still somewhere (default: home Earth planet near the garden, like a player who leaves
# the game open) and sample, every K frames, the JS heap after a forced GC, renderer.info (geometries,
# textures, programs), scene object count and the renderer process RSS. Growth per 1000 frames is printed.
#   MG_DIR=<repo> bash /workspace/mom-garden-tools/serve.sh tools/leak-probe.py [frames] [where]
import asyncio, json, sys, os, glob
from playwright.async_api import async_playwright
BASE = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 1500; WHERE = sys.argv[3] if len(sys.argv) > 3 else 'planet'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc']
Q = 'index.html?game=1&mode=walk&hour=11&weather=clear&season=summer&debug&noadapt&noresume&nothrottle&mpserver=http://127.0.0.1:1&device=pc'
FR = "(n)=>new Promise((res)=>{let k=0;const f=()=>{if(++k>=n)res(k);else requestAnimationFrame(f)};requestAnimationFrame(f)})"
def rss():
    tot = 0
    for st in glob.glob('/proc/[0-9]*/cmdline'):
        try:
            c = open(st, 'rb').read().decode(errors='ignore')
            if 'chrome' in c and '--type=renderer' in c and 'headless' in c:
                for line in open(st.replace('cmdline', 'status')):
                    if line.startswith('VmRSS'): tot += int(line.split()[1])
        except Exception: pass
    return tot // 1024
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        pg = await (await b.new_context(viewport={'width': 320, 'height': 180})).new_page()
        pg.on('pageerror', lambda e: print('PAGEERROR', str(e)[:200]))
        cdp = await pg.context.new_cdp_session(pg)
        await pg.goto(BASE + '/' + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
        if WHERE == 'planet':
            await pg.evaluate("(async()=>{const m=await import('/js/universe/home.js');const h=m.homeBody('earth');await __garden.worlds.go('planet',{site:'earth',seed:h.body.seed,star:0,index:2,addr:h.addr,dim:'prime',from:'resume'});__garden.worlds.current.restoreWhere({world:'planet',seed:h.body.seed,dim:'prime',star:0,index:2,era:'present',addr:h.addr,tile:null,x:398.91,z:236.49,yaw:0.785});return 1})()")
        await pg.evaluate(FR, 200)
        rows = []
        for k in range(0, N + 1, 150):
            if k: await pg.evaluate(FR, 150)
            await cdp.send('HeapProfiler.collectGarbage')
            h = await cdp.send('Runtime.getHeapUsage')
            r = await pg.evaluate("(()=>{const w=__garden.worlds.current;const i=__garden.renderer.info;let n=0;w.scene.traverse(()=>n++);return {geo:i.memory.geometries,tex:i.memory.textures,prog:i.programs?i.programs.length:0,obj:n,listeners:(window.__zenListeners||0)}})()")
            row = {'f': k, 'heapMB': round(h['usedSize'] / 1e6, 1), 'rssMB': rss(), **r}; rows.append(row); print(json.dumps(row), flush=True)
        a, z = rows[0], rows[-1]; per = 1000 / max(1, z['f'] - a['f'])
        print('GROWTH per 1000 frames:', json.dumps({k: round((z[k] - a[k]) * per, 2) for k in ('heapMB', 'rssMB', 'geo', 'tex', 'prog', 'obj')}))
        await b.close()
asyncio.run(run())

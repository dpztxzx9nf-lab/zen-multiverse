# CI smoke boot: load the game headless (software WebGL), run N frames in the garden, hop to the home
# Earth planet and back, and fail on any console error / page error or a NaN in the player, camera or
# bobber positions (or any scene object). Console errors during the initial load fail the job as soon
# as the veil is gone (or the load times out).
#   python3 -m http.server 8090 --bind 127.0.0.1 &  python3 tools/ci/smoke.py http://127.0.0.1:8090 [frames]
import asyncio, sys, shutil, time
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/'); N = int(sys.argv[2]) if len(sys.argv) > 2 else 90
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = '/index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle&unlock=all&mpserver=http://127.0.0.1:1&device=pc'
# offline on purpose: the multiplayer server is unreachable, so its connection errors are expected
NOISE = ('127.0.0.1:1', 'ERR_CONNECTION_REFUSED', 'net::ERR_FAILED')
FRAMES = "(n)=>new Promise((res)=>{let k=0;const f=()=>{if(++k>=n)res(k);else requestAnimationFrame(f)};requestAnimationFrame(f)})"
NAN = """(()=>{const bad=[];const fin=(v)=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z);
  const w=__garden.worlds.current;const d=w.debug||{};const p=(d.player||__garden.player);
  if(p&&!fin(p.position))bad.push('player '+JSON.stringify(p.position));
  if(w.camera&&!fin(w.camera.position))bad.push('camera '+JSON.stringify(w.camera.position));
  let n=0,b=0;w.scene.traverse((o)=>{n++;if(o.name==='bobber'){b++;if(!fin(o.position))bad.push('bobber '+JSON.stringify(o.position))}
    else if(!fin(o.position)&&bad.length<12)bad.push('object '+(o.name||o.type)+' '+JSON.stringify(o.position))});
  return {bad,objects:n,bobbers:b,world:w.id||'?'}})()"""

def note_console(errs, m):
    if m.type != 'error':
        return
    text = (m.text or '')[:300]
    if any(s in text for s in NOISE):
        return
    errs.append('console: ' + (text or '(empty error)'))

def dump_errs(label, errs, limit=20):
    for e in errs[:limit]:
        print('FAIL', label + ': ' + e, flush=True)
    if len(errs) > limit:
        print(f'FAIL {label}: … {len(errs) - limit} more', flush=True)

async def run():
    errs, fail = [], 0
    async with async_playwright() as p:
        exe = shutil.which('google-chrome')
        b = await p.chromium.launch(headless=True, args=ARGS, **({'executable_path': exe} if exe else {}))
        pg = await (await b.new_context(viewport={'width': 480, 'height': 270})).new_page()
        pg.on('console', lambda m: note_console(errs, m))
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
        try:
            await pg.goto(BASE + Q, wait_until='commit', timeout=600000)
            await pg.wait_for_function("""() => { const v = document.getElementById('veil'); return !!(v && v.classList.contains('gone') && window.__garden && window.__garden.game); }""", timeout=600000)
        except Exception as e:
            dump_errs('during load', errs)
            print('FAIL load did not finish:', e, flush=True)
            await b.close()
            print('FAIL'); sys.exit(1)
        load_errs = list(errs)
        if load_errs:
            dump_errs('during load', load_errs)
            fail = 1
        else:
            print('ok   load: no console errors', flush=True)
            steps = [('garden', None), ('planet', "(async()=>{const m=await import('/js/universe/home.js');const h=m.homeBody('earth');const {HUB_SPAWN}=await import('/js/hub.js');await __garden.worlds.go('planet',{site:'earth',seed:h.body.seed,star:0,index:2,addr:h.addr,dim:'prime',from:'walk',x:HUB_SPAWN.x,z:HUB_SPAWN.z,yaw:HUB_SPAWN.yaw,tile:HUB_SPAWN.tile});return 1})()"),
                     ('stay on the globe', "(async()=>{if(__garden.worlds.currentId!=='planet')throw new Error('expected to stay on the planet, got '+__garden.worlds.currentId);return 1})()")]
            for name, go in steps:
                t0 = time.time()
                if go: await pg.evaluate(go)
                for chunk in range(0, N, 50):
                    await pg.evaluate(FRAMES, min(50, N - chunk))
                    r = await pg.evaluate(NAN)
                    if r['bad']: print(f'FAIL {name}: non-finite positions', r['bad'][:6]); fail = 1; break
                print(f'ok   {name}: {N} frames, {r["objects"]} objects, bobbers {r["bobbers"]}, world {r["world"]} ({time.time() - t0:.0f} s)', flush=True)
        later = [e for e in errs if e not in load_errs]
        if later:
            dump_errs('after load', later)
            fail = 1
        await b.close()
    print('FAIL' if fail else 'ALL PASSED'); sys.exit(fail)
asyncio.run(run())

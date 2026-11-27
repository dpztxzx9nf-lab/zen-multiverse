# CI smoke boot: load the game headless (software WebGL), run N frames in the garden, hop to the home
# Earth planet and back, and fail on any console error / page error or a NaN in the player, camera or
# bobber positions (or any scene object).
#   python3 -m http.server 8090 --bind 127.0.0.1 &  python3 tools/ci/smoke.py http://127.0.0.1:8090 [frames]
import asyncio, json, sys, shutil, time
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
async def run():
    errs, fail = [], 0
    async with async_playwright() as p:
        exe = shutil.which('google-chrome')
        b = await p.chromium.launch(headless=True, args=ARGS, **({'executable_path': exe} if exe else {}))
        pg = await (await b.new_context(viewport={'width': 480, 'height': 270})).new_page()
        pg.on('console', lambda m: errs.append('console: ' + m.text[:300]) if m.type == 'error' and not any(s in m.text for s in NOISE) else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
        await pg.goto(BASE + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
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
        await b.close()
    for e in errs[:20]: print('FAIL', e)
    if errs: fail = 1
    print('FAIL' if fail else 'ALL PASSED'); sys.exit(fail)
asyncio.run(run())

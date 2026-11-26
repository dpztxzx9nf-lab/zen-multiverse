# Collision coverage ("if you can see it, it's real"): boot the game headless, walk to each area, and
#  1) audit every visible mesh near the player against the colliders (js/solids-bake.js auditSolids):
#     a solid-looking mesh you can walk through, or a collider with no visible mesh, fails;
#  2) walk into representative buildings and check she stops at the surface (no walking through);
#  3) third person with her back to a wall: the camera must not end up inside it.
#   python3 -m http.server 8090 --bind 127.0.0.1 &  python3 tools/ci/collision.py http://127.0.0.1:8090 [--report out.json] [--shots dir]
import asyncio, json, sys, shutil, os
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/')
REPORT = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = '/index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle&unlock=all&mpserver=http://127.0.0.1:1&device=pc'
NOISE = ('127.0.0.1:1', 'ERR_CONNECTION_REFUSED', 'net::ERR_FAILED')
FRAMES = "(n)=>new Promise((res)=>{let k=0;const f=()=>{if(++k>=n)res(k);else requestAnimationFrame(f)};requestAnimationFrame(f)})"
AUDIT = """(async(near)=>{const m=await import('/js/solids-bake.js');const w=__garden.worlds.current;const g=w.debug.game||w.debug.core||w.debug;
  const pl=g.player;const cols=pl.colliders;const env=pl.env;
  const r=m.auditSolids(w.scene,cols,{ground:(x,z)=>env.top(x,z,pl.position.y+3),env,near});return r})"""
# walk from `d` metres out straight at a point that is really solid, for `secs`. Pass: she ends outside every
# solid, short of the point, and her path never went through a solid (js/solids.js crossesSolid, clear 0).
WALK = """(async([tx,tz,ang,d,secs])=>{const w=__garden.worlds.current;const g=w.debug.game||w.debug.core||w.debug;const pl=g.player;
  const S=await import('/js/solids.js');const c=pl.colliders;const sx=tx+Math.sin(ang)*d, sz=tz+Math.cos(ang)*d; const yaw=Math.atan2(tx-sx,tz-sz);
  if(c.distance(sx,sz,['solid','water'])<0.5)return {skip:true};
  pl.teleport(sx,sz,yaw); pl.aim(yaw,0);
  const sol=c.list.filter(k=>k.kind==='solid');let prev={x:sx,z:sz},through=false,touch=Infinity;
  for(let t=0;t<secs;t+=0.2){pl.sim(0,1,0.2);const e={x:pl.position.x,z:pl.position.z};
    if(S.crossesSolid(sol,prev,e,0))through=true;touch=Math.min(touch,c.distance(e.x,e.z,['solid']));prev=e;}
  return {x:prev.x,z:prev.z,start:[sx,sz],dist:c.distance(prev.x,prev.z,['solid']),touch,through}})"""
async def main():
    errs, fails, out = [], [], {}
    async with async_playwright() as p:
        exe = shutil.which('google-chrome')
        b = await p.chromium.launch(headless=True, args=ARGS, **({'executable_path': exe} if exe else {}))
        pg = await (await b.new_context(viewport={'width': 640, 'height': 360})).new_page()
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
        pg.on('console', lambda m: errs.append('console: ' + m.text[:300]) if m.type == 'error' and not any(s in m.text for s in NOISE) else None)
        await pg.goto(BASE + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
        await pg.evaluate(FRAMES, 60)
        # the targets come from the game itself (js/solids-targets.js), so the test follows the content
        targets = await pg.evaluate("(async()=>{const m=await import('/js/solids-targets.js');return m.walkTargets(__garden.worlds.current)})()")
        audit = await pg.evaluate(AUDIT, {'x': 0, 'z': 0, 'r': 1e9})
        out['audit'] = audit
        s = audit['summary']; print('audit:', json.dumps(s))
        for r in audit['rows']:
            if r['cls'][0].isupper(): fails.append(f"{r['cls']}: {r['path']} at {r['at']} size {r['size']} {r.get('n','')}")
        for c in audit['colliders']:
            if c['cls'][0].isupper(): fails.append(f"{c['cls']}: collider '{c['name']}' ({c['type']}) at {c['at']}")
        out['walks'] = []
        for t in targets:
            shot = False
            for ang in [0.3, 1.87, 3.44, 5.01]:
                r = await pg.evaluate(WALK, [t['x'], t['z'], ang, t['d'], 3])
                if r.get('skip'): continue
                # she must reach the surface (touch) and never pass into anything solid on the way (sliding along is fine)
                ok = r['touch'] < 0.45 and r['dist'] > 0.2 and not r['through']
                out['walks'].append({**t, 'ang': ang, **r, 'ok': ok})
                print(('ok  ' if ok else 'FAIL'), f"walk into {t['name']} from {ang:.2f}: closest {r['touch']:.2f} m, never inside: {not r['through']}")
                if not ok: fails.append(f"walked into {t['name']} (angle {ang:.2f}): {r}")
                if SHOTS and not shot:
                    shot = True; await pg.evaluate(FRAMES, 4); await pg.screenshot(path=os.path.join(SHOTS, f"collision-{t['name']}.png"))
        # third-person camera with her back to each solid: the eye must stay outside it
        cams = await pg.evaluate("""(async(ts)=>{const w=__garden.worlds.current;const g=w.debug.game;const pl=g&&g.player;const av=g&&g.avatar;if(!av||!av.camera)return {skip:'no avatar'};
          av.camera.setMode('third');const out=[];for(const t of ts){const a=0.3,sx=t.x+Math.sin(a)*(t.d-1.2),sz=t.z+Math.cos(a)*(t.d-1.2);
          const toward=Math.atan2(t.x-sx,t.z-sz);if(pl.colliders.distance(sx,sz)<0.5)continue;pl.teleport(sx,sz,toward);pl.aim(toward,0);pl.sim(0,1,3);pl.aim(toward+Math.PI,0);for(let i=0;i<8;i++){await new Promise(r=>requestAnimationFrame(r));}
          const c=w.camera.position;out.push({name:t.name,d:pl.colliders.distanceH(c.x,c.z,c.y,['solid'])})}av.camera.setMode('first');return out})""", targets[:8])
        out['camera'] = cams
        if isinstance(cams, list):
            for c in cams:
                ok = c['d'] > 0.05
                print(('ok  ' if ok else 'FAIL'), f"third-person camera by {c['name']}: {c['d']:.2f} m outside")
                if not ok: fails.append(f"camera inside {c['name']}: {c}")
        await b.close()
    for e in errs[:20]: fails.append(e)
    if REPORT: json.dump(out, open(REPORT, 'w'), indent=1)
    for f in fails[:80]: print('FAIL', f)
    print(f'{len(fails)} failures' if fails else 'ALL PASSED'); sys.exit(1 if fails else 0)
asyncio.run(main())

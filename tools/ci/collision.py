# Collision coverage ("if you can see it, it's real"): boot the game headless, walk to each area, and
#  1) audit every visible mesh near the player against the colliders (js/solids-bake.js auditSolids):
#     a solid-looking mesh you can walk through, or a collider with no visible mesh, fails;
#  2) walk into representative buildings and check she stops at the surface (no walking through);
#  3) third person with her back to a wall: the camera must not end up inside it;
#  4) people and animals are capsules: walking into one stops her, and pressing on she slips past (no walling in).
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
# Wait for the live game player. Do not fall back to w.debug itself: that object is
# always truthy and has no .player, which crashed CI mid-walk ("reading 'colliders'").
PLAY = (
    "async function play(){for(let i=0;i<400;i++){"
    "const w=window.__garden&&__garden.worlds&&__garden.worlds.current;"
    "const g=w&&w.debug&&(w.debug.game||w.debug.core);const pl=g&&g.player;"
    "if(pl&&pl.colliders)return {w,g,pl};"
    "await new Promise(r=>setTimeout(r,25));}"
    "throw new Error('player not ready');}"
)
AUDIT = "(async(near)=>{" + PLAY + """const {w,g,pl}=await play();const m=await import('/js/solids-bake.js');
  const cols=pl.colliders;const env=pl.env;
  const r=m.auditSolids(w.scene,cols,{ground:(x,z)=>env.top(x,z,pl.position.y+3),env,near});return r})"""
# walk from `d` metres out straight at a point that is really solid, for `secs`. Pass: she ends outside every
# solid, short of the point, and her path never went through a solid (js/solids.js crossesSolid, clear 0).
WALK = "(async([tx,tz,ang,d,secs])=>{" + PLAY + """const {w,g,pl}=await play();
  const S=await import('/js/solids.js');const c=pl.colliders;const sx=tx+Math.sin(ang)*d, sz=tz+Math.cos(ang)*d; const yaw=Math.atan2(tx-sx,tz-sz);
  if(c.distance(sx,sz,['solid','water'])<0.5)return {skip:true};
  pl.teleport(sx,sz,yaw); pl.aim(yaw,0);
  const sol=c.list.filter(k=>k.kind==='solid');let prev={x:sx,z:sz},through=false,touch=Infinity;
  for(let t=0;t<secs;t+=0.2){pl.sim(0,1,0.2);const e={x:pl.position.x,z:pl.position.z};
    if(S.crossesSolid(sol,prev,e,0))through=true;touch=Math.min(touch,c.distance(e.x,e.z,['solid','water']));prev=e;}
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
        # Pause the rAF draw loop: software WebGL was rendering every frame in the background and stalling the walks.
        await pg.evaluate("window.__zmNodraw=true")
        # the targets come from the game itself (js/solids-targets.js), so the test follows the content
        targets = await pg.evaluate("(async()=>{const m=await import('/js/solids-targets.js');return m.walkTargets(__garden.worlds.current)})()")
        audit = await pg.evaluate(AUDIT, {'x': 0, 'z': 0, 'r': 1e9})
        out['audit'] = audit
        s = audit['summary']; print('audit:', json.dumps(s))
        for r in audit['rows']:
            if r['cls'][0].isupper(): fails.append(f"{r['cls']}: {r['path']} at {r['at']} size {r['size']} {r.get('n','')}")
        for c in audit['colliders']:
            if c['cls'][0].isupper(): fails.append(f"{c['cls']}: collider '{c['name']}' ({c['type']}) at {c['at']}")
        # movable props (crates, lockers, stations) are rigid bodies with one box from their own meshes; it must turn with them
        rb = await pg.evaluate("""(async()=>{const T=await import('three');const B=await import('/js/solids-bake.js');const S=await import('/js/solids.js');
          const g=new T.Group();const m=new T.Mesh(new T.BoxGeometry(1.2,0.9,0.6),new T.MeshStandardMaterial());m.position.y=0.45;g.add(m);g.position.set(5,0,7);g.rotation.y=0.7;
          B.solid(g,{name:'crate'});const b=B.bodyBox(g);const c=Math.cos(0.7),s=Math.sin(0.7),at=(x,z)=>[5+x*c+z*s,7-x*s+z*c];
          return {a:S.shapeDist(b,...at(0.55,0)),b:S.shapeDist(b,...at(0,0.35)),h:b.h}})()""")
        out['rigid'] = rb
        rok = rb['a'] < 0 and rb['b'] > 0 and abs(rb['h'] - 0.9) < 0.01
        print(('ok  ' if rok else 'FAIL'), f"rigid-body box turns with its prop: {rb}")
        if not rok: fails.append(f"bodyBox does not follow its mesh: {rb}")
        out['walks'] = []
        for t in targets:
            shot = False
            for ang in [0.3, 1.87, 3.44, 5.01]:
                r = await pg.evaluate(WALK, [t['x'], t['z'], ang, t['d'], max(3, t['d'] / 2)])
                if r.get('skip'): continue
                # she must reach the surface (touch) and never pass into anything solid on the way (sliding along is fine)
                ok = r['touch'] < 0.45 and r['dist'] > 0.2 and not r['through']
                out['walks'].append({**t, 'ang': ang, **r, 'ok': ok})
                print(('ok  ' if ok else 'FAIL'), f"walk into {t['name']} from {ang:.2f}: closest {r['touch']:.2f} m, never inside: {not r['through']}")
                if not ok: fails.append(f"walked into {t['name']} (angle {ang:.2f}): {r}")
                if SHOTS and not shot:
                    shot = True
                    await pg.evaluate("window.__zmNodraw=false")
                    await pg.evaluate(FRAMES, 4)
                    await pg.screenshot(path=os.path.join(SHOTS, f"collision-{t['name']}.png"))
                    await pg.evaluate("window.__zmNodraw=true")
        bod = await pg.evaluate("(async()=>{" + PLAY + """const {w,g,pl}=await play();const c=pl.colliders;
          const S=await import('/js/solids.js');const sx=22,sz=-14;if(c.distance(sx,sz+1.5,['solid','water'])<1)return {skip:'not open'};
          pl.teleport(sx,sz,0);pl.aim(0,0);c.setBodies('ci',[S.bodyShape('person',sx,sz+1.5,pl.position.y)]);
          pl.sim(0,1,1);const stop=pl.position.z;pl.sim(0,1,3);const past=pl.position.z;c.setBodies('ci',[]);
          return {stop,past,limit:sz+1.5-S.BODY_R.person}})()""")
        out['bodies'] = bod
        if not bod.get('skip'):
            bok = bod['stop'] < bod['limit'] and bod['past'] > bod['limit'] + 1
            print(('ok  ' if bok else 'FAIL'), f"walking into a person stops her (z {bod['stop']:.2f} < {bod['limit']:.2f}), pressing on she slips past (z {bod['past']:.2f})")
            if not bok: fails.append(f"bodies: {bod}")
        else: fails.append(f"bodies: {bod}")
        # third-person camera with her back to each solid: the eye must stay outside it (needs a live draw loop)
        await pg.evaluate("window.__zmNodraw=false")
        await pg.evaluate(FRAMES, 4)
        cams = await pg.evaluate("(async(ts)=>{" + PLAY + """const {w,g,pl}=await play();const av=g&&g.avatar;if(!av||!av.camera)return {skip:'no avatar'};
          av.camera.setMode('third');const out=[];for(const t of ts){const {pl,w}=await play();const a=0.3,sx=t.x+Math.sin(a)*(t.d-1.2),sz=t.z+Math.cos(a)*(t.d-1.2);
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

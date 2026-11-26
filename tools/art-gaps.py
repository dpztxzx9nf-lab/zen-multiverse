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
                await pg.wait_for_timeout(2900); await shot(pg, f'{dev}-loading')
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
            if 'panels' in VIEWS:  # the tip card, the lock hint, the Play together chip and its panel
                await stand(pg, -6, 9, 1.5, 1.0, -0.5, 1200)
                print('mp', await ev(pg, "(()=>{const c=document.querySelector('#mp .chip'); if(!c) return 'none'; c.click(); return 'clicked'})()"), flush=True)
                await pg.wait_for_timeout(900)
                await shot(pg, f'{dev}-panels')
                await ev(pg, "(()=>{const c=document.querySelector('#mp .chip'); if(c) c.click(); return 1})()")
            if 'planet' in VIEWS:
                for s in ([int(os.environ['SEED'])] if os.environ.get('SEED') else [34]):
                    await ev(pg, f"window.__garden.worlds.go('planet', {{ from: 'warp', seed: {s} }}).then(() => true)")
                await pg.wait_for_timeout(4000)
                await ev(pg, "(()=>{const d=__garden.worlds.current.debug; d.player.aim(d.player.heading, -0.05); return 1})()")
                await pg.wait_for_timeout(2500); await shot(pg, f'{dev}-planet-far')
                await ev(pg, "(()=>{const d=__garden.worlds.current.debug; d.player.aim(d.player.heading+1.6, -0.55); return 1})()")
                await pg.wait_for_timeout(2500); await shot(pg, f'{dev}-planet-ground')
                if 'far' in VIEWS:  # across water to a far shore: the impostor forest
                    sea = await ev(pg, """(()=>{const d=__garden.worlds.current.debug,W=d.W,ox=d.player.position.x,oz=d.player.position.z;
                      for(let r=20;r<1500;r+=15)for(let k=0;k<24;k++){const a=k/24*6.283,x=ox+Math.sin(a)*r,z=oz+Math.cos(a)*r;if(W.height(x,z)>W.sea-2)continue;
                        for(let t=0;t<80;t++){const xx=x-Math.sin(a)*t,zz=z-Math.cos(a)*t;if(W.height(xx,zz)>W.sea+1.5){return [xx-Math.sin(a)*4,zz-Math.cos(a)*4,a]}}}return null})()""")
                    if sea:
                        await ev(pg, f"(async()=>{{const d=__garden.worlds.current.debug;d.player.teleport({sea[0]},{sea[1]},{sea[2]});d.player.snapCamera();await d.trek(0.01,0.01,2);d.player.aim({sea[2]},-0.02);return 1}})()")
                        await pg.wait_for_timeout(3500); await shot(pg, f'{dev}-far-trees')
                        if os.environ.get('PROBE'):
                            await ev(pg, "(()=>{__garden.worlds.current.scene.traverse(o=>{if(o.name==='impostors')o.visible=false}); return 1})()"); await pg.wait_for_timeout(800); await shot(pg, f'{dev}-far-noimp')
                            await ev(pg, "(()=>{const s=__garden.worlds.current.scene; s.traverse(o=>{if(o.name==='impostors')o.visible=true}); s.userData.fogWas=s.fog; s.fog=null; return 1})()"); await pg.wait_for_timeout(1500); await shot(pg, f'{dev}-far-nofog')
                        print('impProbe', dev, json.dumps(await ev(pg, "(()=>{const d=__garden.worlds.current.debug; return d.impProbe ? d.impProbe() : null})()")), flush=True)
                if 'sea' in VIEWS:  # dive: sea plants on the bed and a school of fish
                    sp = await ev(pg, """(()=>{const d=__garden.worlds.current.debug,W=d.W,ox=d.player.position.x,oz=d.player.position.z;
                      for(let r=20;r<1500;r+=15)for(let k=0;k<24;k++){const a=k/24*6.283,x=ox+Math.sin(a)*r,z=oz+Math.cos(a)*r;const h=W.height(x,z);if(h>W.sea-3||h<W.sea-7)continue;return [x,z,a]}return null})()""")
                    if sp:
                        P = '__garden.worlds.current.debug.player'
                        await ev(pg, f"(async()=>{{const d=__garden.worlds.current.debug;d.player.teleport({sp[0]},{sp[1]},{sp[2]});d.player.snapCamera();await d.trek(0.01,0.01,2);return 1}})()")
                        await pg.wait_for_timeout(1500)
                        await ev(pg, f"(()=>{{const p={P}; p.aim(p.heading,-0.7); for(let i=0;i<120;i++) p.step(1/30,0,1,0,{{crouch:true}}); p.aim(p.heading,-0.35); return 1}})()")
                        await pg.wait_for_timeout(3000); await shot(pg, f'{dev}-sea-bed')
                        ok = await ev(pg, f"""(()=>{{const d=__garden.worlds.current.debug,L=d.sealife,p={P}; const f=(L.fish||[]).filter(f=>f.alive).sort((a,b)=>a.p.distanceTo(p.position)-b.p.distanceTo(p.position))[0]; if(!f) return 0;
                          const dx=f.p.x-p.position.x,dz=f.p.z-p.position.z; p.aim(Math.atan2(dx,dz), Math.atan2(f.p.y-p.position.y-1.4, Math.hypot(dx,dz))); return 1}})()""")
                        await pg.wait_for_timeout(1500)
                        if ok: await shot(pg, f'{dev}-sea-fish')
                if 'ui' in VIEWS:  # a planted beacon, close
                    at = await ev(pg, """(()=>{const d=__garden.worlds.current.debug; if(!d.plantBeacon) return null; d.game.add('beacon',1); const b=d.plantBeacon(); if(!b) return null;
                      const g=__garden.worlds.current.scene.getObjectByName('beacons'); const o=g&&g.children[g.children.length-1]; if(!o) return null;
                      const p=new (o.position.constructor)(); o.getWorldPosition(p); return [p.x,p.y,p.z]})()""")
                    if at:
                        await ev(pg, f"(()=>{{const d=__garden.worlds.current.debug; d.player.teleport({at[0]}+5.5,{at[2]}+2.5,0); d.player.snapCamera(); return 1}})()")
                        await pg.wait_for_timeout(1200)
                        await ev(pg, f"(()=>{{const d=__garden.worlds.current.debug, q=d.player.position; d.player.aim(Math.atan2({at[0]}-q.x,{at[2]}-q.z), 0.12); return 1}})()")
                        await pg.wait_for_timeout(2000); await shot(pg, f'{dev}-beacon')
                    else: print('no beacon', flush=True)
            await ctx.close()
        await b.close()
    print('ERRORS', json.dumps(errors[:20], indent=1))
asyncio.run(run())

# Factions in the browser (offline, then online against a local wrangler dev if MP is set).
# usage: MG_DIR=/workspace/zm-factions bash /workspace/mom-garden-tools/serve.sh tools/factions-shoot.py
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright
BASE = sys.argv[1]
ROOT = os.environ.get('MG_DIR', '/workspace/zm-factions'); OUT = ROOT + '/shots/'
os.makedirs(OUT, exist_ok=True)
MP = os.environ.get('MP')
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&device=tablet&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume'
errors = []
async def ev(pg, js, label=None):
    r = await pg.evaluate(js)
    if label: print(label, json.dumps(r)[:600])
    return r
async def stand(pg, x, z, lx, ly, lz):
    await ev(pg, f"(()=>{{const g=__garden.game;g.player.teleport({x},{z},0);g.player.lookAtPoint({lx},{ly},{lz});g.player.snapCamera();return 1}})()")
    await pg.wait_for_timeout(1500)
async def close_dlg(pg):
    for _ in range(8):
        vis = await ev(pg, "(()=>{const d=document.getElementById('hud-dialog'); return !!d && !d.classList.contains('hidden')})()")
        if not vis: return
        await pg.click('#hud-dialog'); await pg.wait_for_timeout(250)
async def shot(pg, name):
    await pg.screenshot(path=OUT + name + '.png'); print('shot', name)
async def boot(b, q=Q):
    ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'))
    await pg.goto(BASE + '/' + q, wait_until='commit', timeout=600000)
    await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__factions", timeout=600000)
    await pg.wait_for_timeout(2500)
    return ctx, pg
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        ctx, pg = await boot(b)
        await pg.wait_for_function("__factions.state.mode==='local' && __factions.state.n===10", timeout=60000)
        print('offline mode', await ev(pg, "__factions.state.mode"))
        # the camp from the trail
        await stand(pg, -14, 24, -29, 1.4, 37.5); await shot(pg, 'fa-warden-camp')
        await stand(pg, 26, 12, 40, 1.4, 25); await shot(pg, 'fa-reaver-post')
        # Sela, hurt on the trail
        await stand(pg, -39.0, -12.4, -41, 0.6, -14); await shot(pg, 'fa-sela-hurt')
        print('prompt', await ev(pg, "__garden.game.info().prompt"), await ev(pg, "__garden.game.interact.labels"))
        await ev(pg, "__factions.act('help','w-sela')"); await pg.wait_for_timeout(1200); await shot(pg, 'fa-sela-helped')
        t_help = time.time()
        # Brann in the gully: spare him
        await stand(pg, 10.6, 42.6, 10.5, 0.3, 44.2); await shot(pg, 'fa-brann-downed')
        print('labels', await ev(pg, "__garden.game.interact.labels"))
        await ev(pg, "__factions.act('spare','r-brann')"); await pg.wait_for_timeout(800)
        # the lost pack: pick it up and bring it to Ivo
        await stand(pg, -12, -42.6, -12, 0.2, -44); await ev(pg, "__factions.act('take','pack-ivo')"); await pg.wait_for_timeout(600)
        print('carrying', await ev(pg, "__factions.state.carrying"))
        # wait for Sela to limp home and tell them
        await stand(pg, -27.5, 33.5, -29.5, 1.5, 36.8)
        for i in range(60):
            await pg.wait_for_timeout(3000)
            tk = await ev(pg, "__factions.talk('w-maren')")
            await close_dlg(pg)
            if tk and 'teach' in tk.get('offers', []): break
        print(f'Maren after {int(time.time()-t_help)} s:', json.dumps(tk)[:400])
        await ev(pg, "__factions.talk('w-maren')"); await pg.wait_for_timeout(700); await shot(pg, 'fa-maren-talks')
        await close_dlg(pg)
        await ev(pg, "__factions.learn('w-maren')"); await pg.wait_for_timeout(700); await shot(pg, 'fa-maren-teaches')
        await close_dlg(pg)
        # bring Ivo his pack (he walks a loop; meet him where he is)
        at = await ev(pg, "__factions.state.npcs.find(n=>n.id==='w-ivo').at")
        await stand(pg, at[0] + 1.2, at[1] + 0.6, at[0], 1.4, at[1])
        at = await ev(pg, "__factions.state.npcs.find(n=>n.id==='w-ivo').at")
        await stand(pg, at[0] + 1.0, at[1] + 0.5, at[0], 1.4, at[1])
        await ev(pg, "__factions.act('return','w-ivo')"); await pg.wait_for_timeout(800); await shot(pg, 'fa-ivo-pack')
        # reading tracks: Kesh's prints on the patrol path
        k = await ev(pg, "__factions.state.npcs.find(n=>n.id==='r-kesh').at")
        await stand(pg, k[0] - 6, k[1] - 6, k[0], 0, k[1]); await shot(pg, 'fa-kesh-prints')
        st = await ev(pg, "__factions.state", 'state')
        # reload: the camp and what you learned are still there
        await pg.reload(wait_until='commit')
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__factions && __factions.state.mode==='local' && __factions.state.n===10", timeout=600000)
        st2 = await ev(pg, "__factions.state", 'after reload')
        print('PERSIST', 'tracking' in st2['known'], [n for n in st2['npcs'] if n['id'] in ('w-sela', 'r-brann', 'w-maren')])
        await ctx.close()
        if MP:
            ctx, pg = await boot(b, Q + '&mp=1&mpserver=' + MP)
            tag = str(int(time.time()))
            await ev(pg, f"__net.signInDev('brock+fa{tag}@example.com','Brock').then(r=>r.account)", 'signed in')
            await stand(pg, -14, 24, -29, 1.4, 37.5)
            await pg.wait_for_function("__factions.state.mode==='server' && __factions.state.n===10", timeout=90000)
            print('online', await ev(pg, "__factions.state.mode"), await ev(pg, "__net.state.world"))
            await stand(pg, -39.0, -12.4, -41, 0.6, -14)
            await pg.wait_for_timeout(2500)
            await ev(pg, "__factions.act('help','w-sela')"); await pg.wait_for_timeout(1500)
            print('online state', json.dumps(await ev(pg, "__factions.state"))[:500])
            await shot(pg, 'fa-online-sela')
            await ctx.close()
        await b.close()
    print('ERRORS', json.dumps(errors[:20], indent=1))
asyncio.run(run())

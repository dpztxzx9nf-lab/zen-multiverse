# Hotbar check: the tool row must not list an item twice, in the garden or on the home Earth planet.
#   MG_DIR=<repo> bash /workspace/mom-garden-tools/serve.sh tools/hotbar-check.py [shot-prefix]
import asyncio, json, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1]; SHOT = sys.argv[2] if len(sys.argv) > 2 else None
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
Q = 'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&noresume&nothrottle&unlock=all&mpserver=http://127.0.0.1:1&device=pc'
LIST = """(async()=>{const {equip}=await import('/js/game/equip.js');return equip.list().map(i=>i.id+':'+(typeof i.label==='function'?i.label():i.label))})()"""
async def run():
    errors, fail = [], 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        pg = await (await b.new_context(viewport={'width': 1280, 'height': 720})).new_page()
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR {e}'[:300]))
        await pg.goto(BASE + '/' + Q, wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
        await pg.evaluate("(async()=>{const {game}=await import('/js/game/store.js');const g=game.data;g.g7=g.g7||{};g.g7.tools=Object.assign(g.g7.tools||{},{build:1,spear:1,rod:1,pick:1,axe:1});return 1})()")
        await pg.wait_for_timeout(1500)
        for where in ['garden', 'planet', 'back']:
            if where == 'planet':
                await pg.evaluate("(async()=>{const m=await import('/js/universe/home.js');const s=m.homeBody('earth').body.seed;await __garden.worlds.go('planet',{from:'warp',seed:s,dim:'prime'});return 1})()")
                await pg.wait_for_timeout(6000)
            if where == 'back':
                await pg.evaluate("__garden.worlds.go('earth',{from:'visit'}).then(()=>1)")
                await pg.wait_for_timeout(4000)
            ids = await pg.evaluate(LIST)
            bars = await pg.evaluate("[...document.querySelectorAll('#g7-bar')].filter(b=>getComputedStyle(b).opacity!=='0'&&b.children.length).length")
            if bars > 1: print('  ', bars, 'tool rows visible at once'); fail = 1
            labels = [x.split(':', 1)[1].split(' ')[0] for x in ids]
            dup = sorted({l for l in labels if labels.count(l) > 1})
            print(where, ids, 'DUPLICATES' if dup else 'ok', dup or '')
            if dup: fail = 1
            if where != 'planet' and any(x.split(':')[0] in ('drill', 'skin', 'hands', 'build', 'pick') for x in ids): print('  planet tools leaked into the garden'); fail = 1
            if where != 'planet' and not any(x.startswith('build-garden') for x in ids): print('  garden build tool missing'); fail = 1
            if SHOT:
                await pg.evaluate("(()=>{const t=document.querySelector('.tipcard, #tips');if(t)t.remove();return 1})()")
                await pg.screenshot(path=f'{SHOT}{where}.png', timeout=240000)
        await b.close()
    print('ERRORS', json.dumps(errors[:10]))
    print('FAIL' if fail else 'ALL PASSED')
asyncio.run(run())

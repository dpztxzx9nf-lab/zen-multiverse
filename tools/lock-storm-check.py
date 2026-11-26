# Pointer-lock storm check: in headless Chrome every pointer lock request is refused, which is the
# condition that made 0.2.14 retry from 'pointerlockerror' forever (all night on Brock's PC). Asks for
# the lock a few times and counts pointerlockerror events: must stay small, not thousands.
#   MG_DIR=<repo> bash /workspace/mom-garden-tools/serve.sh tools/lock-storm-check.py
import asyncio, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1]
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        pg = await (await b.new_context(viewport={'width': 480, 'height': 270})).new_page()
        await pg.add_init_script("window.__plErr=0;document.addEventListener('pointerlockerror',()=>{window.__plErr++});Element.prototype.requestPointerLock=function(){setTimeout(()=>document.dispatchEvent(new Event('pointerlockerror')),0);return Promise.reject(new DOMException('refused','NotAllowedError'))};")
        await pg.goto(BASE + '/index.html?game=1&mode=walk&debug&noadapt&noresume&nothrottle&mpserver=http://127.0.0.1:1&device=pc', wait_until='commit', timeout=600000)
        await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game", timeout=600000)
        n = await pg.evaluate("(async()=>{const m=await import('/js/game/interact.js');const c=document.querySelector('canvas');for(let i=0;i<3;i++){await m.requestLock(c);await new Promise(r=>setTimeout(r,300))}await new Promise(r=>setTimeout(r,2000));return window.__plErr})()")
        print('pointerlockerror events after 3 requests:', n)
        await b.close()
        ok = n <= 12
        print('PASS' if ok else 'FAIL: pointer lock retry loop'); sys.exit(0 if ok else 1)
asyncio.run(run())

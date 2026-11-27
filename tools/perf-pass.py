# Perf pass (release checklist): cold load time and frame cost at the same three
# views, for one or more builds served side by side. From 0.2.34 the views are on
# the home Earth globe (city plaza, a stand of trees, the starter Rattler camp),
# not the old painted garden. SwiftShader on the box is a CPU rasterizer: compare
# builds, don't read the ms as phone or laptop ms.
#   python3 tools/perf-pass.py name=http://127.0.0.1:PORT [name2=URL2 ...]   -> JSON on stdout
import asyncio, json, sys, time
from playwright.async_api import async_playwright
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
# no noresume: a fresh profile has no save, so enterHub boots the real 0.2.34 home planet
Q = 'index.html?game=1&mode=walk&hour=15.5&weather=clear&season=summer&debug&noadapt&fastdt&nothrottle&mpserver=http://127.0.0.1:1&device='
GO = """async ({ x, z, lx, ly, lz }) => {
  const w = window.__garden && window.__garden.worlds && window.__garden.worlds.current;
  const p = window.__garden && window.__garden.player;
  if (!w || !p) return null;
  const q = w.where && w.where();
  if (q && w.restoreWhere) w.restoreWhere({ ...q, x, z, yaw: Math.atan2((lx ?? x) - x, (lz ?? z) - z) });
  else { p.teleport(x, z, Math.atan2((lx ?? x) - x, (lz ?? z) - z)); if (p.snapCamera) p.snapCamera(); }
  if (p.lookAtPoint) p.lookAtPoint(lx, ly, lz);
  if (p.snapCamera) p.snapCamera();
  return { x, z, id: window.__garden.worlds.currentId };
}"""
PICK = """async () => {
  const g = window.__garden, W = g && g.W, p = g && g.player;
  if (!W || !p) return null;
  const hub = g.gotoHub ? g.gotoHub() : null;
  const hx = (hub && hub.x) || 294.21, hz = (hub && hub.z) || 222.02, hy = (W.height && W.height(hx, hz)) || 8;
  const city = { x: hx, z: hz, lx: hx + Math.sin(310 * Math.PI / 180) * 18, ly: hy + 1.6, lz: hz + Math.cos(310 * Math.PI / 180) * 18 };
  let trees = { x: 242.78, z: 160.74, lx: 242.78, ly: ((W.height && W.height(242.78, 160.74)) || 8) + 3, lz: 160.74 - 8 };
  for (let r = 80; r <= 280; r += 40) {
    let found = false;
    for (let a = 0; a < 8; a++) {
      const x = hx + Math.sin(a * Math.PI / 4) * r, z = hz + Math.cos(a * Math.PI / 4) * r;
      const y = W.height ? W.height(x, z) : 0;
      const b = W.dominant ? String(W.dominant(W.biomesAt(x, z, y)) || '') : '';
      const inCity = Math.hypot(x - hx, z - hz) < 70;
      if (!inCity && /forest|wood|pine|taiga|grove|jungle|boreal/i.test(b)) {
        trees = { x, z, lx: x, ly: y + 4, lz: z - 8, biome: b };
        found = true;
        break;
      }
    }
    if (found) break;
  }
  let camp = null;
  try {
    const { starterRattlerNear } = await import('/js/game/jigsaw.js');
    const { HUB_SPAWN, inHub, EARTH_SITE } = await import('/js/hub.js');
    const site = starterRattlerNear({
      seed: W.seed, tile: W.tile || EARTH_SITE.tile, hubX: HUB_SPAWN.x, hubZ: HUB_SPAWN.z,
      ground: (x, z) => W.height(x, z), blocked: (x, z) => inHub(x, z, W.tile || EARTH_SITE.tile),
      hasSea: W.hasSea, sea: W.sea,
    });
    if (site) camp = { x: site.x - 18, z: site.z - 18, lx: site.x, ly: (W.height(site.x, site.z) || 0) + 2, lz: site.z, at: [+site.x.toFixed(1), +site.z.toFixed(1)] };
  } catch (e) { camp = { error: String(e && e.message || e) }; }
  if (!camp || camp.error) camp = { x: 126.29, z: 68.56, lx: 140, ly: 12, lz: 80, fallback: true, error: camp && camp.error };
  return { city, trees, camp, seed: W.seed, tile: W.tile };
}"""
FM = "(ms)=>new Promise((res)=>{let n=0,t0=performance.now();const f=()=>{n++; if(performance.now()-t0<ms) requestAnimationFrame(f); else res(+((performance.now()-t0)/n).toFixed(1));}; requestAnimationFrame(f);})"
async def one(b, base, device, vp):
    ctx = await b.new_context(viewport=vp); pg = await ctx.new_page()
    nbytes = [0]
    cdp = await ctx.new_cdp_session(pg); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    cdp.on('Network.loadingFinished', lambda e: nbytes.__setitem__(0, nbytes[0] + e.get('encodedDataLength', 0)))
    t0 = time.time()
    await pg.goto(base + '/' + Q + device, wait_until='commit', timeout=600000)
    await pg.wait_for_function("document.getElementById('veil').classList.contains('gone') && window.__garden && window.__garden.game && window.__garden.worlds && window.__garden.worlds.currentId === 'planet'", timeout=600000, polling=100)
    load = time.time() - t0
    await pg.wait_for_timeout(3000)
    views = await pg.evaluate(PICK)
    out = {'load_s': round(load, 1), 'MB': round(nbytes[0] / 1e6, 1), 'views': views}
    for name in ('city', 'trees', 'camp'):
        v = (views or {}).get(name)
        if not v or v.get('x') is None:
            out[name + '_ms'] = None
            continue
        await pg.evaluate(GO, v)
        await pg.wait_for_timeout(2000)
        out[name + '_ms'] = await pg.evaluate(FM, 6000)
    out['garden_ms'] = out.get('city_ms')
    out['heapMB'] = await pg.evaluate("performance.memory?Math.round(performance.memory.usedJSHeapSize/1e6):null")
    out['tris'] = await pg.evaluate("(__garden.renderer && __garden.renderer.info && __garden.renderer.info.render.triangles) || null")
    await ctx.close(); return out
async def run():
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=ARGS)
        for rnd in range(2):  # alternate builds twice to even out box noise
            for arg in sys.argv[1:]:
                name, base = arg.split('=', 1)
                for device, vp in [('phone', {'width': 844, 'height': 390}), ('pc', {'width': 1280, 'height': 720})]:
                    r = await one(b, base, device, vp)
                    key = f'{name}/{device}'
                    res.setdefault(key, []).append(r)
                    print(name, device, rnd, json.dumps(r), file=sys.stderr, flush=True)
        await b.close()
    print(json.dumps(res, indent=1))
asyncio.run(run())

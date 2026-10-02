import asyncio,sys,os
from playwright.async_api import async_playwright
async def run(mode,shot):
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await b.new_page(viewport={'width':1000,'height':900})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:errs.append('console:'+m.text) if m.type=='error' else None)
        await pg.goto('file://'+os.path.abspath('dist/hoops2k27-hub.html')+'');await pg.wait_for_timeout(800)
        await pg.evaluate(f"document.querySelector(\x27button[data-g=\"{mode}\"][data-my=\"0\"][data-mp=\"0\"]\x27).click()");await pg.wait_for_timeout(1500)
        await pg.evaluate("document.getElementById('tip').click()");await pg.wait_for_timeout(1500)
        for k in['KeyD','KeyD','KeyW','KeyX']:
            await pg.keyboard.down(k);await pg.wait_for_timeout(500);await pg.keyboard.up(k)
        await pg.keyboard.down('Space');await pg.wait_for_timeout(500);await pg.keyboard.up('Space');await pg.wait_for_timeout(1500)
        gl=await pg.evaluate('(typeof GL!=="undefined"&&GL?"webgl":"canvas")+"+"+(typeof RAP!=="undefined"&&RAP?"rapier":"oldphysics")')
        await pg.screenshot(path=shot);print(mode,gl,errs[:5]);await b.close()
asyncio.run(run(sys.argv[1],sys.argv[2]))

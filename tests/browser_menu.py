import asyncio,os
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
        errs=[]
        for name,vp in[('desk',{'width':1100,'height':800}),('mob',{'width':390,'height':780})]:
            pg=await b.new_page(viewport=vp);pg.on('pageerror',lambda e:errs.append(str(e)))
            await pg.goto('file://'+os.path.abspath('dist/hoops2k27-hub.html')+'');await pg.wait_for_timeout(1800)
            await pg.screenshot(path=f'docs/hub_{name}.png',timeout=120000)
            if name=='desk':
                await pg.evaluate("document.querySelector('nav button[data-t=log]').click()");await pg.wait_for_timeout(900)
                await pg.screenshot(path='docs/hub_log.png',timeout=120000)
                await pg.evaluate("document.querySelector('nav button[data-t=play]').click()")
                await pg.evaluate("document.querySelector('button[data-g=\"5v5-3d\"]').click()");await pg.wait_for_timeout(1500)
                print('game menu ok:',await pg.evaluate("!!document.getElementById('tip')"))
        print('errors',errs[:3]);await b.close()
asyncio.run(main())

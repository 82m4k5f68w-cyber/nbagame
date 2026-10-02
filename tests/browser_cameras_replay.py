import asyncio,os
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await b.new_page(viewport={'width':1000,'height':600})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
        await pg.goto('file://'+os.path.abspath('dist/hoops2k27-hub.html')+'');await pg.wait_for_timeout(800)
        await pg.evaluate("document.querySelector('button[data-g=\"5v5-3d\"]:not([data-my])').click()");await pg.wait_for_timeout(1500)
        await pg.evaluate("document.getElementById('tip').click()");await pg.wait_for_timeout(500)
        # run sim fast: skip inbound and play 5 sim-seconds, render a few frames
        await pg.evaluate("inb=0;for(let i=0;i<300;i++)upd(1/60);GL.render()")
        r=await pg.evaluate("({rec:REC.length,withQ:REC.filter(f=>f.p[0][4]).length})");print('recorded',r)
        for m in [1,2,3]:
            await pg.evaluate(f"CAMM={m};for(let i=0;i<12;i++)GL.render()");await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'docs/cam{m}.png',clip={"x":20,"y":0,"width":960,"height":540},timeout=120000)
        # force a replay
        await pg.evaluate("CAMM=0;RQ=1;rs=.001;upd(1/60);")
        st=await pg.evaluate("!!RPL");print('replay started',st)
        await pg.evaluate("for(let i=0;i<40;i++)upd(1/60);GL.render()");await pg.wait_for_timeout(300)
        await pg.screenshot(path='docs/rpl.png',clip={"x":20,"y":0,"width":960,"height":540},timeout=120000)
        await pg.evaluate("RPL.i=1e9;upd(1/60);for(let i=0;i<5;i++)upd(1/60)")
        print('replay ended',await pg.evaluate("!RPL"),'errors',errs[:3]);await b.close()
asyncio.run(main())

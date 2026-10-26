// LIFE stylesheet (injected once; everything scoped under #life). Same palette as the hub: ink #06070e, panels
// #0b0d1b, gold #ffd23f, orange #e8541e. Big-text (.big) and colour-blind (.cb) variants; reduced motion (.rm).
export const LIFE_CSS = `
#life{position:fixed;inset:0;z-index:40;background:#06070e;color:#fff;font:500 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;--gold:#ffd23f;--org:#e8541e;--ok:#3ddc84;--bad:#ff5a4f;--pn:#0b0d1bee;--ln:#ffffff1f}
#life.cb{--ok:#4fb3ff;--bad:#ffb000}
#life.big{font-size:17px}
#life.rm *{animation:none!important;transition:none!important}
#life canvas.w3{position:absolute;inset:0;width:100%;height:100%;display:block}
#life .fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s;z-index:30}
#life .fade.on{opacity:1;pointer-events:auto}
#life button{font:inherit;color:inherit;cursor:pointer}
#life .hud{position:absolute;left:12px;top:12px;z-index:5;display:flex;flex-direction:column;gap:6px;pointer-events:none;max-width:min(320px,60vw)}
#life .clk{display:flex;align-items:baseline;gap:8px;background:var(--pn);border:1px solid var(--ln);border-radius:14px;padding:8px 12px;backdrop-filter:blur(8px)}
#life .clk b{white-space:nowrap;font:800 22px system-ui;font-variant-numeric:tabular-nums;letter-spacing:.5px}
#life .clk small{opacity:.75;font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase}
#life .bars{background:var(--pn);border:1px solid var(--ln);border-radius:14px;padding:8px 12px;display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;align-items:center;font:700 11px system-ui}
#life .bars i{height:7px;border-radius:4px;background:#ffffff1a;overflow:hidden;display:block;min-width:90px}
#life .bars i>u{display:block;height:100%;border-radius:4px;transition:width .4s}
#life .bars em{font-style:normal;font-variant-numeric:tabular-nums;opacity:.85}
#life .chips{display:flex;gap:6px;flex-wrap:wrap}
#life .chip{background:var(--pn);border:1px solid var(--ln);border-radius:999px;padding:4px 10px;font:800 12px system-ui;font-variant-numeric:tabular-nums}
#life .chip.warn{border-color:var(--bad);color:var(--bad)}
#life .mini{position:absolute;right:12px;top:12px;z-index:5;width:170px;height:170px;border-radius:50%;overflow:hidden;border:2px solid #ffffff40;box-shadow:0 6px 24px #0008;background:#1d2a1d}
#life .mini canvas{width:100%;height:100%;display:block}
#life .obj{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:5;background:var(--pn);border:1px solid #ffd23f55;border-radius:12px;padding:7px 14px;font:700 13px system-ui;max-width:min(560px,calc(100vw - 420px));text-align:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#life .obj b{color:var(--gold)}
@media (max-width:820px){#life .obj{top:auto;bottom:96px;max-width:calc(100vw - 24px)}#life .mini{width:118px;height:118px}}
#life .prompt{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:10px;background:#000c;border:1px solid #ffffff40;border-radius:999px;padding:8px 16px 8px 8px;font:800 15px system-ui;animation:lpop .2s both}
#life .prompt kbd{background:var(--gold);color:#111;border-radius:8px;padding:3px 9px;font:900 14px system-ui}
#life .prompt small{display:block;font:600 11px system-ui;opacity:.7}
@keyframes lpop{from{transform:translate(-50%,8px);opacity:0}}
#life .toasts{position:absolute;left:50%;top:58px;transform:translateX(-50%);z-index:20;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
#life .toast{background:#151a33f2;border:1px solid #ffffff2a;border-radius:16px;padding:8px 14px;font:700 13px system-ui;box-shadow:0 8px 30px #0009;display:flex;gap:8px;align-items:center;max-width:min(460px,92vw);animation:tin .3s both}
#life .toast.out{animation:tout .4s both}
@keyframes tin{from{transform:translateY(-14px);opacity:0}}
@keyframes tout{to{transform:translateY(-10px);opacity:0}}
#life .btns{position:absolute;right:14px;bottom:16px;z-index:6;display:flex;gap:10px;align-items:flex-end}
#life .rb{width:58px;height:58px;border-radius:50%;background:#0b0d1bcc;border:2px solid #ffffff40;font:900 13px system-ui;display:grid;place-items:center;box-shadow:0 6px 18px #0007}
#life .rb.big{width:74px;height:74px;background:#ffd23fdd;color:#111;border-color:#fff}
#life .rb.ph{font-size:24px}
#life .tbtns{display:none}
#life.touch .tbtns{display:flex}
#life .stk{position:absolute;z-index:6;width:124px;height:124px;margin:-62px 0 0 -62px;border-radius:50%;border:2px solid #ffffff55;background:#ffffff10;pointer-events:none}
#life .stk i{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:#ffffffaa}
/* panels (places, menus) */
#life .scr{position:absolute;inset:0;z-index:25;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,#141a3acc,#05060dee);backdrop-filter:blur(6px);animation:sin .25s both;padding:16px}
@keyframes sin{from{opacity:0}}
#life .card{width:min(720px,100%);max-height:calc(100vh - 32px);overflow:auto;background:linear-gradient(170deg,#141a36,#0b0d1b 60%);border:1px solid #ffffff22;border-radius:22px;padding:18px 20px 20px;box-shadow:0 30px 80px #000a;animation:cin .3s both}
@keyframes cin{from{transform:translateY(16px) scale(.98);opacity:0}}
#life .card h2{margin:0 0 2px;font:900 26px system-ui;letter-spacing:.5px}
#life .card h3{margin:14px 0 6px;font:800 12px system-ui;letter-spacing:2px;opacity:.7;text-transform:uppercase}
#life .card .sub{opacity:.75;font-weight:600;margin-bottom:12px}
#life .card .hero{display:flex;gap:14px;align-items:center;margin-bottom:6px}
#life .card .hero .ic{font-size:44px;width:68px;height:68px;border-radius:18px;display:grid;place-items:center;background:color-mix(in srgb,var(--c,#2a2f55) 70%,#000);border:1px solid #ffffff30}
#life .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
#life .opt{display:flex;flex-direction:column;gap:2px;text-align:left;background:#ffffff0d;border:1px solid #ffffff22;border-radius:14px;padding:10px 12px;transition:transform .12s,border-color .12s,background .12s}
#life .opt:hover,#life .opt:focus-visible{transform:translateY(-1px);border-color:var(--gold);background:#ffffff16;outline:none}
#life .opt b{font:800 14px system-ui}
#life .opt small{opacity:.7;font-weight:600}
#life .opt .pr{color:var(--gold);font-weight:900}
#life .opt[disabled]{opacity:.4;pointer-events:none}
#life .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}
#life .go{background:linear-gradient(90deg,var(--org),var(--gold));color:#111;border:0;border-radius:14px;padding:12px 22px;font:900 16px system-ui;letter-spacing:.5px;box-shadow:0 8px 24px #e8541e55}
#life .go:focus-visible{outline:3px solid #fff}
#life .gh{background:#1c2140;border:1px solid #3a4280;border-radius:12px;padding:10px 16px;font-weight:800}
#life .gh:focus-visible{outline:2px solid var(--gold)}
#life .note{opacity:.75;font-size:12.5px;line-height:1.45}
#life .tag{display:inline-block;font:800 10px system-ui;letter-spacing:1.5px;padding:3px 7px;border-radius:6px;background:#ffffff1a}
#life .tag.g{background:#3ddc8433;color:var(--ok)}#life .tag.r{background:#ff5a4f33;color:var(--bad)}#life .tag.y{background:#ffd23f33;color:var(--gold)}
#life table{border-collapse:collapse;width:100%;font-size:13px}
#life td,#life th{padding:5px 6px;border-bottom:1px solid #ffffff14;text-align:left}
#life th{font:800 10px system-ui;letter-spacing:1.5px;opacity:.65}
#life .q{font:700 18px system-ui;line-height:1.35;margin:10px 0 12px}
#life .ans{display:grid;gap:8px}
#life .ans button{text-align:left;background:#ffffff0d;border:1px solid #ffffff2a;border-radius:12px;padding:11px 14px;font:700 15px system-ui}
#life .ans button:hover,#life .ans button:focus-visible{border-color:var(--gold);outline:none}
#life .ans button.ok{background:#3ddc8433;border-color:var(--ok)}
#life .ans button.no{background:#ff5a4f33;border-color:var(--bad)}
#life .ans kbd{display:inline-block;width:22px;text-align:center;margin-right:8px;background:#ffffff22;border-radius:6px;font:800 12px system-ui}
#life .slide{font:600 16px/1.5 system-ui;background:#ffffff0a;border:1px solid #ffffff1a;border-radius:16px;padding:16px 18px}
#life .think{display:flex;align-items:center;gap:10px;font-weight:700;opacity:.85}
#life .think i{width:18px;height:18px;border-radius:50%;border:3px solid #ffffff33;border-top-color:var(--gold);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#life .tut{position:absolute;left:12px;bottom:16px;z-index:7;width:min(340px,calc(100vw - 120px));background:#151a33f2;border:1px solid #ffd23f66;border-radius:16px;padding:12px 14px;box-shadow:0 10px 30px #0009;animation:cin .3s both}
#life .tut b{color:var(--gold);font:900 11px system-ui;letter-spacing:2px}
#life .tut p{margin:4px 0 8px;font-weight:600;line-height:1.4}
#life .tut .gh{padding:5px 10px;font-size:12px}
#life.touch .tut{bottom:auto;top:120px}
#life .bar2{height:8px;border-radius:4px;background:#ffffff1a;overflow:hidden}#life .bar2 i{display:block;height:100%;background:linear-gradient(90deg,var(--org),var(--gold))}
#life .av{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font:900 16px system-ui;flex:none}
#life input[type=text],#life input:not([type]){background:#0b0e20;border:1px solid #3a4280;color:#fff;border-radius:10px;padding:9px 12px;font:700 15px system-ui;width:100%}
#life input[type=range]{width:100%;accent-color:#ffd23f}
#life label.f{display:grid;gap:4px;font:800 11px system-ui;letter-spacing:1px;opacity:.9}
#life .sw{width:30px;height:30px;border-radius:50%;border:2px solid #ffffff44}
#life .sw.on{outline:3px solid var(--gold)}
#life .pill{background:#1c2140;border:1px solid #3a4280;border-radius:999px;padding:6px 12px;font:800 12px system-ui}
#life .pill.on{background:linear-gradient(90deg,var(--org),var(--gold));color:#111;border-color:var(--gold)}
/* cutscene card (story moments) */
#life .cut{position:absolute;inset:0;z-index:28;display:flex;align-items:center;justify-content:center;background:#000d;animation:sin .4s both}
#life .cut .cc{max-width:640px;text-align:center;padding:24px}
#life .cut .cc small{font:900 12px system-ui;letter-spacing:4px;color:var(--gold)}
#life .cut .cc h1{font:italic 900 clamp(32px,6vw,58px)/1.05 system-ui;margin:10px 0;background:linear-gradient(180deg,#fff,#ffd23f 60%,#e8541e);-webkit-background-clip:text;background-clip:text;color:transparent}
#life .cut .cc p{font:600 16px/1.5 system-ui;opacity:.9}
/* draft board */
#life .board{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
#life .pk{background:#ffffff0c;border:1px solid #ffffff1c;border-radius:10px;padding:6px 8px;font:700 12px system-ui;opacity:.25;transition:opacity .4s,transform .4s}
#life .pk.on{opacity:1}
#life .pk.me{background:linear-gradient(90deg,#e8541e55,#ffd23f44);border-color:var(--gold);transform:scale(1.04)}
#life .pk b{color:var(--gold);margin-right:6px}
/* ---------------- phone ---------------- */
#life .phone{position:absolute;right:max(18px,calc(50vw - 560px));bottom:12px;z-index:22;width:min(360px,calc(100vw - 24px));height:min(740px,calc(100vh - 24px));border-radius:46px;background:#0a0a0f;padding:11px;box-shadow:0 0 0 2px #2a2a33,0 0 0 5px #111,0 30px 90px #000c;transform:translateY(calc(100% + 40px));transition:transform .38s cubic-bezier(.2,.9,.25,1.05);display:flex}
#life .phone.on{transform:none}
#life .scrn{position:relative;flex:1;border-radius:36px;overflow:hidden;background:#000;display:flex;flex-direction:column}
#life .isl{position:absolute;left:50%;top:9px;transform:translateX(-50%);width:96px;height:26px;border-radius:14px;background:#000;z-index:5}
#life .sbar{height:44px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 26px;font:800 13px system-ui;z-index:4;position:relative}
#life .sbar span:last-child{letter-spacing:1px}
#life .app{flex:1;overflow:auto;position:relative;scrollbar-width:none}
#life .app::-webkit-scrollbar{display:none}
#life .hind{height:22px;flex:none;display:flex;align-items:center;justify-content:center;cursor:pointer}
#life .hind i{width:120px;height:5px;border-radius:3px;background:#ffffffcc}
#life .wall{position:absolute;inset:0;background:radial-gradient(circle at 20% 10%,#ff8a3d66,transparent 55%),radial-gradient(circle at 90% 80%,#4f6bff66,transparent 50%),linear-gradient(160deg,#1b1f3b,#0b0d1b)}
#life .lock{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:70px;gap:4px;cursor:pointer}
#life .lock .t{font:200 78px system-ui;letter-spacing:-2px;line-height:1}
#life .lock .d{font:700 15px system-ui;opacity:.85}
#life .lock .nt{margin-top:22px;width:88%;display:flex;flex-direction:column;gap:6px}
#life .lock .nt div{background:#ffffff22;backdrop-filter:blur(10px);border-radius:16px;padding:8px 12px;font:600 12.5px system-ui}
#life .lock .sw2{position:absolute;bottom:20px;font:700 13px system-ui;opacity:.75;animation:bob 1.6s infinite}
@keyframes bob{50%{transform:translateY(-4px)}}
#life .home{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:16px 8px;padding:20px 16px}
#life .ai{display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;font:600 11px system-ui;position:relative}
#life .ai i{width:58px;height:58px;border-radius:16px;display:grid;place-items:center;font-size:28px;font-style:normal;box-shadow:inset 0 -3px 8px #0003,0 4px 10px #0005}
#life .ai em{position:absolute;right:6px;top:-4px;background:#ff3b30;color:#fff;font:800 11px system-ui;font-style:normal;min-width:20px;height:20px;border-radius:10px;display:grid;place-items:center;padding:0 5px}
#life .ai:focus-visible i{outline:3px solid var(--gold)}
#life .dock{position:absolute;left:12px;right:12px;bottom:10px;display:flex;justify-content:space-around;background:#ffffff26;backdrop-filter:blur(14px);border-radius:28px;padding:10px 6px}
#life .ah{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:6px 14px 10px;background:linear-gradient(#000,#000d);backdrop-filter:blur(10px)}
#life .ah b{font:800 20px system-ui;flex:1}
#life .ah button{background:none;border:0;color:#4fa3ff;font:700 15px system-ui;padding:4px}
#life .li{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #ffffff12;background:none;border-left:0;border-right:0;border-top:0;width:100%;text-align:left}
#life .li .tx{flex:1;min-width:0}
#life .li .tx b{display:block;font:700 14px system-ui}
#life .li .tx span{display:block;font:500 12.5px system-ui;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#life .li .dot{width:9px;height:9px;border-radius:50%;background:#4fa3ff}
#life .msgs{display:flex;flex-direction:column;gap:6px;padding:10px 12px 90px}
#life .bub{max-width:78%;padding:8px 12px;border-radius:18px;font:500 14px/1.35 system-ui;background:#26262c;align-self:flex-start;animation:cin .25s both}
#life .bub.me{align-self:flex-end;background:#1f7cff}
#life .reps{position:sticky;bottom:0;display:flex;flex-direction:column;gap:6px;padding:10px 12px;background:#000e;border-top:1px solid #ffffff1a}
#life .reps button{background:#1f2433;border:1px solid #ffffff2a;border-radius:16px;padding:8px 12px;text-align:left;font:600 13.5px system-ui}
#life .post{padding:11px 14px;border-bottom:1px solid #ffffff14;display:flex;gap:10px;animation:cin .3s both}
#life .post .pa{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;font:900 15px system-ui;color:#fff}
#life .post .pb{flex:1;min-width:0}
#life .post .ph2{font:600 13px system-ui;opacity:.95;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
#life .post .ph2 b{font-weight:800}
#life .post .ph2 span{opacity:.55}
#life .post .px{font:500 14.5px/1.4 system-ui;margin:3px 0 6px;word-wrap:break-word}
#life .post .pf{display:flex;gap:18px;font:600 12px system-ui;opacity:.65}
#life .post .rep{margin-top:6px;border-left:2px solid #ffffff22;padding-left:10px;display:flex;flex-direction:column;gap:5px;font:500 13px system-ui}
#life .post .rep b{font-weight:800}
#life .vf{display:inline-grid;place-items:center;width:14px;height:14px;border-radius:50%;background:#1d9bf0;color:#fff;font:900 9px system-ui}
#life .shim{height:74px;margin:10px 14px;border-radius:14px;background:linear-gradient(90deg,#ffffff0d 20%,#ffffff22 50%,#ffffff0d 80%);background-size:300% 100%;animation:shim 1.2s infinite}
@keyframes shim{to{background-position:-300% 0}}
#life .trend{display:flex;gap:6px;overflow-x:auto;padding:4px 14px 10px;scrollbar-width:none}
#life .trend span{flex:none;background:#ffffff14;border-radius:999px;padding:5px 10px;font:700 12px system-ui;color:#7fc4ff}
#life .compose{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border-bottom:1px solid #ffffff1a}
#life .compose .sg{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
#life .compose .sg button{flex:none;background:#1f2433;border:1px solid #ffffff22;border-radius:999px;padding:6px 10px;font:600 12px system-ui;white-space:nowrap}
#life .pbtn{background:#1d9bf0;border:0;border-radius:999px;padding:8px 18px;font:800 14px system-ui;align-self:flex-end}
#life .cal{padding:6px 12px 30px}
#life .cal .dh{font:800 12px system-ui;letter-spacing:1.5px;opacity:.7;margin:12px 2px 6px}
#life .cal .dh.today{color:var(--gold);opacity:1}
#life .ev{display:flex;gap:10px;align-items:center;background:#ffffff0c;border-radius:12px;padding:8px 10px;margin-bottom:5px;border-left:4px solid var(--c,#4fa3ff)}
#life .ev .tm{font:800 12px system-ui;width:62px;opacity:.8}
#life .ev .tt{flex:1;font:700 13.5px system-ui}
#life .ev .tt small{display:block;font:600 11.5px system-ui;opacity:.6}
#life .mapw{position:relative;margin:6px 12px;border-radius:16px;overflow:hidden;aspect-ratio:1;background:#2b4a2b}
#life .mapw canvas{width:100%;height:100%;display:block}
#life .mpin{position:absolute;transform:translate(-50%,-50%);background:#000a;border:1px solid #fff6;border-radius:10px;font-size:16px;padding:1px 3px;line-height:1.2}
#life .mpin.on{background:var(--gold);border-color:#fff}
#life .big2{font:800 34px system-ui;font-variant-numeric:tabular-nums;padding:6px 16px 0}
#life .kv{display:grid;grid-template-columns:1fr auto;gap:6px 10px;padding:6px 16px;font:600 13.5px system-ui}
#life .kv span:nth-child(2n){font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
#life .seg{display:flex;gap:6px;padding:4px 14px 8px;flex-wrap:wrap}
`;

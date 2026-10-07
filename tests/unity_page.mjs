// Unity WebGL template page (unity/Assets/WebGLTemplates/Hoops): the browser game's menus over the Unity canvas.
// No Unity build here: the template is served as-is and Build/<loader> is a stub createUnityInstance that records
// SendMessage calls and plays Unity's side (HoopsUi_Show "ready" / "pause" / "final"). Covers the faithful copy
// (hub, matchup, settings, pause, final) and the upgrades: carousel, player cards, settings tabs + audio sliders,
// pause box score, loading screen, keyboard + gamepad navigation, phone layout.
// Usage: node tests/unity_page.mjs   (regenerate the data first: npx tsx scripts/unity/gen-page.ts)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("unity/Assets/WebGLTemplates/Hoops");
const ORIGIN = "http://h2k.test/";
const STUB = `window.createUnityInstance = function (canvas, cfg, onProgress) {
  window.__cfg = cfg; window.__sent = [];
  return new Promise(function (res) {
    var p = 0, t = setInterval(function () {
      p += 0.25; onProgress(Math.min(1, p));
      if (p >= 1) {
        clearInterval(t);
        res({ SendMessage: function (o, f, s) { window.__sent.push([o, f, JSON.parse(s)]); } });
        if (!window.__holdReady) setTimeout(function () { H2KUI.show("ready", "{}"); }, 10); // PageBridge.Start
      }
    }, 40);
  });
};`;
const FINAL = {
  sc: [104, 99], cl: ["Lakers", "Celtics"], pc: ["#7b3fb5", "#007a33"], gm: "game", np: 5, me: 0, q: 4,
  box: [
    [{ n: "Doncic", pts: 38, reb: 9, ast: 11, fgm: 14, fga: 25, tpm: 5, tpa: 11, blk: 1, orb: 1, pf: 2, fo: 0, hus: 1, sk: "#e8b88f", hr: 2, bd: 1, no: 77, on: 1 },
     { n: "Reaves", pts: 20, reb: 3, ast: 4, fgm: 7, fga: 15, tpm: 3, tpa: 7, blk: 0, orb: 0, pf: 6, fo: 1, hus: 0, sk: "#e8b88f", hr: 1, bd: 0, no: 15, on: 0 }],
    [{ n: "Tatum", pts: 31, reb: 8, ast: 5, fgm: 11, fga: 24, tpm: 4, tpa: 10, blk: 1, orb: 2, pf: 3, fo: 0, hus: 2, sk: "#8d5524", hr: 1, bd: 0, no: 0, on: 1 }],
  ],
  xs: { paint: [40, 36], fb: [12, 8], sec: [10, 14] }, qs: [[25, 22], [50, 51], [80, 76]],
  shots: [[0, 800, 250, 1, 1], [0, 700, 100, 0, 2], [1, 100, 260, 1, 3], [1, 300, 400, 0, 4]], hx: [887.5, 52.5],
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };

async function page(vp = { width: 1280, height: 860 }, init = null, opts = {}) {
  const pg = await b.newPage({ viewport: vp, ...opts });
  if (init) await pg.addInitScript(init);
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  pg.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text()));
  await pg.route(ORIGIN + "**", (r) => {
    const u = new URL(r.request().url());
    const p = decodeURIComponent(u.pathname);
    if (p.startsWith("/Build/")) return r.fulfill({ contentType: "text/javascript", body: STUB });
    const f = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
    const ct = f.endsWith(".html") ? "text/html" : f.endsWith(".css") ? "text/css" : "text/javascript";
    return r.fulfill({ contentType: ct + "; charset=utf-8", body: fs.readFileSync(f) });
  });
  await pg.goto(ORIGIN);
  return { pg, errs };
}
const sent = (pg) => pg.evaluate(() => (window.__sent || []).map((x) => x[2]));
const st = (pg) => pg.evaluate(() => H2KUI.state());

// 1. hub renders, loader config, matchup screen, Play sends the right JSON
{
  const { pg, errs } = await page();
  await pg.waitForFunction(() => H2KUI.state().ready, null, { timeout: 5000 });
  ok(await pg.locator("#grid .m").count() >= 4, "hub: mode cards");
  ok(await pg.locator("#logp .rel").count() > 10, "hub: update log from main.ts");
  ok((await pg.locator("#hst").innerText()).includes("teams"), "hub: stats line");
  const cfg = await pg.evaluate(() => window.__cfg);
  ok(cfg && /^Build\//.test(cfg.dataUrl) && /^Build\//.test(cfg.codeUrl), "loader config passed to createUnityInstance");
  await pg.click('#grid button[data-g="5"]', { force: true });
  ok(await pg.locator("#ov .mu .side.you").isVisible(), "mode -> matchup screen");
  ok(await pg.locator("#ov .side.you .lu li").count() === 5, "five lineup cards");
  ok(await pg.evaluate(() => document.querySelector("#ov .side.you .lu img").src.startsWith("data:image/png")), "drawn avatar portraits");
  ok(await pg.locator("#hcss").getAttribute("media") === "not all" && (await pg.locator("#gcss").getAttribute("media")) === "all", "stylesheets swapped");
  ok(await pg.locator("#ov .car .strip .card").count() === 14 && (await pg.locator("#ov .car .card.sel .c5 img").count()) === 5, "carousel: every team with its starting five");
  await pg.hover("#ov .side.you .lu li >> nth=0", { force: true });
  ok(await pg.locator("#pcard").isVisible() && (await pg.locator("#pcard .rt div").count()) === 5 && (await pg.locator("#pcard .bdg i").count()) >= 1, "player card on hover: ratings + badges");
  await pg.mouse.move(5, 5);
  ok(!(await pg.locator("#pcard").isVisible()), "player card hides");
  // keyboard: Q/E cycle your team, arrows move focus, Esc -> hub, back again
  await pg.keyboard.press("KeyE");
  ok((await st(pg)).SEL === 1, "E: next team");
  await pg.keyboard.press("KeyQ");
  ok((await st(pg)).SEL === 0, "Q: previous team");
  await pg.focus("#tip");
  await pg.keyboard.press("ArrowDown");
  const f1 = await pg.evaluate(() => document.activeElement.id || document.activeElement.className);
  ok(f1 !== "tip" && f1 !== "", "arrow moves focus off TIP OFF (" + f1 + ")");
  await pg.keyboard.press("Escape");
  ok((await st(pg)).scr === "hub" && (await pg.locator("#hub").isVisible()), "Esc on matchup -> hub");
  await pg.click('#grid button[data-g="5"]', { force: true });
  // team arrows, opponent, difficulty, quarter length
  await pg.click('#ov .arw[data-cy="y"][data-d="1"]', { force: true });
  await pg.click('#ov .arw[data-cy="o"][data-d="1"]', { force: true });
  await pg.click('#ov [data-df="2"]', { force: true });
  await pg.click('#ov [data-ql="120"]', { force: true });
  const s0 = await st(pg);
  ok(s0.SEL === 1 && s0.OPP === 0, "arrows pick teams (" + s0.SEL + "/" + s0.OPP + ")");
  // settings drawer
  await pg.click("#set", { force: true });
  ok(await pg.locator("#sd").isVisible(), "settings drawer opens");
  await pg.click('#sd [data-m="3"]', { force: true });
  await pg.click('#sd [data-rf="0"]', { force: true });
  ok(await pg.locator("#sd .tabs [data-tab]").count() === 4, "settings: four tabs");
  await pg.click('#sd [data-tab="audio"]', { force: true });
  ok(await pg.locator('#sd input[type=range][data-v]').count() === 4, "audio tab: four volume sliders");
  await pg.$eval('#sd input[data-v="vv"]', (r) => { r.value = "40"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
  await pg.click('#sd [data-tab="graphics"]', { force: true });
  await pg.click('#sd [data-q="1"]', { force: true });
  await pg.click('#sd [data-tab="controls"]', { force: true });
  ok((await pg.locator("#sd .tbody").innerText()).includes("GAMEPAD"), "controls tab: key + gamepad bindings");
  await pg.keyboard.press("Escape");
  ok(!(await pg.locator("#sd").isVisible()) && (await st(pg)).scr === "menu", "Esc closes settings");
  await pg.click("#tip", { force: true });
  const ss = await sent(pg);
  const startCmd = ss.find((x) => x.cmd === "start");
  ok(ss.some((x) => x.cmd === "setting" && x.k === "m" && x.v === 3), "setting sent (meter)");
  ok(ss.some((x) => x.cmd === "setting" && x.k === "vv" && x.v === 40) && ss.some((x) => x.cmd === "setting" && x.k === "q" && x.v === 1), "audio slider + graphics sent");
  ok(startCmd && startCmd.mode === "game" && startCmd.np === 5 && startCmd.sel === 1 && startCmd.opp === 0 && startCmd.diff === 2 && startCmd.ql === 120 && startCmd.set.rf === 0 && startCmd.set.m === 3 && startCmd.set.vv === 40 && startCmd.set.q === 1,
    "TIP OFF sends start " + JSON.stringify(startCmd));
  ok((await st(pg)).scr === "play" && !(await pg.locator("#ov").isVisible()), "overlay hidden while playing");
  // pause from Unity, resume with Esc
  await pg.evaluate((F) => H2KUI.show("pause", JSON.stringify({ sc: [10, 8], cl: ["Lakers", "Celtics"], q: 2, cm: 1, m: 3, s: 0, fx: 1, box: F.box })), FINAL);
  await pg.waitForSelector("#pz");
  ok((await pg.locator("#ov").innerText()).includes("PAUSED"), "pause menu shown");
  ok(await pg.locator(".pzr .bx.live tr").count() === 5, "pause: live box score");
  await pg.click("#pse", { force: true });
  ok(await pg.locator("#sd").isVisible(), "pause -> settings");
  await pg.keyboard.press("Escape");
  ok((await st(pg)).scr === "pause" && (await pg.locator("#pz").isVisible()), "settings Esc -> back to pause");
  await pg.keyboard.press("ArrowDown");
  ok(await pg.evaluate(() => document.activeElement.id === "prp"), "pause: arrow navigation");
  await pg.keyboard.press("Escape");
  ok((await sent(pg)).some((x) => x.cmd === "resume") && (await st(pg)).scr === "play", "Esc resumes");
  // final screen from Unity
  await pg.evaluate((F) => H2KUI.show("final", JSON.stringify(F)), FINAL);
  await pg.waitForSelector(".fin .pog");
  const fin = await pg.locator("#ov").innerText();
  ok(fin.includes("VICTORY") && fin.includes("PLAYER OF THE GAME") && fin.includes("Doncic"), "final: result + player of the game");
  ok(await pg.locator(".fin .cmp div").count() >= 8, "final: stat bars");
  ok(await pg.locator(".fin .chart img").count() === 2, "final: shot charts");
  ok(await pg.locator(".fin .qtr td").count() > 6 && (await pg.locator(".fin .bxw .bx").count()) === 2, "final: quarter scores + box score tables");
  ok(await pg.evaluate(() => JSON.parse(localStorage.getItem("h2k_rec")).w === 1), "record saved");
  await pg.click("#rm", { force: true });
  ok((await sent(pg)).some((x) => x.cmd === "rematch"), "rematch sent");
  // mode strip: clutch picker
  await pg.evaluate(() => H2KUI.show("final", "{}"));
  await pg.click("#pa", { force: true });
  ok((await sent(pg)).some((x) => x.cmd === "quit") && (await st(pg)).scr === "menu", "change teams -> quit + menu");
  await pg.click('#ov [data-mode="clutch"]', { force: true });
  await pg.click('#ov [data-cc="2"]', { force: true });
  const cc = (await sent(pg)).filter((x) => x.cmd === "start").pop();
  ok(cc.mode === "clutch" && cc.arg === 2, "clutch scenario start");
  ok(!errs.length, "no page errors " + (errs.length ? errs.join(" | ") : ""));
  await pg.screenshot({ path: "docs/unity-page-final.png" }).catch(() => {});
  await pg.close();
}

// 2. Play before Unity is ready: the command waits, a loading screen shows progress, then it goes through
{
  const { pg, errs } = await page(undefined, () => (window.__holdReady = 1));
  await pg.click('#grid button[data-g="1"]', { force: true });
  ok((await st(pg)).NP === 1 && (await pg.locator("#ov .side.you .lu li").count()) === 1, "1v1 matchup: one star");
  await pg.waitForFunction(() => window.__sent);
  await pg.click("#tip", { force: true });
  ok((await st(pg)).scr === "loading" && (await st(pg)).queued === 1 && (await sent(pg)).length === 0, "start queued while loading");
  ok(await pg.locator(".load .ldb").isVisible() && (await pg.locator(".load .lvs").innerText()).includes("VS"), "loading screen with progress + matchup");
  await pg.evaluate(() => H2KUI.show("ready", "{}"));
  const s = await sent(pg);
  ok(s.length === 1 && s[0].cmd === "start" && s[0].np === 1 && (await st(pg)).scr === "play", "queued start sent on ready");
  ok(!errs.length, "no page errors " + (errs.length ? errs.join(" | ") : ""));
  await pg.close();
}

// 3. Gamepad: d-pad moves focus, A selects, B goes back, Start resumes (navigator.getGamepads stubbed)
{
  const { pg, errs } = await page(undefined, () => {
    window.__pad = { connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.__pad];
  });
  await pg.waitForFunction(() => H2KUI.state().ready, null, { timeout: 5000 });
  const tapB = async (k) => {
    await pg.evaluate((k) => (window.__pad.buttons[k].pressed = true), k);
    await pg.waitForTimeout(80);
    await pg.evaluate((k) => (window.__pad.buttons[k].pressed = false), k);
    await pg.waitForTimeout(80);
  };
  await pg.focus('#grid button[data-g="5"]');
  await tapB(0); // A
  ok((await st(pg)).scr === "menu", "A on a mode card -> matchup");
  await tapB(5); // RB
  ok((await st(pg)).SEL === 1, "RB: next team");
  await pg.focus("#tip");
  await tapB(13); // d-pad down
  ok(await pg.evaluate(() => document.activeElement.id !== "tip"), "d-pad moves focus");
  await tapB(1); // B
  ok((await st(pg)).scr === "hub", "B: back to the hub");
  await pg.click('#grid button[data-g="5"]', { force: true });
  await pg.click("#tip", { force: true });
  await pg.evaluate(() => H2KUI.show("pause", JSON.stringify({ sc: [2, 0], cl: ["A", "B"], q: 1 })));
  await tapB(9); // Start
  ok((await st(pg)).scr === "play" && (await sent(pg)).some((x) => x.cmd === "resume"), "Start resumes from pause");
  ok(!errs.length, "no page errors " + (errs.length ? errs.join(" | ") : ""));
  await pg.close();
}

// 4. Phone: no sideways scrolling, tap targets, player card as a bottom sheet on tap
{
  const { pg, errs } = await page({ width: 390, height: 844 }, null, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await pg.waitForFunction(() => H2KUI.state().ready, null, { timeout: 5000 });
  const wide = () => pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok((await wide()) <= 0, "phone hub: no horizontal scroll");
  await pg.tap('#grid button[data-g="5"]');
  ok((await wide()) <= 0, "phone matchup: no horizontal scroll");
  const h = await pg.evaluate(() => Math.min(...[...document.querySelectorAll("#ov .chips button, #tip, .arw")].map((b) => b.getBoundingClientRect().height)));
  ok(h >= 40, "phone: tap targets >= 40 px (" + h + ")");
  await pg.tap("#ov .side.you .lu li >> nth=1");
  const pc = await pg.evaluate(() => { const r = document.getElementById("pcard").getBoundingClientRect(); return { b: innerHeight - r.bottom, w: r.width }; });
  ok(await pg.locator("#pcard").isVisible() && pc.b <= 12 && pc.w > 300, "phone: player card bottom sheet on tap");
  await pg.tap("#set");
  const sd = await pg.evaluate(() => document.getElementById("sd").getBoundingClientRect().width);
  ok(sd >= 380, "phone: settings full width");
  await pg.screenshot({ path: "docs/unity-page-phone.png" }).catch(() => {});
  ok(!errs.length, "no page errors " + (errs.length ? errs.join(" | ") : ""));
  await pg.close();
}

await b.close();
console.log(bad ? `${bad} FAILED` : "all ok");
process.exit(bad ? 1 : 0);

// UI v6: every screen reached with the keyboard only (hub tabs, settings drawer + tabs, matchup, pause, pause ->
// settings / scouting, halftime, final, mode list, My Player editor), gamepad menu navigation (stubbed pad), settings
// persist across a reload, accessibility toggles apply (text size, contrast, motion, meter palette, minimal HUD, sprint
// toggle), no console errors, and a phone viewport (390x844) has no horizontal scroll on any screen.
// Usage: npm run build && node tests/browser_ui.mjs
import { chromium } from "playwright";
import path from "node:path";
const URL0 = "file://" + path.resolve("dist/hoops2k27-hub.html") + "?nointro";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
let bad = 0;
const ok = (c, m) => (console.log((c ? "ok   " : "FAIL ") + m), c || bad++);
async function page(vp, opts = {}, init = null) {
  const pg = await b.newPage({ viewport: vp, ...opts });
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  pg.on("console", (m) => m.type() === "error" && !/WebGL|GPU|swiftshader|GL_/i.test(m.text()) && errs.push("console: " + m.text()));
  if (init) await pg.addInitScript(init);
  await pg.goto(URL0);
  await pg.waitForTimeout(400);
  return { pg, errs };
}
const act = (pg) => pg.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.id ? "#" + a.id : "") + JSON.stringify(a.dataset || {}) + (a.textContent || "").trim().slice(0, 24) : ""; });
/** Tab (or Shift+Tab) until the focused element matches sel. */
async function tabTo(pg, sel, max = 120, back = false) {
  for (let i = 0; i < max; i++) {
    if (await pg.evaluate((s) => document.activeElement && document.activeElement.matches(s), sel)) return true;
    await pg.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  return pg.evaluate((s) => document.activeElement && document.activeElement.matches(s), sel);
}
const S = (pg) => pg.evaluate(() => window.H2K && window.H2K.G.S);

// ---------------- desktop, keyboard only ----------------
{
  const { pg, errs } = await page({ width: 1440, height: 900 }, {}, () => {
    window.__pad = { connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.__pad];
  });
  // hub: arrows move focus spatially, visible focus ring
  await pg.keyboard.press("ArrowDown");
  const f0 = await act(pg);
  await pg.keyboard.press("ArrowDown");
  const f1 = await act(pg);
  ok(f0 && f1 && f0 !== f1, "hub: arrow keys move focus (" + f0 + " -> " + f1 + ")");
  ok(await pg.evaluate(() => { const a = document.activeElement; return a.matches(":focus-visible") && getComputedStyle(a).outlineStyle !== "none"; }), "hub: focus ring visible");
  // News tab
  ok(await tabTo(pg, '[data-t="log"]', 30, true), "hub: reach the News tab");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => !document.getElementById("log").hidden && document.querySelectorAll("#logp .rel").length > 10), "hub: News (update log) opens with Enter");
  await pg.keyboard.press("Escape"); // back -> Play
  ok(await pg.evaluate(() => !document.getElementById("play").hidden), "hub: Esc returns to Play");
  // settings from the hub: tabs, accessibility toggles apply at once
  ok(await tabTo(pg, "#hset", 40, true), "hub: reach Settings");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => !document.getElementById("sd").hidden && document.activeElement.dataset.tab === "gameplay"), "settings drawer opens, focus on the first tab");
  ok(await pg.evaluate(() => document.querySelectorAll('#sd [role="tab"]').length === 5), "settings: five tabs");
  for (let i = 0; i < 4; i++) await pg.keyboard.press("ArrowRight");
  ok(await pg.evaluate(() => document.activeElement.dataset.tab === "access" && !document.getElementById("sdp-access").hidden), "settings: arrows switch tabs (Accessibility)");
  for (const [k, v] of [["ts", 2], ["hc", 1], ["rm", 1], ["cb", 2], ["spt", 1]]) {
    ok(await tabTo(pg, `#sd [data-${k}="${v}"]`, 60), `settings: reach ${k}=${v}`);
    await pg.keyboard.press("Enter");
  }
  const a11y = await pg.evaluate(() => ({ text: document.documentElement.dataset.text, fs: parseFloat(getComputedStyle(document.documentElement).fontSize), con: document.documentElement.dataset.contrast, mot: document.documentElement.dataset.motion, V: { CB: window.H2K ? 0 : -1 } }));
  ok(a11y.text === "2" && a11y.fs > 19 && a11y.con === "high" && a11y.mot === "reduce", "accessibility applies live " + JSON.stringify(a11y));
  // Display tab: minimal HUD + light theme
  ok(await tabTo(pg, '#sd [role="tab"][aria-selected="true"]', 80, true), "settings: Shift+Tab back to the tab list");
  await pg.keyboard.press("ArrowLeft");
  await pg.keyboard.press("ArrowLeft");
  ok(await pg.evaluate(() => document.activeElement.dataset.tab === "display"), "settings: Display tab");
  for (const [k, v] of [["mh", 1], ["th", 1]]) {
    ok(await tabTo(pg, `#sd [data-${k}="${v}"]`, 60), `settings: reach ${k}=${v}`);
    await pg.keyboard.press("Enter");
  }
  ok(await pg.evaluate(() => document.documentElement.dataset.theme === "light" && getComputedStyle(document.body).backgroundColor !== "rgb(5, 6, 12)"), "light theme applies");
  await pg.keyboard.press("Escape");
  ok(await pg.evaluate(() => document.getElementById("sd").hidden && document.activeElement.id === "hset"), "Esc closes settings, focus returns to the gear");
  // persisted across a reload
  await pg.reload();
  await pg.waitForTimeout(400);
  const per = await pg.evaluate(() => ({ s: JSON.parse(localStorage.getItem("h2k_set")), d: { ...document.documentElement.dataset } }));
  ok(per.s.TXT === 2 && per.s.HC === 1 && per.s.RM === 1 && per.s.CB === 2 && per.s.SPT === 1 && per.s.MINHUD === 1 && per.s.THEME === 1 && per.d.text === "2" && per.d.theme === "light", "settings persist after reload " + JSON.stringify(per.d));
  // back to defaults for the rest (dark theme, normal text) - through the drawer again
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem("h2k_set")); Object.assign(s, { TXT: 0, THEME: 0, RM: 0 }); localStorage.setItem("h2k_set", JSON.stringify(s)); });
  await pg.reload();
  await pg.waitForTimeout(400);
  // gamepad on the hub: d-pad moves focus, A activates
  const tap = async (k) => {
    await pg.evaluate((k) => (window.__pad.buttons[k].pressed = true), k);
    await pg.waitForTimeout(90);
    await pg.evaluate((k) => (window.__pad.buttons[k].pressed = false), k);
    await pg.waitForTimeout(90);
  };
  await tap(13);
  const g0 = await act(pg);
  await tap(13);
  const g1 = await act(pg);
  ok(g0 && g1 !== g0, "gamepad: d-pad moves focus on the hub (" + g0 + " -> " + g1 + ")");
  // keyboard into a game: Tab to 5v5 2D, Enter
  ok(await tabTo(pg, 'button[data-g="5v5-2d"][data-my="0"][data-mp="0"]'), "hub: reach 5v5 2D");
  await pg.keyboard.press("Enter");
  await pg.waitForFunction(() => document.getElementById("tip"));
  ok(await pg.evaluate(() => document.activeElement.id === "tip"), "matchup: TIP OFF has focus");
  const t0 = await pg.evaluate(() => document.querySelector(".side.you .tn b").textContent);
  await pg.keyboard.press("e");
  const t1 = await pg.evaluate(() => document.querySelector(".side.you .tn b").textContent);
  await pg.keyboard.press("c");
  const o1 = await pg.evaluate(() => document.querySelectorAll(".side")[1].querySelector(".tn b").textContent);
  ok(t0 !== t1 && o1 !== "Random", `matchup: E / C pick teams (${t0} -> ${t1}, opp ${o1})`);
  await tap(5); // RB: next team
  ok((await pg.evaluate(() => document.querySelector(".side.you .tn b").textContent)) !== t1, "gamepad: RB cycles your team");
  await pg.keyboard.press("ArrowDown");
  ok((await act(pg)) !== "", "matchup: arrows move focus");
  await pg.keyboard.press("s");
  ok(await pg.evaluate(() => !document.getElementById("sd").hidden && !!document.getElementById("edit")), "matchup: S opens settings (with Edit My Player)");
  ok(await tabTo(pg, "#edit"), "settings: reach Edit My Player");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => !!document.querySelector(".ed") && document.getElementById("sd").hidden), "My Player editor opens");
  ok(await tabTo(pg, "#edb", 60, true), "editor: reach Back");
  await pg.keyboard.press("Enter");
  await pg.waitForFunction(() => document.getElementById("tip"));
  // mode list via keyboard
  ok(await tabTo(pg, '[data-mode="clutch"]'), "matchup: reach Clutch Challenges");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => document.querySelectorAll("[data-cc]").length === 6 && document.activeElement.dataset.cc === "0"), "clutch list, first scenario focused");
  ok(await tabTo(pg, "#mme"), "clutch: reach Back");
  await pg.keyboard.press("Enter");
  await pg.waitForFunction(() => document.getElementById("tip"));
  // tip off with Enter
  await pg.evaluate(() => document.activeElement && document.activeElement.blur());
  await pg.keyboard.press("Enter");
  await pg.waitForFunction(() => window.H2K.G.S === "play", null, { timeout: 10000 });
  ok(true, "Enter tips off");
  ok(await pg.evaluate(() => window.H2K.V.MINHUD === 1 && window.H2K.V.CB === 2 && window.H2K.V.SPT === 1), "game picked up the saved accessibility settings");
  await pg.evaluate(() => { const G = window.H2K.G; for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60); for (let i = 0; i < 60; i++) G.upd(1 / 60); });
  // sprint toggle: one tap of Shift keeps sprinting
  await pg.keyboard.press("ShiftLeft");
  const sp = await pg.evaluate(() => { const G = window.H2K.G, c = G.CT[0]; return !!G.cfg.input(c).sp; });
  ok(sp, "sprint toggle: a tap keeps sprint on");
  await pg.keyboard.press("ShiftLeft");
  // pause menu
  await pg.keyboard.press("Escape");
  ok((await S(pg)) === "pause" && (await pg.evaluate(() => document.activeElement.id === "pr" && document.querySelectorAll(".pzr .bx").length === 2)), "Esc pauses: Resume focused, live box score");
  await pg.keyboard.press("ArrowDown");
  ok(await pg.evaluate(() => document.activeElement.id === "pse"), "pause: ArrowDown -> Settings");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => !document.getElementById("sd").hidden && !document.getElementById("edit") && !!document.querySelector("#sd [data-rf]")), "pause -> settings (no match-only options)");
  await pg.keyboard.press("Escape");
  ok((await S(pg)) === "pause" && (await pg.evaluate(() => document.activeElement.id === "pse")), "settings Esc -> back to the pause menu");
  ok(await tabTo(pg, "#psc"), "pause: reach Scouting report");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => document.querySelectorAll(".scout").length === 2 && document.activeElement.id === "mub"), "scouting report");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => document.activeElement.id === "psc"), "scouting -> back to pause (focus kept)");
  await pg.keyboard.press("Escape");
  ok((await S(pg)) === "play", "Esc resumes");
  // halftime
  await pg.evaluate(() => { const G = window.H2K.G; for (let q = 0; q < 2; q++) { G.setClock(0); G.setRs(0); G.setInb(0); G.upd(1 / 60); } });
  await pg.waitForFunction(() => document.getElementById("h2"), null, { timeout: 20000 });
  ok(await pg.evaluate(() => document.activeElement.id === "h2" && !!document.querySelector(".ht .cmp") && !!document.querySelector(".ht .qtr")), "halftime: stat bars, quarter table, Start focused");
  await pg.keyboard.press("Enter");
  ok((await S(pg)) === "play", "halftime: Enter starts the 3rd quarter");
  // final
  await pg.evaluate(() => { const G = window.H2K.G; G.sc[0] = 40; G.sc[1] = 20; for (let q = 0; q < 4 && G.S === "play"; q++) { G.setClock(0); G.setRs(0); G.setInb(0); for (let i = 0; i < 30 && G.S === "play"; i++) G.upd(1 / 60); } });
  await pg.waitForFunction(() => document.querySelector(".fin .pog"), null, { timeout: 20000 });
  ok(await pg.evaluate(() => document.activeElement.id === "rm" && /VICTORY/.test(document.querySelector(".fin .logo").textContent) && document.querySelectorAll(".fin .cmp > div").length >= 8), "final: VICTORY, POG, stat bars, Rematch focused");
  ok(await tabTo(pg, ".bxw summary", 40, true), "final: reach the box score");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => document.querySelector(".bxw").open && document.querySelectorAll(".bxw .bx").length === 2), "final: box score opens with Enter");
  ok(await tabTo(pg, "#pa"), "final: reach Change teams");
  await pg.keyboard.press("Enter");
  ok(await pg.evaluate(() => !!document.getElementById("tip")), "final -> matchup");
  ok(!errs.length, "no page / console errors " + errs.slice(0, 3).join(" | "));
  await pg.close();
}

// ---------------- phone: no horizontal scroll anywhere ----------------
{
  const { pg, errs } = await page({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const wide = (sel) => pg.evaluate((sel) => { const e = sel ? document.querySelector(sel) : document.documentElement; return Math.max(e.scrollWidth - e.clientWidth, document.documentElement.scrollWidth - innerWidth); }, sel);
  ok((await wide()) <= 0, "phone hub: no horizontal scroll");
  await pg.evaluate(() => document.querySelector('[data-t="log"]').click());
  ok((await wide()) <= 0, "phone news: no horizontal scroll");
  await pg.evaluate(() => document.getElementById("hset").click());
  await pg.waitForTimeout(600);
  ok((await pg.evaluate(() => document.getElementById("sd").getBoundingClientRect().right)) <= 390.5 && (await wide()) <= 0, "phone hub settings: inside the screen");
  await pg.evaluate(() => document.querySelector('button[data-g="5v5-2d"][data-my="0"][data-mp="0"]').click());
  await pg.waitForFunction(() => document.getElementById("tip"));
  ok((await wide("#ov")) <= 0, "phone matchup: no horizontal scroll");
  const tip = await pg.evaluate(() => { const r = document.getElementById("tip").getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0 && r.height >= 44; });
  ok(tip, "phone matchup: TIP OFF always on screen");
  const h = await pg.evaluate(() => Math.min(...[...document.querySelectorAll("#ov .seg button, #tip, .arw")].map((b) => b.getBoundingClientRect().height)));
  ok(h >= 40, "phone: tap targets >= 40 px (" + h + ")");
  await pg.evaluate(() => document.getElementById("set").click());
  ok((await pg.evaluate(() => document.getElementById("sd").getBoundingClientRect().width)) >= 380, "phone: settings full width");
  await pg.evaluate(() => document.getElementById("sdx").click());
  await pg.evaluate(() => document.getElementById("tip").click());
  await pg.evaluate(() => { const G = window.H2K.G; for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60); });
  ok((await wide()) <= 0, "phone in game: no horizontal scroll");
  await pg.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" })));
  await pg.waitForSelector(".pzw");
  ok((await wide("#ov")) <= 0, "phone pause: no horizontal scroll");
  await pg.evaluate(() => document.getElementById("pr").click());
  await pg.evaluate(() => { const G = window.H2K.G; G.sc[0] = 30; G.sc[1] = 10; for (let q = 0; q < 6 && G.S !== "over"; q++) { if (G.S === "half") G.setS("play"); G.setClock(0); G.setRs(0); G.setInb(0); for (let i = 0; i < 30 && G.S === "play"; i++) G.upd(1 / 60); } });
  await pg.waitForFunction(() => document.querySelector(".fin .pog"), null, { timeout: 20000 });
  ok((await wide("#ov")) <= 0, "phone final: no horizontal scroll");
  ok(!errs.length, "phone: no page / console errors " + errs.slice(0, 3).join(" | "));
  await pg.close();
}
await b.close();
console.log(bad ? `${bad} FAILED` : "UI OK");
process.exit(bad ? 1 : 0);

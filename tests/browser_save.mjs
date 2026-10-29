// Save system in the browser (after `npm run build`): old keys migrate on load, the save hub (main menu + LIFE title)
// shows the slot cards, export all (Blob download off claude.ai), import into a wiped browser, a damaged save is
// recovered from its backup with a toast, Restore backup from the UI, the F5 quicksave in LIFE, a damaged game key.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const OLD = execSync(`npx tsx -e 'import {newLife,serialize} from "./src/life/state"; const l=newLife({seed:42,slot:0}); l.p.n="OLD SAVE"; l.money=4321; l.team.w=4; l.team.l=1; l.pt=3723; process.stdout.write(serialize(l))'`).toString();
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("dialog", (d) => d.accept());
const ev = (f, a) => pg.evaluate(f, a);
const waitFor = (sel, ms = 60000) => pg.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: ms, polling: 100 });
const fails = [];
const ok = (c, m) => (c ? console.log("ok  ", m) : (fails.push(m), console.log("FAIL", m)));
const URL0 = "file://" + path.resolve("dist/hoops2k27-hub.html");
const HUB = URL0 + "?nointro&noprobe&nocloud";

// ---- 1. migration of the old keys on the first load
await pg.goto(HUB);
await ev(
  (o) => {
    localStorage.clear();
    localStorage.setItem("h2k_life_0", o);
    localStorage.setItem("h2k_life", "0");
    localStorage.setItem("h2k_myp", JSON.stringify({ n: "MIGRATOR", lv: 3, c: 80, i: 75 }));
    localStorage.setItem("h2k_rec", JSON.stringify({ w: 7, l: 2, st: 2, best: 4 }));
  },
  OLD,
);
await pg.goto(HUB);
await waitFor("#hsav");
const mig = await ev(() => ({ old: localStorage.getItem("h2k_life_0"), env: (localStorage.getItem("h2k_sv_life0") || "").slice(0, 7), idx: JSON.parse(localStorage.getItem("h2k_sv")), rec: localStorage.getItem("h2k_rec") }));
ok(mig.old === null && mig.env.startsWith("H2K1|") && mig.idx.recs.life0.name === "OLD SAVE" && mig.idx.recs.game, "old LIFE save migrated (" + mig.env + "), game record made");
ok(JSON.parse(mig.rec).w === 7, "live game keys kept as they were");

// ---- 2. save hub from the main menu
await ev(() => document.getElementById("hsav").click());
await waitFor("#svh .svc");
const hub = await ev(() => ({
  cards: document.querySelectorAll("#svh .svg .svc[data-slot]").length,
  c0: document.querySelector('#svh .svc[data-slot="0"]').innerText,
  game: document.querySelector("#svh [data-game]")?.innerText || "",
  cloud: document.getElementById("svcl").innerText,
}));
ok(hub.cards === 6, "6 LIFE slot cards");
ok(/OLD SAVE/.test(hub.c0) && /4-1/.test(hub.c0) && /4,321/.test(hub.c0) && /1h 02m/.test(hub.c0) && /HIGH SCHOOL/.test(hub.c0), "slot card: name, record, money, playtime, stage");
ok(/MIGRATOR/.test(hub.game) && /7-2/.test(hub.game), "game data card (My Player + record)");
ok(/offline/i.test(hub.cloud), "cloud offline off claude.ai");

// ---- 3. export all (Blob download)
const [dl] = await Promise.all([pg.waitForEvent("download"), ev(() => document.getElementById("svea").click())]);
const fp = path.resolve("scratch-export.json");
await dl.saveAs(fp);
const exp = JSON.parse(fs.readFileSync(fp, "utf8"));
ok(exp.h2k === "saves" && exp.recs.life0 && exp.recs.game, "export all: one file with every record (" + Object.keys(exp.recs).join(",") + ")");

// ---- 4. LIFE: continue from the hub card, quicksave (F5), thumbnail
await ev(() => document.querySelector('#svh [data-play="0"]').click());
await pg.waitForFunction(() => window.H2K_LIFE && H2K_LIFE.mode === "world", null, { polling: 100, timeout: 90000 });
ok(await ev(() => H2K_LIFE.L.p.n === "OLD SAVE" && H2K_LIFE.L.money === 4321), "hub Continue opened LIFE on that slot");
const t0 = await ev(() => H2K_SAVE.SV.meta("life0").t);
await ev(() => (H2K_LIFE.L.money = 5000));
await pg.keyboard.press("F5");
await pg.waitForFunction((t) => H2K_SAVE.SV.meta("life0").t > t, t0, { polling: 100, timeout: 30000 });
ok(await ev(() => H2K_SAVE.toasts.some((t) => /Quicksaved/.test(t))), "F5 quicksave + toast");
ok(await ev(() => H2K_SAVE.SV.meta("life0").money === 5000), "quicksave stored the new state");
await pg.waitForFunction(() => !!H2K_SAVE.SV.thumb("life0"), null, { polling: 200, timeout: 60000 }).catch(() => {});
ok(await ev(() => /^data:image\/(webp|jpeg)/.test(H2K_SAVE.SV.thumb("life0") || "")), "slot thumbnail captured");
ok(await ev(() => H2K_SAVE.SV.backups("life0").length >= 1), "milestone save kept a backup");

// ---- 5. damaged save -> recovered from the backup automatically, with a toast
await ev(async () => {
  H2K_LIFE.L.money = 6000;
  H2K_LIFE.save(true);
  await H2K_SAVE.SV.settle();
  H2K_SAVE.SV.corrupt("life0");
});
await pg.goto(URL0 + "?life&nointro&lifetest&nocloud");
await waitFor("#life .svc[data-slot='0'] [data-play]");
await ev(() => document.querySelector("#life [data-play='0']").click());
await pg.waitForFunction(() => window.H2K_LIFE && H2K_LIFE.mode === "world", null, { polling: 100, timeout: 90000 });
const rc = await ev(() => ({ money: H2K_LIFE.L.money, toast: H2K_SAVE.toasts.join(" | ") }));
ok(rc.money === 5000 && /damaged/.test(rc.toast), "corrupt save recovered from the newest good backup + toast (" + rc.money + ")");

// ---- 6. Restore backup from the UI (LIFE pause -> Saves)
await ev(() => H2K_SAVE.openSaveHub({ ctx: "life" }));
await waitFor("#svh [data-bk='life0']");
await ev(() => document.querySelector("#svh [data-bk='life0']").click());
await waitFor("#svh [data-rs='life0']");
const nb = await ev(() => H2K_SAVE.SV.backups("life0").length);
await ev(() => [...document.querySelectorAll("#svh [data-rs='life0']")].pop().click());
await pg.waitForFunction(() => H2K_SAVE.toasts.some((t) => /restored/i.test(t)), null, { polling: 100, timeout: 30000 });
ok(await ev((n) => H2K_SAVE.SV.backups("life0").length >= Math.min(n, 4), nb), "restore backup from the UI (replaced copy kept)");
await ev(() => document.getElementById("svx").click());

// ---- 7. import into a wiped browser
await pg.goto(HUB);
await ev(() => localStorage.clear());
await pg.goto(HUB);
await waitFor("#hsav");
await ev(() => document.getElementById("hsav").click());
await waitFor("#svh #svim");
ok(await ev(() => !document.querySelector('#svh .svc[data-slot="0"] [data-play]')), "wiped: slot 1 empty");
await pg.setInputFiles("#svh #svim", fp);
await pg.waitForFunction(() => H2K_SAVE.toasts.some((t) => /Imported/.test(t)), null, { polling: 100, timeout: 30000 });
await pg.waitForLoadState("load");
await pg.waitForTimeout(1500); // a game-data import reloads the hub
const imp = await ev(() => ({ n: H2K_SAVE.SV.meta("life0")?.name, myp: JSON.parse(localStorage.getItem("h2k_myp") || "{}").n, rec: JSON.parse(localStorage.getItem("h2k_rec") || "{}").w }));
ok(imp.n === "OLD SAVE" && imp.myp === "MIGRATOR" && imp.rec === 7, "import all restored LIFE + My Player + record " + JSON.stringify(imp));

// ---- 8. a damaged game key is restored from the game record on read
await ev(() => localStorage.setItem("h2k_rec", '{"w":7,"l":'));
await pg.goto(HUB);
await waitFor("#prof");
const prof = await ev(() => ({ t: document.getElementById("prof").innerText, rec: localStorage.getItem("h2k_rec") }));
ok(/7\s*W/.test(prof.t) && JSON.parse(prof.rec).w === 7, "damaged h2k_rec restored on load (" + prof.t.replace(/\s+/g, " ") + ")");

fs.rmSync(fp, { force: true });
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 5).join(" | ") : ""));
console.log(fails.length ? "SAVE BROWSER FAIL (" + fails.length + ")" : "SAVE BROWSER OK");
await b.close();
process.exit(fails.length ? 1 : 0);

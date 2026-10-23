// LIFE (MyLife) shell: title / save slots, character creation, the open-world loop (clock, needs, input, camera,
// HUD, minimap, objective, tutorial, notifications), every place's screen (home, classes, library, food, gym,
// shops, arena, The Cage), story moments (Signing Day, declare, Draft Night), and the bridge into the real game
// engine (game.ts lifeStart) and back. State logic lives in state.ts (DOM-free, tested by tests/life.ts).
import * as S from "./state";
import { LIFE_CSS } from "./css";
import { createWorld, type World, type Stick } from "./world";
import { PLACES, placeById, doorOf, isOpen, travelMin, RIDE_COST, bedOf, type Place } from "./places";
import { makePhone, drawMap, type Phone } from "./phone";
import { quiz, lessonOf, aiQuizPrompt, screenAI, type Q } from "./questions";
import { askJSON, aiReady, AI } from "./ai";
import { kfmt, fameTier } from "./social";
import { roster, COLLEGES, HS_TEAMS } from "./teams";
import { mkRng, hashStr, clamp, pick } from "./rng";
import { TM } from "../core/data";
import { V } from "../client/view";
import { STK_R } from "../client/input";
import { gameXP } from "../client/career";
import type { Act } from "./anim";

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const LS: Storage | any = (() => {
  try {
    const k = "__h2k_t";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch (e) {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  }
})();

// ---------------------------------------------------------------- shell state
let root: HTMLElement,
  W: World | null = null,
  L: S.Life = null as any,
  PH: Phone,
  canvas: HTMLCanvasElement,
  hudEl: HTMLElement,
  miniC: HTMLCanvasElement,
  objEl: HTMLElement,
  promptEl: HTMLElement,
  toastEl: HTMLElement,
  tutEl: HTMLElement,
  fadeEl: HTMLElement,
  stkEl: HTMLElement;
let mode: "title" | "world" | "screen" | "game" = "title";
let raf = 0,
  lastT = 0,
  accMin = 0,
  saveAcc = 0,
  hudAcc = 0,
  movedFt = 0;
const KEYS: Record<string, number> = {};
const TOUCH = { id: -1, cx: 0, cy: 0, x: 0, y: 0, on: false, sprint: false, look: -1, lx: 0, ly: 0 };
let near: { p: Place | null; npc: any } = { p: null, npc: null };
const shownNotes = new WeakSet<object>();
let gameBooted = false;
let G: any = null; // game.ts module (lazy: the hub already bundles it)
let SIM: any = null;

/** Entry from the hub (main.ts go("life")). */
export function startLife() {
  if (!document.getElementById("lifecss")) {
    const st = document.createElement("style");
    st.id = "lifecss";
    st.textContent = LIFE_CSS;
    document.head.appendChild(st);
  }
  root = document.createElement("div");
  root.id = "life";
  if (matchMedia("(pointer:coarse)").matches) root.classList.add("touch");
  document.body.appendChild(root);
  for (let i = 0; i < 14 && i < TM.length; i++) S.NBA_NAMES[i] = TM[i][0];
  bindKeys();
  title();
  (window as any).H2K_LIFE = DBG;
}

// ---------------------------------------------------------------- generic UI helpers
function scr(html: string, cls = "") {
  closeScr();
  const d = document.createElement("div");
  d.className = "scr " + cls;
  d.innerHTML = `<div class="card">${html}</div>`;
  root.appendChild(d);
  const f = d.querySelector<HTMLElement>("button.go, .opt:not([disabled]), button");
  if (f) setTimeout(() => f.focus(), 30);
  return d;
}
function closeScr() {
  root.querySelectorAll(".scr").forEach((e) => e.remove());
}
const on = (sel: string, f: (e: HTMLElement) => void, el: ParentNode = root) => el.querySelectorAll<HTMLElement>(sel).forEach((b) => (b.onclick = () => f(b)));
function toast(x: string, ic = "🔔") {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span>${ic}</span><span>${esc(x)}</span>`;
  toastEl.appendChild(t);
  while (toastEl.children.length > 3) toastEl.firstElementChild!.remove();
  setTimeout(() => t.classList.add("out"), 3600);
  setTimeout(() => t.remove(), 4000);
}
function fade(mid: () => void, ms = 380) {
  fadeEl.classList.add("on");
  setTimeout(() => {
    try {
      mid();
    } finally {
      setTimeout(() => fadeEl.classList.remove("on"), 60);
    }
  }, ms);
}
function cut(kick: string, h: string, p: string, btn = "Continue ▶"): Promise<void> {
  return new Promise((res) => {
    const d = document.createElement("div");
    d.className = "cut";
    d.innerHTML = `<div class="cc"><small>${esc(kick)}</small><h1>${esc(h)}</h1><p>${p}</p><button class="go" style="margin-top:14px">${esc(btn)}</button></div>`;
    root.appendChild(d);
    const b = d.querySelector("button") as HTMLElement;
    setTimeout(() => b.focus(), 50);
    b.onclick = () => (d.remove(), res());
  });
}
function save() {
  if (L) S.saveLife(L, LS);
}
const pfx = () => ((W as any) ? W!.P : { x: 0, z: 0, f: 0 });

// ---------------------------------------------------------------- title + slots + creation
function title() {
  mode = "title";
  cancelAnimationFrame(raf);
  const slots = [0, 1, 2].map((i) => S.loadLife(LS, i));
  root.innerHTML = `<div class="scr" style="background:radial-gradient(ellipse at 50% 20%,#2a1d4a,#06070e 70%)"><div class="card" style="width:min(640px,100%)">
   <div style="display:flex;align-items:center;gap:12px"><div style="font-size:48px">🏙️</div><div><h2>LIFE</h2><div class="sub">Your life, your call: classes, food, friends, followers - and the road from a high-school senior to the NBA.</div></div></div>
   <h3>Save slots</h3><div class="grid" style="grid-template-columns:1fr">${slots
     .map(
       (s, i) =>
         `<div class="opt" style="flex-direction:row;align-items:center;gap:10px"><div style="flex:1"><b>Slot ${i + 1}</b><small>${s ? esc(S.slotInfo(s)) : "Empty"}</small></div>${s ? `<button class="go" data-cont="${i}">Continue ▶</button><button class="gh" data-exp="${i}" title="Export save">⬇</button><button class="gh" data-del="${i}" title="Delete">🗑</button>` : `<button class="go" data-new="${i}">New life ▶</button>`}</div>`,
     )
     .join("")}</div>
   <div class="row"><label class="gh" style="cursor:pointer">⬆ Import save<input type="file" accept=".json,application/json" id="limp" hidden></label><button class="gh" id="lback">← Hub</button></div>
   <p class="note">Unofficial fan project. Every school, brand, business and person in LIFE is fictional.</p></div></div>`;
  on("[data-cont]", (b) => begin(slots[+b.dataset.cont!]!));
  on("[data-new]", (b) => create(+b.dataset.new!));
  on("[data-del]", (b) => {
    if (confirm("Delete this life? This can't be undone.")) (LS.removeItem(S.SAVE_KEY(+b.dataset.del!)), title());
  });
  on("[data-exp]", (b) => exportSave(slots[+b.dataset.exp!]!));
  (root.querySelector("#lback") as HTMLElement).onclick = () => location.reload();
  (root.querySelector("#limp") as HTMLInputElement).onchange = (e: any) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    f.text().then((t: string) => {
      const l = S.deserialize(t);
      if (!l) return alert("That file isn't a LIFE save.");
      const free = [0, 1, 2].find((i) => !slots[i]);
      l.slot = free ?? 2;
      S.saveLife(l, LS);
      title();
    });
  };
}
async function exportSave(l: S.Life) {
  const data = S.serialize(l),
    name = `life-${l.p.n.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-slot${l.slot + 1}.json`;
  try {
    const c = (globalThis as any).claude;
    const dl = c && c.use ? await Promise.race([c.use("downloads"), new Promise((r) => setTimeout(() => r(null), 1500))]) : null;
    if (dl) return void (await (dl as any).save({ filename: name, data }));
  } catch (e) {}
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function create(slot: number) {
  const SK = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#6b4226", "#e8b88f"],
    HR = ["Bald", "Short", "Long", "Afro"];
  const d: any = { n: "", arch: "Slasher", ht: 6.6, sk: "#c68642", hr: 1, bd: 0, no: 1, town: 0, bk: 1 };
  let myp: any = null;
  try {
    myp = JSON.parse(LS.getItem("h2k_myp") || "null");
  } catch (e) {}
  const draw = () => {
    root.innerHTML = `<div class="scr" style="background:radial-gradient(ellipse at 50% 20%,#2a1d4a,#06070e 70%)"><div class="card">
     <h2>Create your player</h2><div class="sub">Senior year starts tomorrow. Who are you?</div>
     <label class="f">NAME<input id="cn" maxlength="14" value="${esc(d.n)}" placeholder="Your player's name" autocomplete="off"></label>
     <h3>Archetype</h3><div class="row" style="margin:0">${Object.keys(S.ARCH)
       .map((k) => `<button class="pill${d.arch === k ? " on" : ""}" data-ar="${esc(k)}">${esc(k)}</button>`)
       .join("")}</div>
     <h3>Look</h3><div class="row" style="margin:0">${SK.map((c) => `<button class="sw${d.sk === c ? " on" : ""}" style="background:${c}" data-sk="${c}" aria-label="Skin tone"></button>`).join("")}</div>
     <div class="row" style="margin-top:8px">${HR.map((n, i) => `<button class="pill${d.hr === i ? " on" : ""}" data-hr="${i}">${n}</button>`).join("")}<button class="pill${d.bd ? " on" : ""}" id="cbd">Beard</button></div>
     <div class="grid" style="margin-top:10px"><label class="f">HEIGHT <b id="cht">${fmtH(d.ht)}</b><input type="range" min="6" max="7.2" step="0.05" value="${d.ht}" id="chr"></label><label class="f">BUILD<input type="range" min="0.9" max="1.3" step="0.05" value="${d.bk}" id="cbk"></label><label class="f">JERSEY #<input id="cno" value="${d.no}" maxlength="2" inputmode="numeric"></label></div>
     <h3>Hometown</h3><div class="grid">${S.TOWNS.map((t, i) => `<button class="opt${d.town === i ? "" : ""}" data-town="${i}" style="${d.town === i ? "border-color:#ffd23f" : ""}"><b>${esc(t.n)}</b><small>${esc(t.st)}</small></button>`).join("")}</div>
     ${myp ? `<div class="row"><button class="gh" id="cimp">🧬 Import look from My Player (${esc(myp.n)})</button></div>` : ""}
     <div class="row"><button class="go" id="cgo">Start my life ▶</button><button class="gh" id="cbk2">Back</button></div></div></div>`;
    const nm = root.querySelector("#cn") as HTMLInputElement;
    nm.oninput = () => (d.n = nm.value);
    on("[data-ar]", (b) => ((d.arch = b.dataset.ar), (d.ht = S.ARCH[d.arch][7]), draw()));
    on("[data-sk]", (b) => ((d.sk = b.dataset.sk), draw()));
    on("[data-hr]", (b) => ((d.hr = +b.dataset.hr!), draw()));
    on("[data-town]", (b) => ((d.town = +b.dataset.town!), draw()));
    (root.querySelector("#cbd") as HTMLElement).onclick = () => ((d.bd = d.bd ? 0 : 1), draw());
    (root.querySelector("#chr") as HTMLInputElement).oninput = (e: any) => ((d.ht = +e.target.value), ((root.querySelector("#cht") as HTMLElement).textContent = fmtH(d.ht)));
    (root.querySelector("#cbk") as HTMLInputElement).oninput = (e: any) => (d.bk = +e.target.value);
    (root.querySelector("#cno") as HTMLInputElement).oninput = (e: any) => (d.no = clamp(parseInt(e.target.value) || 0, 0, 99));
    const imp = root.querySelector("#cimp") as HTMLElement | null;
    if (imp)
      imp.onclick = () => {
        Object.assign(d, { n: String(myp.n || "").slice(0, 14), sk: myp.sk || d.sk, hr: myp.hr ?? d.hr, bd: myp.bd ?? 0, ht: myp.ht || d.ht, bk: myp.bk || 1, no: myp.no ?? 1 });
        draw();
      };
    (root.querySelector("#cbk2") as HTMLElement).onclick = title;
    (root.querySelector("#cgo") as HTMLElement).onclick = () => {
      const n = (d.n || "").trim().toUpperCase().replace(/[^A-Z0-9 .'-]/g, "").slice(0, 14) || "ROOKIE";
      const a = S.ARCH[d.arch];
      const l = S.newLife({ slot, town: d.town, p: { n, pos: a[0], c: a[1], i: a[2], s: a[3], d: a[4], j: a[5], st: a[6], ht: d.ht, sk: d.sk, hr: d.hr, bd: d.bd, bk: d.bk, no: d.no } });
      l.school = S.TOWNS[d.town].n + " Central High";
      S.saveLife(l, LS);
      begin(l, true);
    };
  };
  draw();
}
const fmtH = (h: number) => Math.floor(h) + "'" + Math.round((h % 1) * 12) + '"';

// ---------------------------------------------------------------- world
function buildShell() {
  root.innerHTML = `<canvas class="w3"></canvas>
  <div class="hud"><div class="clk"><b id="hclk">7:30 AM</b><small id="hday"></small></div>
   <div class="bars"><span>⚡</span><i><u id="hen" style="background:linear-gradient(90deg,#3ddc84,#b6f36a)"></u></i><em id="hen2"></em><span>🍔</span><i><u id="hhu" style="background:linear-gradient(90deg,#ff9f43,#ffd23f)"></u></i><em id="hhu2"></em><span>🙂</span><i><u id="hmo" style="background:linear-gradient(90deg,#4fa3ff,#a78bfa)"></u></i><em id="hmo2"></em><span>❤️</span><i><u id="hhe" style="background:linear-gradient(90deg,#ff5a4f,#ff8a8a)"></u></i><em id="hhe2"></em></div>
   <div class="chips"><span class="chip" id="hmn"></span><span class="chip" id="hfo"></span><span class="chip" id="hgp"></span></div></div>
  <div class="mini"><canvas width="340" height="340"></canvas></div>
  <div class="obj" id="hobj"></div>
  <div class="toasts"></div>
  <div class="btns"><button class="rb ph" id="bph" aria-label="Phone (P)">📱</button><div class="tbtns" style="gap:10px"><button class="rb" id="bsp">RUN</button><button class="rb big" id="bact">E</button></div></div>
  <div class="stk" hidden><i></i></div>
  <div class="fade"></div>`;
  canvas = root.querySelector("canvas.w3") as HTMLCanvasElement;
  hudEl = root.querySelector(".hud") as HTMLElement;
  miniC = root.querySelector(".mini canvas") as HTMLCanvasElement;
  objEl = root.querySelector("#hobj") as HTMLElement;
  toastEl = root.querySelector(".toasts") as HTMLElement;
  fadeEl = root.querySelector(".fade") as HTMLElement;
  stkEl = root.querySelector(".stk") as HTMLElement;
  promptEl = document.createElement("div");
  promptEl.className = "prompt";
  promptEl.hidden = true;
  root.appendChild(promptEl);
  promptEl.onclick = interact;
  tutEl = document.createElement("div");
  tutEl.className = "tut";
  tutEl.hidden = true;
  root.appendChild(tutEl);
  (root.querySelector("#bph") as HTMLElement).onclick = () => phoneToggle();
  (root.querySelector("#bact") as HTMLElement).onclick = interact;
  const bsp = root.querySelector("#bsp") as HTMLElement;
  bsp.onclick = () => ((TOUCH.sprint = !TOUCH.sprint), bsp.classList.toggle("big", TOUCH.sprint));
  PH = makePhone({ L: () => L, root, travel, save, toast, refresh: hud, quit: () => (save(), location.reload()), settingsChanged: applySettings });
  bindPointer();
}
function applySettings() {
  root.classList.toggle("big", !!L.set.big);
  root.classList.toggle("cb", !!L.set.cb);
  root.classList.toggle("rm", !!L.set.rm);
  AI.on = L.set.ai;
}
function look() {
  const p = L.p;
  return { n: p.n, col: p.col, sk: p.sk, hr: p.hr, hs: p.hs, bd: p.bd, ht: p.ht, bk: p.bk, no: p.no };
}
function begin(l: S.Life, fresh = false) {
  L = l;
  buildShell();
  applySettings();
  try {
    W = createWorld(canvas, { ql: V.QL });
  } catch (e) {
    root.innerHTML = `<div class="scr"><div class="card"><h2>3D unavailable</h2><p class="note">LIFE needs WebGL. ${esc(String(e))}</p><button class="gh" onclick="location.reload()">Back</button></div></div>`;
    return;
  }
  W.setLook(look());
  if (fresh || (!L.pos.x && !L.pos.z)) {
    const d = doorOf(placeById(bedOf(L.stage))!);
    W.put(d.x, d.z - 3, -Math.PI / 2);
  } else W.put(L.pos.x, L.pos.z, L.pos.f);
  resize();
  addEventListener("resize", resize);
  mode = "world";
  lastT = performance.now();
  raf = requestAnimationFrame(loop);
  hud();
  if (fresh) {
    cut("SENIOR YEAR · " + S.TOWNS[L.town].n.toUpperCase(), "Day One", `You're ${esc(L.p.n)}, a ${esc(L.p.pos)} at ${esc(L.school)}. Classes in the morning, practice in the afternoon, games under the lights. Keep your grades up, your stomach full and your phone charged. College scouts are watching.`, "Let's go ▶").then(() => tut());
  } else tut();
}
function resize() {
  if (!W) return;
  W.resize(innerWidth, innerHeight);
}
function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (mode === "game" || mode === "title") return;
  if (document.hidden) {
    lastT = now;
    return;
  }
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const st = stick(),
    moving = Math.hypot(st.mx, st.mz) > 0.05,
    free = mode === "world";
  const sprint = st.sprint && L.energy > 4 && moving;
  // the clock: 1 game minute per real second (x setting); paused on screens (actions cost their own time)
  if (free) {
    accMin += dt * L.set.spd;
    if (accMin >= 1) {
      const m = Math.floor(accMin);
      accMin -= m;
      S.advance(L, m, sprint ? "sprint" : moving ? "walk" : "idle");
      saveAcc += m;
      if (saveAcc >= 30) (saveAcc = 0), save();
      lateNight();
      if (L.pend && mode === "world") decide();
    }
  }
  const act: Act = PH.isOpen() ? "phone" : "";
  W!.frame(dt, free ? { ...st, sprint } : { mx: 0, mz: 0, sprint: false }, S.minOf(L.t), { speedK: L.energy < 12 ? 0.7 : L.inj ? 0.75 : 1, act, fame: Math.min(0.9, Math.log10(1 + L.followers) / 6), frozen: !free });
  movedFt += W!.P.sp * dt;
  L.pos.x = W!.P.x;
  L.pos.z = W!.P.z;
  L.pos.f = W!.P.f;
  (window as any).__lifePos = L.pos;
  W!.render();
  hudAcc += dt;
  if (hudAcc > 0.2) {
    hudAcc = 0;
    hud();
    sense();
    notes();
    tut();
  }
  drawMini();
}
function lateNight() {
  const m = S.minOf(L.t);
  if (m >= 2 * 60 && m < 5 * 60 && mode === "world") {
    fade(() => {
      const d = doorOf(placeById(bedOf(L.stage))!);
      W!.put(d.x, d.z - 3, -Math.PI / 2);
      S.sleep(L);
      L.energy = Math.min(L.energy, 55);
      L.mood = clamp(L.mood - 10, 0, 100);
      toast("You passed out at 2 AM... someone got you home. Rough morning.", "😵");
      save();
    });
  }
}
// ---------------------------------------------------------------- HUD, objective, minimap, notifications
let target: { x: number; z: number } | null = null;
function hud() {
  if (!L || !hudEl) return;
  const m = S.minOf(L.t),
    $ = (id: string) => root.querySelector("#" + id) as HTMLElement;
  $("hclk").textContent = S.hhmm(m);
  $("hday").textContent = S.dateStr(L) + " · " + S.STAGE_N[L.stage] + (L.stage === "college" ? " Y" + L.yr : L.stage === "nba" ? " S" + L.yr : "");
  for (const [k, v] of [
    ["hen", L.energy],
    ["hhu", L.hunger],
    ["hmo", L.mood],
    ["hhe", L.health],
  ] as [string, number][]) {
    $(k).style.width = Math.round(v) + "%";
    $(k + "2").textContent = String(Math.round(v));
  }
  $("hmn").textContent = "$" + kfmt(L.money);
  $("hfo").textContent = "👥 " + kfmt(L.followers);
  const g = S.gpa(L),
    pr = S.probation(L);
  $("hgp").textContent = L.stage === "nba" ? `${L.team.short} ${L.team.w}-${L.team.l}` : "GPA " + (g == null ? "—" : g.toFixed(2));
  $("hgp").classList.toggle("warn", pr);
  $("hen").parentElement!.parentElement!.classList.toggle("warn", L.energy < 15);
  // objective
  const nx = S.nextEv(L);
  let html = "";
  target = null;
  if (L.hunger < 20) {
    html = "🍔 You're starving - grab food (<b>Burrito Barn</b>, Slice Society, Morning Grind…)";
    const p = placeById("burrito")!;
    target = doorOf(p);
  } else if (m >= 23 * 60 || m < 2 * 60) {
    html = `🌙 It's late - head to <b>${esc(placeById(bedOf(L.stage))!.n)}</b> and sleep`;
    target = doorOf(placeById(bedOf(L.stage))!);
  } else if (nx) {
    const at = S.evStart(nx),
      dm = at - L.t,
      p = placeById(nx.place)!;
    const when = dm > 0 ? (dm >= 60 ? `in ${Math.floor(dm / 60)}h ${dm % 60}m` : `in ${dm} min`) : `<b style="color:#ff5a4f">started ${-dm} min ago</b>`;
    html = `${nx.k === "game" ? "🏀" : nx.k === "practice" ? "💪" : nx.k === "exam" ? "📝" : "📚"} Next: <b>${esc(nx.k === "game" ? (nx.home ? "vs " : "@ ") + S.oppName(L, nx) : nx.title)}</b> · ${esc(p.n)} · ${S.hhmm(nx.st)}${S.dayOf(at) !== S.dayOf(L.t) ? " " + S.WD[S.wdOf(S.dayOf(at))] : ""} (${when})`;
    if (S.dayOf(at) === S.dayOf(L.t) && dm < 180) target = doorOf(p);
  } else if (L.pend) html = "⭐ A big decision is waiting…";
  else html = "Free time - work out, eat, hoop at <b>The Cage</b>, or post on Hoopr";
  if (objEl.innerHTML !== html) objEl.innerHTML = html;
  W && W.beacon(target ? target.x : null, target ? target.z : 0);
}
function drawMini() {
  if (!W) return;
  const yaw = W.camS.yaw,
    rot = -Math.PI / 2 - Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  drawMap(miniC, L, W.P, target, 3.4, rot);
}
function notes() {
  for (const n of L.notes)
    if (!shownNotes.has(n)) {
      shownNotes.add(n);
      if (L.t - n.t < 90) toast(n.x, n.ic);
    }
}
// ---------------------------------------------------------------- proximity + interaction
function sense() {
  if (mode !== "world") {
    promptEl.hidden = true;
    return;
  }
  const P = W!.P;
  let best: Place | null = null,
    bd = 9;
  for (const p of PLACES) {
    if (p.deco) continue;
    const d = p.k === "court" ? Math.max(0, Math.hypot(P.x - p.x, P.z - (p.z + p.d / 2 + 3)) - 6) : Math.hypot(P.x - doorOf(p).x, P.z - doorOf(p).z);
    if (d < bd) (bd = d), (best = p);
  }
  const npc = best ? null : W!.nearestNpc(5.5);
  near = { p: best, npc };
  if (best) {
    const m = S.minOf(L.t),
      open = isOpen(best, m),
      ev = S.evAt(L, best.id);
    promptEl.innerHTML = `<kbd>E</kbd><span>${open ? (best.k === "court" ? "Hoop at" : "Enter") : "Closed ·"} ${esc(best.n)}<small>${ev ? esc(ev.k === "game" ? "GAME: " + (ev.home ? "vs " : "@ ") + S.oppName(L, ev) : ev.title) + " · " + S.hhmm(ev.st) : open ? "" : "Opens " + S.hhmm(best.open![0])}</small></span>`;
    promptEl.hidden = false;
    if (!L.visited.includes(best.id) && bd < 9) L.visited.push(best.id);
  } else if (npc) {
    promptEl.innerHTML = `<kbd>E</kbd><span>Talk</span>`;
    promptEl.hidden = false;
  } else promptEl.hidden = true;
}
function interact() {
  if (mode !== "world") return;
  if (near.p) return enter(near.p);
  if (near.npc) return talkNpc(near.npc);
}
function talkNpc(n: any) {
  W!.talk(n);
  const fame = Math.log10(1 + L.followers) / 6;
  const r = mkRng(hashStr(n.look.n + S.dayOf(L.t)));
  if (n.fan < fame) {
    const lines = [`"Yo, you're ${L.p.n}! Can I get a selfie?"`, `"My little brother has your poster!"`, `"Big game coming up, right? We'll be there!"`, `"Saw your highlight on Hoopr 🔥"`];
    toast(pick(r, lines) + " +followers", "🤳");
    if (!L.flags["selfie" + n.look.n + S.dayOf(L.t)]) {
      L.flags["selfie" + n.look.n + S.dayOf(L.t)] = 1;
      L.followers += 3 + Math.round(L.followers * 0.002);
      L.mood = clamp(L.mood + 2, 0, 100);
    }
  } else toast(pick(r, [`"Nice day, huh?"`, `"Burrito Barn's got a new hot sauce. Trust me."`, `"You play ball? You've got the height for it."`, `"Have you seen the new mural downtown?"`, `"Don't be late for class!"`]), "💬");
}
function enter(p: Place) {
  const m = S.minOf(L.t);
  if (!isOpen(p, m)) return toast(`${p.n} is closed. Opens ${S.hhmm(p.open![0])}.`, "🔒");
  if (!L.visited.includes(p.id)) L.visited.push(p.id);
  fade(() => {
    mode = "screen";
    PH.close();
    promptEl.hidden = true;
    place(p);
  }, 260);
}
function leave(p?: Place) {
  closeScr();
  mode = "world";
  if (p && p.k !== "court") {
    const d = doorOf(p);
    W!.put(d.x + Math.cos(d.f) * -2.5, d.z + Math.sin(d.f) * -2.5, d.f + Math.PI);
  }
  hud();
  save();
  if (L.pend) decide();
}
function travel(id: string) {
  const p = placeById(id)!,
    d = doorOf(p),
    mins = travelMin(W!.P, d);
  if (L.money < RIDE_COST) return toast("Not enough money", "💸");
  fade(() => {
    S.money(L, -RIDE_COST, "ZipRide → " + p.n);
    S.advance(L, mins, "drive");
    W!.put(d.x + Math.cos(d.f) * -5, d.z + Math.sin(d.f) * -5, d.f + Math.PI);
    toast(`ZipRide to ${p.n} · ${mins} min · $${RIDE_COST}`, "🚗");
    save();
  }, 500);
}
// ---------------------------------------------------------------- place screens
function opt(id: string, b: string, s: string, pr = "", dis = false) {
  return `<button class="opt" data-o="${id}"${dis ? " disabled" : ""}><b>${b}</b><small>${s}</small>${pr ? `<span class="pr">${pr}</span>` : ""}</button>`;
}
function head(p: Place, sub = "") {
  return `<div class="hero" style="--c:${p.col}"><div class="ic">${p.ic}</div><div><h2>${esc(p.n)}</h2><div class="sub">${sub || S.hhmm(S.minOf(L.t)) + " · " + S.dateStr(L)}</div></div></div>`;
}
const exitRow = (p: Place) => `<div class="row"><button class="gh" data-o="__x">← Leave</button><span class="note">⚡ ${Math.round(L.energy)} · 🍔 ${Math.round(L.hunger)} · $${L.money.toLocaleString()}</span></div>`;
function place(p: Place) {
  const ev = S.evAt(L, p.id);
  if (ev && (ev.k === "class" || ev.k === "exam")) return classFlow(p, ev);
  if (ev && ev.k === "game") return pregame(p, ev);
  if (ev && ev.k === "practice") return practice(p, ev);
  const k = p.k,
    m = S.minOf(L.t);
  let body = "";
  const acts: Record<string, () => void> = {};
  const A = (id: string, f: () => void) => (acts[id] = f);
  if (p.id === bedOf(L.stage) || (p.id === "home" && L.stage !== "college")) {
    const hw = L.courses.map((c, i) => [c, i] as const).filter(([c]) => c.hw >= 0);
    body = `${opt("sleep", "🛏️ Sleep", `Until your ${S.hhmm(L.set.alarm)} alarm`)}${opt("nap", "😴 Nap 2 hours", "+25 energy")}${opt("closet", "👕 Closet", "Change your outfit")}${p.id === "home" ? opt("cook", L.stage === "nba" ? "🍳 Cook dinner" : "🍲 Home-cooked dinner", L.stage === "nba" ? "Healthy · $6 groceries" : "Mom's cooking · free", L.stage === "nba" ? "$6" : "") : ""}${hw.map(([c, i]) => opt("hw" + i, "📝 Homework: " + esc(c.n), "Due next class · 3 questions")).join("")}${opt("call", "📞 Call Mom", "+mood")}${opt("trophy", "🏆 Trophy shelf", L.hist.flatMap((h) => h.aw).length + " awards")}`;
    A("sleep", () => doSleep(p));
    A("nap", () => {
      S.sleep(L, 2);
      L.energy = clamp(L.energy + 0, 0, 100);
      toast("Power nap: +25 energy", "😴");
      place(p);
    });
    A("closet", () => closet(p));
    A("cook", () => {
      const r = L.stage === "nba" ? (L.money >= 6 ? (S.money(L, -6, "Groceries"), S.eat(L, "home")) : "Not enough money") : S.eat(L, "home");
      if (r) toast(r, "⚠️");
      else toast("Good, healthy dinner. 🍲", "🍲"), PH.event({ k: "eat", place: "home" });
      place(p);
    });
    hw.forEach(([c, i]) => A("hw" + i, () => homework(p, i)));
    A("call", () => {
      S.advance(L, 15);
      L.mood = clamp(L.mood + 8, 0, 100);
      const c = L.contacts.find((c) => c.id === "mom");
      if (c) c.aff = clamp(c.aff + 3, 0, 100);
      toast(pick(mkRng(L.t), ["Mom: \"I'm so proud of you!\"", "Mom: \"Are you sleeping enough?\"", "Mom: \"Your grandma says hi!\""]), "📞");
      place(p);
    });
    A("trophy", () => trophies(p));
  } else if (k === "food" || p.id === "dining" || p.id === "mart") {
    const items = Object.entries(S.FOODS).filter(([, f]) => f.place === p.id);
    const studentOnly = p.id === "dining" && L.stage !== "college";
    body = studentOnly ? `<p class="note">Commons Dining is for enrolled students (meal plan).</p>` : items.map(([id, f]) => opt(id, f.n, `🍔 +${f.hu} · ⚡ +${f.en}${f.fast ? " · fast food" : ""}`, f.$ ? "$" + f.$ : "Meal plan", L.money < f.$)).join("");
    if (!studentOnly) for (const [id] of items) A(id, () => buy(p, id));
  } else if (k === "gym") {
    body = Object.entries(S.WORKOUTS)
      .map(([id, w]) => {
        const v = w.k === "bk" ? L.p.bk : (L.p as any)[w.k];
        return opt(id, w.n, `${w.min} min · ⚡ -${w.en}${w.k === "bk" ? "" : " · now " + Math.floor(v)}`, w.k === "bk" ? "Build" : "+" + S.gainOf(v).toFixed(1));
      })
      .join("") + opt("ice", "🧊 Ice bath + stretch", "Recovery: +health, +energy", "$15", L.money < 15) + (L.inj ? opt("rehab", "🩹 Rehab session", `${L.inj.k} · ${L.inj.days} days left`, "-1 day") : "");
    for (const id of Object.keys(S.WORKOUTS)) A(id, () => doWorkout(p, id));
    A("ice", () => {
      S.money(L, -15, "Iron Temple · ice bath");
      L.health = clamp(L.health + 15, 0, 100);
      L.energy = clamp(L.energy + 8, 0, 100);
      S.advance(L, 30);
      toast("Recovered: +15 health", "🧊");
      place(p);
    });
    A("rehab", () => {
      S.advance(L, 60);
      if (L.inj) L.inj.days = Math.max(0, L.inj.days - 1);
      if (L.inj && L.inj.days <= 0) (L.inj = null), (L.health = 85), toast("Cleared to play!", "💚");
      else toast("Rehab done. Healing up.", "🩹");
      place(p);
    });
  } else if (p.id === "threads") return closet(p, true);
  else if (p.id === "barber") return barber(p);
  else if (p.id === "library") {
    body = L.courses.length
      ? L.courses.map((c, i) => opt("st" + i, "📚 Study " + esc(c.n), "90 min · boosts your next quiz" + (c.study ? " · studied" : ""))).join("") + L.courses.map((c, i) => opt("tu" + i, "🧑‍🏫 Tutor: " + esc(c.n), "60 min · bigger boost", "$25", L.money < 25)).join("") + L.courses.map((c, i) => (c.hw >= 0 ? opt("hw" + i, "📝 Homework: " + esc(c.n), "3 questions") : "")).join("")
      : `<p class="note">Quiet in here. (No classes right now.)</p>`;
    L.courses.forEach((c, i) => {
      A("st" + i, () => (S.study(L, i), toast("Studied " + c.n, "📚"), place(p)));
      A("tu" + i, () => {
        const e = S.study(L, i, true);
        toast(e || "Tutor session done: " + c.n, e ? "⚠️" : "🧑‍🏫");
        place(p);
      });
      A("hw" + i, () => homework(p, i));
    });
  } else if (k === "school" || k === "campus") {
    const nx = L.cal.find((e) => e.place === p.id && e.s === 0 && S.evWin(e)[1] > L.t);
    body = `<p class="note">${nx ? `Next here: <b>${esc(nx.title)}</b> · ${S.WD[S.wdOf(nx.day)]} ${S.hhmm(nx.st)} (doors open 20 min before).` : "No more classes here this term."}</p>${m >= 9 * 60 && m < 17 * 60 && L.courses.length ? opt("office", "🗣️ Office hours", "30 min · teachers like it (+relationship, small study boost)") : ""}`;
    A("office", () => {
      S.advance(L, 30);
      const pr = L.contacts.find((c) => c.id === "prof");
      if (pr) pr.aff = clamp(pr.aff + 4, 0, 100);
      L.courses.forEach((c) => (c.study = clamp(c.study + 0.1, 0, 1)));
      toast("Office hours: small boost on every class", "🗣️");
      place(p);
    });
  } else if (k === "arena") {
    const nx = L.cal.find((e) => e.place === "arena" && e.s === 0 && S.evWin(e)[1] > L.t);
    body = `<p class="note">${nx ? `Next: <b>${esc(nx.k === "game" ? "Game " + (nx.home ? "vs " : "@ ") + S.oppName(L, nx) : nx.title)}</b> · ${S.WD[S.wdOf(nx.day)]} ${S.hhmm(nx.st)}. Doors open ${nx.k === "game" ? "2 hours" : "30 minutes"} before.` : "Nothing scheduled."}</p>${opt("shoot", "🎯 Shootaround (3-point contest)", "Engine drill · +3PT practice")}`;
    A("shoot", () => engineMode("3pt", p, null));
  } else if (k === "court") {
    body = opt("p3", "🏀 Pickup 3-on-3 to 21", "Real game on the street court · +rep, +followers") + opt("p1", "⚡ 1-on-1 to 21 vs a local", "Street rules: 1s and 2s") + opt("sa", "🎯 Shoot around (sim)", "30 min · small 3PT gain");
    A("p3", () => engineMode("street3", p, null));
    A("p1", () => engineMode("street", p, null));
    A("sa", () => {
      S.advance(L, 30);
      L.p.c = Math.min(99, +(L.p.c + S.gainOf(L.p.c, 0.25)).toFixed(2));
      L.energy = clamp(L.energy - 6, 0, 100);
      toast("Got some shots up", "🎯");
      place(p);
    });
  } else if (k === "dorm") body = `<p class="note">You don't live here.</p>`;
  else body = `<p class="note">Nothing to do here right now.</p>`;
  scr(`${head(p)}<div class="grid">${body}</div>${exitRow(p)}`);
  on(".scr [data-o]", (b) => {
    const id = b.dataset.o!;
    if (id === "__x") return fade(() => leave(p), 200);
    acts[id] && acts[id]();
    hud();
  });
}
function buy(p: Place, id: string) {
  const r = S.eat(L, id);
  if (r) toast(r, "⚠️");
  else {
    toast(`${S.FOODS[id].n} 😋`, "🍽️");
    if (!L.flags["ate" + p.id + S.dayOf(L.t)]) (L.flags["ate" + p.id + S.dayOf(L.t)] = 1), PH.event({ k: "eat", place: p.n });
    if (L.flags.tut === 4) L.flags.tut = 5;
  }
  place(p);
}
function doWorkout(p: Place, id: string) {
  const r = S.workout(L, id);
  if (r.err) toast(r.err, "⚠️");
  else {
    toast(`${S.WORKOUTS[id].n}: ${r.k === "bk" ? "stronger" : "+" + r.g!.toFixed(1) + " " + ({ c: "3PT", i: "INSIDE", s: "SPEED", d: "DEFENSE", j: "JUMP" } as any)[r.k!]}`, "💪");
    if (r.inj) toast("Ouch - " + r.inj + ". Overtraining. Rest up.", "🩹"), PH.event({ k: "injury", what: r.inj });
    else if (mkRng(L.t)() < 0.4) PH.event({ k: "workout", what: S.WORKOUTS[id].n });
  }
  place(p);
}
function closet(p: Place, shop = false) {
  const own = L.inv.outfits;
  const items = Object.entries(S.OUTFITS).filter(([id]) => (shop ? true : own.includes(id)));
  scr(`${head(p, shop ? "Fits for every occasion" : "Pick a fit")}<div class="grid">${items
    .map(([id, o]) => {
      const has = own.includes(id);
      return `<button class="opt" data-ofit="${id}" ${!has && L.money < o.$ ? "disabled" : ""}><b><span class="sw" style="display:inline-block;width:14px;height:14px;background:${o.col};vertical-align:-2px;margin-right:6px"></span>${esc(o.n)}</b><small>${L.outfit === id ? "Wearing" : has ? "Owned · tap to wear" : "Buy & wear"}</small>${has ? "" : `<span class="pr">$${o.$}</span>`}</button>`;
    })
    .join("")}</div><div class="row"><button class="gh" data-o="__b">← Back</button></div>`);
  on(".scr [data-ofit]", (b) => {
    const id = b.dataset.ofit!;
    if (!own.includes(id)) {
      const e = S.buyOutfit(L, id);
      if (e) return toast(e, "⚠️");
      PH.event({ k: "outfit", name: S.OUTFITS[id].n });
    }
    S.wear(L, id);
    W!.setLook(look());
    toast("Wearing: " + S.OUTFITS[id].n, "👕");
    closet(p, shop);
  });
  on(".scr [data-o]", () => (shop ? fade(() => leave(p), 200) : place(p)));
}
const HAIR: [string, number, number][] = [
  ["Bald", 0, -1],
  ["Fade", 1, 0],
  ["Waves", 1, 1],
  ["Crew cut", 1, 2],
  ["Cornrows", 1, 5],
  ["Swept back", 2, -1],
  ["Locks", 2, 1],
  ["Afro", 3, -1],
];
function barber(p: Place) {
  scr(`${head(p, "Fresh cuts · $25")}<div class="grid">${HAIR.map(([n, hr, hs], i) => `<button class="opt" data-cut="${i}" ${L.money < 25 ? "disabled" : ""}><b>💈 ${n}</b><small>${L.p.hr === hr && L.p.hs === hs ? "Current" : "$25 · 30 min"}</small></button>`).join("")}${opt("beard", L.p.bd ? "🪒 Shave the beard" : "🧔 Grow a beard (trim)", "$10", "$10", L.money < 10)}</div>${exitRow(p)}`);
  on(".scr [data-cut]", (b) => {
    const [n, hr, hs] = HAIR[+b.dataset.cut!];
    S.money(L, -25, "Fade Factory · " + n);
    L.p.hr = hr;
    L.p.hs = hs;
    S.advance(L, 30);
    W!.setLook(look());
    toast("Fresh " + n + " 💈", "💈");
    PH.event({ k: "outfit", name: n + " haircut" });
    barber(p);
  });
  on(".scr [data-o]", (b) => {
    if (b.dataset.o === "beard") {
      S.money(L, -10, "Fade Factory · beard");
      L.p.bd = L.p.bd ? 0 : 1;
      W!.setLook(look());
      return barber(p);
    }
    fade(() => leave(p), 200);
  });
}
function trophies(p: Place) {
  const aw = L.hist.flatMap((h) => h.aw.map((a) => [a, S.STAGE_N[h.stage] + " " + h.yr]));
  scr(`${head(p, "Trophy shelf")}${aw.length ? `<div class="grid">${aw.map(([a, y]) => `<div class="opt"><b>🏅 ${esc(a)}</b><small>${esc(y)}</small></div>`).join("")}</div>` : '<p class="note">Empty for now. Win games, make the Dean\'s List, make history.</p>'}<div class="row"><button class="gh" id="tb">← Back</button></div>`);
  (root.querySelector("#tb") as HTMLElement).onclick = () => place(p);
}
function doSleep(p: Place) {
  fade(() => {
    const e0 = L.energy,
      h = S.sleep(L);
    closeScr();
    mode = "world";
    const d = doorOf(p);
    W!.put(d.x + Math.cos(d.f) * -2.5, d.z + Math.sin(d.f) * -2.5, d.f + Math.PI);
    toast(`Slept ${h.toFixed(1)} h · ⚡ ${Math.round(e0)} → ${Math.round(L.energy)}`, "🌅");
    save();
    hud();
    if (L.pend) decide();
    else place(p); // wake up at home (the morning screen)
    mode = "screen";
  }, 500);
}
// ---------------------------------------------------------------- classes, homework
async function getQuiz(key: string, course: string, subj: string, n: number): Promise<{ lesson: string; qs: Q[]; ai: boolean }> {
  const lv = S.level(L),
    seed = hashStr(key + L.seed);
  if (await aiReady()) {
    const x = await askJSON("quiz:" + key, aiQuizPrompt(course, subj, lv, n), 30000);
    const s = screenAI(x, n);
    if (s) {
      const fill = s.qs.length < n ? quiz(subj, lv, n - s.qs.length, seed) : [];
      return { lesson: s.lesson || lessonOf(subj, seed), qs: [...s.qs, ...fill], ai: true };
    }
  }
  return { lesson: lessonOf(subj, seed), qs: quiz(subj, lv, n, seed), ai: false };
}
function classFlow(p: Place, ev: S.Ev) {
  const c = L.courses[ev.c!],
    lt = S.attend(L, ev),
    exam = ev.k === "exam",
    n = exam ? 8 : 5;
  if (lt.min > 5) PH.event({ k: "class", course: c.n, score: 0, late: lt.tag });
  if (lt.min > 5) toast(`Late to ${c.n} (${lt.min} min): grade x${lt.mul}`, "⏰");
  if (L.flags.tut === 2) L.flags.tut = 3;
  scr(`${head(p, `${exam ? "📝 " : ""}${esc(ev.title)} · ${S.hhmm(ev.st)}${lt.min > 5 ? ` · <span class="tag r">LATE ${lt.min} MIN</span>` : ""}`)}<div class="think"><i></i><span>${AI.on ? "Thinking… (preparing today's lesson)" : "Preparing today's lesson…"}</span></div><div class="row"><button class="gh" id="qoff" hidden>Use the textbook instead</button></div>`);
  let done = false;
  const go2 = (d: { lesson: string; qs: Q[]; ai: boolean }) => {
    if (done) return;
    done = true;
    lesson(p, ev, c, d);
  };
  const tm = setTimeout(() => {
    const b = root.querySelector("#qoff") as HTMLElement | null;
    if (b) (b.hidden = false), (b.onclick = () => go2({ lesson: lessonOf(c.sj, ev.day), qs: quiz(c.sj, S.level(L), n, hashStr(ev.id + L.seed)), ai: false }));
  }, 4000);
  getQuiz(ev.id, c.n, c.sj, n).then((d) => (clearTimeout(tm), go2(d)));
}
function lesson(p: Place, ev: S.Ev, c: S.Course, d: { lesson: string; qs: Q[]; ai: boolean }) {
  scr(`${head(p, esc(ev.title))}<h3>Today's lesson${d.ai ? ' <span class="tag y">✨ AI</span>' : ""}</h3><div class="slide">${esc(d.lesson)}</div>${c.study ? `<p class="note">📚 You studied for this one: +${Math.round(c.study * 20)}% bonus.</p>` : ""}<div class="row"><button class="go" id="lq">Start the ${ev.k === "exam" ? "exam" : "quiz"} ▶</button></div>`);
  (root.querySelector("#lq") as HTMLElement).onclick = () =>
    runQuiz(p, d.qs, ev.k === "exam" ? "Exam" : "Quiz", (frac) => {
      const v = S.finishClass(L, ev, Math.min(1, frac + c.study * 0.2));
      const [lt] = S.letter(v);
      PH.event({ k: "class", course: c.n, score: v });
      if (S.probation(L) && !L.flags.probN) (L.flags.probN = 1), PH.event({ k: "probation", gpa: S.gpa(L) || 0 }), toast("ACADEMIC PROBATION - you can't play until your GPA is 2.00", "🚫");
      if (!S.probation(L)) L.flags.probN = 0;
      if (L.flags.tut === 3) L.flags.tut = 4;
      scr(`${head(p, esc(ev.title))}<h2 style="font-size:48px;margin:6px 0">${v}% <span style="font-size:24px;color:#ffd23f">${lt}</span></h2><p class="note">${c.hw >= 0 ? "📝 Homework assigned - due next class (desk at home / library). " : ""}Course grade: ${Math.round(S.coursePct(c) || 0)}% · GPA ${(S.gpa(L) || 0).toFixed(2)}</p><div class="row"><button class="go" data-o="__x">Leave class ▶</button></div>`);
      on(".scr [data-o]", () => fade(() => leave(p), 200));
      save();
    });
}
function runQuiz(p: Place, qs: Q[], kind: string, end: (frac: number) => void) {
  let i = 0,
    ok = 0;
  const show = () => {
    const q = qs[i];
    scr(`${head(p, `${kind} · question ${i + 1} of ${qs.length}`)}<div class="bar2"><i style="width:${(i / qs.length) * 100}%"></i></div><div class="q">${esc(q.question)}</div><div class="ans">${q.choices.map((c, k) => `<button data-a="${k}"><kbd>${k + 1}</kbd>${esc(c)}</button>`).join("")}</div><div id="qx"></div>`);
    let answered = false;
    const pickA = (k: number) => {
      if (answered) return;
      answered = true;
      const good = k === q.answer;
      if (good) ok++;
      root.querySelectorAll<HTMLElement>(".ans button").forEach((b, j) => b.classList.add(j === q.answer ? "ok" : j === k ? "no" : "x"));
      (root.querySelector("#qx") as HTMLElement).innerHTML = `<p class="note" style="margin-top:10px">${good ? "✅ Correct!" : "❌ Not quite."} ${esc(q.explain)}</p><div class="row"><button class="go" id="qn">${i + 1 < qs.length ? "Next ▶" : "Finish ▶"}</button></div>`;
      const nb = root.querySelector("#qn") as HTMLElement;
      nb.focus();
      nb.onclick = () => (++i < qs.length ? show() : end(ok / qs.length));
    };
    on(".scr .ans button", (b) => pickA(+b.dataset.a!));
    QKEY = (k) => pickA(k);
  };
  show();
}
let QKEY: ((k: number) => void) | null = null;
function homework(p: Place, ci: number) {
  const c = L.courses[ci];
  scr(`${head(p, "Homework: " + esc(c.n))}<div class="think"><i></i><span>Opening the assignment…</span></div>`);
  getQuiz("hw" + ci + "_" + c.hw, c.n, c.sj, 3).then((d) =>
    runQuiz(p, d.qs, "Homework", (f) => {
      const v = S.doHomework(L, ci, f);
      toast(`Homework turned in: ${v}%`, "📝");
      save();
      place(p);
    }),
  );
}
// ---------------------------------------------------------------- practice, games (engine bridge)
function practice(p: Place, ev: S.Ev) {
  const lt = S.lateness(ev, L.t);
  scr(`${head(p, "Team practice · " + S.hhmm(ev.st) + (lt.min > 5 ? ` · <span class="tag r">LATE ${lt.min} MIN</span>` : ""))}<div class="grid">${opt("drill", "🎯 Shooting drill (play it)", "Engine 3-point drill · coach watches")}${opt("sim", "📋 Run practice", "90 min · ⚡ -20 · small ratings gain + coach trust")}</div>${exitRow(p)}`);
  const done = (k: number) => {
    ev.s = 1;
    ev.arr = L.t;
    const co = L.contacts.find((c) => c.id === "coach");
    if (co) co.aff = clamp(co.aff + (lt.min > 5 ? -2 : 3) + k, 0, 100);
    for (const key of ["c", "i", "s", "d", "j"] as const) (L.p as any)[key] = Math.min(99, +(L.p[key] + S.gainOf(L.p[key], 0.18)).toFixed(2));
    if (L.flags.tut === 5) L.flags.tut = 6;
  };
  on(".scr [data-o]", (b) => {
    if (b.dataset.o === "__x") return fade(() => leave(p), 200);
    if (b.dataset.o === "sim") {
      S.advance(L, 90);
      L.energy = clamp(L.energy - 20, 0, 100);
      done(0);
      toast("Practice done. Coach liked your effort.", "💪");
      return fade(() => leave(p), 200);
    }
    engineMode("3pt", p, () => done(1));
  });
}
function pregame(p: Place, ev: S.Ev) {
  const why = S.canPlay(L),
    opp = S.oppName(L, ev),
    lt = S.lateness(ev, L.t);
  scr(`${head(p, (ev.big === "state" ? "🏆 STATE FINAL · " : ev.big === "mm" ? "🔥 MARCH MADNESS · " : "") + "Tip-off " + S.hhmm(ev.st))}
   <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;text-align:center;margin:10px 0">
    <div><div style="font:900 20px system-ui">${esc(L.team.name)}</div><div class="note">${L.team.w}-${L.team.l}</div></div><div style="font:italic 900 34px system-ui;color:#ffd23f">VS</div><div><div style="font:900 20px system-ui">${esc(opp)}</div><div class="note">${ev.home ? "visitors" : "home"}</div></div></div>
   ${why ? `<p><span class="tag r">INELIGIBLE</span> ${esc(why)}</p>` : `<p class="note">Energy ${Math.round(L.energy)} · Hunger ${Math.round(L.hunger)}${L.energy < 35 ? " · <b style='color:#ff5a4f'>you're tired: your legs will feel it</b>" : ""}${lt.min > 0 ? ` · arrived ${lt.min} min late: off the bench` : ""}</p>`}
   <div class="grid">${why ? opt("watch", "👀 Watch from the bench", "Simulate the game") : opt("play", "🏀 Play the game", `${L.set.ql < 60 ? L.set.ql + " s" : L.set.ql / 60 + " min"} quarters · difficulty ${["Rookie", "Pro", "All-Star", "Hall of Fame"][diff()]}`) + opt("sim", "⏩ Sim the game", "Quick result (you play, simulated line)")}</div>${exitRow(p)}`);
  on(".scr [data-o]", (b) => {
    const k = b.dataset.o;
    if (k === "__x") return fade(() => leave(p), 200);
    if (k === "watch") {
      const r = S.simTeamGame(L, ev, null);
      PH.event({ k: "dnp", opp, won: r.won, why: why || "" });
      return postgame(p, ev, r, 0);
    }
    if (k === "sim") {
      const r = mkRng(hashStr(ev.id + "sim"));
      const ov = S.ovrOf(L.p),
        pts = Math.max(0, Math.round((ov - 50) / 3 + r() * 8 - 2)),
        fga = Math.max(pts / 2 + 1, 3) | 0,
        line = { pts, reb: Math.round(r() * 6), ast: Math.round(r() * 4), blk: r() < 0.3 ? 1 : 0, fga, fgm: Math.min(fga, Math.round(pts / 2.2)), tpa: 2, tpm: r() < 0.4 ? 1 : 0, hl: [] as string[], played: true };
      const res = S.simTeamGame(L, ev, line);
      S.advance(L, 120);
      PH.event({ k: "game", res, opp, big: ev.big });
      return postgame(p, ev, res, gameXP({ ...line, chg: 0, dv: 0, sa: 0 }, res.won, 0, L.set.ql) >> 1);
    }
    playGame(p, ev);
  });
}
const diff = () => (L.set.diff >= 0 ? L.set.diff : S.DIFF_OF[L.stage]);
/** Engine team slots used by LIFE: fictional HS / college teams are written into TM (index 14+) for the game. */
function teamSlot(i: number, name: string, col: string, rt: number) {
  const t: any = [name, col, roster(name, rt)];
  if (TM.length <= i) TM.push(t);
  else TM[i] = t;
  return i;
}
async function ensureGame() {
  if (!G) G = await import("../client/game");
  if (!SIM) SIM = await import("../core/sim");
  const gEl = document.getElementById("game");
  if (gEl) gEl.hidden = false;
  const gc = document.getElementById("gcss") as HTMLStyleElement | null;
  if (gc) gc.media = "all";
  if (!gameBooted) {
    gameBooted = true;
    try {
      localStorage.setItem("h2k_myp_bak", localStorage.getItem("h2k_myp") || "");
    } catch (e) {}
    G.boot({ np: 5, r3d: true, my: 1, mode: "5v5-3d" });
  }
  const bk = document.getElementById("bk");
  if (bk) bk.onclick = () => G.GS.onQuit && G.GS.onQuit();
}
function setMyPlayer() {
  const p = L.p,
    d = SIM.MYP.d;
  Object.assign(d, { n: p.n.slice(0, 12), c: Math.round(p.c), i: Math.round(p.i), s: Math.round(p.s), d: Math.round(p.d), j: Math.round(p.j), st: p.st, sk: p.sk, hr: p.hr, bd: p.bd, ht: p.ht, bk: p.bk, no: p.no, col: p.col });
  SIM.mkT();
}
let HL: string[] = [];
function onFx(f: any) {
  const me = SIM && SIM.MYP.d.n;
  if (f.k === "cm" && f.n === me) {
    if (/^dunk/.test(f.e)) HL.push("dunk");
    else if (f.e === "block") HL.push("block");
    else if (f.e === "three" || f.e === "splash") HL.push("three");
    else if (f.e === "tech" || f.e === "flagrant") HL.push("tech");
    else if (f.e === "foulout") HL.push("foulout");
  } else if (f.k === "air" && f.n === me) HL.push("airball");
  else if (f.k === "t" && /GAME WINNER|BUZZER BEATER/.test(f.s || "") && SIM.B.last && SIM.B.last.my) HL.push("gamewinner");
}
async function playGame(p: Place, ev: S.Ev) {
  closeScr();
  await ensureGame();
  setMyPlayer();
  let sel: number, opp: number;
  if (L.stage === "nba") {
    sel = L.team.tm;
    opp = ev.opp ?? (sel + 1) % 14;
  } else {
    const me = L.league[0] || { name: L.team.name, col: L.team.col, rt: 58 },
      o = L.league[ev.opp ?? 1] || { name: "Opponent", col: "#555", rt: 58 };
    sel = teamSlot(14, me.name, me.col || L.team.col, me.rt);
    opp = teamSlot(15, o.name, o.col, o.rt + (ev.big ? 3 : 0));
  }
  HL = [];
  const GS = G.GS;
  GS.onFx = onFx;
  GS.onMode = null;
  const finish = (forfeit: boolean, won: boolean) => {
    GS.onEnd = GS.onQuit = GS.onFx = null;
    const st = SIM.ROST[0].find((x: any) => x.my) || SIM.P.find((x: any) => x.my),
      s = st ? st.stt : { pts: 0, reb: 0, ast: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 };
    let res: S.GameRes;
    if (forfeit) res = S.simTeamGame(L, ev, null);
    else {
      res = { us: SIM.sc[0], them: SIM.sc[1], won, pts: s.pts, reb: s.reb, ast: s.ast, blk: s.blk, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, hl: Array.from(new Set(HL)), played: true };
      if (st && st.fo) res.hl.push("foulout");
      S.recordGame(L, ev, res);
    }
    S.advance(L, Math.max(0, S.evStart(ev) + 120 - L.t), "game");
    const xp = forfeit ? 0 : gameXP(s, won, st ? st.pf || 0 : 0, L.set.ql);
    backToLife();
    if (!forfeit) PH.event({ k: "game", res, opp: S.oppName(L, ev), big: ev.big });
    postgame(p, ev, res, xp);
  };
  GS.onEnd = (won: boolean) => {
    // the engine's final screen: swap its rematch buttons for "back to LIFE"
    const row = document.querySelector("#ov .fin .row:last-child") as HTMLElement | null;
    if (row) {
      row.innerHTML = `<button class="big" id="lifeback">Continue (LIFE) ▶</button>`;
      (row.querySelector("#lifeback") as HTMLElement).onclick = () => finish(false, won);
    } else finish(false, won);
  };
  GS.onQuit = () => {
    if (confirm("Leave the game? Your team plays it out without you.")) finish(true, false);
  };
  enterGame();
  G.lifeStart({ kind: "game", sel, opp, ql: L.set.ql, diff: diff() });
}
/** Engine modes from LIFE (practice drill, pickup at The Cage). */
async function engineMode(kind: string, p: Place, after: (() => void) | null) {
  closeScr();
  await ensureGame();
  setMyPlayer();
  const r = mkRng(L.t);
  const mine = teamSlot(14, kind === "3pt" ? L.team.name : "Pickup Crew", kind === "3pt" ? L.team.col : "#3a4a5a", kind === "3pt" ? 60 : 52 + Math.round(S.ovrOf(L.p) / 10)),
    opp = teamSlot(15, pick(r, ["Cage Regulars", "Downtown Runners", "Old Heads", "Night Shift"]), pick(r, ["#7d3c98", "#c0392b", "#16a085", "#2c3e50"]), 50 + Math.round(S.ovrOf(L.p) / 9));
  const GS = G.GS;
  HL = [];
  GS.onFx = onFx;
  const fin = (res: any) => {
    GS.onMode = GS.onQuit = GS.onFx = null;
    backToLife();
    S.advance(L, kind === "3pt" ? 40 : 60, "game");
    L.energy = clamp(L.energy - (kind === "3pt" ? 8 : 18), 0, 100);
    if (kind === "3pt") {
      const pts = res ? res.pts || 0 : 0;
      L.p.c = Math.min(99, +(L.p.c + S.gainOf(L.p.c, 0.4 + pts / 40)).toFixed(2));
      toast(`Shooting drill: ${pts} points · 3PT up`, "🎯");
    } else if (res) {
      const w = !!res.win;
      L.rep = clamp(L.rep + (w ? 2 : -1), 0, 100);
      L.followers += w ? 20 + Math.round(L.followers * 0.01) : 5;
      L.mood = clamp(L.mood + (w ? 8 : -3), 0, 100);
      toast(w ? "You ran The Cage! +rep" : "Sent home at The Cage. Run it back tomorrow.", w ? "👑" : "😤");
      PH.event({ k: "news", text: w ? `${L.p.n} spotted running the court at The Cage. Undefeated tonight. 🔥` : `${L.p.n} took an L at The Cage tonight 👀` });
    }
    after && after();
    fade(() => leave(p), 200);
  };
  GS.onMode = (f: any) => {
    if (f.ev === "end") setTimeout(() => fin(f.res), 1400);
  };
  GS.onQuit = () => fin(null);
  enterGame();
  G.lifeStart({ kind, sel: mine, opp, ql: L.set.ql, diff: diff() });
}
function enterGame() {
  mode = "game";
  save();
  PH.close();
  root.style.display = "none";
}
function backToLife() {
  const G2 = G;
  G2.GS.idle = 1;
  G2.GS.life = 0;
  const gEl = document.getElementById("game");
  if (gEl) gEl.hidden = true;
  const ov = document.getElementById("ov");
  if (ov) ov.style.display = "none";
  try {
    const b = localStorage.getItem("h2k_myp_bak");
    if (b != null) b ? localStorage.setItem("h2k_myp", b) : localStorage.removeItem("h2k_myp");
  } catch (e) {}
  root.style.display = "";
  mode = "screen";
  lastT = performance.now();
  resize();
}
function postgame(p: Place, ev: S.Ev, r: S.GameRes, xp: number) {
  const f0 = L.followers;
  const lv = xp ? S.addXP(L, xp) : 0;
  save();
  const big = ev.big === "state" && r.won ? "STATE CHAMPIONS" : ev.big === "mm" && r.won ? "TOURNAMENT WIN" : "";
  scr(`${head(p, r.played ? "Final" : "Final (did not play)")}
   <h2 style="font-size:44px;margin:4px 0;color:${r.won ? "#ffd23f" : "#ff8a6b"}">${r.won ? "WIN" : "LOSS"} ${r.us}-${r.them}</h2>${big ? `<p><span class="tag y">🏆 ${big}</span></p>` : ""}
   ${r.played ? `<p style="font:800 18px system-ui">${r.pts} PTS · ${r.reb} REB · ${r.ast} AST${r.blk ? " · " + r.blk + " BLK" : ""} · ${r.fgm}-${r.fga} FG · ${r.tpm}-${r.tpa} 3P</p><p>Game grade <b style="color:#ffd23f;font-size:22px">${r.grade || "C"}</b>${r.hl.length ? " · " + r.hl.map((h) => ({ dunk: "💥 dunk", gamewinner: "🧊 game-winner", airball: "😬 airball", block: "🛑 block", three: "🎯 three", tech: "🟥 tech", foulout: "🚫 fouled out" } as any)[h] || h).join(" · ") : ""}</p>` : ""}
   <p class="note">${xp ? `+${xp} XP${lv ? ` · <b style="color:#ffd23f">LEVEL UP! +${lv * 2} skill points (Stats app)</b>` : ""} · ` : ""}👥 ${kfmt(L.followers)} followers · Record ${L.team.w}-${L.team.l}</p>
   <div class="row"><button class="go" data-o="__x">Continue ▶</button><button class="gh" id="pgh">📱 See Hoopr</button></div>`);
  void f0;
  on(".scr [data-o]", () => fade(() => leave(p), 200));
  (root.querySelector("#pgh") as HTMLElement).onclick = () => (fade(() => leave(p), 200), setTimeout(() => PH.open("hoopr"), 650));
  if (big) setTimeout(() => cut(ev.big === "state" ? "HIGH SCHOOL" : "MARCH MADNESS", big, ev.big === "state" ? `${esc(L.team.name)} are state champions. The whole town is outside the arena.` : `${esc(L.team.name)} survive and advance. Your bracket just got busted - in a good way.`), 400);
}
// ---------------------------------------------------------------- story decisions (Signing Day, declare, Draft Night)
let deciding = false;
async function decide() {
  if (deciding || !L.pend || mode !== "world") return;
  deciding = true;
  mode = "screen";
  try {
    if (L.pend === "signing") await signingDay();
    else if (L.pend === "declare") await declareDay();
    else if (L.pend === "draft") await draftNight();
  } finally {
    deciding = false;
    closeScr();
    mode = "world";
    W!.setLook(look());
    const d = doorOf(placeById(bedOf(L.stage))!);
    W!.put(d.x, d.z - 3, -Math.PI / 2);
    save();
    hud();
  }
}
function signingDay(): Promise<void> {
  return new Promise((res) => {
    const h = L.hist[L.hist.length - 1];
    scr(`<small class="tag y">SIGNING DAY</small><h2>Choose your college</h2><div class="sub">Senior year: ${h ? h.rec + " · " + (h.line.gp ? (h.line.pts / h.line.gp).toFixed(1) : "0") + " PPG · GPA " + (h.gpa == null ? "—" : h.gpa.toFixed(2)) : ""}. Three programs offered you a scholarship.</div><div class="grid">${L.offers
      .map((n) => {
        const c = COLLEGES.find((c) => c[0] === n)!;
        return `<button class="opt" data-col="${esc(n)}" style="border-left:6px solid ${c[2]}"><b>${esc(n)}</b><small>Program prestige ${c[3]} · ${c[3] >= 84 ? "national contender, you'll fight for minutes" : c[3] >= 76 ? "tournament team, starting role likely" : "rebuilding: you're the man from day one"}</small></button>`;
      })
      .join("")}</div>`);
    on(".scr [data-col]", async (b) => {
      const n = b.dataset.col!;
      S.sign(L, n);
      PH.event({ k: "signing", school: n });
      closeScr();
      await cut("SIGNING DAY", n.split(" ").slice(-1)[0].toUpperCase(), `${esc(L.p.n)} reaches under the table... and pulls out the <b>${esc(n)}</b> hat. The gym goes wild. Freshman year starts tomorrow - your dorm is on campus (Founders Dorm).`);
      res();
    });
  });
}
function declareDay(): Promise<void> {
  return new Promise((res) => {
    const st = S.draftStock(L),
      pk = S.projPick(st),
      h = L.hist[L.hist.length - 1];
    scr(`<small class="tag y">END OF YEAR ${L.yr}</small><h2>Stay or go pro?</h2><div class="sub">${esc(L.team.name)} ${h ? h.rec : ""} · GPA ${(S.gpa(L) || 0).toFixed(2)} · Draft stock <b>${st}</b> (projected ${pk > 60 ? "undrafted" : "#" + pk})</div>
     <div class="grid">${`<button class="opt" data-d="go"><b>🚀 Declare for the NBA Draft</b><small>Draft night is next. ${pk <= 14 ? "Lottery talk!" : pk <= 30 ? "First-round range." : pk <= 60 ? "Second-round range - risky." : "Scouts aren't sold yet."}</small></button><button class="opt" data-d="stay"><b>🎓 Return for year ${L.yr + 1}</b><small>Grow your game, your grades and your stock.</small></button>`}</div>`);
    on(".scr [data-d]", async (b) => {
      if (b.dataset.d === "go") {
        S.declare(L);
        PH.event({ k: "declare" });
        closeScr();
        await draftNight();
      } else {
        S.nextCollegeYear(L);
        closeScr();
        await cut("COLLEGE · YEAR " + L.yr, "Run it back", "You're coming back. New classes, a new season, and a lot of scouts in the stands.");
      }
      res();
    });
  });
}
async function draftNight(): Promise<void> {
  const grad = L.stage === "college" && L.yr >= 4;
  if (grad && (S.gpa(L) || 0) >= 2) await cut("COMMENCEMENT", "Graduate", `${esc(L.p.n)} walks across the stage with a degree from ${esc(L.school)}. Mom is the loudest person in the building.`);
  const d = S.runDraft(L);
  if (!L.inv.outfits.includes("suit")) L.inv.outfits.push("suit");
  S.wear(L, "suit");
  await cut("NBA DRAFT", "Green Room", `Suit pressed. Family at the table. Cameras everywhere. Draft stock ${S.draftStock(L)}.`, "The commissioner steps to the podium ▶");
  return new Promise((res) => {
    scr(`<small class="tag y">FIRST ROUND</small><h2 id="dh">On the clock…</h2><div class="board">${d.board.map((b) => `<div class="pk${b.me ? " me" : ""}" data-pk="${b.pk}"><b>#${b.pk}</b>${esc(S.NBA_NAMES[b.tm])}<br><span style="opacity:.8">${b.pk < d.pick || d.pick > 30 ? esc(b.n) : "?"}</span></div>`).join("")}</div><div class="row"><button class="gh" id="dskip">Skip ▶</button></div>`);
    let k = 0,
      tm = 0;
    const fin = async () => {
      clearInterval(tm);
      root.querySelectorAll(".pk").forEach((e) => e.classList.add("on"));
      const team = S.NBA_NAMES[d.team];
      closeScr();
      if (d.pick <= 30) await cut(`PICK #${d.pick}`, team.toUpperCase(), `"With the ${ord(d.pick)} pick in the Draft, the ${esc(team)} select... <b>${esc(L.p.n)}</b>." You hug your mom, put on the hat and walk to the stage.`);
      else await cut("UNDRAFTED", "Two-way deal", `Your name wasn't called. Two hours later your phone buzzes: the ${esc(team)} want you on a two-way contract. Prove them all wrong.`);
      S.joinNBA(L, d.pick, d.team);
      PH.event({ k: "draft", pick: d.pick, team });
      res();
    };
    tm = setInterval(() => {
      k++;
      const el = root.querySelector(`.pk[data-pk="${k}"]`);
      if (el) el.classList.add("on");
      const h = root.querySelector("#dh");
      if (h) h.textContent = k < d.pick ? `Pick #${k}: ${d.board[k - 1].n} (${S.NBA_NAMES[d.board[k - 1].tm]})` : "";
      if (k >= Math.min(d.pick, 31)) fin();
    }, 650) as any;
    (root.querySelector("#dskip") as HTMLElement).onclick = fin;
  });
}
const ord = (n: number) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
// ---------------------------------------------------------------- tutorial
const TUT: string[] = [
  "Move with <b>WASD</b> (or the left thumb on touch). Hold <b>Shift</b> to sprint. Drag the mouse to look around.",
  "Your <b>phone</b> runs your life: press <b>P</b> (or 📱). Check the <b>Calendar</b>.",
  "First class soon. Follow the <b>gold beacon</b> (and the minimap) to the classroom and press <b>E</b> at the door before it starts.",
  "Each class is a short lesson and a quiz. Answer with the mouse or keys <b>1-4</b>. Late = lower grade; GPA under 2.00 = you can't play.",
  "Watch <b>Energy</b> and <b>Hunger</b> (top left). Grab food downtown - try <b>Burrito Barn</b> 🌯 - and sleep in your bed at home.",
  "Practice is at <b>Summit Arena</b> at 3:30; games are in the Calendar. Walk in on game day to play. Post on <b>Hoopr</b> to grow your following. Good luck!",
];
function tut() {
  if (!tutEl || !L) return;
  const s = L.flags.tut || 0;
  if (s === 0 && movedFt > 25) L.flags.tut = 1;
  if (s === 1 && PH.isOpen()) L.flags.tut = 2;
  const s2 = L.flags.tut || 0;
  if (s2 >= TUT.length || mode !== "world") {
    tutEl.hidden = true;
    return;
  }
  const html = `<b>TUTORIAL ${s2 + 1}/${TUT.length}</b><p>${TUT[s2]}</p><button class="gh" id="tok">${s2 === TUT.length - 1 ? "Got it" : "Skip"}</button> <button class="gh" id="toff">Hide tutorial</button>`;
  if (tutEl.dataset.s !== String(s2)) {
    tutEl.dataset.s = String(s2);
    tutEl.innerHTML = html;
    (tutEl.querySelector("#tok") as HTMLElement).onclick = () => ((L.flags.tut = s2 + 1), tut());
    (tutEl.querySelector("#toff") as HTMLElement).onclick = () => ((L.flags.tut = 99), tut());
  }
  tutEl.hidden = false;
}
// ---------------------------------------------------------------- input
function stick(): Stick {
  let mx = 0,
    mz = 0;
  if (KEYS.KeyW || KEYS.ArrowUp) mz += 1;
  if (KEYS.KeyS || KEYS.ArrowDown) mz -= 1;
  if (KEYS.KeyD || KEYS.ArrowRight) mx += 1;
  if (KEYS.KeyA || KEYS.ArrowLeft) mx -= 1;
  let sprint = !!(KEYS.ShiftLeft || KEYS.ShiftRight);
  if (TOUCH.on) {
    const dx = (TOUCH.x - TOUCH.cx) / STK_R,
      dy = (TOUCH.y - TOUCH.cy) / STK_R,
      m = Math.min(1, Math.hypot(dx, dy));
    if (m > 0.12) {
      mx += (dx / Math.hypot(dx, dy)) * m;
      mz -= (dy / Math.hypot(dx, dy)) * m;
    }
    if (m > 0.92 || TOUCH.sprint) sprint = true;
  }
  // gamepad (wrapped: blocked in sandboxed iframes)
  try {
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (gp) {
      const ax = gp.axes[0] || 0,
        ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.15) (mx += ax), (mz -= ay);
      if (gp.buttons[7] && gp.buttons[7].pressed) sprint = true;
      const rx = gp.axes[2] || 0,
        ry = gp.axes[3] || 0;
      if (W && Math.hypot(rx, ry) > 0.2) W.orbit(rx * 8, ry * 4);
      const a = !!(gp.buttons[0] && gp.buttons[0].pressed),
        y = !!(gp.buttons[3] && gp.buttons[3].pressed);
      if (a && !GPB.a) interact();
      if (y && !GPB.y) phoneToggle();
      GPB.a = a;
      GPB.y = y;
    }
  } catch (e) {}
  const m = Math.hypot(mx, mz);
  if (m > 1) (mx /= m), (mz /= m);
  return { mx, mz, sprint };
}
const GPB = { a: false, y: false };
function phoneToggle() {
  if (mode !== "world" && mode !== "screen") return;
  PH.toggle();
  if (L.flags.tut === 1) L.flags.tut = 2;
}
function bindKeys() {
  addEventListener("keydown", (e) => {
    if (!root || mode === "game" || mode === "title") return;
    if ((e.target as HTMLElement)?.closest?.("input")) return;
    KEYS[e.code] = 1;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (QKEY && /^Digit[1-4]$/.test(e.code) && root.querySelector(".ans")) return QKEY(+e.code.slice(5) - 1);
    if (e.code === "KeyP" || e.code === "Tab") {
      e.preventDefault();
      return phoneToggle();
    }
    if (e.code === "Escape") {
      if (PH.isOpen()) return PH.back();
      if (mode === "world") return pauseMenu();
      if (mode === "screen" && root.querySelector(".scr [data-o='__x']")) return (root.querySelector(".scr [data-o='__x']") as HTMLElement).click();
      if (root.querySelector(".scr #pzr")) return (root.querySelector(".scr #pzr") as HTMLElement).click();
    }
    if ((e.code === "KeyE" || e.code === "Enter") && mode === "world" && !e.repeat) interact();
  });
  addEventListener("keyup", (e) => (KEYS[e.code] = 0));
  addEventListener("blur", () => {
    for (const k in KEYS) KEYS[k] = 0;
  });
}
function bindPointer() {
  let drag = -1,
    px = 0,
    py = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "world") return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (er) {}
    if (e.pointerType !== "mouse" && e.clientX < innerWidth / 2 && !TOUCH.on) {
      TOUCH.on = true;
      TOUCH.id = e.pointerId;
      TOUCH.cx = TOUCH.x = e.clientX;
      TOUCH.cy = TOUCH.y = e.clientY;
      stkEl.hidden = false;
      stkEl.style.left = e.clientX + "px";
      stkEl.style.top = e.clientY + "px";
      return;
    }
    drag = e.pointerId;
    px = e.clientX;
    py = e.clientY;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId === TOUCH.id && TOUCH.on) {
      TOUCH.x = e.clientX;
      TOUCH.y = e.clientY;
      const dx = TOUCH.x - TOUCH.cx,
        dy = TOUCH.y - TOUCH.cy,
        d = Math.hypot(dx, dy),
        R2 = STK_R;
      (stkEl.firstElementChild as HTMLElement).style.transform = `translate(${(dx / Math.max(d, 1)) * Math.min(d, R2)}px,${(dy / Math.max(d, 1)) * Math.min(d, R2)}px)`;
      return;
    }
    if (e.pointerId === drag && W) {
      W.orbit(e.clientX - px, e.clientY - py);
      px = e.clientX;
      py = e.clientY;
    }
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId === TOUCH.id) {
      TOUCH.on = false;
      TOUCH.id = -1;
      stkEl.hidden = true;
      (stkEl.firstElementChild as HTMLElement).style.transform = "";
    }
    if (e.pointerId === drag) drag = -1;
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => canvas.addEventListener(t, up as any));
  canvas.addEventListener("wheel", (e) => (W && W.zoom(e.deltaY), e.preventDefault()), { passive: false });
}
function pauseMenu() {
  mode = "screen";
  scr(`<h2>Paused</h2><div class="sub">${esc(L.p.n)} · ${esc(S.STAGE_N[L.stage])} · ${esc(S.dateStr(L))} · ${S.hhmm(S.minOf(L.t))}</div><div class="grid">
   <button class="opt" id="pzr"><b>▶ Resume</b><small>Esc</small></button><button class="opt" id="pzs"><b>💾 Save</b><small>Slot ${L.slot + 1}</small></button><button class="opt" id="pzp"><b>📱 Settings</b><small>Day length, alarm, quarters, AI, accessibility</small></button><button class="opt" id="pzh"><b>❓ Controls</b><small>Keys, touch, gamepad</small></button><button class="opt" id="pzt"><b>🏠 Title screen</b><small>Saves first</small></button><button class="opt" id="pzq"><b>⏏ Quit to hub</b><small>Saves first</small></button></div>`);
  const res = () => (closeScr(), (mode = "world"));
  (root.querySelector("#pzr") as HTMLElement).onclick = res;
  (root.querySelector("#pzs") as HTMLElement).onclick = () => (save(), toast("Saved to slot " + (L.slot + 1), "💾"));
  (root.querySelector("#pzp") as HTMLElement).onclick = () => (res(), PH.open("set"));
  (root.querySelector("#pzh") as HTMLElement).onclick = () =>
    scr(`<h2>Controls</h2><table><tr><td>Move</td><td>WASD / arrows · left thumb (touch) · left stick</td></tr><tr><td>Sprint</td><td>Shift · RUN button · push the stick to the edge · RT</td></tr><tr><td>Interact / enter</td><td>E or Enter · the yellow button · A</td></tr><tr><td>Phone</td><td>P or Tab · 📱 · Y</td></tr><tr><td>Look</td><td>Drag the mouse / right thumb · right stick · wheel = zoom</td></tr><tr><td>Answer a quiz</td><td>1-4 or click</td></tr><tr><td>Back / pause</td><td>Esc</td></tr></table><div class="row"><button class="go" id="pzr">Back ▶</button></div>`) &&
    ((root.querySelector("#pzr") as HTMLElement).onclick = res);
  (root.querySelector("#pzt") as HTMLElement).onclick = () => (save(), location.reload());
  (root.querySelector("#pzq") as HTMLElement).onclick = () => (save(), location.reload());
}
// ---------------------------------------------------------------- debug / test handle
const DBG = {
  get L() {
    return L;
  },
  get W() {
    return W;
  },
  get mode() {
    return mode;
  },
  S,
  /** Teleport next to a place's door. */
  goto(id: string) {
    const p = placeById(id)!,
      d = doorOf(p);
    W!.put(d.x + Math.cos(d.f) * -3, d.z + Math.sin(d.f) * -3, d.f + Math.PI);
    sense();
  },
  interact,
  enter: (id: string) => enter(placeById(id)!),
  setTime(t: number) {
    L.t = t;
    hud();
  },
  phone: () => PH,
  save,
  decide,
};

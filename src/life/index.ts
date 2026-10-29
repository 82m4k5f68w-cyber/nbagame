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
import { TM, ov2 } from "../core/data";
import { V } from "../client/view";
import { STK_R } from "../client/input";
import { gameXP } from "../client/career";
import type { Act } from "./anim";
import * as SV from "../client/save";
import { lifeSay } from "../client/voice";
import { initSaveUI, openSaveHub, setQuick, snapThumb, toast as svToast } from "../client/saveui";

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

// ---------------------------------------------------------------- shell state
let root: HTMLElement,
  W: World | null = null,
  L: S.Life = null as any,
  PH: Phone,
  canvas: HTMLCanvasElement,
  hudEl: HTMLElement,
  miniC: HTMLCanvasElement,
  objEl: HTMLElement,
  navEl: HTMLElement,
  promptEl: HTMLElement,
  toastEl: HTMLElement,
  tutEl: HTMLElement,
  fadeEl: HTMLElement,
  stkEl: HTMLElement;
let mode: "title" | "world" | "screen" | "game" = "title";
let raf = 0,
  lastT = 0,
  accMin = 0,
  saveAcc = 0, // real seconds since the last autosave
  thumbWant = false,
  hudAcc = 0,
  movedFt = 0,
  coverN = 0;
const KEYS: Record<string, number> = {};
const TOUCH = { id: -1, cx: 0, cy: 0, x: 0, y: 0, on: false, sprint: false, look: -1, lx: 0, ly: 0 };
let near: { p: Place | null; npc: any } = { p: null, npc: null };
const shownNotes = new WeakSet<object>();
let gameBooted = false;
let G: any = null; // game.ts module (lazy: the hub already bundles it)
let SIM: any = null;

/** Entry from the hub (main.ts go("life")). */
export function startLife(pick?: { slot: number; data: any } | null) {
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
  initSaveUI();
  if (pick) {
    const l = pick.data ? S.deserialize(JSON.stringify(pick.data)) : null;
    if (l) (l.slot = pick.slot), begin(l);
    else create(pick.slot);
  } else title();
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
/** Save the life to its slot (save.ts: compressed, checksummed, rolling backups, cloud). milestone = also keep a backup
 * of the previous version now. A thumbnail of the town view is grabbed on the next drawn frame. */
function save(milestone = false) {
  if (!L) return;
  saveAcc = 0;
  thumbWant = true;
  void SV.put(SV.lifeId(L.slot), L, SV.lifeMeta(L), { milestone });
}
const pfx = () => ((W as any) ? W!.P : { x: 0, z: 0, f: 0 });

// ---------------------------------------------------------------- title + slots + creation
function title() {
  mode = "title";
  cancelAnimationFrame(raf);
  setQuick(null);
  root.innerHTML = `<div class="scr" style="background:radial-gradient(ellipse at 50% 20%,#2a1d4a,#06070e 70%);align-items:flex-start;overflow:auto"><div class="kit" id="lsv" style="width:min(1100px,100%)"></div></div>`;
  openSaveHub({
    ctx: "life",
    host: root.querySelector("#lsv") as HTMLElement,
    head: `<div style="display:flex;align-items:center;gap:12px"><div style="font-size:48px">🏙️</div><div><h2 class="disp" style="margin:0">LIFE</h2><div class="sub">Your life, your call: classes, food, friends, followers - and the road from a high-school senior to the NBA.</div></div></div>`,
    foot: `<div class="row"><button class="btn ghost" id="lback">← Hub</button></div><p class="note">Unofficial fan project. Every school, brand, business and person in LIFE is fictional.</p>`,
    onPlay: (slot, data) => {
      if (!data) return create(slot);
      const l = S.deserialize(JSON.stringify(data));
      if (!l) return svToast("⚠️ That save could not be read.", "bad");
      l.slot = slot;
      begin(l);
    },
  });
  (root.querySelector("#lback") as HTMLElement).onclick = () => location.reload();
}
function create(slot: number) {
  const SK = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#6b4226", "#e8b88f"],
    HR = ["Bald", "Short", "Long", "Afro"];
  const d: any = { n: "", arch: "Slasher", ht: 6.6, sk: "#c68642", hr: 1, bd: 0, no: 1, town: 0, bk: 1 };
  let myp: any = null;
  try {
    myp = SV.get("h2k_myp", null);
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
      L = l;
      save(true);
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
  <div class="navar" hidden><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L35 34 L20 26 L5 34 Z"/></svg><b></b></div>
  <div class="toasts"></div>
  <div class="btns"><button class="rb ph" id="bph" aria-label="Phone (P)">📱</button><div class="tbtns" style="gap:10px"><button class="rb" id="bsp">RUN</button><button class="rb big" id="bact">E</button></div></div>
  <div class="stk" hidden><i></i></div>
  <div class="fade"></div>`;
  canvas = root.querySelector("canvas.w3") as HTMLCanvasElement;
  hudEl = root.querySelector(".hud") as HTMLElement;
  miniC = root.querySelector(".mini canvas") as HTMLCanvasElement;
  objEl = root.querySelector("#hobj") as HTMLElement;
  navEl = root.querySelector(".navar") as HTMLElement;
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
  PH = makePhone({ L: () => L, root, travel, save, toast, refresh: hud, quit: () => (save(true), SV.flush(), location.reload()), settingsChanged: applySettings });
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
  setQuick(() => save(true));
  SV.init();
  buildShell();
  applySettings();
  try {
    W = createWorld(canvas, { ql: Math.min(2, V.QL), npc: /[?&]lifetest\b/.test(location.search) ? 0 : Math.max(4, Math.round(([6, 10, 14][Math.min(2, V.QL)] || 10) * ((V as any).DEV?.npc ?? 1))) /* device probe density */ });
  } catch (e) {
    root.innerHTML = `<div class="scr"><div class="card"><h2>3D unavailable</h2><p class="note">LIFE needs WebGL. ${esc(String(e))}</p><button class="gh" onclick="location.reload()">Back</button></div></div>`;
    return;
  }
  W.setLook(look());
  if (fresh || (!L.pos.x && !L.pos.z)) {
    const d = doorOf(placeById(bedOf(L.stage))!);
    W.put(d.x - Math.cos(d.f) * 3, d.z - Math.sin(d.f) * 3, d.f + Math.PI);
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
  L.pt = (L.pt || 0) + dt; // playtime (save cards)
  saveAcc += dt;
  if (saveAcc >= 120 && mode === "world") save(); // autosave every 2 real minutes (+ after every event)
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
      lateNight();
      if (L.pend && mode === "world") decide();
    }
  }
  const act: Act = PH.isOpen() ? "phone" : "";
  W!.frame(dt, free ? { ...st, sprint } : { mx: 0, mz: 0, sprint: false }, S.minOf(L.t), { speedK: L.energy < 12 ? 0.7 : L.inj ? 0.75 : 1, act, fame: Math.min(0.9, Math.log10(1 + L.followers) / 6), frozen: !free });
  if (thumbWant && free) {
    thumbWant = false; // right after the draw (the WebGL buffer is still there)
    const u = snapThumb(canvas);
    if (u) SV.setThumb(SV.lifeId(L.slot), u);
  }
  movedFt += W!.P.sp * dt;
  L.pos.x = W!.P.x;
  L.pos.z = W!.P.z;
  L.pos.f = W!.P.f;
  (window as any).__lifePos = L.pos;
  // a panel covers the town: redraw it rarely (the blurred backdrop barely changes)
  if (free || ++coverN % 20 === 0) W!.render();
  hudAcc += dt;
  if (hudAcc > 0.2) {
    hudAcc = 0;
    hud();
    sense();
    notes();
    tut();
    story();
  }
  drawMini();
}
function lateNight() {
  const m = S.minOf(L.t);
  if (m >= 2 * 60 && m < 5 * 60 && mode === "world") {
    fade(() => {
      const d = doorOf(placeById(bedOf(L.stage))!);
      W!.put(d.x - Math.cos(d.f) * 3, d.z - Math.sin(d.f) * 3, d.f + Math.PI);
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
    target = doorOf(p);
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
  // on-screen arrow toward the objective (hidden when there is none, on a screen, or once you're at the door)
  const n = target && mode === "world" ? W.navTo(target.x, target.z) : null;
  const show = !!n && n.d > 12;
  if (navEl.hidden === show) navEl.hidden = !show;
  if (show) {
    (navEl.firstElementChild as HTMLElement).style.transform = `rotate(${n!.a.toFixed(3)}rad)`;
    const t = Math.round(n!.d) + " ft";
    const b = navEl.lastElementChild as HTMLElement;
    if (b.textContent !== t) b.textContent = t;
  }
}
const seenLog = new WeakSet<object>();
let logInit = false;
/** New log entries that deserve Hoopr posts (rumours, trades). */
function logPosts() {
  if (!logInit) (logInit = true), L.log.forEach((e) => seenLog.add(e));
  for (const e of L.log) {
    if (seenLog.has(e)) continue;
    seenLog.add(e);
    if (e.k === "rumor") PH.event({ k: "rumor" });
    else if (e.k === "trade") PH.event({ k: "news", text: `BREAKING: ${L.p.n} ${e.d}.` });
    else if (e.k === "fa") PH.event({ k: "news", text: `${L.p.n} ${e.d}. 🖊️` });
  }
}
function notes() {
  logPosts();
  for (const n of L.notes)
    if (!shownNotes.has(n)) {
      shownNotes.add(n);
      if (L.t - n.t < 90) toast(n.x, n.ic), voicemail(n);
    }
}
/** A text from Mom / Coach / the agent / a friend also leaves a voicemail (generic lines, at most one a minute). */
let vmAt = 0;
function voicemail(n: { x: string; ic: string }) {
  if (n.ic !== "💬" || performance.now() - vmAt < 60000) return;
  const by = (id: string) => L.contacts.find((c) => c.id === id)?.n || "~",
    x = n.x;
  const k = x.startsWith(by("coach")) || x.startsWith("Coach") ? "vm_coach" + (1 + Math.floor(Math.random() * 3)) : x.startsWith(by("agent")) ? "vm_agent" : x.startsWith(by("mom")) ? "vm_mom" : x.startsWith(by("dre")) ? "vm_friend" : "";
  if (!k) return;
  vmAt = performance.now();
  lifeSay(["vm_new", k, "vm_end"]);
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
    lifeSay(["radio_id", "radio_" + (1 + Math.floor(Math.random() * 6))], true); // car radio (voice bank / speech)
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
  if (ev && ev.k === "allstar") {
    scr(`${head(p, "⭐ ALL-STAR GAME · " + S.hhmm(ev.st))}<p class="note">The league's ten best, split into Team Gold and Team Ice. You start for Team Gold. Fouls off, lobs on.</p><div class="grid">${opt("play", "⭐ Play the All-Star Game", "Engine game · huge follower boost")}${opt("skip", "🛋️ Skip it (rest)", "+energy, fans grumble")}</div>${exitRow(p)}`);
    on(".scr [data-o]", (b) => {
      if (b.dataset.o === "__x") return fade(() => leave(p), 200);
      if (b.dataset.o === "skip") {
        ev.s = 1;
        L.energy = clamp(L.energy + 20, 0, 100);
        L.rep = clamp(L.rep - 2, 0, 100);
        toast("You skipped the All-Star game. Hoopr has opinions.", "🛋️");
        return fade(() => leave(p), 200);
      }
      playGame(p, ev);
    });
    return;
  }
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
    if (L.courses.length) {
      body += ["dre", "tm1"].map((f) => {
        const c = L.contacts.find((x) => x.id === f);
        return c ? opt("gs" + f, "👥 Group study with " + esc(c.n.split(" ")[0]), "90 min · every class +, friendship +") : "";
      }).join("");
      for (const f of ["dre", "tm1"])
        A("gs" + f, () => {
          const e = S.groupStudy(L, f);
          toast(e || "Group study done - everybody's a little smarter", e ? "⚠️" : "👥");
          place(p);
        });
    }
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
    body = `<p class="note">${nx ? `Next: <b>${esc(nx.k === "game" ? "Game " + (nx.home ? "vs " : "@ ") + S.oppName(L, nx) : nx.title)}</b> · ${S.WD[S.wdOf(nx.day)]} ${S.hhmm(nx.st)}. Doors open ${nx.k === "game" ? "2 hours" : "30 minutes"} before.` : "Nothing scheduled."}</p>${opt("gym", "🏀 Open gym (play it)", "Move, dribble, shoot freely · Esc → Quit when you're done")}${opt("shoot", "🎯 Shootaround (3-point contest)", "Shoot from the racks (you stay in place) · +3PT practice")}`;
    A("gym", () => engineMode("practice", p, null));
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
    save(true); // new day: milestone backup
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
      return { lesson: s.lesson || lessonOf(subj, seed, lv), qs: [...s.qs, ...fill], ai: true };
    }
  }
  return { lesson: lessonOf(subj, seed, lv), qs: quiz(subj, lv, n, seed), ai: false };
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
    if (b) (b.hidden = false), (b.onclick = () => go2({ lesson: lessonOf(c.sj, ev.day, S.level(L)), qs: quiz(c.sj, S.level(L), n, hashStr(ev.id + L.seed)), ai: false }));
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
  scr(`${head(p, "Team practice · " + S.hhmm(ev.st) + (lt.min > 5 ? ` · <span class="tag r">LATE ${lt.min} MIN</span>` : ""))}<div class="grid">${opt("open", "🏀 Team practice (play it)", "Move, dribble, shoot with your team · no defense · Esc → Quit when you're done")}${opt("drill", "🎯 3-point drill (play it)", "Shoot from the racks: you stay in place, time your release")}${opt("sim", "📋 Run practice", "90 min · ⚡ -20 · small ratings gain + coach trust")}${opt("film", "🎬 Film session", "Coach quizzes you on the playbook · trust +")}</div>${exitRow(p)}`);
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
    if (b.dataset.o === "film") {
      const qs = quiz("film", S.level(L), 4, hashStr(ev.id + "film" + L.seed));
      return runQuiz(p, qs, "Film session", (f) => {
        S.advance(L, 75);
        L.energy = clamp(L.energy - 6, 0, 100);
        done(Math.round(f * 4) - 1);
        L.p.d = Math.min(99, +(L.p.d + S.gainOf(L.p.d, 0.3 * f)).toFixed(2));
        toast(`Film: ${Math.round(f * 4)}/4 right · coach ${f >= 0.75 ? "impressed" : f >= 0.5 ? "nods" : "frowns"}`, "🎬");
        fade(() => leave(p), 200);
      });
    }
    // "open" = the engine's free practice (you move); "drill" = the 3-point contest (stationary at the racks)
    engineMode(b.dataset.o === "open" ? "practice" : "3pt", p, () => done(1));
  });
}
function pregame(p: Place, ev: S.Ev) {
  const why = S.canPlay(L),
    opp = S.oppName(L, ev),
    lt = S.lateness(ev, L.t);
  scr(`${head(p, (ev.rd ? (ev.big === "mm" ? "🔥 MARCH MADNESS · " : "🏆 STATE PLAYOFFS · ") + ev.title + " · " : "") + "Tip-off " + S.hhmm(ev.st))}
   <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;text-align:center;margin:10px 0">
    <div><div style="font:900 20px system-ui">${esc(L.team.name)}</div><div class="note">${L.team.w}-${L.team.l}</div></div><div style="font:italic 900 34px system-ui;color:#ffd23f">VS</div><div><div style="font:900 20px system-ui">${esc(opp)}</div><div class="note">${ev.home ? "visitors" : "home"}</div></div></div>
   <p><span class="tag ${S.role(L).k >= 1 ? "g" : S.role(L).k >= 0.8 ? "y" : "r"}">ROLE: ${S.role(L).n.toUpperCase()}</span> <span class="note">Coach trust ${Math.round((L.contacts.find((c) => c.id === "coach") || { aff: 50 }).aff)} - practices, film and being on time earn minutes.</span></p>
   ${L.stage === "nba" && !ev.home ? `<p class="note">✈️ Road game in ${esc(opp)}: team flight from here, hotel tonight, flight home in the morning.</p>` : ""}
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
        pts = Math.max(0, Math.round(((ov - 50) / 3 + r() * 8 - 2) * S.role(L).k)),
        fga = Math.max(pts / 2 + 1, 3) | 0,
        line = { pts, reb: Math.round(r() * 6), ast: Math.round(r() * 4), blk: r() < 0.3 ? 1 : 0, fga, fgm: Math.min(fga, Math.round(pts / 2.2)), tpa: 2, tpm: r() < 0.4 ? 1 : 0, hl: [] as string[], played: true };
      const res = S.simTeamGame(L, ev, line);
      S.advance(L, 120);
      if (L.stage === "nba" && !ev.home) S.roadReturn(L);
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
      SV.setRaw("h2k_myp_bak", SV.getRaw("h2k_myp") || "");
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
  const asg = ev.k === "allstar";
  if (asg) {
    // All-Star game: the league's best split into two teams; you join Team Gold (replacing its lowest-rated star)
    const all = TM.slice(0, 14)
      .flatMap((t) => t[2])
      .sort((a, b) => ov2(b) - ov2(a))
      .slice(0, 10);
    TM[14] = ["Team Gold", "#e0a526", all.filter((_, k) => k % 2 === 0)] as any;
    TM[15] = ["Team Ice", "#4fb3ff", all.filter((_, k) => k % 2 === 1)] as any;
    sel = 14;
    opp = 15;
  } else if (L.stage === "nba") {
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
    if (asg) {
      res = { us: SIM.sc[0], them: SIM.sc[1], won, pts: s.pts, reb: s.reb, ast: s.ast, blk: s.blk, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, hl: Array.from(new Set(HL)), played: !forfeit };
      ev.res = res;
      ev.s = 1;
      L.followers += Math.round(5000 + L.followers * 0.05 + s.pts * 400);
      L.rep = clamp(L.rep + 3, 0, 100);
      S.logE(L, "allstar", `All-Star game: ${s.pts} pts${won ? " (win)" : ""}`);
    } else if (forfeit) res = S.simTeamGame(L, ev, null);
    else {
      res = { us: SIM.sc[0], them: SIM.sc[1], won, pts: s.pts, reb: s.reb, ast: s.ast, blk: s.blk, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, hl: Array.from(new Set(HL)), played: true };
      if (st && st.fo) res.hl.push("foulout");
      S.recordGame(L, ev, res);
    }
    S.advance(L, Math.max(0, S.evStart(ev) + 120 - L.t), "game");
    if (L.stage === "nba" && !ev.home && !asg) S.roadReturn(L);
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
  const own = kind === "3pt" || kind === "practice"; // drills run with your own team's colours
  const MD = kind === "practice" ? await import("../core/modes") : null;
  const mine = teamSlot(14, own ? L.team.name : "Pickup Crew", own ? L.team.col : "#3a4a5a", own ? 60 : 52 + Math.round(S.ovrOf(L.p) / 10)),
    opp = teamSlot(15, pick(r, ["Cage Regulars", "Downtown Runners", "Old Heads", "Night Shift"]), pick(r, ["#7d3c98", "#c0392b", "#16a085", "#2c3e50"]), 50 + Math.round(S.ovrOf(L.p) / 9));
  const GS = G.GS;
  HL = [];
  GS.onFx = onFx;
  const fin = (res: any) => {
    // free practice never ends by itself (Esc -> Quit): read the shot log before the engine is left
    const ps = MD && MD.M.kind === "practice" && MD.M.st ? { ...MD.M.st } : null;
    GS.onMode = GS.onQuit = GS.onFx = null;
    backToLife();
    S.advance(L, kind === "3pt" ? 40 : 60, "game");
    L.energy = clamp(L.energy - (kind === "3pt" ? 8 : kind === "practice" ? 12 : 18), 0, 100);
    if (kind === "practice") {
      const att = ps ? ps.att : 0,
        pct = att ? ps!.made / att : 0;
      L.p.c = Math.min(99, +(L.p.c + S.gainOf(L.p.c, 0.15 + Math.min(att, 40) / 100 + pct * 0.2)).toFixed(2));
      L.p.i = Math.min(99, +(L.p.i + S.gainOf(L.p.i, 0.12)).toFixed(2));
      toast(att ? `Practice: ${ps!.made}/${att} (${Math.round(pct * 100)}%) · ${ps!.gr} greens` : "Practice done", "🏀");
    } else if (kind === "3pt") {
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
    const b = SV.getRaw("h2k_myp_bak");
    if (b != null) b ? SV.setRaw("h2k_myp", b) : SV.del("h2k_myp");
  } catch (e) {}
  root.style.display = "";
  mode = "screen";
  lastT = performance.now();
  resize();
}
function postgame(p: Place, ev: S.Ev, r: S.GameRes, xp: number) {
  const f0 = L.followers;
  const lv = xp ? S.addXP(L, xp) : 0;
  save(true); // after a game: milestone backup
  const last = ev.rd && ev.big ? S.ROUNDS[ev.big].length : 0,
    champ = r.won && ev.rd === last && last > 0,
    big = champ ? (ev.big === "state" ? "STATE CHAMPIONS" : "NATIONAL CHAMPIONS") : ev.rd ? (r.won ? "ADVANCES · " + S.ROUNDS[ev.big!][ev.rd] : "ELIMINATED") : "";
  scr(`${head(p, r.played ? "Final" : "Final (did not play)")}
   <h2 style="font-size:44px;margin:4px 0;color:${r.won ? "#ffd23f" : "#ff8a6b"}">${r.won ? "WIN" : "LOSS"} ${r.us}-${r.them}</h2>${big ? `<p><span class="tag y">🏆 ${big}</span></p>` : ""}
   ${r.played ? `<p style="font:800 18px system-ui">${r.pts} PTS · ${r.reb} REB · ${r.ast} AST${r.blk ? " · " + r.blk + " BLK" : ""} · ${r.fgm}-${r.fga} FG · ${r.tpm}-${r.tpa} 3P</p><p>Game grade <b style="color:#ffd23f;font-size:22px">${r.grade || "C"}</b>${r.hl.length ? " · " + r.hl.map((h) => ({ dunk: "💥 dunk", gamewinner: "🧊 game-winner", airball: "😬 airball", block: "🛑 block", three: "🎯 three", tech: "🟥 tech", foulout: "🚫 fouled out" } as any)[h] || h).join(" · ") : ""}</p>` : ""}
   <p class="note">${xp ? `+${xp} XP${lv ? ` · <b style="color:#ffd23f">LEVEL UP! +${lv * 2} skill points (Stats app)</b>` : ""} · ` : ""}👥 ${kfmt(L.followers)} followers · Record ${L.team.w}-${L.team.l}</p>
   <div class="row"><button class="go" data-o="__x">Continue ▶</button>${r.played && L.stage !== "hs" ? '<button class="gh" id="pgp">🎤 Press conference</button>' : ""}<button class="gh" id="pgh">📱 See Hoopr</button></div>`);
  void f0;
  const pc = root.querySelector("#pgp") as HTMLElement | null;
  if (pc) pc.onclick = () => press(p, ev, r);
  on(".scr [data-o]", () => fade(() => leave(p), 200));
  (root.querySelector("#pgh") as HTMLElement).onclick = () => (fade(() => leave(p), 200), setTimeout(() => PH.open("hoopr"), 650));
  if (champ) setTimeout(() => cut(ev.big === "state" ? "HIGH SCHOOL" : "MARCH MADNESS", big, ev.big === "state" ? `${esc(L.team.name)} are state champions. The whole town is outside the arena and your name is on every sign.` : `${esc(L.team.name)} cut down the nets. Confetti, a ladder, a piece of the net in your hand: national champions.`, "🏆 Celebrate ▶"), 400);
  else if (ev.rd && r.won) setTimeout(() => toast(`${esc(L.team.name)} advance to the ${S.ROUNDS[ev.big!][ev.rd!]}!`, "🔥"), 400);
}
/** Post-game press conference: two questions, three tones (humble / confident / spicy) -> reputation, followers,
 *  coach + teammate chemistry. */
const PQ = {
  win: ["\"What was working for you tonight?\"", "\"Is this team for real?\""],
  loss: ["\"What went wrong out there?\"", "\"Do you trust this group to turn it around?\""],
  big: ["\"Did you know it was going in?\"", "\"Where does this rank in your career?\""],
  bad: ["\"Rough night - what happened?\"", "\"Are you worried about your shot?\""],
};
function press(p: Place, ev: S.Ev, r: S.GameRes) {
  const kind = r.hl.includes("gamewinner") ? "big" : r.won ? (r.pts >= 6 ? "win" : "win") : r.pts <= 2 ? "bad" : "loss";
  const qs = PQ[kind as keyof typeof PQ];
  let i = 0;
  const A: [string, string, () => void][] = [
    ["Humble", "\"It's about the team. My guys made it easy.\"", () => ((L.rep = clamp(L.rep + 2, 0, 100)), aff("coach", 2), aff("tm1", 3))],
    ["Confident", "\"I put the work in. This is what happens.\"", () => (L.followers += Math.round(40 + L.followers * 0.01))],
    ["Spicy", "\"Honestly? Some guys need to step up. Not me.\"", () => ((L.followers += Math.round(80 + L.followers * 0.03)), (L.rep = clamp(L.rep - 3, 0, 100)), aff("coach", -4), aff("tm1", -5))],
  ];
  const show = () => {
    scr(`${head(p, "🎤 Press conference")}<div class="q">${esc(qs[i])}</div><div class="ans">${A.map((a, k) => `<button data-pq="${k}"><kbd>${k + 1}</kbd><b>${a[0]}:</b> ${esc(a[1])}</button>`).join("")}</div>`);
    on(".scr [data-pq]", (b) => {
      const a = A[+b.dataset.pq!];
      a[2]();
      if (a[0] === "Spicy") PH.event({ k: "news", text: `${L.p.n} after the game: ${a[1].replace(/\\"/g, "")} 👀🍿` });
      if (++i < qs.length) return show();
      S.advance(L, 15);
      save();
      toast("Press conference done", "🎤");
      fade(() => leave(p), 200);
    });
    QKEY = (k) => (root.querySelector(`.scr [data-pq="${k}"]`) as HTMLElement | null)?.click();
  };
  show();
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
    else if (L.pend === "fa") await freeAgency();
  } finally {
    deciding = false;
    closeScr();
    mode = "world";
    W!.setLook(look());
    const d = doorOf(placeById(bedOf(L.stage))!);
    W!.put(d.x - Math.cos(d.f) * 3, d.z - Math.sin(d.f) * 3, d.f + Math.PI);
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
        return `<div class="opt" style="border-left:6px solid ${c[2]}"><b>${esc(n)}</b><small>Program prestige ${c[3]} · ${c[3] >= 84 ? "national contender, you'll fight for minutes" : c[3] >= 76 ? "tournament team, starting role likely" : "rebuilding: you're the man from day one"}</small><div class="row" style="margin-top:6px"><button class="gh" data-vis="${esc(n)}">🏫 Official visit</button><button class="go" data-col="${esc(n)}">✍️ Commit</button></div></div>`;
      })
      .join("")}</div>`);
    on(".scr [data-vis]", (b) => visit(b.dataset.vis!).then(() => signingDay().then(res)));
    on(".scr [data-col]", async (b) => {
      const n = b.dataset.col!;
      S.sign(L, n);
      PH.event({ k: "signing", school: n });
      closeScr();
      await cut("SIGNING DAY", n.split(" ").slice(-1)[0].toUpperCase(), `${esc(L.p.n)} reaches under the table... and pulls out the <b>${esc(n)}</b> hat. The gym goes wild. Freshman year starts tomorrow - your dorm is on campus (Founders Dorm).`);
      await pickMajor();
      res();
    });
  });
}
/** Official visit: what the program offers (role, academics, NIL market, facilities, dorm) - pure presentation. */
function visit(n: string): Promise<void> {
  return new Promise((res) => {
    const c = COLLEGES.find((x) => x[0] === n)!,
      r = mkRng(hashStr("visit" + n)),
      ovr = S.ovrOf(L.p),
      role = c[3] >= 84 ? (ovr >= 68 ? "Starter from day one" : "Sixth man, fighting for minutes") : c[3] >= 76 ? "Starting role" : "Featured scorer: the offense runs through you",
      acad = pick(r, ["Top-20 business school", "Renowned kinesiology lab", "Small classes, great tutors", "Strong communications program", "New computer science building"]),
      nil = c[3] >= 84 ? "Huge (national TV every week)" : c[3] >= 76 ? "Strong regional market" : "Small, but you'd be the face of it",
      coach = pick(r, ["\"We win with defense and we win with character.\"", "\"You'll have the ball in your hands late in games.\"", "\"We develop pros. Look at our draft record.\"", "\"Family first. Then basketball. Then everything else.\""]);
    scr(`<small class="tag y">OFFICIAL VISIT</small><h2>${esc(n)}</h2><div class="sub" style="border-left:6px solid ${c[2]};padding-left:10px">Prestige ${c[3]} · Head coach: ${coach}</div>
     <table><tr><td>🏀 Projected role</td><td><b>${role}</b></td></tr><tr><td>🎓 Academics</td><td>${acad}</td></tr><tr><td>💰 NIL market</td><td>${nil}</td></tr><tr><td>🏟️ Facilities</td><td>${c[3] >= 80 ? "Practice palace + 18,000-seat arena" : "Renovated gym, loud student section"}</td></tr><tr><td>🛏️ Dorm</td><td>${pick(r, ["Corner suite, view of the quad", "Shared double, two minutes from the gym", "New athlete housing with a players' lounge"])}</td></tr></table>
     <div class="row"><button class="go" id="vb">Back to offers ▶</button></div>`);
    (root.querySelector("#vb") as HTMLElement).onclick = () => res();
  });
}
function pickMajor(): Promise<void> {
  return new Promise((res) => {
    scr(`<small class="tag y">FRESHMAN ORIENTATION</small><h2>Choose your major</h2><div class="sub">Each one helps in its own way (and matters after basketball).</div><div class="grid">${Object.entries(S.MAJORS)
      .map(([m, d]) => `<button class="opt" data-mj="${esc(m)}"><b>${esc(m)}</b><small>${esc(d)}</small></button>`)
      .join("")}</div>`);
    on(".scr [data-mj]", (b) => {
      S.chooseMajor(L, b.dataset.mj!);
      toast("Major: " + b.dataset.mj, "🎓");
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
function combineScreen(): Promise<void> {
  return new Promise((res) => {
    const st0 = S.draftStock(L),
      c = S.combine(L),
      st1 = S.draftStock(L);
    const ft = (h: number) => Math.floor(h) + "' " + Math.round((h % 1) * 12) + '"';
    scr(`<small class="tag y">NBA DRAFT COMBINE</small><h2>Measurements & testing</h2><div class="sub">Scouts with stopwatches everywhere.</div>
     <table><tr><td>Height in shoes</td><td><b>${ft(c.ht)}</b></td></tr><tr><td>Wingspan</td><td><b>${ft(c.wing)}</b>${c.wing - c.ht > 0.25 ? ' <span class="tag g">LONG</span>' : ""}</td></tr><tr><td>Max vertical</td><td><b>${c.vert}"</b></td></tr><tr><td>Lane agility</td><td><b>${c.lane.toFixed(2)} s</b></td></tr><tr><td>3/4-court sprint</td><td><b>${c.sprint.toFixed(2)} s</b></td></tr><tr><td>Bench press (185 lb)</td><td><b>${c.bench} reps</b></td></tr></table>
     <p>Draft stock <b>${st0}</b> → <b style="color:${c.d >= 0 ? "#3ddc84" : "#ff5a4f"}">${st1}</b> (${c.d >= 0 ? "+" : ""}${c.d}) · projected ${S.projPick(st1) > 60 ? "undrafted" : "#" + S.projPick(st1)}</p>
     <div class="row"><button class="go" id="cbk">Team interviews ▶</button></div>`);
    (root.querySelector("#cbk") as HTMLElement).onclick = () => res();
  });
}
const IVQ: [string, [string, number][]][] = [
  ["\"Tell us about a time you failed.\"", [["Owned it: talked about a bad game and what I changed", 1], ["Said I never really fail", 0], ["Blamed my old coach", 0]]],
  ["\"Where do you see yourself in three years?\"", [["Starting, and making the guys around me better", 1], ["On a max contract somewhere bigger", 0], ["Honestly? Not sure", 0.5]]],
  ["\"How do you handle criticism?\"", [["Ask for film and fix it", 1], ["Block it out on Hoopr", 0.5], ["Clap back at the haters", 0]]],
  ["\"What do you bring off the court?\"", [["Early to the gym, last to leave", 1], ["Followers - big brand", 0.5], ["I'm here to hoop, that's it", 0.3]]],
];
function interviews(): Promise<void> {
  return new Promise((res) => {
    const r = mkRng(hashStr("iv" + L.seed)),
      teams: number[] = [];
    while (teams.length < 3) {
      const t = Math.floor(r() * 14);
      if (!teams.includes(t)) teams.push(t);
    }
    let ti = 0,
      qi = 0,
      sc = 0;
    const show = () => {
      const t = teams[ti],
        q = IVQ[(ti * 2 + qi) % IVQ.length];
      scr(`<small class="tag y">PRE-DRAFT INTERVIEW · ${ti + 1}/3</small><h2>${esc(S.NBA_NAMES[t])}</h2><div class="sub">Front office, head coach and a psychologist across the table.</div><div class="q">${esc(q[0])}</div><div class="ans">${q[1].map((a, k) => `<button data-iv="${k}"><kbd>${k + 1}</kbd>${esc(a[0])}</button>`).join("")}</div>`);
      on(".scr [data-iv]", (b) => {
        sc += q[1][+b.dataset.iv!][1];
        if (++qi < 2) return show();
        S.interview(L, t, sc / 2);
        toast(`${S.NBA_NAMES[t]}: ${sc / 2 >= 0.66 ? "they loved you" : sc / 2 >= 0.4 ? "solid meeting" : "that got awkward"}`, "🤝");
        qi = 0;
        sc = 0;
        if (++ti < 3) show();
        else res();
      });
    };
    show();
  });
}
function agentPick(): Promise<void> {
  return new Promise((res) => {
    scr(`<small class="tag y">REPRESENTATION</small><h2>Pick an agent</h2><div class="sub">They negotiate your contracts and endorsements (and take a cut).</div><div class="grid">${Object.entries(S.AGENTS)
      .map(([n, a]) => `<button class="opt" data-ag="${esc(n)}" style="border-left:6px solid ${a.c}"><b>${esc(n)}</b><small>${esc(a.style)} · fee ${Math.round(a.fee * 100)}%</small></button>`)
      .join("")}</div>`);
    on(".scr [data-ag]", (b) => {
      S.chooseAgent(L, b.dataset.ag!);
      S.msg(L, "agent", "Glad to be on board. Let's get you drafted - and paid. 🤝");
      res();
    });
  });
}
/** Free agency: offers from your team + three others; counter-offer with a slider (one try per team). */
function freeAgency(): Promise<void> {
  return new Promise((res) => {
    const offs = S.faOffers(L),
      tried = new Set<number>();
    const draw = () => {
      scr(`<small class="tag y">FREE AGENCY</small><h2>Your next contract</h2><div class="sub">Market value ~$${(S.marketValue(L) / 1e6).toFixed(1)}M a year · agent ${esc(L.agent || "none")}. Counter once per team: ask for more, risk the offer staying put.</div><div class="grid">${offs
        .map(
          (o, i) => `<div class="opt"><b>${esc(S.NBA_NAMES[o.tm])}${o.tm === L.team.tm ? " (your team)" : ""}</b><small>${o.yrs} years · $${(o.sal / 1e6).toFixed(2)}M / year</small>
          ${tried.has(i) ? "" : `<label class="f" style="margin-top:6px">ASK <b id="ak${i}">$${(o.sal / 1e6).toFixed(2)}M</b><input type="range" min="${o.sal}" max="${Math.round(o.sal * 1.4)}" step="10000" value="${o.sal}" data-ask="${i}"></label><small id="ac${i}">Accept chance 100%</small>`}
          <div class="row" style="margin-top:6px">${tried.has(i) ? "" : `<button class="gh" data-cnt="${i}">Counter</button>`}<button class="go" data-sgn="${i}">Sign ✍️</button></div></div>`,
        )
        .join("")}</div>`);
      root.querySelectorAll<HTMLInputElement>(".scr [data-ask]").forEach(
        (inp) =>
          (inp.oninput = () => {
            const i = +inp.dataset.ask!;
            (root.querySelector("#ak" + i) as HTMLElement).textContent = "$" + (+inp.value / 1e6).toFixed(2) + "M";
            (root.querySelector("#ac" + i) as HTMLElement).textContent = "Accept chance " + Math.round(S.acceptChance(offs[i], +inp.value) * 100) + "%";
          }),
      );
      on(".scr [data-cnt]", (b) => {
        const i = +b.dataset.cnt!,
          ask = +(root.querySelector(`[data-ask="${i}"]`) as HTMLInputElement).value;
        tried.add(i);
        const okk = S.negotiate(L, offs[i], ask);
        toast(okk ? `${S.NBA_NAMES[offs[i].tm]} agreed: $${(ask / 1e6).toFixed(2)}M` : `${S.NBA_NAMES[offs[i].tm]} won't move.`, okk ? "✅" : "🚫");
        draw();
      });
      on(".scr [data-sgn]", async (b) => {
        const o = offs[+b.dataset.sgn!],
          moved = o.tm !== L.team.tm;
        S.signFA(L, o);
        closeScr();
        await cut("FREE AGENCY", moved ? S.NBA_NAMES[o.tm].toUpperCase() : "RUN IT BACK", `${o.yrs} years, $${(o.sal / 1e6).toFixed(1)} million a year${o.sal >= 45e6 ? " - a MAX deal" : ""}. ${moved ? "New city, new jersey, same goal." : "Loyalty pays."}`);
        res();
      });
    };
    draw();
  });
}
/** Story cards queued by the state (role meeting, rookie hazing, All-Star, trade, awards with an MVP speech). */
let storyBusy = false;
async function story() {
  if (storyBusy || mode !== "world" || !L.story.length || PH.isOpen()) return;
  storyBusy = true;
  mode = "screen";
  const s0 = L.story.shift()!;
  try {
    if (s0 === "role") {
      const r = S.role(L);
      await cut("COACH'S OFFICE", r.n.toUpperCase(), `${esc((L.contacts.find((c) => c.id === "coach") || { n: "Coach" }).n)}: "${r.k >= 1 ? "You're starting. Earn it every night." : r.k >= 0.8 ? "You're our sixth man. Bring energy off the bench - show me in practice and that changes." : "Right now you're behind guys who've been here. Practice, film, be on time. Minutes are earned."}"`);
    } else if (s0 === "rookie") {
      await choice("ROOKIE DUTY", "Welcome to the league", "The vets hand you a pile of bags at the airport and a karaoke mic for the team bus.", [
        ["Carry the bags, sing the song 🎤", () => ((L.mood = clamp(L.mood - 4, 0, 100)), aff("tm1", 6), (L.rep = clamp(L.rep + 2, 0, 100)), "The vets love it. Hoopr loves it more.")],
        ["Politely pass", () => (aff("tm1", -6), "Awkward silence. The vets will remember."),],
      ]);
    } else if (s0 === "parade") await cut("CHAMPIONS", "Parade Day", `Confetti cannons, a sea of fans, and ${esc(L.p.n)} on top of a bus holding the trophy. Somebody hands you a megaphone.`, "🏆 Soak it in ▶");
    else if (s0 === "ring") await cut("BANNER NIGHT", "Ring Ceremony", `The banner rises to the rafters. One by one the names are called. Yours gets the loudest cheer. 💍`);
    else if (s0 === "allstar") await cut("NBA", "ALL-STAR", `${esc(L.p.n)} is an All-Star. The game is tonight at Summit Arena - check your calendar.`);
    else if (s0 === "trade") await cut("BREAKING", "TRADED", `${esc(L.p.n)} is headed to the ${esc(L.team.name)}. New locker, new teammates, same town on the map.`);
    else if (s0.startsWith("award:")) {
      const a = s0.slice(6);
      await choice("NBA AWARDS", a.toUpperCase(), `${esc(L.p.n)} wins ${esc(a)}. The podium, the trophy, the microphone. What do you say?`, [
        ["Thank teammates, coaches and Mom", () => ((L.rep = clamp(L.rep + 4, 0, 100)), aff("mom", 5), "A classy speech. Reputation up.")],
        ["\"I told y'all.\"", () => ((L.followers += Math.round(L.followers * 0.04)), (L.rep = clamp(L.rep - 3, 0, 100)), "It went viral. Not everybody loved it.")],
      ]);
    }
  } finally {
    storyBusy = false;
    closeScr();
    mode = "world";
    save();
  }
}
function aff(id: string, d: number) {
  const c = L.contacts.find((x) => x.id === id);
  if (c) c.aff = clamp(c.aff + d, 0, 100);
}
function choice(kick: string, h: string, p: string, opts: [string, () => string][]): Promise<void> {
  return new Promise((res) => {
    const d = document.createElement("div");
    d.className = "cut";
    d.innerHTML = `<div class="cc"><small>${esc(kick)}</small><h1>${esc(h)}</h1><p>${p}</p><div class="row" style="justify-content:center">${opts.map((o, i) => `<button class="${i ? "gh" : "go"}" data-ch="${i}">${esc(o[0])}</button>`).join("")}</div></div>`;
    root.appendChild(d);
    d.querySelectorAll<HTMLElement>("[data-ch]").forEach(
      (b) =>
        (b.onclick = () => {
          const t = opts[+b.dataset.ch!][1]();
          d.remove();
          toast(t, "💬");
          res();
        }),
    );
  });
}
async function draftNight(): Promise<void> {
  const grad = L.stage === "college" && L.yr >= 4;
  if (grad && (S.gpa(L) || 0) >= 2) await cut("COMMENCEMENT", "Graduate", `${esc(L.p.n)} walks across the stage with a degree from ${esc(L.school)}. Mom is the loudest person in the building.`);
  if (!L.flags.predraft) {
    L.flags.predraft = 1;
    await combineScreen();
    await interviews();
    await agentPick();
    PH.event({ k: "mock", pick: S.projPick(S.draftStock(L)) });
    save();
  }
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
   <button class="opt" id="pzr"><b>▶ Resume</b><small>Esc</small></button><button class="opt" id="pzs"><b>💾 Save</b><small>Slot ${L.slot + 1} · F5 / Ctrl+S</small></button><button class="opt" id="pzv"><b>🗂 Saves</b><small>Backups, export / import, cloud</small></button><button class="opt" id="pzp"><b>📱 Settings</b><small>Day length, alarm, quarters, AI, accessibility</small></button><button class="opt" id="pzh"><b>❓ Controls</b><small>Keys, touch, gamepad</small></button><button class="opt" id="pzt"><b>🏠 Title screen</b><small>Saves first</small></button><button class="opt" id="pzq"><b>⏏ Quit to hub</b><small>Saves first</small></button></div>`);
  const res = () => (closeScr(), (mode = "world"));
  (root.querySelector("#pzr") as HTMLElement).onclick = res;
  (root.querySelector("#pzs") as HTMLElement).onclick = () => (save(true), toast("Saved to slot " + (L.slot + 1), "💾"));
  (root.querySelector("#pzv") as HTMLElement).onclick = () => (save(true), openSaveHub({ ctx: "life" }));
  (root.querySelector("#pzp") as HTMLElement).onclick = () => (res(), PH.open("set"));
  (root.querySelector("#pzh") as HTMLElement).onclick = () =>
    scr(`<h2>Controls</h2><table><tr><td>Move</td><td>WASD / arrows · left thumb (touch) · left stick</td></tr><tr><td>Sprint</td><td>Shift · RUN button · push the stick to the edge · RT</td></tr><tr><td>Interact / enter</td><td>E or Enter · the yellow button · A</td></tr><tr><td>Phone</td><td>P or Tab · 📱 · Y</td></tr><tr><td>Look</td><td>Drag the mouse / right thumb · right stick · wheel = zoom</td></tr><tr><td>Answer a quiz</td><td>1-4 or click</td></tr><tr><td>Back / pause</td><td>Esc</td></tr></table><div class="row"><button class="go" id="pzr">Back ▶</button></div>`) &&
    ((root.querySelector("#pzr") as HTMLElement).onclick = res);
  (root.querySelector("#pzt") as HTMLElement).onclick = () => (save(true), SV.flush(), location.reload());
  (root.querySelector("#pzq") as HTMLElement).onclick = () => (save(true), SV.flush(), location.reload());
}
// ---------------------------------------------------------------- debug / test handle
const DBG = {
  SV,
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

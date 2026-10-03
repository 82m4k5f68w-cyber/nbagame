// Game shell for every main mode: team/My Player menus, local controllers, fixed 60 Hz loop, FX (texts, sound, crowd),
// drawing via the three.js or canvas renderer, and the box score.
import * as G from "../core/sim";
import { cfg, P, B, CT, MYP, mkT, RO, ALL, nChoices, ovr } from "../core/sim";
import { TM, PRE, ov2 } from "../core/data";
import { rapInit } from "../core/physics";
import { V, CAMN, MN, pr } from "./view";
import { glInit } from "./render3d";
import { court2d, hoop2d, net2d, player2d, ball2d, scene3c, segs3c, paint3c, ball3c, pj, CP, setCanvasCtx } from "./canvas";
import { setHudCtx, hud, hud2, contestFx, meter, openMark, passMark, replayHud } from "./hud";
import { IN, TX, hum, hum2, gpPoll, bindInput } from "./input";
import { audio } from "./audio";
import { NET } from "./net/session";
import { openStudio, studioPose } from "./animview";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
let C: HTMLCanvasElement, X: CanvasRenderingContext2D, ov: HTMLElement;
let SEL = 0,
  MYM = 0;
export const GS = { mode: "5v5-3d", booted: 0, onEnd: null as null | ((won: boolean) => void) };

function fatal(m: string) {
  ov.style.display = "flex";
  ov.innerHTML = '<h1>HOOPS 2K27</h1><p style="color:#ff9966;max-width:560px">' + m + "</p>";
}

/** Boot one of the four main modes. np = players per team, r3d = three.js renderer (else 2D court). */
export function boot(o: { np: number; r3d: boolean; my?: number; mp?: number; mode: string; online?: boolean | { host?: boolean; join?: string }; quick?: { sel: number; opp: number } }) {
  GS.mode = o.mode;
  cfg.NP = o.np;
  // Both renderers now run the same Rapier ball and hand-accurate release (2D used to get the legacy ball).
  cfg.physics = "rapier";
  cfg.hand = true;
  cfg.replays = true;
  V.r3d = o.r3d;
  loadSet();
  if (o.my != null && o.my) MYM = 1;
  IN.MP2 = o.mp ? 1 : 0;
  C = $("#c") as HTMLCanvasElement;
  X = ($("#h") as HTMLCanvasElement).getContext("2d")!;
  ov = $("#ov");
  setCanvasCtx(X);
  setHudCtx(X);
  let ERR = 0;
  window.onerror = (m, u, l) => {
    if (!ERR && !/gamepad|permission/i.test(String(m))) {
      ERR = 1;
      fatal("Error: " + m + " (line " + l + ")");
    }
  };
  try {
    Object.assign(MYP.d, JSON.parse(localStorage.getItem("h2k_myp") || "{}"));
  } catch (e) {}
  mkT();
  rapInit();
  if (o.r3d) glInit(C);
  if (!V.GL) C.style.visibility = o.r3d ? "visible" : "hidden";
  cfg.input = (c) => {
    if ((c as any).remote) return NET.remoteInput(c);
    return c.id === "p2" ? hum2() : hum();
  };
  IN.onSkip = () => {
    if (G.RPL) {
      if (NET.role === "guest") NET.requestSkip();
      else G.skipReplay();
    }
  };
  bindInput();
  addEventListener("keydown", (e) => {
    if (menuKeys) menuKeys(e);
    if ((e.code === "Escape" || e.code === "KeyP") && !NET.role && !G.RPL && (G.S === "play" || G.S === "pause")) {
      e.preventDefault();
      G.S === "pause" ? resume() : pause();
    }
  });
  addEventListener("blur", () => !NET.role && !G.RPL && G.S === "play" && pause());
  GS.booted = 1;
  (window as any).H2K = { G, V, NET, startLocal, menu, resetFx, studio, studioPose, RAP: () => import("../core/physics").then((m) => !!m.RAP) };
  NET.setMenu(menu);
  if (o.quick) {
    SEL = o.quick.sel;
    OPP = o.quick.opp;
    menu();
    startLocal(SEL, OPP >= 0 ? { j: OPP } : {});
  } else if (o.online && typeof o.online === "object") NET.quick(o.online);
  else if (o.online) NET.openLobby();
  else if (V.r3d && /[?&]anim\b/.test(location.search)) {
    menu();
    startLocal(SEL, {});
    studio();
  } else menu();
  requestAnimationFrame(loop);
}

// ---------------- settings (remembered per browser) ----------------
function loadSet() {
  try {
    const o = JSON.parse(localStorage.getItem("h2k_set") || "{}");
    if (o.m != null) V.METER = o.m;
    if (o.s != null) IN.TEMPO = o.s;
    if (o.p != null) cfg.PRO = o.p;
    if (o.cm != null) V.CAMM = o.cm;
    if (o.q != null) V.QL = o.q;
    if (o.fx != null) V.FX = !!o.fx;
    if (o.gp != null) V.GPU = o.gp ? 1 : 0;
    if (o.my != null) MYM = o.my;
    if (o.df != null) cfg.DIFF = o.df;
    if (o.ql) QLEN = o.ql;
  } catch (e) {}
}
function saveSet() {
  try {
    localStorage.setItem("h2k_set", JSON.stringify({ m: V.METER, s: IN.TEMPO, p: cfg.PRO, cm: V.CAMM, q: V.QL, fx: V.FX ? 1 : 0, gp: V.GPU, my: MYM, df: cfg.DIFF, ql: QLEN }));
  } catch (e) {}
}

// ---------------- menus ----------------
const opt = (b: string, k: string, v: number, cur: number, l: string) => `<button data-${k}="${v}" class="${cur === v ? "on" : ""}">${l}</button>`;
// ---------------- portraits, records ----------------
const AV = new Map<string, string>();
/** Little broadcast-style portrait drawn from the roster data (skin, hair, beard, jersey, number). */
export function avatar(t: any[], col: string): string {
  const key = t[0] + col;
  let u = AV.get(key);
  if (u) return u;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const x = c.getContext("2d")!,
    sk = t[7],
    hc = sk === "#e8b88f" ? "#4a3320" : "#141414";
  const g = x.createRadialGradient(48, 30, 4, 48, 48, 60);
  g.addColorStop(0, col);
  g.addColorStop(1, "#090b16");
  x.fillStyle = g;
  x.fillRect(0, 0, 96, 96);
  x.fillStyle = col; // jersey + shoulders
  x.beginPath();
  x.ellipse(48, 104, 44, 34, 0, 0, 6.3);
  x.fill();
  x.strokeStyle = "rgba(255,255,255,.75)";
  x.lineWidth = 3;
  x.beginPath();
  x.arc(48, 70, 12, 0.15 * Math.PI, 0.85 * Math.PI);
  x.stroke();
  x.fillStyle = "#fff";
  x.font = "900 15px system-ui";
  x.textAlign = "center";
  x.fillText(String(t[12]), 48, 92);
  x.fillStyle = sk; // neck, head, ears
  x.fillRect(40, 56, 16, 14);
  x.beginPath();
  x.ellipse(48, 42, 17, 21, 0, 0, 6.3);
  x.fill();
  x.beginPath();
  x.ellipse(31, 43, 3.5, 6, 0, 0, 6.3);
  x.ellipse(65, 43, 3.5, 6, 0, 0, 6.3);
  x.fill();
  x.fillStyle = hc;
  if (t[8] === 1) (x.beginPath(), x.ellipse(48, 28, 17.5, 10, 0, Math.PI, 2 * Math.PI), x.fill());
  if (t[8] === 2) (x.beginPath(), x.ellipse(48, 30, 19, 13, 0, Math.PI, 2 * Math.PI), x.fill(), x.fillRect(29, 28, 6, 26), x.fillRect(61, 28, 6, 26));
  if (t[8] === 3) (x.beginPath(), x.arc(48, 27, 22, Math.PI * 0.92, Math.PI * 2.08), x.fill());
  if (t[9]) (x.beginPath(), x.ellipse(48, 56, 14, 9, 0, 0, Math.PI), x.fill());
  x.fillStyle = "#16110c"; // eyes, brows, mouth
  x.fillRect(40, 40, 4, 3);
  x.fillRect(52, 40, 4, 3);
  x.fillStyle = hc;
  x.fillRect(38, 35, 8, 2);
  x.fillRect(50, 35, 8, 2);
  x.strokeStyle = "rgba(60,20,10,.7)";
  x.lineWidth = 1.6;
  x.beginPath();
  x.arc(48, 50, 5, 0.2 * Math.PI, 0.8 * Math.PI);
  x.stroke();
  u = c.toDataURL();
  AV.set(key, u);
  return u;
}
type Rec = { w: number; l: number; st: number; best: number; last?: any };
export const rec = {
  get(): Rec {
    try {
      return { w: 0, l: 0, st: 0, best: 0, ...JSON.parse(localStorage.getItem("h2k_rec") || "{}") };
    } catch (e) {
      return { w: 0, l: 0, st: 0, best: 0 };
    }
  },
  put(r: Rec) {
    try {
      localStorage.setItem("h2k_rec", JSON.stringify(r));
    } catch (e) {}
  },
};
const POS = ["PG", "SG", "SF", "PF", "C"],
  DIFFN = ["Rookie", "Pro", "All-Star", "Hall of Fame"],
  avg = (a: any[], k: number) => Math.round(a.reduce((s2, p) => s2 + p[k], 0) / a.length);
let OPP = -1; // -1 = random opponent
let QLEN = 60;

/** The matchup screen: your team vs. the opponent, lineups, ratings, difficulty, and a settings drawer. */
export function menu() {
  G.setS("menu");
  ov.style.display = "flex";
  ov.classList.add("mu-on");
  const NP = cfg.NP,
    N = nChoices();
  if (SEL >= N) SEL = 0;
  if (OPP >= N || OPP === SEL) OPP = -1;
  const R = rec.get(),
    side = (i: number, you: boolean) => {
      const r = RO(i),
        pl = r[1],
        ovr0 = Math.round(pl.reduce((a, p) => a + ov2(p), 0) / pl.length),
        name = r[2],
        sub = NP > 1 ? "" : TM[ALL[i].t][0],
        bars: [string, number][] = [
          ["3PT", avg(pl, 1)],
          ["INSIDE", avg(pl, 2)],
          ["SPEED", avg(pl, 3)],
          ["DEFENSE", avg(pl, 4)],
        ];
      return `<section class="side${you ? " you" : ""}" style="--c:${r[0]}">
        <div class="sh"><button class="arw" data-cy="${you ? "y" : "o"}" data-d="-1" aria-label="Previous">◀</button>
        <div class="badge">${esc(name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase())}</div>
        <div class="tn"><small>${you ? (MYM ? "YOU · MY PLAYER" : "YOU") : "OPPONENT"}${sub ? " · " + esc(sub) : ""}</small><b>${esc(name)}</b></div>
        <div class="ovr"><small>OVR</small>${ovr0}</div>
        <button class="arw" data-cy="${you ? "y" : "o"}" data-d="1" aria-label="Next">▶</button></div>
        <div class="rt">${bars.map(([k, v]) => `<div><span>${k}</span><i style="--w:${v}%"></i><em>${v}</em></div>`).join("")}</div>
        <ol class="lu">${pl
          .map(
            (p, k) =>
              `<li style="--d:${k * 60}ms"><img alt="" src="${avatar(p, r[0])}"><span class="pn">${NP > 1 ? POS[k] : "#" + p[12]}</span><b>${esc(p[0])}</b><span class="po">${ov2(p)}</span></li>`,
          )
          .join("")}</ol></section>`;
    };
  const oppI = OPP < 0 ? -1 : OPP;
  ov.innerHTML = `<div class="mu">
  <header class="mu-top"><div class="logo">HOOPS<span>2K27</span></div><div class="mu-sub">${NP > 1 ? "5V5" : "1V1 SHOWDOWN"} · ${V.r3d ? "3D ARENA" : "2D COURT"}</div>
   <div class="rec" title="Your record vs the CPU">${R.w}W · ${R.l}L${R.st > 1 ? ` · 🔥 ${R.st} straight` : ""}</div><button id="set" class="gear">⚙ Settings</button></header>
  <div class="vs">${side(SEL, true)}
   <div class="mid"><div class="vsb">VS</div>
    <div class="chips"><b>DIFFICULTY</b>${DIFFN.map((n, i) => opt("", "df", i, cfg.DIFF, n)).join("")}</div>
    <div class="chips"><b>QUARTERS</b>${[30, 60, 120, 180].map((q) => `<button data-ql="${q}" class="${QLEN === q ? "on" : ""}">${q < 60 ? q + "s" : q / 60 + " min"}</button>`).join("")}</div>
    <button class="big" id="tip">TIP OFF ▶</button><p class="hint">← → your ${NP > 1 ? "team" : "star"} · ↑ ↓ opponent · Enter tip off</p></div>
   ${oppI < 0 ? `<section class="side rnd"><div class="sh"><button class="arw" data-cy="o" data-d="-1" aria-label="Previous">◀</button><div class="badge">?</div><div class="tn"><small>OPPONENT</small><b>Random</b></div><button class="arw" data-cy="o" data-d="1" aria-label="Next">▶</button></div><p class="hint" style="margin:10px 0">A surprise ${NP > 1 ? "team" : "star"} every game. Use ▶ or ↑ ↓ to pick one.</p><ol class="lu q">${(NP > 1 ? POS : ["?"])
        .map((ps, k) => `<li style="--d:${k * 60}ms"><span class="qa">?</span><span class="pn">${NP > 1 ? ps : ""}</span><b>Mystery ${NP > 1 ? "starter" : "star"}</b><span class="po">??</span></li>`)
        .join("")}</ol></section>` : side(oppI, false)}</div>
  <div id="g" class="strip" role="listbox" aria-label="Choose">${[...Array(N).keys()]
    .map((i) => {
      const r = RO(i);
      return `<button class="card${i === SEL ? " sel" : ""}" role="option" aria-selected="${i === SEL}" data-i="${i}" style="--i:${i % 12};--c:${r[0]}" title="${esc(r[2])}">${NP > 1 ? esc(r[2]) : `<img alt="" src="${avatar(r[1][0], r[0])}"><span>${esc(r[2].split(" ").pop()!)}</span>`}</button>`;
    })
    .join("")}</div>
  <aside id="sd" hidden><div class="sdh"><b>SETTINGS</b><button id="sdx" aria-label="Close settings">✕</button></div>
   <div class="opts"><h3>MATCH</h3><b>PLAYERS</b>${opt("", "mp", 0, IN.MP2, "1 Player")}${opt("", "mp", 1, IN.MP2, "2 Players (keyboard)")}<button id="online">🌐 Play online</button>
    <b>PLAYER MODE</b>${opt("", "my", 0, MYM, "Pick a team")}${opt("", "my", 1, MYM, "My Player")}<button id="edit">✎ Edit my player</button>
    <b>PRO PLAY ENGINE</b>${opt("", "p", 1, cfg.PRO, "On")}${opt("", "p", 0, cfg.PRO, "Off")}</div>
   <div class="opts"><h3>SHOOTING</h3><b>STYLE</b>${opt("", "s", 0, IN.TEMPO, "Hold &amp; release")}${opt("", "s", 1, IN.TEMPO, "Tempo")}<b>SHOT METER</b>${MN.map((n, i) => opt("", "m", i, V.METER, n)).join("")}</div>
   ${V.r3d ? `<div class="opts"><h3>DISPLAY</h3><b>CAMERA</b>${CAMN.map((n, i) => opt("", "cm", i, V.CAMM, n)).join("")}<b>GRAPHICS</b>${opt("", "q", 0, V.QL, "Low")}${opt("", "q", 1, V.QL, "Medium")}${opt("", "q", 2, V.QL, "High")}<b>EFFECTS</b>${opt("", "fx", 1, V.FX ? 1 : 0, "On")}${opt("", "fx", 0, V.FX ? 1 : 0, "Off")}<b>RENDERER</b>${opt("", "gp", 0, V.GPU, "WebGL")}${opt("", "gp", 1, V.GPU, "WebGPU (beta)")}<i style="opacity:.6;font-size:11px;display:block">${V.backend ? "Now: " + V.backend : ""}${(V.backend === "WebGL") !== !V.GPU ? " · restart to switch" : ""}</i></div>` : ""}
   <p class="hint">P2 (local) = right team: arrows move · Enter shoot · / pass · . spin · , hesi · Right Shift sprint</p></aside></div>`;
  const re = () => (saveSet(), menu());
  const cyc = (who: string, d: number) => {
    if (who === "y") {
      SEL = (SEL + d + N) % N;
      if (SEL === OPP) SEL = (SEL + d + N) % N;
    } else {
      let o = OPP + d;
      if (o < -1) o = N - 1;
      if (o >= N) o = -1;
      if (o === SEL) o += d;
      OPP = o >= N ? -1 : o < -1 ? N - 1 : o;
    }
    menu();
    const f = ov.querySelector<HTMLElement>(`.arw[data-cy="${who}"][data-d="${d}"]`);
    f && f.focus();
  };
  ov.querySelectorAll<HTMLElement>(".arw").forEach((b) => (b.onclick = () => cyc(b.dataset.cy!, +b.dataset.d!)));
  ov.querySelectorAll<HTMLElement>(".strip .card").forEach(
    (b) =>
      (b.onclick = () => {
        SEL = +b.dataset.i!;
        if (OPP === SEL) OPP = -1;
        menu();
      }),
  );
  const tip = () => {
    saveSet();
    try {
      localStorage.setItem("h2k_lastplay", JSON.stringify({ mode: GS.mode, sel: SEL, opp: OPP }));
    } catch (e) {}
    startLocal(SEL, OPP >= 0 ? { j: OPP } : {});
  };
  $("#tip").onclick = tip;
  const grp = (k: string, f: (v: number) => void, again = false) =>
    ov.querySelectorAll<HTMLElement>(`[data-${k}]`).forEach(
      (b) =>
        (b.onclick = () => {
          f(+b.dataset[k]!);
          saveSet();
          if (again) menu();
          else ov.querySelectorAll(`[data-${k}]`).forEach((c) => c.classList.toggle("on", c === b));
        }),
    );
  grp("df", (v) => (cfg.DIFF = v));
  grp("ql", (v) => (QLEN = v));
  grp("m", (v) => (V.METER = v));
  grp("s", (v) => (IN.TEMPO = v));
  grp("p", (v) => (cfg.PRO = v));
  grp("cm", (v) => (V.CAMM = v));
  grp("q", (v) => (V.QL = v));
  grp("fx", (v) => (V.FX = !!v));
  grp("gp", (v) => {
    // the renderer is created once at start: save, then reload into the menu with the new one
    V.GPU = v;
    saveSet();
    setTimeout(() => location.reload(), 150);
  });
  grp("my", (v) => (MYM = v), true);
  grp("mp", (v) => (IN.MP2 = v));
  const sd = $("#sd");
  $("#set").onclick = () => {
    sd.hidden = false;
    ($("#sdx") as HTMLElement).focus();
  };
  $("#sdx").onclick = () => {
    sd.hidden = true;
    ($("#set") as HTMLElement).focus();
  };
  $("#edit").onclick = () => (ov.classList.remove("mu-on"), edMy());
  $("#online").onclick = () => (ov.classList.remove("mu-on"), NET.openLobby());
  void re;
  menuKeys = (e: KeyboardEvent) => {
    if (G.S !== "menu" || ov.style.display === "none" || !document.getElementById("tip")) return;
    if ((e.target as HTMLElement)?.closest?.("input,select")) return;
    if (e.code === "Escape" && !sd.hidden) return $("#sdx").click();
    if (!sd.hidden) return;
    if (e.code === "ArrowRight") cyc("y", 1);
    else if (e.code === "ArrowLeft") cyc("y", -1);
    else if (e.code === "ArrowDown") cyc("o", 1);
    else if (e.code === "ArrowUp") cyc("o", -1);
    else if (e.code === "Enter" && !(e.target as HTMLElement)?.closest?.("button")) tip();
    else return;
    e.preventDefault();
  };
}
function edMy() {
  const d = MYP.d,
    SKN = ["#f1c27d", "#c68642", "#8d5524", "#6b4226", "#e8b88f"],
    CAP = 380,
    ST = ["Standard", "Quick", "Fadeaway", "Step-back", "Touch"],
    HR = ["Bald", "Short", "Long", "Afro"],
    re = () => {
      d.n = ($("#mn") as HTMLInputElement).value || d.n;
      edMy();
    };
  const sl = (k: string, l: string) =>
    `<label>${l} <b id="v${k}">${d[k]}</b><input type="range" min="40" max="99" value="${d[k]}" data-k="${k}"></label>`;
  ov.innerHTML = `<div class="logo" style="font-size:34px">MY PLAYER</div><div class="opts"><input id="mn" maxlength="12" value="${esc(d.n)}"><b>ARCHETYPE</b>${Object.keys(PRE)
    .map((k) => `<button data-pre="${k}">${k}</button>`)
    .join(
      "",
    )}</div><div class="opts ed">${sl("c", "3PT")}${sl("i", "INSIDE")}${sl("s", "SPEED")}${sl("d", "DEFENSE")}${sl("j", "JUMP")}<div id="pts"></div></div>
<div class="opts"><b>SHOT FORM</b>${ST.map((n, i) => `<button data-st="${i}" class="${d.st === i ? "on" : ""}">${n}</button>`).join("")}<b>LOOK</b>${SKN.map((c) => `<button data-sk="${c}" style="background:${c};width:34px;height:34px;padding:0;${d.sk === c ? "outline:3px solid #ffd23f" : ""}"></button>`).join("")}${HR.map((n, i) => `<button data-hr="${i}" class="${d.hr === i ? "on" : ""}">${n}</button>`).join("")}<button data-bd="1" class="${d.bd ? "on" : ""}">Beard</button>
<label>Height <b id="vh">${d.ht.toFixed(1)}</b> ft<input type="range" min="6" max="7.3" step=".1" value="${d.ht}" data-h="ht"></label><label>Build<input type="range" min=".9" max="1.3" step=".05" value="${d.bk}" data-h="bk"></label><label>Number<input id="mno" type="number" min="0" max="99" value="${d.no}"></label></div><button class="big" id="done">SAVE ▶</button>`;
  const up = () => {
    $("#pts").textContent = "Points " + (CAP - (d.c + d.i + d.s + d.d + d.j)) + " left · OVR " + ovr({ n: "x", c: d.c, i: d.i });
  };
  up();
  ov.querySelectorAll<HTMLInputElement>("input[data-k]").forEach(
    (e) =>
      (e.oninput = () => {
        const k = e.dataset.k!;
        let v = +e.value;
        const o = d.c + d.i + d.s + d.d + d.j - d[k];
        if (o + v > CAP) v = CAP - o;
        d[k] = v;
        e.value = String(v);
        $("#v" + k).textContent = String(v);
        up();
      }),
  );
  ov.querySelectorAll<HTMLElement>("[data-pre]").forEach(
    (b) =>
      (b.onclick = () => {
        const a = PRE[b.dataset.pre!];
        [d.c, d.i, d.s, d.d, d.j, d.st] = a;
        re();
      }),
  );
  ov.querySelectorAll<HTMLElement>("[data-st]").forEach((b) => (b.onclick = () => ((d.st = +b.dataset.st!), re())));
  ov.querySelectorAll<HTMLElement>("[data-sk]").forEach((b) => (b.onclick = () => ((d.sk = b.dataset.sk), re())));
  ov.querySelectorAll<HTMLElement>("[data-hr]").forEach((b) => (b.onclick = () => ((d.hr = +b.dataset.hr!), re())));
  (ov.querySelector("[data-bd]") as HTMLElement).onclick = () => {
    d.bd = d.bd ? 0 : 1;
    re();
  };
  ov.querySelectorAll<HTMLInputElement>("[data-h]").forEach(
    (e) =>
      (e.oninput = () => {
        d[e.dataset.h!] = +e.value;
        if (e.dataset.h === "ht") $("#vh").textContent = (+e.value).toFixed(1);
      }),
  );
  $("#done").onclick = () => {
    d.n = (($("#mn") as HTMLInputElement).value || "MY PLAYER").toUpperCase().slice(0, 12);
    d.no = +($("#mno") as HTMLInputElement).value || 0;
    mkT();
    try {
      localStorage.setItem("h2k_myp", JSON.stringify(d));
    } catch (e) {}
    menu();
  };
}
let menuKeys: ((e: KeyboardEvent) => void) | null = null;
/** Pause (offline games): the sim stops ticking; the menu offers resume / restart / settings / quit. */
function pause() {
  G.setS("pause");
  ov.style.display = "flex";
  ov.classList.remove("mu-on");
  ov.innerHTML = `<div class="logo" style="font-size:38px">PAUSED</div><div class="sub">${esc(G.cl[0])} ${G.sc[0]} — ${G.sc[1]} ${esc(G.cl[1])} · Q${G.q}</div><div id="pz">
  <button id="pr">▶ Resume</button>${V.r3d ? `<button id="pc">🎥 Camera: ${CAMN[V.CAMM]}</button><button id="pf">✨ Effects: ${V.FX ? "On" : "Off"}</button>` : ""}<button id="pm">🎯 Meter: ${MN[V.METER]}</button><button id="pt">⏱ Shooting: ${IN.TEMPO ? "Tempo" : "Hold & release"}</button><button id="prs">↻ Restart game</button>${V.r3d ? `<button id="pan">🎬 Animation Studio</button>` : ""}<button id="pq">✕ Quit to menu</button></div><p class="hint">Esc or P to resume</p>`;
  $("#pr").onclick = resume;
  const re = () => (saveSet(), pause());
  if (V.r3d) {
    $("#pc").onclick = () => ((V.CAMM = (V.CAMM + 1) % 4), re());
    $("#pf").onclick = () => ((V.FX = !V.FX), re());
  }
  $("#pm").onclick = () => ((V.METER = (V.METER + 1) % 4), re());
  $("#pt").onclick = () => {
    IN.TEMPO = 1 - IN.TEMPO;
    for (const c of CT) c.tempo = IN.TEMPO;
    re();
  };
  $("#prs").onclick = () => startLocal(SEL, { j: lastJ });
  if (V.r3d) $("#pan").onclick = () => studio();
  $("#pq").onclick = menu;
  ($("#pr") as HTMLElement).focus();
}
function resume() {
  G.setS("play");
  ov.style.display = "none";
}
let lastJ: number | undefined;
export const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

/** Local game: P1 on team 0 (+ P2 on team 1 for local 2-player). */
export function startLocal(i: number, o: { j?: number } = {}) {
  endAt = 0;
  audio.crowdInit();
  cfg.MYM = MYM;
  const cs = [G.mkCtrl("p1", 0, !!MYM, IN.TEMPO)];
  if (IN.MP2) cs.push(G.mkCtrl("p2", 1, false, IN.TEMPO));
  G.setCtrls(cs);
  V.focus = 0;
  G.setQtrLen(QLEN);
  lastJ = G.start(i, o);
  ov.style.display = "none";
  ov.classList.remove("mu-on");
  lastFx = G.FX.length ? G.FX[G.FX.length - 1].id - 1 : 0;
}

// ---------------- effects ----------------
let lastFx = 0,
  endAt = 0;
function drainFx() {
  if (endAt && performance.now() >= endAt) {
    endAt = 0;
    endGame();
  }
  for (const f of G.FX) {
    if (f.id <= lastFx) continue;
    lastFx = f.id;
    if (f.k === "s") audio.snd(f.f, f.d, f.ty, f.v);
    else if (f.k === "t") TX.push({ s: f.s, x: f.x, y: f.y, z: f.z, sx: f.sx, sy: f.sy, c: f.c, t: 1.2, oy: 0 });
    else if (f.k === "x") audio.EXC = f.v;
    else if (f.k === "end") endAt = performance.now() + (V.r3d && V.GL ? 4000 : 1200); // let the confetti fall first
    else if (f.k === "shake") V.shake && V.shake(f.v);
    else if (f.k === "slow" && !NET.role) slowT = Math.max(slowT, f.v);
    else if (f.k === "chant") audio.chant();
  }
}
export const resetFx = (id: number) => (lastFx = id);
// Dribble thumps come from watching the ball (works the same offline and as an online guest, no network events).
let dbZ = 99,
  dbV = 0;
function dribSound() {
  const B = G.B,
    v = B.z - dbZ;
  if (v === 0) return; // high-refresh frames between sim ticks
  if (B.owner && B.owner.mode === "i" && G.S === "play" && dbV < 0 && v > 0 && dbZ < 12) audio.bounce(V.focus != null && CT[V.focus] && B.owner.tm === CT[V.focus].tm ? 1 : 0.6);
  dbV = v;
  dbZ = B.z;
}
function endGame() {
  const sc = G.sc,
    cl = G.cl;
  ov.style.display = "flex";
  ov.classList.remove("mu-on");
  const me = (CT[V.focus] || CT[0]).tm,
    w = sc[me] > sc[1 - me],
    tm = (t: number) => P.filter((p) => p.tm === t),
    sum = (t: number, k: string) => tm(t).reduce((a, p) => a + p.stt[k], 0),
    pct = (m: number, a: number) => (a ? Math.round((100 * m) / a) : 0);
  // record (offline games vs the CPU only)
  if (!NET.role && !IN.MP2) {
    const r = rec.get();
    if (w) (r.w++, (r.st = Math.max(1, r.st + 1)), (r.best = Math.max(r.best, r.st)));
    else (r.l++, (r.st = 0));
    rec.put(r);
  }
  // player of the game: best line on the winning side
  const wt = sc[0] >= sc[1] ? 0 : 1,
    pog = tm(wt).sort((a, b) => b.stt.pts + b.stt.reb * 1.2 + b.stt.ast * 1.5 + b.stt.blk * 2 - (a.stt.pts + a.stt.reb * 1.2 + a.stt.ast * 1.5 + a.stt.blk * 2))[0];
  const rows: [string, number, number][] = [
    ["FG%", pct(sum(0, "fgm"), sum(0, "fga")), pct(sum(1, "fgm"), sum(1, "fga"))],
    ["3P%", pct(sum(0, "tpm"), sum(0, "tpa")), pct(sum(1, "tpm"), sum(1, "tpa"))],
    ["REB", sum(0, "reb"), sum(1, "reb")],
    ["AST", sum(0, "ast"), sum(1, "ast")],
    ["BLK", sum(0, "blk"), sum(1, "blk")],
  ];
  const tb = (t: number) =>
    `<table class="bx"><tr><th>${esc(cl[t])}</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th><th>BLK</th></tr>${tm(t)
      .map((p) => `<tr><td>${esc(p.n)}</td><td>${p.stt.pts}</td><td>${p.stt.reb}</td><td>${p.stt.ast}</td><td>${p.stt.fgm}-${p.stt.fga}</td><td>${p.stt.tpm}-${p.stt.tpa}</td><td>${p.stt.blk}</td></tr>`)
      .join("")}</table>`;
  const r = rec.get();
  ov.innerHTML = `<div class="fin" style="--c0:${G.PC[0]};--c1:${G.PC[1]}">
   <div class="logo" style="font-size:44px;animation:none;color:${NET.role || IN.MP2 ? "#fff" : w ? "#ffd23f" : "#ff8a6b"}">${NET.role || IN.MP2 ? "FINAL" : w ? "VICTORY" : "DEFEAT"}</div>
   <div class="sc"><span style="--c:${G.PC[0]}">${esc(cl[0])}</span><b>${sc[0]}</b><i>—</i><b>${sc[1]}</b><span style="--c:${G.PC[1]}">${esc(cl[1])}</span></div>
   ${!NET.role && !IN.MP2 ? `<p class="hint">Record ${r.w}W · ${r.l}L${r.st > 1 ? " · 🔥 " + r.st + " straight" : ""}${r.best > 1 ? " · best streak " + r.best : ""}</p>` : ""}
   ${pog ? `<div class="pog"><img alt="" src="${avatar([pog.n, pog.c, pog.i, pog.s, pog.d, pog.j, pog.st, pog.skin, pog.hr, pog.bd, pog.ht, pog.bk, pog.no], pog.col)}"><div><small>PLAYER OF THE GAME</small><b>${esc(pog.n)}</b><span>${pog.stt.pts} PTS · ${pog.stt.reb} REB · ${pog.stt.ast} AST${pog.stt.blk ? " · " + pog.stt.blk + " BLK" : ""}</span></div></div>` : ""}
   <div class="cmp">${rows
     .map(([k, a2, b2]) => {
       const t = a2 + b2 || 1;
       return `<div><em>${a2}</em><span><i style="--w:${(100 * a2) / t}%;background:var(--c0)"></i><i style="--w:${(100 * b2) / t}%;background:var(--c1)"></i></span><em>${b2}</em><small>${k}</small></div>`;
     })
     .join("")}</div>
   <details class="bxw"><summary>Box score</summary>${tb(0)}${tb(1)}</details>
   <div class="row">${NET.role ? `<button class="big" id="pa">Back to lobby</button>` : `<button class="big" id="rm">↻ REMATCH</button><button id="pa" class="ghost">Change teams</button>`}</div></div>`;
  $("#pa").onclick = () => (NET.role ? NET.backToLobby() : menu());
  const rm = document.getElementById("rm");
  if (rm) rm.onclick = () => startLocal(SEL, { j: lastJ });
  GS.onEnd && GS.onEnd(w);
}

// ---------------- drawing ----------------
let cx = 0;
export function draw() {
  if (!V.r3d) return draw2d();
  const tx = P.length ? G.clamp((B.x - 470) * 0.085, -30, 30) : 0;
  cx += (tx - cx) * 0.08;
  CP[0] = cx;
  if (V.GL) {
    X.clearRect(0, 0, 960, 540);
    try {
      V.GL.render();
    } catch (e) {
      V.GL = null;
      console.error(e);
    }
  }
  if (!V.GL) scene3c();
  if (!P.length) return;
  if (!V.GL)
    for (const p of P) {
      const w = G.W3(p.x, p.y, 0),
        q = pj(w[0], 0, w[2]),
        r = Math.max(0.35, 1 - p.z * 0.012);
      X.fillStyle = "rgba(0,0,0,.32)";
      X.beginPath();
      X.ellipse(q[0], q[1], 1.1 * q[2] * r, 0.45 * q[2] * r, 0, 0, 6.3);
      X.fill();
    }
  CT.forEach((c, k) => {
    const p = P[c.idx];
    if (!p) return;
    const c0 = pr(p.x, p.y, 0),
      c1 = pr(p.x + 19, p.y, 0),
      rx = Math.abs(c1[0] - c0[0]) || 20;
    X.strokeStyle = c.tm === 0 ? "#ffd23f" : "#4fd1ff";
    X.lineWidth = k === V.focus ? 2.5 : 1.8;
    X.beginPath();
    X.ellipse(c0[0], c0[1], rx, rx * 0.42, 0, 0, 6.3);
    X.stroke();
  });
  if (!V.GL) {
    const L: any[] = [];
    P.forEach((p) => p.q && segs3c(p, L));
    const bw = G.W3(B.x, B.y, B.z),
      bq = pj(bw[0], bw[1], bw[2]),
      bf = pj(bw[0], 0, bw[2]);
    X.fillStyle = "rgba(0,0,0,.35)";
    X.beginPath();
    X.ellipse(bf[0], bf[1], 0.5 * bf[2], 0.22 * bf[2], 0, 0, 6.3);
    X.fill();
    L.push({ z: bq[3] - 0.3, ball: bq });
    L.sort((a, b) => b.z - a.z);
    L.forEach((o) => (o.ball ? ball3c(o.ball) : paint3c(o)));
  }
  overlay();
}
const DL: any[] = [];
function draw2d() {
  court2d();
  hoop2d(0);
  hoop2d(1);
  if (!P.length) return;
  DL.length = 0;
  for (const p of P) DL.push(p);
  DL.push(B);
  DL.sort((a, b) => (a === B ? B.y + (B.owner ? 1 : 0) : a.y) - (b === B ? B.y + (B.owner ? 1 : 0) : b.y));
  for (const o of DL) o === B ? ball2d() : player2d(o);
  net2d(0);
  net2d(1);
  overlay();
}
function overlay() {
  hud();
  hud2();
  X.textAlign = "center";
  X.font = "700 11px system-ui";
  X.fillStyle = "#fff";
  const seen = new Set();
  for (const p of [...CT.map((c) => P[c.idx]), B.owner])
    if (p && !seen.has(p)) {
      seen.add(p);
      const [sx, sy] = pr(p.x, p.y, p.z + 78);
      X.fillText(p.n.toUpperCase() + " " + ovr(p), sx, sy);
    }
  const p0 = V.focusP();
  if (p0) {
    contestFx(p0);
    meter(p0);
  }
  openMark();
  passMark();
  replayHud();
  if (!NET.role)
    for (const c of CT)
      if (P[c.idx] !== p0) {
      contestFx(P[c.idx]);
      meter(P[c.idx]);
    }
  NET.hud(X);
}

// ---------------- loop ----------------
let last = performance.now(),
  ACC = 0,
  slowT = 0,
  coverN = 0;
export const STEP = 1 / 60;
let ATICK: ((dt: number) => void) | null = null;
const studio = (at = 0) => {
  ov.style.display = "none";
  ov.classList.remove("mu-on");
  openStudio((f) => (ATICK = f), at);
};
function loop(n: number) {
  requestAnimationFrame(loop);
  if (document.hidden) {
    last = n; // paused while hidden: no catch-up burst on return
    return;
  }
  const dt = Math.min(0.1, (n - last) / 1000);
  last = n;
  gpPoll();
  if (NET.role && G.S !== "play" && !G.RPL) NET.lobbyTick();
  if (NET.role === "guest") NET.guestFrame(dt);
  else if (G.S === "play" || G.RPL) {
    // slow motion for the big moments (offline): the sim runs at 35% speed for a beat
    if (slowT > 0) {
      slowT -= dt;
      ACC += dt * 0.35;
    } else ACC += dt;
    let k = 0;
    while (ACC >= STEP && k < 6) {
      G.upd(STEP);
      if (NET.role === "host") NET.hostTick();
      ACC -= STEP;
      k++;
    }
  } else {
    G.setT(G.T + dt);
    if (ATICK) ATICK(dt);
  }
  audio.tick(dt);
  drainFx();
  dribSound();
  for (const o of TX) {
    o.t -= dt;
    o.oy -= 25 * dt;
  }
  for (let i = TX.length - 1; i >= 0; i--) if (TX[i].t <= 0) TX.splice(i, 1);
  // Menus and lobbies cover the whole screen: don't burn the GPU on the arena behind them (one frame per second).
  const covered = ov.style.display !== "none" && G.S !== "play" && !G.RPL;
  if (!covered || ++coverN % 60 === 0) draw();
}

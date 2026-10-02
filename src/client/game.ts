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
export function boot(o: { np: number; r3d: boolean; my?: number; mp?: number; mode: string; online?: boolean }) {
  GS.mode = o.mode;
  cfg.NP = o.np;
  cfg.physics = o.r3d ? "rapier" : "legacy";
  cfg.hand = o.r3d;
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
  if (o.r3d) {
    rapInit();
    glInit(C);
  }
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
  (window as any).H2K = { G, V, NET, startLocal, menu, resetFx, RAP: () => import("../core/physics").then((m) => !!m.RAP) };
  NET.setMenu(menu);
  if (o.online) NET.openLobby();
  else menu();
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
    if (o.my != null) MYM = o.my;
  } catch (e) {}
}
function saveSet() {
  try {
    localStorage.setItem("h2k_set", JSON.stringify({ m: V.METER, s: IN.TEMPO, p: cfg.PRO, cm: V.CAMM, q: V.QL, fx: V.FX ? 1 : 0, my: MYM }));
  } catch (e) {}
}

// ---------------- menus ----------------
const opt = (b: string, k: string, v: number, cur: number, l: string) => `<button data-${k}="${v}" class="${cur === v ? "on" : ""}">${l}</button>`;
export function menu() {
  G.setS("menu");
  ov.style.display = "flex";
  const NP = cfg.NP,
    N = nChoices(),
    IT = [...Array(N).keys()].map((i) => {
      const r = RO(i);
      return {
        n: r[2],
        c: r[0],
        sub: NP > 1 ? r[1].map((p) => p[0]).join(" · ") : TM[ALL[i].t][0],
        o: Math.round(r[1].reduce((a, p) => a + ov2(p), 0) / r[1].length),
        pl: r[1],
      };
    });
  if (SEL >= N) SEL = 0;
  ov.style.setProperty("--tc", IT[SEL].c);
  ov.innerHTML = `<div class="logo">HOOPS<span>2K27</span></div><div class="sub">${NP > 1 ? "5V5 · PICK YOUR TEAM" : "1V1 SHOWDOWN · PICK YOUR STAR"} · ${V.r3d ? "3D ARENA" : "2D COURT"}</div><div id="g" role="listbox" aria-label="Choose">${IT.map(
    (t, i) =>
      `<button class="card${i === SEL ? " sel" : ""}" role="option" aria-selected="${i === SEL}" data-i="${i}" style="--i:${i % 12};--c:${t.c}"><i>${esc(t.n.slice(0, 3).toUpperCase())}</i><b>${esc(t.n)}</b><small>${esc(t.sub)}</small><em>OVR ${t.o}</em></button>`,
  ).join("")}</div><div id="pv"></div>
  <button class="big" id="tip">TIP OFF ▶</button><p class="hint">← → choose · Enter tip off · Esc pauses in game</p>
  <div class="setw">
   <div class="opts"><h3>MATCH</h3><b>PLAYERS</b>${opt("", "mp", 0, IN.MP2, "1 Player")}${opt("", "mp", 1, IN.MP2, "2 Players (keyboard)")}<button id="online">🌐 Play online</button>
    <b>PLAYER MODE</b>${opt("", "my", 0, MYM, "Pick a team")}${opt("", "my", 1, MYM, "My Player")}<button id="edit">✎ Edit my player</button>
    <b>PRO PLAY ENGINE</b>${opt("", "p", 1, cfg.PRO, "On")}${opt("", "p", 0, cfg.PRO, "Off")}</div>
   <div class="opts"><h3>SHOOTING</h3><b>STYLE</b>${opt("", "s", 0, IN.TEMPO, "Hold &amp; release")}${opt("", "s", 1, IN.TEMPO, "Tempo")}<b>SHOT METER</b>${MN.map((n, i) => opt("", "m", i, V.METER, n)).join("")}</div>
   ${
     V.r3d
       ? `<div class="opts"><h3>DISPLAY</h3><b>CAMERA</b>${CAMN.map((n, i) => opt("", "cm", i, V.CAMM, n)).join("")}<b>GRAPHICS</b>${opt("", "q", 0, V.QL, "Low")}${opt("", "q", 1, V.QL, "Medium")}${opt("", "q", 2, V.QL, "High")}<b>EFFECTS</b>${opt("", "fx", 1, V.FX ? 1 : 0, "Bloom · AO · blur · reflections")}${opt("", "fx", 0, V.FX ? 1 : 0, "Off")}</div>`
       : ""
   }
  </div>
  <p class="hint">P2 (local) = right team: arrows move · Enter shoot · / pass · . spin · , hesi · Right Shift sprint</p>`;
  const pv = () => {
    $("#pv").innerHTML =
      IT[SEL].pl
        .map(
          (p, k) =>
            `<div class="pl" style="--d:${k * 80}ms"><b>${p[0]}</b><span>${ov2(p)}</span><u style="--w:${p[1]}%"></u><u style="--w:${p[2]}%"></u><u style="--w:${p[3]}%"></u></div>`,
        )
        .join("") + '<p class="lg">bars: 3PT · INSIDE · SPEED</p>';
  };
  pv();
  const pickCard = (i: number, focus = false) => {
    SEL = (i + N) % N;
    ov.querySelectorAll<HTMLElement>(".card").forEach((c, k) => {
      c.classList.toggle("sel", k === SEL);
      c.setAttribute("aria-selected", String(k === SEL));
      if (k === SEL && focus) c.focus();
    });
    ov.style.setProperty("--tc", IT[SEL].c);
    pv();
  };
  ov.querySelectorAll<HTMLElement>(".card").forEach((b) => (b.onclick = () => pickCard(+b.dataset.i!)));
  menuKeys = (e: KeyboardEvent) => {
    if (G.S !== "menu" || ov.style.display === "none" || !document.getElementById("tip")) return;
    if ((e.target as HTMLElement)?.closest?.("input,select")) return;
    const cols = Math.max(1, Math.round(($("#g").clientWidth || 600) / 208));
    if (e.code === "ArrowRight") pickCard(SEL + 1, true);
    else if (e.code === "ArrowLeft") pickCard(SEL - 1, true);
    else if (e.code === "ArrowDown") pickCard(SEL + cols, true);
    else if (e.code === "ArrowUp") pickCard(SEL - cols, true);
    else if (e.code === "Enter") startLocal(SEL);
    else return;
    e.preventDefault();
  };
  $("#tip").onclick = () => startLocal(SEL);
  const grp = (k: string, f: (v: number) => void) =>
    ov.querySelectorAll<HTMLElement>(`[data-${k}]`).forEach(
      (b) =>
        (b.onclick = () => {
          f(+b.dataset[k]!);
          saveSet();
          ov.querySelectorAll(`[data-${k}]`).forEach((c) => c.classList.toggle("on", c === b));
        }),
    );
  grp("m", (v) => (V.METER = v));
  grp("s", (v) => (IN.TEMPO = v));
  grp("p", (v) => (cfg.PRO = v));
  grp("cm", (v) => (V.CAMM = v));
  grp("q", (v) => (V.QL = v));
  grp("fx", (v) => (V.FX = !!v));
  grp("my", (v) => (MYM = v));
  grp("mp", (v) => (IN.MP2 = v));
  $("#edit").onclick = edMy;
  $("#online").onclick = () => NET.openLobby();
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
  ov.innerHTML = `<div class="logo" style="font-size:38px">PAUSED</div><div class="sub">${esc(G.cl[0])} ${G.sc[0]} — ${G.sc[1]} ${esc(G.cl[1])} · Q${G.q}</div><div id="pz">
  <button id="pr">▶ Resume</button>${V.r3d ? `<button id="pc">🎥 Camera: ${CAMN[V.CAMM]}</button><button id="pf">✨ Effects: ${V.FX ? "On" : "Off"}</button>` : ""}<button id="pm">🎯 Meter: ${MN[V.METER]}</button><button id="pt">⏱ Shooting: ${IN.TEMPO ? "Tempo" : "Hold & release"}</button><button id="prs">↻ Restart game</button><button id="pq">✕ Quit to menu</button></div><p class="hint">Esc or P to resume</p>`;
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
  audio.crowdInit();
  cfg.MYM = MYM;
  const cs = [G.mkCtrl("p1", 0, !!MYM, IN.TEMPO)];
  if (IN.MP2) cs.push(G.mkCtrl("p2", 1, false, IN.TEMPO));
  G.setCtrls(cs);
  V.focus = 0;
  lastJ = G.start(i, o);
  ov.style.display = "none";
  lastFx = G.FX.length ? G.FX[G.FX.length - 1].id - 1 : 0;
}

// ---------------- effects ----------------
let lastFx = 0;
function drainFx() {
  for (const f of G.FX) {
    if (f.id <= lastFx) continue;
    lastFx = f.id;
    if (f.k === "s") audio.snd(f.f, f.d, f.ty, f.v);
    else if (f.k === "t") TX.push({ s: f.s, x: f.x, y: f.y, z: f.z, sx: f.sx, sy: f.sy, c: f.c, t: 1.2, oy: 0 });
    else if (f.k === "x") audio.EXC = f.v;
    else if (f.k === "end") endGame();
  }
}
export const resetFx = (id: number) => (lastFx = id);
function endGame() {
  const sc = G.sc,
    cl = G.cl;
  ov.style.display = "flex";
  const me = (CT[V.focus] || CT[0]).tm,
    w = sc[me] > sc[1 - me],
    tb = (t: number) =>
      `<table class="bx"><tr><th>${esc(cl[t])}</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th><th>BLK</th></tr>${P.filter((p) => p.tm === t)
        .map(
          (p) =>
            `<tr><td>${esc(p.n)}</td><td>${p.stt.pts}</td><td>${p.stt.reb}</td><td>${p.stt.ast}</td><td>${p.stt.fgm}-${p.stt.fga}</td><td>${p.stt.tpm}-${p.stt.tpa}</td><td>${p.stt.blk}</td></tr>`,
        )
        .join("")}</table>`;
  ov.innerHTML = `<div class="logo" style="font-size:40px">${w ? "YOU WIN!" : "FINAL"}</div><p style="font-size:24px;font-weight:800">${esc(cl[0])} ${sc[0]} — ${sc[1]} ${esc(cl[1])}</p><div class="bxw">${tb(0)}${tb(1)}</div><button class="big" id="pa">${NET.role ? "Back to lobby" : "Play again"}</button>`;
  $("#pa").onclick = () => (NET.role ? NET.backToLobby() : menu());
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
  ACC = 0;
export const STEP = 1 / 60;
function loop(n: number) {
  requestAnimationFrame(loop);
  if (document.hidden) {
    last = n; // paused while hidden: no catch-up burst on return
    return;
  }
  const dt = Math.min(0.1, (n - last) / 1000);
  last = n;
  gpPoll();
  if (NET.role === "guest") NET.guestFrame(dt);
  else if (G.S === "play" || G.RPL) {
    ACC += dt;
    let k = 0;
    while (ACC >= STEP && k < 6) {
      G.upd(STEP);
      if (NET.role === "host") NET.hostTick();
      ACC -= STEP;
      k++;
    }
  } else G.setT(G.T + dt);
  audio.tick(dt);
  drainFx();
  for (const o of TX) {
    o.t -= dt;
    o.oy -= 25 * dt;
  }
  for (let i = TX.length - 1; i >= 0; i--) if (TX[i].t <= 0) TX.splice(i, 1);
  draw();
}

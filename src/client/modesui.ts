// Mode shell: the mode picker on the matchup screen, HUD panels, result screens for Practice / Tutorial / 3-Point
// Contest / Dunk Contest / HORSE / Clutch Challenges, and Season mode (schedule, standings, playoffs; localStorage).
import * as G from "../core/sim";
import { cfg, nChoices, RO } from "../core/sim";
import { M, TUT, CLUTCH, startPractice, start3pt, startDunk, startHorse, startClutch, stopMode, startStreet, startKing, startAllStar, startDaily, dailySpec } from "../core/modes";
import { ov2 } from "../core/data";
import { V } from "./view";
import { FD } from "./hud";

let X: CanvasRenderingContext2D = null as any;
export const setModeCtx = (x: CanvasRenderingContext2D) => (X = x);
type Shell = { ov: HTMLElement; menu: () => void; startLocal: (i: number, o?: { j?: number }) => void; prep: () => void; sel: () => number; opp: () => number; esc: (s: any) => string };
let SH: Shell;
export const bindModes = (s: Shell) => (SH = s);
const $ = (s: string) => document.querySelector(s) as HTMLElement;
export const MODES: [string, string, string][] = [
  ["season", "🏆", "Season"],
  ["daily", "📅", "Daily Challenge"],
  ["clutch", "⏱", "Clutch Challenges"],
  ["allstar", "⭐", "All-Star Game"],
  ["street", "🏙", "Street 1v1 to 21"],
  ["street3", "🧱", "Street 3v3"],
  ["king", "👑", "King of the Court"],
  ["3pt", "🎯", "3-Point Contest"],
  ["dunk", "💥", "Dunk Contest"],
  ["horse", "🐴", "HORSE"],
  ["practice", "🏀", "Practice"],
  ["tutorial", "🎓", "Tutorial"],
];
const lsGet = (k: string, d: any) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "null") ?? d;
  } catch (e) {
    return d;
  }
};
const lsPut = (k: string, v: any) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};
/** One line per mode for the tiles (UI v6) and the accent colour. */
export const MDESC: Record<string, [string, string]> = {
  season: ["Schedule, standings, playoffs", "#c99a1e"],
  daily: ["One scenario a day for everybody", "#2f8fd8"],
  clutch: ["Six late-game scenarios to beat", "#d8452f"],
  allstar: ["Team Gold vs Team Ice", "#e0a526"],
  street: ["Half court, 1s and 2s, first to 21", "#7b3fb5"],
  street3: ["Outdoor 3-on-3, make it take it", "#9c4dcc"],
  king: ["Beat a ladder of challengers to 11", "#b8860b"],
  "3pt": ["Five racks, money balls, 60 seconds", "#1fa35b"],
  dunk: ["Pick your dunk, five judges", "#e8541e"],
  horse: ["Match the CPU's shots, letter by letter", "#8a6d3b"],
  practice: ["Open gym with a shot lab", "#4f6bd8"],
  tutorial: ["Learn the controls step by step", "#0b7a8a"],
};
/** Mode tiles for the matchup screen. */
export const modeStrip = () =>
  `<div class="modes" role="group" aria-label="Game modes">${MODES.map(([k, ic, n]) => `<button type="button" class="mode" data-mode="${k}" style="--c:${(MDESC[k] || ["", "#2a2f6a"])[1]}"><span class="mic" aria-hidden="true">${ic}</span><b>${n}</b><small>${(MDESC[k] || [""])[0]}</small></button>`).join("")}</div>`;
export function bindStrip() {
  SH.ov.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => (b.onclick = () => openMode(b.dataset.mode!)));
}
export function openMode(k: string) {
  if (k === "season") return seasonScreen();
  if (k === "clutch") return clutchScreen();
  go(k);
}
let lastKind = "",
  lastArg = 0;
function go(k: string, arg = 0) {
  lastKind = k;
  lastArg = arg;
  SH.prep();
  const s = SH.sel(),
    o = SH.opp();
  if (k === "practice") startPractice(s);
  else if (k === "tutorial") startPractice(s, true);
  else if (k === "3pt") start3pt(s);
  else if (k === "dunk") startDunk(s);
  else if (k === "horse") startHorse(s, o >= 0 ? o : undefined);
  else if (k === "clutch") startClutch(arg, s, o >= 0 ? o : undefined);
  else if (k === "street") startStreet(s, o, 1);
  else if (k === "street3") startStreet(s, o, 3);
  else if (k === "king") startKing(s, arg);
  else if (k === "allstar") startAllStar();
  else if (k === "daily") startDaily();
  SH.ov.style.display = "none";
  SH.ov.classList.remove("mu-on");
}
export const replayMode = () => lastKind && go(lastKind, lastArg);
// ---------------- HUD ----------------
function panel(x: number, y: number, w: number, h: number) {
  X.beginPath();
  X.roundRect(x, y, w, h, 8);
  X.fillStyle = V.HC ? "#000" : "rgba(8,10,22,.86)";
  X.fill();
  if (V.HC) ((X.strokeStyle = "#fff"), (X.lineWidth = 1.5), X.stroke());
  X.fillStyle = "#ffc83d";
  X.fillRect(x + 8, y, w - 16, 3);
}
export function modeHud() {
  const k = M.kind;
  if (!k || k === "clutch") return;
  X.textAlign = "center";
  if (k === "practice" || k === "tutorial") {
    const s = M.st;
    panel(300, 6, 360, k === "tutorial" ? 64 : 44);
    X.fillStyle = "#fff";
    X.font = FD(700, 16);
    X.fillText(`${k === "tutorial" ? "TUTORIAL" : "PRACTICE"} · ${s.made}/${s.att}${s.att ? " (" + Math.round((100 * s.made) / s.att) + "%)" : ""} · GREENS ${s.gr} · STREAK ${s.streak} (BEST ${s.best})`, 480, 30);
    X.font = "600 11px system-ui";
    X.fillStyle = "#9fe7ff";
    if (k === "tutorial") {
      const st = TUT[M.step];
      X.font = "700 13px system-ui";
      X.fillText(st ? `${M.step + 1}/${TUT.length}: ${st[0]}` : "Tutorial complete!", 480, 52);
      for (let i = 0; i < TUT.length; i++) {
        X.fillStyle = i < M.step ? "#2ecc71" : i === M.step ? "#ffd23f" : "rgba(255,255,255,.25)";
        X.fillRect(480 - TUT.length * 9 + i * 18, 60, 12, 4);
      }
    } else {
      X.fillText("Esc: pause / quit · shot lab below", 480, 44);
      // shot lab: a mini half court with your % and average timing error per zone
      const zx = [0, -1, 1, -1, 0, 1],
        zy = [1, 0.4, 0.4, -0.2, -0.6, -0.2],
        ZL = ["PAINT", "L ELBOW", "R ELBOW", "L WING", "TOP", "R WING"],
        cx = 878,
        cy = 300;
      X.fillStyle = "rgba(8,10,24,.8)";
      X.fillRect(cx - 74, cy - 92, 148, 168);
      X.strokeStyle = "rgba(255,255,255,.3)";
      X.beginPath();
      X.arc(cx, cy + 60, 100, Math.PI * 1.15, Math.PI * 1.85);
      X.stroke();
      X.font = "800 9px system-ui";
      for (let z = 0; z < 6; z++) {
        const d = s.z[z],
          x = cx + zx[z] * 46,
          y = cy + zy[z] * -60 + 20,
          pc = d && d.a ? d.m / d.a : -1;
        X.fillStyle = pc < 0 ? "rgba(255,255,255,.12)" : pc >= 0.6 ? "rgba(46,204,113,.85)" : pc >= 0.35 ? "rgba(255,210,63,.85)" : "rgba(255,107,74,.85)";
        X.beginPath();
        X.arc(x, y, 19, 0, 6.3);
        X.fill();
        X.fillStyle = "#fff";
        X.fillText(pc < 0 ? ZL[z] : Math.round(pc * 100) + "%", x, y - 1);
        if (d && d.a) X.fillText(Math.round(d.off / d.a) + "ms", x, y + 10);
      }
      X.fillStyle = "#9fe7ff";
      X.fillText("SHOT LAB · % and timing", cx, cy - 78);
    }
  } else if (k === "3pt") {
    panel(290, 6, 380, 74);
    X.fillStyle = M.time < 10 ? "#ff6b4a" : "#fff";
    X.font = FD(700, 28);
    X.fillText(M.time.toFixed(1), 380, 40);
    X.fillStyle = "#ffd23f";
    X.fillText(String(M.pts), 590, 40);
    X.font = "700 10px system-ui";
    X.fillStyle = "#cfd6ee";
    X.fillText("TIME", 380, 56);
    X.fillText("POINTS", 590, 56);
    for (let r = 0; r < 5; r++)
      for (let b = 0; b < 5; b++) {
        const i = r * 5 + b,
          v = M.shots[i],
          x = 420 + r * 26 + b * 4.5,
          y = 66;
        X.beginPath();
        X.arc(x, y, 2.2, 0, 6.3);
        X.fillStyle = v == null ? (r === M.rack ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.25)") : v ? (b === 4 ? "#ffd23f" : "#2ecc71") : "#ff6b4a";
        X.fill();
      }
  } else if (k === "dunk") {
    panel(300, 6, 360, 56);
    X.fillStyle = "#fff";
    X.font = FD(700, 17);
    X.fillText(`DUNK ${Math.min(3, M.dunk + 1)} OF 3 · TRY ${M.tries + 1}/2`, 480, 30);
    X.font = "700 12px system-ui";
    X.fillStyle = "#ffd23f";
    X.fillText(M.scores.length ? "SCORES " + M.scores.join(" + ") + " = " + M.scores.reduce((a: number, b: number) => a + b, 0) : "C tomahawk · X 360 · V windmill · G reverse", 480, 50);
  } else if (k === "horse") {
    panel(300, 6, 360, 56);
    X.font = FD(700, 22);
    for (let t = 0; t < 2; t++) {
      const x = t ? 600 : 360;
      X.fillStyle = "#cfd6ee";
      X.font = "700 11px system-ui";
      X.fillText(M.pl[t].n.toUpperCase() + (t ? " (CPU)" : " (YOU)"), x, 24);
      X.font = FD(700, 22);
      X.fillText(
        "HORSE".split("").map((c, i) => (i < M.let[t] ? c : "·")).join(" "),
        x,
        50,
      );
    }
  }
}
// ---------------- results ----------------
export function modeEvent(f: any) {
  if (f.ev !== "end") return;
  const k = f.kind,
    r = f.res,
    E = SH.esc;
  let h = "",
    body = "",
    good = true;
  if (k === "tutorial") {
    h = "TUTORIAL COMPLETE";
    body = `<p class="hint">You've got the basics: movement, sprinting, the green window, fakes, step-backs, dribble moves, finishing and the post. Defense: hold SPACE to contest, Z cycles your defensive scheme, Y calls timeout, H challenges a call.</p>`;
  } else if (k === "3pt") {
    const all = [{ n: "YOU", s: r.pts, me: 1 }, ...r.field].sort((a: any, b: any) => b.s - a.s);
    good = all[0].me === 1;
    h = good ? "3-POINT CHAMPION" : "3-POINT CONTEST";
    body = `<div class="sc"><b>${r.pts}</b><i>points</i></div><p class="hint">Racks: ${r.racks.join(" · ")}</p><table class="bx">${all.map((a: any, i: number) => `<tr class="${a.me ? "me" : ""}"><td>${i + 1}. ${E(a.n)}</td><td>${a.s}</td></tr>`).join("")}</table>`;
    const b = lsGet("h2k_3pt", 0);
    if (r.pts > b) lsPut("h2k_3pt", r.pts);
    body += `<p class="hint">Personal best: ${Math.max(b, r.pts)}</p>`;
  } else if (k === "dunk") {
    const all = [{ n: "YOU", s: r.total, me: 1 }, ...r.field].sort((a: any, b: any) => b.s - a.s);
    good = all[0].me === 1;
    h = good ? "DUNK CHAMPION" : "DUNK CONTEST";
    body = `<div class="sc"><b>${r.total}</b><i>${r.scores.join(" + ")}</i></div><table class="bx">${all.map((a: any, i: number) => `<tr class="${a.me ? "me" : ""}"><td>${i + 1}. ${E(a.n)}</td><td>${a.s}</td></tr>`).join("")}</table>`;
  } else if (k === "horse") {
    good = r.win;
    h = r.win ? "YOU WIN H-O-R-S-E" : "H-O-R-S-E";
    body = `<p class="hint">${E(r.names[0])}: ${"HORSE".slice(0, r.letters[0]) || "—"} · ${E(r.names[1])}: ${"HORSE".slice(0, r.letters[1]) || "—"}</p>`;
  } else if (k === "street" || k === "allstar") {
    good = r.win;
    h = r.win ? (k === "street" ? "YOU RUN THE COURT" : "ALL-STAR WIN") : k === "street" ? "SENT HOME" : "ALL-STAR LOSS";
    body = `<div class="sc"><span>${E(r.teams[0])}</span><b>${r.sc[0]}</b><i>—</i><b>${r.sc[1]}</b><span>${E(r.teams[1])}</span></div>`;
  } else if (k === "king") {
    good = r.win;
    const best = Math.max(lsGet("h2k_king", 0), r.rung);
    lsPut("h2k_king", best);
    if (r.win && r.rung < r.total) {
      h = "NEXT CHALLENGER";
      lastArg = r.rung;
      body = `<p class="hint">You beat ${E(r.opp)}. ${r.rung} down, ${r.total - r.rung} to go. Best run: ${best}.</p>`;
    } else {
      h = r.win ? "KING OF THE COURT" : "DETHRONED";
      lastArg = 0;
      body = `<p class="hint">${r.win ? "You beat every challenger!" : `${E(r.opp)} sends you off after ${r.rung} win${r.rung === 1 ? "" : "s"}.`} Best run: ${best} of ${r.total}.</p>`;
    }
  } else if (k === "daily") {
    good = r.win;
    const s = r.daily || dailySpec(),
      lb = lsGet("h2k_daily", {}),
      d = (lb[s.seed] = lb[s.seed] || { tries: 0, best: null, wins: 0 });
    d.tries++;
    if (r.win) d.wins++;
    if (d.best == null || r.margin > d.best) d.best = r.margin;
    lsPut("h2k_daily", lb);
    const days = Object.keys(lb).sort().reverse().slice(0, 7);
    h = r.win ? "DAILY CHALLENGE BEATEN" : "DAILY CHALLENGE FAILED";
    body = `<p class="hint">${E(s.c.n)} — ${E(s.c.d)}</p><div class="sc"><span>YOU</span><b>${G.sc[0]}</b><i>—</i><b>${G.sc[1]}</b><span>CPU</span></div>
     <table class="bx"><tr><th>DAY</th><th>TRIES</th><th>WINS</th><th>BEST MARGIN</th></tr>${days
       .map((k2) => `<tr class="${+k2 === s.seed ? "me" : ""}"><td>${String(k2).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</td><td>${lb[k2].tries}</td><td>${lb[k2].wins}</td><td>${lb[k2].best > 0 ? "+" : ""}${lb[k2].best}</td></tr>`)
       .join("")}</table><p class="hint">A new scenario every day — same one for everybody.</p>`;
  } else if (k === "clutch") {
    good = r.win;
    const c = CLUTCH[r.ci],
      st = lsGet("h2k_cc", {});
    if (r.win) st[r.ci] = 1;
    lsPut("h2k_cc", st);
    h = r.win ? "CHALLENGE COMPLETE" : "CHALLENGE FAILED";
    body = `<p class="hint">${E(c.n)} — ${E(c.d)}</p><div class="sc"><span>YOU</span><b>${G.sc[0]}</b><i>—</i><b>${G.sc[1]}</b><span>CPU</span></div><p class="hint">${Object.keys(st).length}/${CLUTCH.length} challenges beaten</p>`;
  } else return;
  setTimeout(() => {
    G.setS("menu");
    const ov = SH.ov;
    ov.style.display = "flex";
    ov.classList.remove("mu-on");
    ov.innerHTML = `<div class="scr fin res ${good ? "won" : "lost"}"><header class="fhead"><span class="eyebrow">${E(MODES.find((m) => m[0] === k)?.[2] || "Result")}</span><div class="logo disp">${h}</div></header><section class="panel resb">${body}</section>
     <div class="row actions"><button type="button" class="btn pri lg" id="mag">${k === "king" && good && lastArg ? "Next challenger ▶" : "↻ Again"}</button>${k === "clutch" ? `<button type="button" class="btn" id="mcl">More challenges</button>` : ""}<button type="button" class="btn" id="mme">Menu</button></div></div>`;
    $("#mag").onclick = () => go(lastKind, lastArg);
    $("#mme").onclick = () => SH.menu();
    const mc = document.getElementById("mcl");
    if (mc) mc.onclick = clutchScreen;
    ($("#mag") as HTMLElement).focus();
  }, k === "dunk" ? 400 : 1200);
}
// ---------------- clutch challenge list ----------------
function clutchScreen() {
  stopMode();
  G.setS("menu");
  const st = lsGet("h2k_cc", {}),
    ov = SH.ov;
  ov.style.display = "flex";
  ov.classList.remove("mu-on");
  ov.innerHTML = `<div class="scr fin"><header class="fhead"><span class="eyebrow">${Object.keys(st).length}/${CLUTCH.length} beaten</span><div class="logo disp">Clutch challenges</div><p class="hint">Your team vs your chosen opponent (or a random one). Beat the scenario.</p></header>
  <div class="cc">${CLUTCH.map((c, i) => `<button type="button" data-cc="${i}" class="${st[i] ? "done" : ""}"><span class="ccs" aria-label="${st[i] ? "beaten" : "not beaten"}">${st[i] ? "★" : "☆"}</span><b>${SH.esc(c.n)}</b><small>${SH.esc(c.d)}</small></button>`).join("")}</div>
  <div class="row actions"><button type="button" class="btn" id="mme">◀ Back</button></div></div>`;
  ov.querySelectorAll<HTMLElement>("[data-cc]").forEach((b) => (b.onclick = () => go("clutch", +b.dataset.cc!)));
  $("#mme").onclick = () => SH.menu();
  (ov.querySelector("[data-cc]") as HTMLElement)?.focus({ preventScroll: true });
}
// ---------------- Season ----------------
// Schedule (everyone once), standings with points for / against and streaks, league leaders (your games' real box
// scores + generated lines for the simulated games), playoffs (top 4, best-of-3 semifinals and final), awards.
type PS = { n: string; t: number; gp: number; pts: number; reb: number; ast: number; blk: number };
type Season = {
  np: number;
  team: number;
  teams: number[];
  w: number[];
  l: number[];
  sched: { opp: number; my?: number; op?: number }[];
  round: number;
  po?: any;
  champ?: number;
  pf?: number[];
  pa?: number[];
  stk?: number[]; // + win streak / - losing streak per team
  ps?: Record<string, PS>; // player season totals, key "team:name"
  aw?: string[]; // awards (at the end)
};
const SKEY = () => "h2k_season_" + cfg.NP;
const tName = (i: number) => RO(i)[2];
const tOvr = (i: number) => {
  const pl = RO(i)[1];
  return pl.reduce((a, p) => a + ov2(p), 0) / pl.length;
};
/** Old saves: fill in the v5.4 fields. */
function fixSeason(S: Season) {
  const z = () => S.teams.map(() => 0);
  S.pf = S.pf || z();
  S.pa = S.pa || z();
  S.stk = S.stk || z();
  S.ps = S.ps || {};
  return S;
}
function newSeason(): Season {
  const N = nChoices(),
    me = SH.sel();
  let teams = [...Array(N).keys()];
  if (N > 8) teams = [me, ...teams.filter((t) => t !== me).sort(() => Math.random() - 0.5).slice(0, 7)];
  const opps = teams.filter((t) => t !== me);
  return fixSeason({ np: cfg.NP, team: me, teams, w: teams.map(() => 0), l: teams.map(() => 0), sched: opps.map((o) => ({ opp: o })), round: 0 });
}
/** Points scale of a simulated game: the same length as the games you play (quarter length). */
const ptsK = () => Math.min(1.1, Math.max(0.15, (G.QTRLEN / 180) * 0.52));
/** Record a result in the standings (scores, streaks). */
function result(S: Season, a: number, b: number, pa: number, pb: number) {
  const ia = S.teams.indexOf(a),
    ib = S.teams.indexOf(b),
    wa = pa > pb;
  if (ia < 0 || ib < 0) return;
  (wa ? S.w : S.l)[ia]++;
  (wa ? S.l : S.w)[ib]++;
  S.pf![ia] += pa;
  S.pa![ia] += pb;
  S.pf![ib] += pb;
  S.pa![ib] += pa;
  S.stk![ia] = wa ? Math.max(1, S.stk![ia] + 1) : Math.min(-1, S.stk![ia] - 1);
  S.stk![ib] = wa ? Math.min(-1, S.stk![ib] - 1) : Math.max(1, S.stk![ib] + 1);
}
/** Generated box score for a simulated game: the team's points shared by rating, boards by size, assists by quickness. */
function simLines(S: Season, t: number, pts: number) {
  const pl = RO(t)[1],
    w = (f: (p: any) => number) => {
      const v = pl.map((p) => Math.max(0.05, f(p)) * (0.7 + Math.random() * 0.6)),
        s = v.reduce((a, b) => a + b, 0) || 1;
      return v.map((x) => x / s);
    },
    wp = w((p) => Math.pow(Math.max(1, ov2(p) - 62), 1.6)),
    wr = w((p) => (p[10] - 5.8) * (p[2] / 80) + (p[4] / 400)),
    wa = w((p) => Math.pow(p[3] / 80, 3) * (p[10] < 6.6 ? 1.5 : 0.7)),
    reb = Math.round(pts * 0.42),
    ast = Math.round(pts * 0.24);
  pl.forEach((p, k) => addLine(S, t, p[0], { pts: Math.round(pts * wp[k]), reb: Math.round(reb * wr[k]), ast: Math.round(ast * wa[k]), blk: Math.random() < (p[10] - 6.4) * 0.5 ? 1 : 0 }));
}
function addLine(S: Season, t: number, n: string, s: any) {
  const k = t + ":" + n,
    o = (S.ps![k] = S.ps![k] || { n, t, gp: 0, pts: 0, reb: 0, ast: 0, blk: 0 });
  o.gp++;
  o.pts += s.pts || 0;
  o.reb += s.reb || 0;
  o.ast += s.ast || 0;
  o.blk += s.blk || 0;
}
/** A simulated game: the better team usually wins (logistic on the rating gap); the score scales with quarter length. */
function simGame(S: Season, a: number, b: number) {
  const pa = 1 / (1 + Math.exp(-(tOvr(a) - tOvr(b)) / 3)),
    aw = Math.random() < pa,
    base = (100 + Math.random() * 22) * ptsK(),
    mg = Math.max(1, Math.round((2 + Math.random() * 14) * ptsK() * 1.6)),
    hi = Math.round(base + mg / 2),
    lo = Math.min(hi - 1, Math.round(base - mg / 2)),
    sa = aw ? hi : lo,
    sb = aw ? lo : hi;
  result(S, a, b, sa, sb);
  simLines(S, a, sa);
  simLines(S, b, sb);
  return aw;
}
/** Best-of-3 series between two other teams (playoffs you are not in). */
function simSeries(S: Season, a: number, b: number) {
  let wa = 0,
    wb = 0;
  while (wa < 2 && wb < 2) simGame(S, a, b) ? wa++ : wb++;
  return { w: wa > wb ? a : b, s: Math.max(wa, wb) + "-" + Math.min(wa, wb) };
}
function standings(S: Season) {
  return S.teams.map((t, i) => ({ t, w: S.w[i], l: S.l[i], pf: S.pf![i], pa: S.pa![i], st: S.stk![i] })).sort((a, b) => b.w - a.w || a.l - b.l || b.pf - b.pa - (a.pf - a.pa) || tOvr(b.t) - tOvr(a.t));
}
/** League leaders (per game; at least half of the most games played). */
function leaders(S: Season, k: "pts" | "reb" | "ast", n = 5) {
  const all = Object.values(S.ps!),
    mx = all.reduce((a, o) => Math.max(a, o.gp), 0),
    min = Math.max(1, Math.floor(mx / 2));
  return all
    .filter((o) => o.gp >= min)
    .sort((a, b) => b[k] / b.gp - a[k] / a.gp)
    .slice(0, n);
}
/** End-of-season awards: MVP (production on a winning team), the scoring title, the champion. */
function awards(S: Season) {
  const all = Object.values(S.ps!).filter((o) => o.gp >= 2),
    wp = (t: number) => {
      const i = S.teams.indexOf(t);
      return i < 0 ? 0.5 : S.w[i] / Math.max(1, S.w[i] + S.l[i]);
    },
    val = (o: PS) => ((o.pts + 0.6 * o.reb + 0.8 * o.ast + o.blk) / o.gp) * (0.6 + wp(o.t)),
    mvp = all.slice().sort((a, b) => val(b) - val(a))[0],
    sco = all.slice().sort((a, b) => b.pts / b.gp - a.pts / a.gp)[0],
    out: string[] = [];
  if (S.champ != null) out.push("🏆 Champions: " + tName(S.champ));
  if (mvp) out.push(`MVP: ${mvp.n} (${tName(mvp.t)}) · ${(mvp.pts / mvp.gp).toFixed(1)} PPG · ${(mvp.reb / mvp.gp).toFixed(1)} RPG · ${(mvp.ast / mvp.gp).toFixed(1)} APG`);
  if (sco) out.push(`Scoring title: ${sco.n} (${tName(sco.t)}) · ${(sco.pts / sco.gp).toFixed(1)} PPG`);
  return out;
}
export function seasonScreen() {
  stopMode();
  G.setS("menu");
  let S: Season = lsGet(SKEY(), null);
  if (!S || S.np !== cfg.NP) S = newSeason();
  fixSeason(S);
  lsPut(SKEY(), S);
  const ov = SH.ov,
    E = SH.esc,
    st = standings(S),
    reg = S.round < S.sched.length,
    po = S.po;
  let next = "";
  if (S.champ != null) next = `<p class="big-n disp">${S.champ === S.team ? "🏆 Champions!" : "Season over — " + E(tName(S.champ)) + " won the title."}</p>`;
  else if (reg) next = `<p class="hint">Game ${S.round + 1} of ${S.sched.length}: vs <b>${E(tName(S.sched[S.round].opp))}</b></p>`;
  else if (po) next = `<p class="hint">${po.stage === 0 ? "Semifinal" : "Final"} (best of 3, ${po.sw || 0}-${po.sl || 0}): vs <b>${E(tName(po.opp))}</b></p>`;
  const ld = (k: "pts" | "reb" | "ast", h: string) =>
    `<table class="bx"><tr><th>${h}</th><th></th></tr>${leaders(S, k)
      .map((o) => `<tr class="${o.t === S.team ? "me" : ""}"><td>${E(o.n)} <small>${E(tName(o.t))}</small></td><td>${(o[k] / o.gp).toFixed(1)}</td></tr>`)
      .join("")}</table>`;
  ov.style.display = "flex";
  ov.classList.remove("mu-on");
  ov.innerHTML = `<div class="scr fin season wide"><header class="fhead"><span class="eyebrow">${E(tName(S.team))} · ${S.sched.length}-game schedule · top 4 make the playoffs (best of 3)</span><div class="logo disp">Season</div>${next}</header>
   ${S.aw && S.aw.length ? `<section class="panel awards">${S.aw.map((a) => `<span>${E(a)}</span>`).join("")}</section>` : ""}
   <div class="sg"><table class="bx"><tr><th>#</th><th>TEAM</th><th>W</th><th>L</th><th title="points per game for / against">PF</th><th>PA</th><th>STRK</th></tr>${st
     .map((r) => {
       const g = Math.max(1, r.w + r.l);
       return `<tr class="${r.t === S.team ? "me" : ""}${st.indexOf(r) === 3 ? " cut" : ""}"><td>${st.indexOf(r) + 1}</td><td>${E(tName(r.t))}</td><td>${r.w}</td><td>${r.l}</td><td>${(r.pf / g).toFixed(1)}</td><td>${(r.pa / g).toFixed(1)}</td><td>${r.st > 0 ? "W" + r.st : r.st < 0 ? "L" + -r.st : "—"}</td></tr>`;
     })
     .join("")}</table>
   <table class="bx"><tr><th>SCHEDULE</th><th>RESULT</th></tr>${S.sched
     .map((g) => `<tr><td>vs ${E(tName(g.opp))}</td><td>${g.my == null ? "—" : (g.my > g.op! ? "W " : "L ") + g.my + "-" + g.op}</td></tr>`)
     .join("")}${po && po.res ? po.res.map((r: string) => `<tr><td colspan="2">${E(r)}</td></tr>`).join("") : ""}</table></div>
   ${Object.keys(S.ps!).length ? `<h2 class="eyebrow">League leaders</h2><div class="sg">${ld("pts", "POINTS")}${ld("reb", "REBOUNDS")}${ld("ast", "ASSISTS")}</div>` : ""}
   <div class="row actions">${S.champ == null ? `<button type="button" class="btn pri lg" id="snx">▶ Play next game</button>` : ""}<button type="button" class="btn" id="srs">New season</button><button type="button" class="btn" id="mme">Menu</button></div></div>`;
  const nx = document.getElementById("snx");
  if (nx)
    nx.onclick = () => {
      const opp = reg ? S.sched[S.round].opp : S.po.opp;
      SEASON.on = 1;
      SH.startLocal(S.team, { j: opp });
    };
  $("#srs").onclick = () => {
    lsPut(SKEY(), newSeason());
    seasonScreen();
  };
  $("#mme").onclick = () => SH.menu();
  (nx || $("#mme")).focus({ preventScroll: true });
}
export const SEASON = { on: 0 };
/** Called by the shell when a game ends: records the result and both box scores, sims the rest of the league,
 *  advances the playoffs (best-of-3 series). */
export function seasonResult(won: boolean) {
  if (!SEASON.on) return false;
  SEASON.on = 0;
  const S: Season = lsGet(SKEY(), null);
  if (!S) return false;
  fixSeason(S);
  const my = G.sc[0],
    op = G.sc[1],
    opp = S.round < S.sched.length ? S.sched[S.round].opp : S.po ? S.po.opp : -1;
  // your game: the real box scores
  for (let t = 0; t < 2; t++) for (const p of G.ROST[t] || []) if (p.stt.min > 0 || p.stt.pts || p.stt.reb) addLine(S, t ? opp : S.team, p.n, p.stt);
  if (S.round < S.sched.length) {
    const g = S.sched[S.round];
    g.my = my;
    g.op = op;
    result(S, S.team, g.opp, won ? Math.max(my, op + 1) : my, won ? op : Math.max(op, my + 1));
    // the rest of the league plays this round too
    const rest = S.teams.filter((t) => t !== S.team && t !== g.opp).sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < rest.length; i += 2) simGame(S, rest[i], rest[i + 1]);
    S.round++;
    if (S.round >= S.sched.length) {
      const st = standings(S),
        seed = st.findIndex((r) => r.t === S.team);
      if (seed < 4) S.po = { stage: 0, opp: st[3 - seed].t, sw: 0, sl: 0, res: [`Playoffs: #${seed + 1} seed vs #${4 - seed} ${tName(st[3 - seed].t)}`], seeds: st.slice(0, 4).map((r) => r.t) };
      else {
        // missed the playoffs: the top 4 play it out
        const s4 = st.slice(0, 4).map((r) => r.t),
          a = simSeries(S, s4[0], s4[3]),
          b = simSeries(S, s4[1], s4[2]),
          f = simSeries(S, a.w, b.w);
        S.champ = f.w;
        S.po = { res: [`Missed the playoffs (#${seed + 1}).`, `Semifinals: ${tName(a.w)} ${a.s}, ${tName(b.w)} ${b.s}`, `Final: ${tName(f.w)} wins ${f.s}`] };
        S.aw = awards(S);
      }
    }
  } else if (S.po) {
    const p = S.po;
    result(S, S.team, p.opp, won ? Math.max(my, op + 1) : my, won ? op : Math.max(op, my + 1));
    p.sw = (p.sw || 0) + (won ? 1 : 0);
    p.sl = (p.sl || 0) + (won ? 0 : 1);
    p.res.push(`${p.stage === 0 ? "Semifinal" : "Final"} game ${p.sw + p.sl} vs ${tName(p.opp)}: ${won ? "W" : "L"} ${my}-${op} (series ${p.sw}-${p.sl})`);
    if (p.sl >= 2) {
      // eliminated: the bracket plays out without you
      if (p.stage === 0) {
        const o = p.seeds.filter((t: number) => t !== S.team && t !== p.opp),
          a = simSeries(S, o[0], o[1]),
          f = simSeries(S, p.opp, a.w);
        p.res.push(`Final: ${tName(f.w)} wins ${f.s}`);
        S.champ = f.w;
      } else S.champ = p.opp;
      S.aw = awards(S);
    } else if (p.sw >= 2) {
      if (p.stage === 0) {
        const o = p.seeds.filter((t: number) => t !== S.team && t !== p.opp),
          a = simSeries(S, o[0], o[1]);
        p.res.push(`Other semifinal: ${tName(a.w)} wins ${a.s}`);
        p.stage = 1;
        p.opp = a.w;
        p.sw = p.sl = 0;
      } else {
        S.champ = S.team;
        S.aw = awards(S);
      }
    }
  }
  lsPut(SKEY(), S);
  return true;
}

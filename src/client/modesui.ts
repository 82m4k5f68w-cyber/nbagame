// Mode shell: the mode picker on the matchup screen, HUD panels, result screens for Practice / Tutorial / 3-Point
// Contest / Dunk Contest / HORSE / Clutch Challenges, and Season mode (schedule, standings, playoffs; localStorage).
import * as G from "../core/sim";
import { cfg, nChoices, RO } from "../core/sim";
import { M, TUT, CLUTCH, startPractice, start3pt, startDunk, startHorse, startClutch, stopMode, startStreet, startKing, startAllStar, startDaily, dailySpec } from "../core/modes";
import { ov2 } from "../core/data";

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
/** Mode picker strip for the matchup screen. */
export const modeStrip = () => `<div class="modes" role="group" aria-label="Game modes">${MODES.map(([k, ic, n]) => `<button data-mode="${k}"><span>${ic}</span>${n}</button>`).join("")}</div>`;
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
  X.fillStyle = "rgba(8,10,24,.86)";
  X.fillRect(x, y, w, h);
  X.fillStyle = "#ffd23f";
  X.fillRect(x, y, w, 3);
}
export function modeHud() {
  const k = M.kind;
  if (!k || k === "clutch") return;
  X.textAlign = "center";
  if (k === "practice" || k === "tutorial") {
    const s = M.st;
    panel(300, 6, 360, k === "tutorial" ? 64 : 44);
    X.fillStyle = "#fff";
    X.font = "800 15px system-ui";
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
    X.font = "900 26px system-ui";
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
    X.font = "800 16px system-ui";
    X.fillText(`DUNK ${Math.min(3, M.dunk + 1)} OF 3 · TRY ${M.tries + 1}/2`, 480, 30);
    X.font = "700 12px system-ui";
    X.fillStyle = "#ffd23f";
    X.fillText(M.scores.length ? "SCORES " + M.scores.join(" + ") + " = " + M.scores.reduce((a: number, b: number) => a + b, 0) : "C tomahawk · X 360 · V windmill · G reverse", 480, 50);
  } else if (k === "horse") {
    panel(300, 6, 360, 56);
    X.font = "900 22px system-ui";
    for (let t = 0; t < 2; t++) {
      const x = t ? 600 : 360;
      X.fillStyle = "#cfd6ee";
      X.font = "700 11px system-ui";
      X.fillText(M.pl[t].n.toUpperCase() + (t ? " (CPU)" : " (YOU)"), x, 24);
      X.font = "900 22px system-ui";
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
    body = `<div class="sc"><b>${r.pts}</b><i>points</i></div><p class="hint">Racks: ${r.racks.join(" · ")}</p><table class="bx">${all.map((a: any, i: number) => `<tr${a.me ? ' style="color:#ffd23f"' : ""}><td>${i + 1}. ${E(a.n)}</td><td>${a.s}</td></tr>`).join("")}</table>`;
    const b = lsGet("h2k_3pt", 0);
    if (r.pts > b) lsPut("h2k_3pt", r.pts);
    body += `<p class="hint">Personal best: ${Math.max(b, r.pts)}</p>`;
  } else if (k === "dunk") {
    const all = [{ n: "YOU", s: r.total, me: 1 }, ...r.field].sort((a: any, b: any) => b.s - a.s);
    good = all[0].me === 1;
    h = good ? "DUNK CHAMPION" : "DUNK CONTEST";
    body = `<div class="sc"><b>${r.total}</b><i>${r.scores.join(" + ")}</i></div><table class="bx">${all.map((a: any, i: number) => `<tr${a.me ? ' style="color:#ffd23f"' : ""}><td>${i + 1}. ${E(a.n)}</td><td>${a.s}</td></tr>`).join("")}</table>`;
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
       .map((k2) => `<tr${+k2 === s.seed ? ' style="color:#ffd23f"' : ""}><td>${String(k2).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}</td><td>${lb[k2].tries}</td><td>${lb[k2].wins}</td><td>${lb[k2].best > 0 ? "+" : ""}${lb[k2].best}</td></tr>`)
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
    ov.innerHTML = `<div class="fin"><div class="logo" style="font-size:38px;animation:none;color:${good ? "#ffd23f" : "#ff8a6b"}">${h}</div>${body}
     <div class="row"><button class="big" id="mag">${k === "king" && good && lastArg ? "NEXT CHALLENGER ▶" : "↻ AGAIN"}</button>${k === "clutch" ? `<button class="ghost" id="mcl">More challenges</button>` : ""}<button class="ghost" id="mme">Menu</button></div></div>`;
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
  ov.innerHTML = `<div class="fin"><div class="logo" style="font-size:36px;animation:none">CLUTCH CHALLENGES</div><p class="hint">Your team vs your chosen opponent (or a random one). Beat the scenario.</p>
  <div class="cc">${CLUTCH.map((c, i) => `<button data-cc="${i}"><b>${st[i] ? "★" : "☆"} ${SH.esc(c.n)}</b><small>${SH.esc(c.d)}</small></button>`).join("")}</div>
  <div class="row"><button class="ghost" id="mme">Back</button></div></div>`;
  ov.querySelectorAll<HTMLElement>("[data-cc]").forEach((b) => (b.onclick = () => go("clutch", +b.dataset.cc!)));
  $("#mme").onclick = () => SH.menu();
}
// ---------------- Season ----------------
type Season = { np: number; team: number; teams: number[]; w: number[]; l: number[]; sched: { opp: number; my?: number; op?: number }[]; round: number; po?: any; champ?: number };
const SKEY = () => "h2k_season_" + cfg.NP;
const tName = (i: number) => RO(i)[2];
const tOvr = (i: number) => {
  const pl = RO(i)[1];
  return pl.reduce((a, p) => a + ov2(p), 0) / pl.length;
};
function newSeason(): Season {
  const N = nChoices(),
    me = SH.sel();
  let teams = [...Array(N).keys()];
  if (N > 8) teams = [me, ...teams.filter((t) => t !== me).sort(() => Math.random() - 0.5).slice(0, 7)];
  const opps = teams.filter((t) => t !== me);
  return { np: cfg.NP, team: me, teams, w: teams.map(() => 0), l: teams.map(() => 0), sched: opps.map((o) => ({ opp: o })), round: 0 };
}
function simGame(S: Season, a: number, b: number) {
  const pa = 1 / (1 + Math.exp(-(tOvr(a) - tOvr(b)) / 3)),
    ia = S.teams.indexOf(a),
    ib = S.teams.indexOf(b);
  if (Math.random() < pa) (S.w[ia]++, S.l[ib]++);
  else (S.w[ib]++, S.l[ia]++);
}
function standings(S: Season) {
  return S.teams.map((t, i) => ({ t, w: S.w[i], l: S.l[i] })).sort((a, b) => b.w - a.w || a.l - b.l || tOvr(b.t) - tOvr(a.t));
}
export function seasonScreen() {
  stopMode();
  G.setS("menu");
  let S: Season = lsGet(SKEY(), null);
  if (!S || S.np !== cfg.NP) S = newSeason();
  lsPut(SKEY(), S);
  const ov = SH.ov,
    E = SH.esc,
    st = standings(S),
    reg = S.round < S.sched.length,
    po = S.po;
  let next = "";
  if (S.champ != null) next = `<p class="big-n">${S.champ === S.team ? "🏆 CHAMPIONS!" : "Season over — " + E(tName(S.champ)) + " won the title."}</p>`;
  else if (reg) next = `<p class="hint">Game ${S.round + 1} of ${S.sched.length}: vs <b>${E(tName(S.sched[S.round].opp))}</b></p>`;
  else if (po) next = `<p class="hint">${po.stage === 0 ? "Semifinal" : "Final"}: vs <b>${E(tName(po.opp))}</b></p>`;
  ov.style.display = "flex";
  ov.classList.remove("mu-on");
  ov.innerHTML = `<div class="fin season"><div class="logo" style="font-size:36px;animation:none">SEASON</div>
   <p class="hint">${E(tName(S.team))} · ${S.sched.length}-game schedule, then the top 4 make the playoffs</p>${next}
   <div class="sg"><table class="bx"><tr><th>#</th><th>TEAM</th><th>W</th><th>L</th></tr>${st
     .map((r, i) => `<tr${r.t === S.team ? ' style="color:#ffd23f"' : ""}><td>${i + 1}${i === 3 ? " ·" : ""}</td><td>${E(tName(r.t))}</td><td>${r.w}</td><td>${r.l}</td></tr>`)
     .join("")}</table>
   <table class="bx"><tr><th>SCHEDULE</th><th>RESULT</th></tr>${S.sched
     .map((g) => `<tr><td>vs ${E(tName(g.opp))}</td><td>${g.my == null ? "—" : (g.my > g.op! ? "W " : "L ") + g.my + "-" + g.op}</td></tr>`)
     .join("")}${po && po.res ? po.res.map((r: string) => `<tr><td colspan="2">${E(r)}</td></tr>`).join("") : ""}</table></div>
   <div class="row">${S.champ == null ? `<button class="big" id="snx">▶ PLAY NEXT GAME</button>` : ""}<button class="ghost" id="srs">New season</button><button class="ghost" id="mme">Menu</button></div></div>`;
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
  if (nx) nx.focus();
}
export const SEASON = { on: 0 };
/** Called by the shell when a game ends: records the result, sims the rest of the league, advances the playoffs. */
export function seasonResult(won: boolean) {
  if (!SEASON.on) return false;
  SEASON.on = 0;
  const S: Season = lsGet(SKEY(), null);
  if (!S) return false;
  const my = G.sc[0],
    op = G.sc[1];
  if (S.round < S.sched.length) {
    const g = S.sched[S.round];
    g.my = my;
    g.op = op;
    const im = S.teams.indexOf(S.team),
      io = S.teams.indexOf(g.opp);
    if (won) (S.w[im]++, S.l[io]++);
    else (S.w[io]++, S.l[im]++);
    // the rest of the league plays this round too
    const rest = S.teams.filter((t) => t !== S.team && t !== g.opp).sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < rest.length; i += 2) simGame(S, rest[i], rest[i + 1]);
    S.round++;
    if (S.round >= S.sched.length) {
      const st = standings(S),
        seed = st.findIndex((r) => r.t === S.team);
      if (seed < 4) S.po = { stage: 0, opp: st[3 - seed].t, res: [`Playoffs: #${seed + 1} seed vs #${4 - seed} ${tName(st[3 - seed].t)}`], seeds: st.slice(0, 4).map((r) => r.t) };
      else {
        // missed the playoffs: the top 4 play it out
        const s4 = st.slice(0, 4).map((r) => r.t),
          f1 = Math.random() < 0.5 ? s4[0] : s4[3],
          f2 = Math.random() < 0.5 ? s4[1] : s4[2];
        S.champ = Math.random() < 0.5 ? f1 : f2;
        S.po = { res: [`Missed the playoffs (#${seed + 1}).`] };
      }
    }
  } else if (S.po) {
    const p = S.po;
    p.res.push(`${p.stage === 0 ? "Semifinal" : "Final"} vs ${tName(p.opp)}: ${won ? "W" : "L"} ${my}-${op}`);
    if (!won) {
      S.champ = p.stage === 0 ? p.seeds.filter((t: number) => t !== S.team && t !== p.opp)[(Math.random() * 2) | 0] : p.opp;
    } else if (p.stage === 0) {
      const o = p.seeds.filter((t: number) => t !== S.team && t !== p.opp);
      p.stage = 1;
      p.opp = o[Math.random() < 0.5 ? 0 : 1];
    } else S.champ = S.team;
  }
  lsPut(SKEY(), S);
  return true;
}

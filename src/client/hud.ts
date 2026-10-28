// Heads-up display (UI v6): broadcast score bug (teams, scores, period + clock, shot clock, timeouts, fouls / bonus,
// possession, momentum, the other side's set call), player card, shot meters (4 styles x 4 palettes; green at the
// TOP), contest ring + label, pass / open / assignment markers, floating texts, replay tag, touch stick.
// Accessibility: V.TXT scales the text, V.HC = solid outlined panels, V.MINHUD = score bug + meter only.
import { P, B, sc, q, clock, shot, ftq, tf, inb, cl, PC, cfg, RPL, OFFS, HY, hoop, contestOf, pick, ovr, shotRat, winMul, shotContest, greenWin, cwin, RSPD, gameLike, guardOf, TS, PLAY, DSN, PCN, T, pos, CT, type Player } from "../core/sim";
import { V, pr, fmt, MN, PAL } from "./view";
import { teamMark, abbr, shade } from "./ui/art";
import { isLaySv } from "../core/data";
import { K, tempoOf, TX, STK_R, KMAP } from "./input";
let X: CanvasRenderingContext2D = null as any;
export const setHudCtx = (x: CanvasRenderingContext2D) => (X = x);
const fp = () => V.focusP();
/** Fonts: condensed display face for numbers / names, UI face for small print. */
export const FD = (w: number, px: number) => `${w} ${px}px "H2K Display", Bahnschrift, "Arial Narrow", Impact, sans-serif`;
const FU = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
/** Text scale: the accessibility size x a boost on small screens (the 960-unit HUD is ~0.4 px/unit on a phone). */
const tk = () => ([1, 1.15, 1.3][V.TXT] || 1) * ((X.canvas.clientWidth || 960) < 620 ? 1.5 : 1);
const kn = (id: string) => (KMAP[id] || "?").replace(/^Key|^Digit/, "");
function rr(x: number, y: number, w: number, h: number, r: number) {
  X.beginPath();
  X.roundRect(x, y, w, h, r);
}
/** Panel: glass (or solid + outlined in high contrast). */
function plate(x: number, y: number, w: number, h: number, r = 6, a = 0.82) {
  rr(x, y, w, h, r);
  X.fillStyle = V.HC ? "#000" : `rgba(8,10,22,${a})`;
  X.fill();
  if (V.HC) {
    X.strokeStyle = "#fff";
    X.lineWidth = 1.5;
    X.stroke();
  }
}
/** Text with a dark outline in high contrast (readable over the bright floor). */
function txt(s: string, x: number, y: number) {
  if (V.HC) {
    X.lineJoin = "round";
    X.strokeStyle = "#000";
    X.lineWidth = 4;
    X.strokeText(s, x, y);
  }
  X.fillText(s, x, y);
}
const light = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || "");
  if (!m) return c || "#fff";
  const n = parseInt(m[1], 16),
    l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 120 ? c : `rgb(${Math.min(255, (n >> 16) + 90)},${Math.min(255, ((n >> 8) & 255) + 90)},${Math.min(255, (n & 255) + 90)})`;
};
export function passMark() {
  if (V.MINHUD) return;
  const p = fp();
  if (!p || B.owner !== p || ftq || inb > 0) return;
  const i = {
      dx: (K.ArrowRight || K.KeyD ? 1 : 0) - (K.ArrowLeft || K.KeyA ? 1 : 0),
      dy: (K.ArrowDown || K.KeyS ? 1 : 0) - (K.ArrowUp || K.KeyW ? 1 : 0),
    },
    r = pick(p, i);
  if (!r || r === p) return;
  const q = pr(r.x, r.y, r.z + 92);
  X.fillStyle = "#ffc83d";
  X.beginPath();
  X.moveTo(q[0] - 7, q[1] - 10);
  X.lineTo(q[0] + 7, q[1] - 10);
  X.lineTo(q[0], q[1]);
  X.closePath();
  X.fill();
  if (V.HC) (X.strokeStyle = "#000"), (X.lineWidth = 1.5), X.stroke();
}
export function openMark() {
  if (V.MINHUD) return;
  const o = OFFS[0];
  if (!o || !B.owner || B.owner.tm !== 0 || B.owner === o) return;
  const q = pr(o.x, o.y, o.z + 85);
  X.font = FD(700, 11 * tk());
  X.textAlign = "center";
  const w = X.measureText("OPEN").width + 14;
  rr(q[0] - w / 2, q[1] - 13, w, 16, 8);
  X.fillStyle = V.HC ? "#000" : "rgba(10,40,24,.85)";
  X.fill();
  X.fillStyle = "#2ee07a";
  X.fillText("OPEN", q[0], q[1] - 1);
}
/** On defense: a faint ring under the man you're assigned to (it follows switches). */
export function assignMark() {
  if (V.MINHUD) return;
  const me = fp();
  if (!me || RPL || !B.owner || B.owner.tm === me.tm || !gameLike() || cfg.NP < 2) return;
  const m = me.manT > 0 && me.man != null ? P[me.man] : guardOf(me);
  if (!m || m.off) return;
  X.save();
  X.strokeStyle = V.HC ? "#ff3030" : "rgba(255,90,90,.75)";
  X.lineWidth = V.HC ? 3 : 2;
  X.setLineDash([5, 4]);
  X.beginPath();
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI * 2,
      q = pr(m.x + Math.cos(a) * 13, m.y + Math.sin(a) * 13, 0);
    k ? X.lineTo(q[0], q[1]) : X.moveTo(q[0], q[1]);
  }
  X.stroke();
  X.restore();
}
export function replayHud() {
  if (!RPL) return;
  X.save();
  X.font = FD(700, 15 * tk());
  const s = "REPLAY",
    sub = Math.round(RSPD * 100) + "% · [ ] speed · SPACE skip";
  const w = X.measureText(s).width;
  X.font = FU(600, 11 * tk());
  const w2 = X.measureText(sub).width;
  plate(18, 84, w + w2 + 54, 26, 13);
  X.fillStyle = "#ff3b5c";
  X.beginPath();
  X.arc(33, 97, 5 + Math.sin(performance.now() / 180) * 1.2, 0, 7);
  X.fill();
  X.textAlign = "left";
  X.fillStyle = "#fff";
  X.font = FD(700, 15 * tk());
  X.fillText(s, 44, 103);
  X.font = FU(600, 11 * tk());
  X.fillStyle = "#c9cfe8";
  X.fillText(sub, 52 + w, 102);
  X.restore();
}
export function contestFx(p: Player) {
  if (B.owner !== p || ftq) return;
  // (while charging / releasing: the contest the green window is judged on, live - see sim.ts shotContest)
  const c = p.mode === "c" || p.mode === "s" ? shotContest(p) : contestOf(p)[0],
    q = pr(p.x, p.y, 0),
    sx = q[0],
    sy = q[1],
    ph = Math.max(40, Math.abs(sy - pr(p.x, p.y, 70)[1]));
  if (c > 0.03) {
    X.strokeStyle = "rgba(255,70,70," + (V.HC ? 1 : 0.35 + c * 0.55) + ")";
    X.lineWidth = 2 + c * 3;
    X.beginPath();
    X.ellipse(sx, sy, ph * 0.55, ph * 0.22, 0, 0, 6.3);
    X.stroke();
  }
  if (p.mode === "c" || p.mode === "s") {
    // the window shrinking with the contest, live: open = full window .. smothered = a quarter of it
    const s = c < 0.08 ? "WIDE OPEN" : (c < 0.5 ? "CONTESTED" : "SMOTHERED") + " · WINDOW -" + Math.round((1 - cwin(c)) * 100) + "%";
    X.textAlign = "center";
    X.font = FD(700, 12 * tk());
    const w = X.measureText(s).width + 16,
      y = sy + ph * 0.5;
    rr(sx - w / 2, y - 12, w, 17, 8);
    X.fillStyle = V.HC ? "#000" : "rgba(8,10,22,.7)";
    X.fill();
    X.fillStyle = c < 0.08 ? "#2ee07a" : c < 0.5 ? "#ffc83d" : "#ff6b6b";
    X.fillText(s, sx, y);
  }
}
export function meter(p: Player) {
  const TEMPO = tempoOf(p);
  const tm = TEMPO && p.mode === "s" && !p.rl,
    hold = !TEMPO && p.mode === "c";
  if (!(tm || hold)) return;
  const D0 = Math.hypot(hoop(p.tm) - p.x, HY - p.y),
    rat = shotRat(p, D0, !!ftq),
    c = shotContest(p), // (live while charging, locked at release - the same contest launch judges)
    win = greenWin(p, rat, c, D0 < 90 || p.hk ? 1 : winMul(p, D0)) * (TEMPO ? 1.2 : 1), // (launch's window)
    ideal = TEMPO
      ? isLaySv(p.sv)
        ? 0.28
        : p.st === 1
          ? 0.3
          : 0.4
      : p.st === 1
        ? 0.45
        : 0.6,
    wm = (0.07 + (rat / 100) * 0.05) * (TEMPO ? 1.2 : 1),
    m = (ideal + wm) / 0.97,
    pg = Math.min(1, p.t / m),
    g1 = 1,
    g0 = 0.97 - (2 * win) / m,
    inG = pg >= g0 && pg <= g1,
    q = pr(p.x, p.y, 0),
    sx = q[0],
    sy = q[1],
    ph = Math.max(40, Math.abs(sy - pr(p.x, p.y, 70)[1])) * (V.BIGM ? 1.6 : 1),
    pal = PAL[V.CB] || PAL[0],
    GC = pal.g,
    WC = pal.w,
    FC = pal.f,
    OL = V.HC ? 3 : 2;
  if (V.METER === 0) {
    const ax = sx - ph * 0.5,
      aw = ph * 0.3,
      ah = ph * 1.05,
      sw = aw * 0.3,
      path = () => {
        X.beginPath();
        X.moveTo(ax - sw, sy);
        X.lineTo(ax - sw, sy - ah * 0.65);
        X.lineTo(ax - aw / 2, sy - ah * 0.65);
        X.lineTo(ax, sy - ah);
        X.lineTo(ax + aw / 2, sy - ah * 0.65);
        X.lineTo(ax + sw, sy - ah * 0.65);
        X.lineTo(ax + sw, sy);
        X.closePath();
      };
    X.save();
    path();
    X.fillStyle = V.HC ? "#000" : "rgba(10,12,24,.6)";
    X.fill();
    X.clip();
    X.fillStyle = inG ? GC : V.CB === 3 ? FC : "#fff";
    X.fillRect(ax - aw, sy - ah * pg, aw * 2, ah * pg);
    X.fillStyle = pal.band;
    X.fillRect(ax - aw, sy - ah * g1, aw * 2, ah * (g1 - g0));
    X.restore();
    if (V.HC) {
      X.strokeStyle = "#000";
      X.lineWidth = OL + 2;
      path();
      X.stroke();
    }
    X.strokeStyle = "#fff";
    X.lineWidth = OL;
    path();
    X.stroke();
  } else if (V.METER === 1) {
    const w = ph * 1.1,
      x0 = sx - w / 2,
      y0 = sy + ph * 0.18;
    X.fillStyle = V.HC ? "#000" : "rgba(0,0,0,.65)";
    X.fillRect(x0 - 2, y0 - 2, w + 4, 10);
    X.fillStyle = FC;
    X.fillRect(x0, y0, w * pg, 6);
    X.fillStyle = WC;
    X.fillRect(x0 + g0 * w, y0, (g1 - g0) * w, 6);
    X.fillStyle = "#fff";
    X.fillRect(x0 + w * pg - 1, y0 - 3, 3, 12);
  } else if (V.METER === 2) {
    const h = pr(p.x, p.y, p.z + 92),
      w = V.BIGM ? 96 : 60,
      x0 = h[0] - w / 2;
    X.fillStyle = V.HC ? "#000" : "rgba(0,0,0,.65)";
    X.fillRect(x0 - 2, h[1] - 2, w + 4, 9);
    X.fillStyle = GC;
    X.fillRect(x0 + g0 * w, h[1], (g1 - g0) * w, 5);
    X.fillStyle = V.CB === 3 ? "#ffd400" : "#ffd23f";
    X.fillRect(x0 + pg * w - 1, h[1] - 3, 3, 11);
  } else {
    const rx = ph * 0.6,
      ry = ph * 0.24;
    X.lineWidth = V.HC ? 8 : 5;
    X.strokeStyle = V.HC ? "#000" : "rgba(0,0,0,.55)";
    X.beginPath();
    X.ellipse(sx, sy, rx, ry, 0, 0, 6.3);
    X.stroke();
    X.strokeStyle = WC;
    X.lineWidth = 7;
    X.beginPath();
    X.ellipse(sx, sy, rx, ry, 0, -1.57 + g0 * 6.283, -1.57 + g1 * 6.283);
    X.stroke();
    X.strokeStyle = inG ? GC : V.CB ? FC : "#ffd23f";
    X.lineWidth = 4;
    X.beginPath();
    X.ellipse(sx, sy, rx, ry, 0, -1.57, -1.57 + pg * 6.283);
    X.stroke();
  }
}
/** Player card (bottom left), your controls line, free-throw caption. */
export function hud2() {
  const p = fp();
  if (ftq && ftq.i >= 0) {
    const s = (ftq.tech ? "TECHNICAL " : "") + "FREE THROW " + (ftq.i + 1) + " OF " + ftq.n + " · " + ftq.s.n.toUpperCase();
    X.font = FD(700, 16 * tk());
    X.textAlign = "center";
    const w = X.measureText(s).width + 30;
    plate(480 - w / 2, 84, w, 28, 14);
    X.fillStyle = "#ffc83d";
    X.fillText(s, 480, 104);
  }
  if (!p || V.MINHUD) return;
  const k = tk(),
    W = 286 * k,
    H = 50 * k,
    x0 = 948 - W,
    y0 = 520 - H,
    col = PC[p.tm] || "#ff6a1f";
  X.save();
  plate(x0, y0, W, H, 8);
  X.fillStyle = col;
  rr(x0, y0, 5, H, [8, 0, 0, 8] as any);
  X.fill();
  // number + name
  X.textAlign = "left";
  X.fillStyle = light(col);
  X.font = FD(700, 22 * k);
  X.fillText(String(p.no ?? ""), x0 + 13, y0 + 25 * k);
  const nw = X.measureText(String(p.no ?? "")).width;
  X.fillStyle = "#fff";
  X.font = FD(700, 17 * k);
  X.fillText(p.n.toUpperCase().slice(0, 16), x0 + 19 + nw, y0 + 23 * k);
  // OVR chip
  X.font = FD(700, 13 * k);
  const ov = "OVR " + ovr(p),
    ow = X.measureText(ov).width + 12;
  rr(x0 + W - ow - 8, y0 + 8 * k, ow, 18 * k, 9 * k);
  X.fillStyle = "#ffc83d";
  X.fill();
  X.fillStyle = "#14100a";
  X.textAlign = "center";
  X.fillText(ov, x0 + W - ow / 2 - 8, y0 + 21.5 * k);
  // line: stats + energy
  X.textAlign = "left";
  X.font = FU(600, 11 * k);
  X.fillStyle = "#c9cfe8";
  X.fillText(`${p.stt.pts} PTS · ${p.stt.reb} REB · ${p.stt.ast} AST · ${p.pf} PF`, x0 + 13, y0 + H - 9 * k);
  const en = p.en == null ? 1 : p.en,
    bx = x0 + W - 62 * k,
    by = y0 + H - 15 * k;
  X.fillStyle = "rgba(255,255,255,.15)";
  X.fillRect(bx, by, 50 * k, 5);
  X.fillStyle = en > 0.6 ? "#2ee07a" : en > 0.35 ? "#ffc83d" : "#ff5d5d";
  X.fillRect(bx, by, 50 * k * en, 5);
  X.font = FU(700, 8 * k);
  X.fillStyle = "#8d95b8";
  X.textAlign = "right";
  X.fillText("EN", bx - 4, by + 5);
  X.textAlign = "left";
  // right: shooting style + meter
  const r = (tempoOf(p) ? "TEMPO" : "HOLD & RELEASE") + " · " + MN[V.METER].toUpperCase();
  X.font = FU(700, 10 * k);
  X.textAlign = "right";
  const rw = X.measureText(r).width + 18;
  plate(948 - rw, y0 - 26 * k, rw, 20 * k, 10 * k, 0.6);
  X.fillStyle = "#c9cfe8";
  X.fillText(r, 939, y0 - 12.5 * k);
  X.restore();
}
/** Floating texts + the touch stick (score bug: scoreBug). */
export function hud() {
  hudTexts();
  stickHud();
}
/** The broadcast score bug, top centre: [team | score] [team | score] [period clock] [shot clock] with timeout pips,
 *  fouls / BONUS, possession and a momentum line; then the other side's set ("THEY'RE RUNNING") and your calls. */
// ---------------- score bug (broadcast bar) + ticker ----------------
// Reads sim state only (works for online guests: sc / q / clock / shot / TS / tf / pos / B.last come from snapshots).
/** Team marks (ui/art.ts SVG shield) rasterised once per team + colour. */
const MARKS = new Map<string, HTMLImageElement>();
function markImg(name: string, col: string) {
  const k = name + col;
  let m = MARKS.get(k);
  if (!m && typeof Image !== "undefined") {
    m = new Image();
    m.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(teamMark(name, col, 64).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
    MARKS.set(k, m);
  }
  return m && m.complete && m.naturalWidth ? m : null;
}
/** Bug animation state (client clock: keeps animating while the sim is paused for a dead ball). */
const BUG = {
  sc: [-1, -1], // last seen scores
  shown: [0, 0], // displayed (counting up)
  hit: [-9, -9], // time of the last basket per team
  add: [0, 0], // +N tag
  q: 0,
  tick: [] as { t: string; c: string; sub?: string; d: number }[], // ticker queue
  cur: null as null | { t: string; c: string; sub?: string; d: number; t0: number },
  streak: { p: null as any, n: 0, tm: -1 },
  runSaid: 0,
};
const now = () => (typeof performance !== "undefined" ? performance.now() / 1000 : 0);
const tickPush = (t: string, c: string, sub?: string, d = 4.5) => {
  if (BUG.tick.length > 3) BUG.tick.shift();
  BUG.tick.push({ t, c, sub, d });
};
const AB = (t: number) => abbr(String(cl[t] || "TM" + t));
const lastN = (p: any) => String(p.n || "").split(" ").pop()!.toUpperCase();
const ORD = ["1ST", "2ND", "3RD", "4TH"];
/** Watch the state for ticker stories: stat lines after a basket, runs, "N straight points", quarter-by-quarter. */
function bugEvents(full: boolean) {
  const t = now();
  if (BUG.sc[0] < 0 || sc[0] < BUG.sc[0] || sc[1] < BUG.sc[1]) {
    // new game / rematch: no animation for the first look
    BUG.sc = [sc[0], sc[1]];
    BUG.shown = [sc[0], sc[1]];
    BUG.q = q;
    BUG.tick.length = 0;
    BUG.cur = null;
    BUG.streak = { p: null, n: 0, tm: -1 };
    return;
  }
  for (let tm = 0; tm < 2; tm++) {
    const d = sc[tm] - BUG.sc[tm];
    if (d <= 0) continue;
    BUG.hit[tm] = t;
    BUG.add[tm] = d;
    BUG.sc[tm] = sc[tm];
    const p: any = B.last && B.last.tm === tm ? B.last : null;
    if (p) {
      // the scorer's line (a big play gets a sub-line); "N STRAIGHT POINTS" for a one-man run
      const S = BUG.streak;
      if (S.p === p) S.n += d;
      else (S.p = p), (S.n = d);
      S.tm = tm;
      const st = p.stt || {},
        line = `${st.pts || 0} PTS · ${st.reb || 0} REB · ${st.ast || 0} AST` + (st.tpa ? ` · ${st.tpm}/${st.tpa} 3PT` : "");
      if (S.n >= 6 && S.n - d < 6 + 4 * Math.floor((S.n - 6) / 4)) tickPush(`${lastN(p)}: ${S.n} STRAIGHT POINTS`, PC[tm], line, 5);
      else if (d >= 3 || B.dk || B.fl) tickPush(lastN(p) + (d >= 3 ? " FROM DOWNTOWN" : B.dk ? " WITH AUTHORITY" : " AND ONE"), PC[tm], line);
      else if ((st.pts || 0) >= 10 && (st.pts || 0) % 5 < d) tickPush(lastN(p) + " HEATING UP", PC[tm], line);
    } else BUG.streak = { p: null, n: 0, tm: -1 };
    if (BUG.streak.tm !== tm) BUG.streak = { p: null, n: 0, tm };
    // team runs (TS.run = [team, unanswered points])
    const run = TS.run && TS.run[0] === tm ? TS.run[1] : 0;
    if (full && run >= 7 && run - d < BUG.runSaid + 4) {
      BUG.runSaid = run;
      tickPush(`${String(cl[tm] || "").toUpperCase()} ON A ${run}-0 RUN`, PC[tm], `${AB(0)} ${sc[0]} · ${AB(1)} ${sc[1]}`, 5);
    }
    if (run < 7) BUG.runSaid = 0;
  }
  // end of a quarter: quarter-by-quarter line
  if (q !== BUG.q) {
    const ended = BUG.q;
    BUG.q = q;
    const qs = TS.qs || [];
    if (full && ended >= 1 && qs.length) {
      const per = qs.map((s2: number[], i: number) => {
        const a2 = s2[0] - (i ? qs[i - 1][0] : 0),
          b2 = s2[1] - (i ? qs[i - 1][1] : 0);
        return `${i < 4 ? "Q" + (i + 1) : "OT"} ${a2}-${b2}`;
      });
      tickPush(`END OF ${ORD[ended - 1] || "OT"} · ${AB(0)} ${sc[0]} - ${sc[1]} ${AB(1)}`, "#ffc83d", per.join("   "), 7);
    }
  }
}
export function scoreBug(me: number) {
  if (!gameLike() || !P.length) return;
  const k = tk(),
    full = !cfg.HALF,
    rm = !!V.RM,
    t = now();
  bugEvents(full);
  X.save();
  X.translate(480, 8);
  X.scale(k, k);
  const MK = 34, // team mark
    TW = 158, // team block (mark + abbr + score)
    SW = 54, // score panel
    CW = 88, // period + clock
    SCW = cfg.SCLK ? 40 : 0,
    H = 44,
    W = TW * 2 + CW + SCW,
    x0 = -W / 2;
  // ---- base plate: dark glass, top sheen, drop shadow
  X.shadowColor = "rgba(0,0,0,.5)";
  X.shadowBlur = 16;
  X.shadowOffsetY = 3;
  rr(x0, 0, W, H, 9);
  if (V.HC) X.fillStyle = "#000";
  else {
    const g = X.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a1f36");
    g.addColorStop(1, "#070912");
    X.fillStyle = g;
  }
  X.fill();
  X.shadowBlur = 0;
  X.shadowOffsetY = 0;
  X.save();
  rr(x0, 0, W, H, 9);
  X.clip();
  for (let tm = 0; tm < 2; tm++) {
    const tx = x0 + tm * TW,
      col = PC[tm] || "#2a2f6a",
      sx = tx + TW - SW;
    // team colour block with a diagonal sheen
    const g = X.createLinearGradient(tx, 0, tx + TW - SW, H);
    g.addColorStop(0, shade(col, 1.25));
    g.addColorStop(1, shade(col, 0.55));
    X.fillStyle = V.HC ? "#111" : g;
    X.fillRect(tx, 0, TW - SW, H);
    if (!V.HC) {
      X.fillStyle = "rgba(255,255,255,.08)";
      X.beginPath();
      X.moveTo(tx + 44, 0);
      X.lineTo(tx + 70, 0);
      X.lineTo(tx + 50, H);
      X.lineTo(tx + 24, H);
      X.fill();
    }
    // mark + abbreviation
    const im = markImg(String(cl[tm] || ""), col);
    if (im) X.drawImage(im, tx + 5, (H - MK) / 2 - 1, MK, MK);
    X.textAlign = "left";
    X.fillStyle = "#fff";
    X.font = FD(700, 21);
    txt(AB(tm), tx + MK + 10, 22);
    // timeouts (pips), fouls / BONUS, YOU
    let mx = tx + MK + 10;
    if (full) {
      for (let i = 0; i < 4; i++) {
        X.fillStyle = i < (TS.to[tm] || 0) ? "#fff" : "rgba(255,255,255,.22)";
        rr(mx + i * 8, 29, 6, 4, 1);
        X.fill();
      }
      mx += 36;
      X.font = FU(800, 8);
      if (TS.bon && TS.bon[1 - tm]) {
        rr(mx, 26, 30, 10, 3);
        X.fillStyle = "#ffc83d";
        X.fill();
        X.fillStyle = "#14100a";
        X.fillText("BONUS", mx + 2.5, 34);
      } else if (cfg.FOULS) {
        X.fillStyle = "rgba(255,255,255,.75)";
        X.fillText("F" + (tf[tm] || 0), mx, 34);
      }
    }
    if (me === tm) {
      X.font = FU(900, 7);
      X.fillStyle = "#ffc83d";
      X.textAlign = "right";
      X.fillText("YOU", sx - 5, 10);
    }
    // score panel: counts up and flashes on a basket, "+N" tag
    const age = t - BUG.hit[tm],
      fl = rm ? 0 : Math.max(0, 1 - age / 0.9);
    if (BUG.shown[tm] !== sc[tm]) {
      if (rm || BUG.shown[tm] > sc[tm]) BUG.shown[tm] = sc[tm];
      else if (age > 0.12) BUG.shown[tm] = Math.min(sc[tm], BUG.shown[tm] + 1), (BUG.hit[tm] = t - 0.02);
    }
    X.fillStyle = V.HC ? "#000" : "rgba(0,0,0,.42)";
    X.fillRect(sx, 0, SW, H);
    if (fl > 0) {
      X.fillStyle = col;
      X.globalAlpha = 0.85 * fl;
      X.fillRect(sx, 0, SW, H);
      X.globalAlpha = 1;
    }
    X.textAlign = "center";
    X.fillStyle = "#fff";
    X.font = FD(700, 32);
    if (!V.HC) (X.shadowColor = "rgba(0,0,0,.6)"), (X.shadowBlur = 4);
    txt(String(BUG.shown[tm]), sx + SW / 2, 33);
    X.shadowBlur = 0;
    // possession arrow (pointing at the team with the ball)
    if (pos === tm && !ftq) {
      const ax = tm ? tx + TW - 1 : tx + 1;
      X.fillStyle = "#ff9f2e";
      X.beginPath();
      if (tm) X.moveTo(ax, H / 2 - 7), X.lineTo(ax - 7, H / 2), X.lineTo(ax, H / 2 + 7);
      else X.moveTo(ax, H / 2 - 7), X.lineTo(ax + 7, H / 2), X.lineTo(ax, H / 2 + 7);
      X.fill();
    }
  }
  // ---- period + clock
  const cx = x0 + TW * 2;
  X.fillStyle = V.HC ? "#000" : "rgba(255,255,255,.04)";
  X.fillRect(cx, 0, CW, H);
  X.fillStyle = "rgba(255,255,255,.12)";
  X.fillRect(cx, 6, 1, H - 12);
  X.textAlign = "center";
  if (cfg.TO) {
    X.fillStyle = "#ffc83d";
    X.font = FD(600, 10);
    X.fillText("FIRST TO", cx + CW / 2, 16);
    X.fillStyle = "#fff";
    X.font = FD(700, 20);
    X.fillText(String(cfg.TO), cx + CW / 2, 36);
  } else {
    X.fillStyle = "#ffc83d";
    X.font = FD(600, 11);
    X.fillText(q > 4 ? (q > 5 ? q - 4 + "OT" : "OT") : ORD[q - 1] || "Q" + q, cx + CW / 2, 15);
    X.fillStyle = "#fff";
    X.font = FD(700, 23);
    txt(fmt(clock), cx + CW / 2, 37);
  }
  // ---- shot clock (red under 5 s; pulses unless reduce motion)
  if (SCW) {
    const sx = cx + CW,
      sv = Math.ceil(Math.max(0, shot)),
      low = shot < 5;
    X.fillStyle = low ? (rm ? "#d81e3a" : `rgba(216,30,58,${0.75 + 0.25 * Math.sin(t * 9)})`) : V.HC ? "#111" : "rgba(0,0,0,.35)";
    X.fillRect(sx, 0, SCW, H);
    X.fillStyle = low ? "#fff" : "#ffc83d";
    X.font = FD(700, 22);
    X.fillText(String(sv), sx + SCW / 2, 31);
    X.font = FU(800, 6);
    X.fillStyle = low ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.45)";
    X.fillText("SHOT", sx + SCW / 2, 40);
  }
  X.restore(); // clip
  // edge + team-colour underline
  rr(x0 + 0.5, 0.5, W - 1, H - 1, 9);
  X.strokeStyle = V.HC ? "#fff" : "rgba(255,255,255,.14)";
  X.lineWidth = V.HC ? 1.5 : 1;
  X.stroke();
  // "+N" tags rising over the score
  for (let tm = 0; tm < 2; tm++) {
    const age = t - BUG.hit[tm];
    if (rm || age > 1.6 || BUG.add[tm] <= 0 || BUG.shown[tm] !== sc[tm]) {
      if (age > 1.6) BUG.add[tm] = 0;
      continue;
    }
    // pops in at the score panel's top corner and rises a little (stays inside the screen at the top edge)
    const sx = x0 + tm * TW + TW - (tm ? SW - 12 : 12),
      y = 12 - Math.min(age, 0.4) * 8;
    X.globalAlpha = Math.max(0, 1 - age / 1.6);
    X.font = FD(700, 13);
    X.textAlign = "center";
    rr(sx - 13, y - 11, 26, 14, 7);
    X.fillStyle = "#ffc83d";
    X.fill();
    X.fillStyle = "#14100a";
    X.fillText("+" + BUG.add[tm], sx, y);
    X.globalAlpha = 1;
  }
  // momentum line under the bug
  if (full && !V.MINHUD) {
    const m = Math.max(-1, Math.min(1, TS.mom || 0)),
      mw = W - 18;
    X.fillStyle = "rgba(0,0,0,.5)";
    X.fillRect(-mw / 2, H + 3, mw, 3);
    X.fillStyle = m >= 0 ? PC[0] : PC[1];
    X.fillRect(m >= 0 ? 0 : (m * mw) / 2, H + 3, (Math.abs(m) * mw) / 2, 3);
    X.fillStyle = "#fff";
    X.fillRect(-1, H + 1, 2, 7);
  }
  // ---- ticker: slides out under the bar (runs, stat lines, N straight points, quarter by quarter)
  if (!V.MINHUD) {
    if (!BUG.cur && BUG.tick.length) BUG.cur = { ...BUG.tick.shift()!, t0: t };
    const c = BUG.cur;
    if (c) {
      const age = t - c.t0,
        ein = rm ? 1 : Math.min(1, age / 0.28),
        eout = rm ? 1 : Math.min(1, (c.d - age) / 0.28),
        e = Math.max(0, Math.min(ein, eout)),
        ez = 1 - Math.pow(1 - e, 3),
        th = c.sub ? 34 : 20,
        tw = Math.min(W + 40, 560),
        ty = H + 10 - (1 - ez) * (th + 10);
      if (age > c.d) BUG.cur = null;
      else if (e > 0) {
        X.save();
        X.beginPath();
        X.rect(-tw / 2 - 2, H + 8, tw + 4, th + 6);
        X.clip();
        rr(-tw / 2, ty, tw, th, 6);
        X.fillStyle = V.HC ? "#000" : "rgba(9,11,24,.92)";
        X.fill();
        X.fillStyle = c.c || "#ffc83d";
        X.fillRect(-tw / 2, ty, 5, th);
        X.textAlign = "center";
        X.fillStyle = "#fff";
        X.font = FD(700, 14);
        txt(c.t, 0, ty + 15);
        if (c.sub) {
          X.font = FU(700, 10);
          X.fillStyle = "rgba(255,255,255,.75)";
          X.fillText(c.sub, 0, ty + 29);
        }
        X.restore();
      }
    }
  }
  X.restore();
  (V as any).bugOn = T; // tests: the bug drew this frame
  if (V.MINHUD || me < 0 || !CT.length || cfg.NP < 2 || !full) return;
  // the other side's set, as the defense would call it out ("HORNS!") - for a few seconds after it starts
  const op = PLAY[1 - me];
  if (op && op.nm && T - op.t0 < 3.5) {
    const s = "THEY'RE RUNNING: " + op.nm;
    X.font = FD(700, 13 * k);
    X.textAlign = "center";
    const w = X.measureText(s).width + 24;
    plate(480 - w / 2, 8 + 96 * k, w, 22 * k, 11 * k);
    X.fillStyle = "#9fe7ff";
    X.fillText(s, 480, 8 + 96 * k + 15.5 * k);
  }
  // your calls (above the player card)
  const s = `DEF ${DSN[TS.ds[me]]} · PLAY ${PCN[TS.pc[me]]} [${kn("ds")}]   TIMEOUT [${kn("to")}] · CHALLENGE [${kn("ch")}]${TS.call && TS.call.t === me && TS.chal[me] > 0 ? " ← AVAILABLE!" : ""}`;
  X.font = FU(700, 10 * k);
  X.textAlign = "left";
  X.fillStyle = V.HC ? "#fff" : "rgba(255,255,255,.72)";
  txt(s, 14, 530);
}
/** Name + OVR tags over the humans and the ball handler. */
export function nameTags(list: (Player | null | undefined)[]) {
  const seen = new Set();
  X.textAlign = "center";
  X.font = FD(600, 11 * tk());
  for (const p of list)
    if (p && !seen.has(p) && !p.off) {
      seen.add(p);
      if (V.MINHUD && !CT.some((c) => P[c.idx] === p)) continue;
      const [sx, sy] = pr(p.x, p.y, p.z + 78),
        s = p.n.toUpperCase() + "  " + ovr(p),
        w = X.measureText(s).width + 12;
      // never over the score bug (far-court players project up into it)
      if (gameLike() && Math.abs(sx - 480) < 300 * tk() + w / 2 && sy < 8 + 60 * tk()) continue;
      rr(sx - w / 2, sy - 11 * tk(), w, 15 * tk(), 7);
      X.fillStyle = V.HC ? "#000" : "rgba(8,10,22,.55)";
      X.fill();
      X.fillStyle = CT.some((c) => P[c.idx] === p) ? "#ffc83d" : "#fff";
      X.fillText(s, sx, sy);
    }
}
/** The touch stick: ring where the thumb landed, knob under the thumb (orange when sprinting). */
function stickHud() {
  const s = V.stk;
  if (!s) return;
  const m = Math.hypot(s.ox, s.oy),
    k = m > STK_R ? STK_R / m : 1;
  X.globalAlpha = 0.55;
  X.strokeStyle = "#fff";
  X.lineWidth = 3;
  X.beginPath();
  X.arc(s.cx, s.cy, STK_R, 0, 7);
  X.stroke();
  X.fillStyle = s.sp ? "#ff8a2a" : "#ffffff";
  X.beginPath();
  X.arc(s.cx + s.ox * k, s.cy + s.oy * k, 24, 0, 7);
  X.fill();
  X.globalAlpha = 1;
}
function hudTexts() {
  X.textAlign = "center";
  const k = tk();
  TX.forEach((o) => {
    X.globalAlpha = Math.min(1, o.t * 2);
    X.fillStyle = o.c;
    X.font = FD(700, 24 * k);
    const at = o.x != null ? pr(o.x, o.y, o.z) : [o.sx, o.sy];
    X.lineJoin = "round";
    X.strokeStyle = V.HC ? "#000" : "rgba(0,0,0,.45)";
    X.lineWidth = V.HC ? 5 : 3;
    X.strokeText(o.s, at[0], at[1] + o.oy);
    X.fillText(o.s, at[0], at[1] + o.oy);
    X.globalAlpha = 1;
  });
}

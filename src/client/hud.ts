// Heads-up display (UI v6): broadcast score bug (teams, scores, period + clock, shot clock, timeouts, fouls / bonus,
// possession, momentum, the other side's set call), player card, shot meters (4 styles x 4 palettes; green at the
// TOP), contest ring + label, pass / open / assignment markers, floating texts, replay tag, touch stick.
// Accessibility: V.TXT scales the text, V.HC = solid outlined panels, V.MINHUD = score bug + meter only.
import { P, B, sc, q, clock, shot, ftq, tf, inb, cl, PC, cfg, RPL, OFFS, HY, hoop, contestOf, pick, ovr, shotRat, winMul, shotContest, greenWin, cwin, RSPD, gameLike, guardOf, TS, PLAY, DSN, PCN, T, pos, CT, type Player } from "../core/sim";
import { V, pr, fmt, MN, PAL } from "./view";
import { isLaySv } from "../core/data";
import { K, tempoOf, TX, STK_R, KMAP } from "./input";
let X: CanvasRenderingContext2D = null as any;
export const setHudCtx = (x: CanvasRenderingContext2D) => (X = x);
const fp = () => V.focusP();
/** Fonts: condensed display face for numbers / names, UI face for small print. */
export const FD = (w: number, px: number) => `${w} ${px}px "H2K Display", Bahnschrift, "Arial Narrow", Impact, sans-serif`;
const FU = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
const tk = () => [1, 1.15, 1.3][V.TXT] || 1;
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
  X.fillText("ENERGY", bx, by - 3);
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
export function scoreBug(me: number) {
  if (!gameLike() || !P.length) return;
  const k = tk(),
    full = !cfg.HALF;
  X.save();
  X.translate(480, 8);
  X.scale(k, k);
  const TW = 150,
    SW = 46,
    CW = 92,
    SCW = cfg.SCLK ? 38 : 0,
    H = 36,
    W = TW * 2 + CW + SCW + 6,
    x0 = -W / 2;
  // shadow plate
  X.shadowColor = "rgba(0,0,0,.45)";
  X.shadowBlur = 12;
  plate(x0, 0, W, H, 7, 0.9);
  X.shadowBlur = 0;
  for (let t = 0; t < 2; t++) {
    const tx = x0 + t * (TW + 2),
      col = PC[t] || "#2a2f6a";
    // team colour block
    X.save();
    rr(tx, 0, TW, H, t ? 0 : [7, 0, 0, 7] as any);
    X.clip();
    const g = X.createLinearGradient(tx, 0, tx + TW, 0);
    g.addColorStop(0, col);
    g.addColorStop(1, "rgba(8,10,22,.2)");
    X.fillStyle = g;
    X.fillRect(tx, 0, TW - SW, H);
    X.fillStyle = V.HC ? "#000" : "rgba(0,0,0,.35)";
    X.fillRect(tx + TW - SW, 0, SW, H);
    X.restore();
    // name
    X.textAlign = "left";
    X.fillStyle = "#fff";
    X.font = FD(700, 15);
    txt(String(cl[t] || "").toUpperCase().slice(0, 11), tx + 10, 19);
    // you / possession markers
    X.font = FU(800, 8);
    X.fillStyle = "#ffc83d";
    let mx = tx + 10;
    if (me === t) {
      X.fillText("YOU", mx, 31);
      mx += 22;
    }
    if (pos === t && !ftq) {
      X.fillStyle = "#ff8a3a";
      X.beginPath();
      X.arc(mx + 3, 28, 3, 0, 7);
      X.fill();
      mx += 12;
    }
    // timeouts + fouls / bonus (full court games)
    if (full) {
      for (let i = 0; i < 4; i++) {
        X.fillStyle = i < (TS.to[t] || 0) ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.18)";
        X.fillRect(mx + i * 9, 27, 6, 3);
      }
      mx += 40;
      X.font = FU(800, 8);
      if (TS.bon && TS.bon[1 - t]) {
        rr(mx, 23, 32, 10, 3);
        X.fillStyle = "#ffc83d";
        X.fill();
        X.fillStyle = "#14100a";
        X.fillText("BONUS", mx + 3, 31);
      } else if (cfg.FOULS) {
        X.fillStyle = "rgba(255,255,255,.6)";
        X.fillText("F " + (tf[t] || 0), mx, 31);
      }
    }
    // score
    X.textAlign = "center";
    X.fillStyle = "#fff";
    X.font = FD(700, 25);
    txt(String(sc[t]), tx + TW - SW / 2, 27);
  }
  // period + clock
  const cx = x0 + TW * 2 + 4;
  X.textAlign = "center";
  X.fillStyle = "#ffc83d";
  if (cfg.TO) {
    X.font = FD(700, 10);
    X.fillText("FIRST TO", cx + CW / 2, 15);
    X.font = FD(700, 16);
    X.fillText(String(cfg.TO), cx + CW / 2, 31);
  } else {
    X.font = FD(600, 11);
    X.fillText(q > 4 ? (q > 5 ? q - 4 + "OT" : "OT") : ["1ST", "2ND", "3RD", "4TH"][q - 1] || "Q" + q, cx + CW / 2, 13);
    X.fillStyle = "#fff";
    X.font = FD(700, 19);
    txt(fmt(clock), cx + CW / 2, 31);
  }
  // shot clock
  if (SCW) {
    const sx = cx + CW,
      s = Math.ceil(Math.max(0, shot)),
      low = shot < 5;
    rr(sx, 4, SCW - 4, H - 8, 5);
    X.fillStyle = low ? "#d81e3a" : V.HC ? "#222" : "rgba(255,255,255,.08)";
    X.fill();
    X.fillStyle = low ? "#fff" : "#ffc83d";
    X.font = FD(700, 17);
    X.fillText(String(s), sx + (SCW - 4) / 2, 25);
  }
  // momentum line under the bug
  if (full && !V.MINHUD) {
    const m = Math.max(-1, Math.min(1, TS.mom || 0)),
      mw = W - 14;
    X.fillStyle = "rgba(0,0,0,.5)";
    X.fillRect(x0 + 7, H + 3, mw, 3);
    X.fillStyle = m >= 0 ? PC[0] : PC[1];
    X.fillRect(m >= 0 ? 0 : (m * mw) / 2, H + 3, (Math.abs(m) * mw) / 2, 3);
    X.fillStyle = "#fff";
    X.fillRect(-1, H + 1, 2, 7);
    if (Math.abs(m) > 0.5) {
      X.font = FU(800, 8);
      X.fillStyle = "#ffb347";
      txt("MOMENTUM · " + String(m > 0 ? cl[0] : cl[1]).toUpperCase(), 0, H + 17);
    }
  }
  X.restore();
  if (V.MINHUD || me < 0 || !CT.length || cfg.NP < 2 || !full) return;
  // the other side's set, as the defense would call it out ("HORNS!") - for a few seconds after it starts
  const op = PLAY[1 - me];
  if (op && op.nm && T - op.t0 < 3.5) {
    const s = "THEY'RE RUNNING: " + op.nm;
    X.font = FD(700, 13 * k);
    X.textAlign = "center";
    const w = X.measureText(s).width + 24;
    plate(480 - w / 2, 8 + 62 * k, w, 22 * k, 11 * k);
    X.fillStyle = "#9fe7ff";
    X.fillText(s, 480, 8 + 62 * k + 15.5 * k);
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

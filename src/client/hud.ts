// Heads-up display: score bug, player strip, shot meters, contest ring, pass/open markers, floating texts.
import { P, B, sc, q, clock, shot, ftq, tf, inb, cl, PC, cfg, RPL, OFFS, HY, hoop, contestOf, pick, ovr, shotRat, winMul, RSPD, gameLike, type Player } from "../core/sim";
import { V, pr, fmt, MN } from "./view";
import { isLaySv } from "../core/data";
import { K, tempoOf, TX } from "./input";
let X: CanvasRenderingContext2D = null as any;
export const setHudCtx = (x: CanvasRenderingContext2D) => (X = x);
const fp = () => V.focusP();
export function passMark() {
  const p = fp();
  if (!p || B.owner !== p || ftq || inb > 0) return;
  const i = {
      dx: (K.ArrowRight || K.KeyD ? 1 : 0) - (K.ArrowLeft || K.KeyA ? 1 : 0),
      dy: (K.ArrowDown || K.KeyS ? 1 : 0) - (K.ArrowUp || K.KeyW ? 1 : 0),
    },
    r = pick(p, i);
  if (!r || r === p) return;
  const q = pr(r.x, r.y, r.z + 92);
  X.fillStyle = "#ffd23f";
  X.font = "800 14px system-ui";
  X.textAlign = "center";
  X.fillText("▼", q[0], q[1]);
}
export function openMark() {
  const o = OFFS[0];
  if (!o || !B.owner || B.owner.tm !== 0 || B.owner === o) return;
  const q = pr(o.x, o.y, o.z + 85);
  X.fillStyle = "#2ecc71";
  X.font = "800 12px system-ui";
  X.textAlign = "center";
  X.fillText("▼ OPEN", q[0], q[1]);
}
export function replayHud() {
  if (!RPL) return;
  X.fillStyle = "#ff4d4d";
  X.font = "900 18px system-ui";
  X.textAlign = "left";
  X.fillText("● REPLAY · " + Math.round(RSPD * 100) + "% speed [ ] · SPACE to skip", 22, 100);
}
export function contestFx(p: Player) {
  if (B.owner !== p || ftq) return;
  const c = contestOf(p)[0],
    q = pr(p.x, p.y, 0),
    sx = q[0],
    sy = q[1],
    ph = Math.max(40, Math.abs(sy - pr(p.x, p.y, 70)[1]));
  if (c > 0.03) {
    X.strokeStyle = "rgba(255,70,70," + (0.35 + c * 0.55) + ")";
    X.lineWidth = 2 + c * 3;
    X.beginPath();
    X.ellipse(sx, sy, ph * 0.55, ph * 0.22, 0, 0, 6.3);
    X.stroke();
  }
  if (p.mode === "c" || p.mode === "s") {
    X.textAlign = "center";
    X.font = "800 12px system-ui";
    X.fillStyle = c < 0.08 ? "#2ecc71" : c < 0.5 ? "#ffd23f" : "#ff6b6b";
    X.fillText(
      c < 0.08 ? "WIDE OPEN" : "CONTESTED " + Math.round(c * 100) + "%",
      sx,
      sy + ph * 0.5,
    );
  }
}
export function meter(p: Player) {
  const TEMPO = tempoOf(p);
  const tm = TEMPO && p.mode === "s" && !p.rl,
    hold = !TEMPO && p.mode === "c";
  if (!(tm || hold)) return;
  const D0 = Math.hypot(hoop(p.tm) - p.x, HY - p.y),
    rat = shotRat(p, D0, !!ftq),
    c = p.mode === "s" && p.cw != null ? p.cw : contestOf(p)[0],
    win =
      (0.07 + (rat / 100) * 0.05) *
      (1 - 0.45 * c) *
      (TEMPO ? 1.2 : 1) *
      (0.85 + 0.15 * (p.en == null ? 1 : p.en)) *
      (D0 < 90 || p.hk ? 1 : winMul(p, D0)),
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
    GC = V.CB ? "#4ea8ff" : "#2ecc71",
    WC = V.CB ? "#4ea8ff" : "#1fd6c0",
    FC = V.CB ? "#ff9f1c" : "#f5c542";
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
    X.fillStyle = "rgba(10,12,24,.6)";
    X.fill();
    X.clip();
    X.fillStyle = inG ? GC : "#fff";
    X.fillRect(ax - aw, sy - ah * pg, aw * 2, ah * pg);
    X.fillStyle = V.CB ? "rgba(78,168,255,.75)" : "rgba(46,204,113,.75)";
    X.fillRect(ax - aw, sy - ah * g1, aw * 2, ah * (g1 - g0));
    X.restore();
    X.strokeStyle = "#fff";
    X.lineWidth = 2;
    path();
    X.stroke();
  } else if (V.METER === 1) {
    const w = ph * 1.1,
      x0 = sx - w / 2,
      y0 = sy + ph * 0.18;
    X.fillStyle = "rgba(0,0,0,.65)";
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
    X.fillStyle = "rgba(0,0,0,.65)";
    X.fillRect(x0 - 2, h[1] - 2, w + 4, 9);
    X.fillStyle = GC;
    X.fillRect(x0 + g0 * w, h[1], (g1 - g0) * w, 5);
    X.fillStyle = "#ffd23f";
    X.fillRect(x0 + pg * w - 1, h[1] - 3, 3, 11);
  } else {
    const rx = ph * 0.6,
      ry = ph * 0.24;
    X.lineWidth = 5;
    X.strokeStyle = "rgba(0,0,0,.55)";
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
export function hud2() {
  const p = fp();
  X.fillStyle = "rgba(0,0,0,.55)";
  X.fillRect(0, 512, 960, 28);
  X.font = "700 12px system-ui";
  X.fillStyle = "#fff";
  X.textAlign = "left";
  X.fillText(
    p.n +
      "  OVR " +
      ovr(p) +
      " · 3PT " +
      p.c +
      " · INS " +
      p.i +
      " · SPD " +
      p.s +
      " · DEF " +
      p.d +
      " · " +
      p.stt.pts +
      "p " +
      p.stt.reb +
      "r " +
      p.stt.ast +
      "a · PF " +
      p.pf +
      " · EN " +
      Math.round((p.en == null ? 1 : p.en) * 100) +
      "%",
    12,
    530,
  );
  X.textAlign = "right";
  X.fillText(
    "TEMPO " +
      (tempoOf(fp()) ? "ON" : "OFF") +
      " · " +
      MN[V.METER] +
      " · FOULS " +
      tf[fp() ? fp().tm : 0] +
      "/" +
      tf[fp() ? 1 - fp().tm : 1],
    948,
    530,
  );
  if (ftq && ftq.i >= 0) {
    X.textAlign = "center";
    X.font = "800 18px system-ui";
    X.fillStyle = "#ffd23f";
    X.fillText(
      (ftq.tech ? "TECHNICAL " : "") +
        "FREE THROW " +
        (ftq.i + 1) +
        "/" +
        ftq.n +
        " — " +
        ftq.s.n,
      480,
      100,
    );
  }
}
export function hud() {
  if (!gameLike()) return hudTexts();
  X.fillStyle = "rgba(8,10,24,.88)";
  X.beginPath();
  X.rect(230, 6, 500, 62);
  X.fill();
  X.fillStyle = PC[0] || "#7b3fb5";
  X.fillRect(230, 6, 6, 62);
  X.fillStyle = PC[1] || "#1d428a";
  X.fillRect(724, 6, 6, 62);
  X.textAlign = "center";
  X.fillStyle = "#fff";
  X.font = "700 12px system-ui";
  const me = fp() ? fp().tm : 0;
  X.fillText(cl[0].toUpperCase() + (me === 0 ? " (YOU)" : ""), 340, 24);
  X.fillText(cl[1].toUpperCase() + (me === 1 ? " (YOU)" : ""), 620, 24);
  X.font = "800 30px system-ui";
  X.fillText(String(sc[0]), 340, 56);
  X.fillText(String(sc[1]), 620, 56);
  X.fillStyle = "#ffd23f";
  X.font = "800 20px system-ui";
  X.fillText((q > 4 ? "OT" : "Q" + q) + "  " + fmt(clock), 480, 36);
  X.fillStyle = shot < 5 ? "#ff6b4a" : "#fff";
  X.font = "700 16px system-ui";
  X.fillText(cfg.SCLK ? String(Math.ceil(Math.max(0, shot))) : "—", 480, 58);
  hudTexts();
}
function hudTexts() {
  X.textAlign = "center";
  TX.forEach((o) => {
    X.globalAlpha = Math.min(1, o.t * 2);
    X.fillStyle = o.c;
    X.font = "900 22px system-ui";
    const at = o.x != null ? pr(o.x, o.y, o.z) : [o.sx, o.sy];
    X.fillText(o.s, at[0], at[1] + o.oy);
    X.globalAlpha = 1;
  });
}

// Broadcast presentation: center banners (runs, clutch time, timeouts, violations), play-by-play commentary captions
// (+ optional speech), the tip-off intro card, momentum / timeouts / play-call bug, gamepad rumble.
import { P, sc, q, clock, cl, PC, TS, DSN, PCN, JB, BENCH, CT, badgesOf, BADGE, ovr, cfg, type Player } from "../core/sim";
import { V } from "./view";
import { KMAP } from "./input";
const kn = (id: string) => (KMAP[id] || "?").replace(/^Key|^Digit/, "");

let X: CanvasRenderingContext2D = null as any;
export const setBcCtx = (x: CanvasRenderingContext2D) => (X = x);

// ---------------- banners ----------------
const BN: { s: string; sub: string; c: string; t: number }[] = [];
export function banner(s: string, sub = "", c = "#ffd23f") {
  if (BN.length && BN[BN.length - 1].s === s && BN[BN.length - 1].t > 1.5) return;
  BN.push({ s, sub, c, t: 2.8 });
  if (BN.length > 3) BN.shift();
}
// ---------------- commentary ----------------
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
const LINES: Record<string, ((n: string, n2: string) => string)[]> = {
  three: [(n) => `${n} from downtown... BANG!`, (n) => `${n} knocks down the three!`, (n, a) => (a ? `${a} finds ${n} — three ball, good!` : `${n} buries it from deep!`)],
  splash: [(n) => `SPLASH! ${n} doesn't even touch the rim!`, (n) => `Nothing but nylon from ${n}!`],
  two: [(n) => `${n} gets the bucket.`, (n, a) => (a ? `Nice feed from ${a}, ${n} finishes.` : `${n} scores.`), (n) => `${n} with the touch.`],
  dunk: [(n) => `${n} THROWS IT DOWN!`, (n) => `Oh, ${n} with the hammer!`, (n, a) => (a ? `${a} to ${n} — SLAM!` : `${n} rises and flushes it!`)],
  dunkAnd1: [(n) => `${n} DUNKS IT THROUGH THE CONTACT! And one!`],
  and1: [(n) => `${n} scores and draws the foul! And one!`, (n) => `Count it — and the foul on the shot by ${n}!`],
  run: [(t) => `${t} are on a run — somebody call timeout!`, (t) => `This building is rocking, ${t} can't miss!`],
  clutch: [() => `We're in clutch time. Every possession matters now.`, () => `Crunch time — who wants the ball?`],
  timeout: [(t) => `Timeout on the floor, ${t} need to regroup.`, (t) => `${t} call time to talk it over.`],
  viol: [(n, s) => `Whistle — ${s.toLowerCase()}. Turnover.`],
  foulout: [(n) => `That's six — ${n} has fouled out.`],
  flagrant: [(n, n2) => `Flagrant foul on ${n}! That was a dangerous play on ${n2}.`],
  goaltend: [(n) => `Goaltending on ${n} — the basket counts!`],
  charge: [(n, n2) => `${n} plants and takes the charge from ${n2}!`],
  tech: [(n) => `Technical foul on ${n}. He did not like that call.`],
  cold: [(n) => `${n} has gone ice cold.`],
  board: [(n) => `${n} cleans the glass again.`],
  chalWin: [(t) => `The challenge is successful — call overturned!`],
  chalLose: [(t) => `The call stands. ${t} lose the challenge.`],
  fire: [(n) => `${n} is ON FIRE!`],
  block: [(n) => `REJECTED by ${n}!`],
};
const CAP: { s: string; t: number }[] = [];
let lastSpeak = 0;
export function comment(e: string, n = "", n2 = "") {
  const L = LINES[e];
  if (!L) return;
  const s = pick(L)(n, n2);
  CAP.push({ s, t: 3.6 });
  if (CAP.length > 2) CAP.shift();
  if (V.VOICE && typeof speechSynthesis !== "undefined") {
    try {
      const now = performance.now();
      if (speechSynthesis.speaking && now - lastSpeak < 2500) return; // don't talk over the last call
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(s);
      u.rate = 1.12;
      u.pitch = 0.95;
      u.volume = 0.9;
      speechSynthesis.speak(u);
      lastSpeak = now;
    } catch (e) {}
  }
}
export function bcTick(dt: number) {
  for (const b of BN) b.t -= dt;
  while (BN.length && BN[0].t <= 0) BN.shift();
  for (const c of CAP) c.t -= dt;
  while (CAP.length && CAP[0].t <= 0) CAP.shift();
}
export function bcReset() {
  BN.length = CAP.length = 0;
}
// ---------------- drawing ----------------
function rr(x: number, y: number, w: number, h: number, r: number) {
  X.beginPath();
  X.moveTo(x + r, y);
  X.arcTo(x + w, y, x + w, y + h, r);
  X.arcTo(x + w, y + h, x, y + h, r);
  X.arcTo(x, y + h, x, y, r);
  X.arcTo(x, y, x + w, y, r);
  X.closePath();
}
/** Team colors can be very dark: lift them so the subtitle reads on the dark plate. */
function light(c: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || "");
  if (!m) return "#e9eefc";
  const n = parseInt(m[1], 16),
    r = n >> 16,
    g = (n >> 8) & 255,
    b = n & 255,
    l = 0.299 * r + 0.587 * g + 0.114 * b;
  if (l > 140) return c;
  const k = 150 / Math.max(1, l),
    f = (v: number) => Math.min(255, Math.round(v * k + 60));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function drawBanners() {
  const b = BN[0];
  if (b) {
    const life = 2.8 - b.t,
      a = Math.min(1, life * 5, b.t * 3),
      sl = Math.max(0, 1 - life * 4) * 140;
    X.save();
    X.globalAlpha = a;
    X.translate(-sl, 0);
    X.font = "900 28px system-ui";
    const tw = X.measureText(b.s).width;
    X.font = "700 13px system-ui";
    const w = Math.min(900, Math.max(400, tw + 60, X.measureText(b.sub).width + 50)),
      x0 = 484 - w / 2;
    X.fillStyle = "rgba(8,10,24,.86)";
    rr(x0, 132, w, b.sub ? 64 : 46, 8);
    X.fill();
    X.fillStyle = b.c;
    X.fillRect(x0, 132, 8, b.sub ? 64 : 46);
    X.textAlign = "center";
    X.fillStyle = "#fff";
    X.font = "900 28px system-ui";
    X.fillText(b.s, 484, 165);
    if (b.sub) {
      X.font = "700 13px system-ui";
      X.fillStyle = light(b.c);
      X.fillText(b.sub, 484, 186);
    }
    X.restore();
  }
  // commentary lower third
  if (V.COMM)
    CAP.forEach((c, k) => {
      const a = Math.min(1, c.t * 2, (3.6 - c.t) * 6),
        y = 482 - (CAP.length - 1 - k) * 22;
      X.globalAlpha = a;
      X.font = "italic 600 14px system-ui";
      const w = X.measureText("🎙 " + c.s).width + 18;
      X.fillStyle = "rgba(0,0,0,.6)";
      rr(12, y - 15, w, 20, 5);
      X.fill();
      X.fillStyle = "#e9eefc";
      X.textAlign = "left";
      X.fillText("🎙 " + c.s, 20, y);
      X.globalAlpha = 1;
    });
}
/** Tip-off card: both starting fives with OVRs while the centers walk in for the jump ball. */
export function drawIntro() {
  if (!JB || JB.t > 2.4 || !P.length || cfg.GM !== "game") return;
  const a = Math.min(1, JB.t * 4, (2.4 - JB.t) * 3),
    NP = cfg.NP;
  X.save();
  X.globalAlpha = a;
  X.fillStyle = "rgba(6,8,20,.85)";
  rr(160, 120, 640, 64 + NP * 22, 10);
  X.fill();
  for (let t = 0; t < 2; t++) {
    const x0 = t ? 640 : 320;
    X.fillStyle = PC[t];
    X.fillRect(t ? 480 : 160, 120, 320, 5);
    X.textAlign = "center";
    X.fillStyle = "#fff";
    X.font = "900 22px system-ui";
    X.fillText(cl[t].toUpperCase(), x0, 152);
    X.font = "600 13px system-ui";
    for (let k = 0; k < NP; k++) {
      const p = P[t * NP + k];
      if (!p) continue;
      X.fillStyle = "#cfd6ee";
      X.fillText(`#${p.no} ${p.n}  ·  ${ovr(p)}${badgesOf(p).length ? "  ★" + badgesOf(p).length : ""}`, x0, 176 + k * 22);
    }
  }
  X.fillStyle = "#ffd23f";
  X.font = "900 18px system-ui";
  X.fillText("VS", 480, 152);
  X.restore();
}
/** Under the score bug: momentum meter, timeouts left (dots), your defense setting / play call, challenge flag. */
export function drawBug(me: number) {
  if (cfg.GM !== "game" && cfg.GM !== "clutch") return;
  // timeouts
  for (let t = 0; t < 2; t++)
    for (let k = 0; k < 4; k++) {
      X.fillStyle = k < TS.to[t] ? "#ffd23f" : "rgba(255,255,255,.18)";
      X.fillRect((t ? 590 : 310) + k * 16, 62, 11, 3);
    }
  // momentum
  const m = TS.mom;
  X.fillStyle = "rgba(0,0,0,.6)";
  X.fillRect(400, 70, 160, 6);
  X.fillStyle = m >= 0 ? PC[0] : PC[1];
  X.fillRect(480, 70, m * 80, 6);
  X.fillStyle = "#fff";
  X.fillRect(479, 68, 2, 10);
  if (Math.abs(m) > 0.5) {
    X.font = "800 10px system-ui";
    X.textAlign = "center";
    X.fillStyle = "#ffb347";
    X.fillText("MOMENTUM " + (m > 0 ? cl[0] : cl[1]).toUpperCase(), 480, 90);
  }
  if (me >= 0 && CT.length && cfg.NP > 1) {
    X.font = "700 11px system-ui";
    X.textAlign = "left";
    X.fillStyle = "rgba(255,255,255,.75)";
    X.fillText(`DEF ${DSN[TS.ds[me]]} · PLAY ${PCN[TS.pc[me]]}  [${kn("ds")}]   TIMEOUT [${kn("to")}] · CHALLENGE [${kn("ch")}]${TS.call && TS.call.t === me && TS.chal[me] > 0 ? " ← available!" : ""}`, 12, 506);
  }
}
/** Badge chips for the HUD strip / menus. */
export const badgeStr = (p: Player) => badgesOf(p).map((b) => BADGE[b][0]).join(" · ");
export const benchOf = (t: number) => BENCH[t] || [];
// ---------------- gamepad rumble ----------------
export function rumble(v: number, ms = 160) {
  if (!V.RUMBLE) return;
  try {
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) {
      const a = g && (g as any).vibrationActuator;
      if (a && a.playEffect) a.playEffect("dual-rumble", { duration: ms, strongMagnitude: Math.min(1, v), weakMagnitude: Math.min(1, v * 0.7) });
    }
  } catch (e) {}
}
export { sc, q, clock };

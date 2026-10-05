// Broadcast presentation: center banners (runs, clutch time, timeouts, violations), play-by-play commentary captions
// (+ optional speech), the tip-off intro card, momentum / timeouts / play-call bug, gamepad rumble.
import { P, sc, q, clock, cl, PC, TS, DSN, PCN, JB, BENCH, CT, badgesOf, BADGE, ovr, cfg, gameLike, type Player } from "../core/sim";
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
  cold: [(n) => `${n} has gone ice cold.`, (n) => `${n} can't buy one right now.`],
  assign: [(n, n2) => `${n} gets the call — he'll check ${n2} now.`, (n, n2) => `Defensive switch: ${n} picks up the hot hand, ${n2}.`],
  break: [(n, k) => (k ? `${n} has nothing but open floor ahead of him!` : `${n} pushes it up the floor — they've got numbers!`), (n) => `Here comes ${n} in transition!`],
  double: [(t, n) => `The ${t} are sending two at ${n} every time he touches it.`, (t, n) => `Here comes the double team on ${n}!`],
  foulup3: [(n, n2) => `Up three, ${n} fouls ${n2} before he can get a three off — smart basketball.`],
  zone: [(t) => `The ${t} switch to a two-three zone. They're daring you to shoot.`, (t) => `Zone defense from the ${t} — everybody packed in the paint.`],
  adjust: [(t, s) => `The ${t} bench makes an adjustment — ${s}.`, (t, s) => `New look from the ${t}: ${s}.`, (t, s) => `The ${t} change it up. The word is ${s}.`],
  board: [(n) => `${n} cleans the glass again.`],
  chalWin: [(t) => `The challenge is successful — call overturned!`],
  chalLose: [(t) => `The call stands. ${t} lose the challenge.`],
  fire: [(n) => `${n} is ON FIRE!`],
  block: [(n) => `REJECTED by ${n}!`, (n) => `Get that outta here! ${n} with the block!`],
  tipout: [(n, m) => `${n} keeps it alive, taps it out to ${m}!`],
  intfoul: [(n) => `They're going to foul to stop the clock — ${n} grabs him.`],
  tip: [(a, b) => `Welcome in, everybody. ${a} and ${b}, and we are ready for the tip.`, (a, b) => `It's ${a} against ${b} tonight. Here's the jump ball.`],
  half: [(a) => `That's the half. Let's look back at the best of it.`],
};
const CAP: { s: string; t: number }[] = [];
// two-part play-by-play: the call as he rises, then the result on the same caption ("Curry pulls up... BANG!")
const RISE: Record<string, ((n: string) => string)[]> = {
  deep: [(n) => `${n} from way downtown...`, (n) => `${n} from the logo...`, (n) => `${n}, are you serious, from there...`],
  three: [(n) => `${n} for three...`, (n) => `${n} lets it fly...`, (n) => `${n} from deep...`],
  step: [(n) => `${n} steps back...`, (n) => `${n}, the step-back...`],
  fade: [(n) => `${n} turns, fades...`, (n) => `${n} on the fadeaway...`],
  float: [(n) => `${n} floats one up...`, (n) => `${n} on the runner...`],
  pull: [(n) => `${n} pulls up...`, (n) => `${n} stops and pops...`],
  mid: [(n) => `${n} rises...`, (n) => `${n} for the jumper...`],
};
const TAIL: Record<string, string[]> = {
  three: ["BANG!", "GOT IT!", "COUNT IT!", "YES!"],
  splash: ["SPLASH!", "Nothing but net!", "Wet!"],
  two: ["Good!", "Got it.", "Money."],
  and1: ["Good — and the foul!"],
  miss: ["No good.", "Off the iron.", "Rims out.", "Short."],
  missO: ["No good — but they get the board!", "Off the rim, tipped back!"],
};
const BIG = new Set(["dunk", "dunkAnd1", "and1", "fire", "run", "clutch", "block", "flagrant", "goaltend", "foulout", "chalWin", "chalLose"]);
let rise: null | { n: string; t: number; c: { s: string; t: number } } = null,
  voice: SpeechSynthesisVoice | null = null,
  queued = 0;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    voice = vs.find((v) => /daniel|alex|google us english|david|guy|male/i.test(v.name)) || vs[0] || null;
  } catch (e) {}
}
if (typeof speechSynthesis !== "undefined") {
  pickVoice();
  try {
    speechSynthesis.onvoiceschanged = pickVoice;
  } catch (e) {}
}
/** Speak a line. now = cut off whatever is being said (a new play); hype = louder, faster, higher. */
function say(s: string, now: boolean, hype = 0) {
  if (!V.VOICE || typeof speechSynthesis === "undefined") return;
  try {
    if (now) {
      speechSynthesis.cancel();
      queued = 0;
    } else if (queued >= 2) return; // never fall behind the game
    const u = new SpeechSynthesisUtterance(s);
    if (voice) u.voice = voice;
    u.rate = 1.1 + hype * 0.15;
    u.pitch = 0.92 + hype * 0.22;
    u.volume = 0.85 + hype * 0.15;
    queued++;
    u.onend = u.onerror = () => (queued = Math.max(0, queued - 1));
    speechSynthesis.speak(u);
  } catch (e) {}
}
export function comment(e: string, n = "", n2 = "") {
  const t = performance.now();
  if (e === "rise") {
    const L = RISE[n2] || RISE.mid,
      s = pick(L)(n);
    const c = { s, t: 3.6 };
    CAP.push(c);
    if (CAP.length > 2) CAP.shift();
    rise = { n, t, c };
    say(s, true, n2 === "deep" ? 0.4 : 0);
    return;
  }
  // the result of the shot he just rose up with
  const tail = TAIL[e];
  if (rise && rise.n === n && t - rise.t < 4000 && tail) {
    const s = pick(tail);
    rise.c.s += " " + s;
    rise.c.t = 3.6;
    rise = null;
    say(s, false, e === "three" || e === "splash" ? 1 : e === "two" || e === "and1" ? 0.5 : 0);
    return;
  }
  if (e === "miss" || e === "missO") return; // misses only get called as the end of a call
  const L = LINES[e];
  if (!L) return;
  const s = pick(L)(n, n2);
  CAP.push({ s, t: 3.6 });
  if (CAP.length > 2) CAP.shift();
  const big = BIG.has(e);
  say(s, big && e !== "run" && e !== "clutch", big ? 1 : 0);
}
export function bcTick(dt: number) {
  for (const b of BN) b.t -= dt;
  while (BN.length && BN[0].t <= 0) BN.shift();
  if (TG && (TG.t -= dt) <= 0) TG = null;
  for (const c of CAP) c.t -= dt;
  while (CAP.length && CAP[0].t <= 0) CAP.shift();
}
export function bcReset() {
  BN.length = CAP.length = 0;
}
// ---------------- shot timing grade (human jumpers) ----------------
let TG: any = null;
export const timingGrade = (f: any) => (TG = { ...f, t: 2.6 });
export function drawTiming() {
  if (!TG) return;
  const a = Math.min(1, TG.t * 2),
    x0 = 14,
    y0 = 400,
    w = 220,
    span = Math.max(TG.win * 3, Math.abs(TG.off) + 40),
    px = (ms: number) => x0 + w / 2 + (ms / span) * (w / 2);
  X.save();
  X.globalAlpha = a;
  X.fillStyle = "rgba(8,10,24,.82)";
  rr(x0 - 6, y0 - 30, w + 12, 54, 8);
  X.fill();
  X.fillStyle = "rgba(255,255,255,.15)";
  X.fillRect(x0, y0, w, 8);
  X.fillStyle = V.CB ? "#4ea8ff" : "#2ecc71";
  X.fillRect(px(-TG.win), y0, px(TG.win + 30) - px(-TG.win), 8); // the green window (a little extra on the late side)
  X.fillStyle = "#fff";
  X.fillRect(px(0) - 1, y0 - 3, 2, 14); // perfect
  X.fillStyle = TG.gr ? "#ffd23f" : "#ff6b4a";
  X.beginPath();
  const mx = Math.max(x0, Math.min(x0 + w, px(TG.off)));
  X.moveTo(mx, y0 - 2);
  X.lineTo(mx - 6, y0 - 11);
  X.lineTo(mx + 6, y0 - 11);
  X.fill();
  X.textAlign = "left";
  X.font = "900 15px system-ui";
  X.fillText("GRADE " + TG.g, x0, y0 - 14);
  X.font = "700 11px system-ui";
  X.fillStyle = "#cfd6ee";
  X.textAlign = "right";
  X.fillText(TG.off === 0 ? "dead on" : Math.abs(TG.off) + " ms " + (TG.off > 0 ? "late" : "early"), x0 + w, y0 - 14);
  X.textAlign = "center";
  X.fillText("EARLY · PERFECT · LATE", x0 + w / 2, y0 + 20);
  if (TG.c != null) {
    // how good the look was (the contest at the release)
    const c = TG.c,
      [lb, col] = c < 15 ? ["WIDE OPEN", "#7CFC7C"] : c < 35 ? ["OPEN", "#c8f07a"] : c < 65 ? ["CONTESTED", "#ffb347"] : ["SMOTHERED", "#ff6b4a"];
    X.font = "900 12px system-ui";
    X.fillStyle = col;
    X.fillText(lb, x0 + w / 2, y0 - 14);
  }
  X.restore();
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
// ---------------- pre-game player introductions ----------------
const POSN = ["POINT GUARD", "SHOOTING GUARD", "SMALL FORWARD", "POWER FORWARD", "CENTER"];
const INTRO_TITLE = 1.8,
  cardT = () => (cfg.NP > 1 ? 0.8 : 1.8);
/** Length of the intro sequence (title card + one card per starter, away team first). */
export const introLen = () => INTRO_TITLE + P.length * cardT() + 0.4;
export function drawPlayerIntro(t: number, rec: string) {
  if (!P.length) return;
  X.save();
  X.fillStyle = "rgba(4,6,16,.55)";
  X.fillRect(0, 0, 960, 540);
  if (t < INTRO_TITLE) {
    const a = Math.min(1, t * 3, (INTRO_TITLE - t) * 4);
    X.globalAlpha = a;
    X.textAlign = "center";
    X.fillStyle = "#ffd23f";
    X.font = "800 16px system-ui";
    X.fillText("TONIGHT · LIVE FROM THE ARENA", 480, 190);
    for (let k = 0; k < 2; k++) {
      const x = k ? 690 : 270,
        s = Math.min(1, t * 2.5);
      X.fillStyle = PC[k];
      rr(x - 170 + (k ? 1 - s : s - 1) * 120, 215, 340, 96, 12);
      X.fill();
      X.fillStyle = "#fff";
      X.font = "900 40px system-ui";
      X.fillText(cl[k].toUpperCase(), x + (k ? 1 - s : s - 1) * 120, 275);
    }
    X.fillStyle = "#fff";
    X.font = "italic 900 34px system-ui";
    X.fillText("VS", 480, 275);
    X.font = "700 13px system-ui";
    X.fillStyle = "#cfd6ee";
    X.fillText(rec, 480, 345);
  } else {
    // away team first, then the home team (you) last, like a real arena
    const i = Math.min(P.length - 1, Math.floor((t - INTRO_TITLE) / cardT())),
      NP = cfg.NP,
      p = i < NP ? P[NP + i] : P[i - NP],
      lt = t - INTRO_TITLE - i * cardT(),
      a = Math.min(1, lt * 6, Math.max(0, cardT() - lt) * 6),
      sl = Math.max(0, 1 - lt * 5) * 80;
    if (p) {
      const home = p.tm === 0,
        x0 = 200 + (home ? -sl : sl);
      X.globalAlpha = a;
      X.fillStyle = "rgba(8,10,24,.92)";
      rr(x0, 160, 560, 210, 14);
      X.fill();
      X.fillStyle = p.col || PC[p.tm];
      rr(x0, 160, 190, 210, 14);
      X.fill();
      X.fillStyle = "rgba(255,255,255,.95)";
      X.textAlign = "center";
      X.font = "900 110px system-ui";
      X.fillText(String(p.no), x0 + 95, 305);
      X.textAlign = "left";
      X.fillStyle = "#ffd23f";
      X.font = "800 14px system-ui";
      X.fillText((NP >= 5 ? POSN[p.k] || "" : "STARTING") + " · " + cl[p.tm].toUpperCase() + (home ? " (YOU)" : ""), x0 + 215, 200);
      X.fillStyle = "#fff";
      X.font = "900 40px system-ui";
      X.fillText(p.n.toUpperCase().slice(0, 15), x0 + 215, 248);
      X.font = "700 15px system-ui";
      X.fillStyle = "#cfd6ee";
      X.fillText(`OVR ${ovr(p)} · ${Math.floor(p.ht)}'${Math.round((p.ht - Math.floor(p.ht)) * 12)}" · 3PT ${p.c} · INS ${p.i} · DEF ${p.d}`, x0 + 215, 282);
      const bs = badgesOf(p);
      X.font = "800 12px system-ui";
      let bx = x0 + 215;
      for (const b of bs.slice(0, 3)) {
        const s = "★ " + BADGE[b][0].toUpperCase(),
          w = X.measureText(s).width + 16;
        X.fillStyle = "rgba(255,210,63,.15)";
        rr(bx, 305, w, 24, 6);
        X.fill();
        X.fillStyle = "#ffd23f";
        X.fillText(s, bx + 8, 322);
        bx += w + 8;
      }
      if (!bs.length) {
        X.fillStyle = "rgba(255,255,255,.4)";
        X.fillText("STARTING " + (NP > 1 ? "FIVE" : "TONIGHT"), x0 + 215, 322);
      }
    }
  }
  X.globalAlpha = 1;
  X.textAlign = "center";
  X.font = "700 12px system-ui";
  X.fillStyle = "rgba(255,255,255,.6)";
  X.fillText("SPACE / ENTER / click to skip", 480, 500);
  X.restore();
}
/** Tip-off card: both starting fives with OVRs while the centers walk in for the jump ball (when the intros were skipped). */
export function drawIntro() {
  if (!JB || JB.t > 2.4 || !P.length || cfg.GM !== "game" || V.introDone) return;
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
  if (!gameLike() || cfg.HALF) return;
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

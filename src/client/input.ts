// Local input: keyboard (P1 WASD/arrows, P2 arrows + Enter / . , when local 2-player), touch buttons, gamepad.
// Produces one Input per sim tick per local controller; edge events are consumed when read.
import { CT, P, type Input, type Player } from "../core/sim";
import { V, CAMN, MN } from "./view";

export const K: Record<string, any> = {},
  ev: Record<string, any> = {},
  ev2: Record<string, any> = {};
export const GP = { on: 0, dx: 0, dy: 0, sp: 0, post: 0, pb: [] as boolean[] };
export const IN = { MP2: 0, TEMPO: 0, onSkip: null as null | (() => void), onCam: null as null | (() => void), onChat: null as null | ((k: number) => void), onRpl: null as null | ((d: number) => void) };
/** Remappable player-1 actions: [id, label, default key]. Movement stays on WASD / arrows. */
export const ACTS: [string, string, string][] = [
  ["sd", "Shoot / jump (hold)", "Space"],
  ["e", "Pass", "KeyE"],
  ["r", "Lob / alley-oop", "KeyR"],
  ["f", "Step-back", "KeyF"],
  ["cc", "Hesitation", "KeyC"],
  ["x", "Spin move", "KeyX"],
  ["vv", "Behind the back", "KeyV"],
  ["g", "Pump fake / jab", "KeyG"],
  ["post", "Post up (hold)", "KeyB"],
  ["sp", "Sprint (hold)", "ShiftLeft"],
  ["q", "Switch player", "KeyQ"],
  ["to", "Timeout", "KeyY"],
  ["ch", "Coach's challenge", "KeyH"],
  ["ds", "Defense / play call", "KeyZ"],
  ["cam", "Camera", "KeyK"],
  ["mtr", "Meter style", "KeyM"],
  ["tmp", "Tempo on/off", "KeyT"],
];
export const KMAP: Record<string, string> = {};
export function loadKeys() {
  let o: any = {};
  try {
    o = JSON.parse(localStorage.getItem("h2k_keys") || "{}");
  } catch (e) {}
  for (const [id, , d] of ACTS) KMAP[id] = o[id] || d;
}
export function saveKeys() {
  try {
    localStorage.setItem("h2k_keys", JSON.stringify(KMAP));
  } catch (e) {}
}
loadKeys();
const actOf = (code: string) => {
  for (const id in KMAP) if (KMAP[id] === code) return id;
  return "";
};
const held = (id: string) => !!K[KMAP[id]] || (id === "sp" && !!K.ShiftRight && !IN.MP2);
/** Auto-release assist: lets go of the shot near the top of the meter (with a little human error). */
export const AUTO = { rel: null as null | ((p: Player) => number | null) };
/** Floating texts in the HUD (from sim FX). */
export const TX: any[] = [];
export const tempoOf = (p: Player) => {
  for (const c of CT) if (P[c.idx] === p) return c.tempo;
  return 0;
};

export function hum(): Input {
  const MP2 = IN.MP2;
  const i: Input = {
    dx: ((!MP2 && K.ArrowRight) || K.KeyD ? 1 : 0) - ((!MP2 && K.ArrowLeft) || K.KeyA ? 1 : 0),
    dy: ((!MP2 && K.ArrowDown) || K.KeyS ? 1 : 0) - ((!MP2 && K.ArrowUp) || K.KeyW ? 1 : 0),
    sd: ev.sd,
    su: ev.su,
    e: ev.e,
    sb: ev.f,
    mv: ev.cc ? 1 : ev.x ? 2 : ev.vv ? 3 : 0,
    post: held("post") || GP.post || K.TouchPost,
    lob: ev.r,
    sp: held("sp") || GP.sp || !!V.stk?.sp,
    sw: ev.q,
    pf: ev.g,
    to: ev.to,
    ch: ev.ch,
    ds: ev.ds,
  };
  if (V.AUTO && !IN.TEMPO && AUTO.rel) {
    // hold & release style: the assist lets go for you at (about) the top of the meter
    const me = V.focusP();
    if (me && me.mode === "c" && !i.su) {
      const at = AUTO.rel(me);
      if (at != null && me.t >= at) {
        i.su = 1;
        i.mt = me.t;
        ev.sd = 0;
      }
    }
  }
  if (GP.on) {
    i.dx += GP.dx;
    i.dy += GP.dy;
  }
  if (V.stick) {
    i.dx += V.stick[0];
    i.dy += V.stick[1];
  }
  const m = Math.hypot(i.dx, i.dy);
  if (m > 1) {
    i.dx /= m;
    i.dy /= m;
  }
  ev.sd = ev.su = ev.e = ev.f = ev.x = ev.cc = ev.vv = ev.r = ev.q = ev.g = ev.to = ev.ch = ev.ds = 0;
  return i;
}
export function hum2(): Input {
  const i: Input = {
    dx: (K.ArrowRight ? 1 : 0) - (K.ArrowLeft ? 1 : 0),
    dy: (K.ArrowDown ? 1 : 0) - (K.ArrowUp ? 1 : 0),
    sd: ev2.sd,
    su: ev2.su,
    e: ev2.e,
    mv: ev2.cc ? 1 : ev2.x ? 2 : 0,
    sp: K.ShiftRight,
  };
  const m = Math.hypot(i.dx, i.dy);
  if (m > 1) {
    i.dx /= m;
    i.dy /= m;
  }
  ev2.sd = ev2.su = ev2.e = ev2.x = ev2.cc = 0;
  return i;
}

let GPX = 0;
export function gpPoll() {
  if (GPX) return;
  try {
    gpPoll0();
  } catch (e) {
    GPX = 1; // getGamepads() throws in sandboxed iframes (permissions policy)
  }
}
function gpPoll0() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  let p: Gamepad | null = null;
  for (const x of navigator.getGamepads() || [])
    if (x && x.connected) {
      p = x;
      break;
    }
  GP.on = p ? 1 : 0;
  if (!p) return;
  const a = p.axes,
    dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v),
    b = (i: number) => !!(p!.buttons[i] && p!.buttons[i].pressed);
  GP.dx = dz(a[0] || 0);
  GP.dy = dz(a[1] || 0);
  GP.sp = +b(7);
  GP.post = +b(6);
  const e = (i: number, f?: () => any, u?: () => any) => {
    const d = b(i);
    if (d && !GP.pb[i] && f) f();
    if (!d && GP.pb[i] && u) u();
    GP.pb[i] = d;
  };
  e(
    0,
    () => (ev.sd = 1),
    () => (ev.su = 1),
  );
  e(2, () => (ev.e = 1));
  e(1, () => (ev.r = 1));
  e(3, () => (ev.f = 1));
  e(4, () => (ev.cc = 1));
  e(5, () => (ev.x = 1));
  e(10, () => (ev.g = 1)); // L3: pump fake / jab / shoulder fake
  e(11, () => (ev.ds = 1)); // R3: defense setting / play call
  e(12, () => (ev.to = 1)); // d-pad up: timeout
  e(13, () => (ev.ch = 1)); // d-pad down: challenge
  e(8, () => {
    V.CAMM = (V.CAMM + 1) % 4;
  });
}
export const txtS = (s: string, x: number, y: number, c = "#fff") => TX.push({ s, sx: x, sy: y, t: 1.2, c, oy: 0 });
export function kd(c: string) {
  const a = actOf(c);
  if ((a === "sd" || c === "Space") && IN.onSkip) IN.onSkip();
  if (!K[c]) {
    K[c] = 1;
    if (IN.onRpl && (c === "BracketLeft" || c === "BracketRight")) IN.onRpl(c === "BracketLeft" ? -1 : 1);
    if (IN.onChat && /^Digit[1-6]$/.test(c)) IN.onChat(+c.slice(5));
    if (c === "Enter") ev2.sd = 1;
    if (c === "Slash") ev2.e = 1;
    if (c === "Period") ev2.x = 1;
    if (c === "Comma") ev2.cc = 1;
    if (a === "cam") {
      V.CAMM = (V.CAMM + 1) % 4;
      txtS("CAMERA: " + CAMN[V.CAMM], 480, 200, "#ffd23f");
    } else if (a === "tmp") {
      IN.TEMPO = 1 - IN.TEMPO;
      for (const k of CT) if (!(k as any).remote) k.tempo = IN.TEMPO;
    } else if (a === "mtr") {
      V.METER = (V.METER + 1) % 4;
      txtS("METER: " + MN[V.METER], 480, 200, "#ffd23f");
    } else if (a && a !== "post" && a !== "sp") ev[a] = 1;
  }
}
export function ku(c: string) {
  K[c] = 0;
  if (actOf(c) === "sd") ev.su = 1;
  if (c === "Enter") ev2.su = 1;
}
/** Floating analog stick for touch screens: a finger on the left side of the court view drops the stick where it
 *  lands (drag to move, push to the rim of the ring to sprint); a finger on the right side is the shoot / jump
 *  button (hold, release on green). Mice keep the old behaviour (nothing). */
export const STK_R = 62;
function touchStick() {
  const C = document.getElementById("c");
  if (!C) return;
  let sid = -1,
    bid = -1;
  const at = (e: PointerEvent) => {
    const r = C.getBoundingClientRect();
    return [((e.clientX - r.left) / (r.width || 1)) * 960, ((e.clientY - r.top) / (r.height || 1)) * 540];
  };
  const upd = (e: PointerEvent) => {
    const s = V.stk!,
      [x, y] = at(e);
    let ox = x - s.cx,
      oy = y - s.cy;
    const d = Math.hypot(ox, oy);
    // the ring follows a finger that slides past it (no dead stick after a long drag)
    if (d > STK_R * 1.35) (s.cx += (ox / d) * (d - STK_R * 1.35)), (s.cy += (oy / d) * (d - STK_R * 1.35)), (ox = x - s.cx), (oy = y - s.cy);
    const m = Math.min(1, Math.hypot(ox, oy) / STK_R);
    s.ox = ox;
    s.oy = oy;
    s.sp = m > 0.92 ? 1 : 0;
    const a = Math.atan2(oy, ox),
      v = m < 0.14 ? 0 : (m - 0.14) / 0.86;
    V.stick = [Math.cos(a) * v, Math.sin(a) * v];
  };
  C.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const ov = document.getElementById("ov");
    if (ov && ov.style.display !== "none" && !ov.hidden && getComputedStyle(ov).display !== "none") return;
    const [x, y] = at(e);
    try {
      C.setPointerCapture(e.pointerId);
    } catch (er) {}
    if (x < 480 && sid < 0) {
      sid = e.pointerId;
      V.stk = { cx: Math.max(STK_R + 8, Math.min(472 - STK_R, x)), cy: Math.max(STK_R + 8, Math.min(532 - STK_R, y)), ox: 0, oy: 0, sp: 0 };
      upd(e);
    } else if (x >= 480 && bid < 0) {
      bid = e.pointerId;
      kd(KMAP.sd);
    }
  });
  C.addEventListener("pointermove", (e) => {
    if (e.pointerId === sid && V.stk) upd(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId === sid) (sid = -1), (V.stk = null), (V.stick = null);
    if (e.pointerId === bid) {
      bid = -1;
      if (K[KMAP.sd]) ku(KMAP.sd);
    }
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => C.addEventListener(t, end as any));
}
let bound = 0;
export function bindInput() {
  if (bound) return;
  bound = 1;
  addEventListener("keydown", (e) => {
    if (["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Slash", "Enter"].includes(e.code) && !(e.target as HTMLElement)?.closest?.("input")) e.preventDefault();
    if ((e.target as HTMLElement)?.closest?.("input")) return;
    kd(e.code);
  });
  addEventListener("keyup", (e) => ku(e.code));
  touchStick();
  document.querySelectorAll<HTMLElement>("#tc button").forEach((b) => {
    const code = () => (b.dataset.a ? KMAP[b.dataset.a] : b.dataset.k!);
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      kd(code());
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) =>
      b.addEventListener(t, () => {
        if (K[code()]) ku(code());
      }),
    );
  });
}

// Local input: keyboard (P1 WASD/arrows, P2 arrows + Enter / . , when local 2-player), touch buttons, gamepad.
// Produces one Input per sim tick per local controller; edge events are consumed when read.
import { CT, P, type Input, type Player } from "../core/sim";
import { V, CAMN, MN } from "./view";

export const K: Record<string, any> = {},
  ev: Record<string, any> = {},
  ev2: Record<string, any> = {};
export const GP = { on: 0, dx: 0, dy: 0, sp: 0, post: 0, pb: [] as boolean[] };
export const IN = { MP2: 0, TEMPO: 0, onSkip: null as null | (() => void), onCam: null as null | (() => void) };
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
    post: K.KeyB || GP.post || K.TouchPost,
    lob: ev.r,
    sp: K.ShiftLeft || K.ShiftRight || GP.sp,
    sw: ev.q,
  };
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
  ev.sd = ev.su = ev.e = ev.f = ev.x = ev.cc = ev.vv = ev.r = ev.q = 0;
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
  e(8, () => {
    V.CAMM = (V.CAMM + 1) % 4;
  });
}
export const txtS = (s: string, x: number, y: number, c = "#fff") => TX.push({ s, sx: x, sy: y, t: 1.2, c, oy: 0 });
export function kd(c: string) {
  if (c === "Space" && IN.onSkip) IN.onSkip();
  if (!K[c]) {
    K[c] = 1;
    if (c === "KeyK") {
      V.CAMM = (V.CAMM + 1) % 4;
      txtS("CAMERA: " + CAMN[V.CAMM], 480, 200, "#ffd23f");
    }
    if (c === "Space") ev.sd = 1;
    if (c === "Enter") ev2.sd = 1;
    if (c === "Slash") ev2.e = 1;
    if (c === "Period") ev2.x = 1;
    if (c === "Comma") ev2.cc = 1;
    if (c === "KeyE") ev.e = 1;
    if (c === "KeyQ") ev.q = 1;
    if (c === "KeyF") ev.f = 1;
    if (c === "KeyX") ev.x = 1;
    if (c === "KeyR") ev.r = 1;
    if (c === "KeyC") ev.cc = 1;
    if (c === "KeyV") ev.vv = 1;
    if (c === "KeyT") {
      IN.TEMPO = 1 - IN.TEMPO;
      for (const k of CT) if (!(k as any).remote) k.tempo = IN.TEMPO;
    }
    if (c === "KeyM") {
      V.METER = (V.METER + 1) % 4;
      txtS("METER: " + MN[V.METER], 480, 200, "#ffd23f");
    }
  }
}
export function ku(c: string) {
  K[c] = 0;
  if (c === "Space") ev.su = 1;
  if (c === "Enter") ev2.su = 1;
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
  document.querySelectorAll<HTMLElement>("#tc button").forEach((b) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      kd(b.dataset.k!);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((t) =>
      b.addEventListener(t, () => {
        if (K[b.dataset.k!]) ku(b.dataset.k!);
      }),
    );
  });
}

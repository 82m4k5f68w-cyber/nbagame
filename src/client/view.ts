// Client-side view state shared by the renderers, HUD and input (not part of the simulation).
import { P, CT, W3, QTRLEN } from "../core/sim";
import { pj } from "./canvas";

export const V = {
  r3d: true, // renderer flag: three.js (true) or 2D canvas court
  GL: null as any, // three.js renderer handle (null = canvas fallback)
  CAMM: 0,
  QL: typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches ? 1 : 2,
  METER: 0,
  FX: !(typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches), // post-processing
  GPU: 0, // renderer: 0 WebGL, 1 WebGPU (beta; takes effect on the next start)
  backend: "", // what is actually drawing (shown in settings)
  stick: null as null | number[], // virtual joystick (mobile)
  stk: null as null | { cx: number; cy: number; ox: number; oy: number; sp: number }, // its drawn state (HUD px)
  perf: null as null | { fps: number; lvl: number; scale: number },
  onResize: null as null | (() => void),
  shake: null as null | ((a: number) => void),
  focus: 0, // which controller this screen follows (CT index)
  COMM: 1, // commentary captions
  INTRO: 1, // player introductions before the tip
  introDone: 0, // the intro sequence ran for this game (skip the small lineup card)
  VOICE: 1, // speak the commentary (browser text-to-speech)
  MUSIC: 1, // dynamic arena music
  RUMBLE: 1, // gamepad rumble
  CB: 0, // colorblind-safe meter colors
  BIGM: 0, // bigger shot meter
  AUTO: 0, // auto-release assist (hold & release style)
  focusP: () => P[(CT[V.focus] || CT[0] || { idx: 0 }).idx],
};
export const CAMN = ["Broadcast", "2K Style", "Baseline", "Player Lock"];
export const MN = ["Arrow 2", "Bar (feet)", "Bar (head)", "Ring"];

/** Project game coords to HUD pixels (960x540) for whichever renderer is active. */
export function pr(x: number, y: number, z = 0): number[] {
  if (!V.r3d) return [x + 10, 110 + y * 0.78 - z * 0.9];
  const w = W3(x, y, z);
  if (V.GL && V.GL.proj) return V.GL.proj(w[0], w[1], w[2]);
  const q = pj(w[0], w[1], w[2]);
  return [q[0], q[1]];
}
export const fmt = (s: number) => {
  s = Math.ceil((s * 720) / QTRLEN); // game seconds -> 12-minute broadcast clock at any quarter length
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

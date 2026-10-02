// Client-side view state shared by the renderers, HUD and input (not part of the simulation).
import { P, CT, W3 } from "../core/sim";
import { pj } from "./canvas";

export const V = {
  r3d: true, // renderer flag: three.js (true) or 2D canvas court
  GL: null as any, // three.js renderer handle (null = canvas fallback)
  CAMM: 0,
  QL: typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches ? 1 : 2,
  METER: 0,
  stick: null as null | number[], // virtual joystick (mobile)
  perf: null as null | { fps: number; lvl: number; scale: number },
  onResize: null as null | (() => void),
  focus: 0, // which controller this screen follows (CT index)
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
  s = Math.ceil(s * 12);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

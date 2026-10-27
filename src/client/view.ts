// Client-side view state shared by the renderers, HUD and input (not part of the simulation).
import { P, CT, W3, QTRLEN } from "../core/sim";
import { pj } from "./canvas";

/** Starting quality: High only on a GPU that can afford it. Integrated / mobile / software GPUs, Chromebooks and
 * 4-core machines start on Medium (High re-renders the scene for the floor mirror + SSAO + 4K shadows). */
function gpuTier(): number {
  try {
    if (typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches) return 1;
    if (typeof navigator !== "undefined" && (/CrOS/.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4)) return 1;
    const gl = typeof document !== "undefined" ? (document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null) : null;
    if (!gl) return 1;
    const ext = gl.getExtension("WEBGL_debug_renderer_info"),
      r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    (gl.getExtension("WEBGL_lose_context") as any)?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(r)) return 0;
    if (/intel|uhd|iris|hd graphics|mali|adreno|powervr|vivante|videocore|radeon\(tm\) (r\d|vega)|radeon graphics|vega \d/i.test(r)) return 1;
    return 2;
  } catch {
    return 1;
  }
}
const TIER = gpuTier();
export const V = {
  r3d: true, // renderer flag: three.js (true) or 2D canvas court
  GL: null as any, // three.js renderer handle (null = canvas fallback)
  CAMM: 0,
  QL: TIER,
  QAUTO: "", // set when the frame-rate guard lowered the quality this session (toast text)
  METER: 0,
  FX: !(typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches), // post-processing
  GPU: 0, // renderer: 0 WebGL, 1 WebGPU (beta; takes effect on the next start)
  backend: "", // what is actually drawing (shown in settings)
  stick: null as null | number[], // virtual joystick (mobile)
  stk: null as null | { cx: number; cy: number; ox: number; oy: number; sp: number }, // its drawn state (HUD px)
  perf: null as null | { fps: number; lvl: number; scale: number; hsr?: number; hs?: number; iw?: number; ih?: number; ow?: number; oh?: number; ms?: number },
  onResize: null as null | (() => void),
  shake: null as null | ((a: number) => void),
  focus: 0, // which controller this screen follows (CT index)
  COMM: 1, // commentary captions
  INTRO: 1, // player introductions before the tip
  introDone: 0, // the intro sequence ran for this game (skip the small lineup card)
  VOICE: 1, // speak the commentary (browser text-to-speech)
  ANNV: 2, // announcer voice: 2 AI (Piper voice bank, client/voice.ts; falls back to browser), 1 browser speech, 0 off
  MUSIC: 1, // dynamic arena music
  RUMBLE: 1, // gamepad rumble
  CB: 0, // meter palette (see THEME below)
  BIGM: 0, // bigger shot meter
  AUTO: 0, // auto-release assist (hold & release style)
  // H2K Super Resolution (render3d / fx3d / hsr.ts): 0 Off (native), 1 Auto (dynamic resolution), 2 Quality 67%,
  // 3 Balanced 58%, 4 Performance 50%, 5 Ultra Performance 33%. Default by GPU: discrete Off, integrated / Chromebook /
  // software Auto. HSRM upscaler: 0 auto (temporal; spatial on Low), 1 temporal, 2 spatial.
  HSR: TIER >= 2 ? 0 : 1,
  HSRM: 0,
  TFPS: 60, // dynamic-resolution target: 60 / 90 / 120 / 144 / 240, 0 = the display refresh ("Max")
  HZ: 0, // measured display refresh (rAF intervals); 0 = not measured yet
  FPSC: 0, // FPS counter on the HUD
  // UI v6 (ui/settings.ts; saved in h2k_set): menu theme 0 dark / 1 light / 2 auto, text size 0..2, reduce motion
  // (also no camera shake), high-contrast HUD, minimal HUD (score bug + meter only), sprint 0 hold / 1 toggle.
  // CB (above) = meter palette 0 standard, 1 red-green safe, 2 blue-yellow safe, 3 monochrome.
  THEME: 0,
  TXT: 0,
  RM: 0,
  HC: 0,
  MINHUD: 0,
  SPT: 0,
  // Graphics v6 (render3d / fx3d): preset (PRESETS below; -1 = custom), ambient occlusion -1 auto (QL >= 2 full res) /
  // 0 off / 1 half res / 2 full (N8AO), colour grade look (GRADES), street weather (WXN; "auto" = by the date + court)
  PRE: TIER >= 2 ? 2 : TIER === 1 ? 0 : -1,
  AO: -1,
  GRADE: 0,
  GRAIN: 1, // subtle film grain + vignette in the grade
  WX: "auto" as string,
  focusP: () => P[(CT[V.focus] || CT[0] || { idx: 0 }).idx],
};
/** Graphics levels (V.QL): Low / Medium / High / Ultra ("everything max": 4K soft shadows, full-res AO, live jumbotron). */
export const QLN = ["Low", "Medium", "High", "Ultra"];
/** One-click presets: [name, QL, HSR, AO, hint]. Chromebook = the old Medium (must never get slower). */
export const PRESETS: [string, number, number, number, string][] = [
  ["Chromebook", 1, 1, 0, "Medium graphics, auto resolution, no AO: smooth on integrated GPUs."],
  ["Balanced", 1, 1, 1, "Medium + half-res ambient occlusion."],
  ["High", 2, 0, 2, "Native resolution, full AO, floor mirror, 4K shadows."],
  ["Ultra", 3, 0, 2, "Everything max: softer 4K shadows, live jumbotron cam, more crowd, extra lights."],
];
export function applyPreset(i: number) {
  const p = PRESETS[i];
  if (!p) return;
  V.PRE = i;
  V.QL = p[1];
  V.HSR = p[2];
  V.AO = p[3];
  V.FX = true;
  V.QAUTO = "";
}
/** AO level in use: 0 off, 1 half res, 2 full res. */
export const aoLevel = () => (!V.FX || V.QL === 0 ? 0 : V.AO >= 0 ? V.AO : V.QL >= 2 ? 2 : 0);
/** Colour grade looks (fx3d GradeShader / fxgpu): name, saturation, contrast, vignette, warmth (-1 cool .. 1 warm). */
export const GRADES: [string, number, number, number, number][] = [
  ["Broadcast", 1.1, 1.07, 0.2, 0.15],
  ["Vivid", 1.24, 1.12, 0.22, 0.25],
  ["Film", 0.94, 1.1, 0.3, 0.35],
  ["Neutral", 1.0, 1.0, 0.1, 0],
];
/** Street weather / time of day (cfg.HALF courts). */
export const WXN = ["auto", "day", "sunset", "night", "rain", "snow"];
/** HSR mode names and fixed internal scales (index = V.HSR). */
export const HSRN = ["Off", "Auto", "Quality", "Balanced", "Performance", "Ultra Perf."];
export const HSRS = [1, 1, 0.67, 0.58, 0.5, 0.33];
/** Target frame time for dynamic resolution (ms): never faster than the display can show. */
export const targetMs = () => Math.max(V.TFPS ? 1000 / V.TFPS : 0, 1000 / (V.HZ || 60));
/** The upscaler HSR uses now: 0 none, 1 temporal, 2 spatial (Low tier / chosen). */
export const hsrMode = () => (!V.HSR ? 0 : V.HSRM === 2 || (V.HSRM === 0 && V.QL === 0) ? 2 : 1);
export const CAMN = ["Broadcast", "2K Style", "Baseline", "Player Lock"];
export const MN = ["Arrow 2", "Bar (feet)", "Bar (head)", "Ring"];
/** Shot meter palettes (V.CB): name, green window, fill inside the window, fill outside it, window band. Green stays
 *  at the TOP of every meter; only the colours change. */
export const PAL: { n: string; g: string; w: string; f: string; band: string }[] = [
  { n: "Standard", g: "#2ecc71", w: "#1fd6c0", f: "#f5c542", band: "rgba(46,204,113,.75)" },
  { n: "Red-green safe", g: "#4ea8ff", w: "#4ea8ff", f: "#ff9f1c", band: "rgba(78,168,255,.75)" },
  { n: "Blue-yellow safe", g: "#ff3da6", w: "#ff3da6", f: "#20c4c4", band: "rgba(255,61,166,.75)" },
  { n: "Monochrome", g: "#ffffff", w: "#ffffff", f: "#8a8a8a", band: "rgba(255,255,255,.85)" },
];

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

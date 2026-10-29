// Device probe at load: ~200 ms of the real 5v5 sim (CPU) + detect-gpu's benchmark tier (GPU, tables bundled - no
// CDN) -> default graphics preset for players who never picked one (ST.QPICK = 0). Crowd size follows the preset
// (render3d counts by V.QL) and so does LIFE's NPC count (world.ts: [6, 10, 14][QL]); `V.DEV.npc` is the suggested
// LIFE density multiplier for when LIFE reads it. Cached per GPU in localStorage h2k_probe (re-run: ?probe).
import * as SV from "./save";
import * as G from "../core/sim";
import { V, applyPreset } from "./view";
import { ST } from "./ui/settings";
import { gpuTierDetect } from "./gpudetect";
import { pickPreset } from "./probepick";
export { pickPreset };

export type Probe = { v: 1; cpuMs: number; gpuTier: number; gpu: string; type: string; preset: number; npc: number; at: number };

/** ms per 1/60 s sim tick of a 5v5 game (legacy ball physics: Rapier may not be loaded on the hub). */
export function cpuProbe(budgetMs = 200): number {
  const keep = { S: G.S, CT: G.CT, NP: G.cfg.NP, physics: G.cfg.physics, input: G.cfg.input };
  let ticks = 0,
    t0 = 0,
    el = 0;
  try {
    Object.assign(G.cfg, { NP: 5, physics: "legacy", input: () => ({ dx: 0, dy: 0 }) });
    G.setCtrls([]);
    G.start(0, { j: 1 });
    for (let i = 0; i < 20; i++) G.upd(1 / 60); // warm the JIT
    t0 = performance.now();
    while ((el = performance.now() - t0) < budgetMs && ticks < 4000) {
      G.upd(1 / 60);
      ticks++;
    }
  } catch (e) {
    return -1;
  } finally {
    G.FX.length = 0;
    Object.assign(G.cfg, { NP: keep.NP, physics: keep.physics, input: keep.input });
    G.setCtrls(keep.CT);
    G.setS(keep.S);
  }
  return ticks ? el / ticks : -1;
}
/** Run (or reuse) the probe and apply its preset when the player has not chosen graphics. */
export async function probeDevice(force = /[?&]probe\b/.test(location.search)): Promise<Probe | null> {
  let gpuName = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    gpuName = String(gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : "");
    (gl?.getExtension("WEBGL_lose_context") as any)?.loseContext();
  } catch {}
  let pr: Probe | null = null;
  try {
    const c: any = SV.get("h2k_probe", null);
    if (!force && c && c.v === 1 && c.gpu === gpuName && Date.now() - c.at < 30 * 864e5) pr = c;
  } catch {}
  if (!pr) {
    const cpuMs = cpuProbe(200);
    let tier = 0,
      type = "",
      mobile = false;
    try {
      const t = await gpuTierDetect();
      (tier = t.tier), (type = t.type), (mobile = !!t.isMobile);
    } catch {}
    const preset = pickPreset(cpuMs, tier, mobile);
    pr = { v: 1, cpuMs: +cpuMs.toFixed(3), gpuTier: tier, gpu: gpuName, type, preset, npc: cpuMs > 2.5 ? 0.6 : cpuMs > 1.4 ? 0.8 : 1, at: Date.now() };
    try {
      SV.set("h2k_probe", pr);
    } catch {}
  }
  (V as any).DEV = pr;
  if (!ST.QPICK && pr.preset >= 0 && G.S === "menu") applyPreset(pr.preset); // never mid-game
  return pr;
}

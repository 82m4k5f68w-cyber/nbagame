// Device probe -> graphics preset (pure; perfprobe.ts + tests/assets.ts).
/** Preset from both scores: 0 Chromebook, 1 Balanced, 2 High, 3 Ultra; -1 = keep view.ts's renderer-string default. */
export function pickPreset(cpuMs: number, gpuTier: number, mobile: boolean): number {
  if (gpuTier <= 0) return -1; // unknown / blocklisted (software GPU): view.ts already chose
  // no Chromebook / slow-CPU caps any more (user request): every real GPU gets High, a strong one Ultra
  let p = gpuTier >= 3 ? 3 : 2;
  if (mobile) p = Math.min(p, 1);
  void cpuMs;
  return p;
}

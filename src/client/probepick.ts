// Device probe -> graphics preset (pure; perfprobe.ts + tests/assets.ts).
/** Preset from both scores: 0 Chromebook, 1 Balanced, 2 High, 3 Ultra; -1 = keep view.ts's renderer-string default. */
export function pickPreset(cpuMs: number, gpuTier: number, mobile: boolean): number {
  if (gpuTier <= 0) return -1; // unknown / blocklisted (software GPU): view.ts already chose
  let p = gpuTier >= 3 ? 3 : gpuTier === 2 ? 2 : 0;
  if (mobile) p = Math.min(p, 1);
  if (cpuMs > 2.5) p = Math.min(p, 0); // slow CPU: the sim + crowd animation would eat the frame
  else if (cpuMs > 1.4) p = Math.min(p, 1);
  else if (p === 3 && cpuMs > 0.9) p = 2;
  return p;
}

// Small deterministic helpers shared by the LIFE modules (DOM-free: Node tests import them).

/** 32-bit string hash (FNV-1a). */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export type Rng = () => number;
/** mulberry32: a seeded uniform [0, 1) generator. */
export function mkRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
export const rint = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export function shuffle<T>(r: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

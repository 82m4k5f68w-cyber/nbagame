// LIFE <-> Claude: the claude.ai artifact `sample` capability (published page only). `await claude.use("sample")`
// resolves null where it can't run (plain file, tests, declined) - every caller has a procedural fallback, so the
// mode never depends on it. Calls happen only on a user action (class start, opening Hoopr, posting, after a game),
// are cached per key, time out, and back off after a rate limit or refusal.
type SampleFn = ((input: any, opts?: any) => Promise<{ text: string }>) & { json: (input: any, opts?: any) => Promise<any> };
let S: SampleFn | null | undefined; // undefined = not looked up yet
let look: Promise<SampleFn | null> | null = null;
let offUntil = 0,
  denied = false;
const CACHE = new Map<string, any>();
export const AI = { on: 1, last: "" as string, calls: 0 };

/** The sample function or null (cached; resolves within ~10 s at most). */
export function sampleFn(): Promise<SampleFn | null> {
  if (S !== undefined) return Promise.resolve(S);
  if (look) return look;
  const c = (globalThis as any).claude;
  if (!c || typeof c.use !== "function") return Promise.resolve((S = null));
  look = Promise.race([Promise.resolve(c.use("sample")).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 10000))]).then((f) => (S = (f as SampleFn) || null));
  return look;
}
/** Is the AI path usable right now (setting on, capability present, not backing off)? */
export async function aiReady(): Promise<boolean> {
  if (!AI.on || denied || Date.now() < offUntil) return false;
  return !!(await sampleFn());
}
/** sample.json with a cache key, a timeout and error bookkeeping. Returns null on any failure (callers fall back). */
export async function askJSON(key: string, prompt: string, ms = 45000): Promise<any> {
  if (CACHE.has(key)) return CACHE.get(key);
  if (!(await aiReady())) return null;
  const ctl = new AbortController(),
    to = setTimeout(() => ctl.abort(), ms);
  try {
    AI.calls++;
    const x = await S!.json(prompt, { signal: ctl.signal, modelTier: "quick" });
    CACHE.set(key, x);
    if (CACHE.size > 60) CACHE.delete(CACHE.keys().next().value as string);
    AI.last = "ok";
    return x;
  } catch (e: any) {
    const code = (e && e.code) || "error";
    AI.last = code;
    if (code === "not_granted") denied = true;
    else if (code === "rate_limited") offUntil = Date.now() + 90_000;
    else if (code !== "cancelled") offUntil = Date.now() + 20_000;
    return null;
  } finally {
    clearTimeout(to);
  }
}
/** Tests: inject a stand-in sample function (or null). */
export function _setSample(f: SampleFn | null) {
  S = f;
  look = null;
  denied = false;
  offUntil = 0;
  CACHE.clear();
}

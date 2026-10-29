// Save system: ONE module for every piece of persistent data (LIFE slots, My Player + career, record vs the CPU,
// Season, mode bests, settings, key map). DOM-free core (tests/save.ts runs it in Node with a fake store / fake db).
//
// Layout in localStorage:
//   h2k_sv                index  {v, dev, recs: {id: Meta}, bk: {id: BMeta[]}, base: {id: cloud sum}, last}
//   h2k_sv_<id>           record envelope "H2K1|<codec>|<sum>|<t>|<payload>" (sum = FNV-1a of the JSON + its length)
//   h2k_sv_<id>~<k>       rolling backups of that record (newest MAX_BK kept, each with its own checksum)
//   h2k_sv_<id>#th        thumbnail (small webp/jpeg data URL)
//   h2k_myp, h2k_rec ...  the game's live keys stay plain JSON (the Unity page and old builds read the same shape);
//                         they are snapshotted into the record "game" (sync codec, so a damaged key is restored
//                         synchronously from it by get()).
// Records: "life0".."life5" (LIFE saves; written async with deflate-raw), "game" (bundle of the live keys).
// Codecs: j = plain JSON (tiny), d = deflate-raw (CompressionStream) + base64, l = sync LZW packed 15 bits per char
// (fallback without CompressionStream, and the unload flush). Quota errors prune the oldest backups, then thumbnails.
// Cloud: artifact `db` + `user` capabilities, docs data/users/<id>/<rec> (private per viewer), three-way sync on the
// checksum (base = sum at the last sync): one side changed -> push / pull, both changed -> conflict (UI asks; the
// newer timestamp is the default). Everything works offline (db null).

export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key?(i: number): string | null; readonly length?: number };
export type Kind = "life" | "game";
/** What a slot card shows (kept in the index; also embedded in the record so a lost index can be rebuilt). */
export type Meta = {
  id: string;
  kind: Kind;
  name: string;
  sub?: string; // stage line ("College Y2 · State U")
  stage?: string;
  day?: number;
  rec?: string; // "12-3"
  money?: number;
  pt?: number; // playtime, s
  t: number; // saved at (ms)
  sum: string;
  sz: number; // stored chars
  dev: string; // device that saved it
};
export type BMeta = { k: number; t: number; sum: string; sz: number; m: Partial<Meta> };
type Idx = { v: 1; dev: string; recs: Record<string, Meta>; bk: Record<string, BMeta[]>; base: Record<string, string>; last?: string; mig?: number; n: number };
export type Ev = { k: "saving" | "saved" | "error" | "recovered" | "quota" | "cloud" | "changed" | "conflict"; id?: string; msg?: string; t?: number };

export const MAX_BK = 4; // rolling backups per record
export const BK_GAP = 120e3; // a new backup at most every 2 min (or on a milestone)
export const LIFE_SLOTS = 6;
const PFX = "h2k_sv";
const IDXK = PFX;
const recK = (id: string) => PFX + "_" + id;
const bkK = (id: string, k: number) => PFX + "_" + id + "~" + k;
const thK = (id: string) => PFX + "_" + id + "#th";
/** The game's live keys that belong to the "game" record (prefix match for h2k_season_<np>). */
export const GAME_KEYS = ["h2k_myp", "h2k_rec", "h2k_set", "h2k_keys", "h2k_lastplay", "h2k_3pt", "h2k_king", "h2k_daily", "h2k_cc", "h2k_name", "h2k_elo", "h2k_elo_g"];
const GAME_PFX = ["h2k_season_"];
const RAW_KEYS = ["h2k_name", "h2k_elo_g"]; // plain strings, not JSON
const okJSON = (v: string) => {
  try {
    JSON.parse(v);
    return true;
  } catch (e) {
    return false;
  }
};
export const isGameKey = (k: string) => GAME_KEYS.includes(k) || GAME_PFX.some((p) => k.startsWith(p));

// ---------------------------------------------------------------- store
const memStore = (): Store => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};
function defStore(): Store {
  try {
    const ls = (globalThis as any).localStorage as Storage;
    const k = "__h2k_t";
    ls.setItem(k, "1");
    ls.removeItem(k);
    return ls;
  } catch (e) {
    return memStore();
  }
}
let st: Store | null = null;
const S = () => (st ||= defStore());
function keys(): string[] {
  const s = S(),
    out: string[] = [];
  const n = (s as any).length ?? 0;
  for (let i = 0; i < n; i++) {
    const k = s.key ? s.key(i) : null;
    if (k) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------- events
const LIS = new Set<(e: Ev) => void>();
export function onSave(f: (e: Ev) => void) {
  LIS.add(f);
  return () => void LIS.delete(f);
}
function emit(e: Ev) {
  for (const f of LIS)
    try {
      f(e);
    } catch (x) {}
}

// ---------------------------------------------------------------- checksum + codecs
/** FNV-1a 32 over UTF-16 code units, hex, plus the length (cheap and catches truncation). */
export function cks(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(36);
}
/** Sync LZW (dictionary grows from literals, code 0 = 16-bit literal, 1 = end), bits packed 15 per char + 32 so the
 * output is plain BMP text (no surrogates / control chars): safe in localStorage and JSON. */
export function lzc(s: string): string {
  const dict = new Map<string, number>();
  let next = 2,
    w = "",
    acc = 0,
    nb = 0,
    out = "";
  const put = (v: number, bits: number) => {
    for (let i = 0; i < bits; i++) {
      acc = (acc << 1) | ((v >>> i) & 1);
      if (++nb === 15) (out += String.fromCharCode(acc + 32)), (acc = 0), (nb = 0);
    }
  };
  const W = () => 32 - Math.clz32(next);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!dict.has(c)) {
      if (w) put(dict.get(w)!, W()), dict.set(w + c, next++), (w = "");
      put(0, W());
      put(c.charCodeAt(0), 16);
      dict.set(c, next++);
      continue;
    }
    const wc = w + c;
    if (dict.has(wc)) w = wc;
    else put(dict.get(w)!, W()), dict.set(wc, next++), (w = c);
  }
  if (w) put(dict.get(w)!, W()), next++;
  put(1, W());
  if (nb) out += String.fromCharCode((acc << (15 - nb)) + 32);
  return out;
}
export function lzd(z: string): string | null {
  let pos = 0,
    cur = 0,
    left = 0;
  const bit = () => {
    if (!left) {
      if (pos >= z.length) throw 0;
      cur = z.charCodeAt(pos++) - 32;
      left = 15;
    }
    left--;
    return (cur >>> left) & 1;
  };
  const get = (bits: number) => {
    let v = 0;
    for (let i = 0; i < bits; i++) v |= bit() << i;
    return v;
  };
  try {
    const dict: string[] = [];
    let next = 2,
      prev: string | null = null;
    const out: string[] = [];
    for (;;) {
      const code = get(32 - Math.clz32(next + (prev !== null ? 1 : 0)));
      if (code === 1) break;
      if (code === 0) {
        const ch = String.fromCharCode(get(16));
        if (prev !== null) dict[next++] = prev + ch;
        dict[next++] = ch;
        out.push(ch);
        prev = null;
        continue;
      }
      let e: string;
      if (dict[code] !== undefined) e = dict[code];
      else if (prev !== null && code === next) e = prev + prev[0];
      else return null;
      out.push(e);
      if (prev !== null) dict[next++] = prev + e[0];
      prev = e;
    }
    return out.join("");
  } catch (e) {
    return null;
  }
}
const hasCS = () => typeof (globalThis as any).CompressionStream === "function" && typeof (globalThis as any).Response === "function" && typeof (globalThis as any).Blob === "function";
function b64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000) as any);
  return btoa(s);
}
function unb64(s: string) {
  const b = atob(s),
    u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
async function pipe(data: BlobPart, t: any) {
  const G = globalThis as any;
  return new Uint8Array(await new G.Response(new G.Blob([data]).stream().pipeThrough(t)).arrayBuffer());
}
export async function deflate(s: string): Promise<string | null> {
  if (!hasCS()) return null;
  try {
    return b64(await pipe(s, new (globalThis as any).CompressionStream("deflate-raw")));
  } catch (e) {
    return null;
  }
}
export async function inflate(b: string): Promise<string | null> {
  try {
    const u = await pipe(unb64(b) as any, new (globalThis as any).DecompressionStream("deflate-raw"));
    return new TextDecoder().decode(u);
  } catch (e) {
    return null;
  }
}
type Env = { c: string; sum: string; t: number; p: string };
function parseEnv(s: string | null): Env | null {
  if (!s || !s.startsWith("H2K1|")) return null;
  const a = s.indexOf("|", 5),
    b = s.indexOf("|", a + 1),
    c = s.indexOf("|", b + 1);
  if (a < 0 || b < 0 || c < 0) return null;
  const t = +s.slice(b + 1, c);
  if (!isFinite(t)) return null;
  return { c: s.slice(5, a), sum: s.slice(a + 1, b), t, p: s.slice(c + 1) };
}
const mkEnv = (c: string, sum: string, t: number, p: string) => `H2K1|${c}|${sum}|${t}|${p}`;
/** Encode JSON text into an envelope. sync: never uses CompressionStream (unload flush, the game record). */
export async function encode(json: string, t: number, sync = false): Promise<string> {
  const sum = cks(json);
  if (json.length < 400) return mkEnv("j", sum, t, json);
  if (!sync) {
    const d = await deflate(json);
    if (d != null) return mkEnv("d", sum, t, d);
  }
  return mkEnv("l", sum, t, lzc(json));
}
export function encodeSync(json: string, t: number): string {
  const sum = cks(json);
  return json.length < 400 ? mkEnv("j", sum, t, json) : mkEnv("l", sum, t, lzc(json));
}
/** Decode + verify an envelope: null when damaged (bad header, codec failure, checksum mismatch). */
export async function decode(s: string | null): Promise<{ json: string; t: number; sum: string } | null> {
  const e = parseEnv(s);
  if (!e) return null;
  const json = e.c === "j" ? e.p : e.c === "l" ? lzd(e.p) : e.c === "d" ? await inflate(e.p) : null;
  if (json == null || cks(json) !== e.sum) return null;
  return { json, t: e.t, sum: e.sum };
}
export function decodeSync(s: string | null): { json: string; t: number; sum: string } | null {
  const e = parseEnv(s);
  if (!e || e.c === "d") return null;
  const json = e.c === "j" ? e.p : lzd(e.p);
  if (json == null || cks(json) !== e.sum) return null;
  return { json, t: e.t, sum: e.sum };
}

// ---------------------------------------------------------------- quota-safe writes
const isQuota = (e: any) => !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || e)));
/** setItem with quota handling: prune the oldest backups (any record, keeping one each), then the rest, then
 * thumbnails, retrying after every step. false = still full (the caller keeps the data in memory). */
function wr(k: string, v: string): boolean {
  for (let step = 0; step < 64; step++) {
    try {
      S().setItem(k, v);
      return true;
    } catch (e) {
      if (!isQuota(e)) {
        emit({ k: "error", msg: String((e as any)?.message || e) });
        return false;
      }
      if (!prune(k)) {
        emit({ k: "quota", msg: "Storage is full: export your saves (Saves -> Export all) and delete old slots." });
        return false;
      }
    }
  }
  return false;
}
/** Free one thing. Order: the oldest backup of a record that has 2+, then any oldest backup, then a thumbnail. */
function prune(keep: string): boolean {
  const ix = idx();
  let best: { id: string; b: BMeta } | null = null;
  for (const pass of [2, 1])
    if (!best)
      for (const id in ix.bk) {
        const l = ix.bk[id];
        if (l.length >= pass) {
          const o = l[0];
          if (!best || o.t < best.b.t) best = { id, b: o };
        }
      }
  if (best) {
    S().removeItem(bkK(best.id, best.b.k));
    ix.bk[best.id] = ix.bk[best.id].filter((x) => x !== best!.b);
    saveIdx();
    return true;
  }
  for (const id in ix.recs)
    if (thK(id) !== keep && S().getItem(thK(id)) != null) {
      S().removeItem(thK(id));
      return true;
    }
  return false;
}

// ---------------------------------------------------------------- index
let IX: Idx | null = null;
const rid = () => Math.random().toString(36).slice(2, 10);
function blankIdx(): Idx {
  return { v: 1, dev: rid(), recs: {}, bk: {}, base: {}, n: 0 };
}
function idx(): Idx {
  if (IX) return IX;
  let o: any = null;
  const raw = S().getItem(IDXK);
  try {
    o = raw ? JSON.parse(raw) : null;
  } catch (e) {}
  if (o && typeof o === "object" && o.recs && o.bk) IX = { ...blankIdx(), ...o, base: o.base || {} } as Idx;
  else {
    IX = blankIdx();
    if (raw) rebuildSync(IX); // damaged index: rebuild from the records themselves
  }
  return IX!;
}
function saveIdx() {
  if (!IX) return;
  try {
    S().setItem(IDXK, JSON.stringify(IX));
  } catch (e) {
    // the index is small: if even it doesn't fit, prune and retry once
    if (isQuota(e) && prune(IDXK))
      try {
        S().setItem(IDXK, JSON.stringify(IX));
      } catch (x) {}
  }
}
/** Rebuild the index from h2k_sv_* keys (headers only; card details come back as each record is decoded). */
function rebuildSync(ix: Idx) {
  for (const k of keys()) {
    const m = /^h2k_sv_([a-z0-9]+)(?:~(\d+))?$/.exec(k);
    if (!m) continue;
    const e = parseEnv(S().getItem(k));
    if (!e) continue;
    const id = m[1];
    const base: Meta = { id, kind: id === "game" ? "game" : "life", name: id === "game" ? "Game data" : "Recovered save", t: e.t, sum: e.sum, sz: e.p.length, dev: ix.dev };
    if (m[2] != null) (ix.bk[id] ||= []).push({ k: +m[2], t: e.t, sum: e.sum, sz: e.p.length, m: {} }), (ix.n = Math.max(ix.n, +m[2] + 1));
    else ix.recs[id] = base;
    if (e.c !== "d") {
      const d = decodeSync(S().getItem(k));
      if (d)
        try {
          const w = JSON.parse(d.json);
          if (w && w.m) m[2] == null ? Object.assign(ix.recs[id], w.m, { t: e.t, sum: e.sum }) : Object.assign(ix.bk[id].slice(-1)[0].m, w.m);
        } catch (x) {}
    }
  }
  for (const id in ix.bk) ix.bk[id].sort((a, b) => a.t - b.t);
  emit({ k: "recovered", id: "index", msg: "Save index rebuilt" });
}

// ---------------------------------------------------------------- records
export function list(kind?: Kind): Meta[] {
  const r = Object.values(idx().recs);
  return (kind ? r.filter((m) => m.kind === kind) : r).sort((a, b) => a.id.localeCompare(b.id));
}
export const meta = (id: string): Meta | null => idx().recs[id] || null;
export const backups = (id: string): BMeta[] => [...(idx().bk[id] || [])].sort((a, b) => b.t - a.t);
export const lastId = () => idx().last || null;
export const device = () => idx().dev;
export const thumb = (id: string) => S().getItem(thK(id));
export function setThumb(id: string, url: string | null) {
  if (!url) return void S().removeItem(thK(id));
  if (url.length > 60000) return; // keep thumbnails tiny
  wr(thK(id), url);
}

type Pending = { json: string; m: Partial<Meta>; t: number; ms: boolean };
const PEND = new Map<string, Pending>();
const CHAIN = new Map<string, Promise<any>>();
const clean = (m: Partial<Meta>) => {
  const o: any = {};
  for (const k of ["name", "sub", "stage", "day", "rec", "money", "pt", "kind"]) if ((m as any)[k] != null) o[k] = (m as any)[k];
  return o as Partial<Meta>;
};
/** Write an envelope as the record's main copy: rotate the old main into the backup ring first (once per BK_GAP or on a
 * milestone), then update the index. */
function commit(id: string, env: string, m: Partial<Meta>, t: number, ms: boolean, src = "save"): boolean {
  const ix = idx();
  const e = parseEnv(env)!;
  const old = S().getItem(recK(id)),
    oe = parseEnv(old),
    cur = ix.recs[id];
  const bl = (ix.bk[id] ||= []);
  const lastB = bl.length ? bl[bl.length - 1].t : 0;
  if (oe && oe.sum !== e.sum && (ms || oe.t - lastB >= BK_GAP || !bl.length)) {
    const k = ix.n++;
    if (wr(bkK(id, k), old!)) {
      bl.push({ k, t: oe.t, sum: oe.sum, sz: old!.length, m: cur ? clean(cur) : {} });
      while (bl.length > MAX_BK) S().removeItem(bkK(id, bl.shift()!.k));
    }
  }
  const mm: Meta = { ...(cur || {}), ...clean(m), id, kind: (m.kind || cur?.kind || (id === "game" ? "game" : "life")) as Kind, name: m.name || cur?.name || id, t, sum: e.sum, sz: env.length, dev: ix.dev } as Meta;
  ix.recs[id] = mm;
  if (mm.kind === "life") ix.last = id;
  if (!wr(recK(id), env)) {
    // could not store it even after pruning: keep the index pointing at what is really on disk
    if (cur) ix.recs[id] = cur;
    else delete ix.recs[id];
    saveIdx();
    emit({ k: "error", id, msg: "Could not save (storage full)" });
    return false;
  }
  saveIdx();
  emit({ k: "saved", id, t, msg: src });
  cloudLater(id);
  return true;
}
/** Save a record. The JSON is taken NOW (later edits to `data` don't leak in); compression runs async, one write per
 * record at a time. Returns false when nothing could be stored. Unchanged data is a no-op. */
export function put(id: string, data: any, m: Partial<Meta> = {}, o: { milestone?: boolean; sync?: boolean; t?: number } = {}): Promise<boolean> {
  const json = JSON.stringify({ m: clean(m), d: data });
  const t = o.t ?? Date.now();
  const cur = idx().recs[id];
  if (cur && cur.sum === cks(json) && !o.milestone && !PEND.has(id)) return Promise.resolve(true);
  if (o.sync) {
    PEND.delete(id);
    return Promise.resolve(commit(id, encodeSync(json, t), m, t, !!o.milestone));
  }
  const p: Pending = { json, m, t, ms: !!o.milestone };
  PEND.set(id, p);
  emit({ k: "saving", id });
  const run = async () => {
    if (PEND.get(id) !== p) return true; // a newer save superseded this one (or the unload flush wrote it)
    const env = await encode(json, t);
    if (PEND.get(id) !== p) return true;
    PEND.delete(id);
    return commit(id, env, m, t, p.ms);
  };
  const ch = (CHAIN.get(id) || Promise.resolve()).then(run, run);
  CHAIN.set(id, ch);
  return ch;
}
/** Write every pending async save synchronously (page hide / unload). */
export function flush() {
  for (const [id, p] of [...PEND]) {
    PEND.delete(id);
    commit(id, encodeSync(p.json, p.t), p.m, p.t, p.ms, "flush");
  }
}
/** Wait for queued writes (tests, export). */
export async function settle() {
  await Promise.all([...CHAIN.values()]);
}
async function unwrap(s: string | null) {
  const d = await decode(s);
  if (!d) return null;
  try {
    const w = JSON.parse(d.json);
    return { w, t: d.t, sum: d.sum };
  } catch (e) {
    return null;
  }
}
/** Load a record's data. A damaged main copy is replaced by the newest backup that verifies (event "recovered"). */
export async function load(id: string): Promise<any | null> {
  const p = PEND.get(id);
  if (p) return JSON.parse(p.json).d;
  const ix = idx();
  const main = S().getItem(recK(id));
  const u = await unwrap(main);
  if (u) {
    const cur = ix.recs[id];
    if (!cur || cur.sum !== u.sum) (ix.recs[id] = { ...(cur || {}), ...clean(u.w.m || {}), id, kind: id === "game" ? "game" : "life", name: u.w.m?.name || cur?.name || id, t: u.t, sum: u.sum, sz: main!.length, dev: cur?.dev || ix.dev } as Meta), saveIdx();
    return u.w.d;
  }
  if (main == null && !ix.recs[id] && !(ix.bk[id] || []).length) return null;
  return recover(id);
}
/** Restore the newest good backup as the main copy. */
async function recover(id: string): Promise<any | null> {
  const ix = idx();
  for (const b of backups(id)) {
    const raw = S().getItem(bkK(id, b.k));
    const u = await unwrap(raw);
    if (!u) continue;
    wr(recK(id), raw!);
    ix.recs[id] = { ...(ix.recs[id] || {}), ...clean(u.w.m || b.m), id, kind: id === "game" ? "game" : "life", name: u.w.m?.name || b.m.name || id, t: u.t, sum: u.sum, sz: raw!.length, dev: ix.dev } as Meta;
    saveIdx();
    emit({ k: "recovered", id, t: u.t, msg: `${ix.recs[id].name}: the save was damaged - restored the backup from ${when(u.t)}` });
    return u.w.d;
  }
  emit({ k: "error", id, msg: "Save damaged and no good backup" });
  return null;
}
/** Restore a specific backup (UI "Restore backup"): the current main becomes a backup itself, so this can be undone. */
export async function restore(id: string, k: number): Promise<boolean> {
  const raw = S().getItem(bkK(id, k));
  const u = await unwrap(raw);
  if (!u) return false;
  const ok = commit(id, raw!, u.w.m || {}, u.t, true, "restore");
  if (ok && id === "game") applyGame(u.w.d);
  return ok;
}
export function remove(id: string) {
  const ix = idx();
  S().removeItem(recK(id));
  S().removeItem(thK(id));
  for (const b of ix.bk[id] || []) S().removeItem(bkK(id, b.k));
  delete ix.recs[id];
  delete ix.bk[id];
  if (ix.last === id) delete ix.last;
  PEND.delete(id);
  saveIdx();
  cloudDelete(id);
  emit({ k: "changed", id });
}
/** Damage a record on purpose (tests / the browser recovery check). */
export function corrupt(id: string) {
  const s = S().getItem(recK(id));
  if (s) S().setItem(recK(id), s.slice(0, Math.max(20, (s.length * 0.6) | 0)) + "#garbage");
}
export function when(t: number) {
  const d = new Date(t);
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------- the game's live keys (plain JSON, Unity-compatible)
let gameT: any = 0;
/** Read a live key as JSON. A damaged value is restored from the "game" record (or its backups) at once. */
export function get<T = any>(k: string, def: T): T {
  const raw = S().getItem(k);
  if (raw == null || raw === "") return def;
  try {
    const v = JSON.parse(raw);
    return v ?? def;
  } catch (e) {
    const fix = recoverKey(k);
    if (fix != null)
      try {
        return JSON.parse(fix) ?? def;
      } catch (x) {}
    return def;
  }
}
export const getRaw = (k: string) => S().getItem(k);
export function set(k: string, v: any) {
  setRaw(k, JSON.stringify(v));
}
export function setRaw(k: string, v: string) {
  wr(k, v);
  if (isGameKey(k)) gameLater();
}
export function del(k: string) {
  S().removeItem(k);
  if (isGameKey(k)) gameLater();
}
function gameLater() {
  clearTimeout(gameT);
  gameT = setTimeout(() => snapGame(), 3000);
}
function recoverKey(k: string): string | null {
  const ix = idx();
  const cands = [S().getItem(recK("game")), ...backups("game").map((b) => S().getItem(bkK("game", b.k)))];
  for (const raw of cands) {
    const d = decodeSync(raw);
    if (!d) continue;
    try {
      const v = JSON.parse(d.json).d?.keys?.[k];
      if (v == null) continue;
      if (!RAW_KEYS.includes(k)) JSON.parse(v);
      wr(k, v);
      emit({ k: "recovered", id: "game", t: d.t, msg: `${keyName(k)} was damaged - restored from the backup of ${when(d.t)}` });
      return v;
    } catch (e) {}
  }
  void ix;
  return null;
}
const keyName = (k: string) => (({ h2k_myp: "My Player", h2k_rec: "Your record", h2k_set: "Settings", h2k_keys: "Key bindings" }) as any)[k] || (k.startsWith("h2k_season_") ? "Season" : k);
/** Every live game key, raw (during a LIFE game h2k_myp holds the LIFE player: the real one is in h2k_myp_bak). */
export function gameKeys(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of keys())
    if (isGameKey(k)) {
      const v = S().getItem(k)!;
      if (RAW_KEYS.includes(k) || okJSON(v)) o[k] = v; // never snapshot a damaged value over a good backup
    }
  const bak = S().getItem("h2k_myp_bak");
  if (bak != null) bak ? (o.h2k_myp = bak) : delete o.h2k_myp;
  return o;
}
export function gameMeta(ks: Record<string, string>): Partial<Meta> {
  const j = (k: string) => {
    try {
      return JSON.parse(ks[k] || "null");
    } catch (e) {
      return null;
    }
  };
  const my = j("h2k_myp"),
    rc = j("h2k_rec") || {};
  const seasons = Object.keys(ks).filter((k) => k.startsWith("h2k_season_")).length;
  return { kind: "game", name: my && my.n ? my.n : "Game data", rec: `${rc.w || 0}-${rc.l || 0}`, sub: [my && my.lv ? "LV " + my.lv : "", seasons ? seasons + " season" + (seasons > 1 ? "s" : "") : "", ks.h2k_set ? "settings" : ""].filter(Boolean).join(" · ") };
}
/** Snapshot the live keys into the "game" record (sync codec: get() can restore a key synchronously). */
export function snapGame(o: { milestone?: boolean } = {}) {
  clearTimeout(gameT);
  const ks = gameKeys();
  if (!Object.keys(ks).length) return Promise.resolve(false);
  return put("game", { keys: ks }, gameMeta(ks), { sync: true, milestone: o.milestone });
}
/** Write a game bundle back to the live keys (restore / import / cloud pull). */
export function applyGame(d: any) {
  if (!d || !d.keys) return;
  for (const k of keys()) if (isGameKey(k) && !(k in d.keys)) S().removeItem(k);
  for (const [k, v] of Object.entries(d.keys)) if (isGameKey(k) && typeof v === "string") wr(k, v);
  if (S().getItem("h2k_myp_bak") != null && d.keys.h2k_myp) wr("h2k_myp_bak", d.keys.h2k_myp as string);
  emit({ k: "changed", id: "game" });
}

// ---------------------------------------------------------------- LIFE helpers (state.ts stays DOM-free and unaware)
export const lifeId = (slot: number) => "life" + slot;
/** One-time lossless migration of the old formats; idempotent. Old LIFE keys h2k_life_<n> are converted, verified
 * by reading them back, and only then removed. */
export function migrate(): number {
  const ix = idx();
  let n = 0;
  for (let s = 0; s < 10; s++) {
    const k = "h2k_life_" + s,
      raw = S().getItem(k);
    if (raw == null) continue;
    let o: any = null;
    try {
      o = JSON.parse(raw);
    } catch (e) {}
    if (!o || typeof o.t !== "number") continue; // not a save: leave it alone
    const id = lifeId(s);
    if (ix.recs[id]) {
      S().removeItem(k);
      continue;
    }
    o.slot = s;
    const json = JSON.stringify({ m: lifeMeta(o), d: o });
    const env = encodeSync(json, Date.now());
    if (!commit(id, env, lifeMeta(o), Date.now(), true, "migrate")) continue;
    const back = decodeSync(S().getItem(recK(id)));
    if (back && JSON.parse(back.json).d.t === o.t) S().removeItem(k), n++;
  }
  const last = S().getItem("h2k_life");
  if (last != null && /^\d+$/.test(last)) {
    if (ix.recs[lifeId(+last)]) ix.last = lifeId(+last);
    S().removeItem("h2k_life");
  }
  if (!ix.mig) ix.mig = 1;
  saveIdx();
  snapGame();
  return n;
}
const STAGE_N: Record<string, string> = { hs: "High School", college: "College", draft: "Draft", nba: "NBA" };
/** Card fields from a LIFE save object (duck-typed: no import of state.ts). */
export function lifeMeta(L: any): Partial<Meta> {
  const st = String(L.stage || "hs");
  return {
    kind: "life",
    name: (L.p && L.p.n) || "Player",
    stage: st,
    sub: (STAGE_N[st] || st) + (st === "college" ? " Y" + L.yr : st === "nba" ? " S" + L.yr : "") + (L.team && L.team.name ? " · " + L.team.name : ""),
    day: Math.floor((L.t || 0) / 1440) + 1,
    rec: L.team ? `${L.team.w || 0}-${L.team.l || 0}` : "",
    money: Math.round(L.money || 0),
    pt: Math.round(L.pt || 0),
  };
}

// ---------------------------------------------------------------- export / import
export type Bundle = { h2k: "saves"; v: 1; at: number; dev: string; recs: Record<string, { m: Meta; env: string; th?: string | null }> };
/** Everything (every record + its card + thumbnail, the live game keys snapshotted first) as one JSON text. */
export async function exportAll(): Promise<string> {
  flush();
  await settle();
  snapGame();
  const ix = idx(),
    recs: Bundle["recs"] = {};
  for (const id in ix.recs) {
    const env = S().getItem(recK(id));
    if (env && (await decode(env))) recs[id] = { m: ix.recs[id], env, th: thumb(id) };
  }
  return JSON.stringify({ h2k: "saves", v: 1, at: Date.now(), dev: ix.dev, recs } as Bundle);
}
export async function exportOne(id: string): Promise<string | null> {
  flush();
  await settle();
  if (id === "game") snapGame();
  const env = S().getItem(recK(id)),
    m = meta(id);
  if (!env || !m || !(await decode(env))) return null;
  return JSON.stringify({ h2k: "saves", v: 1, at: Date.now(), dev: device(), recs: { [id]: { m, env, th: thumb(id) } } } as Bundle);
}
/** Import a file: a bundle (all or one record) or an old plain LIFE save (JSON with t/p/cal) -> first free slot.
 * Records already present are kept as backups (the import is a milestone save on top), so nothing is lost. */
export async function importText(text: string, o: { slot?: number } = {}): Promise<{ ok: number; bad: number; ids: string[] }> {
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch (e) {}
  const res = { ok: 0, bad: 0, ids: [] as string[] };
  if (!j || typeof j !== "object") return (res.bad = 1), res;
  if (j.h2k === "saves" && j.recs) {
    for (const [id0, r] of Object.entries<any>(j.recs)) {
      const u = await unwrap(r.env);
      if (!u || !/^(game|life\d)$/.test(id0)) {
        res.bad++;
        continue;
      }
      let id = id0;
      if (id.startsWith("life") && o.slot != null && Object.keys(j.recs).length === 1) id = lifeId(o.slot);
      if (id.startsWith("life")) u.w.d.slot = +id.slice(4);
      if (commit(id, encodeSync(JSON.stringify(u.w), u.t), u.w.m || {}, u.t, true, "import")) {
        if (r.th) setThumb(id, r.th);
        if (id === "game") applyGame(u.w.d);
        res.ok++, res.ids.push(id);
      } else res.bad++;
    }
    return res;
  }
  if (typeof j.t === "number" && j.p && Array.isArray(j.cal)) {
    const slot = o.slot ?? freeSlot();
    if (slot < 0) return (res.bad = 1), res;
    j.slot = slot;
    if (await put(lifeId(slot), j, lifeMeta(j), { milestone: true })) res.ok = 1, res.ids.push(lifeId(slot));
    else res.bad = 1;
    return res;
  }
  res.bad = 1;
  return res;
}
export function freeSlot() {
  for (let s = 0; s < LIFE_SLOTS; s++) if (!meta(lifeId(s))) return s;
  return -1;
}

// ---------------------------------------------------------------- cloud (artifact db + user, data/users/<id>/<rec>)
export type CloudDoc = { m: Meta; t: number; sum: string; dev: string; n: number; z?: string; th?: string };
export type Conflict = { id: string; local: Meta; cloud: CloudDoc };
const CHUNK = 60000; // chars per document part (UTF-8 worst case stays well under 256 KiB)
export const CLOUD = { on: false, state: "off" as "off" | "idle" | "busy" | "error", at: 0, err: "", conflicts: [] as Conflict[] };
let cdb: any = null,
  uid: string | null = null;
const cq = new Map<string, any>();
/** Hook up the cloud. Pass a db + user id (tests) or nothing to ask the artifact runtime (null off claude.ai). */
export async function cloudInit(o: { db?: any; uid?: string | null } = {}): Promise<boolean> {
  try {
    if (o.db !== undefined) (cdb = o.db), (uid = o.uid ?? null);
    else {
      const c = (globalThis as any).claude;
      if (!c || typeof c.use !== "function") return false;
      const to = <T>(p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      cdb = await to(c.use("db").catch(() => null));
      const u: any = cdb ? await to(c.use("user").catch(() => null)) : null;
      uid = u && u.id ? await to(u.id()).catch(() => null) : null;
    }
  } catch (e) {
    cdb = null;
  }
  CLOUD.on = !!(cdb && uid);
  CLOUD.state = CLOUD.on ? "idle" : "off";
  emit({ k: "cloud" });
  return CLOUD.on;
}
const col = () => cdb.collection("data/users/" + uid);
async function cloudList(): Promise<Record<string, CloudDoc>> {
  const snap = await col().get();
  const o: Record<string, CloudDoc> = {};
  for (const d of snap.docs) if (d.exists && /^(game|life\d)$/.test(d.id)) o[d.id] = d.data() as CloudDoc;
  return o;
}
async function cloudEnv(id: string, d: CloudDoc): Promise<string | null> {
  if (d.z != null) return d.z;
  const ref = col().doc(id);
  let s = "";
  for (let i = 0; i < d.n; i++) {
    const p = await ref.collection("c").doc(String(i)).get();
    if (!p.exists) return null;
    s += (p.data() as any).z;
  }
  return s;
}
function cloudLater(id: string) {
  if (!CLOUD.on || CLOUD.conflicts.some((c) => c.id === id)) return;
  clearTimeout(cq.get(id));
  cq.set(
    id,
    setTimeout(() => push(id).catch(() => {}), CLOUD_DELAY.ms),
  );
}
export const CLOUD_DELAY = { ms: 15000 };
const writing = new Map<string, Promise<any>>();
async function push(id: string) {
  if (!CLOUD.on) return false;
  const run = async () => {
    const m = meta(id),
      env = S().getItem(recK(id));
    if (!m || !env || !(await decode(env))) return false;
    CLOUD.state = "busy";
    emit({ k: "cloud", id });
    try {
      const ref = col().doc(id);
      const body: any = { m, t: m.t, sum: m.sum, dev: device(), n: 0 };
      const th = thumb(id);
      if (th && th.length < 60000) body.th = th;
      if (env.length <= CHUNK) body.z = env;
      else {
        const n = Math.ceil(env.length / CHUNK);
        for (let i = 0; i < n; i++) await ref.collection("c").doc(String(i)).set({ z: env.slice(i * CHUNK, (i + 1) * CHUNK) });
        body.n = n;
      }
      await ref.set(body);
      idx().base[id] = m.sum;
      saveIdx();
      CLOUD.state = "idle";
      CLOUD.at = Date.now();
      emit({ k: "cloud", id, msg: "pushed" });
      return true;
    } catch (e: any) {
      CLOUD.state = "error";
      CLOUD.err = e && e.code ? e.code : String(e);
      if (e && (e.code === "revoked" || e.code === "not_granted")) CLOUD.on = false;
      emit({ k: "cloud", id, msg: CLOUD.err });
      return false;
    }
  };
  const p = (writing.get(id) || Promise.resolve()).then(run, run); // one write at a time per document
  writing.set(id, p);
  return p;
}
async function pull(id: string, d: CloudDoc) {
  const env = await cloudEnv(id, d);
  const u = env ? await unwrap(env) : null;
  if (!u || u.sum !== d.sum) return false;
  const sl = id.startsWith("life") ? +id.slice(4) : null;
  const keep = sl == null || u.w.d.slot === sl;
  if (!keep) u.w.d.slot = sl;
  // keep the exact bytes unless the slot number had to change
  const ok = commit(id, keep ? env! : encodeSync(JSON.stringify(u.w), u.t), u.w.m || d.m, u.t, true, "cloud");
  if (ok) {
    idx().base[id] = d.sum;
    saveIdx();
    if (id === "game") applyGame(u.w.d);
    if ((d as any).th) setThumb(id, (d as any).th);
  }
  return ok;
}
/** Two-way sync. Returns the conflicts the UI must ask about (also in CLOUD.conflicts). */
export async function cloudSync(): Promise<{ pushed: string[]; pulled: string[]; conflicts: Conflict[] }> {
  const r = { pushed: [] as string[], pulled: [] as string[], conflicts: [] as Conflict[] };
  if (!CLOUD.on) return r;
  flush();
  await settle();
  snapGame();
  CLOUD.state = "busy";
  emit({ k: "cloud" });
  let cl: Record<string, CloudDoc>;
  try {
    cl = await cloudList();
  } catch (e: any) {
    CLOUD.state = "error";
    CLOUD.err = e && e.code ? e.code : String(e);
    emit({ k: "cloud", msg: CLOUD.err });
    return r;
  }
  const ix = idx();
  const ids = new Set([...Object.keys(ix.recs), ...Object.keys(cl)]);
  for (const id of ids) {
    const L = ix.recs[id],
      C = cl[id],
      B = ix.base[id];
    if (L && !C) {
      if (await push(id)) r.pushed.push(id);
    } else if (C && !L) {
      if (await pull(id, C)) r.pulled.push(id);
    } else if (L && C) {
      if (L.sum === C.sum) ix.base[id] = L.sum;
      else if (L.sum === B) {
        if (await pull(id, C)) r.pulled.push(id);
      } else if (C.sum === B) {
        if (await push(id)) r.pushed.push(id);
      } else r.conflicts.push({ id, local: L, cloud: C });
    }
  }
  saveIdx();
  CLOUD.conflicts = r.conflicts;
  CLOUD.state = "idle";
  CLOUD.at = Date.now();
  emit({ k: r.conflicts.length ? "conflict" : "cloud" });
  return r;
}
/** Settle a conflict: "local" uploads this device's copy, "cloud" downloads the cloud copy (the local one stays as a backup). */
export async function resolve(id: string, pick: "local" | "cloud"): Promise<boolean> {
  const c = CLOUD.conflicts.find((x) => x.id === id);
  if (!c) return false;
  CLOUD.conflicts = CLOUD.conflicts.filter((x) => x !== c);
  const ok = pick === "local" ? await push(id) : await pull(id, c.cloud);
  emit({ k: "changed", id });
  return ok;
}
function cloudDelete(id: string) {
  if (!CLOUD.on) return;
  const ref = col().doc(id);
  ref.delete().catch(() => {});
  delete idx().base[id];
}
export async function pushNow(id: string) {
  clearTimeout(cq.get(id));
  return push(id);
}

// ---------------------------------------------------------------- lifecycle
let inited = false;
/** Migrate old keys, snapshot the game keys, flush pending writes when the page hides. Safe to call more than once. */
export function init(o: { store?: Store } = {}) {
  if (o.store) (st = o.store), (IX = null), PEND.clear(), CHAIN.clear();
  if (inited && !o.store) return;
  inited = true;
  migrate();
  const g = globalThis as any;
  if (g.addEventListener && !o.store) {
    g.addEventListener("pagehide", flush);
    g.addEventListener("beforeunload", flush);
    g.document?.addEventListener?.("visibilitychange", () => g.document.visibilityState === "hidden" && flush());
  }
}
/** Tests: start over with a fresh store. */
export function _reset(s: Store) {
  st = s;
  IX = null;
  PEND.clear();
  CHAIN.clear();
  CLOUD.on = false;
  CLOUD.conflicts = [];
  cdb = null;
  uid = null;
  inited = true;
}
export const _mem = memStore;
export const _keys = { recK, bkK, thK, IDXK };

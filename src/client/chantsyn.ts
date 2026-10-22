// Crowd chant synthesis - pure math into stereo Float32Arrays (no audio files, no WebAudio here: Node tests render it
// and Unity's Game/ChantSynth.cs is the same code). A chant = a crowd of voices singing the same syllables a little
// out of time: each voice is a pulse + breath source through three vowel formant band-passes (F1-F3 glide between
// phonemes; plosive bursts, fricatives and nasals as onsets / codas), detuned, delayed and panned by its seat; two
// delayed copies of the section double the head count; stomps (many feet), claps (many hands), fan whistles and a
// noise wash for roars; then a small arena (pre-delay + Schroeder reverb). Rendered ONCE per chant, a few voices per
// frame (`ChantJob.step(budgetMs)`), and played back as AudioBuffers - nothing is synthesized while the game runs.
export const CSR = 22050;
const TAIL = 1.2; // reverb tail after the chant's own length
/** Deterministic PRNG (mulberry32) - same sequence in C#. */
export function rng32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** String hash for seeds (FNV-1a). */
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

// vowel formants (shouted, mixed voices): F1 F2 F3
const VF: Record<string, number[]> = {
  i: [310, 2250, 2950],
  I: [420, 1900, 2550],
  e: [560, 1800, 2500],
  ae: [720, 1650, 2450],
  a: [760, 1220, 2550],
  o: [520, 880, 2400],
  u: [340, 860, 2250],
  er: [500, 1350, 1700],
  m: [260, 1100, 2300],
  n: [280, 1500, 2500],
  l: [360, 1050, 2650],
  w: [300, 700, 2250],
  r: [380, 1100, 1550],
  y: [290, 2200, 2950],
};
/** Noise consonants: [band centre Hz, Q, level, length s, voiced 0/1]. */
const NC: Record<string, number[]> = {
  d: [3200, 1.2, 0.8, 0.03, 0],
  t: [3800, 1.2, 0.9, 0.04, 0],
  k: [2100, 1.4, 0.8, 0.045, 0],
  p: [1100, 1.0, 0.7, 0.03, 0],
  f: [2600, 0.7, 0.32, 0.09, 0],
  v: [2200, 0.8, 0.2, 0.07, 1],
  s: [5600, 1.6, 0.42, 0.12, 0],
  sh: [2900, 1.5, 0.5, 0.11, 0],
  ch: [3000, 1.4, 0.65, 0.09, 0],
};
/** One syllable: start / length (s), pitch (semitones), onset, vowel (+ glide target), coda, level. */
export interface Syl {
  t: number;
  d: number;
  p: number;
  on: string;
  v0: string;
  v1: string;
  co: string;
  a: number;
}
const S = (t: number, d: number, p: number, on: string, v0: string, v1: string, co: string, a = 1): Syl => ({ t, d, p, on, v0, v1: v1 || v0, co, a });
/** Percussion: kind 0 stomp, 1 clap, 2 whistle, 3 noise wash (d = length), at time t, level a. */
export interface Hit {
  k: number;
  t: number;
  a: number;
  d: number;
}
export interface Spec {
  id: string;
  len: number; // the chant's own length (CH[id][0]); the buffer adds the reverb tail
  nv: number; // voices actually synthesized (x3 with the section copies)
  jit: number; // timing scatter between voices (s)
  syl: Syl[]; // shared syllables (chants) ...
  free: number; // ... or 1 = each voice sings its own (reactions: boo / roar / aww / shh)
  hits: Hit[];
}

// ---- words -> syllables (team names, player names) ----
const NICK: Record<string, string> = { TIMBERWOLVES: "WOLVES", CAVALIERS: "CAVS", MAVERICKS: "MAVS", "TRAIL BLAZERS": "BLAZERS", "76ERS": "SIXERS" };
const isV = (ch: string) => "AEIOUY".indexOf(ch) >= 0;
function onsetOf(c: string): string {
  if (!c) return "";
  if (c.startsWith("SH")) return "sh";
  if (c.startsWith("CH")) return "ch";
  if (c.startsWith("TH") || c.startsWith("PH")) return "f";
  const x = c[0];
  return x === "D" ? "d" : x === "T" ? "t" : x === "K" || x === "C" || x === "Q" || x === "G" ? "k" : x === "P" || x === "B" ? "p" : x === "F" ? "f" : x === "V" ? "v" : x === "S" || x === "Z" || x === "X" ? "s" : x === "J" ? "ch" : x === "M" ? "m" : x === "N" ? "n" : x === "L" ? "l" : x === "R" ? "r" : x === "W" ? "w" : "";
}
function vowelOf(v: string, next: string): string[] {
  if (v === "EE" || v === "EA" || v === "IE" || v === "Y" || v === "I" && !next) return ["i", "i"];
  if (v === "OO" || v === "U" && !next) return ["u", "u"];
  if (v === "AI" || v === "AY" || v === "EI" || v === "EY") return ["e", "i"];
  if (v === "OU" || v === "OW") return ["a", "u"];
  if (v === "OA" || v === "O" && !next) return ["o", "u"];
  if (v === "OI" || v === "OY") return ["o", "i"];
  const x = v[0];
  if (next && next[0] === "R") return x === "A" ? ["a", "a"] : x === "O" ? ["o", "o"] : ["er", "er"];
  return x === "A" ? ["ae", "ae"] : x === "E" ? ["e", "e"] : x === "I" ? ["I", "I"] : x === "O" ? ["a", "a"] : x === "U" ? ["a", "a"] : ["i", "i"];
}
function codaOf(c: string): string {
  if (!c) return "";
  const x = c[c.length - 1];
  if (c.length > 1 && (c[0] === "N" || c[0] === "M") && (x === "S" || x === "Z")) return "ns";
  return x === "S" || x === "Z" || x === "X" ? "s" : x === "T" || x === "D" ? "t" : x === "K" || x === "G" || x === "C" ? "k" : x === "N" || x === "M" ? "n" : x === "L" ? "l" : x === "P" || x === "B" ? "p" : x === "R" ? "r" : "";
}
/** A name as chantable syllables [onset, v0, v1, coda] (max 3; long names keep their first two). */
export function sylls(word: string): string[][] {
  let w = (word || "").toUpperCase().replace(/[^A-Z0-9 -]/g, "");
  w = NICK[w] || w;
  w = w.split(/[ -]/).filter((s) => s.length > 0).pop() || "HEY";
  if (w.length > 3 && w.endsWith("E") && !isV(w[w.length - 2])) w = w.slice(0, -1); // silent e
  const out: string[][] = [];
  let i = 0;
  while (i < w.length) {
    let on = "";
    while (i < w.length && !isV(w[i])) on += w[i++];
    let v = "";
    while (i < w.length && isV(w[i])) v += w[i++];
    if (!v) {
      if (out.length) out[out.length - 1][3] = codaOf(on); // trailing consonants
      break;
    }
    let j = i;
    while (j < w.length && !isV(w[j])) j++;
    // consonants up to the next vowel: one stays as this syllable's coda when there are two+, all at the word end
    const cons = w.slice(i, j),
      keep = j >= w.length ? cons.length : cons.length >= 2 ? 1 : 0;
    const vv = vowelOf(v, cons);
    out.push([onsetOf(on), vv[0], vv[1], codaOf(cons.slice(0, keep))]);
    i += keep;
  }
  if (!out.length) out.push(["", "e", "i", ""]);
  return out.length > 3 ? out.slice(0, 2) : out;
}
/** Lay a name's syllables over [t0, t0 + span): first one high, the rest falling (sing-song). */
function nameSyl(out: Syl[], word: string, t0: number, span: number, hi: number) {
  const s = sylls(word),
    n = s.length,
    st = span / n;
  for (let i = 0; i < n; i++) out.push(S(t0 + i * st, Math.min(0.32, st * 0.85), i === 0 ? hi : i === n - 1 ? -1 : 0, s[i][0], s[i][1], s[i][2], s[i][3]));
}

/** The chant's score. Times follow music.ts (96 BPM: beat .625 s) so a chant started on a bar sits on the organ. */
export function spec(id: string, word: string): Spec {
  const syl: Syl[] = [],
    hits: Hit[] = [];
  const stomp = (t: number, a = 1) => hits.push({ k: 0, t, a, d: 0 });
  const clap = (t: number, a = 1) => hits.push({ k: 1, t, a, d: 0 });
  let len = 5,
    nv = 12,
    jit = 0.022,
    free = 0;
  switch (id) {
    case "defense": // stomp, stomp, DE - FENSE (x2)
      for (let c = 0; c < 5; c += 2.5) {
        stomp(c);
        stomp(c + 0.625);
        syl.push(S(c + 1.25, 0.3, 0, "d", "i", "i", "", 1));
        syl.push(S(c + 1.875, 0.5, 4, "f", "e", "e", "ns", 1));
      }
      break;
    case "letsgo": // LET'S GO <TEAM>, clap clap, clap-clap-clap (x2)
      for (let c = 0; c < 5; c += 2.5) {
        syl.push(S(c, 0.22, 0, "l", "e", "e", "s", 0.9));
        syl.push(S(c + 0.3125, 0.26, 0, "k", "o", "u", "", 1));
        nameSyl(syl, word, c + 0.625, 0.625, 3);
        for (const k of [1.25, 1.5625, 1.875, 2.03125, 2.1875]) clap(c + k);
      }
      break;
    case "mvp": // M - V - P (x3)
      len = 4.8;
      for (let c = 0; c < 4.8; c += 1.6) {
        syl.push(S(c, 0.32, 0, "", "e", "e", "n", 1));
        syl.push(S(c + 0.42, 0.32, 0, "v", "i", "i", "", 1));
        syl.push(S(c + 0.84, 0.46, 1, "p", "i", "i", "", 1.1));
      }
      break;
    case "airball": // AIR - BALL, sing-song down a minor third (x3)
      len = 3.75;
      nv = 10;
      for (let c = 0; c < 3.75; c += 1.25) {
        syl.push(S(c, 0.45, 0, "", "e", "er", "", 1));
        syl.push(S(c + 0.625, 0.52, -3, "p", "o", "o", "l", 1));
      }
      break;
    case "overtime": // stomp stomp O - VER - TIME, clap clap (x2)
      for (let c = 0; c < 5; c += 2.5) {
        stomp(c);
        stomp(c + 0.3125);
        syl.push(S(c + 0.625, 0.26, 0, "", "o", "u", "", 0.9));
        syl.push(S(c + 0.9375, 0.26, 0, "v", "er", "er", "", 0.9));
        syl.push(S(c + 1.25, 0.5, 2, "t", "a", "i", "n", 1.1));
        clap(c + 1.875);
        clap(c + 2.1875);
      }
      break;
    case "wewant": // WE WANT <NAME>, clap clap (x2)
      for (let c = 0; c < 5; c += 2.5) {
        syl.push(S(c, 0.22, 0, "w", "i", "i", "", 0.9));
        syl.push(S(c + 0.3125, 0.26, 0, "w", "a", "a", "n", 1));
        nameSyl(syl, word, c + 0.625, 0.625, 3);
        clap(c + 1.25);
        clap(c + 1.5625);
      }
      break;
    case "rockyou": // stomp - stomp - CLAP (x4), the whole building
      len = 6;
      nv = 0;
      for (let c = 0; c < 6; c += 1.5) {
        stomp(c, 1.1);
        stomp(c + 0.375, 1.1);
        clap(c + 0.75, 1.2);
      }
      break;
    case "charge": // the answer to the organ's call
      len = 0.8;
      nv = 14;
      jit = 0.03;
      syl.push(S(0, 0.6, 2, "ch", "a", "er", "ch", 1.2));
      break;
    case "boo":
      len = 3;
      nv = 16;
      free = 1;
      for (let i = 0; i < 4; i++) hits.push({ k: 2, t: 0.2 + i * 0.55, a: 0.5, d: 0.6 });
      break;
    case "roar":
      len = 3.5;
      nv = 14;
      free = 1;
      hits.push({ k: 3, t: 0, a: 1, d: 3.4 });
      for (let i = 0; i < 3; i++) hits.push({ k: 2, t: 0.3 + i * 0.7, a: 0.45, d: 0.7 });
      for (let i = 0; i < 10; i++) clap(0.6 + i * 0.27, 0.5);
      break;
    case "aww":
      len = 1.8;
      nv = 12;
      free = 1;
      break;
    case "shh":
      len = 1.4;
      nv = 10;
      free = 1;
      break;
  }
  return { id, len, nv, jit, syl, free, hits };
}
/** Reactions: every voice its own entry, length and contour. */
function freeSyl(id: string, r: () => number): Syl[] {
  const t = r() * 0.3,
    o: Syl[] = [];
  if (id === "boo") o.push(S(t, 2.1 + r() * 0.6, -2 - r() * 2, "p", "u", "u", "", 0.9));
  else if (id === "roar") o.push(S(t * 0.7, 1.6 + r() * 1.5, 3 + r() * 3, r() < 0.4 ? "y" : "", r() < 0.5 ? "a" : "e", r() < 0.5 ? "a" : "ae", "", 1));
  else if (id === "aww") o.push(S(t * 0.5, 1.1 + r() * 0.4, 1 - r() * 2, "", "a", "o", "", 0.8));
  else {
    // shh: two or three hushes per voice, no voicing
    for (let k = 0, tt = t; k < 3 && tt < 1.1; k++, tt += 0.35 + r() * 0.2) o.push(S(tt, 0.2 + r() * 0.15, 0, "sh", "", "", "", 0.8));
  }
  return o;
}

// ---- rendering ----
/** RBJ band-pass (constant 0 dB peak) with its own state. */
class BP {
  b0 = 0;
  a1 = 0;
  a2 = 0;
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  set(f: number, q: number) {
    const w = (2 * Math.PI * Math.min(f, CSR * 0.45)) / CSR,
      al = Math.sin(w) / (2 * q),
      a0 = 1 + al;
    this.b0 = al / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - al) / a0;
  }
  run(x: number) {
    const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  clear() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}
const ON_LEN = (on: string) => (NC[on] ? NC[on][3] : on && VF[on] ? 0.07 : 0);
const CO_LEN = (co: string) => (co === "ns" ? 0.2 : co === "n" || co === "l" || co === "r" ? 0.09 : NC[co] ? NC[co][3] + (co === "t" || co === "k" || co === "p" ? 0.03 : 0) : 0);

/** Renders one chant into stereo buffers a voice at a time (`step` until `done`). */
export class ChantJob {
  L: Float32Array;
  R: Float32Array;
  done = false;
  ms = 0; // time spent rendering
  private sp: Spec;
  private r: () => number;
  private v = 0; // next voice
  private stage = 0; // 0 voices, 1 hits, 2 section copies, 3-4 reverb L/R, 5 normalize, 6 done
  private f1 = new BP();
  private f2 = new BP();
  private f3 = new BP();
  private fn = new BP();
  private gr: Float32Array[][] = [];
  private wet: Float32Array | null = null;
  constructor(
    public id: string,
    public word: string,
  ) {
    this.sp = spec(id, word);
    this.r = rng32(hash(id + "|" + word));
    const n = Math.ceil((this.sp.len + TAIL) * CSR);
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  get key() {
    return this.word ? this.id + ":" + this.word : this.id;
  }
  /** Render for about `budget` ms (at least one unit of work). Returns done. */
  step(budget: number) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let now = t0;
    do {
      // units of work: one voice, one percussion hit, the section copies, the reverb per channel, normalize
      if (this.stage === 0) {
        if (this.v < this.sp.nv) this.voice(this.v++);
        else (this.stage = 1), (this.v = 0);
      } else if (this.stage === 1) {
        if (this.v < this.sp.hits.length) this.hit(this.sp.hits[this.v], this.v++);
        else this.stage = 2;
      } else if (this.stage === 2) (this.copies(), (this.stage = 3));
      else if (this.stage === 3) (this.verb(0), (this.stage = 4));
      else if (this.stage === 4) (this.verb(1), (this.stage = 5));
      else (this.norm(), (this.stage = 6), (this.done = true));
      now = typeof performance !== "undefined" ? performance.now() : Date.now();
    } while (!this.done && now - t0 < budget);
    this.ms += now - t0;
    return this.done;
  }
  /** Run to the end (tests, Unity warm-up). */
  all() {
    while (!this.done) this.step(1e9);
    return this;
  }

  private voice(i: number) {
    const r = this.r,
      sp = this.sp,
      fem = r() < 0.3,
      f0b = (fem ? 205 : 128) * Math.pow(2, (r() - 0.5) * 0.12), // shouting: a touch higher than speech
      fs = fem ? 1.12 : 1, // formant scale
      det = (r() - 0.5) * 1.1, // semitones off the crowd's pitch
      off = (r() + r() + r() - 1.5) * sp.jit * 1.4, // early / late
      gain = (0.55 + r() * 0.45) / Math.sqrt(Math.max(1, sp.nv)),
      pan = r() * 2 - 1,
      dist = r(),
      dly = Math.floor((0.004 + dist * 0.03) * CSR),
      lev = gain * (1 - dist * 0.45),
      gl = lev * Math.cos(((pan + 1) * Math.PI) / 4),
      gr = lev * Math.sin(((pan + 1) * Math.PI) / 4),
      rough = 0.25 + r() * 0.25,
      syls = sp.free ? freeSyl(sp.id, r) : sp.syl;
    const { L, R } = this,
      N = L.length,
      f1 = this.f1,
      f2 = this.f2,
      f3 = this.f3,
      fn = this.fn;
    let ph = r(),
      lp = 0,
      drift = 0;
    for (const s of syls) {
      if (!sp.free && r() < 0.04) continue; // somebody misses a word
      const st = s.t + off + (r() - 0.5) * sp.jit,
        D = s.d * (0.9 + r() * 0.2),
        oL = ON_LEN(s.on),
        cL = CO_LEN(s.co),
        vS = oL,
        vE = Math.max(vS + 0.04, D - cL),
        a0 = Math.max(0, Math.floor(st * CSR)),
        a1 = Math.min(N - dly - 1, Math.floor((st + D + 0.03) * CSR));
      if (a1 <= a0) continue;
      f1.clear();
      f2.clear();
      f3.clear();
      fn.clear();
      const ncOn = NC[s.on],
        ncCo = NC[s.co === "ns" ? "s" : s.co],
        fOn = VF[s.on],
        fCo = VF[s.co === "ns" ? "n" : s.co],
        v0 = VF[s.v0],
        v1 = VF[s.v1] || v0,
        voiced = !!v0;
      let F1 = 500,
        F2 = 1500,
        F3 = 2500,
        av = 0,
        an = 0,
        avT = 0,
        anT = 0,
        f0 = f0b,
        nf = -1;
      for (let k = a0; k < a1; k++) {
        if ((k - a0) % 32 === 0) {
          // control rate: envelopes, formants, noise band
          const u = k / CSR - st;
          let tF1, tF2, tF3;
          avT = 0;
          anT = 0;
          let nb = -1;
          if (u < vS) {
            // onset
            if (ncOn) {
              const uu = u / oL;
              nb = 0;
              anT = ncOn[2] * (ncOn[3] < 0.05 ? (uu < 0.6 ? 1 : 0.3) : Math.sin(Math.PI * Math.min(1, uu * 1.2)));
              avT = ncOn[4] ? 0.35 : 0;
            } else if (fOn) avT = 0.55 + 0.45 * (u / oL);
            const fv = fOn || v0 || VF.e;
            tF1 = fv[0];
            tF2 = fv[1];
            tF3 = fv[2];
          } else if (u < vE) {
            // vowel (+ glide), shouted: accent then sag
            const w = (u - vS) / (vE - vS),
              g = w < 0.4 ? 0 : (w - 0.4) / 0.6,
              aa = v0 || VF.e,
              bb = v1 || aa;
            avT = voiced ? (u - vS < 0.025 ? (u - vS) / 0.025 : 1.08 - 0.25 * w) : 0;
            tF1 = aa[0] + (bb[0] - aa[0]) * g;
            tF2 = aa[1] + (bb[1] - aa[1]) * g;
            tF3 = aa[2] + (bb[2] - aa[2]) * g;
            if (!voiced && ncOn) (nb = 0), (anT = ncOn[2] * (w < 0.15 ? w / 0.15 : w > 0.8 ? (1 - w) / 0.2 : 1)); // shh
            if (fOn && u - vS < 0.05) {
              const m = (u - vS) / 0.05;
              tF1 = fOn[0] + (tF1 - fOn[0]) * m;
              tF2 = fOn[1] + (tF2 - fOn[1]) * m;
              tF3 = fOn[2] + (tF3 - fOn[2]) * m;
            }
          } else {
            // coda
            const uc = u - vE,
              bb = v1 || VF.e;
            tF1 = bb[0];
            tF2 = bb[1];
            tF3 = bb[2];
            if (fCo && (s.co !== "ns" || uc < 0.09)) {
              avT = 0.5;
              tF1 = fCo[0];
              tF2 = fCo[1];
              tF3 = fCo[2];
            } else if (ncCo) {
              const ul = s.co === "ns" ? uc - 0.09 : uc,
                stop = s.co === "t" || s.co === "k" || s.co === "p";
              avT = 0;
              nb = 1;
              anT = stop ? (ul > 0.03 && ul < 0.03 + ncCo[3] ? ncCo[2] : 0) : ncCo[2] * (ul < ncCo[3] ? 1 - ul / ncCo[3] : 0);
            }
          }
          if (u > D - 0.03) avT *= Math.max(0, (D + 0.03 - u) / 0.06); // release
          F1 = tF1 * fs;
          F2 = tF2 * fs;
          F3 = tF3 * fs;
          f1.set(F1, F1 / 110);
          f2.set(F2, F2 / 150);
          f3.set(F3, F3 / 210);
          if (nb >= 0) {
            const c = nb === 0 ? ncOn : ncCo;
            if (c && nf !== c[0]) (fn.set(c[0], c[1]), (nf = c[0]));
          }
          drift += (r() - 0.5) * 0.06 - drift * 0.02;
          f0 = f0b * Math.pow(2, (s.p + det + drift - 1.5 * Math.min(1, Math.max(0, u / D))) / 12); // shouts fall
        }
        av += (avT * s.a - av) * 0.02;
        an += (anT * s.a - an) * 0.08;
        ph += f0 / CSR;
        if (ph >= 1) ph -= 1;
        const nz = r() * 2 - 1;
        lp += (2 * ph - 1 - lp) * 0.35; // softened pulse
        let y = 0;
        if (av > 0.001) {
          const src = (lp + nz * rough) * av;
          y = f1.run(src) * 2.2 + f2.run(src) * 1.4 + f3.run(src) * 0.7;
        }
        if (an > 0.001) y += fn.run(nz) * an * 1.6;
        const j = k + dly;
        L[j] += y * gl;
        R[j] += y * gr;
      }
    }
  }

  /** A stomp (18 feet) or a clap (22 hands) as a stereo grain - rendered twice / three times per chant and reused. */
  private grain(k: number, v: number) {
    const key = k * 4 + v;
    if (this.gr[key]) return this.gr[key];
    const r = this.r,
      n = Math.floor((k === 0 ? 0.26 : 0.1) * CSR),
      L = new Float32Array(n),
      R = new Float32Array(n),
      off = Math.floor(0.03 * CSR);
    if (k === 0) {
      // stomp: a section of feet on the floor / risers (decaying sine thump with a pitch drop + a thud of low noise)
      const e1 = Math.exp(-16 / CSR),
        e2 = Math.exp(-35 / CSR),
        e3 = Math.exp(-30 / CSR);
      for (let i = 0; i < 18; i++) {
        const a0 = Math.max(0, off + Math.floor((r() + r() - 1) * 0.02 * CSR)),
          pan = r() * 2 - 1,
          g = (0.6 + r() * 0.4) / 6,
          gl = g * Math.cos(((pan + 1) * Math.PI) / 4),
          gr = g * Math.sin(((pan + 1) * Math.PI) / 4),
          f0 = 85 + r() * 30;
        let ph = 0,
          lp = 0,
          a = 1,
          b = 1.2,
          sw = f0 - 42;
        for (let q = a0; q < n; q++) {
          ph += (42 + sw) / CSR;
          sw *= e3;
          lp += (r() * 2 - 1 - lp) * 0.08;
          const y = Math.sin(2 * Math.PI * ph) * a + lp * b;
          a *= e1;
          b *= e2;
          L[q] += y * gl;
          R[q] += y * gr;
        }
      }
    } else {
      // clap: many hands, three micro-bursts each
      const bp = this.fn,
        ed = Math.exp(-260 / CSR),
        et = Math.exp(-60 / CSR),
        m = Math.floor(0.011 * CSR),
        hn = Math.floor(0.07 * CSR);
      for (let i = 0; i < 22; i++) {
        const a0 = Math.max(0, off + Math.floor((r() + r() - 1) * 0.014 * CSR)),
          pan = r() * 2 - 1,
          g = (0.5 + r() * 0.5) / 5,
          gl = g * Math.cos(((pan + 1) * Math.PI) / 4),
          gr = g * Math.sin(((pan + 1) * Math.PI) / 4);
        bp.clear();
        bp.set(1000 + r() * 1200, 1.3);
        let e = 1,
          tl = 3;
        for (let q = 0; q < hn && a0 + q < n; q++) {
          if (q % m === 0 && q < 3 * m) e = 1;
          if (q >= 3 * m) tl *= et;
          const y = bp.run(r() * 2 - 1) * e * tl;
          e *= ed;
          L[a0 + q] += y * gl;
          R[a0 + q] += y * gr;
        }
      }
    }
    return (this.gr[key] = [L, R]);
  }

  private hit(h: Hit, i: number) {
    const r = this.r,
      { L, R } = this,
      N = L.length;
    if (h.k <= 1) {
      const g = this.grain(h.k, i % (h.k === 0 ? 2 : 3)),
        gL = g[0],
        gR = g[1],
        a0 = Math.floor(h.t * CSR) - Math.floor(0.03 * CSR);
      for (let q = Math.max(0, -a0); q < gL.length && a0 + q < N; q++) (L[a0 + q] += gL[q] * h.a), (R[a0 + q] += gR[q] * h.a);
    } else if (h.k === 2) {
      // a fan's whistle (two fingers): a bright glide with a wobble
      const a0 = Math.max(0, Math.floor(h.t * CSR)),
        n = Math.floor(h.d * CSR),
        pan = r() * 2 - 1,
        g = h.a * 0.06,
        gl = g * Math.cos(((pan + 1) * Math.PI) / 4),
        gr = g * Math.sin(((pan + 1) * Math.PI) / 4),
        fa = 2100 + r() * 700,
        fb = fa * (1.15 + r() * 0.2);
      let ph = 0;
      for (let k = 0; k < n && a0 + k < N; k++) {
        const u = k / n,
          f = (u < 0.3 ? fa + (fb - fa) * (u / 0.3) : fb - (fb - fa) * 0.4 * ((u - 0.3) / 0.7)) * (1 + 0.01 * Math.sin(k * 0.012));
        ph += f / CSR;
        if (ph >= 1) ph -= 1;
        const e = u < 0.05 ? u / 0.05 : u > 0.85 ? (1 - u) / 0.15 : 1;
        const y = Math.sin(2 * Math.PI * ph) * e;
        L[a0 + k] += y * gl;
        R[a0 + k] += y * gr;
      }
    } else {
      // the wash under a roar: broadband crowd noise swelling and dying away
      const a0 = Math.max(0, Math.floor(h.t * CSR)),
        n = Math.floor(h.d * CSR),
        bl = this.f1,
        br = this.f2,
        k35 = Math.floor(0.35 * CSR),
        ed = Math.exp(-1.1 / CSR);
      bl.clear();
      br.clear();
      bl.set(900, 0.5);
      br.set(1000, 0.5);
      let e = 1;
      for (let k = 0; k < n && a0 + k < N; k++) {
        let v;
        if (k < k35) v = k / k35;
        else (v = e), (e *= ed);
        v *= h.a * 0.35;
        L[a0 + k] += bl.run(r() * 2 - 1) * v;
        R[a0 + k] += br.run(r() * 2 - 1) * v;
      }
    }
  }

  /** Section copies: the voices again 19 ms (sides swapped) and 37 ms later = three times the heads. */
  private copies() {
    const { L, R } = this,
      N = L.length;
    if (this.sp.nv > 0) {
      const d1 = Math.floor(0.019 * CSR),
        d2 = Math.floor(0.037 * CSR);
      for (let k = N - 1; k >= d2; k--) {
        const l = L[k],
          rr = R[k];
        L[k] = l + R[k - d1] * 0.7 + L[k - d2] * 0.55;
        R[k] = rr + L[k - d1] * 0.7 + R[k - d2] * 0.55;
      }
    }
  }
  /** The arena: pre-delay + Schroeder reverb (4 damped combs, 2 all-passes), one channel per call. */
  private verb(ch: number) {
    const N = this.L.length,
      wet = this.wet || (this.wet = new Float32Array(N)),
      pre = Math.floor(0.025 * CSR);
    {
      const x = ch ? this.R : this.L,
        sp = ch ? 23 : 0,
        n0 = Math.floor(((1557 + sp) * CSR) / 44100),
        n1 = Math.floor(((1617 + sp) * CSR) / 44100),
        n2 = Math.floor(((1491 + sp) * CSR) / 44100),
        n3 = Math.floor(((1422 + sp) * CSR) / 44100),
        m0 = Math.floor(((556 + sp) * CSR) / 44100),
        m1 = Math.floor(((341 + sp) * CSR) / 44100),
        c0 = new Float32Array(n0),
        c1 = new Float32Array(n1),
        c2 = new Float32Array(n2),
        c3 = new Float32Array(n3),
        p0 = new Float32Array(m0),
        p1 = new Float32Array(m1),
        fb = 0.8,
        dm = 0.3;
      let i0 = 0,
        i1 = 0,
        i2 = 0,
        i3 = 0,
        j0 = 0,
        j1 = 0,
        s0 = 0,
        s1 = 0,
        s2 = 0,
        s3 = 0;
      for (let k = 0; k < N; k++) {
        const inp = k >= pre ? x[k - pre] * 0.15 : 0,
          o0 = c0[i0],
          o1 = c1[i1],
          o2 = c2[i2],
          o3 = c3[i3];
        s0 = o0 * (1 - dm) + s0 * dm;
        s1 = o1 * (1 - dm) + s1 * dm;
        s2 = o2 * (1 - dm) + s2 * dm;
        s3 = o3 * (1 - dm) + s3 * dm;
        c0[i0] = inp + s0 * fb;
        c1[i1] = inp + s1 * fb;
        c2[i2] = inp + s2 * fb;
        c3[i3] = inp + s3 * fb;
        if (++i0 >= n0) i0 = 0;
        if (++i1 >= n1) i1 = 0;
        if (++i2 >= n2) i2 = 0;
        if (++i3 >= n3) i3 = 0;
        let y = o0 + o1 + o2 + o3;
        const q0 = p0[j0];
        p0[j0] = y + q0 * 0.5;
        y = q0 - y * 0.5;
        if (++j0 >= m0) j0 = 0;
        const q1 = p1[j1];
        p1[j1] = y + q1 * 0.5;
        y = q1 - y * 0.5;
        if (++j1 >= m1) j1 = 0;
        wet[k] = y;
      }
      for (let k = 0; k < N; k++) x[k] += wet[k] * 1.4;
    }
  }
  /** Normalize to a .9 peak (levels are set at playback). */
  private norm() {
    const { L, R } = this,
      N = L.length;
    this.wet = null;
    let pk = 1e-6;
    for (let k = 0; k < N; k++) {
      const a = L[k] < 0 ? -L[k] : L[k],
        b = R[k] < 0 ? -R[k] : R[k];
      if (a > pk) pk = a;
      if (b > pk) pk = b;
    }
    const g = 0.9 / pk;
    for (let k = 0; k < N; k++) (L[k] *= g), (R[k] *= g);
  }
}

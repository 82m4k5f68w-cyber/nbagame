// Crowd chants in the browser: renders every chant ONCE (chantsyn.ts, a few ms of work per frame, while the menus and
// intros run) into AudioBuffers, then the director (chantdir.ts) decides what the building sings and this plays it:
// one BufferSource per chant through a gain (+ a stereo pan for the visiting section) into the crowd bus, which also
// carries audio.ts's crowd bed and "ooh". Chants never stack: a reaction (roar / boo / aww / shh) fades a running
// chant out. While the crowd sings the organ backs off (music.duck), and the commentary voice holds chants back.
// Settings: crowd volume (0..100, also the bed) and chants on/off - game.ts settings drawer, saved in h2k_set.
import { ChantDir, CH, isReact, type CCtx, type CReq } from "./chantdir";
import { ChantJob, CSR } from "./chantsyn";

let AC: AudioContext | null = null,
  BUS: GainNode | null = null, // crowd master (volume setting)
  CHB: GainNode | null = null; // chants (ducked under the commentary voice)
const BUF = new Map<string, AudioBuffer>(),
  QUEUE: string[] = [],
  OUT: CReq[] = [],
  ERR: string[] = [];
let job: ChantJob | null = null,
  cur: { src: AudioBufferSourceNode; g: GainNode; end: number; react: boolean } | null = null,
  wait: null | { r: CReq; at: number; until: number } = null,
  ctx: CCtx | null = null,
  renderMs = 0,
  plays = 0;
/** Playback level per chant (buffers are normalized to a .9 peak). */
const LEVEL: Record<string, number> = { defense: 0.5, letsgo: 0.45, mvp: 0.5, airball: 0.5, overtime: 0.5, wewant: 0.42, rockyou: 0.55, charge: 0.55, boo: 0.42, roar: 0.6, aww: 0.32, shh: 0.22 };
/** Chants without a word, rendered at start-up (the per-game ones - team / player names - are queued by prepare()). */
const COMMON = ["defense", "airball", "roar", "boo", "charge", "mvp", "overtime", "rockyou", "aww", "shh"];
const keyOf = (id: string, word: string) => (id === "letsgo" || id === "wewant" ? id + ":" + word : id);

export const crowd = {
  vol: 100, // crowd volume 0..100 (bed + chants + reactions)
  on: 1, // chants on/off (the bed and "ooh" stay)
  dir: new ChantDir(),
  /** Hook the crowd bus into the shared context (audio.ts calls this; the bed and "ooh" go through it too). */
  init(ac: AudioContext) {
    if (AC) return BUS!;
    AC = ac;
    BUS = ac.createGain();
    BUS.gain.value = crowd.vol / 100;
    BUS.connect(ac.destination);
    CHB = ac.createGain();
    CHB.connect(BUS);
    for (const id of COMMON) if (QUEUE.indexOf(id) < 0) QUEUE.push(id);
    return BUS;
  },
  bus: () => BUS,
  /** A new game: the team names (LET'S GO ...) and the director's state. */
  prepare(names: string[], bench = "") {
    crowd.dir.reset();
    const want = [keyOf("letsgo", names[0] || ""), keyOf("letsgo", names[1] || "")];
    if (bench) want.push(keyOf("wewant", bench));
    for (const k of want) if (!BUF.has(k) && QUEUE.indexOf(k) < 0) QUEUE.unshift(k);
  },
  /** Render a chant ahead of time (a new bench favourite for WE WANT ...). */
  need(id: string, word = "") {
    const k = keyOf(id, word);
    if (!BUF.has(k) && QUEUE.indexOf(k) < 0 && (!job || job.key !== k)) QUEUE.push(k);
  },
  /** One sim FX (game.ts drainFx; c = this frame's context). */
  fx(f: any, c: CCtx) {
    ctx = c;
    crowd.dir.fx(f, c);
  },
  /** music.ts started an organ riff at audio time t: maybe the crowd answers it. */
  onRiff(name: string, t: number) {
    if (!ctx || !AC) return;
    const r = crowd.dir.riff(name, ctx);
    if (r) start(r, Math.max(AC.currentTime, t + r.delay));
  },
  /** Per frame, after the frame's FX: render a slice, run the director, start what it picked. */
  tick(dt: number, c: CCtx) {
    ctx = c;
    crowd.dir.on = !!crowd.on;
    if (!AC || !BUS || !CHB) {
      crowd.dir.tick(dt, c, OUT); // keep the director's clock / state moving (tests drive it without audio)
      return;
    }
    renderSlice(c.live ? 2 : 5);
    BUS.gain.value += (crowd.vol / 100 - BUS.gain.value) * 0.2;
    CHB.gain.value += ((c.speaking ? 0.6 : 1) - CHB.gain.value) * 0.1;
    crowd.dir.tick(dt, c, OUT);
    for (const r of OUT) start(r, AC.currentTime);
    if (wait && AC.currentTime > wait.until) wait = null; // its buffer never arrived in time: drop it
    else if (wait && BUF.has(keyOf(wait.r.id, wait.r.word))) {
      const w = wait;
      wait = null;
      start(w.r, AC.currentTime);
    }
    if (cur && AC.currentTime > cur.end) cur = null;
  },
  /** Music level multiplier (the organ backs off under a chant; lower still for a hush). */
  duck: () => crowd.dir.duck(),
  /** Crowd bed multiplier (0..1): a hush before clutch home free throws. */
  hush: () => 1 - 0.8 * crowd.dir.hush,
  /** Play a chant by hand (tests / debug): H2K.crowd.play("defense"). */
  play(id: string, word = "", gain = 1) {
    if (!AC || !CH[id]) return false;
    start({ id, word, side: 0, gain, delay: 0, t: crowd.dir.now }, AC.currentTime);
    return true;
  },
  stats: () => ({ ready: [...BUF.keys()], queued: QUEUE.length + (job ? 1 : 0), renderMs: Math.round(renderMs), plays, errors: ERR.slice(), log: crowd.dir.log.slice(-12) }),
};

function renderSlice(budget: number) {
  try {
    if (!job) {
      const k = QUEUE.shift();
      if (!k) return;
      if (BUF.has(k)) return;
      const i = k.indexOf(":");
      job = new ChantJob(i < 0 ? k : k.slice(0, i), i < 0 ? "" : k.slice(i + 1));
    }
    if (job.step(budget)) {
      const b = AC!.createBuffer(2, job.L.length, CSR);
      b.copyToChannel(job.L as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(job.R as Float32Array<ArrayBuffer>, 1);
      BUF.set(job.key, b);
      renderMs += job.ms;
      job = null;
    }
  } catch (e) {
    ERR.push(String(e));
    job = null;
  }
}

function start(r: CReq, when: number) {
  try {
    if (!AC || !CHB) return;
    const k = keyOf(r.id, r.word),
      b = BUF.get(k);
    if (!b) {
      // not rendered yet (a new name): render it next and play it if it arrives within 1.5 s
      if (QUEUE.indexOf(k) < 0 && (!job || job.key !== k)) QUEUE.unshift(k);
      wait = { r, at: when, until: AC.currentTime + 1.5 };
      return;
    }
    const react = isReact(r.id);
    if (cur && react && !cur.react) {
      // a roar / boo cuts in: fade the chant out
      cur.g.gain.setTargetAtTime(0, AC.currentTime, 0.12);
      cur.src.stop(AC.currentTime + 0.6);
      cur = null;
    }
    const src = AC.createBufferSource(),
      g = AC.createGain();
    src.buffer = b;
    g.gain.value = (LEVEL[r.id] || 0.5) * r.gain;
    src.connect(g);
    if (r.side !== (ctx ? ctx.home : 0) && AC.createStereoPanner) {
      // the visiting section: off in one corner, smaller
      const p = AC.createStereoPanner();
      p.pan.value = 0.65;
      g.connect(p);
      p.connect(CHB);
    } else g.connect(CHB);
    src.start(when);
    plays++;
    const c = { src, g, end: when + b.duration, react };
    if (!react || !cur) cur = c;
  } catch (e) {
    ERR.push(String(e));
  }
}

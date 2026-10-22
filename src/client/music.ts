// Dynamic arena music, all procedural WebAudio (no samples), scheduled a little ahead of time:
//  pregame - a head-nodding hip-hop beat for the intros and the tip
//  organ   - live play: the arena organ (drawbar organ voice) with soft chords and the classic riffs at dead balls
//            ("Charge!", the "De-fense" chant, "Let's go ___"), stingers after big plays
//  hype    - a team on a run: four-on-the-floor kick, claps, bass and organ stabs over the top
//  clutch  - heartbeat kick, ticking hats and a low drone
import { actx } from "./audio";
let AC: AudioContext | null = null,
  OUT: GainNode | null = null,
  NX = 0, // next 16th-note time
  STEP = 0,
  NOISE: AudioBuffer | null = null;
const BPM = 96,
  S16 = 60 / BPM / 4;
const PROG = [110, 87.31, 73.42, 82.41]; // A minor: i - VI - iv - V (roots, Hz)
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// organ riffs: [16th step, midi note, length in 16ths]
const RIFFS: Record<string, number[][]> = {
  charge: [[0, 67, 1], [1, 72, 1], [2, 76, 1], [3, 79, 2], [6, 76, 1], [7, 79, 5]],
  defense: [[0, 55, 3], [4, 60, 3], [8, 55, 3], [12, 60, 3]],
  letsgo: [[0, 72, 1], [1, 72, 1], [3, 72, 1], [4, 74, 1], [5, 76, 2], [8, 74, 1], [9, 72, 3]],
  stinger: [[0, 72, 1], [1, 76, 1], [2, 79, 1], [3, 84, 4]],
  sad: [[0, 67, 2], [2, 66, 2], [4, 65, 2], [6, 64, 6]],
};
export type MusicMode = "off" | "pregame" | "organ" | "hype" | "clutch" | "calm";
export const music = {
  on: 1,
  mode: "off" as MusicMode,
  level: 0.3, // crowd energy 0..1
  dead: 0, // dead ball: the organ plays riffs
  offense: 1, // 1 = the home (your) team has the ball
  riffQ: [] as string[], // riffs waiting for the next bar
  duck: 1, // crowd.ts: the organ backs off while the crowd chants
  onRiff: null as null | ((name: string, t: number) => void), // a riff starts at audio time t (crowd call-and-response)
  start() {
    try {
      AC = AC || actx();
      if (!OUT) {
        OUT = AC.createGain();
        OUT.gain.value = 0;
        OUT.connect(AC.destination);
        NOISE = AC.createBuffer(1, AC.sampleRate * 0.3, AC.sampleRate);
        const d = NOISE.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        NX = AC.currentTime + 0.1;
      }
      if (AC.state === "suspended") AC.resume().catch(() => {});
    } catch (e) {}
  },
  /** One-shot organ riff on the next beat (big plays, timeouts, game start). */
  riff(name: string) {
    if (RIFFS[name] && this.riffQ.length < 2) this.riffQ.push(name);
  },
  /** Called every frame: schedule ~120 ms ahead and fade between modes. */
  tick() {
    if (!AC || !OUT) return;
    const vol = (!this.on || this.mode === "off" ? 0 : this.mode === "organ" ? 0.045 : this.mode === "calm" ? 0.03 : 0.06) * this.duck;
    OUT.gain.value += (vol - OUT.gain.value) * 0.05;
    if (OUT.gain.value < 0.001 && vol === 0) {
      NX = AC.currentTime + 0.05;
      return;
    }
    while (NX < AC.currentTime + 0.12) {
      this.note(STEP, NX);
      NX += S16;
      STEP = (STEP + 1) % 64;
    }
  },
  cur: null as null | { r: number[][]; s0: number },
  note(s: number, t: number) {
    const k = s & 15,
      bar = (s >> 4) & 3,
      root = PROG[bar],
      m = this.mode;
    // riffs start on a bar line and play over any mode
    if (k === 0 && !this.cur && this.riffQ.length) {
      const nm = this.riffQ.shift()!;
      this.cur = { r: RIFFS[nm], s0: s };
      if (this.onRiff) this.onRiff(nm, t);
    }
    if (this.cur) {
      const rel = (s - this.cur.s0 + 64) % 64;
      for (const n of this.cur.r) if (n[0] === rel) organ(t, mtof(n[1]), n[2] * S16 * 0.95, 0.9);
      if (rel >= 15) this.cur = null;
    }
    if (m === "pregame") {
      // boom-bap: kick on 1 and the "and" of 2, snare on 2 and 4, swung hats, a sub bass, a minor-key keys loop
      if (k === 0 || k === 7 || k === 10) kick(t, 1);
      if (k === 4 || k === 12) snare(t, 0.8);
      if (k % 2 === 0) hat(t + (k % 4 === 2 ? S16 * 0.18 : 0), 0.25);
      if (k === 0 || k === 10) tone(t, root / 2, S16 * 5, "sine", 0.8, 300);
      if (k === 0 || k === 6 || k === 12) for (const r of [2, 2.378, 2.997]) tone(t, root * r, S16 * 2.5, "triangle", 0.07, 2400);
    } else if (m === "hype") {
      // four on the floor + claps + octave bass + organ stabs
      if (k % 4 === 0) kick(t, 1);
      if (k === 4 || k === 12) (clap(t, 0.8), snare(t, 0.5));
      if (k % 2 === 1) hat(t, 0.22);
      if (k % 2 === 0) tone(t, k % 4 ? root * 2 : root, S16 * 0.9, "sawtooth", 0.35, 900);
      if (k === 2 || k === 10) for (const r of [4, 4.757, 5.993]) organ(t, root * r, S16 * 0.7, 0.25);
    } else if (m === "clutch") {
      if (k === 0 || k === 3 || k === 8 || k === 11) kick(t, k % 8 ? 0.5 : 0.9);
      if (k % 2 === 0) hat(t, 0.22);
      if (k === 0) tone(t, root / 2, S16 * 15, "sawtooth", 0.16, 300);
    } else if (m === "organ") {
      // live ball: a soft held organ chord under the crowd, walking bass; dead ball: the classic riffs
      if (k === 0) for (const r of [2, 2.378, 2.997]) organ(t, root * r, S16 * 15, 0.12 + this.level * 0.08);
      if (k === 0 || k === 8) tone(t, root, S16 * 6, "triangle", 0.3, 500);
      if (this.dead && k === 0 && bar % 2 === 0 && !this.cur && !this.riffQ.length) this.riffQ.push(this.offense ? (Math.random() < 0.5 ? "charge" : "letsgo") : "defense");
      if (!this.offense && (k === 0 || k === 4 || k === 8 || k === 12) && this.level > 0.4) clap(t, 0.35); // crowd claps on D
    } else if (m === "calm") {
      if (k === 0) for (const r of [2, 2.378, 2.997]) organ(t, root * r, S16 * 15, 0.1);
    }
  },
};
function env(t: number, d: number, v: number) {
  const g = AC!.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, v), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  g.connect(OUT!);
  return g;
}
function kick(t: number, v: number) {
  const o = AC!.createOscillator();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  o.connect(env(t, 0.22, v));
  o.start(t);
  o.stop(t + 0.25);
}
function noiseHit(t: number, d: number, v: number, f: number, type: BiquadFilterType) {
  const n = AC!.createBufferSource();
  n.buffer = NOISE;
  const fl = AC!.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  n.connect(fl);
  fl.connect(env(t, d, v));
  n.start(t);
  n.stop(t + d + 0.02);
}
const snare = (t: number, v: number) => noiseHit(t, 0.16, v * 0.6, 1600, "bandpass");
const hat = (t: number, v: number) => noiseHit(t, 0.04, v * 0.5, 7000, "highpass");
const clap = (t: number, v: number) => {
  for (let i = 0; i < 3; i++) noiseHit(t + i * 0.012, 0.08, v * 0.5, 1200, "bandpass");
};
function tone(t: number, f: number, d: number, ty: OscillatorType, v: number, cut: number) {
  const o = AC!.createOscillator();
  o.type = ty;
  o.frequency.value = f;
  const fl = AC!.createBiquadFilter();
  fl.type = "lowpass";
  fl.frequency.value = cut;
  o.connect(fl);
  fl.connect(env(t, d, v));
  o.start(t);
  o.stop(t + d + 0.02);
}
/** Drawbar organ: fundamental + octave + 12th + 2 octaves (sines), a little vibrato, organ-style flat envelope. */
function organ(t: number, f: number, d: number, v: number) {
  const g = AC!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v * 0.25, t + 0.012);
  g.gain.setValueAtTime(v * 0.25, t + Math.max(0.02, d - 0.04));
  g.gain.linearRampToValueAtTime(0.0001, t + d);
  g.connect(OUT!);
  const lfo = AC!.createOscillator(),
    lg = AC!.createGain();
  lfo.frequency.value = 6.2;
  lg.gain.value = f * 0.004;
  lfo.connect(lg);
  for (const [m, a] of [
    [1, 1],
    [2, 0.6],
    [3, 0.35],
    [4, 0.25],
  ]) {
    const o = AC!.createOscillator(),
      og = AC!.createGain();
    o.type = "sine";
    o.frequency.value = f * m;
    lg.connect(o.frequency);
    og.gain.value = a;
    o.connect(og);
    og.connect(g);
    o.start(t);
    o.stop(t + d + 0.05);
  }
  lfo.start(t);
  lfo.stop(t + d + 0.05);
}

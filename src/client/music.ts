// Dynamic arena music: a procedural WebAudio groove (kick / snare / hats / bass / organ stabs) scheduled ahead of
// time. Layers come in with the game state: calm in the half court, full beat on runs, tense pulse in clutch time.
let AC: AudioContext | null = null,
  OUT: GainNode | null = null,
  NX = 0, // next 16th-note time
  STEP = 0,
  NOISE: AudioBuffer | null = null;
const BPM = 98,
  S16 = 60 / BPM / 4;
// i-VI-iv-V in A minor (root notes, Hz)
const PROG = [110, 87.31, 73.42, 82.41];
export const music = {
  on: 1,
  level: 0.3, // 0 calm .. 1 hype
  clutch: 0,
  start() {
    try {
      AC = AC || new AudioContext();
      if (!OUT) {
        OUT = AC.createGain();
        OUT.gain.value = 0;
        OUT.connect(AC.destination);
        NOISE = AC.createBuffer(1, AC.sampleRate * 0.3, AC.sampleRate);
        const d = NOISE.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        NX = AC.currentTime + 0.1;
      }
    } catch (e) {}
  },
  /** Called every frame: schedule ~120 ms ahead; fade with `want` (0 = silent, e.g. menus or music off). */
  tick(want: number) {
    if (!AC || !OUT) return;
    const tgt = this.on ? want * 0.055 : 0;
    OUT.gain.value += (tgt - OUT.gain.value) * 0.05;
    if (OUT.gain.value < 0.001 && tgt === 0) {
      NX = AC.currentTime + 0.05;
      return;
    }
    while (NX < AC.currentTime + 0.12) {
      this.note(STEP, NX);
      NX += S16;
      STEP = (STEP + 1) % 64;
    }
  },
  note(s: number, t: number) {
    const L = this.level,
      bar = (s >> 4) & 3,
      k = s & 15,
      root = PROG[bar];
    if (this.clutch) {
      // clutch: heartbeat kick + ticking hats + a low drone, no melody
      if (k === 0 || k === 3 || k === 8 || k === 11) kick(t, k % 8 ? 0.5 : 0.9);
      if (k % 2 === 0) hat(t, 0.25);
      if (k === 0) tone(t, root / 2, S16 * 15, "sawtooth", 0.18, 300);
      return;
    }
    if (k === 0 || k === 8 || (L > 0.6 && k === 10)) kick(t, 1);
    if (L > 0.25 && (k === 4 || k === 12)) snare(t, 0.7);
    if (L > 0.15 && k % 2 === 0) hat(t, k % 4 ? 0.18 : 0.3);
    if (L > 0.7 && k % 2 === 1) hat(t, 0.12);
    // bass: root on the beat, octave pops on the off-beats when it's hype
    if (k === 0 || k === 6 || k === 10 || (L > 0.5 && k === 14)) tone(t, k === 6 && L > 0.5 ? root * 2 : root, S16 * 1.6, "triangle", 0.5, 700);
    // organ stab chords on 2 and the "and" of 3
    if (L > 0.45 && (k === 4 || k === 10)) for (const m of [2, 2.378, 2.997]) tone(t, root * m, S16 * 0.8, "square", 0.05, 1800);
  },
};
function env(t: number, d: number, v: number) {
  const g = AC!.createGain();
  g.gain.setValueAtTime(v, t);
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

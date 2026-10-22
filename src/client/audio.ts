// WebAudio: synthesized hit/score sounds and a reactive crowd bed that swells with excitement. One AudioContext for
// everything (sounds, crowd, chants, music.ts); the crowd bed and "ooh" go through the crowd bus (crowd.ts: volume).
import { crowd } from "./crowd";
let AC: AudioContext | null = null,
  CRG: GainNode | null = null;
/** The shared AudioContext (created on first use). */
export const actx = () => (AC = AC || new AudioContext());
const crowdOut = () => crowd.bus() || AC!.destination;
export const audio = {
  EXC: 0.3,
  snd(f: number, d: number, ty: OscillatorType = "sine", v = 0.07) {
    try {
      AC = AC || new AudioContext();
      const o = AC.createOscillator(),
        gn = AC.createGain();
      o.type = ty;
      o.frequency.value = f;
      gn.gain.value = v;
      gn.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d);
      o.connect(gn);
      gn.connect(AC.destination);
      o.start();
      o.stop(AC.currentTime + d);
    } catch (e) {}
  },
  crowdInit() {
    try {
      AC = AC || new AudioContext();
      crowd.init(AC);
      if (CRG) return;
      const bf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate),
        d = bf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = AC.createBufferSource();
      s.buffer = bf;
      s.loop = true;
      const f = AC.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 700;
      f.Q.value = 0.6;
      CRG = AC.createGain();
      CRG.gain.value = 0.015;
      s.connect(f);
      f.connect(CRG);
      CRG.connect(crowdOut());
      s.start();
    } catch (e) {}
  },
  /** Ball on hardwood: a short pitched-down thump plus a slap of filtered noise; v = 0..1 loudness. */
  bounce(v: number) {
    try {
      if (!AC) return;
      const t0 = AC.currentTime,
        o = AC.createOscillator(),
        g1 = AC.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(55, t0 + 0.09);
      g1.gain.setValueAtTime(0.16 * v, t0);
      g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      o.connect(g1);
      g1.connect(AC.destination);
      o.start(t0);
      o.stop(t0 + 0.12);
      const n = AC.createBufferSource(),
        bf = AC.createBuffer(1, AC.sampleRate * 0.03, AC.sampleRate),
        ch = bf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
      n.buffer = bf;
      const fl = AC.createBiquadFilter();
      fl.type = "bandpass";
      fl.frequency.value = 1800;
      fl.Q.value = 0.9;
      const g2 = AC.createGain();
      g2.gain.value = 0.05 * v;
      n.connect(fl);
      fl.connect(g2);
      g2.connect(AC.destination);
      n.start(t0);
    } catch (e) {}
  },
  /** Referee's whistle: a bright, slightly wobbling two-tone tweet. */
  whistle() {
    try {
      if (!AC) return;
      const t0 = AC.currentTime,
        o = AC.createOscillator(),
        lfo = AC.createOscillator(),
        lg = AC.createGain(),
        g = AC.createGain();
      o.type = "sine";
      o.frequency.value = 2900;
      lfo.frequency.value = 38;
      lg.gain.value = 140;
      lfo.connect(lg);
      lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 0.02);
      g.gain.setValueAtTime(0.06, t0 + 0.32);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      o.connect(g);
      g.connect(AC.destination);
      o.start(t0);
      lfo.start(t0);
      o.stop(t0 + 0.5);
      lfo.stop(t0 + 0.5);
    } catch (e) {}
  },
  /** The crowd's "ooooh" on an in-and-out: filtered noise with a falling vowel formant. */
  ooh() {
    try {
      if (!AC) return;
      const t0 = AC.currentTime,
        n = AC.createBufferSource(),
        bf = AC.createBuffer(1, AC.sampleRate * 1.4, AC.sampleRate),
        ch = bf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      n.buffer = bf;
      const f1 = AC.createBiquadFilter();
      f1.type = "bandpass";
      f1.Q.value = 6;
      f1.frequency.setValueAtTime(520, t0);
      f1.frequency.exponentialRampToValueAtTime(330, t0 + 1.2);
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35);
      n.connect(f1);
      f1.connect(g);
      g.connect(crowdOut());
      n.start(t0);
      n.stop(t0 + 1.4);
    } catch (e) {}
  },
  tick(dt: number) {
    audio.EXC = Math.max(0.2, audio.EXC - dt * 0.25);
    if (CRG) CRG.gain.value = (0.012 + 0.06 * audio.EXC) * crowd.hush(); // the building goes quiet for a clutch home FT
  },
};

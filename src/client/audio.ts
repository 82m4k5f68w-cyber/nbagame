// WebAudio: synthesized hit/score sounds and a reactive crowd bed that swells with excitement.
let AC: AudioContext | null = null,
  CRG: GainNode | null = null;
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
      CRG.connect(AC.destination);
      s.start();
    } catch (e) {}
  },
  tick(dt: number) {
    audio.EXC = Math.max(0.2, audio.EXC - dt * 0.25);
    if (CRG) CRG.gain.value = 0.012 + 0.06 * audio.EXC;
  },
};

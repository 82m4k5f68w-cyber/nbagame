// AI announcer: plays the Piper voice bank (assets/voice/bank.bin, built by scripts/assets/voice.ts) instead of the
// browser's speechSynthesis. A commentary line is matched word by word against the bank (names, template pieces,
// numbers); if any word is missing the caller falls back to browser speech. Clips are decoded on demand and cached.
// PA announcer (second voice with arena echo): "Threeeee!", "And one!", lineup intros ("Number 30 ... Curry!").
import bankUrl from "../../assets/voice/bank.bin?inline";
import { actx } from "./audio";
import { V } from "./view";
import { LIFE_LINES } from "./lifelines";
export { LIFE_LINES };
import { parseBank, matchLine, vnorm, type VoiceIndex } from "./voicekey";

let ix: VoiceIndex | null = null,
  data: Uint8Array | null = null,
  failed = false,
  loading: Promise<boolean> | null = null;
const cache = new Map<string, Promise<AudioBuffer | null>>();
/** Load + parse the bank once (a data: URL inside the single HTML). Resolves false when missing / undecodable. */
export function voiceReady(): Promise<boolean> {
  if (ix) return Promise.resolve(true);
  if (failed) return Promise.resolve(false);
  return (loading ||= (async () => {
    try {
      const r = await fetch(bankUrl);
      const b = parseBank(await r.arrayBuffer());
      ix = b.ix;
      data = b.data;
      return true;
    } catch (e) {
      failed = true;
      return false;
    }
  })());
}
/** True once the bank is parsed and this browser decoded at least one clip (or none tried yet). */
export const voiceOk = () => !!ix && !failed;

function clip(ns: "c" | "p" | "l", key: string): Promise<AudioBuffer | null> {
  const id = ns + ":" + key;
  let p = cache.get(id);
  if (!p) {
    const e = ix && ix[ns] && ix[ns]![key];
    p = !e
      ? Promise.resolve(null)
      : actx()
          .decodeAudioData(data!.slice(e[0], e[0] + e[1]).buffer)
          .catch(() => ((failed = true), null)); // no Opus/WebM decoder: browser speech from now on
    cache.set(id, p);
    if (cache.size > 160) cache.delete(cache.keys().next().value!); // small LRU (decoded PCM is ~100 KB/s)
  }
  return p;
}

// ---- playback queue: one line at a time, like the browser speech queue ----
type Line = { ns: "c" | "p" | "l"; keys: string[]; rate: number; vol: number; gap: number };
const Q: Line[] = [];
let busy = false,
  playing: AudioBufferSourceNode[] = [],
  gen = 0;
function stopAll() {
  gen++;
  Q.length = 0;
  for (const s of playing)
    try {
      s.stop();
    } catch (e) {}
  playing = [];
  busy = false;
}
async function pump() {
  if (busy) return;
  const L = Q.shift();
  if (!L) return;
  busy = true;
  const g = gen;
  const bufs = await Promise.all(L.keys.map((k) => clip(L.ns, k)));
  if (g !== gen) return;
  try {
    const ac = actx();
    if (ac.state === "suspended") ac.resume().catch(() => {});
    const out = ac.createGain();
    out.gain.value = L.vol;
    out.connect(ac.destination);
    let t = ac.currentTime + 0.03;
    for (const b of bufs) {
      if (!b) continue;
      const s = ac.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = L.rate;
      s.connect(out);
      s.start(t);
      playing.push(s);
      t += b.duration / L.rate + L.gap;
    }
    const wait = Math.max(0, t - ac.currentTime) * 1000;
    setTimeout(() => {
      if (g !== gen) return;
      playing = [];
      busy = false;
      pump();
    }, wait);
  } catch (e) {
    busy = false;
  }
}
/**
 * Speak a commentary line with the AI voice. now = cut off the current line; hype 0..1 = a bit faster and louder.
 * Returns false (caller uses browser speech) when the bank is missing or a word of the line has no clip.
 */
export function aiSay(s: string, now: boolean, hype = 0): boolean {
  if (!ix) {
    voiceReady();
    return false;
  }
  if (failed) return false;
  const keys = matchLine(s, ix.c, ix.mw);
  if (!keys) return false;
  if (now) stopAll();
  else if (Q.length >= 2) return true; // never fall behind the game (still "handled": no double voice)
  Q.push({ ns: "c", keys, rate: 1.04 + hype * 0.08, vol: 0.9 + hype * 0.1, gap: 0.05 });
  pump();
  return true;
}
/** PA announcer sequence of bank keys (index.p), e.g. ["number", "30", "curry"]. Missing keys are skipped. */
export function paSay(keys: string[], now = false): boolean {
  if (!ix) {
    voiceReady();
    return false;
  }
  if (failed) return false;
  const k = keys.map((x) => x.toLowerCase()).filter((x) => ix!.p[x]);
  if (!k.length) return false;
  if (now) stopAll();
  Q.push({ ns: "p", keys: k, rate: 1, vol: 1, gap: 0.22 });
  pump();
  return true;
}
/** PA stinger for a commentary event key (broadcast.ts comment()). */
export function paEvent(e: string) {
  const k =
    e === "three" || e === "splash" ? "threeeee" : e === "and1" || e === "dunkAnd1" ? "and one" : e === "dunk" ? "dunk" : e === "timeout" ? "timeout" : e === "half" ? "halftime" : e === "qend" ? "end of the quarter" : e === "final" ? "final" : "";
  if (k) paSay([k]);
}
/** LIFE voice (radio / voicemail, LIFE_LINES keys): the bank's `l` clips, else browser speech of the same text.
 * Respects the announcer setting (V.ANNV: 2 AI, 1 browser speech, 0 off). */
export function lifeSay(keys: string[], now = false) {
  if (!V.ANNV) return false;
  if (V.ANNV === 2 && ix && !failed && ix.l) {
    const k = keys.filter((x) => ix!.l![x]);
    if (k.length === keys.length) {
      if (now) stopAll();
      Q.push({ ns: "l", keys: k, rate: 1, vol: 0.95, gap: 0.35 });
      pump();
      return true;
    }
  } else if (V.ANNV === 2 && !ix) voiceReady();
  try {
    if (typeof speechSynthesis === "undefined") return false;
    if (now) speechSynthesis.cancel();
    for (const k of keys) if (LIFE_LINES[k]) speechSynthesis.speak(new SpeechSynthesisUtterance(LIFE_LINES[k]));
    return true;
  } catch {
    return false;
  }
}
/** Lineup intro card: "Number 30 ... Curry!" (short = surname only, for the quick 5v5 cards). */
export function paIntro(num: number, name: string, short: boolean) {
  const n = vnorm(name);
  paSay(short ? [n] : ["number", String(num), n], true);
}
/** Test / debug readout. */
export const voiceInfo = () => (ix ? { c: Object.keys(ix.c).length, p: Object.keys(ix.p).length, voices: ix.voices, failed } : { failed });
/** The AI voice is talking (game.ts ducks the crowd / music like it does for browser speech). */
export const voiceBusy = () => busy;
// warm up after the page settles so the first call of the game already has the bank
if (typeof window !== "undefined") setTimeout(() => voiceReady(), 1500);

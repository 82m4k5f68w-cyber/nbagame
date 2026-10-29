// Shared between the voice-bank pipeline (scripts/assets/voice.ts) and the runtime player (client/voice.ts):
// a spoken line is matched against the bank word by word, so both sides must normalize text the same way.
/** Lowercase words only: "Curry from downtown... BANG!" -> "curry from downtown bang". */
export function vnorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/&/g, " and ")
    .replace(/(\d)-(\d)/g, "$1 $2")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/** Bank blob layout: "H2KV" | u32 LE index length | index JSON (utf-8) | clip bytes (each a mono Opus/WebM file). */
export type VoiceIndex = {
  v: 1;
  /** codec of every clip, e.g. 'audio/webm;codecs=opus' */
  mime: string;
  /** longest key in words (greedy matcher bound) */
  mw: number;
  /** commentary voice: key -> [offset, length, duration ms] (offsets relative to the data start) */
  c: Record<string, [number, number, number]>;
  /** PA announcer voice, same layout */
  p: Record<string, [number, number, number]>;
  /** LIFE radio + voicemail voice (optional: older banks have none) */
  l?: Record<string, [number, number, number]>;
  voices: { c: string; p: string; l?: string };
};
export function parseBank(buf: ArrayBuffer): { ix: VoiceIndex; data: Uint8Array } {
  const u = new Uint8Array(buf);
  if (u.length < 8 || String.fromCharCode(u[0], u[1], u[2], u[3]) !== "H2KV") throw new Error("not a voice bank");
  const n = u[4] | (u[5] << 8) | (u[6] << 16) | (u[7] << 24);
  const ix = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + n))) as VoiceIndex;
  return { ix, data: u.subarray(8 + n) };
}
/** Greedy longest match of a line against the bank keys; null when any word is missing (caller falls back). */
export function matchLine(s: string, keys: Record<string, unknown>, mw: number): string[] | null {
  const w = vnorm(s).split(" ").filter(Boolean),
    out: string[] = [];
  for (let i = 0; i < w.length; ) {
    let hit = 0;
    for (let n = Math.min(mw, w.length - i); n > 0; n--) {
      const k = w.slice(i, i + n).join(" ");
      if (Object.prototype.hasOwnProperty.call(keys, k)) {
        out.push(k);
        hit = n;
        break;
      }
    }
    if (!hit) return null;
    i += hit;
  }
  return out.length ? out : null;
}

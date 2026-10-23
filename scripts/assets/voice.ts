// Voice bank pipeline: Piper TTS -> trimmed mono Opus/WebM clips -> one binary blob with an index.
//   PATH=/home/user/tools/bin:$PATH npx tsx scripts/assets/voice.ts [--force] [--kbps 24]
// Output: assets/voice/bank.bin (inlined by src/client/voice.ts) + assets/voice/manifest.json (key -> spoken text).
// Lines come from the live sources, so re-running picks up new commentary:
//   - broadcast.ts LINES / RISE / TAIL templates, split around their ${...} slots (names are separate clips)
//   - every player surname (data.ts TM + the generated reserves RNAME in sim.ts), team names, numbers 0-99
//   - sim strings that reach commentary (play / set names, defenses, game plans, violations)
//   - a PA announcer set (second voice, arena echo): "Threeeee!", "And one!", lineup intro words, etc.
// Voices (public domain / CC0 datasets, see assets/LICENSES.md): commentary en_US-joe-medium, PA en_US-norman-medium.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { TM } from "../../src/core/data";
import { vnorm, type VoiceIndex } from "../../src/client/voicekey";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TOOLS = process.env.H2K_TOOLS || "/home/user/tools";
const PY = `${TOOLS}/venv/bin/python`;
const VC = process.env.H2K_VOICE_C || "en_US-joe-medium",
  VP = process.env.H2K_VOICE_P || "en_US-norman-medium";
const CACHE = path.join(ROOT, "scripts/assets/.cache/voice"),
  OUT = path.join(ROOT, "assets/voice");
const argv = process.argv.slice(2),
  FORCE = argv.includes("--force"),
  KBPS = +(argv[argv.indexOf("--kbps") + 1] || 0) || 24,
  BUDGET = 3 * 1024 * 1024;
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- 1. template literal fragments from broadcast.ts ----------
/** All string pieces of the JS/TS source region: plain strings and the literal parts of template strings. */
function pieces(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const str = (q: string) => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") (s += src[i + 1]), (i += 2);
      else s += src[i++];
    }
    i++;
    return s;
  };
  const tpl = () => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") (s += src[i + 1]), (i += 2);
      else if (src[i] === "$" && src[i + 1] === "{") {
        out.push(s), (s = "");
        i += 2;
        let d = 1;
        while (i < src.length && d > 0) {
          const c = src[i];
          if (c === "`") tpl();
          else if (c === '"' || c === "'") out.push(str(c));
          else (c === "{" ? d++ : c === "}" ? d-- : 0), i++;
        }
      } else s += src[i++];
    }
    out.push(s);
    i++;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") while (i < src.length && src[i] !== "\n") i++;
    else if (c === "`") tpl();
    else if (c === '"') out.push(str(c));
    else i++;
  }
  return out;
}
const bc = fs.readFileSync(path.join(ROOT, "src/client/broadcast.ts"), "utf8");
const region = (a: string, b: string) => {
  const s = bc.indexOf(a),
    e = bc.indexOf(b, s);
  if (s < 0 || e < 0) throw new Error("broadcast.ts: cannot find " + a);
  return bc.slice(s, e);
};
// keys of LINES/RISE/TAIL objects themselves are identifiers, not strings, so only spoken text is collected
const comm = [...pieces(region("const LINES", "const CAP")), ...pieces(region("const RISE", "const BIG"))];

// ---------- 2. sim strings that end up inside commentary ----------
const sim = fs.readFileSync(path.join(ROOT, "src/core/sim.ts"), "utf8");
const arr = (name: string) => {
  const m = new RegExp(`(?:const|,)\\s*${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(sim);
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : [];
};
const RNAME = arr("RNAME");
const simText = [
  ...arr("GPN"),
  ...arr("DSN"),
  ...arr("PCN"),
  ...arr("COVN"),
  ...[...sim.matchAll(/violation\([^,]*,\s*"([^"]+)"/g)].map((m) => m[1]),
  ...sim
    .split("\n")
    .filter((l) => /\bmk\(/.test(l))
    .flatMap((l) => [...l.matchAll(/"([A-Z][A-Z &:'-]+)"/g)].map((m) => m[1])),
];
const players = [...new Set([...TM.flatMap((t) => t[2].map((p) => p[0])), ...RNAME])];
const teams = [...new Set([...TM.map((t) => t[0]), "Team Gold", "Team Ice"])];

// ---------- 3. the job list ----------
type Job = { key: string; text: string; v: "c" | "p"; ls: number; fx?: string };
const jobs = new Map<string, Job>();
/** Speakable text: em dashes -> commas, SHOUTED words -> normal case (Piper spells unknown capitals). */
const speakable = (s: string) =>
  s
    .replace(/[—–]/g, ", ")
    .replace(/\b[A-Z]{2,}\b/g, (w) => (/^(MVP|ATO)$/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .replace(/^[\s,.;:!?]+/, "")
    .trim();
function add(v: "c" | "p", text: string, ls = 1, key = vnorm(text), fx?: string) {
  if (!key) return;
  const id = v + ":" + key;
  if (!jobs.has(id)) jobs.set(id, { key, text: speakable(text) || text, v, ls, fx });
}
const hype = new Set(["bang", "got it", "count it", "yes", "splash", "nothing but net", "wet"]);
for (const s of comm) if (vnorm(s)) add("c", s, hype.has(vnorm(s)) ? 0.85 : 0.95);
for (const s of simText) add("c", s.toLowerCase(), 0.95);
for (const n of players) add("c", n + ".", 0.95);
for (const t of teams) add("c", t + ".", 0.95);
for (let k = 0; k < 100; k++) add("c", String(k) + ".", 0.95);
// glue words commentary sentences commonly need around names (keeps more lines on the AI voice)
for (const s of ["the", "and", "for three", "to", "with the", "on", "is", "has", "are", "a", "of"]) add("c", s, 0.95);

// PA announcer: arena echo, slower. Keys live in their own namespace (index.p).
const ECHO = "aecho=0.8:0.55:70|140:0.28|0.14";
const PA: [string, string, number][] = [
  ["threeeee", "Threeeee!", 1.6],
  ["three", "Three!", 1.25],
  ["and one", "And one!", 1.2],
  ["from downtown", "From downtown!", 1.15],
  ["dunk", "Slam dunk!", 1.15],
  ["swish", "Swish!", 1.2],
  ["number", "Number", 1.1],
  ["ladies and gentlemen", "Ladies and gentlemen!", 1.15],
  ["your starting lineup", "And now, your starting lineup!", 1.15],
  ["the visitors", "For the visitors,", 1.1],
  ["and for your", "And for your", 1.1],
  ["versus", "versus", 1.1],
  ["at guard", "At guard,", 1.1],
  ["at forward", "At forward,", 1.1],
  ["at center", "At center,", 1.1],
  ["timeout", "Timeout!", 1.15],
  ["defense", "Dee-fense!", 1.2],
  ["make some noise", "Make some noise!", 1.15],
  ["get loud", "Get loud!", 1.15],
  ["foul on", "Foul on", 1.1],
  ["basket by", "Basket by", 1.1],
  ["block by", "Blocked by", 1.1],
  ["two minutes", "Two minutes remaining in the quarter.", 1.1],
  ["one minute", "One minute remaining.", 1.1],
  ["final", "That's the final!", 1.1],
  ["overtime", "We're going to overtime!", 1.1],
  ["halftime", "That's halftime!", 1.1],
];
for (const [k, t, ls] of PA) add("p", t, ls, k, ECHO);
for (const n of players) add("p", n + "!", 1.15, vnorm(n), ECHO);
for (const t of teams) add("p", "the " + t + "!", 1.15, vnorm(t), ECHO);
for (let k = 0; k < 100; k++) add("p", String(k) + ",", 1.1, String(k), ECHO);

// ---------- 4. render (cached by text + settings) ----------
const voicePath = (v: string) => `${TOOLS}/voices/${v === "c" ? VC : VP}.onnx`;
const hash = (j: Job) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify([j.text, j.v === "c" ? VC : VP, j.ls, j.fx || "", KBPS, 3]))
    .digest("hex")
    .slice(0, 16);
const all = [...jobs.values()];
const need = all.filter((j) => FORCE || !fs.existsSync(path.join(CACHE, hash(j) + ".webm")));
console.log(`voice: ${all.length} clips (${all.filter((j) => j.v === "p").length} PA), ${need.length} to render`);
if (need.length) {
  if (!fs.existsSync(PY)) throw new Error(`Piper venv missing: run bash scripts/assets/setup.sh python voices`);
  const jl = path.join(CACHE, "jobs.jsonl");
  fs.writeFileSync(
    jl,
    need.map((j) => JSON.stringify({ voice: voicePath(j.v), text: j.text, out: path.join(CACHE, hash(j) + ".wav"), ls: j.ls, ns: 0.6, nw: 0.7 })).join("\n"),
  );
  execFileSync(PY, [path.join(ROOT, "scripts/assets/piper_batch.py"), jl], { stdio: "inherit" });
  // trim silence, (PA) echo, loudness, mono 24 kHz Opus in WebM; 4 encoders in parallel
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse";
  const enc = (j: Job) =>
    new Promise<void>((res, rej) => {
      const h = hash(j),
        af = [trim, j.fx, "apad=pad_dur=0.04", "loudnorm=I=-16:TP=-1.5:LRA=11"].filter(Boolean).join(",");
      execFile(
        "ffmpeg",
        ["-y", "-v", "error", "-i", path.join(CACHE, h + ".wav"), "-af", af, "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", KBPS + "k", "-application", "voip",
          "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "webm", path.join(CACHE, h + ".webm")],
        (e) => (e ? rej(e) : (fs.rmSync(path.join(CACHE, h + ".wav"), { force: true }), res())),
      );
    });
  const q = need.slice();
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let j; (j = q.shift()); ) await enc(j);
    }),
  );
}

// ---------- 5. pack ----------
const dur = (f: string) => {
  const o = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim();
  return Math.round(+o * 1000) || 0;
};
const ix: VoiceIndex = { v: 1, mime: "audio/webm;codecs=opus", mw: 1, c: {}, p: {}, voices: { c: VC, p: VP } };
const parts: Buffer[] = [];
let off = 0,
  ms = 0;
const manifest: Record<string, string> = {};
for (const j of all.sort((a, b) => (a.v + a.key < b.v + b.key ? -1 : 1))) {
  const f = path.join(CACHE, hash(j) + ".webm"),
    b = fs.readFileSync(f),
    d = dur(f);
  ix[j.v][j.key] = [off, b.length, d];
  ix.mw = Math.max(ix.mw, j.key.split(" ").length);
  parts.push(b);
  off += b.length;
  ms += d;
  manifest[j.v + ":" + j.key] = j.text;
}
const js = Buffer.from(JSON.stringify(ix)),
  head = Buffer.alloc(8);
head.write("H2KV", 0, "latin1");
head.writeUInt32LE(js.length, 4);
const blob = Buffer.concat([head, js, ...parts]);
fs.writeFileSync(path.join(OUT, "bank.bin"), blob);
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ voices: ix.voices, kbps: KBPS, clips: all.length, seconds: Math.round(ms / 1000), bytes: blob.length, lines: manifest }, null, 1));
console.log(`voice bank: ${all.length} clips, ${(ms / 1000).toFixed(0)} s audio, index ${(js.length / 1024).toFixed(0)} KB, total ${(blob.length / 1048576).toFixed(2)} MB (base64 in the build ~${((blob.length * 4) / 3 / 1048576).toFixed(2)} MB)`);
if (blob.length > BUDGET) {
  console.error(`over the ${BUDGET / 1048576} MB budget: lower --kbps or trim the PA set`);
  process.exit(1);
}

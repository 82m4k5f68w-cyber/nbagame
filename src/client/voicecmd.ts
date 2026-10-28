// Voice commands (beta, OFF by default; Settings -> Audio -> Voice commands). Hold ` (Backquote) and speak:
//   "timeout" · "sub" / "substitution" · "call horns" / "call spain" / "call post (up)" · "switch" · "pause"
// Speech-to-text = Whisper tiny.en (ONNX, q8) in the browser via transformers.js, downloaded ONLY when the player turns
// the setting on: ~41 MB of model files from huggingface.co (Xenova/whisper-tiny.en) + transformers.js (~0.6 MB) and
// the ONNX Runtime wasm (~24 MB) from cdn.jsdelivr.net, cached by the browser after the first time. Audio never leaves
// the device. The microphone is requested only from that click. Hosts that block outside downloads (e.g. the
// claude.ai artifact) show "voice commands unavailable". tests/voicecmd.ts runs the same model offline (Piper speaks, Whisper hears).
import * as G from "../core/sim";
import { KMAP } from "./input";
import { banner } from "./broadcast";

import { parseCommand, type Cmd } from "./voicecmdparse";
export { parseCommand, type Cmd };
const PCX = { horns: 5, spain: 6, post: 7 } as const; // sim PCN indices (HORNS / SPAIN PICK & ROLL / POST UP)
function tap(code: string) {
  dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true }));
  setTimeout(() => dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true })), 120);
}
/** Carry out a command as the player would (same keys, so online / pause rules apply). */
export function runCommand(c: Cmd, team = (G.CT[0] && G.CT[0].tm) || 0) {
  if (c.cmd === "timeout") tap(KMAP.to);
  else if (c.cmd === "switch") tap(KMAP.q);
  else if (c.cmd === "pause" || c.cmd === "sub") (tap("Escape"), c.cmd === "sub" && banner("SUBSTITUTION", "PICK FROM THE PAUSE MENU"));
  else if (c.cmd === "call" && c.arg) {
    G.TS.pc[team] = PCX[c.arg];
    banner("PLAY CALL", c.arg === "horns" ? "HORNS" : c.arg === "spain" ? "SPAIN PICK & ROLL" : "POST UP");
  }
}

export const VC = {
  model: "Xenova/whisper-tiny.en",
  lib: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.web.min.js",
  pushKey: "Backquote",
  on: false,
  state: "off" as "off" | "loading" | "ready" | "listening" | "error",
  last: "",
};
let asr: any = null,
  rec: MediaRecorder | null = null,
  chunks: Blob[] = [],
  stream: MediaStream | null = null;
/** 16 kHz mono Float32 from a recorded blob (what Whisper expects). */
async function toPcm16k(b: Blob): Promise<Float32Array> {
  const ac = new OfflineAudioContext(1, 16000, 16000),
    buf = await ac.decodeAudioData(await b.arrayBuffer()),
    oc = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000),
    s = oc.createBufferSource();
  s.buffer = buf;
  s.connect(oc.destination);
  s.start();
  return (await oc.startRendering()).getChannelData(0);
}
/** Transcribe 16 kHz PCM with an already-built pipeline (lab + tests can pass their own). */
export async function transcribe(pcm: Float32Array, pipe = asr): Promise<string> {
  const r = await pipe(pcm);
  return String((r && r.text) || "").trim();
}
/** Turn voice commands on (MUST be called from a click: asks for the microphone, downloads the model once). */
export async function enableVoiceCommands(loader?: () => Promise<any>): Promise<boolean> {
  if (VC.on) return true;
  VC.state = "loading";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const T = loader ? await loader() : await import(/* @vite-ignore */ VC.lib);
    asr = asr || (await T.pipeline("automatic-speech-recognition", VC.model, { dtype: "q8" }));
    VC.on = true;
    VC.state = "ready";
    addEventListener("keydown", down, true);
    addEventListener("keyup", up, true);
    banner("VOICE COMMANDS ON", "HOLD ` AND SPEAK");
    return true;
  } catch (e) {
    VC.state = "error";
    banner("VOICE COMMANDS UNAVAILABLE", String((e as any)?.name || "download blocked").toUpperCase());
    disableVoiceCommands();
    return false;
  }
}
export function disableVoiceCommands() {
  VC.on = false;
  if (VC.state !== "error") VC.state = "off";
  removeEventListener("keydown", down, true);
  removeEventListener("keyup", up, true);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
function down(e: KeyboardEvent) {
  if (e.code !== VC.pushKey || e.repeat || !stream || rec) return;
  e.preventDefault();
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = (ev) => chunks.push(ev.data);
  rec.onstop = async () => {
    rec = null;
    try {
      const text = await transcribe(await toPcm16k(new Blob(chunks, { type: chunks[0]?.type || "audio/webm" })));
      VC.last = text;
      const c = parseCommand(text);
      if (c) runCommand(c);
      else banner("DIDN'T CATCH THAT", text.slice(0, 40).toUpperCase());
    } catch {}
    VC.state = "ready";
  };
  rec.start();
  VC.state = "listening";
}
function up(e: KeyboardEvent) {
  if (e.code === VC.pushKey && rec) (e.preventDefault(), rec.stop());
}

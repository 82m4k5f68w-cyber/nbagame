// Voice commands: parseCommand on typed phrases, then the real chain offline - Piper speaks the commands, Whisper
// tiny.en (the same ONNX files the browser downloads, transformers.js on onnxruntime-node) transcribes them, and
// parseCommand must recover every command. The ASR part needs the tools (scripts/assets/setup.sh) + the model files in
// scripts/assets/.cache/hf (fetched by the curl line in docs/ASSETS.md); it is skipped with a note when they're missing.
//   npx tsx tests/voicecmd.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { parseCommand } from "../src/client/voicecmdparse";

let bad = 0;
const eq = (a: any, b: any, m: string) => (JSON.stringify(a) === JSON.stringify(b) ? 0 : (bad++, console.log("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b))));
const T: [string, any][] = [
  ["Timeout!", { cmd: "timeout" }],
  ["call a time out", { cmd: "timeout" }],
  ["Call horns.", { cmd: "call", arg: "horns" }],
  ["run spain", { cmd: "call", arg: "spain" }],
  ["Post up!", { cmd: "call", arg: "post" }],
  ["call post", { cmd: "call", arg: "post" }],
  ["Sub.", { cmd: "sub" }],
  ["substitution please", { cmd: "sub" }],
  ["Switch.", { cmd: "switch" }],
  ["pause the game", { cmd: "pause" }],
  ["nice shot", null],
];
for (const [s, want] of T) eq(parseCommand(s), want, `parse "${s}"`);

const TOOLS = process.env.H2K_TOOLS || "/home/user/tools",
  HF = path.resolve("scripts/assets/.cache/hf"),
  M = path.join(HF, "Xenova/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx"),
  VOICE = `${TOOLS}/voices/en_US-joe-medium.onnx`;
if (!fs.existsSync(M) || !fs.existsSync(VOICE)) console.log("asr: skipped (model / Piper voice missing)");
else {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "vcmd-"));
  const said: [string, any][] = [
    ["Timeout.", { cmd: "timeout" }],
    ["Call horns.", { cmd: "call", arg: "horns" }],
    ["Run Spain.", { cmd: "call", arg: "spain" }],
    ["Call post up.", { cmd: "call", arg: "post" }],
    ["Substitution.", { cmd: "sub" }],
    ["Switch player.", { cmd: "switch" }],
    ["Pause the game.", { cmd: "pause" }],
  ];
  fs.writeFileSync(path.join(tmp, "jobs.jsonl"), said.map(([s], i) => JSON.stringify({ voice: VOICE, text: s, out: path.join(tmp, i + ".wav"), ls: 1 })).join("\n"));
  execFileSync(`${TOOLS}/venv/bin/python`, ["-I", "scripts/assets/piper_batch.py", path.join(tmp, "jobs.jsonl")], { stdio: "ignore" });
  const { pipeline, env } = await import("@huggingface/transformers");
  Object.assign(env, { localModelPath: HF + "/", allowRemoteModels: false, allowLocalModels: true });
  const asr: any = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", { dtype: "q8" });
  for (const [i, [s, want]] of said.entries()) {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(tmp, i + ".wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const t0 = performance.now(),
      text = String((await asr(pcm)).text || "").trim();
    console.log(`  said "${s}" -> heard "${text}" (${(performance.now() - t0).toFixed(0)} ms)`);
    eq(parseCommand(text), want, `asr "${s}"`);
  }
  fs.rmSync(tmp, { recursive: true });
}
console.log(bad ? `voicecmd: ${bad} FAILED` : "voicecmd OK");
process.exit(bad ? 1 : 0);

"""Batch Piper TTS: load each voice once, render many lines.

  h2kpy scripts/assets/piper_batch.py jobs.jsonl
Each job line: {"voice": "/path/model.onnx", "text": "...", "out": "/path/x.wav", "ls": 1.0, "vol": 1.0}
Existing outputs are skipped (the voice pipeline caches by text + settings hash).
"""
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig


def main(path: str) -> None:
    jobs = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    voices: dict = {}
    done = 0
    for j in jobs:
        v = voices.get(j["voice"])
        if v is None:
            v = voices[j["voice"]] = PiperVoice.load(j["voice"])
        cfg = SynthesisConfig(length_scale=float(j.get("ls", 1.0)), volume=float(j.get("vol", 1.0)),
                              noise_scale=float(j.get("ns", 0.667)), noise_w_scale=float(j.get("nw", 0.8)))
        with wave.open(j["out"], "wb") as wf:
            v.synthesize_wav(j["text"], wf, syn_config=cfg)
        done += 1
        if done % 50 == 0:
            print(f"  piper {done}/{len(jobs)}", flush=True)
    print(f"  piper {done} clips", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])

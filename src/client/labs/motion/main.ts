// Motion Studio (lab page; MediaPipe Pose Landmarker lite, wasm + model inlined: no CDN). Landmarks -> the joint
// channels retarget.ts produces (thighs tL/tR, knees kL/kR, upper arms aL/aR, elbows eL/eR; radians) drawn live.
// Record -> Export JSON ({fps, world: [frame][33][x,y,z], image: [frame][33][x,y]}) -> video2bvh.py move.json move.bvh.
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmGz from "virtual:gz:@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm";
import loaderGz from "virtual:gz:@mediapipe/tasks-vision/wasm/vision_wasm_internal.js";
import modelGz from "virtual:gz:tools/models/pose_landmarker_lite.task";
import sampleUrl from "../../../../assets/mocap/sample_jog.webm?inline";

const M: any = ((window as any).__MOTION = { ready: false, frames: 0, found: 0, ch: {} as Record<string, number[]>, errors: [] as string[] });
const $ = (id: string) => document.getElementById(id) as any;
const out = $("out"),
  v = $("v") as HTMLVideoElement,
  ov = ($("ov") as HTMLCanvasElement).getContext("2d")!,
  plot = ($("plot") as HTMLCanvasElement).getContext("2d")!;
const gunzip = async (b64: string) => new Response(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
const url = async (b64: string, type: string) => URL.createObjectURL(new Blob([await gunzip(b64)], { type }));

const CH = ["tL", "tR", "kL", "kR", "aL", "aR", "eL", "eR"],
  COL = ["#ff7a59", "#ffb347", "#59c3ff", "#7cf0c8", "#c38bff", "#ff8bd1", "#f2e85c", "#9fe870"];
for (const k of CH) M.ch[k] = [];
type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  ang = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z) || 1))));
/** World landmarks (MediaPipe: y down) -> our channels: bend angles between bones, swing from the trunk axis. */
function channels(w: V3[]) {
  const hip = { x: (w[23].x + w[24].x) / 2, y: (w[23].y + w[24].y) / 2, z: (w[23].z + w[24].z) / 2 },
    sh = { x: (w[11].x + w[12].x) / 2, y: (w[11].y + w[12].y) / 2, z: (w[11].z + w[12].z) / 2 },
    down = sub(hip, sh); // trunk axis pointing down
  return {
    tL: ang(down, sub(w[25], w[23])), tR: ang(down, sub(w[26], w[24])),
    kL: ang(sub(w[25], w[23]), sub(w[27], w[25])), kR: ang(sub(w[26], w[24]), sub(w[28], w[26])),
    aL: ang(down, sub(w[13], w[11])), aR: ang(down, sub(w[14], w[12])),
    eL: ang(sub(w[13], w[11]), sub(w[15], w[13])), eR: ang(sub(w[14], w[12]), sub(w[16], w[14])),
  } as Record<string, number>;
}
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
let lm: PoseLandmarker | null = null,
  recording = false,
  rec: { world: number[][][]; image: number[][][]; t: number[] } = { world: [], image: [], t: [] },
  lastT = -1;
function draw(res: any) {
  ov.clearRect(0, 0, 480, 480);
  const L = res.landmarks?.[0];
  if (L) {
    ov.strokeStyle = "#ffd23f";
    ov.lineWidth = 3;
    const vw = v.videoWidth || 1, vh = v.videoHeight || 1, s = Math.min(480 / vw, 480 / vh), ox = (480 - vw * s) / 2, oy = (480 - vh * s) / 2;
    for (const [a, b] of BONES) {
      ov.beginPath();
      ov.moveTo(ox + L[a].x * vw * s, oy + L[a].y * vh * s);
      ov.lineTo(ox + L[b].x * vw * s, oy + L[b].y * vh * s);
      ov.stroke();
    }
  }
  plot.fillStyle = "#0d1124";
  plot.fillRect(0, 0, 480, 480);
  CH.forEach((k, i) => {
    const a = M.ch[k].slice(-240);
    plot.strokeStyle = COL[i];
    plot.lineWidth = 2;
    plot.beginPath();
    a.forEach((y: number, j: number) => (j ? plot.lineTo : plot.moveTo).call(plot, (j / Math.max(1, a.length - 1)) * 480, 470 - (y / 2.2) * 440));
    plot.stroke();
    plot.fillStyle = COL[i];
    plot.fillText(k, 8 + i * 30, 14);
  });
}
function loop() {
  if (lm && v.readyState >= 2 && v.currentTime !== lastT) {
    lastT = v.currentTime;
    const res = lm.detectForVideo(v, performance.now());
    M.frames++;
    const w = res.worldLandmarks?.[0];
    if (w) {
      M.found++;
      const c = channels(w);
      for (const k of CH) M.ch[k].push(c[k]);
      if (recording) (rec.t.push(v.currentTime), rec.world.push(w.map((p) => [p.x, p.y, p.z])), rec.image.push(res.landmarks[0].map((p) => [p.x, p.y * (v.videoHeight / v.videoWidth)])));
    }
    draw(res);
    out.textContent = `frames ${M.frames} · pose found ${M.found} · ${recording ? "RECORDING " + rec.world.length : "not recording"}`;
  }
  v.requestVideoFrameCallback ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
}
async function start(src: MediaStream | string) {
  if (typeof src === "string") (v.srcObject = null), (v.src = src), (v.loop = true);
  else v.srcObject = src;
  await v.play();
  loop();
}
(async () => {
  try {
    const t0 = performance.now();
    lm = await PoseLandmarker.createFromOptions(
      { wasmLoaderPath: await url(loaderGz, "text/javascript"), wasmBinaryPath: await url(wasmGz, "application/wasm") },
      { baseOptions: { modelAssetBuffer: new Uint8Array(await gunzip(modelGz)), delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1 },
    );
    M.ready = true;
    M.loadMs = Math.round(performance.now() - t0);
    out.textContent = `pose model ready (${M.loadMs} ms). Pick a source.`;
  } catch (e: any) {
    M.errors.push(String(e?.message || e));
    out.textContent = "failed: " + e;
  }
})();
$("cam").onclick = async () => start(await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })); // permission only on this click
$("sample").onclick = () => start(sampleUrl);
$("rec").onclick = () => {
  recording = !recording;
  if (recording) rec = { world: [], image: [], t: [] };
  $("rec").textContent = recording ? "Stop" : "Record";
  $("save").disabled = recording || !rec.world.length;
};
$("save").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ fps: rec.t.length > 1 ? (rec.t.length - 1) / Math.max(0.001, rec.t[rec.t.length - 1] - rec.t[0]) : 30, world: rec.world, image: rec.image })], { type: "application/json" }));
  a.download = "move.json";
  a.click();
};

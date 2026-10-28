# Asset & tool pipelines

Everything is reproducible: `bash scripts/assets/setup.sh` reinstalls the toolchain (the container is ephemeral),
then each pipeline below regenerates its outputs. Licences: `assets/LICENSES.md`.

## Toolchain (`scripts/assets/setup.sh [node|python|ml|voices|blender|ktx]`)

Tools live in `$H2K_TOOLS` (default `/home/user/tools`, outside the repo); add `export PATH=/home/user/tools/bin:$PATH`.

| Tool | Version | Used for |
|---|---|---|
| Blender (official tarball, headless) | 4.5.15 LTS | `scripts/assets/blender/*.py`: FBX/BVH/GLB conversion, procedural props, sprite sheets |
| KTX-Software (`toktx`, `ktx`) | 4.4.2 | KTX2 textures (ETC1S colour/roughness, UASTC normals) |
| FFmpeg (system) | 6.1.1 | Opus/WebM voice clips, texture crops, sample clips |
| Python venv: mediapipe | 1.1.1 | `video2bvh.py` (Pose Landmarker heavy) |
| piper-tts + 3 voices | 1.8.0 | voice bank (`voice.ts`), voice-command tests |
| onnxruntime (Python) | 1.31.0 | checks exported ONNX models |
| torch (CPU) + onnx | 2.14.1+cpu / 1.23.2 | offline training -> ONNX (`ml_tiny.py`; motion matching later) |
| openai-whisper | 20250625 | offline speech-to-text checks |
| pymeshlab | 2025.7 | `mesh_clean.py` (cleanup + decimation) |
| npm dev deps | see package.json | gltf-transform 4.5.1, meshoptimizer 1.3.0, xatlas-three 0.2.1 (+ xatlasjs), ktx2-encoder, n8ao, postprocessing, three-mesh-bvh, three-gpu-pathtracer, recast-navigation, tone, @pmndrs/detect-gpu, onnxruntime-web, @mediapipe/tasks-vision, @huggingface/transformers, vite-plugin-pwa + workbox, stats-gl, spectorjs, lil-gui |

System libraries the setup installs on Debian/Ubuntu: `libegl1 libgles2 libgl1 libopengl0` (MediaPipe / PyMeshLab).

## What is in the game build (single HTML, `dist/hoops2k27-hub.html`)

| Feature | Module | Size in the HTML |
|---|---|---|
| AI announcer + PA voice bank | `client/voice.ts` (+ `voicekey.ts`) | ~3.1 MB |
| Wood floor / asphalt KTX2 (graphics v6) | `client/gfxtex.ts` | (graphics agent) |
| Device probe (200 ms sim timing + detect-gpu tables) | `client/perfprobe.ts`, `probepick.ts`, `gpudetect.ts` | ~0.3 MB |
| PWA registration + install button | `client/pwa.ts` (+ `dist/sw.js`, `public/`) | < 10 KB |
| Voice commands (beta, off) | `client/voicecmd.ts`, `voicecmdparse.ts` | < 10 KB (engine downloaded on opt-in) |

Not in the game build: `client/tex/` (all 9 texture sets), `client/models.ts` (Kenney kits), `client/ml.ts`
(ONNX Runtime), `client/photomode.ts` (path tracer), `client/nav.ts` (recast), `client/devtools.ts` (dev server only).
Importing any of them adds its size (in the single-HTML build a dynamic `import()` is inlined too).

## Voice bank (`scripts/assets/voice.ts`)
`PATH=/home/user/tools/bin:$PATH npx tsx scripts/assets/voice.ts [--force] [--kbps 24]` reads the commentary
templates in `broadcast.ts` (LINES / RISE / TAIL, split around `${...}`), every surname (data.ts TM + sim.ts RNAME),
teams, numbers 0-99, set / defense / violation strings, and a PA set ("Threeeee!", "And one!", lineup words), renders
them with Piper, trims + loudness-normalises, encodes mono Opus 24 kbps WebM and packs `assets/voice/bank.bin`
(`H2KV` + u32 index length + JSON index + clips; 2.34 MB, budget 3 MB). Re-run after adding commentary lines
(`tests/assets.ts` fails when a template piece is missing). Runtime: `client/voice.ts` greedy-matches a line word by
word (`matchLine`), decodes clips on demand and plays them in sequence; any unknown word -> browser speech.
Settings -> Audio -> Announcer voice: AI / Browser / Off. Hooks: `broadcast.ts say()` (1 line), `comment()` (PA
stinger), `drawPlayerIntro` ("Number 30 ... Curry!").

## Textures (`scripts/assets/textures.ts`) — for the graphics wave
`npx tsx scripts/assets/textures.ts [--force]`: ambientCG 1K zips -> square crops -> KTX2 + 256 px WebP fallback in
`assets/textures/`, and `src/client/tex/manifest.gen.ts` (`?inline` imports; 2.36 MB base64, budget 4 MB).
Use: `const lib = await texLib(renderer); await lib.apply(mat, "brick", { repeat: [4, 2] })` (`client/tex/index.ts`;
WebGL or WebGPU, falls back to the WebP colour map). Sets: woodMaple, woodOak, woodParquet, asphalt, concrete, brick,
paintedMetal, fabric, rubber (`TEXSETS[name].use` says where each fits). Demo: Asset Lab below.

## Models (`scripts/assets/models.ts`) — for LIFE / arena props
`npx tsx scripts/assets/models.ts`: Kenney packs -> one GLB per kit (each model a named root node) -> dedup / weld /
meshopt. `const taxi = await model("cars", "taxi", { shadows: true })` (`client/models.ts`, ~1.1 MB if imported).
Kenney units are ~1 m. Kits:
- **city**: building-a/b/c/d/e/g/h/k, building-skyscraper-a/c, low-detail-building-a/b/wide-a, detail-awning, detail-parasol-a, building-type-a/b/c/e/h/o/t, fence-1x3, fence-low, planter, tree-large, tree-small, driveway-short, path-long
- **roads**: road-straight/bend/crossroad/intersection/end/side, construction-cone/barrier, dumpster, light-square, light-curved, traffic-light, road-sign-stop, electricity-pole, tile-low
- **cars**: sedan, suv, taxi, police, van, truck, hatchback-sports, ambulance, delivery, garbage-truck, firetruck, race, cone, box
- **furniture**: bench(+Cushion), chair(+Cushion, ModernCushion), stoolBar(+Square), table, tableRound, tableCoffee, loungeSofa, loungeChair, trashcan, speaker, televisionModern, pottedPlant, plantSmall1, lampSquareFloor, bookcaseOpen, bedSingle, bedDouble, desk, kitchenFridge/Stove/Sink/Bar, rugRectangle, cardboardBoxClosed, doorway, wall, wallWindow, floorFull, stairs, ceilingFan, laptop, computerScreen, radio
- **props** (`scripts/assets/props.sh`, separate GLBs with lightmap UVs): bleachers, scorer_table, corner_store

## Mesh tools
- `h2kpy scripts/assets/mesh_clean.py in.obj out.ply --ratio 0.25` (PyMeshLab): merge, clean, repair, quadric
  decimation, Hausdorff error report (63k -> 6.3k faces at 0.02% mean error on a test sculpt). Write PLY/STL.
- `npx tsx scripts/assets/uv_unwrap.ts in.glb out.glb --meshopt` (xatlas-three): one packed lightmap atlas for all
  meshes in TEXCOORD_1 (three `uv1` for aoMap / lightMap baking).

## Blender (headless, `blender -b --factory-startup -P <script> -- args`)
- `blender/fbx_bvh.py in.(fbx|bvh|glb) out.(bvh|fbx|glb)` — mocap conversion (Mixamo/Rokoko FBX -> BVH for
  retarget.ts; BVH -> FBX for Unity, -> GLB to preview). Blender writes Z-up BVH; retarget.ts detects that.
- `blender/build_prop.py bleachers|scorer_table|corner_store out.glb [--rows 6 --width 8 --floors 2]`
- `blender/sprites.py model.glb sheet.png [--angles 8 --size 128 --elev 30 --frames 0,10]` — Cycles CPU sprite sheet + JSON.

## Mocap
**Send a video of one move, full body in frame** (feet included, side or 3/4 view, steady camera, 2-10 s):
1. `h2kpy scripts/assets/video2bvh.py move.mp4 move.bvh` (MediaPipe Pose heavy -> fill gaps -> Gaussian smoothing ->
   root path from the 2D hip track scaled by leg length -> BVH with CMU joint names, frame 0 = T-pose). Also takes a
   Motion Studio export: `video2bvh.py move.json move.bvh`.
2. `npx tsx scripts/mocap/retarget.ts --bvh move.bvh --out move.curves.json --kind cycle|shot|jump|raw [--axis z|x] [--every N]`
   -> joint curves on our channels, **staged** (src/core/mocap.ts untouched: pose.ts / Unity parity).
Sample: `assets/mocap/sample_jog.*` (rendered from our own rig by `scripts/assets/sample_clip.mjs`). Round trip
BVH -> FBX -> BVH through Blender reproduces the retargeted curves within 0.012 rad.
CMU extras: `npx tsx scripts/mocap/cmu_extra.ts` staged 20 clips (dribbles 06_xx, runs 16_35/16_45, jumps 16_01,
13_11, 13_13, 02_04, in-place 13_17 / 02_05...) as 30 fps curves + `assets/mocap/cmu/index.json` (speed, hip lift,
kind). To use one in pose.ts, add it to retarget.ts's catalogue and re-check `scripts/unity/trace.ts POSE=1` parity.

## Labs (separate single-file pages, never in the game build)
`[LAB=tools|motion] npx vite build --config scripts/assets/demo.vite.ts`
- **Asset Lab** (`dist/assets-demo/`, 9.1 MB): textures, models, voice bank, detect-gpu. `tests/browser_assets.mjs`.
- **Tools Lab** (`dist/labs/tools/`, 7.4 MB): ONNX Runtime Web (gzip-inlined 14.8 MB wasm -> ~5 MB) runs
  `pose_mlp.onnx` = PyTorch to 2e-7; Tone.js offline synth; path-traced photo (`photomode.ts`). `tests/browser_tools.mjs`.
- **Motion Studio** (`dist/labs/motion/`, 12.3 MB: MediaPipe wasm 3.9 MB gz + pose_landmarker_lite 5.8 MB): webcam
  (permission on click) or the sample clip -> live landmarks + joint curves -> Record -> Export JSON -> video2bvh.
  `tests/browser_motion.mjs` (pose on 100% of sample frames, export -> BVH).

## Device probe (`client/perfprobe.ts`)
400 ms after the hub loads (skip: `?noprobe`, rerun: `?probe`): 200 ms of a real 5v5 sim (legacy ball) = ms/tick, plus
detect-gpu's benchmark tier (tables bundled, no CDN). `probepick.ts pickPreset`: tier 3 + < 0.9 ms Ultra, tier 2-3
High, tier 1 Chromebook; mobile caps at Balanced; CPU > 1.4 ms caps at Balanced, > 2.5 ms at Chromebook; unknown /
software GPU keeps view.ts's default. Applied only when the player never picked graphics and no game is running.
Crowd size follows the preset (render3d counts by V.QL); LIFE NPC count follows QL too, and `V.DEV.npc` (0.6 / 0.8 /
1) is the suggested density multiplier for `createWorld({ npc })` (LIFE agent). Cached in localStorage `h2k_probe`.

## LIFE navmesh (`client/nav.ts`, for the LIFE agent)
`const N = await (await import("./nav")).buildTownNav(PLACES, WORLD)` (~0.7 s, recast-navigation ~1 MB lazy);
`N.path(a, b)` returns corner points around buildings, `N.snap(p)`. tests/assets.ts: 7 door-to-door paths, 0 samples
inside a footprint. Not wired into `src/life/world.ts` (NPCs still use the sidewalk graph).

## PWA
`vite.config.ts` adds vite-plugin-pwa (generateSW, `injectRegister: false`, manifest from `public/`). `client/pwa.ts`
registers `sw.js` + the manifest only on http(s) localhost / https, top-level, not on claude.ai (`artifact.html` sets
`__H2K_ARTIFACT`). "Install app" appears in the hub header when the browser offers it; iOS meta tags + an inline
apple-touch-icon are in index.html. Pages are NetworkFirst-cached: offline play after one visit. `tests/browser_pwa.mjs`.

## Voice commands (beta, Settings -> Audio)
Off by default, never saved. Turning it on (a click) asks for the mic and downloads Whisper tiny.en (~41 MB, Hugging
Face) + transformers.js and its ONNX Runtime wasm (~25 MB, jsDelivr) once. Hold ` and say: timeout · sub · call horns /
spain / post · switch · pause (`voicecmdparse.ts`). Hosts that block downloads show "VOICE COMMANDS UNAVAILABLE".
`tests/voicecmd.ts`: Piper speaks the commands, the same Whisper ONNX model (Node) hears them, all parse correctly.
Model files for the test: `scripts/assets/setup.sh ml` (into scripts/assets/.cache/hf).

## Dev tools (`npm run dev`, open `/?dev`)
stats-gl FPS graph, lil-gui (graphics level, HSR, AO, grade, camera, sim cfg), Spector.js frame capture. Imported
behind `import.meta.env.DEV`: absent from production builds.

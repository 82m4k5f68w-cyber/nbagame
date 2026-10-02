# Hoops 2K27 — project guide (read this first)

Browser basketball game: 5v5 and 1v1, full court, 3D (three.js + Rapier) and 2D, plus a Classic side-view 1v1.
Everything ships as ONE self-contained HTML file (`dist/hoops2k27-hub.html`, ~5.8 MB: three.js + Rapier inlined, no CDN).
Unofficial fan project; rosters/ratings are approximations (7 teams, 35 players, 2026-27 era).

## Layout
- `src/hub/template.html` — the menu (modes, update log, controls). `__G__` is replaced with a JSON map of all modes.
- `src/modes/<mode>/index.html` + `game.js` — one folder per mode: `5v5-3d 5v5-2d 1v1-3d 1v1-2d classic`.
- `libs/` — three.min.js (r149) and rapier.iife.js (@dimforge/rapier3d-compat 0.12, bundled with esbuild).
- `build.py` — inlines libs + game.js into each mode, embeds modes in the hub -> `dist/`. `dist/modes/*.html` are standalone.
- `tests/` — node logic harnesses + Playwright browser tests (see tests/README.md). `docs/` — screenshots.

## IMPORTANT: the four main modes are near-identical copies
`5v5-3d, 5v5-2d, 1v1-3d, 1v1-2d` were produced by patching one codebase (NP = players per team, 5 or 1; 3D adds a renderer).
Diffs: `const NP=`, the render code (3D: `glInit/GL`, `pose3`, `segs`, `scene`; 2D: `court/dp/drawBall/netD`), menu camera/graphics rows.
The original patch scripts were not kept. FIRST TASK: refactor into one shared core module + flags (NP, renderer), keep behavior identical.
`classic` is a separate, older engine (side view); leave it as legacy.

## World model (game coordinates)
x 0..940, y 0..500 (10 px = 1 ft), z up in px (rim z=100). Hoops at x=52.5 and 887.5, y=250 (`HXs`, `HY`).
Team 0 (you) attacks the RIGHT hoop (`hoop(t)`). `g=320`, ball radius `BR=3.9`, rim radius `RR=7.5`.
3D world (feet): `W3(x,y,z)=[(x-470)*.1, z*.1, (y-250)*.1]`.

## Loop
`loop` (rAF) -> fixed 60 Hz `upd(1/60)` accumulator (max 6 steps) -> `draw()`.
`upd`: replay check -> `gpPoll` -> input (`hum`, `hum2` for local P2) -> `ai(p)` for non-human players -> `step(p)` for all ->
`collide` -> `bstep` x2 (ball, Rapier when `RAP`) -> `ftTick` -> `netSim` -> `recFrame` -> clocks/quarters/turnovers.

## Where things live (function names in game.js)
- Roster/ratings: `TM` (tuple `[name,3pt,inside,speed,def,jump,style,skin,hair,beard,height,build,number]`), `OV` (OVR), `SIG` (signature shot tweaks), `MYP` (My Player, saved in localStorage `h2k_myp`).
- Shooting: `step` ('c' charge, 's' shot) -> `launch(p)`. Green window: `win=(.07+rating/100*.05)*(1-.45*contest)`; meter ideal .6 (.45 quick style). Green is at the TOP of the meter. Only greens go in for jumpers; layups/hooks are rating-based. Tempo mode = tap SPACE twice (`TEMPO`).
- Contest: `contestOf(p)`, `contestFx`, locked at release (`p.cw`). Meters: `meter(p)` (4 styles, `METER`).
- Aim: `launch` solves a parabola, then (3D+Rapier) pre-simulates with drag+Magnus and corrects range AND sideways error. This is why greens still go in with real physics.
- Physics: `bstep` (legacy ball) vs `rapInit/rapStep` (Rapier ball, rim = 24 capsules, board, floor, walls). Players are NOT Rapier bodies yet (`collide` is custom).
- Net: `NETS/netSim/drawNet` (verlet mesh; ball pushes points).
- Animation (3D): `pose3(p)` writes joint angles to `p.q`; clips `CL/clip/pickClip` (jump, quick, fade, step, float, lay, dunk, euro, hop, curry, hook); locomotion/IK block inside `pose3`; rig + `apply` in `glInit`. `GL.hand(p)` gives the real hand position used for release.
- Rules: `foul/startFT/ftLay/ftTick/ftIn/tech`, shot clock, quarters (4 x 60 s real time), inbounds (`inb`), bonus after 5 team fouls, `endGame` + box score (`p.stt`).
- AI: `ai(p)` (handler: shoot/pass/drive, step-backs, dribble moves), `offBall` (pindowns/ball screens/switches; Curry `SIG.Curry.off`), `cut`, `loose` (rebounding), defense inside `ai` (no full-court press, no steals).
- Passing: `pass(p,r,type)` chest/bounce/lob + in-flight steering; `pick` chooses target from stick direction.
- Dribble/post: `i.mv` 1/2/3 (hesitation/spin/BTB), flick-to-cross, post (`i.post`, hook/drop-step/turnaround).
- 3D rendering: `glInit` builds scene (court texture, crowd InstancedMesh, jumbotron, hoops, net, rig); `GL.render` (cameras `CAMM` 0-3, quality `QL`, auto-downgrade). Canvas fallback if WebGL fails.
- HUD: 2D canvas `#h` over the WebGL canvas `#c` (must stay transparent!). `pr(x,y,z)` projects with the active camera.
- Replays: `REC` ring buffer, `startReplay/rplStep` (3D only). Input: keyboard, touch buttons `#tc`, gamepad `gpPoll` (wrapped: blocked in iframes by permissions policy).

## Lessons learned (do not repeat)
- A solid background on `#h` hid the whole 3D view (black screen). `#h` must be transparent.
- `getGamepads()` throws in sandboxed iframes -> it killed the game via `window.onerror`. Keep it in try/catch; the error handler ignores gamepad/permission errors.
- External CDN scripts were blocked on some hosts -> everything is inlined.
- Quarter clock ends the game: after 4 quarters `S==='over'` and `upd` does nothing. Test harnesses must call `start()` per batch.
- Aim must account for drag/Magnus or perfect shots fall short (measured: 3% -> 95% after fix).
- Keep steals off (user request). Keep green at top of meter. Keep Curry's off-ball tendency and low-load one-motion form.

## Known gaps / ideas
Online multiplayer + anti-lag (none yet; local 2P exists), skeletal bone rig + blending + foot IK (feet slide slightly), Rapier bodies for players/dribble,
bloom/SSAO/motion blur/floor reflections, smoother player models, replays/cameras in 2D, heaves >45 ft only ~73% on green, Classic has no new features.

# Hoops 2K27 — project guide (read this first)

Browser basketball game: 5v5 and 1v1, full court, 3D (three.js + Rapier) and 2D, plus a Classic side-view 1v1.
Everything ships as ONE self-contained HTML file (`dist/hoops2k27-hub.html`, ~2.6 MB: three.js + Rapier inlined, no CDN).
Unofficial fan project; rosters/ratings are approximations (7 teams, 35 players, 2026-27 era).

## Layout
- `src/core/` — the shared, DOM-free simulation (runs in the browser, in Node tests and on a server):
  `sim.ts` (state, rules, AI, shooting, ball, controllers, replays), `pose.ts` (Pro Play joint angles + hand FK),
  `physics.ts` (Rapier world), `data.ts` (rosters, OVR, signature tweaks, shot clips), `mocap.ts` (generated CMU
  mocap cycles, see `scripts/mocap/retarget.ts`), `modes.ts` (Practice/Tutorial/3PT/Dunk/HORSE/Clutch on HOOK).
- `src/client/` — browser shell: `main.ts` (hub), `game.ts` (menus, loop, FX, draw, halftime, highlight reel), `input.ts`
  (remappable keys `ACTS/KMAP`, h2k_keys), `hud.ts`, `broadcast.ts` (banners, commentary + voice, intro card, momentum bug,
  rumble), `music.ts` (procedural arena music), `modesui.ts` (mode strip, mode HUDs/results, Season),
  `render3d.ts` (three.js), `canvas.ts` (2D court + software-3D fallback), `view.ts` (camera/quality/projection), `audio.ts`, `net/` (online).
- `src/modes/classic/` — the older side-view engine, kept as legacy (inlined at build time).
- `index.html` + `vite.config.ts` — Vite builds ONE self-contained file (`vite-plugin-singlefile`; three.js + Rapier wasm inlined, no CDN).
- `scripts/postbuild.mjs` — writes `dist/hoops2k27-hub.html` and standalone `dist/modes/*.html` (same file with a preset mode).
- `tests/` — `tsx` logic tests against the core + a Playwright browser smoke test (see tests/README.md). `docs/` — screenshots.

## Mode flags (no more copied modes)
`cfg.NP` (5 or 1 players per team), `cfg.physics` ('rapier' in every mode now; 'legacy' still supported), `cfg.hand` (release from the rig's hand),
`V.r3d` (three.js vs 2D canvas). The hub calls `boot({np, r3d, my, mp})`. Both renderers draw the same `P`/`B` state.

## World model (game coordinates)
x 0..940, y 0..500 (10 px = 1 ft), z up in px (rim z=100). Hoops at x=52.5 and 887.5, y=250 (`HXs`, `HY`).
Team 0 (you) attacks the RIGHT hoop (`hoop(t)`). `g=320`, ball radius `BR=3.9`, rim radius `RR=7.5`.
3D world (feet): `W3(x,y,z)=[(x-470)*.1, z*.1, (y-250)*.1]`.

## Loop
`game.ts loop` (rAF; paused while the tab is hidden) -> fixed 60 Hz `G.upd(1/60)` accumulator (max 6 steps) -> drain `FX` -> `draw()`.
`upd`: replay check -> `cfg.input(ctrl)` for every human controller (`CT`) -> `ai(p)` for the rest -> rebound assist -> FT input ->
controller targeting -> `step(p)` for all -> `collide` -> (Rapier player capsules) -> `bstep` x2 -> `ftTick` -> `netSim` -> `recFrame` -> `pose3` for all -> clocks/quarters.
The sim never touches the DOM: it emits `FX` (floating texts anchored in world or screen space, sounds, crowd excitement, game end).

## Where things live
- Roster/ratings (`core/data.ts`): `TM` (tuple `[name,3pt,inside,speed,def,jump,style,skin,hair,beard,height,build,number]`), `OV` (OVR), `SIG` (signature shot tweaks). `MYP` (My Player) lives in `sim.ts`, saved by the client in localStorage `h2k_myp`.
- Humans: `CT: Ctrl[]` (`mkCtrl(id, team, fixed, tempo)`). `fixed` = My Player (always slot 0). Auto-switch picks the nearest teammate that no other human holds. `isH(p)` = controlled by any human.
- Shooting: `step` ('c' charge, 's' shot) -> `launch(p)`. Green window: `win=(.07+rating/100*.05)*(1-.45*contest)`; meter ideal .6 (.45 quick style). Green is at the TOP of the meter. Only greens go in for jumpers; layups/hooks are rating-based. Tempo is per controller (`ctrl.tempo`). Online, the release carries the shooter's own measured meter time (`Input.mt`/`tp`), clamped to the server's view.
- Contest: `contestOf(p)` (lag-compensated for remote shooters via `ctrl.lag`), locked at release (`p.cw`). Meters: `hud.ts meter(p)` (4 styles, `V.METER`).
- Aim: `launch` solves a parabola, then (Rapier) pre-simulates with drag+Magnus and corrects range AND sideways error. This is why greens still go in with real physics.
- Release point: `pose.ts handPos(p)` — analytic forward kinematics that matches the three.js rig exactly (`tests/fk.ts`), so the server/Node sim releases from the same hand as the 3D client.
- Physics: `bstep` (legacy ball) vs `physics.ts rapInit/rapStep` (Rapier ball, rim = 24 capsules, board, floor, walls). Shots, loose balls and passes (with backspin) fly through Rapier. `rapSyncPlayers`: kinematic torso capsules (`cfg.playerBodies`, on) that only touch a loose/shot ball, never the shooter right after release or passes. Dribble: `dz` push/bounce/catch cycle (hand pushes down, e=.82 floor bounce, cushioned catch at `dribTop` = hip height, lower when guarded) beside the right hand + a critically damped spring for xy; the hand IK waits at the hip (`B.dtop`); the client plays the bounce sound by watching `B.z` (no net events).
- Net: `NETS/netSim` 16-strand diamond weave, rope constraints, real gravity, 2 sub-steps for fast balls, two-way ball-vs-strand contact (reaction only below the rim, so makes are decided by the iron), rim hits shake the mesh; `tests/net_swish.ts`. 3D draws instanced tube strands, 2D projected strands.
- Ball flight: release angles ~0.86-1.0 rad (deep 0.97, heaves 1.1) + small per-player arc; 3D ball orientation integrates the real angular velocity (`render3d ballSpin`, game->three axial vector flips sign).
- Celebrations: `celebrate(p, slot)` in the make handler (0 three, 1 dunk/and-one, 2 clutch/on fire) -> `p.cel/p.celT`; poses in `pose3` (CEL 1-8: shimmy, night-night, flex, three-up, chest thump, roar, shh, point up), arms/torso only; per-player `formOf().ce` (SIG overrides, Curry = shimmy/point/night-night); synced in the snapshot (PST 25).
- Animation engine v2: `pose3(p)` writes 29 joint values to `p.q` (`QK`: forearm twist oL/oR, legs tL/tR kL/kR, hips hz + shuffle hs, ankles fL/fR,
  pelvis ln/ty/rz, chest cx/cy, neck nk, head hp/hy, arms aL/aR sz/zL eL/eR wL/wR, finger curl gL/gR, crouch cr).
  Layers: base (stride-matched gait from `stepLen`, slides, backpedal, air) -> upper body (shot clips `CL/clip`, dribble hand IK,
  defense, catch, screens, post, hands-on-knees rest, celebrations CEL 1-9 incl. dap) -> additive (contact, landing, accel lean,
  breathing) -> feet (flat through stance, toe-off, pointed in the air) -> head look (ball / rim / pass target; `LOOK`).
  Per-state blend times (`ST`/`BLEND`: 0.05 s into a shot .. 0.4 s into a rest); head turns 1.6x faster; wR never smoothed.
  Skeleton spec `RIG` (pose.ts) is the single source: `handPos` (release point), `skeleton()` (2D, 20 joints) and `rig3d.ts`
  (19 bones: hips, pelvis bd, chest ch, neck nk, head hd, thighs, knees, ankles al/ar, shoulders, elbows, wrists, fingers gL/gR)
  all use it; `tests/fk.ts` poses the REAL `makeRig` in Node (it skips DOM textures) and checks hand, head, knees, ankles, toes.
  Pro Play v2 layers in pose3: two-hand dribble IK (either arm, chosen by the ball's side; free arm relaxes or arm-bars a
  close defender) fed by sim `dribHand` (B.dhn hand, crossovers/BTB/spins switch hands along their own paths, protect-
  the-ball crosses, size-ups); `armIK()` (reusable two-bone arm IK: dribble, defenders' active hands, rebound/catch
  reach, layup reach to the rim); running: cut bank from heading-change rate `p.trn`, drive steps, stride stops;
  box-outs / post battles; secondary motion = damped torso spring `p.sf/p.ss` driven by inertia and contact impulses
  (hitT increments; hitT+direction are in the snapshot, PST 26), arms flail + recovery step on big hits, head/arm lag.
  Finishes (`data.ts CK`/`CL`, `isDunkSv/isLaySv`): dunks 6 one-hand, 11 two-hand, 12 tomahawk, 13 windmill, 14 reverse,
  15 360 -> `p.hangT` rim hang (sv 19); layups 5, 7 euro, 16 finger roll, 17 reverse, 18 contact (through a foul);
  jumpers add 20 leaner, 21 runner (picked by movement in `pickClip`); every airborne jumper leans with momentum;
  greens set CEL 10 (held follow-through); landings split the feet with the drift. Clip time is scaled per clip so its
  wrist-snap keyframe (`RELK`) lands on the sim's release (`rT`); guide hand = left-arm IK onto the side of the ball
  (`palmAt` FK of the candidate pose) until release; catch-and-dip in mode 'c'.
  `footIK` plants stance feet (two-bone IK) and keeps planted feet flat. Animation Studio (`client/animview.ts`): pause menu
  or `?anim`; `H2K.studio()`, `H2K.studioPose(i, t, camAngle)` freezes a pose for screenshots (orbit camera `V.studio`).
- Post-processing (`client/fx3d.ts`, three r186): MSAA HDR render -> SSAO (High) -> Bokeh DOF (replays only, `setDof`) ->
  bloom (threshold 3.2: HDR input) -> motion blur -> color grade (`setGrade`: contrast/saturation/vignette + home-team tint)
  -> OutputPass (ACES + sRGB; r153+ tone-maps only the final output) -> SMAA (low-res tiers). Floor = glossy physical
  plane (per-board roughnessMap + seam bumpMap + scuffs) over a `Reflector` (High, 2048 on desktop). Toggle: `V.FX`.
- Renderers: WebGL (default) or WebGPU (Display -> Renderer `V.GPU`, saved in h2k_set; or `?webgpu`). three r186's
  `three/webgpu` shares `three.core.js`, so the same scene/materials draw with either. WebGPU: `fxgpu.ts` RenderPipeline
  (scene pass MSAA -> bloom -> TSL grade -> replay DOF -> renderOutput -> FXAA), no planar Reflector/motion blur/SSAO.
  Shim drops three's default `swizzle:"rgba"` (old Chromium rejects it); init/draw failure -> sessionStorage `h2k_nogpu`
  + reload on WebGL. `V.backend` tells what is drawing. Light shafts use a portable alphaMap material (no ShaderMaterial).
- Lighting (render3d): physical units (legacy intensities x PI; spots in candela), near-overhead shadow key (PCF + radius),
  4 catwalk SpotLights, additive light-shaft cones (Medium+), HDR ceiling panels (bloom). Vertex colors keep the extra
  sRGB->linear step on purpose (deep palette). Contact-shadow blobs (InstancedMesh) under players + ball.
- Crowd: instanced bodies/heads/arms/towels (stand by excitement threshold, the wave `waveT` after some buckets), 24 canvas
  signs, courtside row on chairs. Replay director camera (nearest player to the ball, low angle at the rim) + DOF.
  Polish: hoop parts shake on dunks (`hoopParts`), glint sprites, confetti when `S==='over'` (final screen waits 4 s).
- Rig extras: sneakers (sole/toe cap/laces/heel tab, `shoeKind`), jersey side panels + waistband + chest wordmark (`cl[p.tm]`),
  per-player face shape from the name hash (`F`: skull/jaw/nose/brows/eyes/ears/lips; SIG `face` + `hs` hair overrides,
  locks only with `hs:1`; no real photos/likenesses), hair caps above the eyes, jawline beards; shorts hems skinned to spring-lagged flap bones (`clothStep`, client only).
- Rules: `foul/startFT/ftLay/ftTick/ftIn/tech`, shot clock, quarters (4 x `QTRLEN` s), inbounds (`inb`), bonus after 5 team fouls, `endGame` (FX) + box score (`p.stt`).
- AI: `ai(p)`, `offBall` = half-court play system (`PLAY[t]`: pick-and-roll / pindown / flare, screener plants with `setT`, rolls or pops; spacing spots + backdoor cuts), `loose` (rebounding), defense inside `ai` (no full-court press, no steals). Planted screens stop defenders in `collide()` and can force switches.
- Fouls: `shootingFoul()` contact model (hard closeouts, sideways leaps vs verticality, body contact, drives draw more) -> FTs or and-ones (`B.fl`). Cylinder rule: nobody touches a live shot above either rim. Counters in `STAT`.
- Highlights: alley-oops (lob to a leaper near the rim), posterizers, SWISH/SPLASH (closest approach to the iron `B.rim`), PERFECT RELEASE (always drops), buzzer beaters / game winners; FX `shake`, `slow`, `chant`.
- Forms: `data.ts formOf(name)` gives every player a deterministic shooting signature (SIG overrides). `pose.ts skeleton()` = 20-joint FK used by the 2D renderer.
- Passing: `pass(p,r,type)` chest/bounce/lob + in-flight steering; `pick` chooses target from stick direction.
- Dribble/post: `i.mv` 1/2/3 (hesitation/spin/BTB), flick-to-cross, post (`i.post`, hook/drop-step/turnaround).
- 3D rendering: `render3d.ts glInit` (court texture, crowd InstancedMesh, jumbotron, hoops, net, rig; shared material cache); `V.GL.render` (cameras `V.CAMM` 0-3, quality `V.QL`, auto-downgrade). Canvas fallback (`canvas.ts scene3c/segs3c`) if WebGL fails.
- HUD: 2D canvas `#h` over the WebGL canvas `#c` (must stay transparent!). `view.ts pr(x,y,z)` projects with the active camera/renderer.
- Replays: allocation-free `REC` ring buffer in the core, `startReplay/rplStep/skipReplay`. Input (`input.ts`): keyboard, touch buttons `#tc`, gamepad `gpPoll` (wrapped: blocked in iframes by permissions policy).
- Menus (`game.ts`): matchup screen `menu()` (your team vs chosen/random opponent `OPP`, lineups with drawn `avatar()` portraits, team ratings, difficulty `cfg.DIFF` applied via `cpuK()` to CPU-only teams, quarter length `QLEN`, settings drawer `#sd`), final screen (record `rec` in localStorage `h2k_rec`, player of the game, stat bars, rematch), hub Quick Play (`h2k_lastplay`).
- Debug handle in the browser: `window.H2K = { G (sim module), V, NET, startLocal, menu }`.

## Online multiplayer (src/net, src/client/net, server/)
- Model: one authoritative sim (the host's browser tab, or a dedicated headless Node host) at fixed 60 Hz; guests send inputs only.
- Transport = "presence": each peer keeps ONE latest-state object; receivers get the newest (sender-coalesced ~30 Hz, drops OK).
  Backends: claude.ai `room` capability (published artifact; `client/net/room.ts`), WebSocket relay (`server/relay.ts`, `net/ws.ts`).
  Never send deltas without a baseline the receiver confirmed; everything else is absolute state.
- Host presence: `L` lobby (code, slots, sides, teams, ql, pro), `Z` snapshot (`net/protocol.ts encodeSnap`: quantized ints;
  delta `[gap,diff]` pairs vs the newest tick every guest acked via `zk`, else full), `C` controller map, `A` input acks,
  `Pg` ping echoes, `E` event ring (texts/sounds/end), `X` box score. Must stay < 4 KiB (checked in `HostSession.pub`).
- Guest presence: `I` input (stick, held buttons, monotonically increasing edge counters, meter time `mt` / tempo tap `tp`
  measured on the shooter's own timeline), `zk` ack, `t`/`rt` ping, `D` interpolation delay, `tm`/`rdy` lobby, `tok` reconnect token.
- Guest (`net/guest.ts`): others rendered from snapshots interpolated ~4-15 ticks in the past (max-filtered clock offset + jitter);
  own player predicted with `step()` under `setPredict(1)` (no side effects) and reconciled on every snapshot by replaying
  unacked inputs; small errors are blended, not snapped. Dead balls (inbound, FTs, after scores) freeze prediction like the host.
- Host (`net/host.ts`): edge counters -> one-shot inputs (press+release in one frame are split across ticks); remote shooters'
  contests use positions rewound by their latency (`ctrl.lag`, `LAGBUF`); release time clamped to the host's view.
- Lobby: a guest starts undecided (`side=-2`); `HostSession.canStart()` waits until every connected guest is seated+ready or chose Watch.
- Reconnect: seats keep their `tok`; a returning token re-attaches (AI plays the seat meanwhile). Host leaving ends the game.
- A hidden host tab keeps simulating via a timer (rAF stops when hidden). `npm run server` serves dist + relay;
  "Create on dedicated server" spawns `server/headless-host.ts` for that room code.

## Gameplay pack (v3.9)
- Rules in `cfg`: FOULS, SCLK, VIOL (3 s lane `TS.lane`, 8 s `TS.bc`, goaltending in bstep's cylinder check, never on FTs),
  SUBS (fatigue `p.en` drain by speed, `subs()` at every `setup()`: tired/fouled-out (`p.fo`, 6 PF) swap with generated
  reserves `BENCH[t]`; `ROST[t]` = everyone who played (box score / invariants); renderer rebuilds rigs per changed slot),
  BADGES (`BADGE` DR/PZ/AB/LD/CL/GC from ratings, hot zones `p.hzm` per `zoneOf`, cold `p.cold`, rhythm `p.mvEnd`).
  `winMul(p, D0)` scales the green window (launch AND hud meter must agree; returns 1 online: `cfg.ONLINE`).
- Team state `TS`: timeouts `to` (`callTO`, CPU stops 8-0 runs), defense `ds` (sag/deny/switch-all), play call `pc`
  (pnr/pin/flare/iso; CPU isos its star late), challenge (`TS.call`, `challenge()`), runs/momentum `run/mom`, clutch time.
  Inputs `to/ch/ds` (Y/H/Z). Flagrant 1 = 2 FTs + possession (`ftq.keep`). Sim FX: `ban` (banner), `cm` (commentary key),
  `half` (halftime, offline only), `mode` (mode events). Hustle stats in `stt`: orb, chg, dv (dives), sa (screen assists).
- Modes (`modes.ts`): `begin()` = normal start without jump ball + `HOOK.pre/post/end`; unused players parked with `p.off`
  (skipped by step/collide/renderers); shots watched via the launch counter `p.lc`; dunk contest needs a green release.
- Replays: `RSPD` speed ([ ]), every replay is copied to `HL` (end-of-game reel, `playClip`), reels save/load as JSON files.
- Online (PROTO 4): header ints 34-39 = jump ball t, timeouts, momentum, ds/pc, clutch; FX "b"/"c" relay banners and
  commentary; EDGES +to/ch/ds; quick chat ring `Q` (keys 1-6, `CHAT`), `rm` rematch votes, `elo` in slots (local rating).

## Lessons learned (do not repeat)
- A solid background on `#h` hid the whole 3D view (black screen). `#h` must be transparent.
- `getGamepads()` throws in sandboxed iframes -> it killed the game via `window.onerror`. Keep it in try/catch; the error handler ignores gamepad/permission errors.
- External CDN scripts were blocked on some hosts -> everything is inlined.
- Quarter clock ends the game: after 4 quarters `S==='over'` and `upd` does nothing. Test harnesses must call `start()` per batch.
- `@ts-nocheck` hid a missing import (`CP` in render3d) that blanked the 3D view: keep the browser smoke test in the loop.
- In 1v1, "switch player" has no other teammate: `nearest()` must never return -1.
- Aim must account for drag/Magnus or perfect shots fall short (measured: 3% -> 95% after fix).
- Keep steals off (user request). Keep green at top of meter. Keep Curry's off-ball tendency and low-load one-motion form.
- A tip-in from under the rim could get a launch too soft to reach the rim -> sqrt(negative) -> NaN ball. launch() now lifts it.
- AI state needs all its fields set together (`a.r` without `a.w`/`a.pt` -> NaN timers -> a handler frozen under the rim).
- Never `open(p,'w').write(open(p).read()...)` in one python line (truncates the file first): use the scratchpad rp.py helper.

## Known gaps / ideas
replays/cameras in 2D, more teams, custom 3-point distance (court lines are drawn at 23.75 ft), substitutions and
badge windows online (rosters are fixed there), commentary is text templates + browser speech, mobile joystick, heaves >45 ft only ~73% on green, Classic has no new features.

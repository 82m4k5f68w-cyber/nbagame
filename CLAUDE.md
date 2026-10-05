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
  The pre-sim must mirror `rapStep` + Rapier step for step (h = 1/120, symplectic Euler, spin decaying with the ball's
  angular damping .3): with a constant spin it over-predicted Magnus lift and heaves fell short (85% -> 98% on green).
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

## Presentation (v4.0)
- Pre-game intros: the shell holds the sim in `S="intro"` (`introT`, `drawPlayerIntro`, `introLen`) then `endIntro()`; `?nointro`
  (tests) or `V.INTRO=0` skips. Two-part commentary: sim `cm("rise", name, kind)` at release + the make/`miss`/`missO` result
  completes the same caption; speech queue `say()` (max 2 pending, big plays interrupt). Halftime = `playReel` of first-half
  `HL` (clips carry `q`; a reel restores `rs`, never triggers an inbound) then `halfStats` (quarter scores `TS.qs`).
  Jumbotron lower panel `jStat()` rotates team stats every 6 s / shows runs. Music modes (`music.mode`): pregame / organ / hype /
  clutch / calm, chosen in `game.ts loop`; `music.riff(name)` queues organ riffs on the next bar.

## Stars, street & arena life (v4.1)
- AI: `TEND`/`tendOf(p)` (deep/mid/drive/post/pass/step) picks shot range; hold-for-last-shot, two-for-one, extra pass on
  contested looks, intentional fouls late (rulesTick), `TS.adv` frontcourt inbound after a late timeout, `TS.mu` matchups
  (`autoMatch`, `guardOf`, `manOf`; pause → Matchups). `p.tg` timing grade (+ FX "tg", relayed online as "q").
- Pro Play v3: `p.plantT` plant/slip, `p.fsT` first step, `p.react/p.dcl` double clutch / hang (delays launch), `p.hupT`
  hand-up contest, `p.lateJ` off-balance landing, `p.pk` pass style (1 no-look, 2 behind-back, 3 wraparound), `p.engT/eng`
  body english, `deadBall()` (jog back, low fives, CEL 15 jersey tug, CEL 16 help up via `p.helpP`), tip-outs, box-outs, combos
  `p.combo`, post spin. These pose flags are host-side only (guests see the base animation).
- Modes: `cfg.HALF` (hoop() is the right basket for both teams, `setupHalf` check ball, 1s/2s, make-it-take-it, change of
  possession -> take it back), `cfg.TO` points to win, `cfg.ASTAR` (allStar() rosters, open floor). modes.ts: startStreet,
  startKing (ladder), startAllStar, startDaily (`dailySpec` seeded by date). `GAMELIKE` modes run the normal sim; `gameLike()`.
  Team sizes 3v3/2v2 (`RO` takes the best NP players; no reserves below 5v5).
- Renderer: `ARENA` objects hidden / `STREET` set shown when `cfg.HALF`; referees (`refs`, `V.refCall` on FX "whistle");
  coach gestures (`coachG/coachK`); courtside reactions `CS`/`courtside()` (`V.crowdReact` on FX "ooh"/"duck").
- Online: lobby team size (`setOpt("np")`, `cap()`), tournament (`L.tour`, `tourStart/tourPlay/tourResult`, spectators tm -1),
  replay links `#...&reel=` (packClip: every 2nd frame, int16, deflate-raw, base64url; main.ts opens the mode, `playLinkReel`).

## Faces & feel (v4.2)
- Faces: 11 face bones under `hd` in rig3d (`fb`: jaw `jw` hinge, mouth interior `mi` scaled open with teeth, mouth line
  `mo`, corners `c`, brows `b`, closing lids `l` (folded to scale .02 at rest), irises `y`; `fr` = rest positions).
  `pose.ts face()` (end of pose3) writes `p.fc` {jw, sm, br, an, sq, wd, bl, ex, ey}: celebrations (CEL -> grin / smirk /
  yell / wince / arguing), contact `hitT` (gritted teeth + flinch blink), dunk in the air, `p.frT` (miss: set on the
  shooter when the miss is rebounded), shot focus, defense, fatigue, final score; slot-seeded blinks; eyes take the head
  turn's remainder. `applyFace` (client) maps it to bones. Studio: "Face: ..." entries use a close-up (studio.h/dy).
  Final buzzer: render3d camera drifts in on the winners' top scorer.
- Lefties: SIG `lh` (Brunson). pose3 mirrors the whole solved pose (arms swap, oL/oR negate, legs swap, hs/ty/rz/cy/hy
  negate) while shooting (`md 's'`, or 'c' with the ball) and sets `q.mir`; `handPos` then walks the LEFT arm chain
  (fk.ts checks both), render3d pins the ball to `wL`; dribHand starts lefties in the left hand.
- Guide hand `gs` 0-5: classic, thumb flick, early drop, elbow out, rides high, two-hand push (formOf hash, SIG overrides).
- Blending = per-joint inertialization (`p.inz`, `inert()` quintic, Bollo): restart on a state change (tf = BLEND[st] x
  .65, head x .4) or when a joint's target leaves its linear prediction (head .08, arms .25, else .12; x3 while still
  blending), tf grows with the jump size (max .32 s); a light 50 ms filter on top. `cfg.INZ=0` = old exponential
  smoothing (tests/blend.ts A/B). wR never smoothed (and the lefty's wL).
- Mocap: `MC_JUMP` (CMU 16_03 airborne part, from retarget.ts `jump()`) drives legs/pelvis/chest in non-shot jumps
  (speed < 160), phase from vz: u = (1 - vz/vz0)/2, vz0 = sqrt(vz^2 + 2gz). Subject 06 has no layups (dribbles/shots only).
- Closeouts (pose3 Pro Play v3): a defender closing on the handler (approach > 50 px/s, < 140 px) raises the shot-side
  hand, low hand on the drive, then chop steps when < 85 px.
- Online PROTO 5, PST 28: per-player int 27 = `proFlags` base-64 pack (hupT, plantT, engT, eng, pk, dcl, frT, rl).
- Dead pass rule (bstep): a pass rolling slowly on the floor or older than 3 s becomes a loose ball (`B.mode "air"`).
- Blend offsets are circular (`wrapPi`): 2 pi apart is the same pose (spin moves accumulate ty; arm IK flips across
  +-pi); `armIK` keeps the shoulder in -2.6 .. 3.7 (over the top for targets overhead). Shot/move states cap in-state
  blend times at .1 s (releases stay crisp; blend.ts checks the layup arm against the old blend).
- Lodged ball (bstep): resting on the iron / wedged against the glass for 1.2 s -> rolls out toward mid-court, never
  into the board (tests/rim_wedge.ts). Open shooters call for the ball (`p.callT` shout face); on-ball defenders ride
  the driver's hip (armIK) under 34 px.

## Procedural stepping (v4.3)
- `pose.ts stepSolve` (end of pose3, after blending; `cfg.PLANT`, on): in locomotion states (idle/run/def/drib/scr/cat/
  rest, grounded, mode 'i', no move/post) the FEET live in world space (`p.stp.f[k]`: st stance/swing, x/y/z, swing
  start sx/sy/sz + target tx/ty, sw0) and both legs are solved to reach them (sagittal soft two-bone IK + per-leg hip
  abduction via hz/hs), so a foot on the floor cannot slide. Schedule from the sim gait phase p.ph (L touches down at
  ph pi/2, R at 3pi/2); duty factor eased (walk .62 .. sprint .35, +.22 sideways = slides never fly); landing = rest
  spot (animated foot spread) + body velocity x time-to-touchdown + duty x stepLen ahead; swing profile cubic (leaves
  with speed, lands at zero), low arc for slides; standing: feet stay put, a shuffle step when the body drifted 7 px.
  Regime moving/standing with hysteresis (18/30 px/s); teleports re-seed; pelvis dip (`S.drop`, critically damped)
  keeps planted feet in reach, defenders sit 3 px lower. Studio treadmill: `p.tread` moves the floor instead.
  The 3D client's footIK fades out by `p.stp.w`. tests/footslide.ts A/B: sliding 128 -> ~20 px/s, leg jerk budget 1.9x.
- Blender restarts read the blender's own last output (`I.last`), never `o[k]` (which carries the stepping IK).
- Ball in hand (bstep): in 'c'/'s' the sim ball sits at `handPos` (clamped to the arena) - 2D/replays/guests see it in
  the hand (was 1.7 ft off on a formula). Body spacing (collide): 16 px face to face, up to ~28 shoulder to shoulder
  (16 + 5 x sideways-ness x build per player). `avoidBodies` (cfg.AVOID): elbows/hands/shoulders inside another
  torso capsule (his last skeleton `p.skel`) tuck / bend / twist out, proportional to penetration (tests/overlap.ts).

## Smart CPU (v4.4)
- Scouting (sim): `scout(p, D0, made, cx)` from `zoneRes` keeps decayed records per range (0 rim, 1 mid, 2 three):
  `p.sk` (x.84 per shot) and `TS.sk[t]` (x.93), attempts/makes/contest (`B.cx` = contest at launch). `form(p, r)`.
- `tendOf(p)` = `baseTend` (TEND / derived) adapted for CPU players in game-like modes (never humans, never All-Star):
  cold (`p.cold`>=3, recent 3P <25%, recent 3P contest >.6) moves deep -> mid / drive / post, fewer step-backs, more
  passing; hot (`heat`>=3 or a hot zone) shoots more; vs a zone more threes; then the team game plan tilts it.
  Returns a shared scratch array (TW): copy it if you keep it. Handler counter: smothered behind the arc (`dd0<22`,
  or cold and `<40`) -> hesitation into an elbow pull-up or a drive (`a.adj`, once per decision).
- `gamePlan(t)` (CPU teams, 5v5..2v2, from `setup` every 4+ possessions; `halftimeAdjust()` forces it at the half):
  `TS.gp` (GPN: balanced / attack the paint / mid-range & post / let it fly / feed the hot hand) with a matching
  `TS.pc`; points-per-shot `pps()` shrunk toward league priors; back to balanced only after 8 possessions. Defense:
  `TS.ds` 2 vs a team hot from three, 4 (2-3 zone, 5v5) / 1 vs a rim-only team; best defender swaps onto a hot scorer
  (`TS.mu`). Man defenders also read their man's `p.sk` (crowd a shooter, sag off a non-shooting driver).
- 2-3 zone `zoneMan` (ds 4): spots by height rank, shifted toward the ball; take whoever is nearest the spot (ball
  handler first), never more than 75 px from it. Online PROTO 6 packs ds/pc in 3 bits each (header int 38).
- Realism (tests/stats.ts): handler patience scales with quarter length (`pf`), catch-and-shoot, CPU jumper odds
  `base*(1-.25 cx)` (3P open ~34-50% by rating), finishes `i*.86`, fewer blocks / blocking fouls, only the closest
  man and a big crash the offensive glass. Arcade tempo (~6 s per shot) is intentional.
- Footwork: stepping also runs in post-ups (wide low base, sit 5), dribble moves, landings and the jumper gather
  (mode 'c': rest spots = the clip's own ankles, so the stagger is kept); spin moves turn the whole body with a root
  yaw `p.ry` (`fv(p)` = drawn facing, used by skeleton/handPos/armIK/stepping/rig3d/canvas; fk.ts checks it);
  standing pivots step the foot farthest from its spot; touchdowns that come early settle z/pitch (`F.zo/F.pd`).
  Reach: the duty factor is capped so the stance travel fits the leg's horizontal reach (fast slides get a short hop),
  and the landing spot is clamped so the whole stance stays inside the reach circle around its hip; leg IK is soft
  from 88% of its length (lift-off knee pops). Stance-foot reach error p99 12 -> 3.5 px, leg jerk 2.1x -> 1.3x.

## Contact & polish (v4.5)
- Held ball (bstep): in triple threat / pump fake / jab / FT routine / inbound the formula spot becomes the hands'
  TARGET (`B.tgx/tgy/tgz`, `B.tgo`; pose3's two-hand IK aims there) and the ball itself sits between the drawn palms
  (skeleton joints 15/19 of the last pose). A dribble out of the hands starts from there (`dz`: first push from the
  ball's height, no 14 px snap for .35 s, `B.fr0`).
- Dribble contact (end of pose3, post-blend): each arm solves its own-side IK to the ball near the top of the bounce,
  weights `p.ctR/ctL` eased at 16/s, ignored for IK branch flips (> .8 rad), fading from the last solution `p.ctK`
  when contact ends. tests/contact.ts.
- Lying (act 3/4, stepSolve): the root is lifted by the deepest of head/knees/ankles/toes/elbows/hands.
- Pre-sim aim mirrors Rapier (see Aim). Heads never snap on quick (shot/move) state changes.
- Pause -> Scouting report (game.ts `scouting()`): both teams' recent shot records, the CPU plan/defense, HOT/COLD/
  SMOTHERED tags. Spacers avoid spots the ball handler is driving toward (offBall pick, 0.5 s ahead).

## Team play (v4.6)
- Transition (sim): a live-ball change of possession stamps `TS.trT[t]` (setup clears it). For 4.5 s the CPU handler
  checks for numbers (defenders level with or ahead of him `back`, an open man ahead): pushes (`TS.tr[t]`, sprint),
  hits the man ahead (lob at the rim), finishes at the rim; teammates fill lanes (rim runner, corners, trailer).
  Transition defense: all sprint back, the deepest man protects the rim and stops the ball (`STAT.fb`).
- Pick-and-roll coverage `TS.cov` (CPU, from gamePlan): 1 hedge vs a pull-up shooting star (c >= 86 or mid-range
  falling), else 0 drop (screener's man sits at the FT line); `p.hdgT` = arms-wide pose (host-side flag).
- Double team `TS.dbl[t]` (P index; a scorer with heat >= 3): the nearest helper traps him inside 32 ft; a doubled CPU
  handler passes out to the best `val()` option. Banner + commentary.
- Dribble handoff (CPU): a big (c < 74 or 6'10"+) with the ball 18-30 ft out holds it for the best shooter
  (`a.dho`, `q.ai.dhoBy`), hands off within 22 px, then stays planted as the screen (`a.holdT`, `setT`).
- Buzzer: a CPU handler with < 1.25 s on the game or shot clock gets it up from anywhere (HEAVE! from 42 ft+).
- Out of bounds (bstep, cfg.VIOL, game-like modes): a loose ball / pass that reaches the lines is a turnover by
  `B.last` (a block sets `B.last` = the blocker) -> `violation()`; ~2-3 per game (`STAT.oob`). Players stay clamped.
- Contest hands: the closest defender (< 48 px) to a shooter in c/s (or just after the release) gets the ball-side
  hand up at the ball, post-blend; contact weights ride a critically damped spring (`p.ctRv/ctLv`).
- Online PROTO 7: proFlags also carry chinT (chinned rebound) and hdgT (hedge / trap arms) as bits.
- Shoulder twist: QK gained `hL`/`hR` (humeral rotation, + = internal), shoulders are Euler XZY so the twist turns
  about the upper-arm bone (twist 0 = the old XYZ pose exactly); skeleton/handPos/rig3d agree (fk.ts randomizes it).
  Used for hands on the hips (gassed walk at a dead ball). Replays/online replay poses carry all 31 channels.
- Contact pass guards: dribble/catch ignore IK branch flips (> .8 rad); fades and contests fade out before the
  +-pi wrap of their offset; stored solutions are wrapped (no 2 pi drift).
- `skeleton()` is allocation-free (matrix / frame pools rewound per call; it runs several times per player per
  tick): sim tick 2.1 -> 1.2 ms in Node. Don't hold a skeleton frame/matrix across calls.
- One-legged fadeaway (fade clip, tall mid-range scorers `ht >= 6.75 && c >= 80`, or `p.olf`): off knee up and out.
- Twist poses: screener folds forearms across the stomach, arm-bar forearm turns in, CEL 3 = front double-biceps.
- Broadcast splits `TS.xs` {paint, fb, sec} (points in the paint < 16 ft, fast-break shots `B.fb`, second-chance
  shots `B.sc2` after an offensive rebound `TS.orbP`): halftime + final screens, jumbotron; online header ints 40-42
  (HDR 43, PROTO 8; PROTO 9 adds the help + huddle proFlags bits).
- Signature free-throw routines (`ftStyle` from the name): classic, quick dribbles, long dribble routine, spin only.
- Contact: the receiver's hands reach to where a pass will be caught (post-blend contact pass, 0.3 s ahead) and
  the catch waits until the ball reaches a palm (`p.skel`) once he is close; rebounds in traffic are chinned
  (`p.chinT`, heldBall 4) before the outlet.

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
- canvas.ts / main.ts are `@ts-nocheck`: a missing import there type-checks fine and throws at runtime (check imports by hand).
- Mode starts must call `stopMode()` before reading `cfg.NP` (otherwise they inherit the previous mode's team size).
- A pass stuck in mode "pass" (speed 0 against a wall) was catchable only by its target -> frozen street game. Any ball
  state that only ONE player may resolve needs a timeout/fallback.
- Never `git stash` while background tests are running: they read the working tree.
- The Animation Studio doesn't run bstep: a held ball must be placed by the entry, or ball-targeted IK reaches for a
  ball left across the court (looked like a layup bug).
- `wrapPi` is for angles only: the crouch channel `cr` (index 9) is a distance (a 6.3 crouch change read as ~0).
- Post-blend IK that writes into `o[k]` leaks into the next blend restart unless restarts use `I.last`.
- `G.start()` rebuilds `P`: a test holding a Player from before a restart edits a dead object (look it up again).
- `pkill -f "tsx tests"` also matches the shell running it (exit 144): run long suites from a snapshot copy
  (scratchpad/snap with node_modules symlinked) so src edits can't leak into the next test process.
- Measure jerk with teleports excluded (setup after a basket moves everyone: a cut, not a pop).
- The claude.ai artifact publish check misread a build as a "PR review page" (refused: "too large for a review
  page") because of one minified function (avoidBodies: a nested array-literal table + array destructuring). Bisect
  by commit / by disabling functions and publishing variants; rewriting it with typed arrays fixed it.
- Exponential pose smoothing hid real pops (head target flips, gait kinks) AND lagged everything; measure jerk
  (tests/blend.ts) before tuning blend times by eye.

## Touch & reads (v4.8)
- Touch (input.ts `touchStick`, touch/pen pointers on `#c` only; mice ignored): a finger on the left half drops a
  floating stick (`V.stk` drawn state, `V.stick` = the analog vector hum() adds; radius `STK_R` 62 HUD px, dead zone
  .14, > .92 = sprint, the ring follows a finger that slides past it); a finger on the right half holds `KMAP.sd`
  (shoot / jump). Each finger is tracked by pointerId; `hud.ts stickHud` draws it. The #tc buttons stay.
- Joint limits (pose.ts end of pose3): elbows -0.05 .. 2.75, head pitch -0.85 .. 0.8; `tests/limits.ts` audits all
  channels over a game. Dribble style in `dribTop` (fast/small guards -2.5 px, 6'11"+ bigs +3). tendOf reads the
  defense (zone / sag -> threes, tight -> drives).
- Blend fixes (tests/blend.ts max jerk): pump-fake ball rises AND moves 7 px forward (bstep fw), a shot that starts
  from ST.cat / ST.air blends its arms over min(.1, .02 + .05 |offset|) s (`fromReach`; layups from idle stay crisp),
  block reach aims 8 px in front and caps aR at 3.25, contact fades keep the last live branch-flip guard (`p.ctRg/ctLg`).

## Team defense & reads (v4.9)
- Help (sim `helpPlan`, once per tick per defending team -> `HPL` {h helper, r rotator, m the man he takes}; man D,
  3+ a side, CPU and human teams' AI defenders): the handler inside 20 ft has beaten his man (level with / past him or
  34+ px clear, moving at the rim) -> the defender nearest the lane point (38% handler->rim) steps up (`p.helpT`), the
  defender with the lowest (distance to the helper's man + danger of his own man) rotates (`p.rotT`). Sprint closeouts
  when your man catches it 45+ px away. A fresh help makes the CPU driver re-read his passes at once (`a.hr`). Stats
  `STAT.help/rot/kick/kA/kM` (kick-outs: `B.kick` on the pass, `p.kickT` on the catch, `B.kk` at launch). tests/help.ts.
- Help poses (pose3): brace for the charge (forearms crossed, hL/hR .95) as the driver arrives; verticality (both arms
  straight up) when he leaves his feet. Charges: none in the restricted area (< 40 px from the rim), a set helper .62.
- Contact pass: a contact that starts from zero weight seeds its stored solution from the drawn arm (blend max 0.97).
- FT lineup (`ftLay`): per side defense low block, offense, defense (bigs first); the rest behind the arc. Poses
  (pose3): lane players in a ready stance (box-out hands), odd slots behind the arc hands on hips, the rest on knees.
- Spot inbounds (`setupAt(off, x, y)`, from `violation()`): frontcourt -> nearest line at the spot (baseline: box
  set; sideline: spread), defense goal-side + one up on the inbounder (hupT); backcourt -> normal `setup`. A pass
  younger than .3 s is never out of bounds (thrown from the line). While the inbounder counts, the AI offense runs the
  set's action (`INB.tg` spots via `inbMove`: box = corners pop, one dives, one to the top; sideline = come back to the
  ball, elbow flash, post seal, corner) and the defense trails goal-side; `setup()` clears it (`INB.on`).
  Non-shooting fouls side out at the spot of the foul.
- Help-side pistols (pose3, man D, ball 150+ px away, eased in by distance): ball-side hand at the ball, other at his
  man (`guardOf`, exported), low and soft (aim 40 px out between facing and target). One pass away (60-150 px, his
  man within 60 px): deny - ball-side hand into the lane (30% from his man to the ball), in a stance. Catch/rebound reach fades for a
  ball behind him. Timing card shows the contest at release (`tg.c`, WIDE OPEN .. SMOTHERED; relayed in "q").
- Mismatches: `val()` (CPU passing) +.3 for a post scorer (i >= 76) with a defender .4 ft+ shorter near the rim, +.12
  for a quick player (s +15) on a slow man; that post scorer seals on the ball-side block off the ball and calls for it
  (`STAT.seal` ticks). Commentary keys `kick` (made three off a kick-out) and `slip`.
- Timeout huddle: `callTO` gives a 3.2 s dead ball and `TS.hud`; deadBall walks each team into a circle in front of its
  bench (far sideline, x 470 -+ 130, y 34), facing in; the last .75 s `p.hudT` = hands in (pose3, two-arm IK to
  `p.hcx/hcy`). Studio: "Timeout huddle: hands in". The head coach walks to the back of the huddle and draws up the
  play (render3d benchUpd); the broadcast camera cuts to your team's huddle (TS.hud < 2.5).
- Closeout contest (`contestRaw`): a defender within 95 px flying at the shooter (approach > 90 px/s) counts as a
  partial contest (x .8) before he arrives - calibrated kick-out threes ~39% (were 56%). Seals: 2.5 s per possession
  (`p.ai.sealT`), only while the ball is at the arc.
- Free throws: a missed (non-final) FT moves on even when the miss caroms back into somebody's hands (`ftTick`:
  `B.owner && B.age > .3`); the shooter catching his own miss used to hold ftq - and the game clock - forever.
- Spacing: the spacers' spots are assigned jointly once per tick per team (`SPA`, exhaustive search over <= 4 spacers x 5
  spots, least total travel + ball / driver / busy-teammate penalties + stickiness `p.ai.spj`) - no more running across
  the floor through a teammate. Debug tag `p.br` = the off-ball branch that moved a player (spot/scr/use/seal/cut/tr/
  dho/hold/lane/SP). Unintended close pairs (no screen/handoff/transition) 12.7% -> 8.6% of half-court ticks.
- Fronting the post (CPU man D): a man 0.3 ft+ shorter than a big who is sealing (`o.br === "seal"`) gets between him
  and the ball (15 px ball-side); `p.br` is reset at the top of every `ai()` tick. Transition wings split the corners.
- "Switch!" (collide's forced switch): both defenders point at their new man (`p.swT` .7 s, pose3 armIK) and shout
  (`callT`). Contact fades: wrapped difference + an immediate guard (lets go before +-pi), except a contest's fade,
  which keeps the contest's plain difference (`p.ctPl`); tests/blend.ts max bound = max(old x .5, 1.3).
- Defense HUD (`hud.ts assignMark`): a dashed red ring under the man the focused human is assigned to (`p.man` while
  `manT` runs - switches - else `guardOf`).
- Shot charts: sim `SHOTS` (every FGA from `zoneRes`: team, launch spot `B.lx/ly`, made, three, quarter; reset in
  `start`), game.ts `shotChart(t, maxQ)` draws each team's half court (makes = team-colour dots, misses = x) on the
  halftime (Q1-2) and final screens (`.charts`). Not online guests (no local sim). browser_menu checks a chart renders.
- Pick-and-roll reads (`Play.rd`, decided once): vs a hedge / trap the screener slips (45%), vs switch-all a shooting
  screener (c >= 78) ghosts and pops (50%); roll vs pop reads the coverage (hedge -> dive, CPU drop -> c >= 74 pops).

## Known gaps / ideas
replays/cameras in 2D, more teams, custom 3-point distance (court lines are drawn at 23.75 ft), substitutions and
badge windows online (rosters are fixed there), commentary is text templates + browser speech, Classic has no new features.

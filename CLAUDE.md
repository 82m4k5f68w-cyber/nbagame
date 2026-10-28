# Hoops 2K27 — project guide (read this first)

Browser basketball game: 5v5 and 1v1, full court, 3D (three.js + Rapier) and 2D, plus a Classic side-view 1v1.
Everything ships as ONE self-contained HTML file (`dist/hoops2k27-hub.html`, ~2.6 MB: three.js + Rapier inlined, no CDN).
Unofficial fan project; rosters/ratings are approximations (14 teams, 70 players, 2026-27 era).

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
- Shooting: `step` ('c' charge, 's' shot) -> `launch(p)`. Green window: `greenWin(p, rat, cx, wm0) = (.07+rating/100*.05) * cwin(cx) * fatigue * winMul`, `cwin = max(.25, 1 - cx)` (open full, light .3 -30%, smothered .75+ -75%); `shotContest(p)` = live contest while charging, locked `p.cw` at release - launch, hud.ts meter, Unity Hud.cs and the auto-release all call these (meter == launch; the HUD label reads CONTESTED / SMOTHERED · WINDOW -N%). Meter ideal .6 (.45 quick style). Green is at the TOP of the meter. A human's green ALWAYS goes in unless blocked (launch: green = make, layups too; `B.gd` -> bstep `greenGuide` re-aims it at the rim centre from .9 s out on the way down, and nobody may catch it in flight above 60 px) - every physics path (Rapier, legacy, Unity BallSim/PhysX), heaves, crowded, lefties; greens/crowded/curry/lefty/green_window.ts + Unity Greens.cs require 100%. Root causes were a deliberate .02+.25cx miss roll on greens, legacy aim rounding, and rebounders grabbing heaves 2 ft in front of the rim. CPU makes stay rating-rolled (no guide). Tempo is per controller (`ctrl.tempo`). Online, the release carries the shooter's own measured meter time (`Input.mt`/`tp`), clamped to the server's view.
- Contest: `contestOf(p)` (lag-compensated for remote shooters via `ctrl.lag`), locked at release (`p.cw`). Meters: `hud.ts meter(p)` (4 styles, `V.METER`).
- Aim: `launch` solves a parabola, then (Rapier) pre-simulates with drag+Magnus and corrects range AND sideways error. This is why greens still go in with real physics.
  The pre-sim must mirror `rapStep` + Rapier step for step (h = 1/120, symplectic Euler, spin decaying with the ball's
  angular damping .3): with a constant spin it over-predicted Magnus lift and heaves fell short (85% -> 98% on green).
- Release point: `pose.ts handPos(p)` — analytic forward kinematics that matches the three.js rig exactly (`tests/fk.ts`), so the server/Node sim releases from the same hand as the 3D client.
- Physics: `bstep` (legacy ball) vs `physics.ts rapInit/rapStep` (Rapier ball, rim = 24 capsules, board, floor, walls). Shots, loose balls and passes (with backspin) fly through Rapier. `rapSyncPlayers`: kinematic torso capsules (`cfg.playerBodies`, on) that only touch a loose/shot ball, never the shooter right after release or passes. Dribble: `dz` push/bounce/catch cycle (hand pushes down, e=.82 floor bounce, cushioned catch at `dribTop` = hip height, lower when guarded) beside the right hand + a critically damped spring for xy; the hand IK waits at the hip (`B.dtop`); the client plays the bounce sound by watching `B.z` (no net events).
- Net: `NETS/netSim` 16-strand diamond weave, elastic nylon strands (stretch + recoil), real gravity, 2 sub-steps for fast balls, two-way ball-vs-strand contact with friction (reaction only below the rim, so makes are decided by the iron; a slow ball is always let go after .5 s), simulated rim flex (dunks yank it down, hangs hold it, the top ring rides the rim), rim-hit ripples, idle sway; ball motion is read from positions so replays/guests drive it too; no RNG. `tests/net_swish.ts` asserts visible motion. 3D/2D draw cords only (the shape rings are invisible).
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
- Post-processing (`client/fx3d.ts`, three r186; v6 changes below): MSAA HDR render -> N8AO (was SSAO) -> Bokeh DOF (replays + intro, `setDof`) ->
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
- Rig v6 (anatomy pass): each limb is one continuous lofted, skinned surface (chest/lats/biceps/triceps/forearm/quads/calves shaped by build `bk`, tall = leaner), shoulder caps, neck into traps, hands with palm + 4 fingers + thumb; faces with real eyes (iris/pupil/lids), nose, lips, ears; 11 painted hair styles with soft hairline volume (locks only `hs:1`, cornrows `hs:5`), 5 facial-hair styles; tank-top jersey with team-trim piping, shorts stripe/hem, 512 px lettering texture per player; 10 shoe colourways x 3 cuts; deterministic accessories (sleeves, bands, tights, headband, tape). High = ~24k tris, Low/Medium/bench/refs ~9.9k. Unity mirrors it in `Game/RigMesh.cs` (UnityEngine-free, tested by CoreTests/RigMeshCheck.cs). tests: fk.ts arm checks, browser_arms.mjs.
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
- Menus (`game.ts`, styled by UI v6 below): matchup screen `menu()` (your team vs chosen/random opponent `OPP`, lineups with drawn `avatar()` portraits, tale of the tape, difficulty `cfg.DIFF` applied via `cpuK()` to CPU-only teams, quarter length `ST.QLEN`, settings drawer `#sd` = ui/settings.ts), final screen (record `rec` in localStorage `h2k_rec`, player of the game, stat bars, rematch), hub Quick Play (`h2k_lastplay`).
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
- Reliability (v5.1): `RoomTransport` (client/net/room.ts) paces presence (one call in flight, >= 33 ms apart, sent
  at once when due - never only on a timer: background tabs throttle timers to ~1/s), merges pending patches, resends
  the WHOLE merged state after a failure (backoff 60 ms .. 3 s), re-asserts it when idle 3 s, and rejoins the room
  after 5 s disconnected (listeners carried over). `WsTransport`: ping every 2 s, a socket silent for 6 s is closed
  and replaced, reconnect backoff .5 .. 5 s, garbled frames ignored; relay answers pings and terminates sockets that
  miss a protocol pong (15 s). Host: lobby re-published every 2 s; a guest who drops out of the lobby keeps his seat
  15 s (`Slot.gone`, shown OFFLINE); in a game a guest silent for 6 s is handed to the AI (`staleCheck`, every 30
  ticks; reset at start) until heard from again. Guests see "CONNECTION LOST — RECONNECTING…". `NET.rel()` = test
  readout. tests: browser_room_faults.mjs, ws_reconnect.ts.
- Online substitutions (PROTO 10): the reserves are deterministic per team (`reserves()` seeded by the team name), every
  Player has a stable roster id `rid` (starters 0-4, bench 5-7); the host runs `subs()` online too and publishes the
  lineup `U` (`G.lineup()`: rids per slot); guests `applyLineup(U)` (same `swap()`) before applying the snapshot. The
  box score `X` is keyed by [team, rid] over `ROST` (benched players keep their lines). net.ts: the dedicated host
  (env H2K_SUBTEST) subs at 3 s and the guest must follow.
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
- Blocks (launch): control block (p .15 + (d-60)/160) tipped to the nearest teammate within 160 px or himself, landing
  chest high in .75 s (`B.ctl` -> `STAT.ctlKeep` when his team catches it); swat (to .5) hard toward the nearest
  sideline ("SENT AWAY!"); else the old pop.
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
- Rare freezes (unseeded invariants games) are found by state, not by repro: invariants.ts now fails "game clock stuck
  60 s" with the dead-ball / ftq / ball state - that is how the FT-catch and lodged-ball freezes were found.
- Rapier 0.21 tried and reverted (Oct 2026): +2.3 MB wasm (build 4.1 -> 6.4 MB), sim tick no faster (0.66 vs 0.61 ms).
  If you upgrade again: set `world.lengthUnit = 32.8` (game units per meter) - at the default 1 it scales a hidden
  speed cap (~400 units/s) and deep threes fell 3 ft short (greens 98% -> 89%).
- Engine choice: three.js stays (Babylon/PlayCanvas = same class, bigger; Unity/Unreal/Godot can't ship as one
  small HTML file and run worse on Chromebooks).
- Bone rest positions must walk the parent chain: the arm bones' parent (chest, 12) has a HIGHER index, so an index-order
  pass built Unity's arms ~4 ft low ("arms don't show"). Anisotropy helper must not call itself (capped textures at 4x).
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
- Lodged ball (bstep): wedged 1+ px behind the back iron (between iron and glass, the old nudge could never lift it over
  - a game froze with the clock at 0) -> game-like modes: whistle, "LODGED BALL" held ball, the defense gets it
  (`setup(1 - shooter's team)`, counted as a miss); practice/contests: lifted out in front of the rim. rim_wedge.ts.
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

## Smooth play (v5.2)
- Default graphics by GPU (`view.ts gpuTier`, WEBGL_debug_renderer_info): software -> Low; integrated (Intel/UHD/Iris,
  Mali/Adreno, AMD APU), Chromebooks, <= 4 cores, touch -> Medium; discrete -> High. Saved only when picked (`h2k_set.q2`;
  the old always-saved `q` is ignored). Frame-rate guard (render3d draw): ema judged every 30 frames (5 when crawling),
  > 21 ms drops a rung (2 when > 34 ms), at rung 0 two more slow verdicts lower `V.QL` for the session (banner via
  `V.QAUTO`); climbs back after 2 s of < 13 ms frames; `settle` skips shader-compile frames, a hidden tab skips the gap.
  game.ts loop drops sim backlog beyond 2 steps (no catch-up snowball). JS is ~1 ms/frame: lag is GPU (High = mirror
  re-render + SSAO + 4K shadows at 2x DPR). Polygon count is not the bottleneck.

## Pro Play pack (v5.3, `cfg.PP` >= 1 in both engines)
- The Unity-only UP sim moves are shared now: TS "Pro Play pack" block in sim.ts (before `step`) = C# Core/Sim.UP.cs,
  same names and random-draw order; hooks are `cfg.PP` guarded (C# `cfg.PP != 0`). `cfg.UP` now only gates the
  Unity-only poses (Pose.UP.cs) and PH2 ball physics. Counters: TS `PPC`, C# `UPC`.
- Keys unchanged, the stick picks the variant when the move key is pressed: C = hesitation | + stick sideways
  IN-AND-OUT (mvk 5) | + stick back SNATCH-BACK (7); V = behind the back | + sideways CROSSOVER (6); flick at speed =
  crossover, again inside .5 s = DOUBLE CROSSOVER; any move inside .5 s of the last chains a combo (HESI CROSS,
  KILLER CROSS). A flick that points back away from the rim is a retreat dribble (no move). Space driving at the rim from 8-16
  ft = gather (two-step / hop-step / spin-gather by the defender's spot; `p.gath`, release waits for the takeoff);
  floater (sv 24, clip "floater") vs a rim protector (drive speed from the gather `p.gfw`); post + C = sky hook (sv 25,
  "sky") for 6'11"+ / i >= 88; off-hand reverse (`p.offH`); lean-away vs late closeouts; CPU signature move packages
  (formOf dk), drive gathers, floor putbacks, V-cuts, size-up chains; drive bumps, swipe-downs, hand checks (never steals).
- Human feel: move buffer + cancel window (`ppBuffer`: a press is kept .25 s, inside the last .15 s of a move it
  cancels the tail = combo); sprint burst (first .35 s of a sprint press, `p.spT`); on-ball stance (`ppStance`, human
  guarding the handler within 70 px, no sprint: x1.08 speed, x1.3 accel, auto hand up `hupT` on a shot in his face).
- Contest timing: an airborne defender already coming down (vz < -90) contests x1.15, not x1.5 (pump fakes pay);
  `ppRelease` texts GREAT CONTEST / JUMPED EARLY for human defenders and "FORCED IT · X WAS OPEN" for a human's
  contested early jumper with a teammate open in range (`STAT.badShot`).
- Deflections (`ppDeflect`, one check per pass, `B.dfl`): a pass past a defender's hands slows/turns but stays a pass to
  its man (a tipped pass `B.dfl = 2` is exempt from the slow-roll dead-pass rule; 3 s fallback stays). Steals stay OFF.
- Glass: height counts in rebounding (`(ht - 6.5) * 10` on reach and the scramble roll); `p.boxT` now decays (it used
  to count forever once set).
- Bug fixes: the rebound assist no longer steers / jumps for a human pushing the stick another way; a handler's facing
  no longer flips to the rim on float noise (`sv > 1`: was a TS/C# divergence); pose rT treats "sky" like "hook".
- Parity: `scripts/unity/trace.ts [N] [hum]` / `Trace.cs [N] [hum]` - `hum` adds a scripted human (arithmetic-only
  input pattern) so the human-only paths are covered too. Tests: tests/propl.ts (features, PP on/off), tests/sanity.ts
  (stalls, frozen handlers, passive-human auto-actions, needless heaves, backcourt, bodies through each other);
  `PP=0|1` env on tests/stats.ts for A/B.
- Lesson: never end an inserted comment with `//` in the MIDDLE of a TS expression line - it silently commented out
  the rest (the LD badge multiplier) and only the C# trace caught it.

## Animation pack (v5.4, `cfg.AP` = 1 in both engines; 0 = v5.3 poses for A/B)
- The Unity-only pose layer (Pose.UP.cs) is shared now: pose.ts `upPose` / `upGatherPose` / `upGuide` (damped
  Gauss-Newton guide palm on the ball's side until the release) / `upCt` (contact corrections on a spring) = C# same
  names; C# runs them when `upA` (= cfg.UP || cfg.AP). Shot loads + follow-through by form, 1-2 step vs hop gather
  (`p.jg`), drive gathers (`p.gath`, stepping too), layup protect/shield/reach, two-foot floaters, off-hand finishes
  mirror the shot (`p.offH`), move anticipation + settle, slide hip opening, swipe/hand-check poses, contest variety,
  cut lean, V-cut plant, screen brace/roll, alley-oop hands. Body dips are skipped while both hands hold the ball.
- `apPose` (after upPose, same order in C#): defenders flinch on pump fakes (weaker defenders more) and rock back on
  jabs; on-ball D bounces on his toes; teammates of a big celebration (`bigCel`) fist-pump / clap, opponents sag
  (hands on hips) - staggered by slot; shooter frustration on `p.frT` (head shake via `HEADY`, clap, hands on head);
  per-shot follow-through variety (`p.shV`, drawn at the gather, post-release only: release point untouched).
- Root yaw `p.ry` (drawn facing `fv`) = `turnRun` (hip turn: backpedal/slide > ~15 ft/s and > 70 deg off facing opens
  the hips and runs; straight back he opens toward the ball; spring `p.trY`; `turned` drops the stance/pistol/closeout
  layers, gait + head use the drawn frame, chest counter-turns 30%) + `faceLag` (a sim facing snap > 0.3 rad/tick is
  absorbed into `p.rfO`, exact critically damped decay ~0.2 s). Drawn yaw max 3.14 -> 0.89 rad/tick.
  Replays record `p.f + p.ry` and clear `p.ry` on playback (spins/hip turns replay right).
- Fixes: the inbounder's two-hand IK aims at the in-world (clamped) ball - he stands behind the line, the ball is
  clamped to x 6..934 (hands used to stay 1-2 ft from the ball); a holder who must stand (inbound, triple threat,
  fakes, FT) is never drawn in a left-over fall/dive (`upGot`).
- Round 2 (same flag): slide footwork - a sideways step lifts >= 3.2 px and only travels while the foot is up (`swh`:
  pick up, step, plant), defensive foot slide 32 -> ~14 px/s (all states ~20 -> ~11); contested jumper: legs tuck and
  kick through in the air (legs hang off the root, so the release point is untouched), falls away + off arm up only
  after the release; rebound read (ready stance, hands at the shoulders near that rim while a shot is up, unless boxing
  out); dunk landings (3 styles by slot, ~0.7 s, `p.apL`); celebration variants per celebration (`p.celV`: one-arm
  three, hip shimmy, fists roar, two-hand point, one-arm flex); high five when a celebrating teammate's hand is up within
  75 px (reaches for his `skel` hand); hand check latches its arm at the jab start (`p.hcS`) and fades for a hip
  behind him (an armIK branch flip popped aR 3.3 rad). Bench (render3d benchUpd): 4 cheer styles (wave, towel circle,
  clap, bounce + fist pump) staggered, 3 seated postures.
- Traces: `POSE=1` adds a per-player pose checksum (all 31 channels) to trace.ts / Trace.cs - pose parity, not just
  positions. Studio: hip turn, fake reactions, big-play reactions, miss frustration entries.

## Pro Play v2 (v5.4, `cfg.PP` = 2 default; 1 = v5.3 pack, 0 = v5.2 - A/B in stats.ts `PP=`)
- TS block "Pro Play v2" in sim.ts (before `step`) = C# `Core/Sim.PP2.cs`, same names / random-draw order, every hook
  `cfg.PP >= 2`. Counters in `PPC` (C# `UPC`). Tests: tests/propl2.ts. Trace modes: `trace.ts N [hum|my]` / `Trace.cs`
  (`my` = the scripted human as My Player + post-key presses: covers the off-ball calls).
- Reads (`pp2Read`, replaces the ankle roll in upMoveStart): odds from s vs d, AB, combo, fatigue, the defender's
  lateral momentum vs the move side (wrong-footed +.2 / already there -.2), per-move counters (hesi vs a retreating or
  charging man, spin off contact, crosses vs hard closeouts), human stance -.08. One draw r: r < .14c (wrong-footed /
  combo) = ANKLE BREAKER (act 3 fall), < .6c CROSSED UP (stumble), < c BLOW-BY, else STAYED IN FRONT / READ IT! (handler
  cd .75). `p.beatT` = just beat his man.
- Shots (`pp2Gather` at i->c): a shot out of a move is a pull-up (move ends -> RHYTHM); balance `p.sq/p.sqn` (SQN:
  OFF BALANCE .84, FADING .9, ON THE MOVE .93, CREATED SPACE 1.08, FADEAWAY .94, LEANER .96) multiplies the window in
  `winMul` (meter and launch agree; only in c/s). Humans: stick away from the rim at the shot = FADEAWAY (fsv 2, drifts
  back 95 px/s), sideways inside the arc = LEANER (fsv 20); their separation (x.82 / x.9) lives in `contestOf` so the
  meter shows it. Catch-and-shoot buffer (`pp2CsBuf/pp2CsCatch`): shoot pressed with a non-lob pass arriving < .45 s
  doesn't jump; the jumper starts on the catch. Side-step = step-back key + stick sideways (`pp2SideStep`, CPU via `p.ssq`).
- Post (`pp2Backdown`): strength bk*ht*(.75+i/400) vs bk*ht*(.75+d/400) (x1.25 for a human defender holding the stick
  into him): the stronger moves him, a weak post man is pushed back (HOLDS HIS GROUND / BODIED UP).
- Contact: drive bump (`pp2Bump`) - a set defender (ahead, slow / in stance) CUTS OFF the drive (its speed into him x
  .25-.75 by strength) and that contact is where a charge is read (collide would only see the slowed driver);
  a moving one is BUMPED OFF. `pp2Charge`: no RA, the driver's own pre-contact speed (`pvx`) >= 150, square to his
  facing, set feet `p.stillT` (> .3 s .72, > .12 .45, else .15), never vs a defender who stepped in. `pp2BlkK`: blocking
  fouls x.6 set / x1.3 moving. Block timing `pp2BlkT` (apex x1.3 .. x.55). And-ones: a fouled shot goes in less (layup
  x.5, CPU jumper x.35; human greens and dunks unchanged), shooting-foul rate x.52 (was .42).
- Human D: stance slides bend 30% toward the cut-off point (`pp2Angle`); stick at the handler from 45-160 px = closeout
  burst (`pp2Close`, `p.coT`). Off-ball offense (My Player): pass key = BALL! (`pp2Call` -> CPU handler `pp2Feed` passes
  if the lane is open, else DENIED); post key away from the post = SCREEN! (with the ball beyond 19 ft: pnr from the best
  big) / PIN-DOWN! (off the ball) (`pp2Screen`, sets PLAY; a user-called iso still clears it); stick flick = cut burst
  (`pp2Cut`, `p.cutT`), BACKDOOR! past a denying defender. All host+prediction safe (no new synced state, PROTO unchanged).

## Team play pack (v5.4; sim.ts "Team play pack" block after `cut()` = C# Core/Sim.TP.cs)
- Coach IQ `cpuIQ(t)` = cfg.DIFF for CPU teams (a human's AI teammates: 2). Gates: named sets (Pro+: horns, post entry,
  zipper; All-Star+: Spain, stagger, end-of-quarter), ATO plays (Pro+), doubles (Pro+), blitz / box-and-one (All-Star+),
  rotations behind the help (Pro+), gamePlan cadence (every 6-lv possessions). Rookie = drop, no sets, no doubles.
- Sets (`tpSet`, called from newPlay; Play gains v/s2/sd/st/stT/pop/nm/ato/fed/ic/bl/cal/fa): pnr variants `horns`
  (s2 = other big at the elbow: dives if the screener pops, lifts if he rolls), `spain` (s2 back-screens the roller's
  man, plants .5 s, pops to the top); pin variants `stagger` (use runs off scr then s2 to the wing), `zip` (down screen,
  catch at the top), `post` (cross screen, seal on the ball-side block, entry -> `ai.post`). Named sets start only within
  330 px of the rim (a base play called in the backcourt has `fa` and is re-called there); screener timings shorter
  (`tpSetLen`); the CPU handler waits a beat (`ai.w` -0.5/-0.8) and `tpCall` points him at the featured man.
  Human play calls PCN 5-7 = HORNS / SPAIN / POST UP (PCN/DSN stay <= 8 entries: 3-bit online packing, no PROTO bump).
- ATO: a CPU `callTO` sets `TS.ato[t]`; the next half-court set is the star's (spain/horns if he has it, post, floppy,
  zipper). End of quarter (clock < shot clock, < 12 s): horns/zipper for the star.
- Coverage `TS.cov` (COVN): 0 drop, 1 hedge, 2 ICE (on-ball man shades the screen side, big sits low baseline side;
  vs rim-hot teams), 3 blitz (screener's man traps with the on-ball man, `tpTag`: nearest other defender tags the roller;
  vs a hot pull-up star). Box-and-one `TS.ds` 5 (`boxTarget`: lone hot shooter with 35%+ of their points; `boxCh` =
  manOf(target) face-guards, the other four in zoneMan's box).
- Rotations (`subs`): foul trouble (`ftrb`: pf >= q+1 sits a starter, `p.ftS` brings him back next quarter), closers
  (clutch / OT: starters replace reserves, en > .35), garbage time (Q4, < 4 broadcast min, 20+: starters sit).
- Rules: bonus = 5th team foul (4th in OT) or 2nd in the last 2 broadcast minutes (`TS.l2`, `TS.bon` -> HUD "BONUS");
  2 timeouts per overtime. Commentary keys set/ato/ice/blitz/boxone/foultrouble/closers/bonus (broadcast.ts +
  Unity Broadcast.cs); HUD "THEY'RE RUNNING: <set>" for the human's defense.
- Client: POG = best Hollinger game score on the winners unless a loser is 10+ better (`gmSc`, `lineTag`: game.ts, ui.js,
  Menus.cs); My Player career (`client/career.ts`: XP per game, levels raise the builder cap +3, badge requirements);
  Season v2 (modesui.ts: PF/PA, streaks, league leaders from real + generated box scores, best-of-3 playoffs, awards).
- tests/teamplay.ts. Parity: trace.ts vs Trace.cs identical for the whole 46000-tick game (normal) and 3000 (hum).
- Balance pass (A/B: `cfg.TP` 0/1, stats.ts env `TP=` / `DIFF=`; STAT `j3n/j3mk`, `j2n/j2mk` = CPU jumpers launched /
  meant to go in): the 3P% / ORtg drop was NOT the sets (TP 0 vs 1 equal within noise once the horns lift went to the
  elbow for c < 76 and the stagger wing came in to 26 ft) but (1) CPU drivers ploughing into set defenders - 9.6 charges
  a game (pp2Charge odds x.2 for a CPU driver; humans keep the full read) - and (2) the iron/blocks taking ~4 points off
  what launch intends (CPU jumper base re-based: three .392 + .17(r-60)/40, two .31). stats.ts QL 180: 3P% 27.4 -> 35.5,
  FG% 43.3 -> 46.5, ORtg 98 -> 109 (NBA 114.5), TOV/48 24 -> 4. Per-48 volumes are ~2x the NBA because of the arcade pace
  (~193 vs 98.5): compare rates (3PA/FGA 24% vs NBA 42%), not per-48 counts.

## H2K Super Resolution (HSR, v5.5: `client/hsr.ts`, fx3d.ts, fxgpu.ts)
- Renders the effect chain at an internal resolution and rebuilds the full-res image. `V.HSR` 0 Off, 1 Auto (dynamic
  res), 2 Quality .67, 3 Balanced .58, 4 Performance .5, 5 Ultra .33 (`HSRN/HSRS`); `V.HSRM` upscaler 0 auto (temporal,
  spatial on Low), 1 temporal, 2 spatial (`hsrMode()`); `V.TFPS` 60/90/120/144/240/0=Max; `V.HZ` measured refresh
  (`measureRefresh`, rAF 1 s, shown "Your screen: N Hz"); `V.FPSC` HUD FPS counter (game.ts `fpsHud`). Saved in
  h2k_set `hs` (only when picked: default discrete Off, others Auto) / `hm` / `tf` / `fc`.
- WebGL temporal: Halton(2,3) jitter on `cam.projectionMatrix` (restored after the frame: HUD `proj()` stays
  unjittered), composer at low res WITHOUT MSAA + `DepthTexture` on both composer buffers; `ScenePass.after` runs
  `hsr.pre()` right after the scene is drawn (later full-screen passes render with autoClear and WIPE the depth of
  the buffer they write: reading it after the chain gave far-plane depth everywhere = ghosting on camera moves),
  velocity pass for `fx.dyn` (rig roots + ball + refs; borrowed as children of a private Scene, override material
  with previous model matrix AND previous bone texture per skeleton = exact limb motion), prep pass (camera
  reprojection of depth elsewhere), resolve at output res (MRT: color + [lock, weight]; 3x3 depth dilation,
  Blackman-Harris reconstruction, Catmull-Rom history, YCoCg variance clip, disocclusion vs previous depth,
  thin-feature lock, accumulation weight), RCAS to the screen. Works on the tone-mapped output (cheap; chain at low
  res). Camera cuts (> 3.5 ft or 10 deg in a frame) reset history. Spatial: EASU + RCAS. WebGPU: three's `taau`
  (MRT velocity, samples 0) + `sharpen`, spatial = `rtt(...)`.setResolutionScale -> `fsr1`.
- Dynamic res (`makeDynRes`, render3d guard): every 12 frames, late (> 1.12 x `targetMs()`) -> scale x ~.9, on time
  for 8 checks -> +.05, a failed scale is not re-probed for 8 s; range .45..1. The effects ladder only drops once
  the scale is at .45, and its 85/75% rungs scale the internal res (output never shrinks). rAF is capped at the
  refresh, so targets above it mean "every refresh".
- Measured (SwiftShader, Medium, 1000x562 out): Performance-T 25% pixels -> ~.32x frame cost of native, +25 draw calls
  (velocity pass); net close-up SSIM vs native .976 Quality / .971 Balanced / .964 Performance-T / .956 Performance-S /
  .926 Ultra; net-cord flicker 10.3 (raw jittered) -> .32 with history. `hsrProbe(u,v)` reads a prep texel.
- Composer render targets are w x pixelRatio UNROUNDED: always floor before using them as sizes (GL truncates).
- Debug: `V.GL.stats()` (hsr sizes, draw calls per frame - `R.info.autoReset` is off and reset per draw), `V.GL.pin(lvl)`
  freezes the ladder (tests), `V.GL.hsrReset()`. tests/browser_hsr.mjs (+ `webgpu`), screenshots docs/hsr/.
- Unity: `Arena.HSR/HSRM/TFPS/HsrScale` + the same dynamic-res loop in `Guard`; PostFx: URP renderScale + STP (compute
  shaders) or FSR 1; page keys hsr/hsrm/tfps (ui.js Graphics tab, PageBridge).
- Scene materials compile behind the tip-off (`R.compileAsync` when the rigs are built).

## Crowd chants (v5.5; browser `client/chantdir.ts` + `chantsyn.ts` + `crowd.ts`, Unity `Game/ChantDir.cs` + `ChantSynth.cs` + `Chants.cs`)
- Synthesis (no audio files): each chant = 10-16 crowd voices (pulse + breath through 3 vowel formant band-passes,
  plosive/fricative/nasal onsets + codas, detuned, timing scatter, panned + delayed by seat) x3 via two delayed section
  copies, stomps / claps (cached grains), fan whistles, roar wash, pre-delay + Schroeder reverb, normalized to .9.
  Rendered ONCE at 22.05 kHz stereo, sliced into <= ~7 ms units per frame (`ChantJob.step`), played as buffers.
  Scores follow the organ's 96 BPM: defense (stomp stomp DE-FENSE), letsgo <team> (+claps; `sylls()` + NICK: WOLVES,
  CAVS, MAVS), mvp, airball (sing-song), overtime, wewant <bench favourite>, rockyou (stomp-stomp-clap), charge
  (answers the organ riff 1.875 s later), reactions boo / roar / aww / shh. C# renders the same samples (RMS equal).
- Director `ChantDir` (pure; same rules / random draws in C#): home = team 0; energy from TS.mom, runs (CCtx.run =
  per-team points; TS.run is [team, pts]!), margin, clutch, OT, excitement scales chance + gain. One chant at a time
  (busy = length + gap 2-7 s), per-chant cooldowns (CH), priorities; reactions cut in (the player fades the chant);
  commentary speaking holds prio < 8; nothing unless `live` (game-like, play, no replay/reel). Triggers: sim FX "air"
  (bstep rebound: no iron `B.rim > BR+4`, no glass `B.gl` this flight; relayed online as "g"), "chant" (Q4 cue),
  cm dunk/splash/block/and1/three (roar), fire (roar + M-V-P), flagrant/goaltend/tech on home (boo), miss rebounded by
  home (stop -> DE-FENSE), "t" GAME WINNER/BUZZER BEATER; ft trips (road boo, clutch home hush `crowd.hush()` + shh,
  star M-V-P), q > 4 (OVERTIME), dead balls (LET'S GO / ROCK YOU / WE WANT, visitors' LET'S GO on a road 8+ run), organ
  riffs (`music.onRiff`: CHARGE! / DE-FENSE on the bar). Music `duck` .45 under a chant, .25 in a hush.
- Shared AudioContext `audio.actx()` (music.ts uses it too); crowd bus = bed + ooh + chants. Settings: drawer CROWD
  Off/Low/Medium/Full (`crowd.vol`, h2k_set CROWD) + CROWD CHANTS (`crowd.on`, CHANTS); Unity page "vc" slider
  (GameAudio.CrowdVol) + "ch" toggle (Chants.On, PlayerPrefs h2k_chants). Debug: `H2K.crowd.stats()/play(id)`, `H2K.CC`.
- Tests: tests/chants.ts, unity/CoreTests/ChantCheck.cs (parity), browser.mjs chant check.

## LIFE (MyLife, `src/life/`; hub card "LIFE", `?life` opens it, `?lifetest` = no NPCs for SwiftShader tests)
- Open-world life sim around the engine: HS senior (12 days, 5 games incl. STATE FINAL) -> Signing Day (3 offers from
  fictional colleges by OVR/PPG/GPA/followers) -> college years (14 days: classes, midterms + finals, practices, 5
  games, last three = March Madness rounds) -> declare after any year (or year 4 + graduation) -> Draft Night (lottery-style
  reveal, 30 picks; > 30 = two-way deal) -> NBA seasons (rookie scale by pick, weekly paychecks, endless seasons).
- `state.ts` (DOM-free, tests/life.ts): one JSON `Life` (save slots `h2k_life_<0..2>`, `h2k_life` = last slot,
  `migrate()` fills new fields). Clock `t` = game minutes (day = t / 1440, weekday 0 = Mon); world time = 1 game
  min per real s x `set.spd`; screens pause it, actions cost their own minutes (`advance(L, min, act)` drains
  energy/hunger, drifts mood, `resolve()` marks closed events missed: class/exam 0, practice/game coach texts, game
  simulated without you). Events `Ev` with join windows `evWin` (class -20..+30 min, game -120..+30); `lateness`
  (5+ min x.9, 15+ x.75). Grades: quiz 50 / homework 20 / exam 30 renormalised, letter -> points, cumulative GPA;
  `probation` (< 2.00 once 3+ grades) blocks games (`canPlay`, also injuries). `draftStock` (OVR, per-game line,
  win%, GPA bonus, followers) -> `projPick`. Followers `followerGain` by perf/fame/highlights; `DEALS` at 2K..500K
  (none in HS). `eat` (fast-food streak = less energy), `workout` (`gainOf` diminishing, overtraining injury),
  `sleep` (to `set.alarm`, quality), `dailyTick` (paychecks, deals, league results, scripted texts).
- `questions.ts` + `qbank.ts`: procedural math by level 0..4 (17 kinds, answers computed) + 329 handwritten rows
  (english/history/science/econ/psych/art/cs/math word problems, bands HS / yr1-2 / yr3-4); `validQ` screens AI too.
- `ai.ts`: artifact `sample` capability (`claude.use("sample")`, null off claude.ai) - `askJSON(key, prompt)` cached,
  45 s timeout, `not_granted` disables, `rate_limited` backs off 90 s. Used on class start (lesson + quiz,
  `aiQuizPrompt/screenAI`, "Use the textbook instead" after 4 s), Hoopr open / after events (`aiFeedPrompt`) and on
  the player's posts (`aiReplyPrompt`); every path has the offline generator. Settings -> AI off.
- `social.ts` Hoopr (fictional network): `postsFor(L, event)` voice templates (fans, haters, reporters, analysts,
  teammate, coach, rival, brands, memes, news), `trending`, `myPost` (local only; `clean()` slur blocklist incl.
  leetspeak + whole-word list, flagged posts limited), `scrub()` strips emails/phones/links before any AI call,
  `screenPosts` drops real brands/platforms (REAL regex), slurs and bad shapes, clamps likes.
- `places.ts` town (feet; Main St z=0, Market St z=168, Campus Ave x=0): campus halls (hale/wren/lab), library,
  dining, dorm, Summit Arena (oval), Iron Temple Gym, Burrito Barn / Slice Society / Morning Grind / Green Leaf,
  Threads, Corner Mart, Fade Factory, home + houses, Central High, The Cage. `doorOf`, `blocked` (collision),
  `travelMin` (ZipRide $6), opening hours.
- `world.ts` (three.js, its OWN WebGLRenderer on `#life canvas.w3`; the arena renderer is untouched): shared
  window texture with world-unit UVs (`boxUV`) + night emissive twin, sign canvases, instanced trees/lamps/parked
  cars, moving cars that brake for you, sidewalk-graph NPC walkers + idlers (rig v6 LOD 0 via `makeRig`, built one per
  frame), sky dome vertex gradient + sun/moon/stars, `light(min)` (sunrise 6:00, sunset 19:30: windows, lamps,
  glow points, exposure), shadow camera follows the player, third-person orbit camera (slab test vs footprints).
  `anim.ts` decodes the CMU walk/run cycles itself (mocap.ts) + idle/sit/wave/phone/eat/lift/shoot/talk overlays.
- `index.ts` shell: title (3 slots, import/export via `downloads` capability or a Blob link), creation (archetypes
  `ARCH`, look, height/build, number, hometown, import My Player look), loop, HUD (time, 4 bars, money, followers,
  GPA), objective line + gold beacon + minimap arrow, toasts from `L.notes`, tutorial (6 steps), place screens,
  class flow (lesson -> 5-question quiz / 8 on exams, keys 1-4), homework, practice, pregame (play / sim / watch if
  ineligible), postgame card (grade, XP via career.ts `gameXP` -> `addXP` skill points), Signing Day / declare /
  Draft Night (`decide()` on `L.pend`), pause menu, touch stick (left half) + orbit drag, gamepad (A interact, Y phone).
- Engine bridge (game.ts hooks only): `GS.idle` (shell loop + key handler sleep, crowd bed muted, music off), `GS.life`
  (no hub record / My Player XP), `GS.onFx` (LIFE counts dunks/blocks/threes/airballs/game-winners), `GS.onQuit`
  (pause Quit = forfeit), `lifeStart({kind, sel, opp, ql, diff})`. Fictional HS/college teams are written into
  `TM[14]/TM[15]` (`teams.ts roster()` deterministic by name) for the game; NBA uses TM 0..13. My Player = the life
  player (`MYP.d` set per game; `h2k_myp` restored after). The engine's final screen gets "Continue (LIFE)".
  Pickup at The Cage = `street3`/`street` modes, practice drill = `3pt`, results via `GS.onMode`.
- `phone.ts`: lock screen (time, notifications) -> home grid -> Messages (reply chips move affinity), Calendar,
  Map (pins, ZipRide), Bank (txns, deals, salary), Hoopr (trending, compose + suggestions, feed with replies, AI
  shimmer), School (GPA, courses, HW, transcript), Stats (ratings, skill points, career table, draft stock),
  Contacts, Settings (day length, alarm, quarters, difficulty, AI, big text, colour-blind, reduce motion). P / Tab / 📱.
- Tests: tests/life.ts (state machine, needs, schedule + late, GPA, probation, sleep/alarm, diet, gains, games +
  followers + deals, HS -> college -> draft -> NBA, save/load + migration, question generator/bank, Hoopr posts,
  moderation, AI screening); tests/browser_life.mjs (title -> create -> walk -> door -> offline class -> phone ->
  Hoopr post + replies -> sleep -> arena game in the engine -> back in LIFE -> save). SwiftShader ~1 fps: drive via
  `window.H2K_LIFE` (goto, setTime, enter, interact, L, W) and presence waits with `polling: 100`.
- Stage 2 (school depth): tournaments = last games of a season tagged `big` "state" (2 rounds) / "mm" (3: Elite Eight,
  Final Four, National Title) with `rd`; `bracket()` (end of `recordGame`) removes later rounds on a loss, the last
  round sets `flags.champ` -> State / National Champions award at `endYear`; `dailyTick` drops the tournament for a
  losing record. College = 6 games. Signing Day: Official visit cards + Commit, then `pickMajor` (`MAJORS`: Business
  deals +10%, Kinesiology workouts +10%, Communications followers +10%, Education quiz +3%, CS homework +5).
  `groupStudy` (library, Dre/Kofi), film sessions at practice (`BANK.film` basketball-IQ quiz -> coach trust + D),
  `role(L)` from coach trust (Starter / Sixth man / Bench: shown pregame, scales simulated lines), `standings` +
  phone League app (NBA table built in `beginYear`, `oppClub`).
- Stage 3 (draft & NBA): pre-draft (`flags.predraft`) = `combine()` (measurements/tests from ratings -> `flags.combo`
  stock change), 3 team interviews (`IVQ`, `interview()` -> `L.fav`: a team that loved you trades into +-5 picks in
  `runDraft`), agent pick (`AGENTS`: fee / contract x / deal x / rep), mock-draft Hoopr posts. NBA season = 3 games +
  playoffs `big` "po" (Conf Semis / Conf Finals / NBA Finals; title -> "parade" card, next season "ring" card), an
  All-Star game event (`k "allstar"`, selected at `dailyTick` by PPG >= 12 or 60K followers; engine game with the
  league's top 10 split into Team Gold / Team Ice in TM[14]/[15], you replace Gold's lowest), paychecks net of `TAX`
  30% + agent fee, awards at `endYear` (ROY, MVP / All-NBA, DPOY, MIP, Finals MVP) queued as `award:` story cards
  (MVP speech choice). Contract ends -> `pend "fa"`: `faOffers` (your team + 3, `marketValue`), counter with a slider
  (`acceptChance`: 100% at the offer .. 0 at +40%, one try per team), `signFA` (new team -> table + coach reset).
  `requestTrade` (Stats app) -> `tradeTo` a few days later. Away NBA games: `roadReturn` (hotel, home 9:00 next day).
  `legacy()` vs `HOF` in Stats. Story queue `L.story` -> `story()` cut / choice cards when the player is free
  (role meeting, rookie duty, All-Star, trade, awards, parade, ring). Rumour / trade / FA log entries feed Hoopr.
  Test: tests/browser_life_career.mjs (Signing Day -> college -> declare -> combine/interviews/agent -> draft -> story
  cards -> free agency).
- Roadmap + ticks: docs/LIFE_FEATURES.md (status/next item at the top). Known gaps: one shared town for every stage
  (hometowns differ by name only), the player's hair override (`hs`) isn't used by the engine's game rig (formOf),
  no interiors in 3D (place screens), NPCs don't path around buildings (sidewalk graph only).

## UI v6 (design system; `src/client/ui/`)
- Tokens: `ui/tokens.css` (colour / type / spacing / radii / shadows / motion as CSS vars: `--ink-0..3`, `--glass`,
  `--line`, `--tx/-2/-3`, `--acc`/`--acc-2`/`--acc-grad`, `--ff-display` (Oswald variable, OFL, inlined 28 KB in
  `ui/fonts/`), `--fs-*` in rem, `--sp-*`, `--r-*`, `--sh-*`, `--dur-*`) + root switches `html[data-theme=dark|light|auto]`,
  `[data-text=1|2]`, `[data-motion=reduce]`, `[data-contrast=high]`. `ui/kit.css` = shared components (`.btn .pri .lg
  .ghost .icon`, `.seg` (segmented options, `button.on`), `.panel`, `.chip`, `.tabs`, `#sd` settings drawer, `.cmp` stat
  bars, `.bx` tables, `.eyebrow`, `.disp`). Both imported by main.ts (always on); LIFE and any new screen must reuse
  these vars/classes, not redefine colours. index.html `#hcss` = hub layout, `#gcss` = game screens (matchup `.mu/.vs/
  .side/.mid/.strip/.modes`, pause `.pzw/.mlist/.board`, final/halftime `.fin/.fhead/.fgrid/.pog/.charts`, legacy lobby
  classes `.opts/.big/.ghost/.logo`). `#h` stays transparent.
- `ui/settings.ts`: owns h2k_set (`loadSet/saveSet`; `ST` = MYM / QLEN / QPICK / HPICK, moved out of game.ts) and the
  tabbed drawer `openSettings(tab, ctx "hub"|"menu"|"pause", onClose)`: Gameplay / Controls (key remap) / Display (camera,
  graphics, effects, renderer, HSR, upscaler, target FPS, FPS counter, HUD full/minimal, menu theme) / Audio (commentary,
  announcer voice, music, crowd volume, chants) / Accessibility (text size, meter palette, meter size, high contrast,
  reduce motion, sprint hold/toggle, auto-release). Every panel is in the DOM (inactive ones `hidden`), options are
  `[data-<key>="<v>"]`. New settings: add one row to the `I` table + a `V` field (view.ts) + KEYS in settings.ts.
  View fields: `V.THEME/TXT/RM/HC/MINHUD/SPT`, `V.CB` 0..3 = `PAL` (view.ts: standard, red-green safe, blue-yellow safe,
  monochrome; green stays at the top). RM also skips camera shake; SPT toggle lives in input.ts (`spOn`).
- `ui/nav.ts`: menu navigation for keyboard + gamepad: arrows / d-pad move focus spatially in the top layer (`trapNav`
  dialogs, else `setNavBase` root: hub or `#ov`), Enter / Space / A activate, Esc / B back, shoulder buttons -> shell
  (`menuPad`: LB RB your team, LT RT opponent, Start tip off / resume, Select settings). Matchup keys: Q E / Z C cycle
  teams, S settings (arrows no longer cycle teams). Inactive while playing; `NAV.hold` while remapping a key.
  input.ts never eats Enter / Space on a focused control; `clearEdges()` at every start drops menu key presses.
- `ui/art.ts`: procedural mode art (`modeArt(kind, c1, c2)` canvas -> cached webp data URL), `teamMark(name, col)`
  generic SVG shield + monogram (no real logos), `brandMark`, colour helpers `shade/lum/light`.
- HUD (hud.ts): `scoreBug(me)` top-centre broadcast bug (replaces broadcast.ts `drawBug`, which is no longer called):
  team blocks, scores, period + clock, shot clock, timeout pips, fouls / BONUS, possession dot, momentum line, "THEY'RE
  RUNNING"; `hud2` = player card bottom-right + shooting chip; `nameTags`; fonts `FD()` (display face); text scale `tk()`
  = V.TXT x 1.5 when the canvas is < 620 px wide (phones). V.MINHUD hides card / calls / markers.
- Hub (main.ts): featured mode + Quick Play / career / record tiles + mode cards with art + news (LOG[0..2]); the
  literals `MODES` / `LOG` / `K1..K5` stay parseable for scripts/unity/gen-page.ts. Hub Esc = back to Play.
- Unity page mirrors it: gen-page copies tokens.css / kit.css / fonts into TemplateData; ui.js has the same hub
  layout (CSS art), team marks, tape, 5 settings tabs (page-level a11y via the same data attributes; `cb` 0..3 /
  `mh` / `spt` / `ts` / `hc` / `rm` / `th` are sent as settings - PageBridge ignores the new keys and treats cb != 0 as
  colour-blind: Unity HUD palettes are a known gap). Tests: tests/browser_ui.mjs (keyboard-only every screen, gamepad,
  persistence, a11y, phone no horizontal scroll), tests/unity_page.mjs.
- Lessons: `backdrop-filter` / `transform` (incl. a running entry animation) on an ancestor make `position:fixed`
  children relative to it (the phone's sticky TIP OFF); headless rAF is slow, hold stubbed pad buttons >= 200 ms.

## Graphics v6 (render3d.ts + gfx3d.ts + gfxtex.ts, fx3d.ts, fxgpu.ts, rig3d.ts materials, view.ts)
- Presets (`view.ts PRESETS`, `applyPreset`, settings `pre`): Chromebook = Medium + HSR Auto, no AO (the old Medium:
  must never get slower) / Balanced = + half-res AO / High = native, full AO, mirror, 4K shadows / Ultra = new `V.QL` 3
  (DPR/MAXR as High + 4K soft shadows r5, AO 16 samples, 3600-fan crowd with the upper deck, live jumbotron cam, mirror
  at internal res x1). `QLN` names; LIFE gets `min(2, QL)`. New V fields (saved via settings KEYS): `PRE` (-1 custom),
  `AO` (-1 auto = full on QL>=2, `aoLevel()`), `GRADE` (`GRADES`: Broadcast / Vivid / Film / Neutral), `GRAIN`, `WX`.
- Environment: no RoomEnvironment; `gfx3d arenaEnv(home)` (dark bowl, catwalk light grid, LED fascia in the home colour,
  warm court bounce) / `skyEnv(wx)` -> PMREM (`envSet(key)`, regenerated only when the home colour / weather changes).
- Lights: hemi .16 (house lights down), key `sun` (shadows; PCF radius 2.5/3.5/5 by tier), `back` (cool, high: a low
  back light threw a blown-out specular streak across the clearcoat floor), warm `fill`, the 4 catwalk spots. Player
  pop comes from rig3d's fresnel rim (`RIM` uniform, warm at sunset).
- Floor: CC0 ambientCG maple via `gfxtex.ts` (KTX2; imports ONLY wood + asphalt; uses three's own inlined transcoder -
  an extra `?inline` copy cost 0.8 MB). WebGL: `detail()` multiplies the wood colour (normalised by its smallest mip)
  into the painted court and the canvas drops its own boards (`woodOn`); WebGPU keeps canvas boards + normal/rough.
  `mipBias(mat)` (fx3d `HSRBIAS`, log2(scale) x .85 while temporal HSR runs) on court + street. Fictional centre crest
  (`DECAL`), no real logos. Mirror RT = internal res x .75 (x1 Ultra), resized in fxLevel.
- Bowl (gfx3d `bowl`): `ROWS` 20 (`rowY/rowOff`: lower 0-11, upper deck 12-19 behind an LED fascia band on the front
  face of row 12), aisles (`AISLE_X/Z`, `inAisle`, stairs), rails, dark vertex-gradient shell (no black void), suite
  ring, tunnel portals, roof trusses + catwalks; `scorerTable` (z -26.2, in the courtside gap), `photographers`.
  Crowd: per-fan size + house-light dimming (`cpos[i][8..9]`), counts Low 0 / Medium 1300 / High 2600 / Ultra 3600.
- LED takeover `ledFx` (score: team colour strobe + "3 POINTS!/SLAM!/AND ONE!"), jumbotron KISS CAM / DANCE CAM during
  timeouts (`drawFanCam`, cartoon fans), Ultra live feed (`liveFeed`: 512x288 HalfFloat RT every 2nd frame, shadow maps
  reused, mirror hidden; compact score bar under it). Intro (S "intro"): crane flyover + pyro (`makePyro`, instanced
  additive quads) + cutscene DOF; pyro again at the tip and the final buzzer.
- Street weather (`V.WX`, `applyWx`, gfx3d `SKY`): day / sunset / night / rain / snow (auto = local time + a rainy /
  snowy day by date): sky dome + stars, sun/moon colour + elevation, exposure, lamp SpotLights, `makePrecip` (rain
  streaks / snow, CPU instanced), wet asphalt (puddle roughness + alpha map: the Reflector shows through on High+),
  snow cover. Light shafts are hidden on street courts (fxLevel runs there on weather changes).
- Players (rig3d): per-player body material clone (same program; three uploads material uniforms only on a material
  switch) for `mesh.userData.sweat` (fatigue + game depth -> shinier skin, darker damp jersey); skin wrap/scatter in
  RE_Direct; class mask in the data texture's B channel (`BCLS`); hair roughness .62 (sheen). WebGL only.
- Post: GradeShader gains split toning (`warm`), film grain (`grain`, luma-weighted) + `setLook`; bloom by tier;
  N8AO via `N8AOPass` with `autoRenderBeauty: false` and our scene buffer as its beauty target (both composer buffers
  get a resolved DepthTexture while AO is on; never let its setSize touch our buffer). WebGPU: look only, no AO/grain.
- HSR fixes: dynamic res judges every 4 frames and steps x.7 when frames are > 2x the target (Auto now drops on a
  crawling GPU); temporal resolve: motion /16 px, tighter clip (.55) and faster history falloff under motion.
- Unity (cheap mirrors): Arena BackLight, PostFx SplitToning + FilmGrain.
- tests/browser_gfx.mjs (presets, kiss cam / LED, weather), scratchpad shots via readPixels (pg.screenshot waits for
  compositor frames = more full renders on SwiftShader).

## Known gaps / ideas
replays/cameras in 2D, more teams, graphics v6 on WebGPU lacks AO / grain / skin patches / live jumbotron, custom 3-point distance (court lines are drawn at 23.75 ft), badge windows online,
fouled-out flags / personal fouls in the online box score, commentary is text templates + browser speech, Classic has no new features.

# Hoops 2K27 — project guide (read this first)

Browser basketball game: 5v5 and 1v1, full court, 3D (three.js + Rapier) and 2D, plus a Classic side-view 1v1.
Everything ships as ONE self-contained HTML file (`dist/hoops2k27-hub.html`, ~2.6 MB: three.js + Rapier inlined, no CDN).
Unofficial fan project; rosters/ratings are approximations (7 teams, 35 players, 2026-27 era).

## Layout
- `src/core/` — the shared, DOM-free simulation (runs in the browser, in Node tests and on a server):
  `sim.ts` (state, rules, AI, shooting, ball, controllers, replays), `pose.ts` (Pro Play joint angles + hand FK),
  `physics.ts` (Rapier world), `data.ts` (rosters, OVR, signature tweaks, shot clips).
- `src/client/` — browser shell: `main.ts` (hub), `game.ts` (menus, loop, FX, draw), `input.ts`, `hud.ts`,
  `render3d.ts` (three.js), `canvas.ts` (2D court + software-3D fallback), `view.ts` (camera/quality/projection), `audio.ts`, `net/` (online).
- `src/modes/classic/` — the older side-view engine, kept as legacy (inlined at build time).
- `index.html` + `vite.config.ts` — Vite builds ONE self-contained file (`vite-plugin-singlefile`; three.js + Rapier wasm inlined, no CDN).
- `scripts/postbuild.mjs` — writes `dist/hoops2k27-hub.html` and standalone `dist/modes/*.html` (same file with a preset mode).
- `tests/` — `tsx` logic tests against the core + a Playwright browser smoke test (see tests/README.md). `docs/` — screenshots.

## Mode flags (no more copied modes)
`cfg.NP` (5 or 1 players per team), `cfg.physics` ('rapier' 3D / 'legacy' 2D), `cfg.hand` (release from the rig's hand),
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
- Physics: `bstep` (legacy ball) vs `physics.ts rapInit/rapStep` (Rapier ball, rim = 24 capsules, board, floor, walls) + `rapSyncPlayers` (kinematic torso capsules, `cfg.playerBodies`).
- Net: `NETS/netSim` (verlet mesh; ball pushes points), drawn by both renderers.
- Animation: `pose3(p)` writes joint angles to `p.q` every sim tick (smoothed when Pro Play is on); clips `CL/clip/pickClip`. Rig + `apply` in `render3d.ts glInit`.
- Rules: `foul/startFT/ftLay/ftTick/ftIn/tech`, shot clock, quarters (4 x `QTRLEN` s), inbounds (`inb`), bonus after 5 team fouls, `endGame` (FX) + box score (`p.stt`).
- AI: `ai(p)`, `offBall` (pindowns/ball screens/switches; Curry `SIG.Curry.off`), `cut`, `loose` (rebounding), defense inside `ai` (no full-court press, no steals).
- Passing: `pass(p,r,type)` chest/bounce/lob + in-flight steering; `pick` chooses target from stick direction.
- Dribble/post: `i.mv` 1/2/3 (hesitation/spin/BTB), flick-to-cross, post (`i.post`, hook/drop-step/turnaround).
- 3D rendering: `render3d.ts glInit` (court texture, crowd InstancedMesh, jumbotron, hoops, net, rig; shared material cache); `V.GL.render` (cameras `V.CAMM` 0-3, quality `V.QL`, auto-downgrade). Canvas fallback (`canvas.ts scene3c/segs3c`) if WebGL fails.
- HUD: 2D canvas `#h` over the WebGL canvas `#c` (must stay transparent!). `view.ts pr(x,y,z)` projects with the active camera/renderer.
- Replays: allocation-free `REC` ring buffer in the core, `startReplay/rplStep/skipReplay`. Input (`input.ts`): keyboard, touch buttons `#tc`, gamepad `gpPoll` (wrapped: blocked in iframes by permissions policy).
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
- Reconnect: seats keep their `tok`; a returning token re-attaches (AI plays the seat meanwhile). Host leaving ends the game.
- A hidden host tab keeps simulating via a timer (rAF stops when hidden). `npm run server` serves dist + relay;
  "Create on dedicated server" spawns `server/headless-host.ts` for that room code.

## Lessons learned (do not repeat)
- A solid background on `#h` hid the whole 3D view (black screen). `#h` must be transparent.
- `getGamepads()` throws in sandboxed iframes -> it killed the game via `window.onerror`. Keep it in try/catch; the error handler ignores gamepad/permission errors.
- External CDN scripts were blocked on some hosts -> everything is inlined.
- Quarter clock ends the game: after 4 quarters `S==='over'` and `upd` does nothing. Test harnesses must call `start()` per batch.
- `@ts-nocheck` hid a missing import (`CP` in render3d) that blanked the 3D view: keep the browser smoke test in the loop.
- In 1v1, "switch player" has no other teammate: `nearest()` must never return -1.
- Aim must account for drag/Magnus or perfect shots fall short (measured: 3% -> 95% after fix).
- Keep steals off (user request). Keep green at top of meter. Keep Curry's off-ball tendency and low-load one-motion form.

## Known gaps / ideas
skeletal bone rig + blending + foot IK (feet slide slightly), Rapier bodies for players/dribble,
bloom/SSAO/motion blur/floor reflections, smoother player models, replays/cameras in 2D, heaves >45 ft only ~73% on green, Classic has no new features.

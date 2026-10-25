Run from the package root. Logic tests import the shared core directly (`src/core`), no DOM stubs needed.
- `npm test` — typecheck + all logic tests below.
- fk.ts — analytic hand FK matches the three.js rig (release-point parity); every rig (both LODs) carries arms skinned to the arm bones with an athletic girth.
- fuzz.ts — random inputs over every flag combo (NP 5/1 x Rapier/legacy x My Player x local 2P x player bodies): no errors/NaN, My Player never drifts.
- greens.ts — 400 perfectly timed shots, Rapier and legacy: 100% made. curry_greens.ts — Curry's greens by range (heaves, moving) through the full upd() pipeline: every green made. crowded_greens.ts / lefty.ts — every green made too.
- green_window.ts — contest -> window table (open 100%, .3 -> 70%, .75+ -> 25%), the meter's window shrinks live as a defender closes in, the meter's window == the one launch judged, and every non-blocked green goes in open / hand up / leaping at it.
- passes.ts — pass accuracy by type. dribble_moves.ts — dribble move displacement and ball security.
- browser_arms.mjs — arms are drawn on Low / Medium / High: pixels that change when both arm chains are collapsed (after `npm run build`). Unity twin: `scripts/unity/cs.sh unity/CoreTests/RigMeshCheck.cs` (arms weighted to the arm bones, inside the renderer bounds, triangle budget, look parity with look.ts).
- browser_webgpu.mjs — WebGPU renderer smoke test (SwiftShader WebGPU adapter, ?webgpu): backend must be WebGPU, game plays, no errors.
- net_swish.ts — drops balls through the net at 3 speeds: must score and leave the net slower.
- invariants.ts — plays full games in 5 configurations (5v5/1v1, My Player, 2P) and checks score = sum of points, the game ends, no long freezes, the ball stays in the world, stat sanity, and that the chosen My Player 1v1 opponent is used.
- browser.mjs [modes...] — `npm run build` first; opens the hub in Chromium, starts each mode, reports renderer (webgl/2d) + Rapier + errors, writes docs/shot-<mode>.png.
Notes: headless Chromium has no GPU (2-5 fps), so drive the sim with `H2K.G.upd(1/60)` in `page.evaluate`, not by waiting.
Harness trick: `G.start(team)` then `G.setup(0); G.setInb(0)` then feed edge inputs through `G.cfg.input` (`sd`=press, `su`=release).
- net.ts [lag= jitter= drop= seconds=] — relay + dedicated headless host (separate processes) + a guest over an impaired link:
  delta snapshots, ping, prediction, guest input reaches the host, presence stays < 4 KiB.
- browser_online.mjs [mode] — two Chromium pages through the relay: create, join by code, sides, ready-up, play.
- browser_room.mjs — the published-page path: two pages with a stand-in claude.ai `room` capability; host clicks
  "Host 5v5" on the home screen, the guest types the code into the home-screen box, sides + ready-up, play.
- browser_menu.mjs — matchup screen (opponent arrows, difficulty, settings drawer), tip off vs the chosen opponent, final screen (record, player of the game), rematch, Quick Play.
- rules.ts — full CPU games with every rule on (violations, subs, timeouts, foul-outs, clutch time, badges) and off:
  games finish, no NaN, subs happen in 5v5 only, nothing fires when its rule is switched off.
- browser_modes.mjs — the mode strip on the matchup screen: 3-Point Contest (25 balls), Practice (ball comes back),
  Tutorial (first step), Dunk Contest (3 judged dunks), HORSE (to five letters), Clutch Challenges (list + a scenario to
  its result screen), Season (a game is recorded), halftime show; settings drawer has the Rules / Presentation /
  Accessibility / Controls sections. Modes drive the sim through `H2K.openMode(kind)` + `H2K.MODE`.
- modes_sim.ts — headless: 3v3 / 2v2 games, Street 21 (1v1 + 3v3, half court), King of the Court, All-Star, Daily
  Challenge all reach a result, no NaN, street play stays in the right half, stopMode restores the team size.
- browser_perf.mjs — frame-rate guard: High forced on SwiftShader (seconds per frame) with the real rAF loop; the guard
  must walk the effects ladder and then the graphics level down (High -> Low). Slow (~6 min).
- browser_hsr.mjs [webgpu] — H2K Super Resolution: every mode/upscaler switches without errors, internal res follows the
  mode while the output canvas stays full size and #h transparent, no black frames; prints relative frame cost, pixels,
  draw calls, SSIM vs native, ghosting on an orbiting camera and net-cord flicker (history vs none); Auto lowers the
  scale on SwiftShader. Screenshots in docs/hsr/. Slow (~15 min on SwiftShader).
- browser_link.mjs — a highlight becomes a #reel= share link; opening it plays the clip in the same mode.
- browser_touch.mjs — touch controls: left-half thumb = analog stick (player runs that way, edge = sprint), right-half
  hold = shot charge, mice never drop the stick, lifting clears it.
- browser_room_faults.mjs — online reliability on the published-page path with a FAULTY room stand-in: 35% of presence
  updates fail, mid-game the guest's room dies for 8.5 s (only a rejoin recovers). Lobby forms, the host hands the
  silent seat to the AI, the guest rejoins, gets snapshots again and his seat back. The host runs as a background tab.
- ws_reconnect.ts — WebSocket transport vs the real relay: dropped socket reconnects and re-asserts its state, a
  silent (half-open) socket is caught by the heartbeat, garbled frames are ignored.
- browser_tour.mjs — relay: a three-player 1v1 tournament (bye + final, champion) and a 3v3 online game.
- faces.ts — facial expressions (pose.ts `face()`): yell / grin / grimace / frustration drive the right channels,
  every player blinks, and a whole game keeps every face value finite and in range.
- lefty.ts — a left-handed shooter (SIG `lh`, Brunson): the shot is mirrored, the release comes from the LEFT hand, and
  green releases still go in through the full Rapier pipeline.
- blend.ts — inertialized blending A/B (cfg.INZ 1 vs 0) on the same seeded 5v5 stretch: fewer pops (jerk p99.9 and the
  worst single one) while following the pose targets about as closely.
- street_stalls.ts (not in `npm test`, slow) — seeded Street 3v3 games must keep scoring (no 90 s without a basket);
  `N=40 npx tsx tests/street_stalls.ts`.
- rim_wedge.ts — a ball resting on the iron or wedged between the back iron and the glass comes free (both hoops).
- footslide.ts — procedural stepping A/B (cfg.PLANT 0/1) on a seeded 5v5 stretch: how fast feet on the floor skate
  (must drop >= 80%), and the leg-joint jerk budget (p99.9, teleports excluded).
- overlap.ts — live-play body overlap (arm / shoulder / chest spheres inside another player) with pose avoidance on vs
  off: elbows in chests drop >= 40%, shoulder-to-shoulder and shoulder-in-chest stay under their budgets (pooled
  over two seeded stretches: a single run is chaotic).
- adapt.ts — adaptive CPU: a cold / smothered shooter's tendencies move off the three, a hot one's up, humans are never
  adapted; gamePlan picks attack-the-paint / let-it-fly, tight D vs shooters, a 2-3 zone vs a rim-only team, the best
  defender onto a hot scorer; no trend from one miss; human teams keep their calls; a few adjustments per full game.
- contact.ts — contact QA on a seeded 5v5 stretch: the dribble hand meets the ball at the top of the bounce (p50 < 6,
  p90 < 22 px), a ball held in both hands sits between the palms (p90 < 6 px, one tick behind), toes never sink more
  than 4 px into the floor (lying after a dive included).
- teamplay.ts — team play pack (v5.4): named sets run and complete (horns / Spain back screens / staggers / zipper /
  post entries), Rookie coaches know none, play calls 5-7, ATO for the star, coverages by IQ (hedge / ICE / blitz / drop),
  box-and-one chaser, rotations (foul trouble, closers, garbage time), bonus rules (last 2 minutes, OT) and OT timeouts.
- help.ts — help defense: a beaten man draws a helper into the lane, a second defender rotates onto the helper's
  man, the kick-out is caught and closed out; a CPU game has help, rotations and kick-outs (STAT.help/rot/kick);
  spot inbounds (baseline / sideline / backcourt) come from the right line and are caught.
- limits.ts — joint-limit audit on a seeded 5v5 stretch: knees/elbows bending backwards, grounded ankles past ~0.7 rad
  of dorsiflexion, the neck out of range; must stay under 0.2% of player-ticks.
- stats.ts (not in npm test) — realism report vs NBA averages over N full CPU games (`N=4 QL=180 SEED=1 npx tsx
  tests/stats.ts`): assist rate, FT rate, FG/3P%, shot mix and contest by range, shot clock at FGA, ORB%, ORtg.
- propl.ts — Pro Play pack (cfg.PP): stick-picked move variants, move buffer + cancel window, sprint burst, on-ball
  stance (slides, auto hand up), contest timing, drive gather + delayed release, floater vs a rim protector, retreat
  dribble / rebound-assist regressions, and CPU games where the new moves happen and deflections never change possession.
- propl2.ts — Pro Play v2 (cfg.PP = 2): defender reads on dribble moves (wrong-footed vs already there, spin off contact,
  a read costs the handler), hesi pull-ups in rhythm, jumper balance in the green window (off balance / fading / on the
  move / created space), stick-picked fadeaway + leaner, catch-and-shoot buffer, side-steps, post battles by strength +
  human body-up, drive cut-offs vs bump-offs, block timing, charges read from set feet (never vs a defender stepping in),
  My Player call for the ball (fed / DENIED), called ball screen, flick cut + backdoor; CPU games: reads, rare ankle
  breakers, no steals, no NaN.
- sanity.ts (not in `npm test`, ~10 min) — seeded CPU games + a passive human: no dead-ball stalls, frozen handlers,
  auto-actions by an idle human, needless heaves, backcourt dawdling or bodies passing through each other.
- chants.ts — crowd chants: scripted situations start the right chant (AIR BALL on a road airball / aww at home,
  roar + M-V-P on fire, boos for road FTs and flagrant / goaltend / tech on the home team, clutch home FT hush, OVERTIME,
  DE-FENSE on the sim cue / organ riff, CHARGE! answer, LET'S GO / ROCK YOU / WE WANT fillers, visitors' LET'S GO on a road
  run, nothing in replays / with chants off / under the commentary voice); a 6-minute random game (no overlaps, cooldowns,
  loud building chants more); every chant renders (finite, peak .9, length); the sim's "air" FX (iron / glass / in-and-out).
  `CS=/tmp/x/chants.txt` also writes the script for `scripts/unity/cs.sh unity/CoreTests/ChantCheck.cs /tmp/x/chants.txt`
  (C# director log identical, C# render RMS equal). browser.mjs also checks the chant buffers render and play.

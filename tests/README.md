Run from the package root. Logic tests import the shared core directly (`src/core`), no DOM stubs needed.
- `npm test` — typecheck + all logic tests below.
- fk.ts — analytic hand FK matches the three.js rig (release-point parity).
- fuzz.ts — random inputs over every flag combo (NP 5/1 x Rapier/legacy x My Player x local 2P x player bodies): no errors/NaN, My Player never drifts.
- greens.ts — 400 perfectly timed shots (expect ~95%+ made). curry_greens.ts — Curry's greens by range through the full upd() pipeline.
- passes.ts — pass accuracy by type. dribble_moves.ts — dribble move displacement and ball security.
- browser.mjs [modes...] — `npm run build` first; opens the hub in Chromium, starts each mode, reports renderer (webgl/2d) + Rapier + errors, writes docs/shot-<mode>.png.
Notes: headless Chromium has no GPU (2-5 fps), so drive the sim with `H2K.G.upd(1/60)` in `page.evaluate`, not by waiting.
Harness trick: `G.start(team)` then `G.setup(0); G.setInb(0)` then feed edge inputs through `G.cfg.input` (`sd`=press, `su`=release).
- net.ts [lag= jitter= drop= seconds=] — relay + dedicated headless host (separate processes) + a guest over an impaired link:
  delta snapshots, ping, prediction, guest input reaches the host, presence stays < 4 KiB.
- browser_online.mjs [mode] — two Chromium pages through the relay: create, join by code, sides, ready-up, play.
- browser_room.mjs — the published-page path: two pages with a stand-in claude.ai `room` capability; host clicks
  "Host 5v5" on the home screen, the guest types the code into the home-screen box, sides + ready-up, play.
- browser_menu.mjs — matchup screen (opponent arrows, difficulty, settings drawer), tip off vs the chosen opponent, final screen (record, player of the game), rematch, Quick Play.

Run from the package root after `python3 build.py`.
- fuzz3d.js / fuzz2d.js <mode.html> — random-input sim, checks for errors/NaN (fuzz3d also loads Rapier).
- greens.js — 400 perfectly timed shots, prints made/miss (expect ~95% made).
- curry_greens.js — Curry's greens by range. passes.js — pass accuracy by type. dribble_moves.js — dribble move displacement.
- browser_smoke.py <mode> <out.png> — opens the hub in Chromium, starts a game, presses keys, reports `webgl+rapier` and console errors.
- browser_cameras_replay.py, browser_menu.py — camera modes, forced replay, menu screenshots.
Notes: headless Chromium has no GPU (2-5 fps), so test game logic by calling `upd(1/60)` in `page.evaluate`, not by waiting in real time.
Harness trick: `start(team)` then `setup(0); inb=0;` then set `ev.sd=1`/`ev.su=1` for hold-and-release shots.

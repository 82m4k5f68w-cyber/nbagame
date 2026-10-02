# Prompt for Claude Code (paste this)

You are working on Hoops 2K27 (read CLAUDE.md first). Do the work in phases, commit after each, run the tests after each, and never break the existing behavior or the "one inlined HTML" build.

Phase 0 — Refactor: turn src/modes/* into one shared TypeScript core (Vite) with flags for players-per-team (5/1) and renderer (three.js / canvas), keeping identical gameplay. Keep `classic` as legacy. Keep the build producing a single inlined HTML (no CDN). Make the tests run against the new output.

Phase 1 — Online multiplayer: 1v1 first, then 5v5 (1-2 humans per side + AI). Use an authoritative Node/WebSocket server (or PartyKit/Colyseus) running the same fixed 60 Hz sim; clients send inputs only. Lobby with room codes, ready-up, reconnect. Keep local 2-player.

Phase 2 — Anti-lag: client-side prediction for the local player with server reconciliation, snapshot interpolation (~100 ms buffer) for everyone else, input buffering, delta-compressed snapshots at 20-30 Hz, lag-compensated contests/blocks and shot release (judge green on the shooter's timeline), clock sync and ping display, packet-loss handling. Also client perf: no per-frame allocation, instanced/merged meshes, adaptive quality, pause when hidden.

Phase 3 — Finish graphics/animation: bloom, SSAO, tone mapping, floor reflections, motion blur on fast moves; smoother player models; a bone-based rig with animation blending, foot planting + leg IK; Rapier bodies for players; dribble and pass physics.

Phase 4 — Content: more teams, season/playoffs, replays and cameras in 2D, polish the menu, mobile controls.

Rules: keep steals OFF, keep the green window at the TOP of the meter, keep Curry's tendencies/form, keep greens going in (see tests/greens.js, expect ~95%).

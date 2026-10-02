# Hoops 2K27
1. `npm install && npm run build` -> `dist/hoops2k27-hub.html` (open it in a browser; everything is inside the file).
2. Dev: `npm run dev` (Vite, hot reload). Shared engine: `src/core/`, browser shell: `src/client/`.
3. Online: the published page uses claude.ai live rooms (Play Online → Create / Join with a code). Self-hosted: `npm run server` (serves dist + WebSocket relay on :8787; can spawn dedicated headless hosts).
4. Tests: `npm test` (typecheck + logic tests via tsx, Node 18+), `npm run test:browser` (Playwright + Chromium), `npm run test:net` (relay + dedicated host + guest over a lossy link), `npm run test:online` (two browsers). See `tests/README.md`.
Read `CLAUDE.md` for the architecture and `PROMPT.md` for the roadmap.

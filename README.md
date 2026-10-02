# Hoops 2K27
1. `npm install && npm run build` -> `dist/hoops2k27-hub.html` (open it in a browser; everything is inside the file).
2. Dev: `npm run dev` (Vite, hot reload). Shared engine: `src/core/`, browser shell: `src/client/`.
3. Tests: `npm test` (typecheck + logic tests via tsx, Node 18+), `npm run test:browser` (Playwright + Chromium). See `tests/README.md`.
Read `CLAUDE.md` for the architecture and `PROMPT.md` for the roadmap.

# Hoops 2K27
1. `python3 build.py` -> `dist/hoops2k27-hub.html` (open it in a browser; everything is inside the file).
2. Dev: edit `src/modes/<mode>/game.js`, rebuild, reload. Serve with `npx serve dist` if your browser blocks `file://` features.
3. Tests: see `tests/README.md`. Needs Node 18+ for logic tests, Python + `pip install playwright && playwright install chromium` for browser tests.
Read `CLAUDE.md` for the architecture and `PROMPT.md` for the next tasks.

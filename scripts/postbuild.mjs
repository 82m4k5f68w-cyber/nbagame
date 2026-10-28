// After `vite build`: the hub + standalone per-mode pages (same single file, preset mode) + the legacy Classic page.
import fs from "node:fs";
const D = "dist";
const hub = fs.readFileSync(`${D}/index.html`, "utf8");
fs.writeFileSync(`${D}/hoops2k27-hub.html`, hub);
fs.mkdirSync(`${D}/modes`, { recursive: true });
for (const m of ["5v5-3d", "5v5-2d", "1v1-3d", "1v1-2d"])
  fs.writeFileSync(`${D}/modes/${m}.html`, hub.replace("<head>", `<head><script>window.__H2K_MODE=${JSON.stringify(m)}</script>`));
const ch = fs.readFileSync("src/modes/classic/index.html", "utf8"),
  cj = fs.readFileSync("src/modes/classic/game.js", "utf8");
if (/<\/script/i.test(cj)) throw new Error("classic game.js contains </script");
fs.writeFileSync(`${D}/modes/classic.html`, ch.replace('<script src="game.js"></script>', () => "<script>\n" + cj + "</script>"));
console.log("hub", (hub.length / 1e6).toFixed(2), "MB; modes written");
// Artifact copy (claude.ai wraps the document itself): title first, no doctype/html/head/body tags.
{
  let a = hub.replace(/<!DOCTYPE html>/i, "").replace(/<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
  a = a.replace(/<head>/i, "").replace(/<\/head>/i, "").replace(/<body>/i, "").replace(/<\/body>/i, "");
  a = a.replace(/<meta charset="utf-8">/i, "").replace(/<meta name="viewport"[^>]*>/i, "");
  a = a.replace(":root{--bg:#06070e;", ":root{color-scheme:dark;--bg:#06070e;");
  a = a.replace("</title>", "</title><script>window.__H2K_ARTIFACT=1</script>"); // pwa.ts: never a service worker here
  fs.writeFileSync(`${D}/artifact.html`, a.trimStart());
}

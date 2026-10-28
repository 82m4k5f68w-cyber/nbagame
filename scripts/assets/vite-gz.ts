// Vite plugin: `import b64 from "virtual:gz:<path under node_modules or repo, or tools/<path under $H2K_TOOLS>>"` -> base64 of the gzip'd file
// (decompress at runtime with DecompressionStream("gzip")). Used for big wasm blobs that compress well
// (onnxruntime-web 14.8 MB -> ~3.4 MB gz) and only for LAZY pages / chunks - never import it from the main game.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Plugin } from "vite";
export function gzInline(root: string): Plugin {
  const P = "virtual:gz:";
  return {
    name: "h2k-gz-inline",
    resolveId: (id) => (id.startsWith(P) ? "\0" + id : null),
    load(id) {
      if (!id.startsWith("\0" + P)) return null;
      const rel = id.slice(P.length + 1),
        tools = process.env.H2K_TOOLS || "/home/user/tools",
        f = (rel.startsWith("tools/") ? [path.join(tools, rel.slice(6))] : [path.join(root, "node_modules", rel), path.join(root, rel)]).find((x) => fs.existsSync(x));
      if (!f) throw new Error("gzInline: not found " + rel);
      const gz = zlib.gzipSync(fs.readFileSync(f), { level: 9 });
      return `export default ${JSON.stringify(gz.toString("base64"))};`;
    },
  };
}

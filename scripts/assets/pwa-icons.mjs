// Procedural PWA icons (no image files from anywhere): a basketball on the brand gradient, drawn per pixel and encoded
// as PNG with zlib. Writes public/icons/*.png + public/manifest.webmanifest (Vite copies public/ into dist/).
//   node scripts/assets/pwa-icons.mjs
import fs from "node:fs";
import zlib from "node:zlib";
const crcT = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b) => {
  let c = -1;
  for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (t, d) => {
  const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t, "latin1"), d]);
  l.writeUInt32BE(d.length);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};
function png(S, maskable) {
  const raw = Buffer.alloc(S * (S * 4 + 1)),
    cx = S / 2, R = S * (maskable ? 0.3 : 0.4), rr = S * 0.22;
  const mix = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const o = y * (S * 4 + 1) + 1 + x * 4;
      // rounded-square background (full bleed for maskable), gradient #12142a -> #2a1440
      const qx = Math.max(Math.abs(x + 0.5 - cx) - (S / 2 - rr), 0), qy = Math.max(Math.abs(y + 0.5 - cx) - (S / 2 - rr), 0);
      const inBg = maskable || Math.hypot(qx, qy) <= rr;
      const g = (x + y) / (2 * S);
      let r = mix(0x12, 0x2a, g), gg = mix(0x14, 0x14, g), b = mix(0x2a, 0x40, g), a = inBg ? 255 : 0;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cx, d = Math.hypot(dx, dy);
      if (d < R) {
        // ball: orange with radial shade + seams (vertical, horizontal, two curves)
        const sh = 1 - 0.35 * Math.hypot(dx + R * 0.35, dy + R * 0.35) / (R * 1.6);
        (r = 0xf2 * sh), (gg = 0x6a * sh), (b = 0x1c * sh), (a = 255);
        const w = S * 0.012 + 0.6, cr = R * 1.25;
        const seam = Math.abs(dx) < w || Math.abs(dy) < w || Math.abs(Math.hypot(dx - cr, dy) - cr * 0.97) < w || Math.abs(Math.hypot(dx + cr, dy) - cr * 0.97) < w;
        if (seam) (r = 0x1a), (gg = 0x0c), (b = 0x06);
        if (d > R - w * 1.2) (r = 0x1a), (gg = 0x0c), (b = 0x06);
      }
      raw[o] = r; raw[o + 1] = gg; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const h = Buffer.alloc(13);
  h.writeUInt32BE(S, 0); h.writeUInt32BE(S, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", h), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const out = "public/icons";
fs.mkdirSync(out, { recursive: true });
for (const [n, s, m] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["maskable-512.png", 512, 1], ["apple-touch-icon.png", 180, 1]]) fs.writeFileSync(`${out}/${n}`, png(s, m));
fs.writeFileSync("public/manifest.webmanifest", JSON.stringify({
  name: "Hoops 2K27", short_name: "Hoops 2K27", description: "Browser basketball: 5v5, 1v1, street, LIFE. Plays offline once installed.",
  start_url: "./hoops2k27-hub.html", scope: "./", display: "fullscreen", orientation: "landscape", background_color: "#06070e", theme_color: "#12142a",
  icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
}, null, 1));
console.log("pwa icons:", fs.readdirSync(out).map((f) => `${f} ${fs.statSync(`${out}/${f}`).size}B`).join(", "));

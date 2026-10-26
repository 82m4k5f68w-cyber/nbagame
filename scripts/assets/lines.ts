// Spoken text pieces of broadcast.ts (LINES / RISE / TAIL): plain strings and the literal parts of template strings,
// split around their ${...} slots. Shared by scripts/assets/voice.ts (what to render) and tests/assets.ts (coverage).
/** All string pieces of the JS/TS source region: plain strings and the literal parts of template strings. */
export function pieces(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const str = (q: string) => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") (s += src[i + 1]), (i += 2);
      else s += src[i++];
    }
    i++;
    return s;
  };
  const tpl = () => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") (s += src[i + 1]), (i += 2);
      else if (src[i] === "$" && src[i + 1] === "{") {
        out.push(s), (s = "");
        i += 2;
        let d = 1;
        while (i < src.length && d > 0) {
          const c = src[i];
          if (c === "`") tpl();
          else if (c === '"' || c === "'") out.push(str(c));
          else (c === "{" ? d++ : c === "}" ? d-- : 0), i++;
        }
      } else s += src[i++];
    }
    out.push(s);
    i++;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") while (i < src.length && src[i] !== "\n") i++;
    else if (c === "`") tpl();
    else if (c === '"') out.push(str(c));
    else i++;
  }
  return out;
}
/** All spoken pieces of the commentary tables in broadcast.ts source text. */
export function commentaryPieces(bc: string): string[] {
  const region = (a: string, b: string) => {
    const s = bc.indexOf(a),
      e = bc.indexOf(b, s);
    if (s < 0 || e < 0) throw new Error("broadcast.ts: cannot find " + a);
    return bc.slice(s, e);
  };
  // keys of LINES/RISE/TAIL objects themselves are identifiers, not strings, so only spoken text is collected
  return [...pieces(region("const LINES", "const CAP")), ...pieces(region("const RISE", "const BIG"))];
}

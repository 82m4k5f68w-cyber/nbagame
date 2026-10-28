// Voice command grammar (pure: shared by client/voicecmd.ts, the voice lab and tests/voicecmd.ts).
export type Cmd = { cmd: "timeout" | "sub" | "call" | "switch" | "pause"; arg?: "horns" | "spain" | "post" };
/** Text -> command (pure; tests/assets.ts). Tolerates Whisper's punctuation, casing and common mishearings. */
export function parseCommand(text: string): Cmd | null {
  const t = " " + text.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  if (/ (time ?out|time out|timeouts?) /.test(t)) return { cmd: "timeout" };
  if (/ horns? /.test(t)) return { cmd: "call", arg: "horns" };
  if (/ spa(i|y)ne? /.test(t)) return { cmd: "call", arg: "spain" };
  if (/ post ?up /.test(t) || / (call|run) (a |the )?post /.test(t)) return { cmd: "call", arg: "post" };
  if (/ (sub|subs|substitution|substitute|sub in|sub out|bench) /.test(t)) return { cmd: "sub" };
  if (/ (switch|swap|switch player|change player) /.test(t)) return { cmd: "switch" };
  if (/ (pause|stop|menu|hold on) /.test(t)) return { cmd: "pause" };
  return null;
}

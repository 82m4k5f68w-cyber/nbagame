// Save system (src/client/save.ts): codecs, checksums, migration of the old keys, rolling backups, corruption
// recovery, quota handling, export/import, cloud sync with a fake db (three-way: push / pull / conflict).
import * as SV from "../src/client/save";
import { newLife, serialize, deserialize } from "../src/life/state";

let fails = 0;
const ok = (c: any, m: string) => {
  if (!c) (fails++, console.log("FAIL", m));
};
const mem = () => SV._mem();

async function main() {
  // ---- codecs
  const samples = ["", "a", "abababababababababab", "héllo 🏀 wörld ".repeat(50), JSON.stringify({ a: [1, 2, 3], s: "x".repeat(5000) }), serialize(newLife({ seed: 7 }))];
  let rnd = 1;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff), rnd / 0x7fffffff);
  for (let i = 0; i < 30; i++) {
    let s = "";
    const n = Math.floor(r() * 3000);
    for (let k = 0; k < n; k++) s += String.fromCharCode(r() < 0.8 ? 32 + Math.floor(r() * 20) : Math.floor(r() * 0xffff));
    samples.push(s);
  }
  for (const s of samples) {
    const z = SV.lzc(s);
    ok(SV.lzd(z) === s, "lzw round trip len " + s.length);
    for (let i = 0; i < z.length; i++) {
      const c = z.charCodeAt(i);
      if (c < 32 || (c >= 0xd800 && c <= 0xdfff)) {
        ok(0, "lzw char range");
        break;
      }
    }
  }
  const big = serialize(newLife({ seed: 3 }));
  const ed = await SV.encode(big, 5),
    el = SV.encodeSync(big, 5);
  ok(ed.startsWith("H2K1|d|"), "deflate codec used when CompressionStream exists");
  ok(el.startsWith("H2K1|l|"), "sync codec");
  ok((await SV.decode(ed))!.json === big && (await SV.decode(el))!.json === big, "decode both");
  ok(ed.length < big.length * 0.4 && el.length < big.length * 0.6, `compression ratio d ${(ed.length / big.length).toFixed(2)} l ${(el.length / big.length).toFixed(2)}`);
  ok((await SV.decode(ed.slice(0, -10))) === null, "truncated deflate rejected");
  ok((await SV.decode(el.replace(/.$/, "x"))) === null || (await SV.decode(el.replace(/.$/, "x")))!.json === big, "tampered lzw rejected or harmless");
  const tamper = el.slice(0, 40) + String.fromCharCode(el.charCodeAt(40) ^ 5) + el.slice(41);
  ok((await SV.decode(tamper)) === null, "checksum catches a flipped char");

  // ---- migration of the old formats (lossless)
  const s0 = mem();
  const L0 = newLife({ seed: 11, slot: 0 });
  L0.p.n = "ACE";
  L0.money = 1234;
  L0.team.w = 3;
  const L2 = newLife({ seed: 12, slot: 2 });
  L2.p.n = "BOLT";
  s0.setItem("h2k_life_0", serialize(L0));
  s0.setItem("h2k_life_2", serialize(L2));
  s0.setItem("h2k_life", "2");
  s0.setItem("h2k_myp", JSON.stringify({ n: "MYGUY", lv: 4, c: 80, i: 70 }));
  s0.setItem("h2k_rec", JSON.stringify({ w: 5, l: 2, st: 1, best: 3 }));
  s0.setItem("h2k_set", JSON.stringify({ m: 2, THEME: "dark" }));
  s0.setItem("h2k_season_5", JSON.stringify({ wk: 3 }));
  s0.setItem("h2k_name", "Rez");
  s0.setItem("h2k_tok", "abc");
  SV._reset(s0);
  ok(SV.migrate() === 2, "two LIFE saves migrated");
  ok(s0.getItem("h2k_life_0") === null && s0.getItem("h2k_life_2") === null && s0.getItem("h2k_life") === null, "old keys removed after verify");
  ok(SV.lastId() === "life2", "last slot carried over");
  const m0 = SV.meta("life0")!;
  ok(m0 && m0.name === "ACE" && m0.money === 1234 && m0.rec === "3-0" && m0.stage === "hs", "slot card fields");
  const back = await SV.load("life0");
  ok(back && serialize(deserialize(JSON.stringify(back))!) === serialize(deserialize(serialize(L0))!), "migrated save is identical");
  ok(s0.getItem("h2k_myp") && SV.get("h2k_rec", { w: 0 }).w === 5, "live game keys untouched");
  const g = SV.meta("game")!;
  ok(g && g.name === "MYGUY" && g.rec === "5-2", "game record snapshotted: " + JSON.stringify(g));
  const gd = await SV.load("game");
  ok(gd.keys.h2k_season_5 && gd.keys.h2k_name === "Rez" && !gd.keys.h2k_tok, "game bundle keys (season, raw name; no device token)");
  ok(SV.migrate() === 0 && SV.list("life").length === 2, "migration idempotent");

  // ---- rolling backups + checksums
  const s1 = mem();
  SV._reset(s1);
  const L = newLife({ seed: 5, slot: 1 });
  for (let i = 0; i < 8; i++) {
    L.money = 100 * i;
    L.t += 60;
    await SV.put("life1", L, SV.lifeMeta(L), { milestone: true, t: 1000 + i });
  }
  const bks = SV.backups("life1");
  ok(bks.length === SV.MAX_BK, "backup ring capped at " + SV.MAX_BK + " (got " + bks.length + ")");
  ok(bks[0].t > bks[bks.length - 1].t && bks[0].m.money === 600, "backups newest first with card meta " + JSON.stringify(bks[0].m));
  ok(SV.meta("life1")!.money === 700, "main is the newest");
  // no milestone + within BK_GAP: no new backup
  L.money = 9999;
  await SV.put("life1", L, SV.lifeMeta(L), { t: 1010 });
  ok(SV.backups("life1")[0].m.money === 600, "no backup inside BK_GAP");
  // unchanged data is a no-op
  const sumA = SV.meta("life1")!.sum;
  await SV.put("life1", L, SV.lifeMeta(L));
  ok(SV.meta("life1")!.sum === sumA && SV.meta("life1")!.t === 1010, "unchanged save skipped");

  // ---- corruption -> automatic recovery from the newest good backup
  const evs: SV.Ev[] = [];
  const off = SV.onSave((e) => evs.push(e));
  SV.corrupt("life1");
  const rec = await SV.load("life1");
  ok(rec && rec.money === 600, "recovered newest backup (money " + (rec && rec.money) + ")");
  ok(evs.some((e) => e.k === "recovered" && e.id === "life1"), "recovered event (toast)");
  ok(SV.meta("life1")!.money === 600, "card updated after recovery");
  // damage the newest backups too: falls through to an older one
  SV.corrupt("life1");
  const b2 = SV.backups("life1");
  s1.setItem(SV._keys.bkK("life1", b2[0].k), "H2K1|l|zz|1|broken");
  const rec2 = await SV.load("life1");
  ok(rec2 && rec2.money < 600, "falls back past a broken backup (money " + (rec2 && rec2.money) + ")");
  // restore a specific backup: the current main becomes a backup (undoable)
  const before = SV.meta("life1")!.sum;
  const pick = SV.backups("life1").slice(-1)[0];
  ok(await SV.restore("life1", pick.k), "restore backup");
  ok(SV.meta("life1")!.sum === pick.sum && SV.backups("life1").some((b) => b.sum === before), "restore keeps the replaced copy as a backup");
  off();

  // ---- damaged game key -> restored synchronously from the game record
  const s2 = mem();
  s2.setItem("h2k_rec", JSON.stringify({ w: 9, l: 1, st: 0, best: 4 }));
  SV._reset(s2);
  SV.migrate();
  s2.setItem("h2k_rec", '{"w":9,"l');
  ok(SV.get("h2k_rec", { w: 0 }).w === 9, "damaged h2k_rec restored from the game record");
  ok(JSON.parse(s2.getItem("h2k_rec")!).w === 9, "and written back");
  // a damaged index is rebuilt from the records
  await SV.put("life0", newLife({ seed: 1 }), { name: "IDX", kind: "life" }, { sync: true });
  s2.setItem("h2k_sv", "{broken");
  SV._reset(s2);
  ok(SV.meta("life0") && SV.meta("life0")!.name === "IDX", "index rebuilt from records");

  // ---- quota: prune the oldest backups, then report
  let cap = 0;
  const s3 = mem(),
    raw = s3.setItem;
  const used = () => {
    let n = 0;
    for (let i = 0; i < s3.length!; i++) n += (s3.getItem(s3.key!(i)!) || "").length;
    return n;
  };
  (s3 as any).setItem = (k: string, v: string) => {
    const old = s3.getItem(k);
    if (cap && used() - (old ? old.length : 0) + v.length > cap) {
      const e: any = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    }
    raw(k, v);
  };
  SV._reset(s3);
  const Q = newLife({ seed: 2 });
  for (let i = 0; i < 6; i++) (Q.money = i), (Q.feed = Array.from({ length: 40 }, (_, k) => ({ id: k + i * 100, x: "post " + Math.random() })) as any), await SV.put("life0", Q, SV.lifeMeta(Q), { milestone: true });
  ok(SV.backups("life0").length === SV.MAX_BK, "quota store filled backups");
  cap = used() + 200; // almost full
  Q.money = 77;
  Q.feed = Array.from({ length: 40 }, (_, k) => ({ id: k, x: "new " + Math.random() })) as any;
  const qev: SV.Ev[] = [];
  const off2 = SV.onSave((e) => qev.push(e));
  const okq = await SV.put("life0", Q, SV.lifeMeta(Q), { milestone: true });
  ok(okq && SV.meta("life0")!.money === 77, "save fits after pruning old backups");
  ok(SV.backups("life0").length < SV.MAX_BK, "old backups pruned (" + SV.backups("life0").length + ")");
  cap = 10;
  Q.money = 78;
  const okq2 = await SV.put("life0", Q, SV.lifeMeta(Q));
  ok(!okq2 && qev.some((e) => e.k === "quota") && SV.meta("life0")!.money === 77, "full storage reported, index still points at the stored copy");
  off2();

  // ---- export / import
  const s4 = mem();
  s4.setItem("h2k_myp", JSON.stringify({ n: "EXPO", lv: 2 }));
  SV._reset(s4);
  SV.migrate();
  const E = newLife({ seed: 9, slot: 3 });
  E.p.n = "EXP";
  await SV.put("life3", E, SV.lifeMeta(E));
  SV.setThumb("life3", "data:image/webp;base64,AAAA");
  const all = await SV.exportAll();
  const one = await SV.exportOne("life3");
  const s5 = mem();
  SV._reset(s5);
  const ri = await SV.importText(all);
  ok(ri.ok === 2 && ri.bad === 0, "import all " + JSON.stringify(ri));
  ok((await SV.load("life3")).p.n === "EXP" && SV.thumb("life3") === "data:image/webp;base64,AAAA", "imported slot + thumbnail");
  ok(JSON.parse(s5.getItem("h2k_myp")!).n === "EXPO", "imported game keys applied");
  const r1 = await SV.importText(one!, { slot: 5 });
  ok(r1.ok === 1 && (await SV.load("life5")).slot === 5, "per-slot import into another slot");
  const r2 = await SV.importText(serialize(E));
  ok(r2.ok === 1 && r2.ids[0] === "life0", "old plain LIFE export goes to the first free slot");
  ok((await SV.importText("{nope")).bad === 1 && (await SV.importText(all.replace(/"H2K1\|/g, "\"H2K1|x"))).ok === 0, "bad files rejected");

  // ---- async writes: flush on unload, superseded saves
  const s6 = mem();
  SV._reset(s6);
  const F = newLife({ seed: 4 });
  F.money = 1;
  void SV.put("life0", F, SV.lifeMeta(F));
  F.money = 2;
  void SV.put("life0", F, SV.lifeMeta(F));
  SV.flush(); // page hides before compression finished
  ok(SV.meta("life0")!.money === 2 && s6.getItem(SV._keys.recK("life0"))!.startsWith("H2K1|l|"), "flush writes the newest pending save sync");
  await SV.settle();
  ok((await SV.load("life0")).money === 2, "nothing older lands after the flush");

  // ---- cloud: fake db with the same API surface
  const fdb = fakeDb();
  const devA = mem(),
    devB = mem();
  SV.CLOUD_DELAY.ms = 1;
  SV._reset(devA);
  await SV.cloudInit({ db: fdb, uid: "u_1" });
  const C = newLife({ seed: 21, slot: 0 });
  C.p.n = "CLOUD";
  C.feed = Array.from({ length: 12000 }, (_, k) => ({ id: k, x: "p" + Math.random() })) as any; // big: chunked
  await SV.put("life0", C, SV.lifeMeta(C));
  let r0 = await SV.cloudSync();
  ok(r0.pushed.includes("life0") && fdb.n() > 1, "pushed (chunked: " + fdb.n() + " docs)");
  // device B pulls it
  SV._reset(devB);
  await SV.cloudInit({ db: fdb, uid: "u_1" });
  r0 = await SV.cloudSync();
  ok(r0.pulled.includes("life0") && (await SV.load("life0")).p.n === "CLOUD", "device B pulled");
  // B plays on -> push; A (unchanged since sync) pulls without asking
  C.money = 555;
  await SV.put("life0", C, SV.lifeMeta(C));
  await SV.pushNow("life0");
  SV._reset(devA);
  await SV.cloudInit({ db: fdb, uid: "u_1" });
  r0 = await SV.cloudSync();
  ok(r0.pulled.includes("life0") && !r0.conflicts.length && (await SV.load("life0")).money === 555, "A pulled B's newer save, no conflict");
  // both change -> conflict, newest wins only when chosen
  C.money = 1;
  await SV.put("life0", C, SV.lifeMeta(C), { t: Date.now() + 5000 });
  SV._reset(devB);
  await SV.cloudInit({ db: fdb, uid: "u_1" });
  C.money = 2;
  await SV.put("life0", C, SV.lifeMeta(C));
  await SV.pushNow("life0");
  SV._reset(devA);
  await SV.cloudInit({ db: fdb, uid: "u_1" });
  r0 = await SV.cloudSync();
  ok(r0.conflicts.length === 1 && r0.conflicts[0].local.money === 1 && r0.conflicts[0].cloud.m.money === 2, "conflict detected");
  ok(r0.conflicts[0].local.t > r0.conflicts[0].cloud.t, "local is newer (UI preselects it)");
  ok(await SV.resolve("life0", "cloud"), "resolve -> cloud");
  ok((await SV.load("life0")).money === 2 && SV.backups("life0").some((b) => b.m.money === 1), "cloud copy loaded, local kept as a backup");
  // offline: no db
  SV._reset(mem());
  ok(!(await SV.cloudInit({ db: null })) && SV.CLOUD.state === "off" && (await SV.cloudSync()).pushed.length === 0, "offline: cloud off, sync no-op");

  if (fails) {
    console.log(fails + " failure(s)");
    process.exit(1);
  }
  console.log("SAVE OK");
  process.exit(0);
}

/** In-memory stand-in for the artifact db: doc/collection paths, get/set/delete, collection get. */
function fakeDb() {
  const docs = new Map<string, any>();
  const snap = (path: string) => {
    const v = docs.get(path);
    return { id: path.split("/").pop(), exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const doc = (path: string): any => {
    if (path.split("/").length % 2) throw new TypeError("doc path parity");
    return {
      id: path.split("/").pop(),
      path,
      get: async () => snap(path),
      set: async (d: any) => {
        const s = JSON.stringify(d);
        if (new TextEncoder().encode(s).length > 256 * 1024) throw { code: "invalid_argument", message: "too big" };
        docs.set(path, JSON.parse(s));
      },
      delete: async () => void docs.delete(path),
      collection: (c: string) => coll(path + "/" + c),
    };
  };
  const coll = (path: string): any => {
    if (path.split("/").length % 2 === 0) throw new TypeError("collection path parity");
    return {
      path,
      doc: (id: string) => doc(path + "/" + id),
      get: async () => {
        const ds = [...docs.keys()].filter((k) => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1).map(snap);
        return { docs: ds, size: ds.length, empty: !ds.length };
      },
    };
  };
  return { doc, collection: coll, n: () => docs.size };
}
main();

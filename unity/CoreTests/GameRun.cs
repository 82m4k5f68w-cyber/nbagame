// Plays N seeded CPU-vs-CPU 5v5 games in the C# core (legacy ball physics: no engine outside Unity) and prints a
// per-team box-score summary + invariant checks. Compare with scripts/unity/gamerun.ts (same games in the TS build).
//   scripts/unity/cs.sh unity/CoreTests/GameRun.cs [N] [QL] [legacy|ball] [up=0|1] [phys=.5] [ph2=1]
// (ball = Core/BallSim, the Unity engine; up = cfg.UP, phys = cfg.PHYS, ph2 = Sim.PH2). With ball it also checks for
// tunnelling: a loose ball inside the iron, under the floor or outside the arena walls.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using Hoops.Core;
using static Hoops.Core.Sim;

static class GameRun
{
    static void Main(string[] a)
    {
        int N = a.Length > 0 ? int.Parse(a[0]) : 4;
        double QL = a.Length > 1 ? double.Parse(a[1]) : 180;
        Rng.Seed(2024);
        cfg.NP = 5; cfg.physics = "legacy"; cfg.MYM = 0; cfg.DIFF = 2;
        BallSim bs = null;
        if (a.Length > 2 && a[2] == "ball") { cfg.physics = "rapier"; Phys.RAP = bs = new BallSim(); }
        string Arg(string k, string d) { foreach (var s in a) if (s.StartsWith(k + "=")) return s.Substring(k.Length + 1); return d; }
        cfg.UP = int.Parse(Arg("up", "0")); UPC.Clear();
        cfg.PHYS = double.Parse(Arg("phys", "0.5"), System.Globalization.CultureInfo.InvariantCulture);
        Sim.PH2 = Arg("ph2", "1") != "0";
        int tunnel = 0, ftTrips = 0, ftTicks = 0;
        bool ftPrev = false;
        double orb = 0, drb = 0;
        cfg.input = c => new Input();
        double pts = 0, fga = 0, fgm = 0, tpa = 0, tpm = 0, reb = 0, ast = 0, blk = 0;
        int bad = 0, teams = 0;
        long ticksAll = 0;
        var sw = Stopwatch.StartNew();
        for (int g = 0; g < N; g++)
        {
            setQtrLen(QL);
            setCtrls(new List<Ctrl>());
            start(g % 7, new StartOpts { j = (g + 3) % 7 });
            int ticks = 0;
            double lastT = T; int stuck = 0;
            while (S != "over" && ticks < 60 * QL * 6)
            {
                upd(1 / 60.0);
                if (ftq != null) { ftTicks++; if (!ftPrev) ftTrips++; }
                ftPrev = ftq != null;
                if (RPL != null) skipReplay();
                FX.Clear();
                ticks++;
                if (S == "half") setS("play");
                if (clock == lastT) { if (++stuck > 60 * 60 && S == "play") { Console.WriteLine($"game {g}: clock stuck at {clock} q{q} rs {rs} inb {inb} ball {B.mode}"); Diag(bs); bad++; break; } } else stuck = 0;
                lastT = clock;
                foreach (var p in P)
                    if (double.IsNaN(p.x) || double.IsNaN(p.y) || double.IsNaN(p.z)) { Console.WriteLine($"game {g} tick {ticks}: NaN player {p.n}"); bad++; goto next; }
                if (double.IsNaN(B.x) || double.IsNaN(B.y) || double.IsNaN(B.z) || double.IsNaN(B.vx + B.vy + B.vz)) { Console.WriteLine($"game {g} tick {ticks}: NaN ball"); bad++; goto next; }
                if (bs != null && B.owner == null)
                {
                    // tunnelling: inside the iron's tube, under the floor, past the arena walls
                    string tw = null;
                    for (int h = 0; h < 2; h++)
                    {
                        double dd = Math.Sqrt((B.x - HXs[h]) * (B.x - HXs[h]) + (B.y - HY) * (B.y - HY));
                        if (Math.Sqrt((dd - RR) * (dd - RR) + (B.z - 100) * (B.z - 100)) < BR + 0.55 - 0.1) tw = "inside the iron";
                    }
                    if (B.z < BR - 0.1) tw = "under the floor";
                    if (B.x < BR - 0.1 || B.x > CW - BR + 0.1 || B.y < BR - 0.1 || B.y > CH - BR + 0.1) tw = "outside the walls";
                    if (tw != null) { if (tunnel < 5) { Console.WriteLine($"game {g} tick {ticks}: ball {tw} at ({B.x:F2},{B.y:F2},{B.z:F2}) mode {B.mode}"); Diag(bs); } tunnel++; }
                }
            }
            next:
            ticksAll += ticks;
            Console.WriteLine($"game {g}: {cl[0]} {sc[0]} - {sc[1]} {cl[1]}  ({S}, {ticks} ticks)");
            for (int t = 0; t < 2; t++)
            {
                teams++;
                foreach (var p in ROST[t]) { orb += p.stt.orb; drb += p.stt.reb - p.stt.orb; pts += p.stt.pts; fga += p.stt.fga; fgm += p.stt.fgm; tpa += p.stt.tpa; tpm += p.stt.tpm; reb += p.stt.reb; ast += p.stt.ast; blk += p.stt.blk; }
            }
        }
        double k = 48 * 60 / (4 * QL) / teams; // per team per 48 min
        Console.WriteLine($"per team/48: pts {pts * k:F1} fga {fga * k:F1} fg% {100 * fgm / Math.Max(1, fga):F1} 3pa {tpa * k:F1} 3p% {100 * tpm / Math.Max(1, tpa):F1} reb {reb * k:F1} ast {ast * k:F1} blk {blk * k:F1}");
        Console.WriteLine($"free throws per game: {ftTrips / (double)N:F1} trips, {ftTicks / (double)N:F0} ticks at the line");
        Console.WriteLine($"orb% {100 * orb / Math.Max(1, orb + drb):F1}  up {cfg.UP} phys {cfg.PHYS} ph2 {(Sim.PH2 ? 1 : 0)}" + (bs != null ? $"  per game: rim {bs.RimHits / (double)N:F0} glass {bs.GlassHits / (double)N:F0} body {bs.BodyHits / (double)N:F1} arm {bs.ArmHits / (double)N:F1} limb {bs.LimbHits / (double)N:F1} leg {bs.LegHits / (double)N:F1}  dribble bounces {phDrib / (double)N:F0} short {phDribShort / (double)N:F1}  box-out ticks {phBoxN / (double)N:F0} shove {phBoxPx / N:F0} px  phys blocks {phBlkN / (double)N:F1}; tunnelling {tunnel}" : ""));
        if (tunnel > 0) bad++;
        if (cfg.UP != 0) { var l = new List<string>(); foreach (var kv in UPC) l.Add(kv.Key + ":" + kv.Value); l.Sort(StringComparer.Ordinal); Console.WriteLine("UP features fired: " + string.Join(" ", l)); }
        Console.WriteLine($"sim: {sw.Elapsed.TotalMilliseconds / Math.Max(1, ticksAll):F3} ms/tick over {ticksAll} ticks; problems {bad}");
        Environment.Exit(bad > 0 ? 1 : 0);
    }

    /// <summary>Where the ball is and who is around it (stuck clock / tunnelling reports).</summary>
    static void Diag(BallSim bs)
    {
        Console.WriteLine($"   ball v ({B.vx:F1},{B.vy:F1},{B.vz:F1}) sh {B.sh} sc {B.sc} age {B.age:F2} last {B.last?.n} owner {B.owner?.n} ftq {(ftq != null)} last contact flag {bs?.LastFlag} vn {bs?.LastVn:F1}");
        foreach (var p in P)
        {
            double d = Math.Sqrt((p.x - B.x) * (p.x - B.x) + (p.y - B.y) * (p.y - B.y));
            if (d < 40) Console.WriteLine($"   {p.n} d {d:F1} z {p.z:F1} ht {p.ht} mode {p.mode} act {p.act} v ({p.vx:F0},{p.vy:F0})");
        }
    }
}

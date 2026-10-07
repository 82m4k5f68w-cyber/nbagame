// Plays N seeded CPU-vs-CPU 5v5 games in the C# core (legacy ball physics: no engine outside Unity) and prints a
// per-team box-score summary + invariant checks. Compare with scripts/unity/gamerun.ts (same games in the TS build).
//   scripts/unity/cs.sh unity/CoreTests/GameRun.cs [N] [QL] [legacy|ball]   (ball = Core/BallSim, the Unity engine)
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
        if (a.Length > 2 && a[2] == "ball") { cfg.physics = "rapier"; Phys.RAP = new BallSim(); }
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
                if (RPL != null) skipReplay();
                FX.Clear();
                ticks++;
                if (S == "half") setS("play");
                if (clock == lastT) { if (++stuck > 60 * 60 && S == "play") { Console.WriteLine($"game {g}: clock stuck at {clock} q{q} rs {rs} inb {inb} ball {B.mode}"); bad++; break; } } else stuck = 0;
                lastT = clock;
                foreach (var p in P)
                    if (double.IsNaN(p.x) || double.IsNaN(p.y) || double.IsNaN(p.z)) { Console.WriteLine($"game {g} tick {ticks}: NaN player {p.n}"); bad++; goto next; }
                if (double.IsNaN(B.x) || double.IsNaN(B.z)) { Console.WriteLine($"game {g} tick {ticks}: NaN ball"); bad++; goto next; }
            }
            next:
            ticksAll += ticks;
            Console.WriteLine($"game {g}: {cl[0]} {sc[0]} - {sc[1]} {cl[1]}  ({S}, {ticks} ticks)");
            for (int t = 0; t < 2; t++)
            {
                teams++;
                foreach (var p in ROST[t]) { pts += p.stt.pts; fga += p.stt.fga; fgm += p.stt.fgm; tpa += p.stt.tpa; tpm += p.stt.tpm; reb += p.stt.reb; ast += p.stt.ast; blk += p.stt.blk; }
            }
        }
        double k = 48 * 60 / (4 * QL) / teams; // per team per 48 min
        Console.WriteLine($"per team/48: pts {pts * k:F1} fga {fga * k:F1} fg% {100 * fgm / Math.Max(1, fga):F1} 3pa {tpa * k:F1} 3p% {100 * tpm / Math.Max(1, tpa):F1} reb {reb * k:F1} ast {ast * k:F1} blk {blk * k:F1}");
        Console.WriteLine($"sim: {sw.Elapsed.TotalMilliseconds / Math.Max(1, ticksAll):F3} ms/tick over {ticksAll} ticks; problems {bad}");
        Environment.Exit(bad > 0 ? 1 : 0);
    }
}

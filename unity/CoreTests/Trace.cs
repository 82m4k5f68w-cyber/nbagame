// C# twin of scripts/unity/trace.ts: same seed, same game, one line per tick.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Hoops.Core;
using static Hoops.Core.Sim;

static class Trace
{
    static string F(double v) => (Math.Floor(v * 1000 + 0.5) / 1000).ToString("F3", CultureInfo.InvariantCulture);
    static void Main(string[] a)
    {
        int N = a.Length > 0 ? int.Parse(a[0]) : 3000;
        Rng.Seed(2024);
        cfg.NP = 5; cfg.physics = "legacy"; cfg.MYM = 0; cfg.DIFF = 2;
        cfg.input = c => new Input();
        setQtrLen(180);
        setCtrls(new List<Ctrl>());
        start(0, new StartOpts { j = 3 });
        var sb = new StringBuilder();
        for (int t = 0; t < N && S != "over"; t++)
        {
            upd(1 / 60.0);
            if (RPL != null) skipReplay();
            FX.Clear();
            if (S == "half") setS("play");
            sb.Clear();
            sb.Append(t);
            foreach (var p in P) sb.Append(' ').Append(F(p.x)).Append(',').Append(F(p.y)).Append(',').Append(F(p.z));
            sb.Append(" | ").Append(F(B.x)).Append(',').Append(F(B.y)).Append(',').Append(F(B.z)).Append(' ').Append(B.mode).Append(' ').Append(sc[0]).Append('-').Append(sc[1]);
            Console.WriteLine(sb.ToString());
        }
    }
}

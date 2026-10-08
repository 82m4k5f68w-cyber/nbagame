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
    static Input Hin(int t)
    {
        int ph = t % 240;
        var i = new Input { dx = ph < 60 ? 1 : ph < 120 ? -0.6 : ph < 180 ? 0.3 : -1, dy = ((t / 37) % 3 - 1) * 0.7 };
        if ((t / 100) % 2 == 0) i.sp = true;
        if (t % 53 == 0) i.mv = 1 + (t / 53) % 3;
        else if (t % 53 == 20) i.mv = 3;
        if (t % 131 == 0) i.sd = true;
        if (t % 131 == 22) i.su = true;
        if (t % 173 == 90) i.pf = true;
        if (t % 97 == 40) i.e = true;
        if (t % 211 == 150) i.sb = true;
        return i;
    }
    static void Main(string[] a)
    {
        int N = a.Length > 0 ? int.Parse(a[0]) : 3000;
        Rng.Seed(2024);
        cfg.NP = 5; cfg.physics = "legacy"; cfg.MYM = 0; cfg.DIFF = 2;
        // "hum" (2nd arg): the scripted human of trace.ts (team 0) - covers the human-only paths
        bool hum = a.Length > 1 && a[1] == "hum";
        int TK = 0;
        cfg.input = hum ? (c => Hin(TK)) : (c => new Input());
        setQtrLen(180);
        setCtrls(hum ? new List<Ctrl> { mkCtrl("h", 0) } : new List<Ctrl>());
        start(0, new StartOpts { j = 3 });
        var sb = new StringBuilder();
        for (int t = 0; t < N && S != "over"; t++)
        {
            TK = t;
            upd(1 / 60.0);
            if (RPL != null) skipReplay();
            FX.Clear();
            if (S == "half") setS("play");
            sb.Clear();
            sb.Append(t);
            foreach (var p in P) sb.Append(' ').Append(F(p.x)).Append(',').Append(F(p.y)).Append(',').Append(F(p.z));
            sb.Append(" | ").Append(F(B.x)).Append(',').Append(F(B.y)).Append(',').Append(F(B.z)).Append(' ').Append(B.mode).Append(' ').Append(sc[0]).Append('-').Append(sc[1]).Append(" r").Append(Rng.N);
            Console.WriteLine(sb.ToString());
        }
    }
}

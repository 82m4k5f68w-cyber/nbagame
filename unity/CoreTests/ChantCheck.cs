// Crowd chant parity (Game/ChantDir.cs + ChantSynth.cs vs src/client/chantdir.ts + chantsyn.ts):
//  1. replays the random game script written by tests/chants.ts and compares every chant start (time, id, word, side,
//     gain, delay) with the browser's log - identical decisions, identical random draws
//  2. renders every chant and compares its length + RMS level with the browser's render (within 2%)
//   CS=/tmp/x/chants.txt npx tsx tests/chants.ts && scripts/unity/cs.sh unity/CoreTests/ChantCheck.cs /tmp/x/chants.txt
//@include unity/Assets/Scripts/Game/ChantDir.cs
//@include unity/Assets/Scripts/Game/ChantSynth.cs
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Hoops.Core;
using Hoops.Game;

static class ChantCheck
{
    static string F3(double v) => ((long)Math.Round(v * 1e6, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture); // (JS Math.round: half up; values here are positive)
    static int Main(string[] a)
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        string path = a.Length > 0 ? a[0] : "/tmp/chants.txt";
        int fails = 0;
        var roster = new Dictionary<string, int> { ["H1"] = 0, ["H2"] = 0, ["H3"] = 0, ["A1"] = 1, ["A2"] = 1, ["A3"] = 1 };
        var d = new ChantDir(ChantDir.Rng32(7));
        var c = new CCtx { names = new[] { "Lakers", "Thunder" }, tmOf = n => roster.TryGetValue(n, out var t) ? t : -1 };
        var log = new List<string>();
        void Emit(CReq r) => log.Add(F3(r.t) + " " + r.id + " " + (string.IsNullOrEmpty(r.word) ? "-" : r.word) + " " + r.side + " " + F3(r.gain) + " " + F3(r.delay));
        foreach (var ln in File.ReadAllLines(path))
        {
            if (ln.Length == 0) continue;
            var parts = ln.Split(new[] { " | " }, StringSplitOptions.None);
            var s = parts[0].Split(' ');
            double N(int i) => double.Parse(s[i], CultureInfo.InvariantCulture);
            c.live = s[0] == "1"; c.over = s[1] == "1"; c.pos = (int)N(2); c.sc[0] = N(3); c.sc[1] = N(4); c.q = (int)N(5); c.clutch = s[6] == "1";
            c.mom = N(7); c.run[0] = N(8); c.run[1] = N(9); c.dead = s[10] == "1"; c.ft = (int)N(11); c.ftTm = (int)N(12); c.ftN = s[13] == "-" ? "" : s[13];
            c.ftStar = s[14] == "1"; c.bench = s[15] == "-" ? "" : s[15]; c.speaking = s[16] == "1";
            if (parts.Length > 1)
                foreach (var f in parts[1].Split(' '))
                {
                    var p = f.Split(',');
                    if (p[0] == "R") { var r = d.Riff(p[1], c); if (r != null) Emit(r); }
                    else if (p[0] == "air" || p[0] == "chant") { double v = double.Parse(p[1], CultureInfo.InvariantCulture); d.OnFx(new Fx { k = p[0], v = v, tm = v, hasTm = true }, c); }
                    else if (p[0] == "x") d.OnFx(new Fx { k = "x", v = double.Parse(p[1], CultureInfo.InvariantCulture) }, c);
                    else d.OnFx(new Fx { k = "cm", e = p[1], n = p[2], n2 = p.Length > 3 ? p[3] : null }, c);
                }
            var t = d.Tick(1.0 / 60, c);
            if (t != null) Emit(t);
        }
        var exp = File.ReadAllLines(path + ".expect");
        int nExp = 0;
        foreach (var e in exp) if (e.Length > 0) nExp++;
        int same = 0;
        for (int i = 0; i < Math.Min(nExp, log.Count); i++)
        {
            if (exp[i] == log[i]) same++;
            else if (fails++ < 5) Console.WriteLine("DIFF #" + i + " ts: " + exp[i] + " | cs: " + log[i]);
        }
        if (nExp != log.Count) { fails++; Console.WriteLine("count ts " + nExp + " cs " + log.Count); }
        Console.WriteLine("director: " + same + "/" + nExp + " chant starts identical");

        // synthesis levels
        var rms = new Dictionary<string, string[]>();
        if (File.Exists(path + ".rms")) foreach (var l in File.ReadAllLines(path + ".rms")) if (l.Length > 0) { var q = l.Split(' '); rms[q[0]] = q; }
        foreach (var id in ChantDir.IDS)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var j = new ChantSynth.ChantJob(id, id == "letsgo" ? "Timberwolves" : id == "wewant" ? "Gilgeous-Alexander" : "").All();
            double s2 = 0, pk = 0;
            int bad = 0;
            foreach (var A in new[] { j.L, j.R })
                foreach (var v in A) { if (float.IsNaN(v) || float.IsInfinity(v)) bad++; s2 += (double)v * v; pk = Math.Max(pk, Math.Abs(v)); }
            double r = Math.Sqrt(s2 / (2.0 * j.L.Length));
            string cmp = "";
            if (rms.TryGetValue(id, out var tr))
            {
                double tsr = double.Parse(tr[1], CultureInfo.InvariantCulture);
                int tsn = int.Parse(tr[2]);
                bool okk = Math.Abs(r - tsr) <= 0.02 * tsr && tsn == j.L.Length;
                cmp = " ts rms " + tr[1] + (okk ? " ok" : " MISMATCH");
                if (!okk) fails++;
            }
            if (bad > 0 || pk > 0.9001 || r < 0.03) fails++;
            Console.WriteLine(id + ": " + j.L.Length + " samples, rms " + r.ToString("F5") + " peak " + pk.ToString("F3") + " bad " + bad + cmp + " (" + sw.ElapsedMilliseconds + " ms)");
        }
        Console.WriteLine(fails == 0 ? "ChantCheck OK" : fails + " FAILED");
        return fails == 0 ? 0 : 1;
    }
}

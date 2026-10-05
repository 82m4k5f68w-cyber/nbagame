// Prints every rostered player's form (formOf) as JSON lines; scripts/unity/parity-data.ts compares with the TS build.
using System;
using System.Globalization;
using System.Linq;
using Hoops.Core;

static class FormParity
{
    static string N(double v) => v.ToString("R", CultureInfo.InvariantCulture);
    static void Main()
    {
        foreach (var t in Data.TM)
            foreach (var p in t.ps)
            {
                var f = Data.FormOf(p.n);
                Console.WriteLine($"{p.n}|{N(f.a)}|{N(f.f)}|{N(f.l)}|{N(f.k)}|{N(f.g)}|{N(f.w)}|{N(f.dp)}|{N(f.ft)}|{N(f.lk)}|{N(f.tw)}|{N(f.gh)}|{string.Join(",", f.ce)}|{f.dk}|{f.gs}|{N(f.fr)}|ovr {Data.Ov2(p)}");
            }
        Console.WriteLine($"clips {Data.CL.Count} mshot {Data.CL["mshot"].Count} ck {Data.CK.Length}");
    }
}

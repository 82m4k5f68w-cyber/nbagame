// Small JSON writer/reader for the presence protocol (no Newtonsoft; JsonUtility can't do dictionaries).
// Values: null, bool, double (every JSON number), string, List<object> (arrays), Dictionary<string, object> (objects).
// The writer also accepts int/long/float, double[]/int[]/long[], IList and IDictionary<string, object>, and formats
// numbers like JSON.stringify (integers without ".0", shortest round-trip otherwise, -0 -> 0, NaN/Infinity -> null),
// so the wire format and the size checks match the browser build. Pure C# (no UnityEngine).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Hoops.Game.Net
{
    public static class Json
    {
        // ------------------------------------------------------------------ writer
        [ThreadStatic] static StringBuilder sbCache;

        public static string Write(object v)
        {
            var sb = sbCache ??= new StringBuilder(4096);
            sb.Clear();
            Write(sb, v);
            return sb.ToString();
        }

        public static void Write(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); return;
                case string s: Str(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case double d: Num(sb, d); return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case float f: Num(sb, f); return;
                case double[] da:
                    sb.Append('[');
                    for (int k = 0; k < da.Length; k++) { if (k > 0) sb.Append(','); Num(sb, da[k]); }
                    sb.Append(']');
                    return;
                case int[] ia:
                    sb.Append('[');
                    for (int k = 0; k < ia.Length; k++) { if (k > 0) sb.Append(','); sb.Append(ia[k].ToString(CultureInfo.InvariantCulture)); }
                    sb.Append(']');
                    return;
                case IDictionary<string, object> o:
                    {
                        sb.Append('{');
                        bool first = true;
                        foreach (var kv in o)
                        {
                            if (IsUndefined(kv.Value)) continue; // (JSON.stringify drops undefined members)
                            if (!first) sb.Append(',');
                            first = false;
                            Str(sb, kv.Key);
                            sb.Append(':');
                            Write(sb, kv.Value);
                        }
                        sb.Append('}');
                        return;
                    }
                case IJsonable j: Write(sb, j.ToJson()); return;
                case IList a:
                    sb.Append('[');
                    for (int k = 0; k < a.Count; k++) { if (k > 0) sb.Append(','); Write(sb, a[k]); }
                    sb.Append(']');
                    return;
            }
            Str(sb, v.ToString());
        }

        /// <summary>Marker for "leave this member out" (TS undefined).</summary>
        public static readonly object Undefined = new object();
        static bool IsUndefined(object v) => ReferenceEquals(v, Undefined);

        public static void Num(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            if (d == Math.Floor(d) && Math.Abs(d) < 1e15)
            {
                sb.Append(((long)d).ToString(CultureInfo.InvariantCulture));
                return;
            }
            string s = d.ToString("R", CultureInfo.InvariantCulture);
            int e = s.IndexOf('E');
            if (e < 0) { sb.Append(s); return; }
            // JS style exponent: 1e-7, 1e+21
            sb.Append(s, 0, e).Append('e');
            int k = e + 1;
            char sign = s[k] == '-' ? '-' : '+';
            if (s[k] == '-' || s[k] == '+') k++;
            while (k < s.Length - 1 && s[k] == '0') k++;
            sb.Append(sign).Append(s, k, s.Length - k);
        }

        static void Str(StringBuilder sb, string s)
        {
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20 || (char.IsSurrogate(c) && !(char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) && !(char.IsLowSurrogate(c) && i > 0 && char.IsHighSurrogate(s[i - 1]))))
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ------------------------------------------------------------------ reader
        /// <summary>Parse a JSON text. Throws FormatException on garbage (callers that read the network catch it).</summary>
        public static object Parse(string s)
        {
            int i = 0;
            var v = Val(s, ref i);
            Ws(s, ref i);
            if (i != s.Length) throw new FormatException("json: trailing data at " + i);
            return v;
        }

        public static bool TryParse(string s, out object v)
        {
            try { v = Parse(s); return true; }
            catch (Exception) { v = null; return false; }
        }

        static void Ws(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
        }

        static object Val(string s, ref int i)
        {
            Ws(s, ref i);
            if (i >= s.Length) throw new FormatException("json: unexpected end");
            char c = s[i];
            if (c == '{')
            {
                i++;
                var o = new Dictionary<string, object>();
                Ws(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return o; }
                while (true)
                {
                    Ws(s, ref i);
                    if (i >= s.Length || s[i] != '"') throw new FormatException("json: key expected at " + i);
                    string k = StrVal(s, ref i);
                    Ws(s, ref i);
                    if (i >= s.Length || s[i] != ':') throw new FormatException("json: ':' expected at " + i);
                    i++;
                    o[k] = Val(s, ref i);
                    Ws(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == '}') { i++; return o; }
                    throw new FormatException("json: ',' or '}' expected at " + i);
                }
            }
            if (c == '[')
            {
                i++;
                var a = new List<object>();
                Ws(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return a; }
                while (true)
                {
                    a.Add(Val(s, ref i));
                    Ws(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == ']') { i++; return a; }
                    throw new FormatException("json: ',' or ']' expected at " + i);
                }
            }
            if (c == '"') return StrVal(s, ref i);
            if (Lit(s, ref i, "true")) return true;
            if (Lit(s, ref i, "false")) return false;
            if (Lit(s, ref i, "null")) return null;
            int st = i;
            if (s[i] == '-') i++;
            while (i < s.Length && ((s[i] >= '0' && s[i] <= '9') || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++;
            if (i == st) throw new FormatException("json: value expected at " + i);
            if (!double.TryParse(s.AsSpan(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture, out double d)) throw new FormatException("json: bad number at " + st);
            return d;
        }

        static bool Lit(string s, ref int i, string w)
        {
            if (string.CompareOrdinal(s, i, w, 0, w.Length) != 0) return false;
            i += w.Length;
            return true;
        }

        static string StrVal(string s, ref int i)
        {
            i++; // opening quote
            int st = i;
            while (i < s.Length && s[i] != '"' && s[i] != '\\') i++;
            if (i < s.Length && s[i] == '"') { var r = s.Substring(st, i - st); i++; return r; }
            var sb = new StringBuilder();
            sb.Append(s, st, i - st);
            while (true)
            {
                if (i >= s.Length) throw new FormatException("json: unterminated string");
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) throw new FormatException("json: bad escape");
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw new FormatException("json: bad \\u");
                        sb.Append((char)int.Parse(s.AsSpan(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: throw new FormatException("json: bad escape \\" + e);
                }
            }
        }

        // ------------------------------------------------------------------ typed access (JS-style loose reads)
        public static object Get(this Dictionary<string, object> o, string k) => o != null && o.TryGetValue(k, out var v) ? v : null;
        public static bool Has(this Dictionary<string, object> o, string k) => o != null && o.ContainsKey(k);
        /// <summary>A number member, or d when missing / not a number.</summary>
        public static double Num(this Dictionary<string, object> o, string k, double d = 0) => o.Get(k) is double v ? v : d;
        /// <summary>JS unary plus: +x (strings parse, booleans 0/1, else d).</summary>
        public static double Plus(object v, double d)
        {
            switch (v)
            {
                case double x: return x;
                case bool b: return b ? 1 : 0;
                case string s: return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var r) ? r : d;
            }
            return d;
        }
        public static string Str(this Dictionary<string, object> o, string k) => o.Get(k) as string;
        public static Dictionary<string, object> Obj(this Dictionary<string, object> o, string k) => o.Get(k) as Dictionary<string, object>;
        public static List<object> Arr(this Dictionary<string, object> o, string k) => o.Get(k) as List<object>;
        /// <summary>JS truthiness of a parsed value.</summary>
        public static bool Truthy(object v) => v switch
        {
            null => false,
            bool b => b,
            double d => d != 0 && !double.IsNaN(d),
            string s => s.Length > 0,
            _ => true,
        };
        public static double D(object v, double d = 0) => v is double x ? x : d;
        /// <summary>Array of numbers (non-numbers read as 0) into a new double[].</summary>
        public static double[] Nums(object v)
        {
            if (v is double[] da) return da;
            if (!(v is List<object> a)) return null;
            var r = new double[a.Count];
            for (int i = 0; i < r.Length; i++) r[i] = a[i] is double x ? x : 0;
            return r;
        }
    }

    /// <summary>Objects that serialize through a plain dictionary (Lobby, Slot, ...).</summary>
    public interface IJsonable
    {
        Dictionary<string, object> ToJson();
    }
}

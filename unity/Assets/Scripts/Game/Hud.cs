// Heads-up display for the Unity build (port of src/client/hud.ts + the overlay() order of game.ts): score bug, player
// strip, the four shot-meter styles (green window at the TOP), contest ring + label, open / pass markers, the dashed
// assignment ring under your man on defense, replay tag, free-throw caption, name tags and floating texts (Fx "t",
// world-anchored ones projected with the camera). The broadcast layers (Broadcast.cs: bug, banners, captions, intro
// cards, timing card, halftime) are drawn from here so the layering matches the browser exactly.
// Layout is the browser's 960x540 canvas scaled to the screen height (designed at 1080p = 2x); left / right anchored
// items stay at the screen edges on wide screens. IMGUI for text + GUI.DrawTexture (rounded rects), GL for lines,
// ellipses and polygons. Strings are cached, so a steady HUD allocates nothing per frame.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    /// <summary>Immediate-mode drawing in canvas units (960x540 design, scaled by Screen.height / 540).</summary>
    public static class Ui
    {
        public static float s = 2, ox;
        public static float W => Screen.width;
        static Material mat;
        static readonly Dictionary<int, GUIStyle> styles = new();
        static readonly GUIContent gc = new GUIContent();
        static readonly Dictionary<string, Color> cols = new();

        public static void Begin()
        {
            s = Mathf.Max(0.5f, Screen.height / 540f);
            ox = (Screen.width - 960 * s) / 2;
        }
        /// <summary>Canvas x (centred 960-wide stage) -> screen x.</summary>
        public static float X(float x) => ox + x * s;
        /// <summary>Canvas x measured from the left / right screen edge.</summary>
        public static float XL(float x) => x * s;
        public static float XR(float x) => Screen.width - (960 - x) * s;
        public static float Y(float y) => y * s;

        public static Color Hex(string h)
        {
            if (string.IsNullOrEmpty(h)) return Color.white;
            if (cols.TryGetValue(h, out var c)) return c;
            if (!ColorUtility.TryParseHtmlString(h, out c)) c = Color.white;
            if (cols.Count < 256) cols[h] = c;
            return c;
        }
        public static Color A(Color c, float a) { c.a *= a; return c; }

        public static void Fill(float x, float y, float w, float h, Color c)
        {
            if (c.a <= 0.003f || w <= 0 || h <= 0) return;
            GUI.color = c;
            GUI.DrawTexture(new Rect(x, y, w, h), Texture2D.whiteTexture);
            GUI.color = Color.white;
        }
        public static void RFill(float x, float y, float w, float h, float r, Color c)
        {
            if (c.a <= 0.003f || w <= 0 || h <= 0) return;
            GUI.DrawTexture(new Rect(x, y, w, h), Texture2D.whiteTexture, ScaleMode.StretchToFill, true, 0, c, 0, r);
        }

        static GUIStyle St(float px, FontStyle fs)
        {
            int size = Mathf.Max(6, Mathf.RoundToInt(px));
            int key = size * 8 + (int)fs;
            if (!styles.TryGetValue(key, out var st))
            {
                st = new GUIStyle(GUI.skin.label) { fontSize = size, fontStyle = fs, wordWrap = false, clipping = TextClipping.Overflow, padding = new RectOffset(0, 0, 0, 0), margin = new RectOffset(0, 0, 0, 0), richText = false };
                styles[key] = st;
            }
            return st;
        }
        /// <summary>Text width in screen px for a font size in canvas px.</summary>
        public static float Measure(string t, float size, FontStyle fs = FontStyle.Bold)
        {
            gc.text = t;
            return St(size * s, fs).CalcSize(gc).x;
        }
        /// <summary>fillText: (x, y) = screen px, y = baseline; size in canvas px; align -1 left, 0 centre, 1 right.</summary>
        public static void Text(string t, float x, float y, float size, Color c, int align = 0, FontStyle fs = FontStyle.Bold, float alpha = 1)
        {
            if (string.IsNullOrEmpty(t) || alpha <= 0.01f) return;
            float px = size * s;
            var st = St(px, fs);
            st.alignment = align < 0 ? TextAnchor.UpperLeft : align > 0 ? TextAnchor.UpperRight : TextAnchor.UpperCenter;
            gc.text = t;
            float top = y - px * 1.02f, h = px * 1.4f;
            var r = align < 0 ? new Rect(x, top, 4000, h) : align > 0 ? new Rect(x - 4000, top, 4000, h) : new Rect(x - 2000, top, 4000, h);
            // a soft shadow keeps text readable over the bright floor
            st.normal.textColor = new Color(0, 0, 0, 0.55f * c.a * alpha);
            GUI.Label(new Rect(r.x + px * 0.06f, r.y + px * 0.06f, r.width, r.height), gc, st);
            st.normal.textColor = A(c, alpha);
            GUI.Label(r, gc, st);
        }

        // ---------------- GL shapes (screen px, y down) ----------------
        static bool GLBegin(int mode)
        {
            if (Event.current == null || Event.current.type != EventType.Repaint) return false;
            if (mat == null)
            {
                var sh = Shader.Find("Hidden/Internal-Colored");
                if (sh == null) return false;
                mat = new Material(sh) { hideFlags = HideFlags.HideAndDontSave };
                mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                mat.SetInt("_Cull", 0);
                mat.SetInt("_ZWrite", 0);
                mat.SetInt("_ZTest", (int)UnityEngine.Rendering.CompareFunction.Always);
            }
            GL.PushMatrix();
            mat.SetPass(0);
            GL.LoadPixelMatrix();
            GL.Begin(mode);
            return true;
        }
        static void GLEnd() { GL.End(); GL.PopMatrix(); }
        static void Vx(float x, float y) => GL.Vertex3(x, Screen.height - y, 0);

        public static void Line(float x0, float y0, float x1, float y1, float w, Color c)
        {
            if (!GLBegin(GL.QUADS)) return;
            GL.Color(c);
            Seg(x0, y0, x1, y1, w);
            GLEnd();
        }
        static void Seg(float x0, float y0, float x1, float y1, float w)
        {
            float dx = x1 - x0, dy = y1 - y0, l = Mathf.Sqrt(dx * dx + dy * dy);
            if (l < 1e-4f) return;
            float nx = -dy / l * w * 0.5f, ny = dx / l * w * 0.5f;
            Vx(x0 + nx, y0 + ny); Vx(x1 + nx, y1 + ny); Vx(x1 - nx, y1 - ny); Vx(x0 - nx, y0 - ny);
        }
        /// <summary>Stroke an ellipse arc (canvas ellipse(): angle 0 = +x, clockwise on screen) as a quad strip.</summary>
        public static void Arc(float cx, float cy, float rx, float ry, float a0, float a1, float w, Color c, int dash = 0)
        {
            if (rx <= 0 || ry <= 0 || !GLBegin(GL.QUADS)) return;
            GL.Color(c);
            int n = Mathf.Clamp((int)(Mathf.Abs(a1 - a0) * 12) + 2, 4, 96);
            float h = w * 0.5f;
            for (int k = 0; k < n; k++)
            {
                if (dash > 0 && (k / dash) % 2 == 1) continue;
                float u0 = a0 + (a1 - a0) * k / n, u1 = a0 + (a1 - a0) * (k + 1) / n,
                    c0 = Mathf.Cos(u0), s0 = Mathf.Sin(u0), c1 = Mathf.Cos(u1), s1 = Mathf.Sin(u1);
                Vx(cx + c0 * (rx - h), cy + s0 * (ry - h));
                Vx(cx + c0 * (rx + h), cy + s0 * (ry + h));
                Vx(cx + c1 * (rx + h), cy + s1 * (ry + h));
                Vx(cx + c1 * (rx - h), cy + s1 * (ry - h));
            }
            GLEnd();
        }
        /// <summary>Filled convex quad / triangle (pass the last point twice for a triangle).</summary>
        public static void Quad(float x0, float y0, float x1, float y1, float x2, float y2, float x3, float y3, Color c)
        {
            if (!GLBegin(GL.QUADS)) return;
            GL.Color(c);
            Vx(x0, y0); Vx(x1, y1); Vx(x2, y2); Vx(x3, y3);
            GLEnd();
        }
        /// <summary>Closed polyline through `n` points.</summary>
        public static void Poly(float[] xs, float[] ys, int n, float w, Color c)
        {
            if (!GLBegin(GL.QUADS)) return;
            GL.Color(c);
            for (int k = 0; k < n; k++) Seg(xs[k], ys[k], xs[(k + 1) % n], ys[(k + 1) % n], w);
            GLEnd();
        }
        public static void Dot(float x, float y, float r, Color c) => Arc(x, y, r * 0.5f, r * 0.5f, 0, 6.2832f, r, c);

        // ---------------- cached strings (no per-frame garbage) ----------------
        static readonly string[] nums = new string[400];
        public static string Num(double v)
        {
            int i = (int)System.Math.Round(v);
            if (i < 0 || i >= nums.Length) return i.ToString();
            return nums[i] ??= i.ToString();
        }
        static readonly string[] clocks = new string[800];
        /// <summary>view.ts fmt: game seconds -> the 12-minute broadcast clock at any quarter length.</summary>
        public static string Clock(double sec)
        {
            int s = (int)System.Math.Ceiling(System.Math.Max(0, sec) * 720 / System.Math.Max(1, QTRLEN));
            if (s >= clocks.Length) return s / 60 + ":" + (s % 60).ToString("00");
            return clocks[s] ??= s / 60 + ":" + (s % 60).ToString("00");
        }
    }

    public sealed class Hud : MonoBehaviour
    {
        // settings (view.ts V.*), saved in PlayerPrefs
        public static int METER; // 0 arrow, 1 bar (feet), 2 bar (head), 3 ring
        public static bool CB, BIGM; // colourblind meter colours, bigger meter
        public static readonly string[] MN = { "Arrow 2", "Bar (feet)", "Bar (head)", "Ring" };
        public static Camera Cam => cam != null ? cam : (cam = Camera.main);
        static Camera cam;

        // floating texts (input.ts TX): fixed pool
        struct Tx { public string s; public Color c; public float t, oy; public bool world; public float x, y, z, sx, sy; }
        static readonly Tx[] TX = new Tx[24];
        static int txN;
        readonly Hoops.Core.Input pin = new Hoops.Core.Input();
        readonly float[] px = new float[8], py = new float[8];
        readonly Dictionary<Player, string> tags = new();
        List<Player> tagP;
        string strip, stripR, ftS;
        long stripK = -1, stripRK = -1, ftK = -1;

        void Awake()
        {
            try
            {
                METER = PlayerPrefs.GetInt("h2k_meter", 0) & 3;
                CB = PlayerPrefs.GetInt("h2k_cb", 0) != 0;
                BIGM = PlayerPrefs.GetInt("h2k_bigm", 0) != 0;
            }
            catch { }
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            for (int i = txN - 1; i >= 0; i--)
            {
                TX[i].t -= dt;
                TX[i].oy -= 25 * dt;
                if (TX[i].t <= 0) { TX[i] = TX[txN - 1]; txN--; }
            }
            if (UnityEngine.Input.GetKeyDown(KeyCode.M) && S != "menu")
            {
                METER = (METER + 1) % 4;
                try { PlayerPrefs.SetInt("h2k_meter", METER); } catch { }
                AddText("METER: " + MN[METER], "#ffd23f", null, null, null, 480, 200);
            }
        }

        /// <summary>Fx "t" (floating text in the world or on the screen).</summary>
        public static void OnFx(Fx f)
        {
            if (f.k == "t" && f.s != null) AddText(f.s, f.c, f.x, f.y, f.z, f.sx, f.sy);
        }
        public static void AddText(string s, string c, double? x, double? y, double? z, double? sx, double? sy)
        {
            if (txN >= TX.Length) { for (int i = 1; i < txN; i++) TX[i - 1] = TX[i]; txN--; }
            TX[txN++] = new Tx { s = s, c = Ui.Hex(c ?? "#ffffff"), t = 1.2f, oy = 0, world = x.HasValue, x = (float)(x ?? 0), y = (float)(y ?? 0), z = (float)(z ?? 0), sx = (float)(sx ?? 480), sy = (float)(sy ?? 200) };
        }
        public static void ClearTexts() => txN = 0;

        /// <summary>view.ts pr(): game coords -> screen px (y down); false when behind the camera.</summary>
        public static bool Pr(double x, double y, double z, out float sx, out float sy)
        {
            var c = Cam;
            sx = sy = -9999;
            if (c == null) return false;
            var p = c.WorldToScreenPoint(PhysXBall.U(x, y, z));
            if (p.z <= 0.1f) return false;
            sx = p.x;
            sy = Screen.height - p.y;
            return true;
        }

        static Player FocusP()
        {
            var c = CT.Count > 0 ? CT[0] : null;
            return c != null && c.idx >= 0 && c.idx < P.Count ? P[(int)c.idx] : null;
        }

        void OnGUI()
        {
            if (S == "menu" || P == null || P.Count == 0) return;
            GUI.depth = 10; // behind Menus (-10)
            Ui.Begin();
            // overlay() in game.ts
            ScoreBug();
            Strip();
            Broadcast.DrawBug(CT.Count > 0 ? (int)CT[0].tm : -1);
            if (S == "intro") { Broadcast.DrawPlayerIntro(); return; }
            Broadcast.DrawTipCard();
            Broadcast.DrawBanners();
            Broadcast.DrawTiming();
            NameTags();
            var p0 = FocusP();
            if (p0 != null && !Util.T(p0.off)) { ContestFx(p0); Meter(p0); }
            OpenMark();
            AssignMark();
            PassMark();
            ReplayHud();
            for (int k = 1; k < CT.Count; k++)
            {
                var c = CT[k];
                if (c.idx < 0 || c.idx >= P.Count || P[(int)c.idx] == p0) continue;
                ContestFx(P[(int)c.idx]);
                Meter(P[(int)c.idx]);
            }
            if (S == "half") Broadcast.DrawHalftime();
        }

        // ---------------- score bug (hud) ----------------
        void ScoreBug()
        {
            if (!gameLike()) { Texts(); return; }
            float s = Ui.s;
            Ui.Fill(Ui.X(230), Ui.Y(6), 500 * s, 62 * s, new Color(8 / 255f, 10 / 255f, 24 / 255f, 0.88f));
            Ui.Fill(Ui.X(230), Ui.Y(6), 6 * s, 62 * s, Ui.Hex(PC[0] ?? "#7b3fb5"));
            Ui.Fill(Ui.X(724), Ui.Y(6), 6 * s, 62 * s, Ui.Hex(PC[1] ?? "#1d428a"));
            var me = FocusP();
            int mt = me != null ? (int)me.tm : 0;
            Ui.Text(Team(0, mt == 0), Ui.X(340), Ui.Y(24), 12, Color.white);
            Ui.Text(Team(1, mt == 1), Ui.X(620), Ui.Y(24), 12, Color.white);
            Ui.Text(Ui.Num(sc[0]), Ui.X(340), Ui.Y(56), 30, Color.white);
            Ui.Text(Ui.Num(sc[1]), Ui.X(620), Ui.Y(56), 30, Color.white);
            Ui.Text(ClockStr(), Ui.X(480), Ui.Y(36), 20, new Color(1, 0.82f, 0.25f));
            Ui.Text(cfg.SCLK != 0 ? Ui.Num(System.Math.Ceiling(System.Math.Max(0, shot))) : "—", Ui.X(480), Ui.Y(58), 16, shot < 5 ? Ui.Hex("#ff6b4a") : Color.white);
            Texts();
        }
        readonly string[] teamS = new string[4];
        readonly string[] teamK = new string[2];
        string Team(int t, bool you)
        {
            string n = cl[t] ?? "";
            if (!ReferenceEquals(teamK[t], n)) { teamK[t] = n; teamS[t * 2] = n.ToUpperInvariant(); teamS[t * 2 + 1] = teamS[t * 2] + " (YOU)"; }
            return teamS[t * 2 + (you ? 1 : 0)];
        }
        string clockS;
        long clockK = -1;
        string ClockStr()
        {
            long k = cfg.TO != 0 ? 100000 + (long)cfg.TO : (long)q * 10000 + (long)System.Math.Ceiling(System.Math.Max(0, clock) * 720 / System.Math.Max(1, QTRLEN));
            if (k != clockK) { clockK = k; clockS = cfg.TO != 0 ? "FIRST TO " + Ui.Num(cfg.TO) : (q > 4 ? "OT" : "Q" + Ui.Num(q)) + "  " + Ui.Clock(clock); }
            return clockS;
        }

        void Texts()
        {
            for (int i = 0; i < txN; i++)
            {
                ref var o = ref TX[i];
                float x, y;
                if (o.world) { if (!Pr(o.x, o.y, o.z, out x, out y)) continue; }
                else { x = Ui.X(o.sx); y = Ui.Y(o.sy); }
                Ui.Text(o.s, x, y + o.oy * Ui.s, 22, o.c, 0, FontStyle.Bold, Mathf.Min(1, o.t * 2));
            }
        }

        // ---------------- bottom strip (hud2) ----------------
        void Strip()
        {
            var p = FocusP();
            if (p == null) return;
            float s = Ui.s;
            Ui.Fill(0, Ui.Y(512), Screen.width, 28 * s, new Color(0, 0, 0, 0.55f));
            long k = ((((long)p.GetHashCode() * 31 + (long)p.stt.pts) * 41 + (long)p.stt.reb) * 41 + (long)p.stt.ast) * 11 + (long)p.pf;
            k = k * 101 + (long)System.Math.Round(p.en * 100);
            if (k != stripK)
            {
                stripK = k;
                strip = $"{p.n}  OVR {ovr(p)} · 3PT {p.c} · INS {p.i} · SPD {p.s} · DEF {p.d} · {p.stt.pts}p {p.stt.reb}r {p.stt.ast}a · PF {p.pf} · EN {System.Math.Round(p.en * 100)}%";
            }
            Ui.Text(strip, Ui.XL(12), Ui.Y(530), 12, Color.white, -1);
            bool tmp = Util.T(tempoOf(p));
            long k2 = (tmp ? 1 : 0) + METER * 2 + (long)tf[(int)p.tm] * 8 + (long)tf[1 - (int)p.tm] * 800;
            if (k2 != stripRK) { stripRK = k2; stripR = $"TEMPO {(tmp ? "ON" : "OFF")} · {MN[METER]} [M] · FOULS {tf[(int)p.tm]}/{tf[1 - (int)p.tm]}"; }
            Ui.Text(stripR, Ui.XR(948), Ui.Y(530), 12, Color.white, 1);
            if (ftq != null && ftq.i >= 0)
            {
                long k3 = (long)ftq.i * 100 + (long)ftq.n * 10 + (Util.T(ftq.tech) ? 1 : 0) + (ftq.s != null ? (long)ftq.s.GetHashCode() * 1000 : 0);
                if (k3 != ftK) { ftK = k3; ftS = (Util.T(ftq.tech) ? "TECHNICAL " : "") + "FREE THROW " + (ftq.i + 1) + "/" + ftq.n + " — " + (ftq.s != null ? ftq.s.n : ""); }
                Ui.Text(ftS, Ui.X(480), Ui.Y(100), 18, new Color(1, 0.82f, 0.25f));
            }
        }

        // ---------------- name tags over controlled players + the ball handler ----------------
        void NameTags()
        {
            if (!ReferenceEquals(tagP, P)) { tags.Clear(); tagP = P; }
            Player a = null, b = null;
            for (int k = 0; k < CT.Count && k < 2; k++)
            {
                var c = CT[k];
                if (c.idx < 0 || c.idx >= P.Count) continue;
                var p = P[(int)c.idx];
                if (k == 0) a = p; else b = p;
            }
            Tag(a);
            if (b != a) Tag(b);
            if (B.owner != a && B.owner != b) Tag(B.owner);
        }
        void Tag(Player p)
        {
            if (p == null || Util.T(p.off)) return;
            if (!tags.TryGetValue(p, out var s)) tags[p] = s = (p.n ?? "").ToUpperInvariant() + " " + ovr(p);
            if (Pr(p.x, p.y, p.z + 78, out float x, out float y)) Ui.Text(s, x, y, 11, Color.white);
        }

        // ---------------- contest ring under the ball handler ----------------
        static float Ph(Player p, float sx, float sy)
        {
            Pr(p.x, p.y, 70, out _, out float hy);
            return Mathf.Max(40 * Ui.s, Mathf.Abs(sy - hy));
        }
        void ContestFx(Player p)
        {
            if (B.owner != p || ftq != null) return;
            if (!Pr(p.x, p.y, 0, out float sx, out float sy)) return;
            // (while charging / releasing: the contest the green window is judged on, live - Sim.shotContest)
            double c = p.mode == "c" || p.mode == "s" ? shotContest(p) : contestOf(p).Item1;
            float ph = Ph(p, sx, sy);
            if (c > 0.03) Ui.Arc(sx, sy, ph * 0.55f, ph * 0.22f, 0, 6.3f, (2 + (float)c * 3) * Ui.s * 0.5f, new Color(1, 70 / 255f, 70 / 255f, 0.35f + (float)c * 0.55f));
            if (p.mode == "c" || p.mode == "s")
            {
                var col = c < 0.08 ? Ui.Hex("#2ecc71") : c < 0.5 ? Ui.Hex("#ffd23f") : Ui.Hex("#ff6b6b");
                Ui.Text(c < 0.08 ? "WIDE OPEN" : ContestStr(c), sx, sy + ph * 0.5f, 12, col);
            }
        }
        readonly string[] contestS = new string[101];
        string ContestStr(double c)
        {
            int i = Mathf.Clamp((int)System.Math.Round(c * 100), 0, 100);
            // the window shrinking with the contest (hud.ts): open = full window .. smothered = a quarter of it
            return contestS[i] ??= (i < 50 ? "CONTESTED" : "SMOTHERED") + " · WINDOW -" + (int)System.Math.Round((1 - cwin(i / 100.0)) * 100) + "%";
        }

        // ---------------- shot meter (hud.ts meter, all 4 styles; green at the TOP / end) ----------------
        void Meter(Player p)
        {
            bool TEMPO = Util.T(tempoOf(p));
            bool tm = TEMPO && p.mode == "s" && !Util.T(p.rl), hold = !TEMPO && p.mode == "c";
            if (!(tm || hold)) return;
            double D0 = Util.Hypot(hoop(p.tm) - p.x, HY - p.y),
                rat = shotRat(p, D0, ftq != null),
                c = shotContest(p), // (live while charging, locked at release - the contest launch judges)
                win = greenWin(p, rat, c, D0 < 90 || Util.T(p.hk) ? 1 : winMul(p, D0)) * (TEMPO ? 1.2 : 1), // (launch's window)
                ideal = TEMPO ? (Data.IsLaySv((int)p.sv) ? 0.28 : p.st == 1 ? 0.3 : 0.4) : p.st == 1 ? 0.45 : 0.6,
                wm = (0.07 + rat / 100 * 0.05) * (TEMPO ? 1.2 : 1),
                m = (ideal + wm) / 0.97;
            float pg = (float)System.Math.Min(1, p.t / m), g1 = 1, g0 = (float)(0.97 - 2 * win / m);
            bool inG = pg >= g0 && pg <= g1;
            if (!Pr(p.x, p.y, 0, out float sx, out float sy)) return;
            float ph = Ph(p, sx, sy) * (BIGM ? 1.6f : 1), S2 = Ui.s;
            Color GC = CB ? Ui.Hex("#4ea8ff") : Ui.Hex("#2ecc71"), WC = CB ? Ui.Hex("#4ea8ff") : Ui.Hex("#1fd6c0"), FC = CB ? Ui.Hex("#ff9f1c") : Ui.Hex("#f5c542");
            if (METER == 0)
            {
                // the arrow: a stem with a triangular head pointing up; fill rises from the feet, green band at the tip
                float ax = sx - ph * 0.5f, aw = ph * 0.3f, ah = ph * 1.05f, sw = aw * 0.3f;
                ArrowBand(ax, sy, aw, ah, sw, 0, 1, new Color(10 / 255f, 12 / 255f, 24 / 255f, 0.6f));
                ArrowBand(ax, sy, aw, ah, sw, 0, pg, inG ? GC : Color.white);
                ArrowBand(ax, sy, aw, ah, sw, g0, g1, A(GC, 0.75f));
                px[0] = ax - sw; py[0] = sy;
                px[1] = ax - sw; py[1] = sy - ah * 0.65f;
                px[2] = ax - aw / 2; py[2] = sy - ah * 0.65f;
                px[3] = ax; py[3] = sy - ah;
                px[4] = ax + aw / 2; py[4] = sy - ah * 0.65f;
                px[5] = ax + sw; py[5] = sy - ah * 0.65f;
                px[6] = ax + sw; py[6] = sy;
                Ui.Poly(px, py, 7, 2 * S2 * 0.5f, Color.white);
            }
            else if (METER == 1)
            {
                float w = ph * 1.1f, x0 = sx - w / 2, y0 = sy + ph * 0.18f;
                Ui.Fill(x0 - 2 * S2, y0 - 2 * S2, w + 4 * S2, 10 * S2, new Color(0, 0, 0, 0.65f));
                Ui.Fill(x0, y0, w * pg, 6 * S2, FC);
                Ui.Fill(x0 + g0 * w, y0, (g1 - g0) * w, 6 * S2, WC);
                Ui.Fill(x0 + w * pg - 1 * S2, y0 - 3 * S2, 3 * S2, 12 * S2, Color.white);
            }
            else if (METER == 2)
            {
                if (!Pr(p.x, p.y, p.z + 92, out float hx, out float hy)) return;
                float w = (BIGM ? 96 : 60) * S2, x0 = hx - w / 2;
                Ui.Fill(x0 - 2 * S2, hy - 2 * S2, w + 4 * S2, 9 * S2, new Color(0, 0, 0, 0.65f));
                Ui.Fill(x0 + g0 * w, hy, (g1 - g0) * w, 5 * S2, GC);
                Ui.Fill(x0 + pg * w - 1 * S2, hy - 3 * S2, 3 * S2, 11 * S2, Ui.Hex("#ffd23f"));
            }
            else
            {
                float rx = ph * 0.6f, ry = ph * 0.24f, top = -1.5708f;
                Ui.Arc(sx, sy, rx, ry, 0, 6.2832f, 5 * S2 * 0.5f, new Color(0, 0, 0, 0.55f));
                Ui.Arc(sx, sy, rx, ry, top + g0 * 6.2832f, top + g1 * 6.2832f, 7 * S2 * 0.5f, WC);
                if (pg > 0) Ui.Arc(sx, sy, rx, ry, top, top + pg * 6.2832f, 4 * S2 * 0.5f, inG ? GC : CB ? FC : Ui.Hex("#ffd23f"));
            }
        }
        static Color A(Color c, float a) => Ui.A(c, a);
        /// <summary>Fill the arrow shape between fractions f0..f1 of its height (the canvas clip() of hud.ts style 0).</summary>
        static void ArrowBand(float ax, float sy, float aw, float ah, float sw, float f0, float f1, Color c)
        {
            f0 = Mathf.Clamp01(f0);
            f1 = Mathf.Clamp01(f1);
            if (f1 <= f0) return;
            const float NECK = 0.65f;
            // stem part
            float a = Mathf.Min(f1, NECK);
            if (a > f0) Ui.Fill(ax - sw, sy - ah * a, sw * 2, ah * (a - f0), c);
            // head part (triangle from the neck to the apex)
            float b0 = Mathf.Max(f0, NECK), b1 = f1;
            if (b1 > b0)
            {
                float hw0 = aw / 2 * (1 - (b0 - NECK) / (1 - NECK)), hw1 = aw / 2 * (1 - (b1 - NECK) / (1 - NECK)),
                    y0 = sy - ah * b0, y1 = sy - ah * b1;
                Ui.Quad(ax - hw0, y0, ax + hw0, y0, ax + hw1, y1, ax - hw1, y1, c);
            }
        }

        // ---------------- markers ----------------
        void OpenMark()
        {
            var o = OFFS[0];
            if (o == null || B.owner == null || B.owner.tm != 0 || B.owner == o) return;
            if (Pr(o.x, o.y, o.z + 85, out float x, out float y)) Ui.Text("▼ OPEN", x, y, 12, Ui.Hex("#2ecc71"));
        }
        void PassMark()
        {
            var p = FocusP();
            if (p == null || B.owner != p || ftq != null || inb > 0) return;
            float ax = UnityEngine.Input.GetAxisRaw("Horizontal"), ay = UnityEngine.Input.GetAxisRaw("Vertical");
            pin.dx = Mathf.Abs(ax) < 0.14f ? 0 : ax;
            pin.dy = Mathf.Abs(ay) < 0.14f ? 0 : -ay;
            var r = pick(p, pin);
            if (r == null || r == p) return;
            if (Pr(r.x, r.y, r.z + 92, out float x, out float y)) Ui.Text("▼", x, y, 14, Ui.Hex("#ffd23f"));
        }
        /// <summary>On defense: a dashed red ring under the man you're assigned to (it follows switches).</summary>
        void AssignMark()
        {
            var me = FocusP();
            if (me == null || RPL != null || B.owner == null || B.owner.tm == me.tm || !gameLike() || cfg.NP < 2) return;
            var m = me.manT > 0 && me.man != null && me.man.Value >= 0 && me.man.Value < P.Count ? P[(int)me.man.Value] : guardOf(me);
            if (m == null || Util.T(m.off)) return;
            // project the 13 px ground circle (16 points like hud.ts), drawn dashed
            int n = 0;
            for (int k = 0; k < 8; k++)
            {
                float a = k / 8f * Mathf.PI * 2;
                if (!Pr(m.x + Mathf.Cos(a) * 13, m.y + Mathf.Sin(a) * 13, 0, out px[n], out py[n])) return;
                n++;
            }
            // dashes: draw every other half-segment of the projected octagon (setLineDash 5,4 look)
            var col = new Color(1, 90 / 255f, 90 / 255f, 0.75f);
            for (int k = 0; k < n; k++)
            {
                float x0 = px[k], y0 = py[k], x1 = px[(k + 1) % n], y1 = py[(k + 1) % n];
                Ui.Line(x0, y0, Mathf.Lerp(x0, x1, 0.55f), Mathf.Lerp(y0, y1, 0.55f), 2 * Ui.s * 0.5f + 0.5f, col);
            }
        }
        string rplS;
        double rplK = -1;
        void ReplayHud()
        {
            if (RPL == null) return;
            if (RSPD != rplK) { rplK = RSPD; rplS = "● REPLAY · " + System.Math.Round(RSPD * 100) + "% speed"; }
            Ui.Text(rplS, Ui.XL(22), Ui.Y(100), 18, Ui.Hex("#ff4d4d"), -1);
        }
    }
}

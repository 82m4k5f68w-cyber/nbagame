// Menus for the Unity build (IMGUI, built from code): title / matchup screen with every mode, settings, pause and the
// final screen with the box score and player of the game. Mirrors the browser's menu() / pause / final screens.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class Menus : MonoBehaviour
    {
        public static int MyTeam = 0, Opp = 3, Diff = 1, QIdx = 1, Size = 5;
        public static bool Paused;
        static readonly double[] QL = { 120, 180, 300, 720 };
        static readonly string[] QN = { "2 MIN", "3 MIN", "5 MIN", "12 MIN" };
        static readonly string[] DN = { "ROOKIE", "PRO", "ALL-STAR", "HALL OF FAME" };
        static readonly int[] SZ = { 5, 3, 2, 1 };
        string screen = "title"; // title | settings
        Vector2 scroll;
        GUIStyle h1, h2, btn, txt, box;
        Texture2D panel;

        void Start() { setS("menu"); }

        void Update()
        {
            if (UnityEngine.Input.GetKeyDown(KeyCode.Escape) && (S == "play" || S == "pause"))
            {
                Paused = !Paused;
                setS(Paused ? "pause" : "play");
            }
        }

        void Styles()
        {
            if (h1 != null) return;
            panel = new Texture2D(1, 1);
            panel.SetPixel(0, 0, new Color(0.04f, 0.05f, 0.08f, 0.9f));
            panel.Apply();
            h1 = new GUIStyle(GUI.skin.label) { fontSize = 46, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
            h1.normal.textColor = new Color(1f, 0.82f, 0.25f);
            h2 = new GUIStyle(h1) { fontSize = 20 };
            h2.normal.textColor = Color.white;
            txt = new GUIStyle(GUI.skin.label) { fontSize = 15, alignment = TextAnchor.MiddleLeft };
            txt.normal.textColor = new Color(0.9f, 0.92f, 1f);
            btn = new GUIStyle(GUI.skin.button) { fontSize = 17, fontStyle = FontStyle.Bold, fixedHeight = 38 };
            box = new GUIStyle(GUI.skin.box);
            box.normal.background = panel;
        }

        static Color Hex(string h) => ColorUtility.TryParseHtmlString(h, out var c) ? c : Color.white;

        void OnGUI()
        {
            Styles();
            GUI.depth = -10;
            if (S == "menu") Title();
            else if (S == "pause") Pause();
            else if (S == "over") Final();
        }

        void Area(float w, float h, System.Action body)
        {
            var r = new Rect((Screen.width - w) / 2, (Screen.height - h) / 2, w, h);
            GUI.Box(r, GUIContent.none, box);
            GUILayout.BeginArea(new Rect(r.x + 24, r.y + 18, r.width - 48, r.height - 36));
            body();
            GUILayout.EndArea();
        }

        void Title()
        {
            if (screen == "settings") { Settings(); return; }
            Area(Mathf.Min(980, Screen.width - 20), Mathf.Min(640, Screen.height - 20), () =>
            {
                GUILayout.Label("HOOPS 2K27", h1);
                GUILayout.Label("UNITY EDITION", h2);
                GUILayout.Space(12);
                GUILayout.BeginHorizontal();
                TeamCard("YOU", ref MyTeam);
                GUILayout.Space(20);
                TeamCard("OPPONENT", ref Opp);
                GUILayout.EndHorizontal();
                GUILayout.Space(10);
                Row("DIFFICULTY", DN, ref Diff);
                Row("QUARTER", QN, ref QIdx);
                int si = System.Array.IndexOf(SZ, Size);
                Row("TEAM SIZE", new[] { "5v5", "3v3", "2v2", "1v1" }, ref si);
                Size = SZ[Mathf.Max(0, si)];
                GUILayout.Space(10);
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("PLAY GAME", btn)) Go("game");
                if (GUILayout.Button("STREET 21", btn)) Go("street");
                if (GUILayout.Button("CLUTCH", btn)) Go("clutch");
                if (GUILayout.Button("ALL-STAR", btn)) Go("astar");
                GUILayout.EndHorizontal();
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("PRACTICE", btn)) Go("practice");
                if (GUILayout.Button("3PT CONTEST", btn)) Go("3pt");
                if (GUILayout.Button("DUNK CONTEST", btn)) Go("dunk");
                if (GUILayout.Button("H-O-R-S-E", btn)) Go("horse");
                if (GUILayout.Button("KING OF COURT", btn)) Go("king");
                if (GUILayout.Button("DAILY", btn)) Go("daily");
                GUILayout.EndHorizontal();
                GUILayout.Space(6);
                if (GUILayout.Button("SETTINGS", btn)) screen = "settings";
            });
        }

        void TeamCard(string who, ref int t)
        {
            GUILayout.BeginVertical(GUILayout.Width(400));
            GUILayout.Label(who, h2);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("<", btn, GUILayout.Width(44))) t = (t + Data.TM.Length - 1) % Data.TM.Length;
            var tm = Data.TM[t];
            var st = new GUIStyle(h2) { fontSize = 28 };
            st.normal.textColor = Hex(tm.col) * 1.6f;
            GUILayout.Label(tm.name.ToUpperInvariant(), st, GUILayout.Width(290));
            if (GUILayout.Button(">", btn, GUILayout.Width(44))) t = (t + 1) % Data.TM.Length;
            GUILayout.EndHorizontal();
            foreach (var p in tm.ps) GUILayout.Label($"  #{p.num}  {p.n}   OVR {Data.Ov2(p)}", txt);
            GUILayout.EndVertical();
        }

        void Row(string label, string[] opts, ref int v)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(label, txt, GUILayout.Width(130));
            v = GUILayout.Toolbar(Mathf.Clamp(v, 0, opts.Length - 1), opts, GUILayout.Height(30));
            GUILayout.EndHorizontal();
        }

        void Settings()
        {
            Area(640, 460, () =>
            {
                GUILayout.Label("SETTINGS", h2);
                GUILayout.Space(8);
                GUILayout.Label("GRAPHICS", txt);
                int q = Mathf.Clamp(Arena.QL, 0, 2);
                int nq = GUILayout.Toolbar(q, new[] { "LOW", "MEDIUM", "HIGH" }, GUILayout.Height(30));
                if (nq != q) Arena.SetQuality(nq);
                Arena.FxOn = GUILayout.Toggle(Arena.FxOn, " Post-processing effects (bloom, color grade, depth of field)");
                GUILayout.Label("CAMERA  (K in game)", txt);
                CameraDirector.Mode = GUILayout.Toolbar(CameraDirector.Mode, new[] { "BROADCAST", "2K", "BASELINE", "PLAYER LOCK" }, GUILayout.Height(30));
                GUILayout.Space(6);
                cfg.FOULS = GUILayout.Toggle(cfg.FOULS != 0, " Fouls") ? 1 : 0;
                cfg.SCLK = GUILayout.Toggle(cfg.SCLK != 0, " Shot clock") ? 1 : 0;
                cfg.VIOL = GUILayout.Toggle(cfg.VIOL != 0, " Violations (3 seconds, 8 seconds, goaltending)") ? 1 : 0;
                cfg.SUBS = GUILayout.Toggle(cfg.SUBS != 0, " Fatigue + substitutions") ? 1 : 0;
                cfg.BADGES = GUILayout.Toggle(cfg.BADGES != 0, " Badges + hot zones") ? 1 : 0;
                cfg.PRO = GUILayout.Toggle(cfg.PRO != 0, " Pro Play animation") ? 1 : 0;
                GUILayout.FlexibleSpace();
                if (GUILayout.Button("BACK", btn)) screen = "title";
            });
        }

        void Go(string mode)
        {
            Paused = false;
            Modes.stopMode();
            cfg.DIFF = Diff;
            cfg.NP = Size;
            setQtrLen(QL[QIdx]);
            setCtrls(new List<Ctrl> { mkCtrl("p1", 0) });
            switch (mode)
            {
                case "street": Modes.startStreet(MyTeam, Opp, Mathf.Min(Size, 3)); break;
                case "clutch": Modes.startClutch(0, MyTeam, Opp); break;
                case "astar": Modes.startAllStar(); break;
                case "practice": Modes.startPractice(MyTeam); break;
                case "3pt": Modes.start3pt(MyTeam); break;
                case "dunk": Modes.startDunk(MyTeam); break;
                case "horse": Modes.startHorse(MyTeam, Opp); break;
                case "king": Modes.startKing(MyTeam); break;
                case "daily": Modes.startDaily(); break;
                default: start(MyTeam, new StartOpts { j = Opp == MyTeam ? (Opp + 1) % Data.TM.Length : Opp }); break;
            }
        }

        void Pause()
        {
            Area(420, 330, () =>
            {
                GUILayout.Label("PAUSED", h1);
                GUILayout.Space(10);
                if (GUILayout.Button("RESUME", btn)) { Paused = false; setS("play"); }
                if (GUILayout.Button("INSTANT REPLAY", btn)) { Paused = false; setS("play"); startReplay(); }
                if (GUILayout.Button("RESTART", btn)) Go("game");
                if (GUILayout.Button("QUIT TO MENU", btn)) { Paused = false; Modes.stopMode(); setS("menu"); }
            });
        }

        void Final()
        {
            Area(Mathf.Min(900, Screen.width - 20), Mathf.Min(560, Screen.height - 20), () =>
            {
                bool won = sc[0] > sc[1];
                GUILayout.Label(won ? "VICTORY" : sc[0] == sc[1] ? "FINAL" : "DEFEAT", h1);
                GUILayout.Label($"{cl[0]} {sc[0]:0}  —  {sc[1]:0} {cl[1]}", h2);
                // player of the game: the winners' top line (pts + reb + ast)
                Player pog = null;
                double best = -1;
                int wt = sc[0] >= sc[1] ? 0 : 1;
                foreach (var p in ROST[wt]) { double v = p.stt.pts + p.stt.reb + p.stt.ast; if (v > best) { best = v; pog = p; } }
                if (pog != null) GUILayout.Label($"PLAYER OF THE GAME: {pog.n}  ·  {pog.stt.pts:0} PTS  {pog.stt.reb:0} REB  {pog.stt.ast:0} AST", h2);
                scroll = GUILayout.BeginScrollView(scroll, GUILayout.Height(260));
                for (int t = 0; t < 2; t++)
                {
                    GUILayout.Label((cl[t] ?? "").ToUpperInvariant(), txt);
                    foreach (var p in ROST[t])
                        GUILayout.Label($"   {p.n,-20} {p.stt.pts,3:0} PTS  {p.stt.reb,2:0} REB  {p.stt.ast,2:0} AST  {p.stt.fgm:0}-{p.stt.fga:0} FG  {p.stt.tpm:0}-{p.stt.tpa:0} 3P  {p.stt.blk:0} BLK", txt);
                }
                GUILayout.EndScrollView();
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("REMATCH", btn)) Go("game");
                if (GUILayout.Button("MENU", btn)) { Modes.stopMode(); setS("menu"); }
                GUILayout.EndHorizontal();
            });
        }
    }
}

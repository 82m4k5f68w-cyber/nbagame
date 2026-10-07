// Bridge to the HTML menus of the WebGL template (Assets/WebGLTemplates/Hoops, TemplateData/ui.js): the page draws the
// hub, matchup screen, settings, pause and final screens over the Unity canvas; Unity plays the game underneath.
//   page -> Unity: unityInstance.SendMessage("Hoops2K27", "FromPage", json)   (this component sits on GameMain's object)
//     {cmd:"start", mode, arg, np, sel, opp, diff, ql, set:{k:v}, rec:{w,l}} | resume | pause | quit | rematch | replay |
//     online | {cmd:"setting", k, v}
//   Unity -> page: HoopsUi_Show(screen, json) (Assets/Plugins/WebGL/HoopsUi.jslib): "ready", "menu", "pause", "final".
// Outside WebGL (or on a page without the template) Active stays false and Menus.cs draws its IMGUI screens.
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Hoops.Core;
using Hoops.Game.Net;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class PageBridge : MonoBehaviour
    {
        /// <summary>The page draws the menus (WebGL build with the Hoops template).</summary>
        public static bool Active;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int HoopsUi_Has();
        [DllImport("__Internal")] static extern void HoopsUi_Show(string screen, string json);
#else
        static int HoopsUi_Has() => 0;
        static void HoopsUi_Show(string screen, string json) { }
#endif
        string lastS, lastMode = "game";
        int lastArg;
        float overAt = -1, resumeT = -9;
        bool finalSent, lobbyWas;

        void Awake()
        {
            try { Active = HoopsUi_Has() != 0; } catch { Active = false; }
#if UNITY_WEBGL && !UNITY_EDITOR
            // the page has its own inputs and key handling: Unity must not swallow every key event
            if (Active) WebGLInput.captureAllKeyboardInput = false;
#endif
        }

        void Start()
        {
            if (Active) Show("ready", "{}");
        }

        static void Show(string screen, string json)
        {
            try { HoopsUi_Show(screen, json); } catch { }
        }

        void Update()
        {
            if (!Active) return;
            bool esc = UnityEngine.Input.GetKeyDown(KeyCode.Escape) || UnityEngine.Input.GetKeyDown(KeyCode.P) || UnityEngine.Input.GetKeyDown(KeyCode.JoystickButton9);
            // (a resume from the page's Esc handler must not pause again on the same key press)
            if (esc && S == "play" && RPL == null && !NetHooks.Online && Time.unscaledTime - resumeT > 0.3f) Pause();
            if (S != lastS)
            {
                if (S == "over" && !NetHooks.Online)
                {
                    overAt = Time.unscaledTime + (cfg.GM == "game" ? 4f : 1.2f); // let the confetti fall first (game.ts)
                    finalSent = false;
                }
                if (S == "menu" && lastS != null && !NetHooks.LobbyOpen) Show("menu", "{}");
                lastS = S;
            }
            if (S == "over" && !finalSent && overAt >= 0 && Time.unscaledTime >= overAt && RPL == null && !NetHooks.Online)
            {
                finalSent = true;
                Show("final", FinalJson());
            }
            // the online lobby (NetLobby IMGUI) closed without starting a game: back to the page's menu
            bool lob = NetHooks.LobbyOpen;
            if (lobbyWas && !lob && S == "menu") Show("menu", "{}");
            lobbyWas = lob;
        }

        void Pause()
        {
            Menus.Paused = true;
            setS("pause");
            Show("pause", PauseJson());
        }

        // ------------------------------------------------------------------ page -> Unity
        public void FromPage(string json)
        {
            if (!Json.TryParse(json, out var v) || !(v is Dictionary<string, object> o)) return;
            switch (o.Str("cmd"))
            {
                case "start":
                    if (o.Obj("set") is Dictionary<string, object> set) foreach (var kv in set) Apply(kv.Key, Json.D(kv.Value));
                    if (o.Obj("rec") is Dictionary<string, object> rc)
                    {
                        try { PlayerPrefs.SetInt("h2k_rec_w", (int)rc.Num("w")); PlayerPrefs.SetInt("h2k_rec_l", (int)rc.Num("l")); } catch { }
                    }
                    Menus.Size = Mathf.Clamp((int)o.Num("np", 5), 1, 5);
                    cfg.NP = Menus.Size; // nChoices() below reads the menu's team size
                    int n = nChoices();
                    Menus.MyTeam = Mathf.Clamp((int)o.Num("sel"), 0, n - 1);
                    int opp = (int)o.Num("opp", -1);
                    Menus.Opp = opp >= 0 && opp < n ? opp : -1;
                    Menus.Diff = Mathf.Clamp((int)o.Num("diff", Menus.Diff), 0, 3);
                    double ql = o.Num("ql");
                    if (ql > 0) Menus.QLen = ql;
                    lastMode = Mode(o.Str("mode"));
                    lastArg = (int)o.Num("arg");
                    Begin();
                    break;
                case "rematch": Begin(); break;
                case "resume":
                    if (S == "pause") { Menus.Paused = false; setS("play"); }
                    resumeT = Time.unscaledTime;
                    break;
                case "pause":
                    if (S == "play" && RPL == null && !NetHooks.Online) Pause();
                    break;
                case "replay":
                    Menus.Paused = false;
                    if (S == "pause") setS("play");
                    resumeT = Time.unscaledTime;
                    startReplay();
                    break;
                case "quit":
                    Menus.Paused = false;
                    Modes.stopMode();
                    setS("menu");
                    lastS = "menu"; // the page already shows its menu
                    break;
                case "online": NetHooks.OpenLobby(); lobbyWas = true; break;
                case "setting": Apply(o.Str("k"), o.Num("v")); break;
            }
        }

        void Begin()
        {
            finalSent = false;
            overAt = -1;
            resumeT = Time.unscaledTime;
            Menus.Go(lastMode, lastArg);
            lastS = S;
        }

        /// <summary>Page mode names (modesui.ts MODES) -> Menus.Go names.</summary>
        static string Mode(string m) => m switch
        {
            null => "game",
            "street" => "street1",
            "allstar" => "astar",
            _ => m,
        };

        /// <summary>One setting, keyed like the browser menu's data- attributes (game.ts menu / h2k_set).</summary>
        public static void Apply(string k, double v)
        {
            int i = (int)v;
            bool on = v != 0;
            switch (k)
            {
                case "m": Hud.METER = i & 3; try { PlayerPrefs.SetInt("h2k_meter", Hud.METER); } catch { } break;
                case "s":
                    Menus.Tempo = i;
                    foreach (var c in CT) c.tempo = i;
                    break;
                case "p": cfg.PRO = i; break;
                case "cm": CameraDirector.Mode = Mathf.Clamp(i, 0, 3); try { PlayerPrefs.SetInt("h2k_cam", CameraDirector.Mode); } catch { } break;
                case "q": Arena.SetQuality(Mathf.Clamp(i, 0, 2)); break;
                case "fx": Arena.FxOn = on; break;
                case "df": Menus.Diff = Mathf.Clamp(i, 0, 3); cfg.DIFF = Menus.Diff; break;
                case "rf": cfg.FOULS = i; break;
                case "rc": cfg.SCLK = i; break;
                case "rv": cfg.VIOL = i; break;
                case "rs": cfg.SUBS = i; break;
                case "rb": cfg.BADGES = i; break;
                case "cmt": Broadcast.COMM = i > 0; Broadcast.VOICE = i == 2; Prefs("h2k_comm", i > 0); Prefs("h2k_voice", i == 2); break;
                case "pi": Broadcast.INTRO = on; Prefs("h2k_intro", on); break;
                case "mu": Music.On = on; Prefs("h2k_music", on); break;
                case "ru": Broadcast.RUMBLE = on; Prefs("h2k_rumble", on); break;
                case "cb": Hud.CB = on; Prefs("h2k_cb", on); break;
                case "bm": Hud.BIGM = on; Prefs("h2k_bigm", on); break;
                // audio sliders 0..100
                case "vm": AudioListener.volume = Mathf.Clamp01((float)v / 100f); break;
                case "vu": Music.Volume = Mathf.Clamp01((float)v / 100f); break;
                case "vc": GameAudio.CrowdVol = Mathf.Clamp01((float)v / 100f); break;
                case "vv": Broadcast.VoiceVol = Mathf.Clamp01((float)v / 100f); break;
            }
        }
        static void Prefs(string k, bool v)
        {
            try { PlayerPrefs.SetInt(k, v ? 1 : 0); } catch { }
        }

        // ------------------------------------------------------------------ Unity -> page payloads
        static string PauseJson()
        {
            var o = Head();
            o["q"] = q;
            o["box"] = Box();
            return Json.Write(o);
        }

        static Dictionary<string, object> Head() => new Dictionary<string, object>
        {
            ["sc"] = new List<object> { sc[0], sc[1] },
            ["cl"] = new List<object> { cl[0] ?? "", cl[1] ?? "" },
            ["pc"] = new List<object> { PC[0] ?? "#7b3fb5", PC[1] ?? "#1d428a" },
            ["gm"] = cfg.GM,
            ["np"] = cfg.NP,
            ["cm"] = CameraDirector.Mode,
            ["m"] = Hud.METER,
            ["s"] = Menus.Tempo,
            ["fx"] = Arena.FxOn ? 1 : 0,
        };

        /// <summary>Box score per team over ROST (benched players keep their lines), like game.ts endGame tm().</summary>
        static List<object> Box()
        {
            var box = new List<object>();
            for (int t = 0; t < 2; t++)
            {
                var l = new List<object>();
                IEnumerable<Player> ps = ROST != null && ROST[t] != null && ROST[t].Count > 0 ? ROST[t] : null;
                if (ps == null)
                {
                    var tmp = new List<Player>();
                    foreach (var p in P) if (p.tm == t) tmp.Add(p);
                    ps = tmp;
                }
                foreach (var p in ps)
                {
                    var s = p.stt;
                    l.Add(new Dictionary<string, object>
                    {
                        ["n"] = p.n ?? "", ["pts"] = s.pts, ["reb"] = s.reb, ["ast"] = s.ast, ["fgm"] = s.fgm, ["fga"] = s.fga, ["tpm"] = s.tpm, ["tpa"] = s.tpa,
                        ["blk"] = s.blk, ["orb"] = s.orb, ["pf"] = p.pf, ["fo"] = p.fo, ["hus"] = s.chg + s.dv + s.sa,
                        ["sk"] = p.skin ?? "#c68642", ["hr"] = p.hr, ["bd"] = p.bd, ["no"] = p.no, ["col"] = p.col ?? "",
                        ["on"] = P.Contains(p) && p.off == 0 ? 1 : 0,
                    });
                }
                box.Add(l);
            }
            return box;
        }

        static string FinalJson()
        {
            var o = Head();
            int me = CT.Count > 0 ? (int)CT[0].tm : 0;
            o["me"] = me;
            o["q"] = q;
            o["box"] = Box();
            o["xs"] = new Dictionary<string, object> { ["paint"] = TS.xs.paint, ["fb"] = TS.xs.fb, ["sec"] = TS.xs.sec };
            var qs = new List<object>();
            foreach (var a in TS.qs) qs.Add(a);
            o["qs"] = qs;
            var shots = new List<object>();
            foreach (var s in SHOTS) shots.Add(new double[] { s.t, System.Math.Round(s.x), System.Math.Round(s.y), s.m, s.q });
            o["shots"] = shots;
            o["hx"] = new List<object> { hoop(0), hoop(1) };
            return Json.Write(o);
        }
    }
}

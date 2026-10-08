// Online play for the Unity build (port of src/client/net/session.ts): lobby (create / join by code, sides, teams,
// team size, quarter length, Pro Play, ready-up, tournament), host & guest wiring into GameMain's loop (NetHooks),
// connection HUD (ping, jitter, loss, link DIRECT / RELAY, warning when bad), quick chat (keys 1-6), online final
// screen (rematch votes / tournament), host migration (a guest takes over when the host leaves mid-game).
// Minimal IMGUI. Open with F2 or the ONLINE button on the title screen. Backends: the claude.ai room (published
// WebGL build), a relay (?ws=... / the page's own /ws, or the URL typed in the Editor), WebRTC direct path on top.
using System;
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game.Net
{
    /// <summary>The few lines GameMain calls (keeps the shared loop file untouched otherwise).</summary>
    public static class NetHooks
    {
        internal static NetLobby L;
        /// <summary>An online session is open (lobby or game).</summary>
        public static bool Online => L != null && L.role != null;
        public static string Role => L?.role;
        /// <summary>Guest: run the frame (prediction + interpolation) instead of the sim. True = handled, skip upd.</summary>
        public static bool GuestFrame(float dt, Func<Ctrl, Hoops.Core.Input> read)
        {
            if (L == null || L.role != "guest") return false;
            L.GuestFrame(dt, read);
            return true;
        }
        /// <summary>Host: after every sim tick (publish snapshots, collect events).</summary>
        public static void AfterTick() => L?.host?.Tick();
        /// <summary>WebGL template menus (PageBridge): open the lobby / is it open.</summary>
        public static void OpenLobby() { if (L != null && L.role == null) L.LobbyScreen = "menu"; }
        public static bool LobbyOpen => L != null && L.LobbyScreen != null;
    }

    public sealed class NetLobby : MonoBehaviour
    {
        internal string role; // null | "host" | "guest"
        internal HostSession host;
        GuestSession guest;
        ITransport t;
        string screen; // null (closed) | "menu" | "lobby"
        internal string LobbyScreen { get => screen; set => screen = value; }
        string code = "", joinCode = "", name, err = "", wsUrl = "ws://localhost:8787/ws", kind;
        Func<Ctrl, Hoops.Core.Input> prevInput;
        GUIStyle h1, h2, txt, btn, small;
        Texture2D panel, white;
        readonly List<(string who, int k, float t)> bub = new List<(string, int, float)>();
        float t0, migratingT;
        bool voted;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (FindAnyObjectByType<NetLobby>() == null) new GameObject("HoopsNet").AddComponent<NetLobby>();
        }

        void Awake()
        {
            NetHooks.L = this;
            name = PlayerPrefs.GetString("h2k_name", "Player" + UnityEngine.Random.Range(10, 99));
            joinCode = PlayerPrefs.GetString("h2k_last", "");
            if (!JsBridge.WebGL) wsUrl = PlayerPrefs.GetString("h2k_ws", wsUrl);
            else { var u = JsBridge.PageWsUrl(); if (!string.IsNullOrEmpty(u)) wsUrl = u; }
            NetOpts.Direct = NetOpts.Direct && JsBridge.WebGL && JsBridge.HasRtc;
        }

        static string Tok()
        {
            var t = PlayerPrefs.GetString("h2k_tok", "");
            if (t == "") { t = Guid.NewGuid().ToString("N").Substring(0, 10); PlayerPrefs.SetString("h2k_tok", t); }
            return t;
        }
        static double Elo() => PlayerPrefs.GetInt("h2k_elo", 1000);
        static string NewCode()
        {
            const string A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
            var c = new char[4];
            for (int i = 0; i < 4; i++) c[i] = A[UnityEngine.Random.Range(0, A.Length)];
            return new string(c);
        }

        // ---------------- connect ----------------
        ITransport Connect(string c)
        {
            string room = "h2k-" + c.ToLowerInvariant();
            ITransport b;
            if (kind == "room")
            {
                b = new RoomTransport(new JsRoomConn(room), (ok, fail) =>
                {
                    var nc = new JsRoomConn(room);
                    nc.onJoined = () => ok(nc);
                    nc.onFail = fail;
                }) { log = m => Debug.LogWarning(m) };
            }
            else
            {
                string url = wsUrl;
                b = new WsTransport(url, room, u => JsBridge.WebGL ? (IWsSocket)new JsWsSocket(u) : new DotNetWsSocket(u)).Connect();
            }
            if (NetOpts.Direct) b = new RtcTransport(b, () => new JsRtcLink());
            return b;
        }

        void Create()
        {
            Save();
            code = NewCode();
            t = Connect(code);
            host = new HostSession(t, new HostMe { n = HostSession.Clean(name), tok = Tok(), tm = 0, play = true, elo = Elo() }, cfg.NP, cfg.PRO, 60, code);
            host.onChat = OnChat;
            role = "host";
            screen = "lobby";
            setS("lobby");
        }

        void Join(string c)
        {
            Save();
            code = c;
            PlayerPrefs.SetString("h2k_last", c);
            t = Connect(c);
            StartGuest(new GuestSession(t, new GuestMe { n = HostSession.Clean(name), tok = Tok(), code = c, elo = Elo() }));
            t0 = Time.realtimeSinceStartup;
        }

        void StartGuest(GuestSession g)
        {
            guest = g;
            role = "guest";
            screen = "lobby";
            setS("lobby");
            guest.onChat = OnChat;
            guest.onStart = () => { screen = null; voted = false; };
            guest.onFx = f =>
            {
                FX.Add(f);
                if (FX.Count > 64) FX.RemoveAt(0); // same cap as the sim's own emitter
            };
        }

        void Save()
        {
            PlayerPrefs.SetString("h2k_name", name);
            if (!JsBridge.WebGL) PlayerPrefs.SetString("h2k_ws", wsUrl);
        }

        void Leave()
        {
            host?.Close();
            guest?.Close();
            t?.Leave();
            host = null;
            guest = null;
            t = null;
            role = null;
            screen = null;
            if (prevInput != null) { cfg.input = prevInput; prevInput = null; }
            cfg.ONLINE = 0;
            setS("menu");
        }

        void HostInput()
        {
            if (prevInput == null) prevInput = cfg.input;
            var local = prevInput;
            cfg.input = c => host != null && host.IsRemote(c) ? host.RemoteInput(c) : local(c);
        }

        void StartHostGame(Action go)
        {
            HostInput();
            go();
            screen = null;
            voted = false;
        }

        void OnChat(string who, int k)
        {
            bub.Add((who, k, 3f));
            if (bub.Count > 5) bub.RemoveAt(0);
        }

        // ---------------- per frame ----------------
        void Update()
        {
            if (UnityEngine.Input.GetKeyDown(KeyCode.F2) && role == null) screen = screen == null ? "menu" : null;
            if (screen == "menu" && kind == null) kind = JsBridge.WebGL ? JsBridge.Detect() : "ws";
            JsBridge.Poll();
            if (role == null) return;
            Application.runInBackground = true; // a host in a background tab keeps the game going
            t?.Poll();
            host?.Poll();
            // no pausing an online game (the sim is everybody's)
            if (S == "pause") { Menus.Paused = false; setS("play"); }
            if (host != null && host.L.st == "lobby" && S != "lobby") setS("lobby");
            if (guest != null && (guest.L == null || guest.L.st == "lobby") && S == "menu") setS("lobby");
            // host migration lite: the host left mid-game and I am the longest-seated guest -> take over
            if (guest != null && guest.ShouldMigrate())
            {
                host = HostSession.TakeOver(guest, new HostMe { n = HostSession.Clean(name), tok = Tok(), elo = Elo() });
                host.onChat = OnChat;
                guest = null;
                role = "host";
                HostInput();
                migratingT = 3;
            }
            if ((S == "play" || S == "over") && !GUIUtility.hasModalWindow)
                for (int k = 0; k < 6; k++)
                    if (UnityEngine.Input.GetKeyDown(KeyCode.Alpha1 + k))
                    {
                        if (host != null) host.Chat("host", k);
                        else guest?.Chat(k);
                    }
            for (int i = bub.Count - 1; i >= 0; i--)
            {
                var b = bub[i];
                b.t -= Time.unscaledDeltaTime;
                if (b.t <= 0) bub.RemoveAt(i); else bub[i] = b;
            }
            migratingT = Mathf.Max(0, migratingT - Time.unscaledDeltaTime);
        }

        internal void GuestFrame(float dt, Func<Ctrl, Hoops.Core.Input> read)
        {
            if (guest == null) return;
            guest.tempo = 0;
            guest.Frame(dt, () => read(null));
            if (S != "play" && S != "over" && RPL == null && guest.L != null && guest.L.st != "lobby") setT(T + dt);
        }

        // ---------------- UI ----------------
        void Styles()
        {
            if (h1 != null) return;
            panel = new Texture2D(1, 1);
            panel.SetPixel(0, 0, new Color(0.04f, 0.05f, 0.09f, 0.94f));
            panel.Apply();
            white = Texture2D.whiteTexture;
            h1 = new GUIStyle(GUI.skin.label) { fontSize = 34, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
            h1.normal.textColor = new Color(1f, 0.82f, 0.25f);
            h2 = new GUIStyle(GUI.skin.label) { fontSize = 16, fontStyle = FontStyle.Bold };
            h2.normal.textColor = Color.white;
            txt = new GUIStyle(GUI.skin.label) { fontSize = 14, wordWrap = true };
            txt.normal.textColor = new Color(0.88f, 0.9f, 1f);
            small = new GUIStyle(txt) { fontSize = 12, alignment = TextAnchor.UpperRight, fontStyle = FontStyle.Bold, wordWrap = false };
            btn = new GUIStyle(GUI.skin.button) { fontSize = 15, fontStyle = FontStyle.Bold, fixedHeight = 32 };
        }

        void OnGUI()
        {
            Styles();
            GUI.depth = -20; // above Menus (-10)
            if (role == null && S == "menu" && screen == null)
            {
                if (GUI.Button(new Rect(Screen.width - 130, Screen.height - 48, 120, 36), "ONLINE (F2)", btn)) screen = "menu";
                return;
            }
            if (screen == "menu" && role == null) { Panel(OnlineMenu); return; }
            if (role == null) return;
            if (host != null && host.L.st == "lobby") { Panel(HostLobby); return; }
            if (guest != null && (guest.L == null || guest.L.st == "lobby")) { Panel(GuestLobby); return; }
            Hud();
            if (S == "over") GUI.ModalWindow(77, new Rect(Screen.width / 2 - 230, Screen.height - 230, 460, 200), FinalWin, "ONLINE");
        }

        void Panel(Action body)
        {
            float w = Mathf.Min(720, Screen.width - 20), h = Mathf.Min(620, Screen.height - 20);
            var r = new Rect((Screen.width - w) / 2, (Screen.height - h) / 2, w, h);
            GUI.DrawTexture(new Rect(0, 0, Screen.width, Screen.height), panel);
            GUILayout.BeginArea(r);
            body();
            GUILayout.EndArea();
        }

        void OnlineMenu()
        {
            GUILayout.Label("PLAY ONLINE", h1);
            GUILayout.Label(kind == null ? "Looking for a live room…" : kind == "room" ? "LIVE ROOM · friends on this page join with your code" : kind == "ws" ? "HOOPS SERVER" : "OFFLINE", h2);
            GUILayout.Space(8);
            GUILayout.BeginHorizontal();
            GUILayout.Label("YOUR NAME", h2, GUILayout.Width(140));
            name = GUILayout.TextField(name ?? "", 14, GUILayout.Width(220));
            GUILayout.EndHorizontal();
            if (!JsBridge.WebGL || kind == "ws")
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label("RELAY", h2, GUILayout.Width(140));
                if (JsBridge.WebGL) GUILayout.Label(wsUrl, txt);
                else wsUrl = GUILayout.TextField(wsUrl, 120, GUILayout.Width(380));
                GUILayout.EndHorizontal();
            }
            GUILayout.Space(10);
            if (kind == "room" || kind == "ws")
            {
                if (GUILayout.Button($"Create game ({(cfg.NP > 1 ? cfg.NP + "v" + cfg.NP : "1v1")})", btn)) Try(Create);
                GUILayout.Space(6);
                GUILayout.BeginHorizontal();
                GUILayout.Label("JOIN A FRIEND", h2, GUILayout.Width(140));
                joinCode = GUILayout.TextField(joinCode ?? "", 4, GUILayout.Width(90)).ToUpperInvariant();
                if (GUILayout.Button("Join", btn, GUILayout.Width(100)))
                {
                    var c = System.Text.RegularExpressions.Regex.Replace(joinCode, "[^A-Z]", "");
                    if (c.Length != 4) err = "Enter the 4-letter code";
                    else Try(() => Join(c));
                }
                GUILayout.EndHorizontal();
                GUILayout.Label("Host plays on this device and runs the game; friends join with the 4-letter code. Up to 2 humans per side in 5v5 (AI fills the rest), everyone in 3v3 / 2v2, 1 per side in 1v1 (3-4 friends: tournament).", txt);
            }
            else if (kind == "")
                GUILayout.Label("Online play works on the published Hoops 2K27 page on claude.ai, or with a Hoops relay server (npm run server, then open the page with ?ws=ws://HOST:8787/ws).", txt);
            GUI.contentColor = new Color(1f, 0.6f, 0.4f);
            GUILayout.Label(err, txt);
            GUI.contentColor = Color.white;
            if (GUILayout.Button("◀ Back", btn)) { screen = null; err = ""; }
        }

        void Try(Action a)
        {
            try { a(); err = ""; }
            catch (Exception e) { err = e.Message; Leave(); screen = "menu"; }
        }

        static string TeamName(int np, int i) => np > 1 ? (i >= 0 && i < Data.TM.Length ? Data.TM[i].name : "?") : (i >= 0 && i < ALL.Count ? ALL[i].a.n : "?");
        static int Choices(int np) => np > 1 ? Data.TM.Length : ALL.Count;

        void Slots(Lobby L, string me)
        {
            GUILayout.BeginHorizontal();
            for (int tm = 0; tm < 2; tm++)
            {
                GUILayout.BeginVertical(GUILayout.Width(330));
                GUILayout.Label((tm == 0 ? "HOME · " : "AWAY · ") + TeamName(L.np, L.teams[tm]), h2);
                int n = 0;
                foreach (var s in L.slots)
                {
                    if (s.tm != tm) continue;
                    n++;
                    string who = s.n + (s.id == "host" ? " (host)" : s.id == me ? " (you)" : "") + $"  ★{s.elo:0}";
                    string st = s.on != 0 ? (s.rdy != 0 || s.id == "host" ? "READY" : "…") : "OFFLINE";
                    string link = host != null && s.id != "host" && t is ILinkInfo li ? " · " + li.LinkOf(s.id) + " " + host.GuestPing(s.id).ToString("0") + "ms" : "";
                    GUILayout.Label($"{who}   {st}{link}", txt);
                }
                if (n == 0) GUILayout.Label("AI", txt);
                GUILayout.EndVertical();
            }
            GUILayout.EndHorizontal();
        }

        bool Opt(string label, bool on) => GUILayout.Button(on ? "● " + label : label, btn);

        void HostLobby()
        {
            var L = host.L;
            GUILayout.Label("GAME " + code, h1);
            GUILayout.BeginHorizontal();
            GUILayout.Label("SHARE THIS CODE · friends pick PLAY ONLINE → JOIN", txt);
            if (GUILayout.Button("Copy code", btn, GUILayout.Width(120))) GUIUtility.systemCopyBuffer = code;
            GUILayout.EndHorizontal();
            Slots(L, "host");
            var watch = new List<string>();
            foreach (var id in host.GuestIds())
            {
                var st = host.GuestState(id);
                if (st != null && st.Num("tm", -2) == -1) watch.Add(HostSession.Clean(st.Get("n")));
            }
            if (watch.Count > 0) GUILayout.Label("Watching: " + string.Join(", ", watch), txt);
            var me = L.Find("host");
            GUILayout.BeginHorizontal();
            GUILayout.Label("YOUR SIDE", h2, GUILayout.Width(120));
            if (Opt("Home", me != null && me.tm == 0)) host.SetSide(0);
            if (Opt("Away", me != null && me.tm == 1)) host.SetSide(1);
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            GUILayout.Label(L.np > 1 ? "TEAMS" : "PLAYERS", h2, GUILayout.Width(120));
            int n = Choices(L.np);
            if (GUILayout.Button("◀", btn, GUILayout.Width(32))) host.SetTeams((L.teams[0] + n - 1) % n, L.teams[1]);
            GUILayout.Label(TeamName(L.np, L.teams[0]), h2, GUILayout.Width(120));
            if (GUILayout.Button("▶", btn, GUILayout.Width(32))) host.SetTeams((L.teams[0] + 1) % n, L.teams[1]);
            GUILayout.Label("vs", h2, GUILayout.Width(26));
            if (GUILayout.Button("◀", btn, GUILayout.Width(32))) host.SetTeams(L.teams[0], (L.teams[1] + n - 1) % n);
            GUILayout.Label(TeamName(L.np, L.teams[1]), h2, GUILayout.Width(120));
            if (GUILayout.Button("▶", btn, GUILayout.Width(32))) host.SetTeams(L.teams[0], (L.teams[1] + 1) % n);
            GUILayout.EndHorizontal();
            if (L.np > 1)
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label("TEAM SIZE", h2, GUILayout.Width(120));
                foreach (var s in new[] { 5, 3, 2 }) if (Opt(s + "v" + s, L.np == s)) host.SetOpt("np", s);
                GUILayout.EndHorizontal();
            }
            GUILayout.BeginHorizontal();
            GUILayout.Label("QUARTER", h2, GUILayout.Width(120));
            foreach (var q in new[] { 30, 60, 120 }) if (Opt(q + "s", L.ql == q)) host.SetOpt("ql", q);
            GUILayout.Label("PRO PLAY", h2, GUILayout.Width(90));
            if (Opt("On", L.pro != 0)) host.SetOpt("pro", 1);
            if (Opt("Off", L.pro == 0)) host.SetOpt("pro", 0);
            GUILayout.EndHorizontal();
            GUILayout.Space(6);
            bool ok = host.CanStart();
            GUI.enabled = ok;
            if (GUILayout.Button(ok ? "START GAME ▶" : "WAITING FOR READY…", btn)) StartHostGame(() => host.Start(0));
            GUI.enabled = true;
            if (L.np == 1 && host.GuestCount >= 1 && GUILayout.Button("Start a tournament (everyone here, 1v1 bracket)", btn))
                StartHostGame(() => { if (!host.TourStart(0)) err = "A tournament needs at least 2 players"; });
            GUILayout.Label("Quick chat in game: keys 1–6 (" + string.Join(" · ", HostSession.CHAT) + ")", txt);
            GUILayout.Label(err, txt);
            if (GUILayout.Button("Leave", btn)) Leave();
        }

        void GuestLobby()
        {
            var L = guest.L;
            if (L == null)
            {
                GUILayout.Label("JOINING " + code, h1);
                GUILayout.Label(t != null && !t.Connected() ? "Connecting…" : "Looking for the host…", h2);
                if (Time.realtimeSinceStartup - t0 > 6) GUILayout.Label($"No game {code} found yet — check the code, or wait for the host.", txt);
                if (GUILayout.Button("Cancel", btn)) Leave();
                return;
            }
            Slot hs = L.Find("host");
            GUILayout.Label("GAME " + L.code, h1);
            GUILayout.Label($"{(L.np > 1 ? L.np + "V" + L.np : "1V1")} · {L.ql}s QUARTERS · HOSTED BY {(hs != null ? hs.n : L.ded != 0 ? "SERVER" : "HOST")}", h2);
            Slots(L, t.Me);
            Slot mine = L.Find(t.Me);
            GUILayout.BeginHorizontal();
            GUILayout.Label("PICK A SIDE", h2, GUILayout.Width(120));
            if (Opt("Home", mine != null && mine.tm == 0)) guest.SetSide(0);
            if (Opt("Away", mine != null && mine.tm == 1)) guest.SetSide(1);
            if (Opt("Watch", guest.side == -1)) guest.SetSide(-1);
            GUILayout.EndHorizontal();
            GUILayout.Label("Ping " + (guest.rtt > 0 ? guest.rtt.ToString("0") + " ms" : "measuring…") + (t is ILinkInfo li && guest.HostId != null ? " · " + li.LinkOf(guest.HostId) : ""), txt);
            GUI.enabled = mine != null;
            if (GUILayout.Button(guest.rdy != 0 ? "READY ✓ (tap to cancel)" : "READY UP", btn)) guest.SetReady(guest.rdy != 0 ? 0 : 1);
            GUI.enabled = true;
            GUILayout.Label(L.ded != 0 ? "Dedicated server: the game starts when every seated player is ready." : "The host starts the game when everyone is ready.", txt);
            if (GUILayout.Button("Leave", btn)) Leave();
        }

        /// <summary>Connection strip (top right): role, code, ping, jitter, loss, link, signal bars, warning when bad.</summary>
        void Hud()
        {
            if (t == null) return;
            double ping = 0, jit = 0, loss = 0;
            string link = "RELAY";
            string s;
            var li = t as ILinkInfo;
            if (host != null)
            {
                var parts = new List<string>();
                foreach (var id in host.GuestIds())
                {
                    double p = host.GuestPing(id);
                    ping = Math.Max(ping, p);
                    var q = host.GuestQuality(id);
                    if (q != null && q.Length >= 2) { loss = Math.Max(loss, q[0]); jit = Math.Max(jit, q[1]); }
                    var slot = host.L.Find(id);
                    parts.Add($"{(slot != null ? slot.n : "Fan")} {(p > 0 ? p.ToString("0") + "ms" : "…")} {(li != null ? li.LinkOf(id) : "RELAY")}");
                }
                link = li != null && li.AllDirect() ? "DIRECT" : "RELAY";
                s = $"HOST · {code} · " + string.Join(" · ", parts);
            }
            else
            {
                ping = guest.rtt;
                jit = guest.JitterMs;
                loss = guest.LossPct;
                link = li != null && guest.HostId != null ? li.LinkOf(guest.HostId) : "RELAY";
                s = $"ONLINE · {code} · {(ping > 0 ? ping.ToString("0") : "…")} ms · jitter {jit:0} ms · loss {loss:0.#}% · {link} · buffer {guest.D * 1000 / 60:0} ms{(guest.side == -1 ? " · WATCHING" : "")}";
            }
            bool up = t.Connected();
            bool bad = !up || ping > 200 || loss > 5 || jit > 50;
            if (bad) s = "⚠ " + s;
            float w = small.CalcSize(new GUIContent(s)).x;
            float x = Screen.width - w - 46, y = 74;
            GUI.color = new Color(0, 0, 0, 0.55f);
            GUI.DrawTexture(new Rect(x - 6, y - 2, w + 50, 20), white);
            GUI.color = Color.white;
            small.normal.textColor = !up ? new Color(1f, 0.42f, 0.29f) : bad ? new Color(1f, 0.82f, 0.25f) : new Color(0.91f, 0.93f, 0.99f);
            GUI.Label(new Rect(x + 24, y, w + 10, 18), s, small);
            int bars = !up ? 0 : ping == 0 ? 2 : ping < 80 ? 4 : ping < 160 ? 3 : ping < 260 ? 2 : 1;
            if (loss > 5) bars = Math.Min(bars, 2);
            var bc = bars >= 4 ? new Color(0.18f, 0.8f, 0.44f) : bars == 3 ? new Color(1f, 0.82f, 0.25f) : new Color(1f, 0.42f, 0.29f);
            for (int i = 0; i < 4; i++)
            {
                GUI.color = i < bars ? bc : new Color(1, 1, 1, 0.2f);
                GUI.DrawTexture(new Rect(x + i * 5, y + 14 - 4 - i * 3, 3, 4 + i * 3), white);
            }
            GUI.color = Color.white;
            // quick-chat feed
            for (int i = 0; i < bub.Count; i++)
            {
                var b = bub[i];
                var L = host != null ? host.L : guest?.L;
                var slot = L?.Find(b.who);
                GUI.color = new Color(1, 1, 1, Mathf.Min(1, b.t * 2));
                GUI.Label(new Rect(14, 120 + i * 20, 500, 20), (slot != null ? slot.n : "Fan") + ": " + (b.k >= 0 && b.k < HostSession.CHAT.Length ? HostSession.CHAT[b.k] : ""), h2);
            }
            GUI.color = Color.white;
            mid ??= new GUIStyle(h1) { fontSize = 22 };
            if (!up)
            {
                mid.normal.textColor = new Color(1f, 0.6f, 0.4f);
                GUI.Label(new Rect(0, Screen.height * 0.45f, Screen.width, 30), "CONNECTION LOST — RECONNECTING…", mid);
                GUI.Label(new Rect(0, Screen.height * 0.45f + 30, Screen.width, 24), host != null ? "Your friends see the game paused; it carries on as soon as you're back" : "The AI plays your seat until you're back", txt);
            }
            else if (migratingT > 0)
                GUI.Label(new Rect(0, Screen.height * 0.45f, Screen.width, 30), "HOST LEFT — YOU ARE HOSTING NOW", mid);
            else if (guest != null && (guest.stall != 0 || guest.hostGoneAt != 0))
                GUI.Label(new Rect(0, Screen.height * 0.45f, Screen.width, 30), guest.hostGoneAt != 0 ? (NetOpts.Migration ? "HOST LEFT — MOVING THE GAME…" : "HOST LEFT THE GAME") : "WAITING FOR HOST…", mid);
        }

        void FinalWin(int id)
        {
            var L = host != null ? host.L : guest?.L;
            GUILayout.Space(4);
            if (L != null && L.tour != null)
            {
                var tr = L.tour;
                string Nm(string i) => tr.names.TryGetValue(i, out var v) ? v : "?";
                for (int i = 0; i < tr.m.Count; i++)
                    GUILayout.Label($"{(i == tr.m.Count - 1 && tr.m.Count > 1 ? "Final" : "Match " + (i + 1))}: {Nm(tr.m[i][0])} vs {Nm(tr.m[i][1])} — {(i < tr.w.Count ? Nm(tr.w[i]) : i == tr.i ? "playing…" : "—")}", txt);
                if (host != null)
                {
                    if (!tourDone) { tourMore = host.TourResult(); tourDone = true; } // (record this game once)
                    if (tourDone && tourMore && GUILayout.Button("NEXT MATCH ▶", btn)) { tourDone = false; StartHostGame(() => host.TourPlay(0)); }
                    if (tourDone && !tourMore) GUILayout.Label("🏆 " + (tr.champ != null ? Nm(tr.champ) : "?") + " wins the tournament!", h2);
                    if (GUILayout.Button("Back to lobby", btn)) { tourDone = false; host.BackToLobby(); }
                }
                else if (GUILayout.Button("Leave game", btn)) Leave();
                return;
            }
            if (host != null)
            {
                var (n, m) = host.RematchVotes();
                if (GUILayout.Button("↻ REMATCH", btn)) StartHostGame(() => host.Rematch(0));
                if (m > 0) GUILayout.Label($"{n}/{m} want a rematch{(NetOpts.AutoRematch && n >= m ? " — starting…" : "")}", txt);
                if (GUILayout.Button("Back to lobby", btn)) host.BackToLobby();
            }
            else if (guest != null)
            {
                if (GUILayout.Button(voted ? "Rematch requested ✓" : "↻ I want a rematch", btn)) { guest.WantRematch(); voted = true; }
                GUILayout.Label("The host decides: rematch or back to the lobby.", txt);
                if (GUILayout.Button("Leave game", btn)) Leave();
            }
        }
        bool tourDone, tourMore;
        GUIStyle mid;
    }
}

// Hoops 2K27 for Unity: boots the C# core (Hoops.Core.Sim), runs it at a fixed 60 Hz like the browser build, feeds the
// keyboard into the human controller, drives the broadcast camera and draws the HUD. The scene is built from code
// (CourtBuilder, PlayerDraw), so the project has no hand-made assets.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class GameMain : MonoBehaviour
    {
        const double STEP = 1 / 60.0;
        double acc;
        Camera cam;
        RigDraw draw; // skinned players + ball (Rig.cs)
        GameAudio sfx;
        Arena arena; // stands, crowd, lights, jumbotron, net, post + quality ladder (Arena.cs)
        CameraDirector camDir; // broadcast / 2K / baseline / player lock (K), replay director
        float fps = 60;
        // edge events captured per frame, consumed by the first sim tick that reads them (like input.ts `ev`)
        bool eSd, eSu, eE, eR, eF, eQ, eG, eTo, eCh, eDs;
        int eMv;
        readonly List<(string s, string c, float t, bool big, string sub)> texts = new();
        int team = 0, opp = 1;

        void Awake()
        {
            Application.targetFrameRate = -1;
            QualitySettings.vSyncCount = 0;
            cfg.NP = 5;
            cfg.physics = "rapier"; // = "the engine": PhysX here
            cfg.hand = true;
            cfg.replays = true;
            Phys.RAP = new PhysXBall();
            CourtBuilder.Build();
            draw = new RigDraw();
            var cg = new GameObject("Camera");
            cam = cg.AddComponent<Camera>();
            cam.fieldOfView = 38;
            cam.nearClipPlane = 0.3f;
            cam.farClipPlane = 600;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.03f, 0.035f, 0.05f);
            cg.tag = "MainCamera";
            arena = new Arena(cam);
            camDir = new CameraDirector(cam);
            cfg.input = ReadInput;
            setCtrls(new List<Ctrl> { mkCtrl("p1", 0) });
            setQtrLen(180);
            gameObject.AddComponent<Menus>(); // title / matchup screen starts the game
            sfx = gameObject.AddComponent<GameAudio>();
        }

        Hoops.Core.Input ReadInput(Ctrl c)
        {
            var i = new Hoops.Core.Input();
            // the default Input Manager axes carry WASD, the arrows AND the gamepad's left stick
            float ax = UnityEngine.Input.GetAxisRaw("Horizontal"), ay = UnityEngine.Input.GetAxisRaw("Vertical");
            if (Mathf.Abs(ax) < 0.14f) ax = 0;
            if (Mathf.Abs(ay) < 0.14f) ay = 0;
            i.dx = ax;
            i.dy = -ay; // game y grows toward the camera; stick / W = up = away
            double m = System.Math.Sqrt(i.dx * i.dx + i.dy * i.dy);
            if (m > 1) { i.dx /= m; i.dy /= m; }
            i.sd = eSd; i.su = eSu; i.e = eE; i.lob = eR; i.sb = eF; i.sw = eQ; i.pf = eG; i.to = eTo; i.ch = eCh; i.ds = eDs;
            i.mv = eMv;
            i.post = Key(KeyCode.B) || Key(KeyCode.JoystickButton6);
            i.sp = Key(KeyCode.LeftShift) || Key(KeyCode.RightShift) || Key(KeyCode.JoystickButton7);
            eSd = eSu = eE = eR = eF = eQ = eG = eTo = eCh = eDs = false;
            eMv = 0;
            return i;
        }
        static bool Key(KeyCode k) => UnityEngine.Input.GetKey(k);
        static bool Down(KeyCode k) => UnityEngine.Input.GetKeyDown(k);

        void Update()
        {
            float dt = Mathf.Min(0.1f, Time.unscaledDeltaTime);
            fps = Mathf.Lerp(fps, 1f / Mathf.Max(0.001f, dt), 0.05f);
            if (Down(KeyCode.Space) || Down(KeyCode.JoystickButton0)) eSd = true;
            if (UnityEngine.Input.GetKeyUp(KeyCode.Space) || UnityEngine.Input.GetKeyUp(KeyCode.JoystickButton0)) eSu = true;
            // gamepad, standard layout (same as the browser build): B lob, X pass, Y step-back, LB hesitation, RB spin,
            // L3 pump fake, R3 defense / play call, d-pad up timeout, d-pad down challenge (LT post, RT sprint: held)
            if (Down(KeyCode.JoystickButton2)) eE = true;
            if (Down(KeyCode.JoystickButton1)) eR = true;
            if (Down(KeyCode.JoystickButton3)) eF = true;
            if (Down(KeyCode.JoystickButton4)) eMv = 1;
            if (Down(KeyCode.JoystickButton5)) eMv = 2;
            if (Down(KeyCode.JoystickButton10)) eG = true;
            if (Down(KeyCode.JoystickButton11)) eDs = true;
            if (Down(KeyCode.JoystickButton12)) eTo = true;
            if (Down(KeyCode.JoystickButton13)) eCh = true;
            if (Down(KeyCode.JoystickButton8)) eQ = true;
            if (Down(KeyCode.E)) eE = true;
            if (Down(KeyCode.R)) eR = true;
            if (Down(KeyCode.F)) eF = true;
            if (Down(KeyCode.Q)) eQ = true;
            if (Down(KeyCode.G)) eG = true;
            if (Down(KeyCode.Y)) eTo = true;
            if (Down(KeyCode.H)) eCh = true;
            if (Down(KeyCode.Z)) eDs = true;
            if (Down(KeyCode.C)) eMv = 1;
            if (Down(KeyCode.X)) eMv = 2;
            if (Down(KeyCode.V)) eMv = 3;
            // (rematch / menu: Menus final screen)

            if (Net.NetHooks.GuestFrame(dt, ReadInput)) { } // online guest: prediction + interpolation instead of the sim
            else if (S == "play" || RPL != null)
            {
                acc += dt;
                int k = 0;
                while (acc >= STEP && k < 6) { upd(STEP); Net.NetHooks.AfterTick(); acc -= STEP; k++; }
                if (acc > STEP * 2) acc = STEP; // a slow frame drops time instead of snowballing
            }
            else if (S == "half") setS("play");
            else if (S == "over") { postGame(System.Math.Min(dt, 0.05)); Net.NetHooks.AfterTick(); }
            DrainFx(dt);
            draw.Draw(dt);
            camDir.Tick(dt);
            arena.Tick(dt);
        }

        void DrainFx(float dt)
        {
            arena.OnFx(FX);
            foreach (var f in FX)
            {
                sfx.OnFx(f);
                if (f.k == "t" && f.s != null) texts.Add((f.s, f.c ?? "#ffffff", 1.6f, false, null));
                else if (f.k == "ban") texts.Add((f.s, f.c ?? "#ffd23f", 2.6f, true, f.sub));
                else if (f.k == "end") texts.Add(("FINAL", "#ffd23f", 99f, true, "ENTER for a rematch"));
            }
            FX.Clear();
            for (int i = texts.Count - 1; i >= 0; i--)
            {
                var t = texts[i];
                t.t -= dt;
                if (t.t <= 0) texts.RemoveAt(i); else texts[i] = t;
            }
            if (texts.Count > 8) texts.RemoveRange(0, texts.Count - 8);
        }

        Player Focus()
        {
            var c = CT.Count > 0 ? CT[0] : null;
            return c != null && c.idx >= 0 && c.idx < P.Count ? P[c.idx] : null;
        }

        static Color Col(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.white;
        GUIStyle big, mid, small;

        void OnGUI()
        {
            if (S == "menu") return; // the title / matchup screen (Menus) owns the screen
            if (big == null)
            {
                big = new GUIStyle(GUI.skin.label) { fontSize = 34, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
                mid = new GUIStyle(big) { fontSize = 22 };
                small = new GUIStyle(big) { fontSize = 14, fontStyle = FontStyle.Normal };
            }
            float W = Screen.width;
            // scoreboard
            GUI.color = new Color(0, 0, 0, 0.72f);
            GUI.DrawTexture(new Rect(W / 2 - 260, 8, 520, 54), Texture2D.whiteTexture);
            GUI.color = Col(PC[0]);
            GUI.DrawTexture(new Rect(W / 2 - 260, 8, 6, 54), Texture2D.whiteTexture);
            GUI.color = Col(PC[1]);
            GUI.DrawTexture(new Rect(W / 2 + 254, 8, 6, 54), Texture2D.whiteTexture);
            GUI.color = Color.white;
            mid.normal.textColor = Color.white;
            GUI.Label(new Rect(W / 2 - 250, 8, 150, 28), (cl[0] ?? "").ToUpper(), mid);
            GUI.Label(new Rect(W / 2 + 100, 8, 150, 28), (cl[1] ?? "").ToUpper(), mid);
            big.normal.textColor = Color.white;
            GUI.Label(new Rect(W / 2 - 250, 26, 150, 40), sc[0].ToString("0"), big);
            GUI.Label(new Rect(W / 2 + 100, 26, 150, 40), sc[1].ToString("0"), big);
            int cs = (int)System.Math.Ceiling(System.Math.Max(0, clock));
            mid.normal.textColor = new Color(1f, 0.82f, 0.25f);
            GUI.Label(new Rect(W / 2 - 80, 8, 160, 28), $"Q{q}  {cs / 60}:{cs % 60:00}", mid);
            mid.normal.textColor = Color.white;
            GUI.Label(new Rect(W / 2 - 80, 34, 160, 26), System.Math.Ceiling(System.Math.Max(0, shot)).ToString("0"), mid);
            small.normal.textColor = new Color(1, 1, 1, 0.75f);
            GUI.Label(new Rect(10, Screen.height - 26, 700, 20), $"Hoops 2K27 (Unity) · {fps:0} FPS · WASD move · Space shoot · E pass · R lob · F step-back · C/X/V moves · Shift sprint · Q switch", small);
            // floating texts and banners
            float y = Screen.height * 0.22f;
            foreach (var t in texts)
            {
                var st = t.big ? big : mid;
                st.normal.textColor = Col(t.c);
                GUI.Label(new Rect(0, y, W, t.big ? 44 : 30), t.s, st);
                y += t.big ? 44 : 30;
                if (t.big && !string.IsNullOrEmpty(t.sub)) { mid.normal.textColor = Color.white; GUI.Label(new Rect(0, y, W, 28), t.sub, mid); y += 28; }
            }
            Meter();
        }

        /// <summary>Shot meter (hud.ts meter, bar style): green window at the TOP.</summary>
        void Meter()
        {
            var p = Focus();
            if (p == null || p.mode != "c" || Util.T(tempoOf(p))) return;
            double D0 = Util.Hypot(hoop(p.tm) - p.x, HY - p.y),
                rat = shotRat(p, D0, ftq != null),
                c = contestOf(p).Item1,
                win = (0.07 + rat / 100 * 0.05) * (1 - 0.45 * c) * (0.85 + 0.15 * p.en) * (D0 < 90 || Util.T(p.hk) ? 1 : winMul(p, D0)),
                ideal = p.st == 1 ? 0.45 : 0.6,
                wm = 0.07 + rat / 100 * 0.05,
                m = (ideal + wm) / 0.97,
                pg = System.Math.Min(1, p.t / m),
                g0 = 0.97 - 2 * win / m;
            var sp = cam.WorldToScreenPoint(PhysXBall.U(p.x, p.y, p.ht * 10 * 0.6));
            float h = 150, x = sp.x + 40, yb = Screen.height - sp.y + h / 2;
            GUI.color = new Color(0, 0, 0, 0.75f);
            GUI.DrawTexture(new Rect(x, yb - h, 16, h), Texture2D.whiteTexture);
            GUI.color = new Color(0.18f, 0.8f, 0.44f);
            GUI.DrawTexture(new Rect(x, yb - h * 1f, 16, (float)(h * (1 - g0))), Texture2D.whiteTexture);
            bool inG = pg >= g0;
            GUI.color = inG ? new Color(0.2f, 1f, 0.5f) : new Color(0.96f, 0.77f, 0.26f);
            GUI.DrawTexture(new Rect(x + 4, yb - (float)(h * pg), 8, (float)(h * pg)), Texture2D.whiteTexture);
            GUI.color = Color.white;
        }
    }

    /// <summary>Starts the game in any scene (no scene setup needed).</summary>
    static class Boot
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Go()
        {
            if (Object.FindAnyObjectByType<GameMain>() == null) new GameObject("Hoops2K27").AddComponent<GameMain>();
        }
    }
}

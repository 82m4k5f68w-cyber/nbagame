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
            gameObject.AddComponent<PageBridge>(); // WebGL template menus (TemplateData/ui.js) when present
            gameObject.AddComponent<Menus>(); // title / matchup screen starts the game
            sfx = gameObject.AddComponent<GameAudio>();
            gameObject.AddComponent<Broadcast>(); // banners, commentary, intros, halftime + Hud (OnGUI) + Music
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
            // S == "intro" / "half": Broadcast holds the sim (player intros, halftime panel) and resumes play
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
                Broadcast.OnFx(f); // banners, commentary, timing card, rumble, halftime; floating texts -> Hud
            }
            FX.Clear();
        }
        // HUD / scoreboard / meter / banners: Hud.cs + Broadcast.cs (OnGUI); menus: Menus.cs
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

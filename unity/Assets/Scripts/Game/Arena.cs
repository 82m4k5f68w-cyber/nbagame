// Arena dressing and look for the Unity build (port of src/client/render3d.ts + the fx3d.ts quality ladder):
// tiered stands with an instanced crowd (bodies / heads / arms / towels in team colours; they stand on excitement and do
// the wave), signs, a courtside row on chairs that reacts ("ooh", ducking a ball into the seats, arms up when loud),
// benches + pacing head coaches, two referees (whistle arm on Fx "whistle"), LED ribbons, a painted jumbotron with the
// score and rotating team stats, shot clocks on the glass, catwalk spot lights with additive light shafts, HDR ceiling
// panels, the net (Sim.NETS strands as instanced thin capsules), contact-shadow blobs, glints, the on-fire ball trail,
// rim shake on dunks, final-buzzer confetti, the street set for half-court modes, a realtime reflection probe on High,
// and the adaptive quality ladder / frame-rate guard. URP post (Volume, SSAO toggle, render scale) lives behind IPostFx
// (Urp/PostFx.cs registers itself) so this file compiles against the plain UnityEngine assemblies.
// Everything is built from code; repeated objects are GPU instanced (Graphics.RenderMeshInstanced), one batch per
// colour (stock URP shaders have no per-instance colour), and Tick() allocates nothing.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using UnityEngine.Rendering;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed partial class Arena
    {
        // ---------------- quality (view.ts QL / FX, render3d.ts ladder) ----------------
        /// <summary>Graphics tier 0 Low, 1 Medium, 2 High (default by GPU; saved only when picked, PlayerPrefs h2k_q2).</summary>
        public static int QL = -1;
        /// <summary>Post-processing on/off (settings).</summary>
        public static bool FxOn = true;
        /// <summary>Frame-rate ladder rung: 6 everything, 5 -SSAO, 4 -reflections/motion blur, 3 -bloom/grade,
        /// 2 -shadows/shafts/half the crowd, 1 85% resolution, 0 75%.</summary>
        public static int Lvl = 6;
        public static float Fps = 60;
        /// <summary>H2K Super Resolution (view.ts V.HSR): 0 Off, 1 Auto (dynamic resolution), 2 Quality 67%, 3 Balanced
        /// 58%, 4 Performance 50%, 5 Ultra Performance 33%. Default: High-tier GPUs Off, the rest Auto. HSRM upscaler:
        /// 0 auto, 1 temporal (URP STP where compute shaders exist), 2 spatial (FSR 1). TFPS target (0 = refresh).</summary>
        public static int HSR = -1, HSRM = 0, TFPS = 60;
        public static readonly float[] HSRS = { 1f, 1f, 0.67f, 0.58f, 0.5f, 0.33f };
        /// <summary>Internal render scale HSR uses now (Auto moves it; PostFx applies it as URP renderScale).</summary>
        public static float HsrScale = 1f;
        /// <summary>Target frame time (ms): never faster than the display refresh.</summary>
        public static float TargetMs()
        {
            double hz = Screen.currentResolution.refreshRateRatio.value;
            if (hz < 20 || double.IsNaN(hz)) hz = 60;
            return Mathf.Max(TFPS > 0 ? 1000f / TFPS : 0f, (float)(1000.0 / hz));
        }
        /// <summary>URP post hooks (Urp/PostFx.cs sets this before the scene loads).</summary>
        public static IPostFx Post;
        public static Arena I;

        /// <summary>view.ts gpuTier: software -> Low; integrated GPUs, Chromebooks, &lt;= 4 cores, touch -> Medium; else High.</summary>
        public static int DefaultTier()
        {
            if (PlayerPrefs.HasKey("h2k_q2")) return Mathf.Clamp(PlayerPrefs.GetInt("h2k_q2"), 0, 2);
            string r = (SystemInfo.graphicsDeviceName ?? "").ToLowerInvariant() + " " + (SystemInfo.graphicsDeviceVendor ?? "").ToLowerInvariant();
            if (r.Contains("swiftshader") || r.Contains("llvmpipe") || r.Contains("software") || r.Contains("basic render")) return 0;
            if (Application.isMobilePlatform || UnityEngine.Input.touchSupported || SystemInfo.processorCount <= 4) return 1;
            foreach (var k in new[] { "intel", "uhd", "iris", "hd graphics", "mali", "adreno", "powervr", "vivante", "videocore", "radeon graphics", "radeon(tm) graphics", "vega " })
                if (r.Contains(k)) return 1;
            return 2;
        }
        /// <summary>Pick a tier (menus). save = remember it (h2k_q2).</summary>
        public static void SetQuality(int ql, bool save = true)
        {
            QL = Mathf.Clamp(ql, 0, 2);
            if (save) PlayerPrefs.SetInt("h2k_q2", QL);
            Lvl = 6;
            if (I != null) { I.Apply(); I.settle = 0.7f; }
        }

        readonly Camera cam;
        readonly Transform root;
        float tm; // local animation clock (keeps running in pauses/replays like the browser's T-driven crowd)
        int frame;
        readonly List<GameObject> arenaObjs = new List<GameObject>(), streetObjs = new List<GameObject>(), shafts = new List<GameObject>();
        bool streetOn;
        readonly Mesh quad, box, capLo, capHi, sphLo, sphHi;
        static readonly Color BG = new Color(0.024f, 0.027f, 0.05f);

        public Arena(Camera cam)
        {
            I = this;
            this.cam = cam;
            if (QL < 0) QL = DefaultTier();
            if (HSR < 0) HSR = PlayerPrefs.HasKey("h2k_hsr") ? Mathf.Clamp(PlayerPrefs.GetInt("h2k_hsr"), 0, 5) : QL >= 2 ? 0 : 1;
            HsrScale = HSR == 1 ? (QL >= 2 ? 0.8f : 0.67f) : HSRS[Mathf.Clamp(HSR, 0, 5)];
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = BG;
            cam.farClipPlane = 420;
            cam.allowHDR = true;
            cam.allowMSAA = true;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = BG;
            RenderSettings.fogStartDistance = 110;
            RenderSettings.fogEndDistance = 230;
            root = new GameObject("ArenaDressing").transform;
            quad = Gfx.Quad();
            box = Gfx.Cube();
            capLo = Gfx.Capsule(6, 2);
            capHi = Gfx.Capsule(10, 3);
            sphLo = Gfx.Sphere(8, 6);
            sphHi = Gfx.Sphere(12, 8);
            BuildLights();
            BuildStands();
            BuildCrowd();
            BuildCourtside();
            BuildLed();
            BuildJumbo();
            BuildShotClocks();
            BuildNet();
            BuildBlobs();
            BuildPolish();
            BuildFigures();
            BuildStreet();
            BuildProbe();
            Post?.Init(cam);
            Apply();
            settle = 0.7f;
            kPC0 = PC[0]; kPC1 = PC[1]; kCl0 = cl[0]; kCl1 = cl[1]; // built with these colours already
            float mx = Mathf.Max(0.01f, Mathf.Max(bodyCol[0].r, Mathf.Max(bodyCol[0].g, bodyCol[0].b)));
            Post?.Tint(Color.Lerp(Color.white, new Color(bodyCol[0].r / mx, bodyCol[0].g / mx, bodyCol[0].b / mx), 0.07f));
        }

        // ================= lights: catwalk spots, light shafts, HDR ceiling panels =================
        // three.js SPOTS: x, z, target x, target z, colour, intensity (warm pools over each half, cool rims from corners)
        static readonly float[,] SPOTS = { { -30, -16, -22, 0, 0, 1.1f }, { 30, 16, 22, 0, 0, 1.1f }, { -62, 34, -34, 4, 1, 0.7f }, { 62, -34, 34, -4, 1, 0.7f } };
        void BuildLights()
        {
            for (int i = 0; i < 4; i++)
            {
                Vector3 from = Gfx.V3(SPOTS[i, 0], 40, SPOTS[i, 1]), to = Gfx.V3(SPOTS[i, 2], 0, SPOTS[i, 3]);
                var l = new GameObject("Catwalk" + i).AddComponent<Light>();
                l.transform.SetParent(root, false);
                l.type = LightType.Spot;
                l.color = SPOTS[i, 4] == 0 ? new Color(1f, 0.94f, 0.85f) : new Color(0.66f, 0.78f, 1f);
                l.transform.position = from;
                l.transform.rotation = Quaternion.LookRotation(to - from);
                l.spotAngle = 63; // three angle .55 rad (half), penumbra .75
                l.innerSpotAngle = 16;
                l.range = 160;
                l.intensity = 0.42f * SPOTS[i, 5] * (to - from).sqrMagnitude; // inverse-square: ~.45 lux-ish pools on the floor
                l.shadows = LightShadows.None;
            }
            // light shafts: faint additive cones from the catwalks, fading out before the floor
            var g = new Gfx.Paint(4, 128, false);
            for (int y = 0; y < 128; y++)
            {
                float v = y / 127f, a = v > 0.25f ? Mathf.Lerp(0.35f, 1, (v - 0.25f) / 0.75f) : Mathf.Lerp(0, 0.35f, v / 0.25f);
                for (int x = 0; x < 4; x++) g.px[y * 4 + x] = new Color32(255, 255, 255, (byte)(a * 255));
            }
            g.Upload();
            var shM = Gfx.Additive(new Color(1f * 0.03f, 0.95f * 0.03f, 0.86f * 0.03f, 1), g.tex);
            float[,] sh = { { -30, -16, -22, 0 }, { 30, 16, 22, 0 }, { -8, -20, -14, 6 }, { 8, 20, 14, -6 } };
            for (int i = 0; i < 4; i++)
            {
                Vector3 from = Gfx.V3(sh[i, 0], 40, sh[i, 1]), to = Gfx.V3(sh[i, 2], 0, sh[i, 3]);
                float len = (to - from).magnitude;
                var o = Gfx.Obj("Shaft" + i, Gfx.Tube(9, -len, 0.8f, 0, 24), shM, from, Quaternion.FromToRotation(Vector3.down, (to - from) / len), Vector3.one, root, false);
                o.GetComponent<MeshRenderer>().receiveShadows = false;
                shafts.Add(o);
                arenaObjs.Add(o);
            }
            // ceiling light panels (HDR: bloom picks them up)
            var pm = Gfx.Unlit(new Color(5f, 4.82f, 4.55f));
            for (int i = 0; i < 8; i++)
                arenaObjs.Add(Gfx.Obj("Panel" + i, quad, pm, Gfx.V3(-42 + i * 12, 40, (i % 2 == 1 ? 1 : -1) * 14), Gfx.Facing(Vector3.down), new Vector3(7, 1.2f, 1), root, false));
        }

        // ================= stands + crowd =================
        Batch tierB;
        const int CN = 2600;
        readonly Vector3[] cP = new Vector3[CN], cF = new Vector3[CN];
        readonly float[] cSeed = new float[CN], cPh = new float[CN], cAng = new float[CN];
        readonly int[] cRow = new int[CN], cBody = new int[CN], cSkin = new int[CN], cTow = new int[CN];
        Batch[] bodyB, headB, armB, towB;
        Material[] bodyM;
        readonly Color[] bodyCol = new Color[12];
        static readonly string[] SKN = { "#f1c27d", "#c68642", "#8d5524", "#e0ac69", "#6b4226", "#ffdbac" };
        Material[] skinM;
        float exc = 0.3f, waveT, waveA, crowdDt;
        int crowdN = -1;
        readonly List<(GameObject g, int i)> signs = new List<(GameObject, int)>();

        void BuildStands()
        {
            tierB = new Batch(box, Gfx.Lit(new Color(0.086f, 0.1f, 0.18f), 0.15f), 48, false, true);
            for (int r = 0; r < 12; r++)
            {
                float y = 0.6f + r * 1.15f, off = 3.2f + r * 1.6f;
                tierB.Add(Gfx.V3(0, y / 2, -(25 + off)), Quaternion.identity, new Vector3(120 + r * 3.2f, y, 1.6f));
                tierB.Add(Gfx.V3(0, y / 2, 25 + off), Quaternion.identity, new Vector3(120 + r * 3.2f, y, 1.6f));
                tierB.Add(Gfx.V3(-(47 + off), y / 2, 0), Quaternion.identity, new Vector3(1.6f, y, 50 + r * 6.4f));
                tierB.Add(Gfx.V3(47 + off, y / 2, 0), Quaternion.identity, new Vector3(1.6f, y, 50 + r * 6.4f));
            }
        }

        void BuildCrowd()
        {
            var rnd = new System.Random(11);
            float R() => (float)rnd.NextDouble();
            skinM = new Material[6];
            for (int k = 0; k < 6; k++) skinM[k] = Gfx.Lit(Gfx.Hex(SKN[k], Color.white), 0.3f);
            bodyCol[0] = Gfx.Hex(PC[0], new Color(0.48f, 0.25f, 0.71f));
            bodyCol[1] = Gfx.Hex(PC[1], new Color(0.11f, 0.26f, 0.54f));
            for (int k = 2; k < 12; k++) bodyCol[k] = CourtBuilder.HSLc(R(), 0.35f, 0.25f + R() * 0.4f);
            var nb = new int[12];
            var ns = new int[6];
            var na = new int[6];
            int nt0 = 0, nt1 = 0, towels = 0;
            for (int i = 0; i < CN; i++)
            {
                int sd = i % 4, r = (i / 4) % 12;
                float y = 0.6f + r * 1.15f + 0.55f, off = 3.2f + r * 1.6f, x, z;
                if (sd < 2) { x = (R() - 0.5f) * (116 + r * 3); z = (sd == 1 ? 1 : -1) * (25 + off); }
                else { z = (R() - 0.5f) * (46 + r * 6); x = (sd == 2 ? -1 : 1) * (47 + off); }
                cP[i] = Gfx.V3(x, y, z);
                cF[i] = sd == 0 ? new Vector3(0, 0, -1) : sd == 1 ? new Vector3(0, 0, 1) : sd == 2 ? new Vector3(1, 0, 0) : new Vector3(-1, 0, 0);
                cPh[i] = R() * 6.28f;
                cSeed[i] = R();
                cRow[i] = r;
                cAng[i] = Mathf.Atan2(z, x);
                float t = R();
                cBody[i] = t < 0.32f ? 0 : t < 0.6f ? 1 : 2 + Mathf.Min(9, (int)(R() * 10));
                cSkin[i] = i % 6;
                nb[cBody[i]]++;
                ns[cSkin[i]]++;
                if (r < 5) na[cSkin[i]] += 2;
                cTow[i] = -1;
                if (cSeed[i] < 0.16f && r < 7 && towels < 400) { cTow[i] = towels % 3 == 0 ? 0 : 1; if (cTow[i] == 0) nt0++; else nt1++; towels++; }
            }
            bodyB = new Batch[12];
            bodyM = new Material[12];
            for (int k = 0; k < 12; k++) bodyB[k] = new Batch(capLo, bodyM[k] = Gfx.Lit(bodyCol[k], 0.15f), nb[k], false, true);
            headB = new Batch[6];
            armB = new Batch[6];
            for (int k = 0; k < 6; k++)
            {
                headB[k] = new Batch(sphLo, skinM[k], ns[k], false, true);
                armB[k] = new Batch(capLo, skinM[k], na[k], false, true);
            }
            towB = new[] { new Batch(quad, Gfx.TwoSided(Gfx.Lit(bodyCol[0], 0.1f)), nt0, false, true), new Batch(quad, Gfx.TwoSided(Gfx.Lit(new Color(0.96f, 0.96f, 0.96f), 0.1f)), nt1, false, true) };
            // signs held by front-row fans
            string[] SIGNS = { "DEFENSE!", "MVP", "LET'S GO!", "SPLASH", "#77", "AND ONE", "POSTERIZED", "BUCKETS", "D-FENSE", "WE BELIEVE", "CLUTCH", "2K27" };
            for (int k = 0, i = 0; k < 24 && i < CN; i++)
            {
                if (cRow[i] > 2 || cSeed[i] < 0.5f || cSeed[i] > 0.58f) continue;
                var pt = new Gfx.Paint(128, 64);
                pt.Clear(k % 2 == 1 ? new Color32(253, 253, 253, 255) : new Color32(255, 225, 77, 255));
                string txt = SIGNS[k % SIGNS.Length];
                pt.Text(txt, 64, 33, txt.Length > 8 ? 2 : 3, k % 3 == 0 ? new Color32(200, 16, 46, 255) : new Color32(20, 24, 44, 255));
                pt.Upload();
                var m = Gfx.TwoSided(Gfx.Lit(Color.white, 0.2f));
                Gfx.SetTex(m, pt.tex);
                var g = Gfx.Obj("Sign" + k, quad, m, cP[i], Quaternion.identity, new Vector3(1.5f, 0.75f, 1), root, false);
                signs.Add((g, i));
                arenaObjs.Add(g);
                k++;
            }
        }

        /// <summary>Fans stand when the noise beats their threshold or the wave passes; front rows pump their arms,
        /// some twirl towels (render3d crowdUpd). n = how many fans are drawn (quality).</summary>
        void CrowdUpd(int n, float dt)
        {
            if (waveT > 0) waveT -= dt;
            for (int k = 0; k < 12; k++) bodyB[k].n = 0;
            for (int k = 0; k < 6; k++) { headB[k].n = 0; armB[k].n = 0; }
            towB[0].n = towB[1].n = 0;
            float wf = waveA + (6 - waveT) * 1.6f, sc1 = 0.6f, sc3 = 0.44f;
            var armS = new Vector3(0.16f, 0.355f, 0.16f);
            for (int i = 0; i < n; i++)
            {
                float seed = cSeed[i], wv = 0;
                if (waveT > 0)
                {
                    float d = cAng[i] - wf;
                    wv = Mathf.Max(0, 1 - Mathf.Abs(Mathf.Atan2(Mathf.Sin(d), Mathf.Cos(d))) / 0.35f);
                }
                float st = Mathf.Max(exc > 0.45f + seed * 0.5f ? 1 : 0, wv),
                    hop = Mathf.Max(0, Mathf.Sin(tm * (3 + exc * 5) + cPh[i])) * 0.3f * exc * st;
                var p = cP[i];
                p.y += -0.28f * (1 - st) + hop;
                bodyB[cBody[i]].Add(p, Quaternion.identity, new Vector3(sc1, 0.575f * (0.72f + 0.28f * st), sc1));
                p.y += 0.62f + 0.13f * st;
                headB[cSkin[i]].Add(p, Quaternion.identity, new Vector3(sc3, sc3, sc3));
                float hy = p.y;
                if (cRow[i] < 5 && st > 0)
                {
                    float up = st * (wv > 0.3f ? 1 : 0.6f + 0.4f * Mathf.Sin(tm * 6 + cPh[i]));
                    if (up > 0.05f)
                    {
                        var f = cF[i];
                        var rt = new Vector3(f.z, 0, -f.x);
                        for (int sd = -1; sd <= 1; sd += 2)
                        {
                            var ap = cP[i] + rt * (0.36f * sd);
                            ap.y = hy - 0.45f + up * 0.75f;
                            armB[cSkin[i]].Add(ap, Quaternion.AngleAxis(sd * (0.15f + 0.25f * (1 - up)) * Mathf.Rad2Deg, f), armS);
                        }
                    }
                }
                if (cTow[i] >= 0 && st > 0.5f)
                {
                    var tp = cP[i];
                    tp.y = hy + 0.9f;
                    towB[cTow[i]].Add(tp, Quaternion.Euler(0, -(tm * 9 + cPh[i]) * Mathf.Rad2Deg, 0.4f * Mathf.Rad2Deg), new Vector3(0.55f, 0.4f, 1));
                }
            }
            bool up2 = exc > 0.5f || waveT > 0;
            foreach (var (g, i) in signs)
            {
                bool vis = i < n && !streetOn;
                if (g.activeSelf != vis) g.SetActive(vis);
                if (!vis) continue;
                float u = up2 ? 1 : 0;
                var p = cP[i] + cF[i] * 0.5f;
                p.y += 0.55f + u * 0.85f + Mathf.Sin(tm * 4 + cPh[i]) * 0.08f * u;
                g.transform.SetPositionAndRotation(p, Gfx.Facing(cF[i]) * Quaternion.Euler(0, 0, Mathf.Sin(tm * 3 + cPh[i]) * 0.08f * u * Mathf.Rad2Deg));
            }
        }
        void CrowdDraw()
        {
            for (int k = 0; k < 12; k++) bodyB[k].Draw();
            for (int k = 0; k < 6; k++) { headB[k].Draw(); armB[k].Draw(); }
            towB[0].Draw();
            towB[1].Draw();
        }

        // ================= courtside row (44 fans on chairs) =================
        const int CSN = 44;
        readonly float[] csX = new float[CSN], csZ = new float[CSN], csSide = new float[CSN];
        readonly bool[] csOn = new bool[CSN];
        readonly int[] csCol = new int[CSN];
        Batch chairB, benchChairB;
        Batch[] csBodyB, csHeadB, csArmB;
        int reactK; // 0 none, 1 ooh, 2 duck
        float reactT, reactX, reactZ;

        void BuildCourtside()
        {
            var rnd = new System.Random(5);
            float R() => (float)rnd.NextDouble();
            chairB = new Batch(box, Gfx.Lit(new Color(0.11f, 0.12f, 0.19f), 0.5f), CSN, true, true);
            csBodyB = new Batch[8];
            for (int k = 0; k < 8; k++) csBodyB[k] = new Batch(capHi, Gfx.Lit(CourtBuilder.HSLc(R(), 0.3f, 0.2f + R() * 0.45f), 0.2f), CSN, true, true);
            csHeadB = new Batch[6];
            csArmB = new Batch[6];
            for (int k = 0; k < 6; k++) { csHeadB[k] = new Batch(sphHi, skinM[k], CSN, true, true); csArmB[k] = new Batch(capHi, skinM[k], CSN * 2, true, true); }
            for (int k = 0; k < CSN; k++)
            {
                float side = k % 2 == 1 ? 1 : -1, x = -36 + (k / 2) / (CSN / 2f - 1) * 72 + (R() - 0.5f), z = side * 27.6f;
                csCol[k] = (int)(R() * 7.99f);
                if (Mathf.Abs(x) < 6) continue; // scorer's table gap
                csOn[k] = true;
                csX[k] = x; csZ[k] = z; csSide[k] = side;
                chairB.Add(Gfx.V3(x, 0.55f, z + side * 0.3f), Quaternion.identity, new Vector3(0.9f, 1.1f, 0.8f));
            }
        }
        static readonly Vector3 UPV = Vector3.up;
        /// <summary>Courtside reactions: "ooh" (hands on heads) after a near miss, "duck" when a ball flies into the seats
        /// near x, arms up when the building is loud (render3d courtside).</summary>
        void Courtside(float dt, float loud)
        {
            if (reactK != 0) { reactT -= dt; if (reactT <= 0) reactK = 0; }
            for (int k = 0; k < 8; k++) csBodyB[k].n = 0;
            for (int k = 0; k < 6; k++) { csHeadB[k].n = 0; csArmB[k].n = 0; }
            for (int k = 0; k < CSN; k++)
            {
                if (!csOn[k]) continue;
                float x = csX[k], z = csZ[k], side = csSide[k];
                bool near = reactK == 1 || (reactK == 2 && Mathf.Abs(x - reactX) < 9 && Mathf.Sign(reactZ) == side);
                int kind = near ? reactK : loud > 0.85f && (k * 7) % 10 < 7 ? 3 : 0; // 1 ooh 2 duck 3 up 0 sit
                float stand = kind == 3 ? 0.4f : 0, duck = kind == 2 ? 0.35f : 0;
                csBodyB[csCol[k]].Add(Gfx.V3(x, 1.45f + stand - duck, z), Quaternion.Euler(duck * side * 0.8f * Mathf.Rad2Deg, 0, 0), new Vector3(0.64f, 0.62f, 0.64f));
                float hy = 2.25f + stand - duck * 1.4f, hz = z + side * duck * 0.4f;
                csHeadB[k % 6].Add(Gfx.V3(x, hy, hz), Quaternion.identity, new Vector3(0.48f, 0.48f, 0.48f));
                for (int s = -1; s <= 1; s += 2)
                {
                    float sx = x + s * 0.36f, sy = 1.85f + stand - duck, wave = Mathf.Sin(tm * 8 + k) * 0.25f, dx = 0, dy = -0.6f, dz = -side * 0.5f;
                    if (kind == 3) { dx = s * 0.2f + wave * s; dy = 1; dz = 0; }
                    else if (kind == 1) { dx = -s * 0.25f; dy = 0.75f; dz = -side * 0.15f; }
                    else if (kind == 2) { dx = -s * 0.35f; dy = 0.55f; dz = -side * 0.45f; }
                    var av = Gfx.V3(dx, dy, dz).normalized;
                    csArmB[k % 6].Add(Gfx.V3(sx, sy, z) + av * 0.32f, Quaternion.FromToRotation(UPV, av), new Vector3(0.14f, 0.32f, 0.14f));
                }
            }
            chairB.Draw();
            for (int k = 0; k < 8; k++) csBodyB[k].Draw();
            for (int k = 0; k < 6; k++) { csHeadB[k].Draw(); csArmB[k].Draw(); }
        }

        // ================= LED ribbons =================
        Gfx.Paint led;
        Material ledM, ringM;
        void BuildLed()
        {
            led = new Gfx.Paint(2048, 32, true, TextureWrapMode.Repeat);
            LedDraw();
            ledM = Gfx.Unlit(new Color(1.7f, 1.7f, 1.7f), led.tex);
            ledM.SetTextureScale("_BaseMap", new Vector2(2, 1));
            var dark = Gfx.Lit(new Color(0.043f, 0.047f, 0.08f), 0.4f);
            for (int s = -1; s <= 1; s += 2)
            {
                float z = s * 26.6f;
                arenaObjs.Add(Gfx.Obj("Board", box, dark, Gfx.V3(0, 0.65f, z), Quaternion.identity, new Vector3(96, 1.3f, 0.35f), root));
                var n = Gfx.V3(0, 0, -s); // toward the court
                arenaObjs.Add(Gfx.Obj("Led", quad, ledM, Gfx.V3(0, 0.65f, z) + n * 0.18f, Gfx.Facing(n), new Vector3(96, 1.15f, 1), root, false));
            }
            ringM = Gfx.TwoSided(Gfx.Unlit(new Color(1.5f, 1.5f, 1.5f), led.tex));
            ringM.SetTextureScale("_BaseMap", new Vector2(-10, 1)); // mirrored: read from inside the ring
            arenaObjs.Add(Gfx.Obj("LedRing", Gfx.Tube(80, -1.1f, 80, 1.1f, 64), ringM, new Vector3(0, 16.5f, 0), Quaternion.identity, new Vector3(1, 1, 0.62f), root, false));
        }
        void LedDraw()
        {
            led.Clear(new Color32(4, 5, 11, 255));
            Color32 gold = new Color32(255, 210, 63, 255), t0 = Gfx.Hex(PC[0], gold);
            for (int i = 0; i < 6; i++)
            {
                string s = i % 3 == 2 ? "* HOOPS 2K27 *" : string.IsNullOrEmpty(cl[i % 2]) ? "HOOPS" : cl[i % 2].ToUpperInvariant();
                led.Text(s, i * 341 + 14, 16, 3, i % 2 == 1 ? t0 : gold, -1, 0.25f);
            }
            led.Upload();
        }

        // ================= jumbotron + shot clocks =================
        Gfx.Paint jum;
        long jumK = -1;
        Gfx.Paint[] scP = new Gfx.Paint[2];
        int scK = -1;
        bool scRed;
        void BuildJumbo()
        {
            jum = new Gfx.Paint(512, 256);
            var jm = Gfx.Unlit(new Color(1.35f, 1.35f, 1.35f), jum.tex);
            var dark = Gfx.Lit(new Color(0.043f, 0.047f, 0.08f), 0.4f);
            var c = new Vector3(0, 27, 0);
            arenaObjs.Add(Gfx.Obj("Jumbotron", box, dark, c, Quaternion.identity, new Vector3(15, 7.5f, 15), root, false));
            foreach (var n in new[] { Vector3.forward, Vector3.back, Vector3.left, Vector3.right })
                arenaObjs.Add(Gfx.Obj("JumboFace", quad, jm, c + n * 7.52f, Gfx.Facing(n), new Vector3(15, 7.5f, 1), root, false));
            // a ring of light under the box
            arenaObjs.Add(Gfx.Obj("JumboRing", Gfx.Tube(7.6f, -0.15f, 7.6f, 0.15f, 32), Gfx.Unlit(new Color(2.2f, 1.9f, 0.9f)), c + Vector3.down * 3.9f, Quaternion.identity, new Vector3(1, 1, 1), root, false));
        }
        static string Fmt(double s)
        {
            int k = (int)System.Math.Ceiling(System.Math.Max(0, s) * 720 / QTRLEN); // game seconds -> 12-minute broadcast clock
            return (k / 60) + ":" + (k % 60).ToString("00");
        }
        static double Sum(int t, int f)
        {
            var R = ROST[t] != null && ROST[t].Count > 0 ? ROST[t] : null;
            double a = 0;
            if (R != null) foreach (var p in R) a += Stat(p, f);
            else foreach (var p in P) if (p.tm == t) a += Stat(p, f);
            return a;
        }
        static double Stat(Player p, int f) => f switch { 0 => p.stt.fgm, 1 => p.stt.fga, 2 => p.stt.tpm, 3 => p.stt.tpa, 4 => p.stt.reb, 5 => p.stt.ast, _ => p.stt.pts };
        static string TopS(int t)
        {
            Player b = null;
            var R = ROST[t] != null && ROST[t].Count > 0 ? ROST[t] : P;
            foreach (var p in R) if ((R != P || p.tm == t) && (b == null || p.stt.pts > b.stt.pts)) b = p;
            if (b == null || b.n == null) return "";
            var sp = b.n.Split(' ');
            var ln = sp[sp.Length - 1].ToUpperInvariant();
            return (ln.Length > 10 ? ln.Substring(0, 10) : ln) + " " + b.stt.pts;
        }
        static string Pct(int t) { double a = Sum(t, 1); return a > 0 ? System.Math.Round(100 * Sum(t, 0) / a) + "%" : "-"; }
        /// <summary>render3d jStat: live team stats rotating on the lower panel every ~6 s (a run takes over).</summary>
        static void JStat(int slot, out string a, out string label, out string b)
        {
            a = label = b = "";
            if (!gameLike()) return;
            if (TS.run[1] >= 8) { a = TS.run[0] != 0 ? "" : TS.run[1] + "-0"; label = "RUN"; b = TS.run[0] != 0 ? TS.run[1] + "-0" : ""; return; }
            switch (slot)
            {
                case 5: a = TS.xs.paint[0].ToString(); label = "POINTS IN THE PAINT"; b = TS.xs.paint[1].ToString(); break;
                case 6: a = TS.xs.fb[0].ToString(); label = "FAST BREAK POINTS"; b = TS.xs.fb[1].ToString(); break;
                case 0: a = Pct(0); label = "FIELD GOAL %"; b = Pct(1); break;
                case 1: a = Sum(0, 2) + "/" + Sum(0, 3); label = "3-POINTERS"; b = Sum(1, 2) + "/" + Sum(1, 3); break;
                case 2: a = Sum(0, 4).ToString(); label = "REBOUNDS"; b = Sum(1, 4).ToString(); break;
                case 3: a = TopS(0); label = "TOP SCORERS"; b = TopS(1); break;
                default: a = Sum(0, 5).ToString(); label = "ASSISTS"; b = Sum(1, 5).ToString(); break;
            }
        }
        void Jumbo(bool force)
        {
            int slot = (int)System.Math.Floor(T / 6) % 7, cs = (int)System.Math.Ceiling(System.Math.Max(0, clock) * 720 / QTRLEN);
            long k = ((((((long)sc[0] * 1000 + (long)sc[1]) * 100000 + cs) * 10 + (long)q) * 10 + slot) * 100 + (long)TS.run[1]) * 10 + (long)TS.run[0];
            if (k == jumK && !force) return;
            jumK = k;
            var j = jum;
            j.Clear(new Color32(3, 5, 12, 255));
            Color32 c0 = Gfx.Hex(PC[0], Color.gray), c1 = Gfx.Hex(PC[1], Color.gray), w = new Color32(255, 255, 255, 255), gold = new Color32(255, 210, 63, 255);
            j.Rect(12, 46, 240, 95, c0);
            j.Rect(260, 46, 240, 95, c1);
            j.Text("HOOPS 2K27", 256, 24, 3, gold, 0, 0.25f);
            string n0 = (cl[0] ?? "").ToUpperInvariant(), n1 = (cl[1] ?? "").ToUpperInvariant();
            if (n0.Length > 12) n0 = n0.Substring(0, 12);
            if (n1.Length > 12) n1 = n1.Substring(0, 12);
            j.Text(n0, 132, 64, 2, w);
            j.Text(n1, 380, 64, 2, w);
            j.Text(sc[0].ToString("0"), 132, 108, 7, w);
            j.Text(sc[1].ToString("0"), 380, 108, 7, w);
            j.Text((q > 4 ? "OT" : "Q" + q) + "  " + Fmt(clock), 256, 168, 4, gold);
            JStat(slot, out var a, out var lb, out var b);
            if (lb.Length > 0)
            {
                bool run = lb == "RUN";
                j.Rect(12, 191, 488, 55, run ? new Color32(90, 13, 13, 255) : new Color32(13, 20, 48, 255));
                j.Text(a, 100, 218, a.Length > 6 ? 2 : 4, w);
                j.Text(b, 412, 218, b.Length > 6 ? 2 : 4, w);
                j.Text(lb, 256, 218, lb.Length > 12 ? 1 : 2, run ? new Color32(255, 107, 74, 255) : new Color32(159, 231, 255, 255));
            }
            j.Upload();
        }
        void BuildShotClocks()
        {
            var dark = Gfx.Lit(new Color(0.043f, 0.047f, 0.08f), 0.4f);
            for (int b = 0; b < 2; b++)
            {
                float sg = b == 1 ? 1 : -1;
                scP[b] = new Gfx.Paint(64, 32, false);
                arenaObjs.Add(Gfx.Obj("ShotClock", box, dark, Gfx.V3(sg * 43, 13.8f, 0), Quaternion.identity, new Vector3(0.5f, 1, 2.4f), root));
                var n = new Vector3(-sg, 0, 0);
                Gfx.Obj("ShotClockFace", quad, Gfx.Unlit(new Color(1.6f, 1.6f, 1.6f), scP[b].tex), Gfx.V3(sg * 42.74f, 13.8f, 0), Gfx.Facing(n), new Vector3(2.2f, 0.9f, 1), root, false);
            }
        }
        void ShotClocks()
        {
            int v = (int)System.Math.Ceiling(System.Math.Max(0, shot));
            bool red = shot < 5;
            if (v == scK && red == scRed) return;
            scK = v;
            scRed = red;
            string s = v.ToString();
            for (int b = 0; b < 2; b++)
            {
                scP[b].Clear(new Color32(5, 5, 5, 255));
                scP[b].Text(s, 32, 16, 3, red ? new Color32(255, 59, 48, 255) : new Color32(255, 176, 32, 255));
                scP[b].Upload();
            }
        }

        // ================= net, contact shadows =================
        Batch netB, blobB;
        void BuildNet()
        {
            int nc = 0;
            foreach (var N in NETS) foreach (var c in N.c) if (c.draw) nc++;
            netB = new Batch(Gfx.Capsule(5, 1), Gfx.Lit(new Color(0.955f, 0.955f, 0.955f), 0.1f), nc, true, true);
        }
        /// <summary>Rim flex in px (+ = bent down): the ball engine's when BallSim runs (it feels the real contacts), else
        /// the sim net's (Sim.NETS[b].fz: dunks, hard hits, a player hanging on it).</summary>
        static double FlexPx(int b) => Phys.RAP is BallSim ? BallSim.RimFlex[b] : NETS[b].fz;
        void NetUpd()
        {
            netB.n = 0;
            for (int b = 0; b < NETS.Length; b++)
            {
                var N = NETS[b];
                // the sim's rim ring rides N.fz; when BallSim bends the drawn rim instead, the top of the net follows it
                // (fading out toward the hem)
                double corr = FlexPx(b) - N.fz;
                foreach (var c in N.c)
                    if (c.draw)
                    {
                        double za = c.a.z - corr * System.Math.Max(0, System.Math.Min(1, (c.a.z - 80) / 20)),
                            zb = c.b.z - corr * System.Math.Max(0, System.Math.Min(1, (c.b.z - 80) / 20));
                        netB.Seg(PhysXBall.U(c.a.x, c.a.y, za), PhysXBall.U(c.b.x, c.b.y, zb), 0.022f);
                    }
            }
            netB.Draw();
        }
        static Quaternion flatUp;
        void BuildBlobs()
        {
            var t = new Gfx.Paint(64, 64);
            for (int y = 0; y < 64; y++)
                for (int x = 0; x < 64; x++)
                {
                    float d = Mathf.Sqrt((x - 31.5f) * (x - 31.5f) + (y - 31.5f) * (y - 31.5f)) / 31f,
                        a = d < 0.06f ? 0.62f : d < 0.55f ? Mathf.Lerp(0.62f, 0.28f, (d - 0.06f) / 0.49f) : d < 1 ? Mathf.Lerp(0.28f, 0, (d - 0.55f) / 0.45f) : 0;
                    t.px[y * 64 + x] = new Color32(0, 0, 0, (byte)(a * 255));
                }
            t.Upload();
            var m = Gfx.Transparent(Gfx.Unlit(Color.white, t.tex));
            blobB = new Batch(quad, m, 16, false, false);
            flatUp = Gfx.Facing(Vector3.up);
        }
        void BlobUpd()
        {
            blobB.n = 0;
            foreach (var p in P)
                if (blobB.n < 15 && !Util.T(p.off)) Blob(p.x, p.y, p.z, 2.6f * (float)p.bk);
            Blob(B.x, B.y, B.z, 1.1f);
            blobB.Draw();
        }
        void Blob(double x, double y, double z, float sz)
        {
            float k = Mathf.Max(0.15f, 1 - (float)z / 70);
            var w = PhysXBall.U(x, y, 0);
            w.y = 0.012f;
            blobB.Add(w, flatUp, new Vector3(sz * k, sz * k, 1));
        }
    }

    public sealed partial class Arena
    {
        // ================= polish: glints, on-fire trail, confetti, rim shake =================
        Material glintM, fireM;
        static readonly Vector3[] glintP = new Vector3[8];
        readonly Vector3[] trP = new Vector3[14];
        readonly float[] trS = new float[14];
        int trK;
        const int CFN = 700;
        Batch[] cfB;
        readonly Vector3[] cfP = new Vector3[CFN];
        readonly float[] cfA = new float[CFN], cfS = new float[CFN], cfW = new float[CFN];
        bool cfOn, wasDk;
        RenderParams glintRP, fireRP;

        void BuildPolish()
        {
            var g = new Gfx.Paint(64, 64, false);
            for (int y = 0; y < 64; y++)
                for (int x = 0; x < 64; x++)
                {
                    float d = Mathf.Sqrt((x - 31.5f) * (x - 31.5f) + (y - 31.5f) * (y - 31.5f)) / 30f,
                        a = d < 0.15f ? Mathf.Lerp(1, 0.6f, d / 0.15f) : d < 1 ? Mathf.Lerp(0.6f, 0, (d - 0.15f) / 0.85f) : 0;
                    if ((x == 31 || x == 32) && y > 1 && y < 62 || (y == 31 || y == 32) && x > 1 && x < 62) a = Mathf.Max(a, 0.85f * (1 - Mathf.Abs(Mathf.Max(Mathf.Abs(x - 31.5f), Mathf.Abs(y - 31.5f))) / 32f) + 0.2f);
                    g.px[y * 64 + x] = new Color32(255, 250, 235, (byte)(Mathf.Clamp01(a) * 255));
                }
            g.Upload();
            glintM = Gfx.Additive(new Color(4, 4, 4, 1), g.tex);
            glintRP = new RenderParams(glintM) { worldBounds = new Bounds(Vector3.zero, new Vector3(2000f, 2000f, 2000f)), shadowCastingMode = ShadowCastingMode.Off, receiveShadows = false };
            for (int b = 0, i = 0; b < 2; b++)
            {
                float hx = (float)(HXs[b] - 470) * 0.1f, sg = b == 1 ? 1 : -1;
                glintP[i++] = Gfx.V3(hx - sg * 0.7f, 10.05f, 0.2f);
                glintP[i++] = Gfx.V3(hx + 0.3f, 10.05f, -0.65f);
                glintP[i++] = Gfx.V3(sg * 42.93f, 13.2f, 2.9f);
                glintP[i++] = Gfx.V3(sg * 42.93f, 9.72f, -2.9f);
            }
            var f = new Gfx.Paint(64, 64, false);
            for (int y = 0; y < 64; y++)
                for (int x = 0; x < 64; x++)
                {
                    float d = Mathf.Sqrt((x - 31.5f) * (x - 31.5f) + (y - 31.5f) * (y - 31.5f)) / 32f;
                    Color c = d < 0.35f ? Color.Lerp(new Color(1, 0.94f, 0.7f, 1), new Color(1, 0.55f, 0.12f, 0.8f), d / 0.35f) : d < 1 ? Color.Lerp(new Color(1, 0.55f, 0.12f, 0.8f), new Color(1, 0.24f, 0, 0), (d - 0.35f) / 0.65f) : Color.clear;
                    f.px[y * 64 + x] = c;
                }
            f.Upload();
            fireM = Gfx.Additive(new Color(1.6f, 1.6f, 1.6f, 1), f.tex);
            fireRP = new RenderParams(fireM) { worldBounds = new Bounds(Vector3.zero, new Vector3(2000f, 2000f, 2000f)), shadowCastingMode = ShadowCastingMode.Off, receiveShadows = false };
            cfB = new Batch[3];
            for (int k = 0; k < 3; k++) cfB[k] = new Batch(quad, Gfx.TwoSided(Gfx.Lit(Color.white, 0.4f, 0.2f)), CFN, false, true);
        }

        readonly bool[] flexOn = new bool[2];
        void Polish(float dt)
        {
            // rim shake: the physical rim flex (px, + = bent down; FlexPx: a dunk yanks it, a hard hit rings it, a player
            // hanging on it holds it bent) moves the whole stanchion head; the net's top ring rides the same iron
            wasDk = Util.T(B.dk);
            for (int b = 0; b < 2; b++)
            {
                float flex = (float)FlexPx(b) * 0.1f;
                if (Mathf.Abs(flex) < 1e-4f && !flexOn[b]) continue;
                flexOn[b] = Mathf.Abs(flex) >= 1e-4f;
                float off = -flex;
                foreach (var h in CourtBuilder.HoopParts[b])
                {
                    var lp = h.t.localPosition;
                    lp.y = h.y + off * h.k;
                    h.t.localPosition = lp;
                }
            }
            var cr = cam.transform.rotation;
            // glints: little stars that flash on the rim and the glass edges now and then (bloom makes them sparkle)
            if (QL >= 1)
                for (int k = 0; k < 8; k++)
                {
                    float f = Mathf.Pow(Mathf.Max(0, Mathf.Sin(tm * 0.9f + k * 2.3f)), 24);
                    if (f < 0.03f) continue;
                    float s = f * 1.4f;
                    Graphics.RenderMesh(glintRP, quad, 0, Matrix4x4.TRS(glintP[k], cr, new Vector3(s, s, s)));
                }
            // on-fire trail behind the ball when the last shooter is hot
            if (B.owner == null && B.last != null && B.last.heat >= 3 && QL > 0)
            {
                int i = trK++ % trP.Length;
                trP[i] = PhysXBall.U(B.x, B.y, B.z);
                trS[i] = 1.4f;
            }
            float shrink = Mathf.Pow(0.9f, dt * 60);
            for (int i = 0; i < trP.Length; i++)
            {
                if (trS[i] < 0.15f) continue;
                trS[i] *= shrink;
                Graphics.RenderMesh(fireRP, quad, 0, Matrix4x4.TRS(trP[i], cr, new Vector3(trS[i], trS[i], trS[i])));
            }
            // confetti for the final buzzer (winner's colours + gold + white)
            if (S == "over" && !cfOn)
            {
                cfOn = true;
                int w = sc[0] >= sc[1] ? 0 : 1;
                Gfx.SetColor(cfB[0].mat, Gfx.Hex(PC[w], new Color(1, 0.82f, 0.25f)));
                Gfx.SetColor(cfB[1].mat, new Color(1, 0.82f, 0.25f));
                Gfx.SetColor(cfB[2].mat, Color.white);
                for (int i = 0; i < CFN; i++)
                {
                    cfP[i] = Gfx.V3((Random.value - 0.5f) * 80, 6 + Random.value * 26, (Random.value - 0.5f) * 44);
                    cfA[i] = Random.value * 6.28f;
                    cfS[i] = 0.6f + Random.value * 1.6f;
                    cfW[i] = Random.value * 6.28f;
                }
            }
            if (S != "over") cfOn = false;
            if (cfOn)
            {
                for (int k = 0; k < 3; k++) cfB[k].n = 0;
                var sz = new Vector3(0.36f, 0.24f, 1);
                for (int i = 0; i < CFN; i++)
                {
                    var c = cfP[i];
                    c.y = Mathf.Max(0.05f, c.y - dt * (3.2f + Mathf.Sin(tm * cfS[i] + cfW[i])));
                    c.x += Mathf.Sin(tm * 1.3f + cfW[i]) * dt * 1.2f;
                    cfP[i] = c;
                    float r = c.y > 0.06f ? tm * cfS[i] : 0;
                    cfB[i % 4 == 3 ? 0 : i % 4].Add(c, Quaternion.Euler((r + cfA[i]) * Mathf.Rad2Deg, -r * 0.7f * Mathf.Rad2Deg, cfW[i] * Mathf.Rad2Deg), sz);
                }
                for (int k = 0; k < 3; k++) cfB[k].Draw();
            }
        }

        // ================= benches, head coaches, referees (render3d benchUpd / refsUpd) =================
        sealed class Fig
        {
            public Player p;
            public Batch jer, shorts, skin, shoe, hair, head;
            public float x, z, tx, f, ph; // three.js feet (bench) or game px (refs: x, z = game y)
            public int tm;
            public bool coach, isRef, hasHair;
            public PlayerRig rig; // skinned model (Medium+); capsules on Low
        }
        Transform figRoot;
        readonly List<Fig> bench = new List<Fig>(), refs = new List<Fig>();
        readonly Dictionary<Color, Batch> figCap = new Dictionary<Color, Batch>(), figSph = new Dictionary<Color, Batch>();
        readonly List<Batch> figAll = new List<Batch>();
        readonly Batch[] jerT = new Batch[2], shortT = new Batch[2];
        readonly float[] sk = new float[60];
        float whistle;
        readonly float[] cheerT = new float[2], coachG = new float[2];
        readonly int[] coachK = new int[2];
        readonly double[] lastTO = { 4, 4 }, lastScore = { 0, 0 };
        double lastDS = -1;

        Batch FigB(Dictionary<Color, Batch> d, Color c, int cap)
        {
            if (!d.TryGetValue(c, out var b))
            {
                b = new Batch(d == figCap ? capHi : sphHi, Gfx.Lit(c, 0.3f), cap, true, true);
                d[c] = b;
                figAll.Add(b);
            }
            return b;
        }
        Fig MkFig(string n, Batch jer, Batch shorts, Color skin, double ht, double bk, double hr, bool coach)
        {
            var f = new Fig
            {
                p = new Player { n = n, ht = ht, bk = bk, hr = hr, q = new Q(), skin = "#" + ColorUtility.ToHtmlStringRGB(skin), sg = Hoops.Core.Data.FormOf(n), tm = -1, no = coach ? 0 : 1 + (n.Length * 7) % 40 },
                jer = jer,
                shorts = shorts,
                skin = FigB(figCap, skin, 64),
                shoe = FigB(figCap, coach ? new Color(0.06f, 0.05f, 0.05f) : new Color(0.95f, 0.95f, 0.95f), 64),
                hair = FigB(figSph, new Color(0.07f, 0.06f, 0.05f), 16),
                head = FigB(figSph, skin, 16),
                hasHair = hr > 0,
                coach = coach,
            };
            return f;
        }
        void BuildFigures()
        {
            Color refShirt = Gfx.Hex("#b9bec6", Color.gray), black = new Color(0.06f, 0.06f, 0.07f), suit = Gfx.Hex("#23252e", Color.black);
            var refJ = FigB(figCap, refShirt, 16);
            var pants = FigB(figCap, black, 16);
            var suitB = FigB(figCap, suit, 16);
            for (int t = 0; t < 2; t++)
            {
                var jc = Gfx.Hex(PC[t], Color.gray);
                jerT[t] = new Batch(capHi, Gfx.Lit(jc, 0.3f), 64, true, true);
                shortT[t] = new Batch(capHi, Gfx.Lit(jc * 0.9f, 0.3f), 64, true, true);
                figAll.Add(jerT[t]);
                figAll.Add(shortT[t]);
            }
            string[] SKN2 = { "#e8b88f", "#c68642", "#8d5524", "#6b4226", "#b9825a" };
            for (int k = 0; k < 2; k++)
            {
                var r = MkFig("Ref " + k, refJ, pants, Gfx.Hex(k == 0 ? "#c68642" : "#e8b88f", Color.white), 6.2, 1, 1, true);
                r.isRef = true;
                r.x = 470;
                r.z = k == 1 ? -4 : 120;
                refs.Add(r);
            }
            var rnd = new System.Random(3);
            var seat = Gfx.Lit(new Color(0.12f, 0.13f, 0.2f), 0.4f);
            benchChairB = new Batch(box, seat, 24, true, true);
            for (int tm = 0; tm < 2; tm++)
            {
                float sg = tm == 1 ? 1 : -1;
                for (int k = 0; k <= 4; k++)
                {
                    bool coach = k == 4;
                    var skin = Gfx.Hex(SKN2[(k * 3 + tm) % SKN2.Length], Color.white);
                    var f = coach ? MkFig("Coach " + tm, suitB, suitB, skin, 6.1, 1.15, 1, true) : MkFig("Bench " + tm + k, jerT[tm], shortT[tm], skin, 6.4 + (k % 3) * 0.2, 1, 1 + (k + tm) % 3, false);
                    f.tm = tm;
                    f.x = coach ? sg * 13 : sg * (9 + k * 2.6f);
                    f.z = coach ? -24.2f : -25.6f;
                    f.tx = sg * 13;
                    f.ph = (float)rnd.NextDouble() * 6;
                    bench.Add(f);
                    if (!coach)
                    {
                        // seat under the hips (thighs run toward the court) + a backrest
                        benchChairB.Add(Gfx.V3(f.x, 1.25f, f.z + 0.35f), Quaternion.identity, new Vector3(1.3f, 0.22f, 1.3f));
                        benchChairB.Add(Gfx.V3(f.x, 2.1f, f.z - 0.45f), Quaternion.identity, new Vector3(1.3f, 1.5f, 0.2f));
                        benchChairB.Add(Gfx.V3(f.x, 0.6f, f.z + 0.35f), Quaternion.identity, new Vector3(0.15f, 1.2f, 0.15f));
                    }
                }
            }
        }

        static void SetQ(Q q, double tL, double tR, double kL, double kR, double cr, double ln)
        {
            q.tL = tL; q.tR = tR; q.kL = kL; q.kR = kR; q.cr = cr; q.ln = ln;
        }
        static void SetArms(Q q, double aL, double aR, double eL, double eR, double sz, double zL)
        {
            q.aL = aL; q.aR = aR; q.eL = eL; q.eR = eR; q.sz = sz; q.zL = zL;
        }

        void BenchUpd(float dt)
        {
            for (int t = 0; t < 2; t++)
            {
                if (sc[t] > lastScore[t])
                {
                    if (sc[t] - lastScore[t] >= 3 || Random.value < 0.5f) cheerT[t] = 2.2f;
                    lastScore[t] = sc[t];
                }
                else if (sc[t] < lastScore[t]) lastScore[t] = sc[t];
                cheerT[t] = Mathf.Max(0, cheerT[t] - dt);
                if (TS.to[t] < lastTO[t]) { coachG[t] = 1.6f; coachK[t] = 2; } // timeout: hands make the T
                lastTO[t] = TS.to[t];
                if (TS.run[0] == t && TS.run[1] >= 8) cheerT[t] = Mathf.Max(cheerT[t], 0.3f); // the bench is up for the run
                coachG[t] = Mathf.Max(0, coachG[t] - dt);
            }
            double dsk = TS.ds[0] + TS.ds[1] * 10 + TS.pc[0] * 100 + TS.pc[1] * 1000 + pos * 10000;
            if (dsk != lastDS)
            {
                // new possession or a new call: the coach signals the play
                lastDS = dsk;
                int t = (int)pos & 1;
                if (coachG[t] <= 0) { coachG[t] = 1.2f; coachK[t] = 1; }
            }
            foreach (var b in bench)
            {
                var q = b.p.q;
                bool up = cheerT[b.tm] > 0;
                q.hz = q.hs = q.fL = q.fR = q.nk = q.hp = q.hy = q.wL = q.wR = q.oL = q.oR = q.ty = q.rz = q.cx = q.cy = q.hL = q.hR = 0;
                q.gL = q.gR = 0.3;
                if (b.coach)
                {
                    // pace along the sideline in front of his bench; arms folded, arms out when his team scores
                    if (Mathf.Abs(b.tx - b.x) < 0.2f) b.tx = (b.tm == 1 ? 1 : -1) * (9 + Random.value * 10);
                    float dir = Mathf.Sign(b.tx - b.x), v = 2.2f;
                    b.x += dir * v * dt;
                    b.ph += v * dt * 2.4f;
                    float s = Mathf.Sin(b.ph);
                    SetQ(q, s * 0.35, -s * 0.35, Mathf.Max(0, -s) * 0.5, Mathf.Max(0, s) * 0.5, 0, 0.04);
                    b.f += ((dir >= 0 ? 0 : Mathf.PI) - b.f) * Mathf.Min(1, dt * 6);
                    int g2 = coachG[b.tm] > 0 ? coachK[b.tm] : 0;
                    bool hud = TS.hud > 0 && TS.hud < 2.6;
                    if (hud)
                    {
                        // timeout: he walks to the back of his team's huddle and draws up the play
                        b.tx = (b.tm == 1 ? 1 : -1) * 13;
                        if (Mathf.Abs(b.tx - b.x) < 0.3f)
                        {
                            b.x = b.tx;
                            float d = Mathf.Sin(tm * 5) * 0.25f;
                            SetQ(q, 0, 0, 0, 0, 0, 0.25);
                            SetArms(q, 0.95, 1.15 + d, 1.7, 1.35 - d, 0.05, -0.1);
                            b.f = Mathf.PI / 2;
                        }
                        else SetArms(q, 1.05, 1.05, 2.2, 2.2, -0.35, -0.35);
                    }
                    else if (g2 != 0)
                    {
                        b.tx = b.x; // stop and coach
                        if (g2 == 1) SetArms(q, 1.0, 2.7, 1.9, 0.2, 0.2, -0.3); // play call: arm up
                        else if (g2 == 2) SetArms(q, 2.9, 1.55, 0.05, 0.05, 0.0, 0.4); // T for timeout
                        else
                        {
                            float sh = Mathf.Sin(tm * 7) * 0.2f;
                            SetArms(q, 1.0 + sh, 1.0 - sh, 0.8, 0.8, 0.6, 0.6); // what was that?!
                            q.ln = -0.1;
                        }
                        b.f = Mathf.PI / 2;
                    }
                    else if (up) SetArms(q, 0.9, 0.9, 0.6, 0.6, 0.9, 0.9);
                    else SetArms(q, 1.05, 1.05, 2.2, 2.2, -0.35, -0.35);
                }
                else
                {
                    // seated: thighs level, shins down; standing and waving arms when his team scores
                    float w = Mathf.Sin(tm * 9 + b.x) * 0.3f;
                    if (up) { SetQ(q, 0, 0, 0.05, 0.05, 0, -0.05); SetArms(q, 2.7 + w, 2.7 - w, 0.3, 0.3, 0.4, 0.4); }
                    else { SetQ(q, 1.5, 1.45, 1.5, 1.5, 4.1, 0.12); SetArms(q, 0.6, 0.55, 1.3, 1.3, 0.2, 0.2); }
                    b.f = Mathf.PI / 2; // facing the court
                }
                b.p.x = b.x * 10 + 470;
                b.p.y = b.z * 10 + 250;
                b.p.z = 0;
                b.p.f = b.f;
                FigDraw(b);
            }
        }

        void RefsUpd(float dt)
        {
            whistle = Mathf.Max(0, whistle - dt);
            double hx = hoop(pos);
            float dir = hx > 470 ? 1 : -1;
            bool r0Closer = System.Math.Abs(B.x - refs[0].x) < System.Math.Abs(B.x - refs[1].x);
            for (int k = 0; k < refs.Count; k++)
            {
                var r = refs[k];
                // lead: baseline on the far side of the ball; trail: far sideline, a step behind the play
                float tx = k == 0 ? (float)hx + dir * 46 : Mathf.Clamp((float)B.x - dir * 110, 60, 880),
                    ty = k == 0 ? (B.y < 250 ? 380 : 120) : -4,
                    dx = tx - r.x, dy = ty - r.z, d = Mathf.Sqrt(dx * dx + dy * dy);
                bool calling = whistle > 0 && (k == 0) == r0Closer;
                float v = calling ? 0 : Mathf.Min(150, d * 2);
                if (d > 3) { r.x += dx / d * v * dt; r.z += dy / d * v * dt; }
                r.ph += v * dt / (float)stepLen(v) * Mathf.PI;
                float tf = Mathf.Atan2((float)B.y - r.z, (float)B.x - r.x), df = tf - r.f;
                r.f += Mathf.Atan2(Mathf.Sin(df), Mathf.Cos(df)) * Mathf.Min(1, dt * 5);
                float s = Mathf.Sin(r.ph), walk = Mathf.Min(1, v / 60);
                var q = r.p.q;
                q.hz = q.hs = q.fL = q.fR = q.nk = q.hp = q.hy = q.wL = q.wR = q.oL = q.oR = q.ty = q.rz = q.cx = q.cy = q.hL = q.hR = 0;
                q.gL = q.gR = 0.3;
                SetQ(q, s * 0.4 * walk, -s * 0.4 * walk, Mathf.Max(0, -s) * 0.55 * walk, Mathf.Max(0, s) * 0.55 * walk, 0, 0.03);
                SetArms(q, 0.15 + s * 0.3 * walk, 0.15 - s * 0.3 * walk, 0.4, 0.4, 0.1, 0.1);
                if (calling) { SetArms(q, 0.9, 2.95, 1.2, 0.05, 0.15, 0.4); q.gR = 0.9; } // whistle: fist straight up
                r.p.x = r.x;
                r.p.y = r.z;
                r.p.z = 0;
                r.p.f = r.f;
                FigDraw(r);
            }
        }

        Vector3 J(int i) => PhysXBall.U(sk[i * 3], sk[i * 3 + 1], sk[i * 3 + 2]);
        /// <summary>Capsule figure from the core's 20-joint FK (Pose.skeleton) - the same look as PlayerDraw.</summary>
        void FigDraw(Fig f)
        {
            if (QL >= 1)
            {
                // the same skinned model as the players: refs in their grey shirts, coaches in suits, the bench in
                // the team's colours (rebuilt when the matchup changes)
                string want = f.isRef ? "#b9bec6" : f.coach ? "#23252e" : PC[f.tm];
                if (f.rig == null || f.p.col != want)
                {
                    f.rig?.Destroy();
                    f.p.col = want;
                    if (figRoot == null) figRoot = new GameObject("Figures").transform;
                    f.rig = PlayerRig.Build(f.p, figRoot, 0); // bench / refs: low detail
                }
                if (!f.rig.go.activeSelf) f.rig.go.SetActive(true);
                f.rig.ApplyPose(f.p);
                return;
            }
            if (f.rig != null && f.rig.go.activeSelf) f.rig.go.SetActive(false);
            Hoops.Core.Pose.skeleton(f.p, sk);
            float b = (float)f.p.bk;
            f.jer.Seg(J(0), J(1), 0.5f * b);
            f.jer.Seg(J(12), J(16), 0.26f * b);
            f.shorts.Seg(J(4), J(8), 0.36f * b);
            f.skin.Seg(J(1), J(2), 0.17f);
            Vector3 nk = J(2), top = J(3), hc = Vector3.Lerp(nk, top, 0.55f);
            f.head.Add(hc, Quaternion.identity, new Vector3(0.62f, 0.78f, 0.68f));
            if (f.hasHair) f.hair.Add(hc + (top - nk).normalized * 0.12f, Quaternion.identity, new Vector3(0.66f, 0.5f, 0.7f));
            for (int s = 0; s < 2; s++)
            {
                int h = 4 + s * 4, sh = 12 + s * 4;
                Vector3 hip = J(h), kn = J(h + 1);
                f.shorts.Seg(hip, Vector3.Lerp(hip, kn, 0.55f), (f.coach ? 0.22f : 0.3f) * b);
                (f.coach ? f.shorts : f.skin).Seg(Vector3.Lerp(hip, kn, 0.45f), kn, f.coach ? 0.2f : 0.24f);
                (f.coach ? f.shorts : f.skin).Seg(kn, J(h + 2), f.coach ? 0.17f : 0.18f);
                f.shoe.Seg(J(h + 2), J(h + 3), 0.17f);
                f.jer.Seg(J(sh), J(sh + 1), (f.coach || f.isRef ? 0.15f : 0.13f) * b);
                (f.coach || f.isRef ? f.jer : f.skin).Seg(J(sh + 1), J(sh + 2), 0.12f * b);
                f.skin.Seg(J(sh + 2), J(sh + 3), 0.1f);
            }
        }
        void FigsDraw()
        {
            foreach (var b in figAll) { b.Draw(); b.n = 0; }
            benchChairB.Draw();
        }

        // ================= street set (half-court modes): asphalt, chain-link fence, streetlights =================
        void BuildStreet()
        {
            var a = new Gfx.Paint(1024, 545);
            var rnd = new System.Random(9);
            float R() => (float)rnd.NextDouble();
            a.Clear(new Color32(59, 61, 66, 255));
            for (int i = 0; i < 26000; i++)
            {
                int g = 40 + (int)(R() * 40), x = (int)(R() * 1024), y = (int)(R() * 545), w = 1 + (int)(R() * 2);
                var c = new Color32((byte)g, (byte)g, (byte)(g + 4), 255);
                for (int yy = y; yy < Mathf.Min(545, y + w); yy++) for (int xx = x; xx < Mathf.Min(1024, x + w); xx++) a.px[yy * 1024 + xx] = Color32.Lerp(a.px[yy * 1024 + xx], c, 0.35f + R() * 0.4f);
            }
            for (int i = 0; i < 14; i++)
            {
                float px = R() * 1024, py = R() * 545;
                for (int j = 0; j < 8; j++)
                {
                    float nx = px + (R() - 0.5f) * 45, ny = py + (R() - 0.5f) * 45;
                    for (float t = 0; t <= 1; t += 0.02f) { int x = (int)Mathf.Lerp(px, nx, t), y = (int)Mathf.Lerp(py, ny, t); if (x >= 0 && x < 1024 && y >= 0 && y < 545) a.px[y * 1024 + x] = new Color32(20, 20, 22, 255); }
                    px = nx; py = ny;
                }
            }
            // painted lines in game coords (row = game y, like the court)
            float K = 1024 / 940f;
            var ln = new Color32(240, 240, 236, 255);
            void Dot(float gx, float gy) { int x = (int)(gx * K), y = (int)(gy * K); for (int yy = y - 1; yy <= y + 1; yy++) for (int xx = x - 1; xx <= x + 1; xx++) if (xx >= 0 && xx < 1024 && yy >= 0 && yy < 545) a.px[yy * 1024 + xx] = ln; }
            void Line(float x0, float y0, float x1, float y1) { float l = Mathf.Max(Mathf.Abs(x1 - x0), Mathf.Abs(y1 - y0)); for (float t = 0; t <= l; t += 0.5f) Dot(Mathf.Lerp(x0, x1, t / l), Mathf.Lerp(y0, y1, t / l)); }
            void Arc(float cx, float cy, float r, float a0, float a1) { for (float t = a0; t <= a1; t += 0.4f / r) Dot(cx + Mathf.Cos(t) * r, cy + Mathf.Sin(t) * r); }
            Line(2, 2, 938, 2); Line(2, 498, 938, 498); Line(2, 2, 2, 498); Line(938, 2, 938, 498); Line(470, 0, 470, 500);
            Arc(470, 250, 60, 0, 6.3f);
            for (int s = -1; s <= 1; s += 2)
            {
                float e = s < 0 ? 0 : 940, lx = e - s * 190, hx = (float)HXs[s < 0 ? 0 : 1];
                Line(e, 170, lx, 170); Line(e, 330, lx, 330); Line(lx, 170, lx, 330);
                Arc(lx, 250, 60, 0, 6.3f);
                Line(e, 30, hx - s * 88, 30); Line(e, 470, hx - s * 88, 470);
                if (s < 0) Arc(hx, 250, 237.5f, -1.19f, 1.19f); else Arc(hx, 250, 237.5f, Mathf.PI - 1.19f, Mathf.PI + 1.19f);
            }
            a.Upload();
            var qm = new Mesh { vertices = new[] { PhysXBall.U(0, 0, 0), PhysXBall.U(940, 0, 0), PhysXBall.U(940, 500, 0), PhysXBall.U(0, 500, 0) }, uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) }, triangles = new[] { 0, 2, 1, 0, 3, 2 } };
            qm.RecalculateNormals();
            if (qm.normals[0].y < 0) { qm.triangles = new[] { 0, 1, 2, 0, 2, 3 }; qm.RecalculateNormals(); }
            var sm = Gfx.Lit(Color.white, 0.05f);
            Gfx.SetTex(sm, a.tex);
            streetObjs.Add(Gfx.Obj("Asphalt", qm, sm, new Vector3(0, 0.012f, 0), Quaternion.identity, Vector3.one, root, false));
            streetObjs.Add(Gfx.Obj("StreetApron", box, Gfx.Lit(new Color(0.17f, 0.17f, 0.19f), 0.02f), new Vector3(0, -0.02f, 0), Quaternion.identity, new Vector3(130, 0.04f, 80), root, false));
            // chain-link fence: a diamond-mesh alpha texture on four panels
            var fc = new Gfx.Paint(64, 64, true, TextureWrapMode.Repeat);
            fc.Clear(new Color32(199, 204, 210, 0));
            for (int i = 0; i < 64; i++)
                for (int d = -1; d <= 1; d++)
                {
                    int y1 = (32 - i + 64 + d) % 64, y2 = (32 + i + d) % 64;
                    fc.px[y1 * 64 + i].a = 255;
                    fc.px[y2 * 64 + i].a = 255;
                }
            fc.Upload();
            float[,] fen = { { 120, 0, -34, 0 }, { 120, 0, 34, 0 }, { 68, -60, 0, 90 }, { 68, 60, 0, 90 } };
            for (int i = 0; i < 4; i++)
            {
                var fm = Gfx.Cutout(Gfx.Lit(Color.white, 0.6f, 0.6f), 0.3f);
                Gfx.SetTex(fm, fc.tex);
                fm.SetTextureScale("_BaseMap", new Vector2(fen[i, 0] / 1.2f, 12 / 1.2f));
                streetObjs.Add(Gfx.Obj("Fence", quad, fm, Gfx.V3(fen[i, 1], 6, fen[i, 2]), Quaternion.Euler(0, -fen[i, 3], 0), new Vector3(fen[i, 0], 12, 1), root, false));
            }
            var poleM = Gfx.Lit(new Color(0.23f, 0.24f, 0.27f), 0.5f, 0.7f);
            var lampM = Gfx.Unlit(new Color(4, 3.4f, 2.5f));
            var pole = Gfx.Cylinder(0.25f, 0.3f, 26, 10);
            for (int sx = -1; sx <= 1; sx += 2)
                for (int sz = -1; sz <= 1; sz += 2)
                {
                    streetObjs.Add(Gfx.Obj("Pole", pole, poleM, Gfx.V3(sx * 30, 13, sz * 32), Quaternion.identity, Vector3.one, root));
                    streetObjs.Add(Gfx.Obj("Lamp", box, lampM, Gfx.V3(sx * 30, 26, sz * 32 * 0.92f), Quaternion.identity, new Vector3(2.6f, 0.5f, 1.2f), root, false));
                }
            foreach (var o in streetObjs) o.SetActive(false);
        }
        void SetStreet(bool on)
        {
            streetOn = on;
            foreach (var o in streetObjs) o.SetActive(on);
            foreach (var o in arenaObjs) o.SetActive(!on && (!shafts.Contains(o) || shaftsOn));
            if (CourtBuilder.Floor != null) CourtBuilder.Floor.SetActive(!on);
            if (CourtBuilder.Apron != null) CourtBuilder.Apron.SetActive(!on);
            cam.backgroundColor = on ? new Color(0.435f, 0.56f, 0.72f) : BG;
            RenderSettings.fogColor = on ? new Color(0.54f, 0.64f, 0.77f) : BG;
            if (probe != null) probeT = 0;
        }

        // ================= floor reflections: realtime box-projected probe (High) =================
        ReflectionProbe probe;
        float probeT;
        void BuildProbe()
        {
            var g = new GameObject("FloorReflections");
            g.transform.SetParent(root, false);
            g.transform.position = new Vector3(0, 5, 0);
            probe = g.AddComponent<ReflectionProbe>();
            probe.mode = ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
            probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.IndividualFaces;
            probe.resolution = 256;
            probe.hdr = true;
            probe.boxProjection = true;
            probe.size = new Vector3(190, 90, 130);
            probe.center = new Vector3(0, 35, 0);
            probe.nearClipPlane = 0.5f;
            probe.farClipPlane = 250;
            probe.clearFlags = ReflectionProbeClearFlags.SolidColor;
            probe.backgroundColor = BG;
            probe.importance = 1;
            probe.intensity = 1;
            probe.enabled = false;
        }
    }

    public sealed partial class Arena
    {
        // ================= quality ladder + frame-rate guard =================
        float settle, ema = 16.7f;
        int nf, good, bad, lastQL = -1, lastHSR = -2, lastHSRM = -1, dn, dgood;
        float ceilS = 1f, ceilT;
        bool lastFX = true, shaftsOn = true;

        /// <summary>Ladder (top -> bottom): everything; -SSAO; -reflections/motion blur; -bloom/grade; -shadows, shafts
        /// and half the crowd; 85% resolution; 75% (render3d fxLevel).</summary>
        void Apply()
        {
            lastQL = QL;
            lastFX = FxOn;
            bool on = FxOn && QL > 0;
            Post?.Apply(QL, Lvl, on);
            bool refl = on && QL >= 2 && Lvl >= 5;
            if (probe != null && probe.enabled != refl) { probe.enabled = refl; probeT = 0; }
            if (CourtBuilder.Key != null) CourtBuilder.Key.shadows = QL > 0 && Lvl >= 3 ? LightShadows.Soft : LightShadows.None;
            shaftsOn = QL >= 1 && Lvl >= 3;
            foreach (var o in shafts) o.SetActive(shaftsOn && !streetOn);
        }

        /// <summary>Judged every 30 frames (5 when crawling): > 21 ms drops a rung (2 when > 34 ms); at rung 0 two more
        /// slow verdicts lower the graphics tier for this session; climbs back after ~2 s of fast frames.</summary>
        void Guard(float dt)
        {
            if (QL != lastQL || FxOn != lastFX) { Lvl = 6; Apply(); settle = 0.7f; }
            if (HSR != lastHSR || HSRM != lastHSRM)
            {
                lastHSR = HSR;
                lastHSRM = HSRM;
                if (HSR > 1) HsrScale = HSRS[HSR];
                Apply();
                settle = 0.5f;
            }
            if (settle > 0) { settle -= dt; ema = 16.7f; return; }
            if (dt > 0.25f) return; // hidden tab / hitch / pause menu: don't judge
            ema = ema * 0.9f + Mathf.Min(1000, dt * 1000) * 0.1f;
            // HSR Auto (hsr.ts makeDynRes): drop the internal scale fast when frames are late, probe up slowly when on
            // time, remember the scale that failed for 8 s; the effects ladder below only moves once it sits at .45
            const float lo = 0.45f;
            bool dyn = HSR == 1;
            if (dyn && ++dn >= 12)
            {
                dn = 0;
                float tgt = TargetMs(), s0 = HsrScale, now = Time.unscaledTime;
                if (ema > tgt * 1.12f) { dgood = 0; ceilS = HsrScale; ceilT = now + 8; HsrScale = Mathf.Max(lo, HsrScale * Mathf.Clamp(Mathf.Sqrt(tgt / ema), 0.8f, 0.95f)); }
                else if (ema < tgt * 1.04f) { if (++dgood >= 8 && HsrScale < 1) { dgood = 0; float cap = now < ceilT ? ceilS - 0.04f : 1f; if (HsrScale + 0.01f < cap) HsrScale = Mathf.Min(1f, cap, HsrScale + 0.05f); } }
                else dgood = 0;
                HsrScale = Mathf.Round(HsrScale * 100) / 100;
                if (HsrScale != s0) { Apply(); settle = 0.12f; return; }
            }
            if (++nf <= (ema > 60 ? 5 : 30)) return;
            nf = 0;
            int old = Lvl, oq = QL;
            if (ema > 21 && dyn && HsrScale > lo + 0.001f) good = 0; // still room to lower the resolution
            else if (ema > 21)
            {
                good = 0;
                if (Lvl > 0) Lvl = Mathf.Max(0, Lvl - (ema > 34 ? 2 : 1));
                else if (QL > 0 && ++bad >= 2)
                {
                    bad = 0;
                    QL--;
                    FX.Add(new Fx { k = "ban", s = "GRAPHICS LOWERED", sub = "to " + (QL == 0 ? "Low" : "Medium") + " for a smoother game", c = "#9fe7ff" });
                }
            }
            else if (ema < 13 && Lvl < 6 && ++good >= 4) { good = 0; Lvl++; }
            if (Lvl != old || QL != oq) { Apply(); settle = 0.35f; }
            Fps = 1000 / ema;
        }

        // ================= events + per-frame =================
        string kPC0, kPC1, kCl0, kCl1;
        double lastTot = -1;

        /// <summary>Read the sim's effects before the shell drains them (crowd noise, whistles, near misses, shake).</summary>
        public void OnFx(List<Fx> list)
        {
            for (int i = 0; i < list.Count; i++)
            {
                var f = list[i];
                switch (f.k)
                {
                    case "x": exc = Mathf.Max(exc, Mathf.Clamp01((float)f.v)); break;
                    case "whistle":
                        whistle = 1.3f;
                        if (f.hasTm && (f.tm == 0 || f.tm == 1)) { coachG[(int)f.tm] = 1.6f; coachK[(int)f.tm] = 3; }
                        break;
                    case "ooh": reactK = 1; reactT = 1.6f; break;
                    case "duck":
                        reactK = 2; reactT = 1.1f;
                        reactX = (float)(((f.x ?? 470) - 470) * 0.1);
                        reactZ = (float)(((f.y ?? 250) - 250) * 0.1);
                        break;
                    case "shake": CameraDirector.Shake((float)f.v); break;
                }
            }
        }

        void TeamColors()
        {
            if (ReferenceEquals(kPC0, PC[0]) && ReferenceEquals(kPC1, PC[1]) && ReferenceEquals(kCl0, cl[0]) && ReferenceEquals(kCl1, cl[1])) return;
            kPC0 = PC[0]; kPC1 = PC[1]; kCl0 = cl[0]; kCl1 = cl[1];
            CourtBuilder.PaintCourt(PC[0], PC[1], cl[0], cl[1]);
            LedDraw();
            Color c0 = Gfx.Hex(PC[0], new Color(0.48f, 0.25f, 0.71f)), c1 = Gfx.Hex(PC[1], new Color(0.11f, 0.26f, 0.54f));
            Gfx.SetColor(bodyM[0], c0);
            Gfx.SetColor(bodyM[1], c1);
            Gfx.SetColor(towB[0].mat, c0);
            for (int t = 0; t < 2; t++)
            {
                var c = t == 0 ? c0 : c1;
                Gfx.SetColor(jerT[t].mat, c);
                var sc2 = c * 0.9f;
                sc2.a = 1;
                Gfx.SetColor(shortT[t].mat, sc2);
            }
            // per-arena grade: a whisper of the home team's colour in the light
            float mx = Mathf.Max(0.01f, Mathf.Max(c0.r, Mathf.Max(c0.g, c0.b)));
            Post?.Tint(Color.Lerp(Color.white, new Color(c0.r / mx, c0.g / mx, c0.b / mx), 0.07f));
            Jumbo(true);
            probeT = 0;
        }

        /// <summary>Per frame, after the sim ticks (GameMain.Update).</summary>
        public void Tick(float dt)
        {
            tm += dt;
            frame++;
            Guard(dt);
            TeamColors();
            bool st = cfg.HALF != 0;
            if (st != streetOn) SetStreet(st);
            // the building gets loud on every basket; sometimes the wave starts
            double tot = sc[0] + sc[1];
            if (tot != lastTot)
            {
                if (lastTot >= 0 && tot > lastTot)
                {
                    exc = 1;
                    if (Random.value < 0.3f && waveT <= 0) { waveT = 6; waveA = Random.value * 6.283f; }
                }
                lastTot = tot;
            }
            exc = Mathf.Max(0.3f, exc - 0.24f * dt);
            if (!streetOn)
            {
                tierB.Draw();
                int n = QL == 0 ? 0 : QL == 1 || Lvl < 3 ? 1300 : CN;
                crowdDt += dt;
                if ((frame & 1) == 0 || n != crowdN) { CrowdUpd(n, crowdDt); crowdDt = 0; crowdN = n; }
                if (n > 0) CrowdDraw();
                if (QL > 0)
                {
                    Courtside(dt, exc);
                    BenchUpd(dt);
                    if (cfg.HALF == 0) RefsUpd(dt);
                    FigsDraw();
                }
                Jumbo(false);
                // LED ribbons crawl
                float o = (float)(tm * 0.04 % 1.0);
                ledM.SetTextureOffset("_BaseMap", new Vector2(o, 0));
                ringM.SetTextureOffset("_BaseMap", new Vector2(-o, 0));
            }
            ShotClocks();
            NetUpd();
            BlobUpd();
            Polish(dt);
            // floor reflections: re-capture the bowl every few seconds (time-sliced, High only)
            if (probe != null && probe.enabled && (probeT -= dt) <= 0) { probe.RenderProbe(); probeT = 3; }
        }
    }

    /// <summary>URP post-processing hooks (implemented in Urp/PostFx.cs, which needs the URP assemblies).</summary>
    public interface IPostFx
    {
        void Init(Camera cam);
        /// <summary>ql 0 Low .. 2 High, lvl = frame-rate ladder rung 6 (everything) .. 0, on = effects enabled.</summary>
        void Apply(int ql, int lvl, bool on);
        /// <summary>Replay depth of field focus distance (ft); off when &lt;= 0.</summary>
        void Dof(float focus);
        /// <summary>Per-arena colour grade tint (a whisper of the home team's colour).</summary>
        void Tint(Color c);
        /// <summary>Motion blur amount 0..1 (big moments only).</summary>
        void Motion(float amt);
    }

    /// <summary>Meshes and materials made from code (stock URP shaders only).</summary>
    public static class Gfx
    {
        static Shader lit, unlit, part;
        static Mesh cube;

        /// <summary>three.js world (feet, right-handed) -> Unity (Z mirrored).</summary>
        public static Vector3 V3(double x, double y, double z) => new Vector3((float)x, (float)y, -(float)z);

        static readonly Dictionary<string, Color> hexC = new Dictionary<string, Color>();
        public static Color Hex(string h, Color fb)
        {
            if (string.IsNullOrEmpty(h)) return fb;
            if (!hexC.TryGetValue(h, out var c)) hexC[h] = c = ColorUtility.TryParseHtmlString(h, out var cc) ? cc : fb;
            return c;
        }
        public static Color32 C32(Color c) => (Color32)c;

        public static Material Lit(Color c, float smooth = 0.35f, float metal = 0f)
        {
            if (lit == null) lit = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(lit) { enableInstancing = true, color = c };
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smooth);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metal);
            return m;
        }
        public static Material Unlit(Color c, Texture t = null)
        {
            if (unlit == null) unlit = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Texture");
            var m = new Material(unlit) { enableInstancing = true };
            SetColor(m, c);
            if (t != null) SetTex(m, t);
            return m;
        }
        /// <summary>Additive (URP Particles/Unlit): light shafts, glints, fire.</summary>
        public static Material Additive(Color c, Texture t)
        {
            if (part == null) part = Shader.Find("Universal Render Pipeline/Particles/Unlit") ?? Shader.Find("Legacy Shaders/Particles/Additive");
            var m = new Material(part) { enableInstancing = true };
            SetColor(m, c);
            if (t != null) SetTex(m, t);
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 2); // additive
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.One);
            m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_DstBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_ZWrite", 0);
            m.SetFloat("_Cull", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.SetOverrideTag("RenderType", "Transparent");
            m.renderQueue = (int)RenderQueue.Transparent + 5;
            return m;
        }
        /// <summary>Alpha-blended (premul = keep the specular of glass at low alpha). Works for URP Lit and Unlit.</summary>
        public static Material Transparent(Material m, bool premul = false)
        {
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", premul ? 1 : 0);
            m.SetFloat("_SrcBlend", premul ? (float)BlendMode.One : (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            if (premul) m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            m.SetOverrideTag("RenderType", "Transparent");
            m.renderQueue = (int)RenderQueue.Transparent;
            return m;
        }
        /// <summary>Alpha-tested (chain-link fence).</summary>
        public static Material Cutout(Material m, float cut)
        {
            m.SetFloat("_AlphaClip", 1);
            m.SetFloat("_Cutoff", cut);
            m.EnableKeyword("_ALPHATEST_ON");
            m.renderQueue = (int)RenderQueue.AlphaTest;
            return TwoSided(m);
        }
        public static Material TwoSided(Material m)
        {
            m.SetFloat("_Cull", 0);
            m.doubleSidedGI = true;
            return m;
        }
        public static void SetColor(Material m, Color c)
        {
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
        }
        public static void SetTex(Material m, Texture t)
        {
            m.mainTexture = t;
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", t);
        }

        public static Mesh Cube()
        {
            if (cube != null) return cube;
            var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube = g.GetComponent<MeshFilter>().sharedMesh;
            Object.Destroy(g);
            return cube;
        }

        /// <summary>Surface of revolution about +Y from a (radius, y) profile running upward; outward normals from the
        /// profile tangent, u around, v along the profile, white vertex colours (the particles shader multiplies them).</summary>
        public static Mesh Lathe(Vector2[] pr, int seg)
        {
            int n = pr.Length, W = seg + 1;
            var v = new Vector3[n * W];
            var nm = new Vector3[n * W];
            var uv = new Vector2[n * W];
            var col = new Color32[n * W];
            var tri = new int[(n - 1) * seg * 6];
            for (int i = 0; i < n; i++)
            {
                Vector2 t = pr[Mathf.Min(n - 1, i + 1)] - pr[Mathf.Max(0, i - 1)];
                var n2 = new Vector2(t.y, -t.x).normalized;
                for (int j = 0; j <= seg; j++)
                {
                    float a = j / (float)seg * Mathf.PI * 2, ca = Mathf.Cos(a), sa = Mathf.Sin(a);
                    int k = i * W + j;
                    v[k] = new Vector3(pr[i].x * ca, pr[i].y, pr[i].x * sa);
                    nm[k] = new Vector3(n2.x * ca, n2.y, n2.x * sa);
                    uv[k] = new Vector2(j / (float)seg, i / (float)(n - 1));
                    col[k] = new Color32(255, 255, 255, 255);
                }
            }
            int q = 0;
            for (int i = 0; i < n - 1; i++)
                for (int j = 0; j < seg; j++)
                {
                    int a = i * W + j, b = a + 1, c = a + W + 1, d = a + W;
                    tri[q++] = a; tri[q++] = d; tri[q++] = c;
                    tri[q++] = a; tri[q++] = c; tri[q++] = b;
                }
            var m = new Mesh { vertices = v, normals = nm, uv = uv, colors32 = col, triangles = tri };
            m.RecalculateBounds();
            m.RecalculateTangents();
            return m;
        }
        /// <summary>Unit capsule like Unity's primitive (radius .5, height 2, along Y), low poly.</summary>
        public static Mesh Capsule(int seg = 8, int rings = 3)
        {
            var pr = new Vector2[(rings + 1) * 2];
            for (int i = 0; i <= rings; i++)
            {
                float a = -Mathf.PI / 2 + i / (float)rings * Mathf.PI / 2;
                pr[i] = new Vector2(0.5f * Mathf.Cos(a), -0.5f + 0.5f * Mathf.Sin(a));
                float b = i / (float)rings * Mathf.PI / 2;
                pr[rings + 1 + i] = new Vector2(0.5f * Mathf.Cos(b), 0.5f + 0.5f * Mathf.Sin(b));
            }
            return Lathe(pr, seg);
        }
        /// <summary>Unit sphere (radius .5).</summary>
        public static Mesh Sphere(int seg = 10, int rings = 8)
        {
            var pr = new Vector2[rings + 1];
            for (int i = 0; i <= rings; i++)
            {
                float a = -Mathf.PI / 2 + i / (float)rings * Mathf.PI;
                pr[i] = new Vector2(0.5f * Mathf.Cos(a), 0.5f * Mathf.Sin(a));
            }
            return Lathe(pr, seg);
        }
        /// <summary>Open cylinder / cone from y0 (radius r0) to y1 (radius r1).</summary>
        public static Mesh Tube(float r0, float y0, float r1, float y1, int seg) => Lathe(new[] { new Vector2(r0, y0), new Vector2(r1, y1) }, seg);
        /// <summary>Closed cylinder (caps) centred at the origin.</summary>
        public static Mesh Cylinder(float rTop, float rBot, float h, int seg) =>
            Lathe(new[] { new Vector2(0, -h / 2), new Vector2(rBot, -h / 2), new Vector2(rBot, -h / 2), new Vector2(rTop, h / 2), new Vector2(rTop, h / 2), new Vector2(0, h / 2) }, seg);
        /// <summary>Horizontal ring (about +Y): ring radius R, tube radius r.</summary>
        public static Mesh Torus(float R, float r, int seg, int tube)
        {
            var pr = new Vector2[tube + 1];
            for (int i = 0; i <= tube; i++)
            {
                float a = -Mathf.PI + i / (float)tube * Mathf.PI * 2;
                pr[i] = new Vector2(R + r * Mathf.Cos(a), r * Mathf.Sin(a));
            }
            return Lathe(pr, seg);
        }
        /// <summary>Unit quad in XY facing -Z (seen from -Z: u right, v up). Orient with LookRotation(-normal, up).</summary>
        public static Mesh Quad()
        {
            var m = new Mesh
            {
                vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) },
                normals = new[] { Vector3.back, Vector3.back, Vector3.back, Vector3.back },
                colors32 = new[] { new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255) },
                triangles = new[] { 0, 3, 2, 0, 2, 1 },
            };
            m.RecalculateBounds();
            m.RecalculateTangents();
            return m;
        }
        /// <summary>Rotation that turns Quad() to face the outward direction n.</summary>
        public static Quaternion Facing(Vector3 n) => Quaternion.LookRotation(-n, Mathf.Abs(n.y) > 0.9f ? Vector3.forward : Vector3.up);

        public static GameObject Obj(string name, Mesh mesh, Material mat, Vector3 pos, Quaternion rot, Vector3 scale, Transform parent, bool shadows = true)
        {
            var g = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            g.transform.SetParent(parent, false);
            g.transform.localPosition = pos;
            g.transform.localRotation = rot;
            g.transform.localScale = scale;
            g.GetComponent<MeshFilter>().sharedMesh = mesh;
            var r = g.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            r.receiveShadows = true;
            return g;
        }

        /// <summary>A runtime-painted texture with its pixel buffer (paint, then Upload()).</summary>
        public sealed class Paint
        {
            public readonly int W, H;
            public readonly Color32[] px;
            public readonly Texture2D tex;
            public Paint(int w, int h, bool mips = true, TextureWrapMode wrap = TextureWrapMode.Clamp)
            {
                W = w; H = h;
                px = new Color32[w * h];
                tex = new Texture2D(w, h, TextureFormat.RGBA32, mips) { wrapMode = wrap, anisoLevel = 4, filterMode = FilterMode.Bilinear };
            }
            public void Clear(Color32 c) { for (int i = 0; i < px.Length; i++) px[i] = c; }
            /// <summary>Rect in y-down pixel coords (row 0 = top of the image as seen on a quad).</summary>
            public void Rect(int x, int y, int w, int h, Color32 c)
            {
                for (int yy = Mathf.Max(0, y); yy < Mathf.Min(H, y + h); yy++)
                    for (int xx = Mathf.Max(0, x); xx < Mathf.Min(W, x + w); xx++) px[(H - 1 - yy) * W + xx] = c;
            }
            public void Text(string s, int cx, int cy, int sc, Color32 c, int align = 0, float italic = 0) => BitFont.Draw(px, W, H, s, cx, cy, sc, c, true, align, italic);
            public void Upload() { tex.SetPixels32(px); tex.Apply(tex.mipmapCount > 1); }
        }
    }

    /// <summary>One instanced draw list: mesh + material + matrices (drawn in chunks of 1023).</summary>
    public sealed class Batch
    {
        public readonly Mesh mesh;
        public readonly Material mat;
        public RenderParams rp;
        public readonly Matrix4x4[] mx;
        public int n;
        public Batch(Mesh mesh, Material mat, int cap, bool cast = true, bool recv = true)
        {
            this.mesh = mesh;
            this.mat = mat;
            mx = new Matrix4x4[Mathf.Max(1, cap)];
            rp = new RenderParams(mat) { shadowCastingMode = cast ? ShadowCastingMode.On : ShadowCastingMode.Off, receiveShadows = recv, worldBounds = new Bounds(Vector3.zero, new Vector3(400, 200, 400)) };
        }
        public void Add(in Matrix4x4 m) { if (n < mx.Length) mx[n++] = m; }
        public void Add(Vector3 p, Quaternion r, Vector3 s) { if (n < mx.Length) mx[n++] = Matrix4x4.TRS(p, r, s); }
        /// <summary>A segment a -> b drawn with a unit capsule/cylinder (radius .5, height 2 along Y).</summary>
        public void Seg(Vector3 a, Vector3 b, float r)
        {
            var d = b - a;
            float len = d.magnitude;
            var rot = len > 1e-5f ? Quaternion.FromToRotation(Vector3.up, d / len) : Quaternion.identity;
            Add((a + b) * 0.5f, rot, new Vector3(2 * r, (len + 2 * r) * 0.5f, 2 * r));
        }
        public void Draw()
        {
            if (!SystemInfo.supportsInstancing) { for (int i = 0; i < n; i++) Graphics.RenderMesh(rp, mesh, 0, mx[i]); return; } // (no instancing: one call each, never invisible)
            for (int s = 0; s < n; s += 1023) Graphics.RenderMeshInstanced(rp, mesh, 0, mx, Mathf.Min(1023, n - s), s);
        }
    }

    /// <summary>Tiny 5x7 bitmap font (digits, A-Z, a little punctuation) for painted textures.</summary>
    public static class BitFont
    {
        static Dictionary<char, byte[]> G;
        static void Init()
        {
            G = new Dictionary<char, byte[]>();
            void D(char c, params byte[] rows) => G[c] = rows;
            D('0', 0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E); D('1', 0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E);
            D('2', 0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F); D('3', 0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E);
            D('4', 0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02); D('5', 0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E);
            D('6', 0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E); D('7', 0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08);
            D('8', 0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E); D('9', 0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C);
            D('A', 0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11); D('B', 0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E);
            D('C', 0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E); D('D', 0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C);
            D('E', 0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F); D('F', 0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10);
            D('G', 0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F); D('H', 0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11);
            D('I', 0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E); D('J', 0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C);
            D('K', 0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11); D('L', 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F);
            D('M', 0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11); D('N', 0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11);
            D('O', 0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E); D('P', 0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10);
            D('Q', 0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D); D('R', 0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11);
            D('S', 0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E); D('T', 0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04);
            D('U', 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E); D('V', 0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04);
            D('W', 0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A); D('X', 0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11);
            D('Y', 0x11, 0x11, 0x11, 0x0A, 0x04, 0x04, 0x04); D('Z', 0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F);
            D('-', 0, 0, 0, 0x1F, 0, 0, 0); D(':', 0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0);
            D('%', 0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03); D('/', 0, 0x01, 0x02, 0x04, 0x08, 0x10, 0);
            D('.', 0, 0, 0, 0, 0, 0x0C, 0x0C); D('!', 0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04);
            D('#', 0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A); D('\'', 0x04, 0x04, 0x08, 0, 0, 0, 0);
            D('*', 0, 0x04, 0x15, 0x0E, 0x15, 0x04, 0); D('?', 0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04);
            D('&', 0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D); D(' ', 0, 0, 0, 0, 0, 0, 0);
        }
        public static int Width(string s, int sc) => s.Length == 0 ? 0 : s.Length * 6 * sc - sc;

        /// <summary>Draw s anchored at (x, cy): align 0 = x is the centre, -1 = left edge, 1 = right edge; cy = vertical
        /// centre (y down). flip: the buffer's row 0 is the bottom (Texture2D on a quad). rot 1 / -1 turns the text 90
        /// degrees (canvas rotate(+-pi/2)) about the anchor. italic = x shear per row.</summary>
        public static void Draw(Color32[] px, int W, int H, string s, int x, int cy, int sc, Color32 c, bool flip, int align = 0, float italic = 0, int rot = 0)
        {
            if (G == null) Init();
            if (string.IsNullOrEmpty(s)) return;
            int w = Width(s, sc), h = 7 * sc;
            int ox0 = align == 0 ? -w / 2 : align < 0 ? 0 : -w, oy0 = -h / 2;
            for (int k = 0; k < s.Length; k++)
            {
                char ch = char.ToUpperInvariant(s[k]);
                if (!G.TryGetValue(ch, out var g)) g = G['?'];
                for (int r = 0; r < 7; r++)
                {
                    int bits = g[r];
                    if (bits == 0) continue;
                    for (int col = 0; col < 5; col++)
                    {
                        if ((bits & (0x10 >> col)) == 0) continue;
                        int sh = (int)((6 - r) * sc * italic);
                        for (int yy = 0; yy < sc; yy++)
                            for (int xx = 0; xx < sc; xx++)
                            {
                                int ox = ox0 + k * 6 * sc + col * sc + xx + sh, oy = oy0 + r * sc + yy, X, Y;
                                if (rot == 0) { X = x + ox; Y = cy + oy; }
                                else if (rot > 0) { X = x - oy; Y = cy + ox; }
                                else { X = x + oy; Y = cy - ox; }
                                if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                                px[(flip ? H - 1 - Y : Y) * W + X] = c;
                            }
                    }
                }
            }
        }
    }
}

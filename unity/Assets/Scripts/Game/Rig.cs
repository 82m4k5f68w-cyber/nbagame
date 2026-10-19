// Skinned player model (port of src/client/rig3d.ts): one SkinnedMeshRenderer per player on a bone hierarchy that
// mirrors the core's joint model exactly (Core Pose.RIG offsets; Pose.handPos stays the true release point).
// The geometry (lofted anatomy, painted uniform, face, hair, shoes, prints) comes from RigMesh.cs (UnityEngine-free,
// tested by unity/CoreTests/RigMeshCheck.cs); here it becomes a Mesh: colours live in one shared palette Texture2D
// (each vertex's UV points at its texel), one submesh per material class (skin, jersey knit, prints, cloth/hair,
// leather, gloss), jersey prints from a 512 atlas painted with a built-in bitmap font + outline.
//
// Frames: three.js is right-handed (W3 = [(x-470)*.1, z*.1, (y-250)*.1]); here Unity = three with Z flipped
// (PhysXBall.U). So geometry is built exactly as rig3d builds it (three space, CCW fronts) and mirrored at the end
// (z -> -z keeps fronts: Unity fronts are clockwise), bone offsets get z negated, and a three Euler (x, y, z, order)
// becomes the Unity rotation with the X and Y angles negated, composed in the same order (M Rx(a) M = Rx(-a),
// M Ry(a) M = Ry(-a), M Rz(a) M = Rz(a), M = diag(1, 1, -1)). unity/CoreTests/RigCheck.cs verifies the chain.
using System;
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Pose;

namespace Hoops.Game
{
    public sealed class PlayerRig
    {
        // ---- bone indices (same order as rig3d's `names`) ----
        public const int HIPS = 0, BD = 1, TL = 2, TR = 3, KL = 4, KR = 5, SL = 6, SR = 7, EL = 8, ER = 9, WL = 10, WR = 11,
            CH = 12, NK = 13, HD = 14, AL = 15, AR = 16, GL = 17, GR = 18, FLL = 19, FLR = 20, TFL = 21, TFR = 22, HEM = 23,
            JW = 24, MI = 25, MO = 26, CL = 27, CR = 28, BRL = 29, BRR = 30, LL = 31, LR = 32, YL = 33, YR = 34, NB = 35;
        public const int XYZ = 0, YXZ = 1, XZY = 2;

        public GameObject go;
        public Transform G;
        public SkinnedMeshRenderer smr;
        public readonly Transform[] bn = new Transform[NB];
        public Player p;
        // three-space Euler components the later passes read back (rig3d reads bone.rotation.x/z)
        readonly float[] thx = new float[2], thz = new float[2], knx = new float[2], anx = new float[2];
        float bdx, bdz;
        // cloth / hem springs, foot plants
        readonly float[] cx = new float[2], cvx = new float[2], cz = new float[2], cvz = new float[2];
        float hx, hvx, hz, hvz, hpx, hpz;
        readonly bool[] plOn = new bool[2];
        readonly Vector3[] plP = new Vector3[2];
        readonly float[] plW = new float[2];
        readonly Vector3[] fr = new Vector3[8]; // face rest positions (Unity local): corners, brows, lids, irises
        static readonly float L1 = (float)RIG.L1, L2 = (float)RIG.L2;

        // ---------------------------------------------------------------- rotations
        static Quaternion AX(float a) { a *= 0.5f; return new Quaternion(Mathf.Sin(a), 0, 0, Mathf.Cos(a)); }
        static Quaternion AY(float a) { a *= 0.5f; return new Quaternion(0, Mathf.Sin(a), 0, Mathf.Cos(a)); }
        static Quaternion AZ(float a) { a *= 0.5f; return new Quaternion(0, 0, Mathf.Sin(a), Mathf.Cos(a)); }
        /// <summary>three.js Euler (x, y, z, order) -> the same rotation in the Z-mirrored Unity frame.</summary>
        public static Quaternion E(float x, float y, float z, int order)
        {
            Quaternion qx = AX(-x), qy = AY(-y), qz = AZ(z);
            return order == XYZ ? qx * qy * qz : order == YXZ ? qy * qx * qz : qx * qz * qy;
        }
        static Quaternion EX(float x) => AX(-x);


        // ---------------------------------------------------------------- colours
        /// <summary>three's Color(hex) (linear). Vertex colours then take one more sRGB->linear step on purpose (rig3d):
        /// the palette stores these linear values as sRGB texels, so the shader sees linear(linear(hex)).</summary>
        static Color Lin(string hex)
        {
            if (hex == null || !ColorUtility.TryParseHtmlString(hex, out var c)) c = Color.gray;
            return c.linear;
        }

        const int PALN = 64;
        static Texture2D palette;
        static readonly Dictionary<Color32, int> palIdx = new();
        static Vector2 PalUV(Color c)
        {
            if (palette == null)
            {
                palette = new Texture2D(PALN, PALN, TextureFormat.RGBA32, false, false) { filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp, name = "RigPalette" };
                var px = new Color32[PALN * PALN];
                for (int i = 0; i < px.Length; i++) px[i] = new Color32(255, 255, 255, 255);
                palette.SetPixels32(px);
            }
            Color32 k = c;
            k.a = 255;
            if (!palIdx.TryGetValue(k, out int i0))
            {
                i0 = Math.Min(palIdx.Count, PALN * PALN - 1);
                palIdx[k] = i0;
                palette.SetPixel(i0 % PALN, i0 / PALN, k);
                palDirty = true;
            }
            return new Vector2((i0 % PALN + 0.5f) / PALN, (i0 / PALN + 0.5f) / PALN);
        }
        static bool palDirty;

        // ---------------------------------------------------------------- materials
        // submeshes: 0 skin + lips, 1 jersey knit, 2 prints, 3 cloth / hair / rubber, 4 shoe leather, 5 gloss (eyes, teeth)
        const int SUBS = 6;
        static Shader lit;
        static Material skinMat, clothMat, leatherMat, glossMat;
        static Texture2D knitA, knitN;
        static readonly Dictionary<Color32, Material> jerseyMats = new();
        static Material NewLit(float smooth, float metal)
        {
            if (lit == null) lit = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(lit);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smooth);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metal);
            return m;
        }
        static void SetMap(Material m, Texture t)
        {
            m.mainTexture = t;
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", t);
        }
        static void SetCol(Material m, Color c)
        {
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
        }
        /// <summary>Palette-coloured materials per class (roughness: skin .52, cloth/hair .85, leather .4, gloss .16 - the
        /// browser's data-texture swatches).</summary>
        static Material PalMat(ref Material m, string name, float smooth)
        {
            if (m == null)
            {
                m = NewLit(smooth, 0f);
                m.name = name;
            }
            if (palDirty) { palette.Apply(false); palDirty = false; }
            SetMap(m, palette);
            return m;
        }
        /// <summary>Jersey mesh fabric: tiling knit of little ventilation holes (albedo + normal map from the height).</summary>
        static void Knit()
        {
            if (knitA != null) return;
            const int N = 64;
            var hgt = new float[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float hv = 1;
                    for (int j = 0; j < 4; j++)
                        for (int i = 0; i < 4; i++)
                        {
                            float cx = 8 + i * 16 + (j % 2) * 8, cy = 8 + j * 16;
                            for (int wx = -1; wx <= 1; wx++)
                                for (int wy = -1; wy <= 1; wy++)
                                {
                                    float dx = (x + 0.5f - cx - wx * N) / 3.2f, dy = (y + 0.5f - cy - wy * N) / 2.6f, d = Mathf.Sqrt(dx * dx + dy * dy);
                                    hv = Mathf.Min(hv, Mathf.Lerp(0.42f, 1f, Mathf.Clamp01((d - 0.8f) / 0.4f)));
                                }
                        }
                    hgt[y * N + x] = hv;
                }
            knitA = new Texture2D(N, N, TextureFormat.RGBA32, true, false) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 8, name = "Knit" };
            knitN = new Texture2D(N, N, TextureFormat.RGBA32, true, true) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 8, name = "KnitN" };
            var a = new Color32[N * N];
            var nm = new Color32[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float hv = hgt[y * N + x], g = 0.86f + 0.14f * hv;
                    a[y * N + x] = new Color(g, g, g, 1);
                    float dx = (hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N]) * 1.6f,
                        dy = (hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x]) * 1.6f;
                    var n = new Vector3(-dx, -dy, 1).normalized;
                    nm[y * N + x] = new Color32((byte)(n.x * 127.5f + 127.5f), (byte)(n.y * 127.5f + 127.5f), (byte)(n.z * 127.5f + 127.5f), 255);
                }
            knitA.SetPixels32(a);
            knitA.Apply(true);
            knitN.SetPixels32(nm);
            knitN.Apply(true);
        }
        static Material JerseyMat(Color lin)
        {
            Color32 k = lin;
            if (jerseyMats.TryGetValue(k, out var m)) return m;
            Knit();
            m = NewLit(0.2f, 0.02f);
            m.name = "Jersey";
            SetMap(m, knitA);
            SetCol(m, lin); // = linear(linear(hex)) after Unity's own sRGB->linear on the colour (matches the palette)
            if (m.HasProperty("_BumpMap"))
            {
                m.SetTexture("_BumpMap", knitN);
                m.SetFloat("_BumpScale", 0.6f);
                m.EnableKeyword("_NORMALMAP");
            }
            jerseyMats[k] = m;
            return m;
        }
        static Material DecalMat(Texture2D t)
        {
            var m = NewLit(0.38f, 0f);
            m.name = "JerseyPrint";
            SetMap(m, t);
            SetCol(m, Color.white);
            // alpha-tested (no sorting): URP Lit _AlphaClip + _ALPHATEST_ON
            if (m.HasProperty("_AlphaClip")) m.SetFloat("_AlphaClip", 1);
            if (m.HasProperty("_Cutoff")) m.SetFloat("_Cutoff", 0.5f);
            m.EnableKeyword("_ALPHATEST_ON");
            m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.AlphaTest;
            return m;
        }
        // ---------------------------------------------------------------- jersey prints (tiny bitmap font)
        // 5x7 glyphs, one row per entry, bit 4 = leftmost column
        static readonly Dictionary<char, int[]> FONT = new()
        {
            ['0'] = new[] { 14, 17, 19, 21, 25, 17, 14 }, ['1'] = new[] { 4, 12, 4, 4, 4, 4, 14 }, ['2'] = new[] { 14, 17, 1, 2, 4, 8, 31 },
            ['3'] = new[] { 30, 1, 1, 14, 1, 1, 30 }, ['4'] = new[] { 2, 6, 10, 18, 31, 2, 2 }, ['5'] = new[] { 31, 16, 30, 1, 1, 17, 14 },
            ['6'] = new[] { 6, 8, 16, 30, 17, 17, 14 }, ['7'] = new[] { 31, 1, 2, 4, 8, 8, 8 }, ['8'] = new[] { 14, 17, 17, 14, 17, 17, 14 },
            ['9'] = new[] { 14, 17, 17, 15, 1, 2, 12 }, ['A'] = new[] { 14, 17, 17, 31, 17, 17, 17 }, ['B'] = new[] { 30, 17, 17, 30, 17, 17, 30 },
            ['C'] = new[] { 14, 17, 16, 16, 16, 17, 14 }, ['D'] = new[] { 30, 17, 17, 17, 17, 17, 30 }, ['E'] = new[] { 31, 16, 16, 30, 16, 16, 31 },
            ['F'] = new[] { 31, 16, 16, 30, 16, 16, 16 }, ['G'] = new[] { 14, 17, 16, 23, 17, 17, 15 }, ['H'] = new[] { 17, 17, 17, 31, 17, 17, 17 },
            ['I'] = new[] { 14, 4, 4, 4, 4, 4, 14 }, ['J'] = new[] { 7, 2, 2, 2, 2, 18, 12 }, ['K'] = new[] { 17, 18, 20, 24, 20, 18, 17 },
            ['L'] = new[] { 16, 16, 16, 16, 16, 16, 31 }, ['M'] = new[] { 17, 27, 21, 21, 17, 17, 17 }, ['N'] = new[] { 17, 17, 25, 21, 19, 17, 17 },
            ['O'] = new[] { 14, 17, 17, 17, 17, 17, 14 }, ['P'] = new[] { 30, 17, 17, 30, 16, 16, 16 }, ['Q'] = new[] { 14, 17, 17, 17, 21, 18, 13 },
            ['R'] = new[] { 30, 17, 17, 30, 20, 18, 17 }, ['S'] = new[] { 15, 16, 16, 14, 1, 1, 30 }, ['T'] = new[] { 31, 4, 4, 4, 4, 4, 4 },
            ['U'] = new[] { 17, 17, 17, 17, 17, 17, 14 }, ['V'] = new[] { 17, 17, 17, 17, 17, 10, 4 }, ['W'] = new[] { 17, 17, 17, 21, 21, 21, 10 },
            ['X'] = new[] { 17, 17, 10, 4, 10, 17, 17 }, ['Y'] = new[] { 17, 17, 10, 4, 4, 4, 4 }, ['Z'] = new[] { 31, 1, 2, 4, 8, 16, 31 },
            ['-'] = new[] { 0, 0, 0, 31, 0, 0, 0 }, ['.'] = new[] { 0, 0, 0, 0, 0, 12, 12 }, ['\''] = new[] { 4, 4, 8, 0, 0, 0, 0 },
        };
        /// <summary>Upper-case ASCII for the print (accents dropped: Dončić -> DONCIC).</summary>
        static string Plain(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var d = s.Normalize(System.Text.NormalizationForm.FormD);
            var b = new System.Text.StringBuilder();
            foreach (var ch in d)
                if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) != System.Globalization.UnicodeCategory.NonSpacingMark) b.Append(char.ToUpperInvariant(ch));
            return b.ToString();
        }
        /// <summary>Paints white text centred in a pixel rectangle of the alpha buffer (4x4 supersampled, optional italic
        /// shear). Glyph cells are sized to fit both the box width and maxH.</summary>
        static void Text(float[] A, int W, string s, int x0, int y0, int bw, int bh, float maxH, float italic)
        {
            if (s.Length == 0) return;
            float cell = Mathf.Min(maxH / 7f, (bw - 6) / (s.Length * 6f - 1));
            float tw = (s.Length * 6 - 1) * cell, th = 7 * cell, ox = x0 + (bw - tw) / 2, oy = y0 + (bh - th) / 2;
            for (int y = y0; y < y0 + bh; y++)
                for (int x = x0; x < x0 + bw; x++)
                {
                    int hit = 0;
                    for (int sy = 0; sy < 4; sy++)
                        for (int sx = 0; sx < 4; sx++)
                        {
                            float fy = y + (sy + 0.5f) / 4f, fx = x + (sx + 0.5f) / 4f;
                            float ry = (oy + th - fy) / cell; // row from the top
                            float rx = (fx - ox - italic * (fy - oy)) / cell;
                            if (ry < 0 || ry >= 7 || rx < 0) continue;
                            int gi = (int)(rx / 6), col = (int)(rx - gi * 6), row = (int)ry;
                            if (gi >= s.Length || col >= 5) continue;
                            if (FONT.TryGetValue(s[gi], out var gl) && ((gl[row] >> (4 - col)) & 1) != 0) hit++;
                        }
                    if (hit > 0) A[y * W + x] = Mathf.Max(A[y * W + x], hit / 16f);
                }
        }

        /// <summary>Jersey print atlas (512 x 512, rig3d's layout): number top-left 256 x 256, wordmark row v .25-.5, name
        /// row v 0-.25. Fill in the contrast colour with an outline in the team's secondary (dilated alpha), mipmapped +
        /// anisotropic so the lettering stays crisp.</summary>
        static Texture2D PrintTex(string no, string word, string name, Color fill, Color outline, int W)
        {
            var A = new float[W * W];
            float s = W / 512f;
            Text(A, W, no, 0, (int)(256 * s), (int)(256 * s), (int)(256 * s), 190 * s, 0);
            Text(A, W, word, 0, (int)(128 * s), W, (int)(128 * s), 76 * s, 0.22f);
            Text(A, W, name, 0, 0, W, (int)(128 * s), 64 * s, 0);
            // outline: max filter of the fill alpha over a disc of radius r
            int r = Math.Max(2, (int)(6 * s));
            var O = new float[W * W];
            var tmp = new float[W * W];
            for (int y = 0; y < W; y++)
                for (int x = 0; x < W; x++)
                {
                    float m = 0;
                    for (int d = -r; d <= r; d++) { int xx = x + d; if (xx >= 0 && xx < W) m = Math.Max(m, A[y * W + xx]); }
                    tmp[y * W + x] = m;
                }
            for (int y = 0; y < W; y++)
                for (int x = 0; x < W; x++)
                {
                    float m = 0;
                    for (int d = -r; d <= r; d++) { int yy = y + d; if (yy >= 0 && yy < W) m = Math.Max(m, tmp[yy * W + x]); }
                    O[y * W + x] = m;
                }
            var px = new Color32[W * W];
            for (int i = 0; i < px.Length; i++)
            {
                var c = Color.Lerp(outline, fill, A[i]);
                c.a = Math.Max(A[i], O[i]);
                px[i] = c;
            }
            var t = new Texture2D(W, W, TextureFormat.RGBA32, true, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Trilinear, anisoLevel = 8, name = "Print " + name };
            t.SetPixels32(px);
            t.Apply(true, true);
            return t;
        }

        // ---------------------------------------------------------------- build
        static readonly string[] NAMES = { "hips", "bd", "tl", "tr", "kl", "kr", "sL", "sR", "eL", "eR", "wL", "wR", "ch", "nk", "hd", "al", "ar", "gL", "gR", "flL", "flR", "tfL", "tfR", "hem", "jw", "mi", "mo", "cL", "cR", "brL", "brR", "lL", "lR", "yL", "yR" };

        /// <summary>Cached per-look meshes and print materials (a rematch or a returning sub rebuilds only the bones).</summary>
        sealed class Look { public Mesh mesh; public Material[] mats; }
        static readonly Dictionary<string, Look> looks = new();

        static string Word(Player p) => p.tm >= 0 && p.tm < 2 ? Sim.cl[(int)p.tm] : "";
        static string Key(Player p, int lod) => $"{p.n}|{p.col}|{p.skin}|{p.no}|{p.hr}|{p.bd}|{p.bk}|{Word(p)}|{p.sg?.hs}|{lod}";

        /// <summary>lod: 1 = High-tier detail, 0 = Low / Medium (about 40% of the triangles); -1 = from Arena.QL.</summary>
        public static PlayerRig Build(Player p, Transform parent, int lod = -1)
        {
            if (lod < 0) lod = Arena.QL >= 2 ? 1 : 0;
            var r = new PlayerRig { p = p };
            var off = RigMesh.Offsets(p.bk);
            r.go = new GameObject("Rig " + p.n);
            r.G = r.go.transform;
            r.G.SetParent(parent, false);
            for (int i = 0; i < NB; i++)
            {
                var t = new GameObject(NAMES[i]).transform;
                t.SetParent(RigMesh.PARENT[i] < 0 ? r.G : r.bn[RigMesh.PARENT[i]], false);
                var o = off[i];
                t.localPosition = new Vector3(o.X, o.Y, -o.Z);
                r.bn[i] = t;
            }
            string key = Key(p, lod);
            if (!looks.TryGetValue(key, out var look))
            {
                look = new Look();
                look.mesh = MakeMesh(p, lod, out var print);
                var bp = new Matrix4x4[NB];
                for (int i = 0; i < NB; i++) bp[i] = r.bn[i].worldToLocalMatrix * r.G.localToWorldMatrix;
                look.mesh.bindposes = bp;
                look.mats = new[] { PalMat(ref skinMat, "RigSkin", 0.48f), JerseyMat(Lin(p.col)), DecalMat(print), PalMat(ref clothMat, "RigCloth", 0.15f), PalMat(ref leatherMat, "RigLeather", 0.6f), PalMat(ref glossMat, "RigGloss", 0.84f) };
                looks[key] = look;
            }
            else if (palDirty) { palette.Apply(false); palDirty = false; }
            var smr = r.smr = r.go.AddComponent<SkinnedMeshRenderer>();
            smr.sharedMesh = look.mesh;
            smr.bones = r.bn;
            smr.rootBone = r.bn[HIPS];
            smr.sharedMaterials = look.mats;
            smr.localBounds = new Bounds(new Vector3(0, 3.6f, 0), new Vector3(9, 10, 9)); // RigMeshCheck keeps every vertex inside
            smr.updateWhenOffscreen = false;
            smr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            smr.receiveShadows = true;
            smr.quality = SkinQuality.Bone4;
            for (int s = 0; s < 8; s++) r.fr[s] = r.bn[CL + s].localPosition;
            r.FaceRest();
            r.G.localScale = Vector3.one * (float)(p.ht / 6.4);
            return r;
        }

        public void Destroy()
        {
            if (go != null) UnityEngine.Object.Destroy(go);
            go = null;
        }

        /// <summary>RigMesh (three space) -> Unity Mesh: palette UVs per vertex colour (knit / prints keep their UVs),
        /// one submesh per material class, z mirrored into Unity's frame (fronts stay fronts: Unity fronts are clockwise).</summary>
        static Mesh MakeMesh(Player p, int lod, out Texture2D print)
        {
            var D = RigMesh.Build(p, lod);
            var LK = D.look;
            int nv = D.v.Count;
            var V = new Vector3[nv];
            var N = new Vector3[nv];
            var UV = new Vector2[nv];
            var BW = new BoneWeight[nv];
            var T = new List<int>[SUBS];
            for (int s = 0; s < SUBS; s++) T[s] = new List<int>();
            var palC = new Dictionary<string, Vector2>();
            int[] sub = new int[nv];
            for (int i = 0; i < nv; i++)
            {
                var v = D.v[i];
                var n = D.n[i];
                V[i] = new Vector3(v.X, v.Y, -v.Z);
                N[i] = new Vector3(n.X, n.Y, -n.Z);
                int cls = D.cls[i];
                // the knit submesh is tinted by the jersey colour: other knit-class colours (side panels) use the palette
                if (cls == 1 && !string.Equals(D.col[i], p.col, StringComparison.OrdinalIgnoreCase)) cls = 0;
                sub[i] = cls < 0 ? 2 : cls == 1 ? 1 : cls == 2 || cls == 7 ? 0 : cls == 4 ? 4 : cls == 5 ? 5 : 3;
                if (cls < 0 || cls == 1) UV[i] = new Vector2(D.u[i], D.w[i]);
                else
                {
                    if (!palC.TryGetValue(D.col[i], out var puv)) palC[D.col[i]] = puv = PalUV(Lin(D.col[i]));
                    UV[i] = puv;
                }
                int b = i * 4;
                BW[i] = new BoneWeight
                {
                    boneIndex0 = D.bi[b], weight0 = D.bw[b],
                    boneIndex1 = D.bi[b + 1], weight1 = D.bw[b + 1],
                    boneIndex2 = D.bi[b + 2], weight2 = D.bw[b + 2],
                };
            }
            void add(List<int> tl)
            {
                for (int f = 0; f < tl.Count; f += 3) { var l = T[sub[tl[f]]]; l.Add(tl[f]); l.Add(tl[f + 1]); l.Add(tl[f + 2]); }
            }
            foreach (var tl in D.tri) add(tl);
            add(D.print);
            // jersey prints
            string no = p.no.ToString("0"), word = Plain(Word(p)), last = Plain(p.n ?? "");
            int sp = last.LastIndexOf(' ');
            if (sp >= 0) last = last.Substring(sp + 1);
            if (word.Length > 10) word = word.Substring(0, 10);
            if (last.Length > 12) last = last.Substring(0, 12);
            string outline = Math.Abs(RigLook.Lum(LK.trim) - RigLook.Lum(LK.sec)) < 0.25 ? (RigLook.Lum(LK.trim) > 0.5 ? "#16161c" : "#ffffff") : LK.sec;
            print = PrintTex(no, word, last, ColorUtility.TryParseHtmlString(LK.trim, out var fc) ? fc : Color.white, ColorUtility.TryParseHtmlString(outline, out var oc) ? oc : Color.black, 512);
            var mesh = new Mesh { name = "Player " + p.n };
            if (nv > 65000) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.vertices = V;
            mesh.normals = N;
            mesh.uv = UV;
            mesh.boneWeights = BW;
            mesh.subMeshCount = SUBS;
            for (int s = 0; s < SUBS; s++) mesh.SetTriangles(T[s], s);
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(false);
            return mesh;
        }

        // ---------------------------------------------------------------- per frame
        /// <summary>Joint angles (p.q) -> bone rotations (rig3d applyPose; same mapping as Core Pose.skeleton/handPos).</summary>
        public void ApplyPose(Player p)
        {
            var q = p.q;
            if (q == null) return;
            G.localPosition = new Vector3((float)((p.x - 470) * 0.1), (float)(p.z * 0.1 - q.cr * 0.4), -(float)((p.y - 250) * 0.1));
            G.localRotation = AY(-(float)(Math.PI / 2 - fv(p)));
            thx[0] = -(float)q.tL; thz[0] = (float)hipAb(q, -1);
            thx[1] = -(float)q.tR; thz[1] = (float)hipAb(q, 1);
            knx[0] = (float)q.kL; knx[1] = (float)q.kR;
            anx[0] = (float)q.fL; anx[1] = (float)q.fR;
            for (int s = 0; s < 2; s++)
            {
                bn[TL + s].localRotation = E(thx[s], 0, thz[s], XYZ);
                bn[KL + s].localRotation = EX(knx[s]);
                bn[AL + s].localRotation = EX(anx[s]);
                bn[TFL + s].localRotation = EX(-Mathf.Max(0, anx[s] - 0.15f) * 0.8f); // toe-off: toes stay down
            }
            bn[CH].localRotation = E((float)q.cx, (float)q.cy, 0, YXZ);
            bn[NK].localRotation = EX((float)q.nk);
            bn[HD].localRotation = E((float)q.hp, (float)q.hy, 0, YXZ);
            bn[GL].localRotation = EX(-(float)q.gL * 1.4f);
            bn[GR].localRotation = EX(-(float)q.gR * 1.4f);
            // shoulders XZY: the humeral twist (hL/hR) turns about the upper-arm bone itself
            bn[SL].localRotation = E(-(float)q.aL, (float)q.hL, -(float)q.zL, XZY);
            bn[SR].localRotation = E(-(float)q.aR, -(float)q.hR, (float)q.sz, XZY);
            bn[EL].localRotation = EX(-(float)q.eL);
            bn[ER].localRotation = EX(-(float)q.eR);
            bn[WL].localRotation = E(-(float)q.wL, (float)q.oL, 0, YXZ); // forearm twist then wrist flex
            bn[WR].localRotation = E(-(float)q.wR, (float)q.oR, 0, YXZ);
            bdx = (float)q.ln; bdz = (float)q.rz;
            bn[BD].localRotation = E(bdx, (float)q.ty, bdz, YXZ);
            ApplyFace(p.fc);
        }

        /// <summary>Face at rest: mouth closed, closing lids folded up into the upper eyelid line.</summary>
        void FaceRest()
        {
            bn[MI].localScale = new Vector3(1, 0.001f, 1);
            bn[LL].localScale = bn[LR].localScale = new Vector3(1, 0.02f, 1);
            bn[JW].localRotation = Quaternion.identity;
            bn[MO].localScale = Vector3.one;
            for (int s = 0; s < 8; s++) { bn[CL + s].localPosition = fr[s]; if (s < 4) bn[CL + s].localRotation = Quaternion.identity; }
        }
        /// <summary>Expressions (p.fc from Core face(): jaw, smile, brows, anger, squint, blink, width, eye look) -> face bones.</summary>
        void ApplyFace(FaceState c)
        {
            if (c == null) { FaceRest(); return; }
            float jw = (float)c.jw, sm = (float)c.sm, smp = Mathf.Max(0, sm), wd = (float)c.wd, br = (float)c.br, an = (float)c.an;
            bn[JW].localRotation = EX(jw * 0.3f + smp * 0.05f);
            bn[MI].localScale = new Vector3(1 + wd * 0.25f + smp * 0.2f, Mathf.Max(0.001f, Mathf.Max(jw * 0.95f, smp * 0.32f)), 1);
            bn[MO].localScale = new Vector3(1 + wd * 0.3f + smp * 0.25f + Mathf.Min(0, sm) * 0.15f, 1, 1);
            float lid = Mathf.Max((float)c.bl, Mathf.Max((float)c.sq * 0.5f, smp * 0.22f));
            for (int s = 0; s < 2; s++)
            {
                float sd = s == 1 ? 1 : -1;
                var r0 = fr[s];
                bn[CL + s].localPosition = new Vector3(r0.x + sd * (wd * 0.025f + smp * 0.035f), r0.y + sm * (sm > 0 ? 0.014f : 0.034f), r0.z - smp * 0.006f);
                bn[CL + s].localRotation = AZ(sd * sm * 0.7f);
                var r1 = fr[2 + s];
                bn[BRL + s].localPosition = new Vector3(r1.x, r1.y + br * 0.035f - an * 0.02f, r1.z);
                bn[BRL + s].localRotation = AZ(sd * (an * 0.38f - br * 0.22f));
                bn[LL + s].localScale = new Vector3(1, Mathf.Max(0.02f, lid), 1);
                var r3 = fr[6 + s];
                bn[YL + s].localPosition = new Vector3(r3.x + (float)c.ex * 0.035f, r3.y - (float)c.ey * 0.03f, r3.z);
            }
        }

        /// <summary>Foot planting (rig3d footIK): a stance foot stays where it touched down; two-bone IK in the leg's
        /// sagittal plane reaches it. Fades with the core stepper's own weight (p.stp.w), which already plants feet.</summary>
        public void FootIK(Player p, float dt, bool on)
        {
            bool grounded = on && p.z < 1.5 && (p.mode == "i" || p.mode == "b") && !Util.T(p.postA);
            double sp = Util.Hypot(p.vx, p.vy);
            float stw = p.stp != null ? (float)p.stp.w : 0;
            for (int s = 0; s < 2; s++)
            {
                Transform th = bn[TL + s], kn = bn[KL + s], an = bn[AL + s];
                bool stance = grounded && (sp < 25 || (s == 1 ? Math.Cos(p.ph) > 0.15 : Math.Cos(p.ph) < -0.15));
                var V1 = kn.TransformPoint(0, -L2, 0); // FK ankle (world)
                if (stance && !plOn[s]) { plOn[s] = true; plP[s] = new Vector3(V1.x, Mathf.Min(V1.y, 0.25f), V1.z); }
                if (!stance) plOn[s] = false;
                if (plOn[s] && Mathf.Sqrt((V1.x - plP[s].x) * (V1.x - plP[s].x) + (V1.z - plP[s].z) * (V1.z - plP[s].z)) > 1.4f) plOn[s] = false;
                plW[s] += ((plOn[s] ? 1 : 0) - plW[s]) * Mathf.Min(1, dt * 14);
                if (plW[s] < 0.02f) continue;
                var V2 = th.parent.InverseTransformPoint(plP[s]) - th.localPosition; // hip -> target, parent-local
                float dy = V2.y, dz = -V2.z, // back to three's +z
                    d = Mathf.Min(L1 + L2 - 0.01f, Mathf.Max(0.4f, Mathf.Sqrt(dy * dy + dz * dz)));
                float a1 = Mathf.Acos(Mathf.Clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)),
                    tIK = Mathf.Atan2(dz, -dy) + a1,
                    kIK = Mathf.PI - Mathf.Acos(Mathf.Clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
                float w = plW[s] * (1 - stw), tFK = -thx[s], kFK = knx[s];
                thx[s] = -(tFK + (tIK - tFK) * w);
                knx[s] = kFK + (kIK - kFK) * w;
                float flat = -(thx[s] + knx[s]);
                anx[s] += (flat - anx[s]) * w; // planted foot stays flat
                th.localRotation = E(thx[s], 0, thz[s], XYZ);
                kn.localRotation = EX(knx[s]);
                an.localRotation = EX(anx[s]);
            }
        }

        /// <summary>Shorts-hem flap bones chase their thigh through an underdamped spring (trail, overshoot, lift while
        /// falling); the jersey hem lags the pelvis. Purely visual (rig3d clothStep).</summary>
        public void ClothStep(Player p, float dt)
        {
            float h = Mathf.Min(dt, 1 / 30f);
            if (h <= 0) return;
            bool air = p.z > 2;
            float vz = (float)p.vz;
            for (int s = 0; s < 2; s++)
            {
                float tx = thx[s] + (air ? Mathf.Clamp(-vz * 0.0012f, -0.25f, 0.25f) : 0), tz = thz[s];
                for (int it = 0; it < 2; it++)
                {
                    cvx[s] += ((tx - cx[s]) * 220 - cvx[s] * 13) * (h / 2);
                    cvz[s] += ((tz - cz[s]) * 220 - cvz[s] * 13) * (h / 2);
                    cx[s] += cvx[s] * (h / 2);
                    cz[s] += cvz[s] * (h / 2);
                }
                if (Mathf.Abs(cx[s] - tx) > 1.2f) { cx[s] = tx; cvx[s] = 0; } // teleports
                bn[FLL + s].localRotation = E(cx[s], 0, cz[s], XYZ);
            }
            hvx += (-(bdx - hpx) / h) * 0.35f + ((air ? Mathf.Clamp(-vz * 0.002f, -0.3f, 0.3f) : 0) - hx) * 180 * h - hvx * 11 * h;
            hvz += (-(bdz - hpz) / h) * 0.35f + -hz * 180 * h - hvz * 11 * h;
            hpx = bdx;
            hpz = bdz;
            hx = Mathf.Clamp(hx + hvx * h, -0.5f, 0.5f);
            hz = Mathf.Clamp(hz + hvz * h, -0.5f, 0.5f);
            bn[HEM].localRotation = E(hx, 0, hz, XYZ);
        }

        /// <summary>World position of the shooting palm (the ball while holding): right wrist, the left while a lefty's
        /// shot is mirrored (q.mir). Same point as Core Pose.handPos.</summary>
        public Vector3 Palm(Player p) => bn[p.q != null && Util.T(p.q.mir) ? WL : WR].TransformPoint(0, -0.62f, -0.1f);
    }
}

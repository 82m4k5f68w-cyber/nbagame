// URP post-processing for the arena (port of src/client/fx3d.ts): one global Volume built from code - ACES tonemapping,
// bloom (HDR panels, LED ribbons, glints), colour adjustments (contrast, saturation, exposure, home-team tint),
// vignette, depth of field for replays (Bokeh on High, Gaussian on Medium) and motion blur for big moments - plus the
// SSAO renderer feature (added to the renderer asset by Editor/Build.cs), render scale and SMAA for the quality ladder.
// Registers itself as Arena.Post before the scene loads, so the rest of the game compiles without the URP assemblies.
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Hoops.Game
{
    public sealed class PostFx : IPostFx
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => Arena.Post = new PostFx();

        Camera cam;
        UniversalAdditionalCameraData cd;
        Bloom bloom;
        ColorAdjustments col;
        Vignette vig;
        SplitToning split;
        FilmGrain grain;
        DepthOfField dof;
        MotionBlur mb;
        int ql = 2;
        bool on = true;
        static readonly float[] BASE = { 1f, 1f, 1f }; // render scale per tier (the browser caps DPR at 1 / 1.5 / 2)

        static UniversalRenderPipelineAsset Asset => (QualitySettings.renderPipeline ?? GraphicsSettings.defaultRenderPipeline) as UniversalRenderPipelineAsset;

        public void Init(Camera c)
        {
            cam = c;
            cd = c.GetUniversalAdditionalCameraData();
            cd.renderPostProcessing = true;
            cd.stopNaN = false;
            cd.dithering = true;
            var g = new GameObject("PostFx");
            var vol = g.AddComponent<Volume>();
            vol.isGlobal = true;
            vol.priority = 10;
            var prof = ScriptableObject.CreateInstance<VolumeProfile>();
            vol.sharedProfile = prof;
            var tone = prof.Add<Tonemapping>(true);
            tone.mode.Override(TonemappingMode.ACES);
            bloom = prof.Add<Bloom>(true);
            bloom.threshold.Override(1.1f); // HDR input: only real highlights (panels, LEDs, glints, the lit glass)
            bloom.intensity.Override(0.55f);
            bloom.scatter.Override(0.62f);
            bloom.highQualityFiltering.Override(false);
            col = prof.Add<ColorAdjustments>(true);
            col.postExposure.Override(-0.2f); // three toneMappingExposure .85
            col.contrast.Override(8f);
            col.saturation.Override(8f);
            col.colorFilter.Override(Color.white);
            // graphics v6 (fx3d GradeShader "Broadcast" look): warm highlights / cool shadows + a whisper of film grain
            split = prof.Add<SplitToning>(true);
            split.shadows.Override(new Color(0.47f, 0.5f, 0.56f));
            split.highlights.Override(new Color(0.56f, 0.52f, 0.46f));
            split.balance.Override(10f);
            grain = prof.Add<FilmGrain>(true);
            grain.type.Override(FilmGrainLookup.Thin1);
            grain.intensity.Override(0.12f);
            grain.response.Override(0.85f);
            vig = prof.Add<Vignette>(true);
            vig.intensity.Override(0.24f);
            vig.smoothness.Override(0.45f);
            dof = prof.Add<DepthOfField>(true);
            dof.mode.Override(DepthOfFieldMode.Off);
            mb = prof.Add<MotionBlur>(true);
            mb.quality.Override(MotionBlurQuality.Low);
            mb.intensity.Override(0f);
            mb.active = false;
        }

        public void Apply(int q, int lvl, bool enabled)
        {
            ql = q;
            on = enabled;
            if (cd == null) return;
            bool grade = on && lvl >= 4;
            bloom.active = grade;
            bloom.intensity.Override(ql >= 2 ? 0.6f : 0.45f);
            col.active = grade;
            vig.active = grade;
            split.active = grade;
            grain.active = grade && ql >= 2;
            cd.renderShadows = ql > 0 && lvl >= 3;
            var a = Asset;
            float lk = lvl >= 2 ? 1 : lvl == 1 ? 0.9f : 0.85f;
            int hsr = Arena.HSR;
            // H2K Super Resolution (web: hsr.ts): temporal = URP STP (jitter + motion vectors + history, needs compute
            // shaders: WebGPU / desktop, not WebGL 2), spatial = FSR 1 EASU + RCAS (Low tier, or no compute)
            bool temporal = hsr > 0 && Arena.HSRM != 2 && !(Arena.HSRM == 0 && ql == 0) && SystemInfo.supportsComputeShaders;
            float scale = hsr > 0 ? Mathf.Max(0.25f, Arena.HsrScale * lk) : BASE[Mathf.Clamp(ql, 0, 2)] * lk; // native resolution on every tier unless HSR is on; slow GPUs drop effects first
            cd.antialiasing = temporal ? AntialiasingMode.None : scale < 0.95f ? AntialiasingMode.SubpixelMorphologicalAntiAliasing : AntialiasingMode.None;
            if (a == null) return;
            a.renderScale = scale;
            // a sub-native scale upscales with STP (temporal) or FSR 1 + sharpening (bilinear looked soft)
            a.upscalingFilter = temporal ? UpscalingFilterSelection.STP : scale < 0.99f ? UpscalingFilterSelection.FSR : UpscalingFilterSelection.Auto;
            a.fsrOverrideSharpness = true;
            a.fsrSharpness = 0.92f;
            a.msaaSampleCount = ql == 0 || temporal ? 1 : 4; // STP is the anti-aliasing (MSAA off, like the web temporal path)
            a.shadowDistance = ql >= 2 ? 60 : 45;
            // SSAO (High, top rung): the renderer feature Build.cs adds to the renderer asset
            var rd = a.rendererDataList;
            for (int i = 0; i < rd.Length; i++)
                if (rd[i] != null)
                    foreach (var f in rd[i].rendererFeatures)
                        if (f is ScreenSpaceAmbientOcclusion) f.SetActive(on && ql >= 2 && lvl >= 6);
        }

        public void Dof(float focus)
        {
            if (dof == null) return;
            if (focus <= 0 || !on) { dof.mode.Override(DepthOfFieldMode.Off); return; }
            if (ql >= 2)
            {
                dof.mode.Override(DepthOfFieldMode.Bokeh);
                dof.focusDistance.Override(focus);
                dof.focalLength.Override(70f);
                dof.aperture.Override(4.5f);
            }
            else
            {
                dof.mode.Override(DepthOfFieldMode.Gaussian);
                dof.gaussianStart.Override(focus + 3);
                dof.gaussianEnd.Override(focus + 30);
                dof.gaussianMaxRadius.Override(1f);
            }
        }

        public void Tint(Color c) { if (col != null) col.colorFilter.Override(c); }

        public void Motion(float amt)
        {
            if (mb == null) return;
            mb.active = amt > 0.001f;
            mb.intensity.Override(0.35f * amt);
        }
    }
}

// Batch-mode build for Hoops 2K27 (Unity). Applies the fastest player settings, makes sure the URP pipeline asset
// exists, creates the one-object bootstrap scene and builds WebGL.
//   Unity -batchmode -nographics -quit -projectPath unity -executeMethod Build.WebGL
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class Build
{
    const string PipePath = "Assets/Settings/URP.asset";

    /// <summary>Performance settings: IL2CPP speed codegen, high stripping, no exceptions, JS-side Brotli fallback
    /// (works from any static host), WebGPU first with WebGL2 fallback, SRP Batcher, linear color.</summary>
    public static void ConfigurePerformance()
    {
        var web = NamedBuildTarget.WebGL;
        PlayerSettings.SetScriptingBackend(web, ScriptingImplementation.IL2CPP);
        PlayerSettings.SetIl2CppCodeGeneration(web, Il2CppCodeGeneration.OptimizeSpeed);
        PlayerSettings.SetIl2CppCompilerConfiguration(web, Il2CppCompilerConfiguration.Master);
        PlayerSettings.SetManagedStrippingLevel(web, ManagedStrippingLevel.High);
        PlayerSettings.stripEngineCode = true;
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.gpuSkinning = true;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true; // no server headers needed
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
        PlayerSettings.WebGL.powerPreference = WebGLPowerPreference.HighPerformance;
        // the HTML game's hub / menus over the canvas (Assets/WebGLTemplates/Hoops, PageBridge.cs, HoopsUi.jslib)
        PlayerSettings.WebGL.template = "PROJECT:Hoops";
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.WebGL, new[] { GraphicsDeviceType.WebGPU, GraphicsDeviceType.OpenGLES3 });
        PlayerSettings.runInBackground = true; // a hosting tab keeps simulating online
        PlayerSettings.productName = "Hoops 2K27";
        PlayerSettings.companyName = "Hoops2K27";
        EditorUserBuildSettings.SetPlatformSettings("WebGL", "CodeOptimization", "RuntimeSpeedLTO");

        var pipe = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipePath);
        if (pipe == null)
        {
            AssetDatabase.CreateFolder("Assets", "Settings");
            var rd = ScriptableObject.CreateInstance<UniversalRendererData>();
            AssetDatabase.CreateAsset(rd, "Assets/Settings/URP_Renderer.asset");
            pipe = UniversalRenderPipelineAsset.Create(rd);
            AssetDatabase.CreateAsset(pipe, PipePath);
        }
        pipe.useSRPBatcher = true;
        pipe.supportsHDR = true;
        pipe.msaaSampleCount = 4;
        pipe.shadowDistance = 45f;
        pipe.shadowCascadeCount = 2;
        ArenaPipeline(pipe);
        GraphicsSettings.defaultRenderPipeline = pipe;
        // materials are made at runtime with Shader.Find: ship URP Lit even though no asset references it
        var gs = new SerializedObject(AssetDatabase.LoadAssetAtPath<Object>("ProjectSettings/GraphicsSettings.asset"));
        var inc = gs.FindProperty("m_AlwaysIncludedShaders");
        var lit = Shader.Find("Universal Render Pipeline/Lit");
        bool has = false;
        for (int i = 0; i < inc.arraySize; i++) has |= inc.GetArrayElementAtIndex(i).objectReferenceValue == lit;
        if (!has && lit != null)
        {
            inc.InsertArrayElementAtIndex(inc.arraySize);
            inc.GetArrayElementAtIndex(inc.arraySize - 1).objectReferenceValue = lit;
            gs.ApplyModifiedProperties();
        }
        // arena (Arena.cs): unlit LED/jumbotron/panels + additive light shafts / glints; Hud.cs GL shapes (meters, rings)
        foreach (var sn in new[] { "Universal Render Pipeline/Unlit", "Universal Render Pipeline/Particles/Unlit", "Hidden/Internal-Colored" })
        {
            var sh = Shader.Find(sn);
            bool hs = false;
            for (int i = 0; i < inc.arraySize; i++) hs |= inc.GetArrayElementAtIndex(i).objectReferenceValue == sh;
            if (hs || sh == null) continue;
            inc.InsertArrayElementAtIndex(inc.arraySize);
            inc.GetArrayElementAtIndex(inc.arraySize - 1).objectReferenceValue = sh;
            gs.ApplyModifiedProperties();
        }
        // every material is made at runtime (none in the build uses instancing), so the default "strip unused
        // instancing variants" removed URP Lit's instanced variant and Graphics.RenderMeshInstanced drew nothing
        // (invisible players / crowd). Keep them all.
        var istrip = gs.FindProperty("m_InstancingStripping");
        if (istrip != null && istrip.intValue != 2) { istrip.intValue = 2; gs.ApplyModifiedProperties(); } // 2 = KeepAll
        // keyboard via the built-in Input Manager (UnityEngine.Input)
        var ps = new SerializedObject(AssetDatabase.LoadAssetAtPath<Object>("ProjectSettings/ProjectSettings.asset"));
        var ih = ps.FindProperty("activeInputHandler");
        if (ih != null && ih.intValue != 0) { ih.intValue = 0; ps.ApplyModifiedProperties(); }
        QualitySettings.renderPipeline = pipe;
        QualitySettings.vSyncCount = 0;
        AssetDatabase.SaveAssets();
    }

    /// <summary>Arena look (Arena.cs / Urp/PostFx.cs): post-processing resources on the renderer (a renderer made with
    /// CreateInstance has none, so the Volume did nothing), an SSAO renderer feature (PostFx toggles it per quality
    /// rung), box-projected reflection probes for the floor reflections.</summary>
    static void ArenaPipeline(UniversalRenderPipelineAsset pipe)
    {
        var rd = pipe.rendererDataList.Length > 0 ? pipe.rendererDataList[0] as UniversalRendererData : null;
        if (rd != null)
        {
            if (rd.postProcessData == null)
            {
                rd.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
                EditorUtility.SetDirty(rd);
            }
            if (!rd.TryGetRendererFeature<ScreenSpaceAmbientOcclusion>(out _))
            {
                var ao = ScriptableObject.CreateInstance<ScreenSpaceAmbientOcclusion>();
                ao.name = "SSAO";
                AssetDatabase.AddObjectToAsset(ao, rd);
                AssetDatabase.SaveAssets(); // assigns the sub-asset its local file id
                AssetDatabase.TryGetGUIDAndLocalFileIdentifier(ao, out _, out long id);
                var so = new SerializedObject(rd);
                var f = so.FindProperty("m_RendererFeatures");
                var mp = so.FindProperty("m_RendererFeatureMap");
                f.InsertArrayElementAtIndex(f.arraySize);
                f.GetArrayElementAtIndex(f.arraySize - 1).objectReferenceValue = ao;
                mp.InsertArrayElementAtIndex(mp.arraySize);
                mp.GetArrayElementAtIndex(mp.arraySize - 1).longValue = id;
                so.ApplyModifiedProperties();
                rd.SetDirty();
                EditorUtility.SetDirty(rd);
            }
        }
        var ps = new SerializedObject(pipe);
        var bp = ps.FindProperty("m_ReflectionProbeBoxProjection");
        if (bp != null && !bp.boolValue) { bp.boolValue = true; ps.ApplyModifiedProperties(); }
        EditorUtility.SetDirty(pipe);
    }

    public static void WebGL()
    {
        ConfigurePerformance();
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        // empty scene: Hoops.Game.Boot (RuntimeInitializeOnLoadMethod) creates GameMain, which builds everything from code
        EditorSceneManager.SaveScene(scene, "Assets/Main.unity");
        var r = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Main.unity" },
            locationPathName = "Build/WebGL",
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        });
        Debug.Log("BUILD RESULT " + r.summary.result + " size " + r.summary.totalSize);
        EditorApplication.Exit(r.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
    }
}

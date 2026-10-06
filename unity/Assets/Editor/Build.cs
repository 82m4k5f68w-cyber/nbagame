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
        GraphicsSettings.defaultRenderPipeline = pipe;
        QualitySettings.renderPipeline = pipe;
        QualitySettings.vSyncCount = 0;
        AssetDatabase.SaveAssets();
    }

    public static void WebGL()
    {
        ConfigurePerformance();
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var game = new GameObject("Game").AddComponent<HoopsTest>();
        game.baseMat = GraphicsSettings.defaultRenderPipeline.defaultMaterial; // URP Lit, kept in the build via the scene
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

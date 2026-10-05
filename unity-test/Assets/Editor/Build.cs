// Batch-mode build: makes the one-object scene and builds WebGL.
//   Unity -batchmode -quit -projectPath unity-test -executeMethod Build.WebGL
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class Build
{
    public static void WebGL()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("Game").AddComponent<HoopsTest>();
        EditorSceneManager.SaveScene(scene, "Assets/Main.unity");
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled; // plain files: any static server works
        PlayerSettings.WebGL.decompressionFallback = false;
        PlayerSettings.productName = "Hoops Unity Test";
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

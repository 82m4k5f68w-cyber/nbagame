// Vertex-coloured, alpha-blended shader for the HUD's GL shapes (Hud.cs GLBegin). Same properties as the built-in
// Hidden/Internal-Colored, which Unity 6000.6 marks DontSave and leaves out of player builds.
Shader "Hoops/HudColored"
{
    Properties
    {
        _SrcBlend ("Src Blend", Float) = 5
        _DstBlend ("Dst Blend", Float) = 10
        _Cull ("Cull", Float) = 0
        _ZWrite ("ZWrite", Float) = 0
        _ZTest ("ZTest", Float) = 8
    }
    SubShader
    {
        Tags { "Queue" = "Overlay" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        Pass
        {
            Blend [_SrcBlend] [_DstBlend]
            Cull [_Cull]
            ZWrite [_ZWrite]
            ZTest [_ZTest]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; float4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 color : COLOR; };
            v2f vert (appdata v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); o.color = v.color; return o; }
            float4 frag (v2f i) : SV_Target { return i.color; }
            ENDCG
        }
    }
}

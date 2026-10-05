#!/bin/sh
# Compile the pure-C# game core (unity/Assets/Scripts/Core) + one test file with Unity's bundled Roslyn, run it on
# Unity's bundled .NET runtime. No Unity license needed.  scripts/unity/cs.sh unity/CoreTests/X.cs [args]
set -e
U=${UNITY_DATA:-/home/user/unity/Editor/Data}
D=$U/NetCoreRuntime
R=$(ls -d $D/shared/Microsoft.NETCore.App/* | head -1)
# Roslyn: Data/DotNetSdkRoslyn (6000.3) or Data/DotNetSdk/sdk/*/Roslyn/bincore (6000.6+)
C=$(ls $U/DotNetSdkRoslyn/csc.dll $U/DotNetSdk/sdk/*/Roslyn/bincore/csc.dll 2>/dev/null | head -1)
O=${TMPDIR:-/tmp}/h2kcs
mkdir -p $O
T=$1; shift
N=$(basename $T .cs)
REFS=$(ls $R/*.dll | grep -v "Native\|mscorlib.ni" | sed 's/^/-r:/' | tr '\n' ' ')
$D/dotnet $C -nologo -nostdlib -optimize+ -langversion:9 -nullable:disable -warn:0 -out:$O/$N.dll $REFS unity/Assets/Scripts/Core/*.cs $T
printf '{"runtimeOptions":{"tfm":"net6.0","framework":{"name":"Microsoft.NETCore.App","version":"%s"}}}' "$(basename $R)" > $O/$N.runtimeconfig.json
$D/dotnet $O/$N.dll "$@"

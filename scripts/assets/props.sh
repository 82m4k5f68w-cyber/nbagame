#!/usr/bin/env bash
# Procedural props pipeline: Blender (build_prop.py) -> xatlas lightmap UVs in TEXCOORD_1 + meshopt (uv_unwrap.ts)
# -> assets/models/props/*.glb. Needs scripts/assets/setup.sh (blender) + npm install.
set -euo pipefail
cd "$(dirname "$0")/../.."
T="${H2K_TOOLS:-/home/user/tools}"
mkdir -p assets/models/props scripts/assets/.cache/props
for p in bleachers scorer_table corner_store; do
  "$T/bin/blender" -b --factory-startup -P scripts/assets/blender/build_prop.py -- "$p" "scripts/assets/.cache/props/$p.glb" 2>/dev/null | grep build_prop
  npx tsx scripts/assets/uv_unwrap.ts "scripts/assets/.cache/props/$p.glb" "assets/models/props/$p.glb" --meshopt | grep uv_unwrap
done
ls -la assets/models/props

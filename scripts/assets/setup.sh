#!/usr/bin/env bash
# Hoops 2K27 asset toolchain: idempotent (re)install. The container is ephemeral - run this first in a new session.
#   bash scripts/assets/setup.sh            # everything
#   bash scripts/assets/setup.sh blender    # one part: node | python | voices | blender | ktx | models
# Tools land in $H2K_TOOLS (default /home/user/tools), never inside the repo.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="${H2K_TOOLS:-/home/user/tools}"
BLENDER_VER="${BLENDER_VER:-4.5.15}"      # LTS; official tarball from download.blender.org
KTX_VER="${KTX_VER:-4.4.2}"               # KhronosGroup/KTX-Software GitHub release (toktx, ktx)
PY_PKGS="mediapipe==1.1.1 piper-tts==1.8.0 numpy opencv-python-headless onnxruntime"
VOICES="en_US-norman-medium en_US-joe-medium en_US-john-medium"   # public domain / CC0 datasets only (see assets/LICENSES.md)
POSE_MODEL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
mkdir -p "$T/bin" "$T/dl"
want() { [ $# -eq 0 ] && return 0; [ -z "${PARTS:-}" ] && return 0; [[ " $PARTS " == *" $1 "* ]]; }
PARTS="${*:-}"
fetch() { # url dest
  [ -s "$2" ] && return 0
  echo "  fetch $1"; curl -fL --retry 4 --retry-delay 3 -o "$2.part" "$1" && mv "$2.part" "$2"
}

if want node; then
  echo "== node dev deps (package.json)"
  (cd "$REPO" && npm install --no-audit --no-fund)
fi

if want python; then
  echo "== python venv $T/venv"
  [ -x "$T/venv/bin/python" ] || python3 -m venv "$T/venv"
  "$T/venv/bin/pip" install -q --upgrade pip
  "$T/venv/bin/pip" install -q $PY_PKGS
  mkdir -p "$T/models"
  fetch "$POSE_MODEL" "$T/models/pose_landmarker_heavy.task"
  ln -sf "$T/venv/bin/python" "$T/bin/h2kpy"
fi

if want voices; then
  echo "== piper voices -> $T/voices"
  mkdir -p "$T/voices"
  HF=https://huggingface.co/rhasspy/piper-voices/resolve/main
  for v in $VOICES; do
    lang=${v%%-*}; rest=${v#*-}; name=${rest%-*}; q=${rest##*-}
    fetch "$HF/en/$lang/$name/$q/$v.onnx" "$T/voices/$v.onnx"
    fetch "$HF/en/$lang/$name/$q/$v.onnx.json" "$T/voices/$v.onnx.json"
    fetch "$HF/en/$lang/$name/$q/MODEL_CARD" "$T/voices/$v.MODEL_CARD"
  done
fi

if want blender; then
  echo "== blender $BLENDER_VER"
  if [ ! -x "$T/blender-$BLENDER_VER/blender" ]; then
    mm=${BLENDER_VER%.*}
    fetch "https://download.blender.org/release/Blender$mm/blender-$BLENDER_VER-linux-x64.tar.xz" "$T/dl/blender-$BLENDER_VER.tar.xz"
    tar -xJf "$T/dl/blender-$BLENDER_VER.tar.xz" -C "$T"
    mv "$T/blender-$BLENDER_VER-linux-x64" "$T/blender-$BLENDER_VER"
    rm -f "$T/dl/blender-$BLENDER_VER.tar.xz"
  fi
  # headless runtime libs (Debian/Ubuntu); harmless if already present or apt is unavailable
  if command -v apt-get >/dev/null && ! ldconfig -p | grep -q libXi.so.6; then
    apt-get install -y -qq libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libgl1 libegl1 >/dev/null 2>&1 || true
  fi
  ln -sf "$T/blender-$BLENDER_VER/blender" "$T/bin/blender"
fi

if want ktx; then
  echo "== KTX-Software $KTX_VER (toktx / ktx)"
  if [ ! -x "$T/ktx/bin/toktx" ]; then
    fetch "https://github.com/KhronosGroup/KTX-Software/releases/download/v$KTX_VER/KTX-Software-$KTX_VER-Linux-x86_64.tar.bz2" "$T/dl/ktx.tar.bz2"
    rm -rf "$T/ktx" && mkdir -p "$T/ktx"
    tar -xjf "$T/dl/ktx.tar.bz2" -C "$T/ktx" --strip-components=1
  fi
  for b in toktx ktx ktxinfo; do
    [ -x "$T/ktx/bin/$b" ] || continue
    printf '#!/bin/sh\nLD_LIBRARY_PATH="%s/ktx/lib:${LD_LIBRARY_PATH:-}" exec "%s/ktx/bin/%s" "$@"\n' "$T" "$T" "$b" > "$T/bin/$b"
    chmod +x "$T/bin/$b"
  done
fi

echo "== versions"
[ -x "$T/bin/blender" ] && "$T/bin/blender" --version 2>/dev/null | head -1 || true
[ -x "$T/bin/toktx" ] && "$T/bin/toktx" --version 2>&1 | head -1 || true
[ -x "$T/venv/bin/python" ] && "$T/venv/bin/pip" list 2>/dev/null | grep -i -E '^(mediapipe|piper-tts|onnxruntime|numpy|opencv)' || true
command -v ffmpeg >/dev/null && ffmpeg -version | head -1 || echo "WARNING: ffmpeg missing (apt-get install ffmpeg)"
echo "Add to PATH: export PATH=$T/bin:\$PATH"

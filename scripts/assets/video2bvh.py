"""Video -> 3D pose (MediaPipe Pose Landmarker, heavy) -> smoothing -> BVH on a CMU-style skeleton.

The BVH uses the joint names scripts/mocap/retarget.ts reads (Hips, Spine1, Neck, Left/RightUpLeg, Leg, Foot,
ToeBase, Arm, ForeArm, Hand), Y up, facing +Z, frame 0 = T-pose rest (retarget.ts measures the rest legs there).

  h2kpy scripts/assets/video2bvh.py move.mp4 out.bvh [--fps 30] [--smooth 2.0] [--model pose_landmarker_heavy.task]
                                                    [--json out.json]  (raw smoothed joint positions too)
Tips: one person, full body in frame (feet included), side or 3/4 view, steady camera, 2-10 s, good light.
Root motion: MediaPipe world landmarks are hip-centred, so the root path is rebuilt from the 2D hip track scaled by
the person's measured leg length (horizontal along the image x axis + vertical; depth is not recovered).
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

TOOLS = os.environ.get("H2K_TOOLS", "/home/user/tools")

# MediaPipe landmark ids
NOSE, LEAR, REAR = 0, 7, 8
LSH, RSH, LEL, REL, LWR, RWR = 11, 12, 13, 14, 15, 16
LIDX, RIDX = 19, 20
LHIP, RHIP, LKN, RKN, LANK, RANK = 23, 24, 25, 26, 27, 28
LTOE, RTOE = 31, 32

# skeleton: name, parent, how to get the joint position from landmarks
JOINTS = [
    "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
    "Spine", "Spine1", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
]
PARENT = {
    "LeftUpLeg": "Hips", "LeftLeg": "LeftUpLeg", "LeftFoot": "LeftLeg", "LeftToeBase": "LeftFoot",
    "RightUpLeg": "Hips", "RightLeg": "RightUpLeg", "RightFoot": "RightLeg", "RightToeBase": "RightFoot",
    "Spine": "Hips", "Spine1": "Spine", "Neck": "Spine1", "Head": "Neck",
    "LeftShoulder": "Spine1", "LeftArm": "LeftShoulder", "LeftForeArm": "LeftArm", "LeftHand": "LeftForeArm",
    "RightShoulder": "Spine1", "RightArm": "RightShoulder", "RightForeArm": "RightArm", "RightHand": "RightForeArm",
}
KIDS = {j: [k for k in JOINTS if PARENT.get(k) == j] for j in JOINTS}
# end sites (direction targets for leaf joints)
END = {"LeftToeBase": None, "RightToeBase": None, "Head": "HeadTop", "LeftHand": "LeftFinger", "RightHand": "RightFinger"}


def points(w):
    """Named 3D points (Y up, facing +Z, metres) from 33 world landmarks w[33,3] (MediaPipe: x right, y down)."""
    p = w * np.array([1.0, -1.0, -1.0])  # rotate 180 deg about x: y up, keeps handedness
    hip = (p[LHIP] + p[RHIP]) / 2
    sh = (p[LSH] + p[RSH]) / 2
    ear = (p[LEAR] + p[REAR]) / 2
    J = {
        "Hips": hip, "LeftUpLeg": p[LHIP], "LeftLeg": p[LKN], "LeftFoot": p[LANK], "LeftToeBase": p[LTOE],
        "RightUpLeg": p[RHIP], "RightLeg": p[RKN], "RightFoot": p[RANK], "RightToeBase": p[RTOE],
        "Spine": hip + (sh - hip) * 0.33, "Spine1": hip + (sh - hip) * 0.7, "Neck": sh, "Head": sh + (ear - sh) * 0.6,
        "LeftShoulder": sh + (p[LSH] - sh) * 0.25, "LeftArm": p[LSH], "LeftForeArm": p[LEL], "LeftHand": p[LWR],
        "RightShoulder": sh + (p[RSH] - sh) * 0.25, "RightArm": p[RSH], "RightForeArm": p[REL], "RightHand": p[RWR],
        "HeadTop": ear + (ear - sh) * 0.45 + (p[NOSE] - ear) * 0.2,
        "LeftFinger": p[LIDX], "RightFinger": p[RIDX],
    }
    return J


def detect(video, model):
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        sys.exit(f"cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model),
                                        running_mode=vision.RunningMode.VIDEO, num_poses=1,
                                        min_pose_detection_confidence=0.5, min_tracking_confidence=0.5)
    W, I, ok = [], [], []
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        i = 0
        while True:
            r, frame = cap.read()
            if not r:
                break
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            res = lm.detect_for_video(img, int(i * 1000 / fps))
            if res.pose_world_landmarks:
                W.append([[q.x, q.y, q.z] for q in res.pose_world_landmarks[0]])
                I.append([[q.x, q.y * frame.shape[0] / frame.shape[1]] for q in res.pose_landmarks[0]])  # square units
                ok.append(True)
            else:
                W.append([[0, 0, 0]] * 33)
                I.append([[0, 0]] * 33)
                ok.append(False)
            i += 1
    cap.release()
    return np.array(W, float), np.array(I, float), np.array(ok), fps


def fill_smooth(a, ok, sigma):
    """Linear fill of missed frames, then a Gaussian (zero phase) along time."""
    t = np.arange(len(a))
    flat = a.reshape(len(a), -1).copy()
    for c in range(flat.shape[1]):
        flat[:, c] = np.interp(t, t[ok], flat[ok, c])
    if sigma > 0:
        r = int(math.ceil(sigma * 3))
        k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
        k /= k.sum()
        pad = np.pad(flat, ((r, r), (0, 0)), mode="edge")
        flat = np.stack([np.convolve(pad[:, c], k, mode="valid") for c in range(flat.shape[1])], 1)
    return flat.reshape(a.shape)


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def rot_between(a, b):
    """Minimal rotation matrix taking direction a to direction b."""
    a, b = unit(a), unit(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.999999:
        ax = unit(np.cross(a, [1, 0, 0] if abs(a[0]) < 0.9 else [0, 1, 0]))
        return 2 * np.outer(ax, ax) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def basis(x, y):
    """Rotation whose columns are an orthonormal frame with x along `x`, y ~ `y`."""
    x = unit(x)
    y = unit(y - x * np.dot(x, y))
    z = np.cross(x, y)
    return np.stack([x, y, z], 1)


def euler_zxy(M):
    """Angles (deg) for BVH 'Zrotation Xrotation Yrotation': M = Rz @ Rx @ Ry (three.js ZXY decomposition)."""
    x = math.asin(max(-1.0, min(1.0, M[2, 1])))
    if abs(M[2, 1]) < 0.9999999:
        y = math.atan2(-M[2, 0], M[2, 2])
        z = math.atan2(-M[0, 1], M[1, 1])
    else:
        y = 0.0
        z = math.atan2(M[1, 0], M[0, 0])
    return [math.degrees(z), math.degrees(x), math.degrees(y)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--fps", type=float, default=0, help="resample to this rate (0 = video rate)")
    ap.add_argument("--smooth", type=float, default=2.0, help="Gaussian sigma in frames (at the video rate)")
    ap.add_argument("--model", default=f"{TOOLS}/models/pose_landmarker_heavy.task")
    ap.add_argument("--json", default="")
    ap.add_argument("--scale", type=float, default=100.0, help="BVH units per metre (default cm)")
    a = ap.parse_args()

    W, I, ok, fps = detect(a.video, a.model)
    n = len(W)
    if ok.sum() < max(5, n * 0.5):
        sys.exit(f"pose found in only {ok.sum()}/{n} frames: keep the whole body in frame")
    W = fill_smooth(W, ok, a.smooth)
    I = fill_smooth(I, ok, a.smooth)
    if a.fps and abs(a.fps - fps) > 0.5:  # resample
        t0 = np.arange(n) / fps
        t1 = np.arange(0, t0[-1] + 1e-9, 1 / a.fps)
        rs = lambda A: np.array([[np.interp(t1, t0, A[:, j, c]) for c in range(A.shape[2])] for j in range(33)]).transpose(2, 0, 1)
        W, I = rs(W), rs(I)
        fps, n = a.fps, len(t1)

    F = [points(W[i]) for i in range(n)]
    # bone lengths: medians (the BVH offsets are fixed, so the solved pose keeps them constant)
    names = JOINTS + ["HeadTop", "LeftFinger", "RightFinger"]
    par = dict(PARENT, HeadTop="Head", LeftFinger="LeftHand", RightFinger="RightHand")
    blen = {j: float(np.median([np.linalg.norm(f[j] - f[par[j]]) for f in F])) for j in names if j in par}

    # root path from the 2D hip track: metres per image unit from the leg length (world vs image), median
    leg_w = np.median([np.linalg.norm(W[i, LHIP] - W[i, LANK]) + np.linalg.norm(W[i, RHIP] - W[i, RANK]) for i in range(n)])
    leg_i = np.median([np.linalg.norm(I[i, LHIP] - I[i, LANK]) + np.linalg.norm(I[i, RHIP] - I[i, RANK]) for i in range(n)])
    mpu = leg_w / max(1e-6, leg_i)
    hip2 = (I[:, LHIP] + I[:, RHIP]) / 2
    rx = (hip2[:, 0] - hip2[0, 0]) * mpu
    ry = -(hip2[:, 1] - np.median(hip2[:, 1])) * mpu
    # floor: the lowest foot point of the standing frames sits at y = 0
    lowf = np.array([min(f[k][1] for k in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")) for f in F])
    stand = np.abs(ry) < np.percentile(np.abs(ry), 40) + 1e-6
    hip_h = -float(np.median(lowf[stand])) + 0.035  # ankle/toe landmarks sit above the sole
    # rest offsets (T-pose, Y up, facing +Z, person's left = +X)
    D = {
        "LeftUpLeg": [1, -0.15, 0], "LeftLeg": [0, -1, 0], "LeftFoot": [0, -1, 0], "LeftToeBase": [0, -0.35, 1],
        "RightUpLeg": [-1, -0.15, 0], "RightLeg": [0, -1, 0], "RightFoot": [0, -1, 0], "RightToeBase": [0, -0.35, 1],
        "Spine": [0, 1, 0], "Spine1": [0, 1, 0], "Neck": [0, 1, 0], "Head": [0, 1, 0], "HeadTop": [0, 1, 0.1],
        "LeftShoulder": [1, 0.6, 0], "LeftArm": [1, 0, 0], "LeftForeArm": [1, 0, 0], "LeftHand": [1, 0, 0], "LeftFinger": [1, 0, 0],
        "RightShoulder": [-1, 0.6, 0], "RightArm": [-1, 0, 0], "RightForeArm": [-1, 0, 0], "RightHand": [-1, 0, 0], "RightFinger": [-1, 0, 0],
    }
    OFF = {j: unit(np.array(D[j], float)) * blen[j] for j in blen}

    # rotations: Hips + Spine1 from frames (they have several children); the rest swing their one child into place
    def solve(f):
        G, out = {}, {}
        for j in JOINTS:
            p = G.get(PARENT.get(j), np.eye(3))
            if j == "Hips":
                g = basis(f["LeftUpLeg"] - f["RightUpLeg"], f["Spine"] - f["Hips"])
            elif j == "Spine1":
                g = basis(f["LeftArm"] - f["RightArm"], f["Neck"] - f["Spine1"])
            else:
                kid = (KIDS[j] or [END.get(j)])[0]
                if kid is None:  # toes: keep the foot's frame
                    g = p
                else:
                    g = rot_between(p @ OFF[kid], f[kid] - f[j]) @ p
            G[j] = g
            out[j] = p.T @ g
        return out

    S = a.scale
    lines = ["HIERARCHY"]

    def emit(j, d):
        ind = "  " * d
        if j == "Hips":
            lines.append(f"ROOT {j}")
        else:
            lines.append(f"{ind}JOINT {j}")
        lines.append(ind + "{")
        o = np.zeros(3) if j == "Hips" else OFF[j] * S
        lines.append(f"{ind}  OFFSET {o[0]:.4f} {o[1]:.4f} {o[2]:.4f}")
        ch = "6 Xposition Yposition Zposition Zrotation Xrotation Yrotation" if j == "Hips" else "3 Zrotation Xrotation Yrotation"
        lines.append(f"{ind}  CHANNELS {ch}")
        for k in KIDS[j]:
            emit(k, d + 1)
        if not KIDS[j]:
            e = END.get(j)
            eo = OFF[e] * S if e else np.array([0, 0, 0.04 * S])
            lines.extend([f"{ind}  End Site", f"{ind}  {{", f"{ind}    OFFSET {eo[0]:.4f} {eo[1]:.4f} {eo[2]:.4f}", f"{ind}  }}"])
        lines.append(ind + "}")

    emit("Hips", 0)
    lines += ["MOTION", f"Frames: {n + 1}", f"Frame Time: {1 / fps:.6f}"]
    rest = [0.0, hip_h * S, 0.0] + [0.0] * (3 * len(JOINTS))
    lines.append(" ".join(f"{v:.4f}" for v in rest))  # frame 0: T-pose rest
    for i, f in enumerate(F):
        R = solve(f)
        row = [rx[i] * S, (hip_h + ry[i]) * S, 0.0]
        for j in JOINTS:
            row += euler_zxy(R[j])
        lines.append(" ".join(f"{v:.4f}" for v in row))
    with open(a.out, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    if a.json:
        with open(a.json, "w") as fh:
            json.dump({"fps": fps, "frames": [{k: [round(float(x), 4) for x in v] for k, v in f.items()} for f in F],
                       "root": [[round(float(rx[i]), 4), round(float(hip_h + ry[i]), 4)] for i in range(n)]}, fh)
    print(f"video2bvh: {n} frames @ {fps:.1f} fps, pose in {int(ok.sum())} source frames, leg {leg_w:.2f} m, "
          f"hip height {hip_h:.2f} m -> {a.out}")


if __name__ == "__main__":
    main()

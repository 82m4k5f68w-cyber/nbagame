"""Shot motion model (v5.6, cfg.MM): train on the retargeted CMU shots + jumps, validate, bake game tables.

  /home/user/tools/venv/bin/python -I scripts/ml/train_shot.py [--quick]

Input  assets/mocap/shots/dataset.json (scripts/mocap/shots.ts): every sequence time-warped onto the shot-clip phase
       k (dip 0, takeoff .2, release .7, follow-through 1), 41 samples x 21 channels + descriptors
       H (jump height ft), FW / SD (forward / side drift ft/s), LOAD (crouch at the dip), SET (shooting arm at release).
Model  two phase-conditioned MLPs (Fourier features of k + standardized descriptors -> channels):
         lower body  [k, H, FW, LOAD] -> tL tR kL kR ln cr rz ty         (5 shots + 61 two-foot jumps, L/R mirrored)
         upper body  [k, H, SET]      -> aR eR aL eL sz zL wR wL oR oL hR hL   (5 shots)
       Baselines (Option A, motion matching): nearest sequence in descriptor space (1-NN) and an inverse-distance
       blend of the 2 nearest (2-NN); plus the mean curve. Validation = grouped leave-one-clip-out.
Output assets/ml/shot_mm.json (losses, validation, baked tables), assets/ml/shot_mm_lower.onnx / _upper.onnx
       (optional client-side refinement; the game uses the baked tables), then scripts/ml/bake_shot.ts writes
       src/core/mmshot.ts + the C# twin.
"""
import base64, json, math, os, sys
import numpy as np
import torch
import torch.nn as nn

torch.manual_seed(7)
np.random.seed(7)
torch.set_num_threads(1)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DS = json.load(open(os.path.join(ROOT, "assets/mocap/shots/dataset.json")))
CH = DS["ch"]
NK = DS["nk"]
LOW = ["tL", "tR", "kL", "kR", "ln", "cr", "rz", "ty"]  # (cx: the cgspeed spine carries no chest pitch - always 0)
UPP = ["aR", "eR", "aL", "eL", "sz", "zL", "wR", "wL", "oR", "oL", "hR", "hL"]
LD = ["H", "FW", "LOAD"]
UD = ["H", "SET"]
QUICK = "--quick" in sys.argv
EPOCHS = 600 if QUICK else 3000
KS = np.linspace(0, 1, NK)


def dec(s):
    return np.frombuffer(base64.b64decode(s), dtype=np.int16).astype(np.float64).reshape(NK, len(CH)) / 1000.0


seqs = []
for s in DS["seqs"]:
    seqs.append({"id": s["id"], "kind": s["kind"], "clip": s["id"].split("@")[0].rstrip("m"), "d": s["d"], "k": dec(s["k"])})


def mirror_low(Y):
    """Left/right mirror of the lower-body channels (legs swap, yaw / roll flip)."""
    m = Y.copy()
    i = {c: j for j, c in enumerate(CH)}
    m[:, i["tL"]], m[:, i["tR"]] = Y[:, i["tR"]], Y[:, i["tL"]]
    m[:, i["kL"]], m[:, i["kR"]] = Y[:, i["kR"]], Y[:, i["kL"]]
    m[:, i["rz"]] = -Y[:, i["rz"]]
    m[:, i["ty"]] = -Y[:, i["ty"]]
    return m


def feats(k, D):
    """Fourier features of the phase + descriptors. k: (n,), D: (n, nd) standardized."""
    k = np.asarray(k)[:, None]
    f = [k]
    for m in range(1, 7):
        f += [np.sin(math.pi * m * k), np.cos(math.pi * m * k)]
    return np.concatenate(f + [D], 1)


class Net(nn.Module):
    def __init__(self, nin, nout, h):
        super().__init__()
        self.f = nn.Sequential(nn.Linear(nin, h), nn.SiLU(), nn.Linear(h, h), nn.SiLU(), nn.Linear(h, nout))

    def forward(self, x):
        return self.f(x)


def build(part, rows):
    """rows: list of seqs -> X, Y, groups"""
    chans = LOW if part == "low" else UPP
    dn = LD if part == "low" else UD
    idx = [CH.index(c) for c in chans]
    X, Y, G, Dr = [], [], [], []
    for s in rows:
        Ys = [s["k"]] + ([mirror_low(s["k"])] if part == "low" and s["kind"] == "jump" else [])
        for Yk in Ys:
            Dr.append([s["d"][n] for n in dn])
            X.append(np.array([s["d"][n] for n in dn], dtype=np.float64))
            Y.append(Yk[:, idx])
            G.append(s["clip"])
    return np.array(X), np.array(Y), G


HP = {"low": {"h": 48, "wd": 1e-3, "noise": 0.0}, "upp": {"h": int(os.environ.get("UH", 16)), "wd": float(os.environ.get("UWD", 0.1)), "noise": float(os.environ.get("UN", 1.5))}}


def fit(part, train, epochs=EPOCHS, verbose=False):
    h, wd, noise = HP[part]["h"], HP[part]["wd"], HP[part]["noise"]
    D, Y, _ = build(part, train)
    mu, sd = D.mean(0), D.std(0) + 1e-6
    Dn = (D - mu) / sd
    n, nk, nc = Y.shape
    X = np.concatenate([feats(KS, np.repeat(Dn[i : i + 1], nk, 0)) for i in range(n)])
    Yf = Y.reshape(n * nk, nc)
    # targets are residuals from the phase-mean curve (per channel, per k): with heavy regularization the model
    # falls back to the mean motion instead of inventing one
    Ym = Y.mean(0)  # nk x nc
    R = (Y - Ym[None]).reshape(n * nk, nc)
    ym, ys = np.zeros(nc), R.std(0) + 1e-3
    Xt = torch.tensor(X, dtype=torch.float32)
    Yt = torch.tensor(R / ys, dtype=torch.float32)
    # shots weigh as much as all the jumps together in the lower-body net (they are the target motion)
    w = np.ones(n)
    if part == "low":
        kinds = [s["kind"] for s in train for _ in ([0] if s["kind"] == "shot" else [0, 1])]
        ns, nj = kinds.count("shot"), kinds.count("jump")
        w = np.array([(nj / max(1, ns)) if k == "shot" else 1.0 for k in kinds])
    Wt = torch.tensor(np.repeat(w / w.mean(), nk), dtype=torch.float32)[:, None]
    net = Net(X.shape[1], nc, h)
    opt = torch.optim.AdamW(net.parameters(), lr=4e-3, weight_decay=wd)
    sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    hist = []
    for ep in range(epochs):
        opt.zero_grad()
        if noise > 0:
            # descriptor noise (std units): with 4-5 shots the net must stay smooth across descriptor space
            Xn = Xt.clone()
            Xn[:, -Dn.shape[1] :] += noise * torch.randn(n, Dn.shape[1]).repeat_interleave(nk, 0)
            out = net(Xn)
        else:
            out = net(Xt)
        # data term + temporal smoothness (second difference along k, per sequence)
        mse = ((out - Yt) ** 2 * Wt).mean()
        o3 = out.view(n, nk, nc)
        sm = ((o3[:, 2:] - 2 * o3[:, 1:-1] + o3[:, :-2]) ** 2).mean()
        loss = mse + 0.5 * sm
        loss.backward()
        opt.step()
        sch.step()
        if ep % 500 == 0 or ep == epochs - 1:
            hist.append([ep, float(mse.detach()), float(sm.detach())])
            if verbose:
                print(f"  {part} ep {ep:5d} mse(std units) {float(mse):.5f} smooth {float(sm):.6f}")
    model = {"net": net, "mu": mu, "sd": sd, "ym": ym, "ys": ys, "Ym": Ym, "hist": hist, "part": part}
    # final training RMSE in radians
    with torch.no_grad():
        P = net(Xt).numpy() * ys + np.tile(Ym, (n, 1))
    model["train_rmse"] = float(np.sqrt(((P - Yf) ** 2).mean()))
    return model


def predict(model, d, ks=KS):
    dn = LD if model["part"] == "low" else UD
    D = (np.array([[d[n] for n in dn]]) - model["mu"]) / model["sd"]
    X = feats(ks, np.repeat(D, len(ks), 0))
    Ym = np.stack([np.interp(ks, KS, model["Ym"][:, j]) for j in range(model["Ym"].shape[1])], 1)
    with torch.no_grad():
        return model["net"](torch.tensor(X, dtype=torch.float32)).numpy() * model["ys"] + Ym


def knn(part, train, d, k):
    D, Y, _ = build(part, train)
    dn = LD if part == "low" else UD
    mu, sd = D.mean(0), D.std(0) + 1e-6
    q = (np.array([d[n] for n in dn]) - mu) / sd
    dist = np.sqrt((((D - mu) / sd - q) ** 2).sum(1))
    o = np.argsort(dist)[:k]
    w = 1 / (dist[o] + 1e-3)
    return (Y[o] * w[:, None, None]).sum(0) / w.sum()


def validate(part):
    rows = [s for s in seqs if part == "low" or s["kind"] == "shot"]
    clips = sorted(set(s["clip"] for s in rows))
    # lower body: 6 grouped folds over clips (all shots in their own folds); upper body: leave one shot out
    if part == "low":
        shot_clips = [c for c in clips if any(s["clip"] == c and s["kind"] == "shot" for s in rows)]
        other = [c for c in clips if c not in shot_clips]
        folds = [[c] for c in shot_clips] + [other[i::3] for i in range(3)]
    else:
        folds = [[c] for c in clips]
    chans = LOW if part == "low" else UPP
    idx = [CH.index(c) for c in chans]
    err = {"mlp": [], "mm1": [], "mm2": [], "mean": []}
    shot_err = {"mlp": [], "mm1": [], "mm2": [], "mean": []}
    for f in folds:
        tr = [s for s in rows if s["clip"] not in f]
        te = [s for s in rows if s["clip"] in f]
        m = fit(part, tr, epochs=EPOCHS // 2)
        _, Ytr, _ = build(part, tr)
        mean = Ytr.mean(0)
        for s in te:
            Yt = s["k"][:, idx]
            for name, P in (("mlp", predict(m, s["d"])), ("mm1", knn(part, tr, s["d"], 1)), ("mm2", knn(part, tr, s["d"], 2)), ("mean", mean)):
                e = float(np.sqrt(((P - Yt) ** 2).mean()))
                err[name].append(e)
                if s["kind"] == "shot":
                    shot_err[name].append(e)
    res = {k: float(np.mean(v)) for k, v in err.items()}
    res_s = {k: float(np.mean(v)) for k, v in shot_err.items() if v}
    return res, res_s, len(folds)


report = {"data": {"sequences": len(seqs), "shots": sum(s["kind"] == "shot" for s in seqs), "jumps": sum(s["kind"] == "jump" for s in seqs)}}
print("data", report["data"])
for part in [p for p in ("low", "upp") if os.environ.get("ONLY", p) == p]:
    v, vs, nf = validate(part)
    report["val_" + part] = {"folds": nf, "rmse_rad_all": v, "rmse_rad_shots": vs}
    print(f"validation {part} ({nf} grouped folds) RMSE rad: all {json.dumps({k: round(x, 4) for k, x in v.items()})} shots {json.dumps({k: round(x, 4) for k, x in vs.items()})}")

if os.environ.get("ONLY"):
    sys.exit(0)
# ---- final models on everything ----
ML = fit("low", seqs, verbose=True)
MU = fit("upp", [s for s in seqs if s["kind"] == "shot"], verbose=True)
report["train"] = {"low": {"rmse_rad": ML["train_rmse"], "loss_hist": ML["hist"]}, "upp": {"rmse_rad": MU["train_rmse"], "loss_hist": MU["hist"]}}
print("train RMSE rad: low", round(ML["train_rmse"], 4), "upp", round(MU["train_rmse"], 4))

# ---- bake: shot types -> descriptors (inside the data range) ----
shots = [s for s in seqs if s["kind"] == "shot"]
rng = {n: (min(s["d"][n] for s in seqs if s["d"][n] is not None), max(s["d"][n] for s in seqs if s["d"][n] is not None)) for n in ["H", "FW", "LOAD", "SET"]}
SETR = (min(s["d"]["SET"] for s in shots), max(s["d"]["SET"] for s in shots))
# catch-and-shoot / pull-up / deep / fade / step-back / quick (release at k .46: resampled below)
TYPES = {
    "cs": {"H": 0.85, "FW": 0.0, "LOAD": 1.55, "SET": 2.6},
    "pull": {"H": 0.9, "FW": 1.6, "LOAD": 1.45, "SET": 2.6},
    "deep": {"H": 1.15, "FW": 0.6, "LOAD": 2.1, "SET": 2.5},
    "fade": {"H": 0.95, "FW": -0.9, "LOAD": 1.6, "SET": 2.7},
    "step": {"H": 0.8, "FW": -0.7, "LOAD": 2.0, "SET": 2.6},
    "quick": {"H": 0.45, "FW": 0.0, "LOAD": 1.15, "SET": 2.55},
}
RELK = {"quick": 0.46}
KB = 31  # baked keys (uniform in k)
KBS = np.linspace(0, 1, KB)


def warp(kg, rk):
    """game clip phase (release at rk) -> model phase (release at .7)"""
    return np.where(kg <= rk, kg * (0.7 / rk), 0.7 + (kg - rk) / (1 - rk) * 0.3)


def table(d, rk=0.7):
    km = warp(KBS, rk)
    lo = predict(ML, d, km)
    up = predict(MU, d, km)
    out = {}
    for j, c in enumerate(LOW):
        out[c] = lo[:, j]
    for j, c in enumerate(UPP):
        out[c] = up[:, j]
    return out


SIG_LOAD = 0.45  # one form step on the load axis (crouch units)
SIG_SET = 0.25  # one form step on the set-point axis (rad of the shooting arm at release)
bake = {"ch": list(LOW) + list(UPP), "kb": KB, "types": {}, "dLoad": {}, "dSet": {}, "desc": TYPES, "range": rng}
for t, d in TYPES.items():
    tb = table(d, RELK.get(t, 0.7))
    bake["types"][t] = {c: [round(float(v), 4) for v in tb[c]] for c in bake["ch"]}
base = TYPES["cs"]
up_l = table({**base, "LOAD": base["LOAD"] + SIG_LOAD})
dn_l = table({**base, "LOAD": base["LOAD"] - SIG_LOAD})
up_s = table({**base, "SET": base["SET"] + SIG_SET})
dn_s = table({**base, "SET": base["SET"] - SIG_SET})
for c in bake["ch"]:
    bake["dLoad"][c] = [round(float(v), 4) for v in (up_l[c] - dn_l[c]) / 2] if c in LOW else [0.0] * KB
    bake["dSet"][c] = [round(float(v), 4) for v in (up_s[c] - dn_s[c]) / 2] if c in UPP else [0.0] * KB
report["bake"] = bake
report["model"] = {
    "low": {"in": ["k fourier(6)", *LD], "out": LOW, "hidden": [48, 48], "params": sum(p.numel() for p in ML["net"].parameters())},
    "upp": {"in": ["k fourier(6)", *UD], "out": UPP, "hidden": [HP["upp"]["h"]] * 2, "params": sum(p.numel() for p in MU["net"].parameters())},
    "smooth_w": 0.5,
    "epochs": EPOCHS,
}
os.makedirs(os.path.join(ROOT, "assets/ml"), exist_ok=True)
json.dump(report, open(os.path.join(ROOT, "assets/ml/shot_mm.json"), "w"))


# ---- ONNX (optional client refinement): raw inputs [k, descriptors...] -> channels in radians ----
class Wrap(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.net = m["net"]
        self.register_buffer("mu", torch.tensor(m["mu"], dtype=torch.float32))
        self.register_buffer("sd", torch.tensor(m["sd"], dtype=torch.float32))
        self.register_buffer("ym", torch.tensor(m["ym"], dtype=torch.float32))
        self.register_buffer("ys", torch.tensor(m["ys"], dtype=torch.float32))

    def forward(self, x):
        k = x[:, :1]
        d = (x[:, 1:] - self.mu) / self.sd
        f = [k]
        for m in range(1, 7):
            f += [torch.sin(math.pi * m * k), torch.cos(math.pi * m * k)]
        return self.net(torch.cat(f + [d], 1)) * self.ys + self.ym


for name, m, nd in (("lower", ML, len(LD)), ("upper", MU, len(UD))):
    p = os.path.join(ROOT, f"assets/ml/shot_mm_{name}.onnx")
    w = Wrap(m).eval()
    torch.onnx.export(w, torch.zeros(4, 1 + nd), p, input_names=["x"], output_names=["q"], dynamic_axes={"x": {0: "n"}, "q": {0: "n"}}, opset_version=17, dynamo=False)
    try:
        import onnxruntime as ort

        x = np.random.rand(16, 1 + nd).astype(np.float32)
        x[:, 1:] = x[:, 1:] * 2 + 0.5
        o = ort.InferenceSession(p).run(None, {"x": x})[0]
        t = w(torch.tensor(x)).detach().numpy()
        print(name, "onnx", os.path.getsize(p), "bytes, max |onnx - torch|", float(np.abs(o - t).max()))
    except Exception as e:  # noqa
        print("onnx check skipped", e)
print("wrote assets/ml/shot_mm.json")

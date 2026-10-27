"""Tiny ONNX proof model for src/client/ml.ts: a 31-channel pose denoiser MLP (31 -> 32 -> 31, residual).

  h2kpy scripts/assets/ml_tiny.py [assets/ml/pose_mlp.onnx]
Trained for a few seconds on synthetic data (noisy pose vector -> clean), so the browser test can check that the
output is closer to the clean pose than the input. Real models (motion matching etc.) follow the same path:
train in PyTorch (CPU build from scripts/assets/setup.sh ml) -> torch.onnx.export -> inline -> ml.ts.
"""
import sys
import torch

torch.manual_seed(7)
out = sys.argv[1] if len(sys.argv) > 1 else "assets/ml/pose_mlp.onnx"


class Net(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.a = torch.nn.Linear(31, 32)
        self.b = torch.nn.Linear(32, 31)

    def forward(self, x):
        return x + self.b(torch.tanh(self.a(x)))


net = Net()
opt = torch.optim.Adam(net.parameters(), 1e-2)
# "clean" poses live on a smooth low-dimensional manifold (3 latent factors); noise is isotropic
W = torch.randn(3, 31) * 0.6
for it in range(1500):
    z = torch.randn(256, 3)
    clean = torch.tanh(z @ W)
    noisy = clean + torch.randn_like(clean) * 0.15
    loss = ((net(noisy) - clean) ** 2).mean()
    opt.zero_grad()
    loss.backward()
    opt.step()
print(f"train mse {loss.item():.4f} (noise mse {0.15 ** 2:.4f})")
torch.onnx.export(net, torch.zeros(1, 31), out, input_names=["pose"], output_names=["clean"], opset_version=17,
                  dynamic_axes={"pose": {0: "n"}, "clean": {0: "n"}}, dynamo=False)
# a fixed probe for the browser test: clean pose + noise, and the clean target
z = torch.randn(1, 3)
clean = torch.tanh(z @ W)
noisy = clean + torch.randn_like(clean) * 0.15
import json, os
json.dump({"noisy": noisy[0].tolist(), "clean": clean[0].tolist(), "torch": net(noisy)[0].tolist()},
          open(os.path.splitext(out)[0] + ".probe.json", "w"))
print("wrote", out, os.path.getsize(out), "bytes")

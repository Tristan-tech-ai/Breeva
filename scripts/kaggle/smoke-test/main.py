"""Breeva Kaggle smoke test — verify env, GPU, and key libraries are ready
for Phase 4.3 Deep Ensemble training."""

import sys, platform, subprocess, time

print("=" * 60)
print("BREEVA KAGGLE ENV SMOKE TEST")
print("=" * 60)

print(f"\nPython: {sys.version}")
print(f"Platform: {platform.platform()}")

# Library versions
for mod in ["torch", "numpy", "pandas", "sklearn", "scipy"]:
    try:
        m = __import__(mod)
        ver = getattr(m, "__version__", "?")
        print(f"  {mod}: {ver}")
    except ImportError as e:
        print(f"  {mod}: NOT INSTALLED ({e})")

# GPU info
print("\nGPU:")
try:
    import torch
    print(f"  cuda_available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  device_count: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            p = torch.cuda.get_device_properties(i)
            print(f"  device[{i}]: {p.name} | {p.total_memory / 1024**3:.1f} GB VRAM | compute {p.major}.{p.minor}")
        # Quick math test
        x = torch.randn(2048, 2048, device='cuda')
        t0 = time.time()
        for _ in range(10):
            y = x @ x
        torch.cuda.synchronize()
        gflops = (10 * 2 * 2048**3) / (time.time() - t0) / 1e9
        print(f"  matmul 2048×2048 ×10: {gflops:.0f} GFLOPS")
except Exception as e:
    print(f"  torch error: {e}")

# nvidia-smi info
print("\nnvidia-smi:")
try:
    out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
    print(f"  {out.stdout.strip()}")
except Exception as e:
    print(f"  nvidia-smi error: {e}")

# Check for libs we'll need in Tier 4 training
print("\nTier 4 deps:")
for mod in ["torch_geometric", "transformers", "datasets", "mlflow", "xgboost", "lightgbm"]:
    try:
        m = __import__(mod)
        ver = getattr(m, "__version__", "?")
        print(f"  {mod}: {ver}")
    except ImportError:
        print(f"  {mod}: not preinstalled (will need pip install in real kernel)")

print("\n" + "=" * 60)
print("SMOKE TEST DONE")
print("=" * 60)

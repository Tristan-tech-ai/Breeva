"""Breeva Kaggle smoke test — verify GPU + key libs ready for Tier 4."""
import sys, platform, subprocess, time
print("=" * 60); print("BREEVA KAGGLE ENV SMOKE TEST"); print("=" * 60)
print(f"Python: {sys.version}"); print(f"Platform: {platform.platform()}")
for mod in ["torch", "numpy", "pandas", "sklearn", "scipy"]:
    try:
        m = __import__(mod); print(f"  {mod}: {getattr(m, '__version__', '?')}")
    except ImportError as e: print(f"  {mod}: NOT INSTALLED ({e})")
print("\nGPU:")
try:
    import torch
    print(f"  cuda_available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            p = torch.cuda.get_device_properties(i)
            print(f"  device[{i}]: {p.name} | {p.total_memory / 1024**3:.1f} GB | compute {p.major}.{p.minor}")
        x = torch.randn(2048, 2048, device='cuda'); t0 = time.time()
        for _ in range(10): y = x @ x
        torch.cuda.synchronize()
        gflops = (10 * 2 * 2048**3) / (time.time() - t0) / 1e9
        print(f"  matmul 2048x2048 x10: {gflops:.0f} GFLOPS")
except Exception as e: print(f"  torch error: {e}")
print("\nnvidia-smi:")
try:
    out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
    print(f"  {out.stdout.strip()}")
except Exception as e: print(f"  err: {e}")
print("\nTier 4 deps:")
for mod in ["torch_geometric", "transformers", "xgboost", "lightgbm", "mlflow"]:
    try: m = __import__(mod); print(f"  {mod}: {getattr(m, '__version__', '?')}")
    except ImportError: print(f"  {mod}: needs pip install in real kernel")
print("\n" + "=" * 60); print("DONE")

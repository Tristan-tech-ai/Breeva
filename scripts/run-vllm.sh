#!/usr/bin/env bash
# Launch local vLLM OpenAI-compatible server inside WSL2.
#
# Usage (from PowerShell on Windows host):
#   wsl -d Ubuntu-22.04 -u root -- bash /mnt/c/Users/Tristan/Downloads/breeva/scripts/run-vllm.sh
#
# Serves Qwen2.5-14B-Instruct-AWQ on localhost:8000. WSL2 default networking
# forwards localhost from Linux to Windows, so scripts/classify-backlog.ts on
# the Windows side reaches this server at http://localhost:8000/v1/...
#
# Tunables:
#   VLLM_MODEL_PATH      Local path to model weights (default: D:/breeva-ml-data/models/qwen2.5-14b-awq)
#   VLLM_SERVED_NAME     Name OpenAI clients send in `model` field (default matches HF id)
#   VLLM_PORT            (default: 8000)
#   VLLM_MAX_MODEL_LEN   (default: 4096 — trims 32K context to save KV cache)
#   VLLM_MAX_NUM_SEQS    (default: 12 — concurrent in-flight requests)
#   VLLM_GPU_UTIL        (default: 0.85)
set -euo pipefail

MODEL_PATH="${VLLM_MODEL_PATH:-/mnt/d/breeva-ml-data/models/qwen2.5-14b-awq}"
SERVED_NAME="${VLLM_SERVED_NAME:-Qwen/Qwen2.5-14B-Instruct-AWQ}"
PORT="${VLLM_PORT:-8000}"
MAX_LEN="${VLLM_MAX_MODEL_LEN:-4096}"
MAX_SEQS="${VLLM_MAX_NUM_SEQS:-12}"
GPU_UTIL="${VLLM_GPU_UTIL:-0.85}"

if [ ! -d "$MODEL_PATH" ]; then
  echo "model path not found: $MODEL_PATH" >&2
  exit 1
fi

# flashinfer (used by vLLM for attention/sampling) JIT-compiles CUDA kernels
# on first use and needs nvcc. CUDA 12.9 toolkit installed via NVIDIA apt repo;
# CUDA 12.9 supports sm_120 (RTX 5060 Ti / Blackwell). See vLLM error if these
# are unset: "Could not find nvcc and default cuda_home='/usr/local/cuda'".
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export PATH="$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib64:${LD_LIBRARY_PATH:-}"

exec /root/vllm-env/bin/python -m vllm.entrypoints.openai.api_server \
  --model "$MODEL_PATH" \
  --served-model-name "$SERVED_NAME" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --max-model-len "$MAX_LEN" \
  --gpu-memory-utilization "$GPU_UTIL" \
  --quantization awq_marlin \
  --max-num-seqs "$MAX_SEQS" \
  --enable-chunked-prefill \
  --no-enable-log-requests

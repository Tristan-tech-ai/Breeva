#!/usr/bin/env bash
# kg.sh — Multi-account Kaggle CLI wrapper.
#
# Why this exists:
#  Kaggle CLI's OAuth flow writes credentials.json to a fixed location
#  (~/.kaggle/credentials.json) and IGNORES KAGGLE_CONFIG_DIR for that file.
#  To use multiple accounts, we keep each account's credentials in
#  ~/.kaggle-<account>/credentials.json and swap to default location before
#  each operation.
#
# Usage:
#   bash scripts/kaggle/kg.sh <account> <kaggle subcommand and args>
#
# Examples:
#   bash scripts/kaggle/kg.sh craftifyworld kernels push -p some/dir
#   bash scripts/kaggle/kg.sh tristanfirdaus kernels status user/slug
#   bash scripts/kaggle/kg.sh spotifyw datasets create -p dataset/dir
#
# Supported accounts (must have ~/.kaggle-<name>/credentials.json):
#   craftifyworld, tristanfirdaus, spotifyw

set -euo pipefail

ACCOUNT="${1:-}"
shift || true

if [ -z "$ACCOUNT" ]; then
  echo "usage: $0 <account> <kaggle subcommand and args>" >&2
  echo "available accounts:" >&2
  for d in "$HOME"/.kaggle-*; do
    [ -d "$d" ] && echo "  $(basename "$d" | sed 's/^\.kaggle-//')" >&2
  done
  exit 2
fi

SRC="$HOME/.kaggle-$ACCOUNT/credentials.json"
DST="$HOME/.kaggle/credentials.json"

if [ ! -f "$SRC" ]; then
  echo "no credentials for account '$ACCOUNT' at $SRC" >&2
  exit 2
fi

# Atomic swap: copy per-account creds to default location.
mkdir -p "$HOME/.kaggle"
cp "$SRC" "$DST"

# Run kaggle CLI with whatever args passed
exec "C:/Users/Tristan/AppData/Local/Python/pythoncore-3.14-64/Scripts/kaggle.exe" "$@"

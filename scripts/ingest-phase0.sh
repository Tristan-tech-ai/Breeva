#!/usr/bin/env bash
# Sequential OSM ingest 6 kota Phase 0.
# Run: bash scripts/ingest-phase0.sh
# Logs: logs/ingest-phase0-*.log
set -u

cd "$(dirname "$0")/.."
source vayu/.venv/Scripts/activate

mkdir -p logs

CITIES=(makassar palembang medan)
PASS=()
FAIL=()

for CITY in "${CITIES[@]}"; do
  echo ""
  echo "=========================================="
  echo "INGEST $CITY @ $(date +%H:%M:%S)"
  echo "=========================================="
  LOG="logs/ingest-phase0-$CITY.log"
  if python vayu/jobs/process_osm.py --region "$CITY" 2>&1 | tee "$LOG"; then
    LAST=$(grep -E "DONE" "$LOG" | tail -1)
    if [[ -n "$LAST" ]]; then
      echo "OK [$CITY]: $LAST"
      PASS+=("$CITY")
    else
      echo "WARN [$CITY]: pipeline returned 0 but no DONE marker"
      FAIL+=("$CITY")
    fi
  else
    echo "FAIL [$CITY]: pipeline returned non-zero exit"
    FAIL+=("$CITY")
  fi
  echo "Cooling down 30s before next region..."
  sleep 30
done

echo ""
echo "=========================================="
echo "PHASE 0 SUMMARY"
echo "=========================================="
echo "OK:   ${PASS[*]:-(none)}"
echo "FAIL: ${FAIL[*]:-(none)}"

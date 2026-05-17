#!/usr/bin/env bash
# Self-healing wrapper around scripts/classify-backlog.ts.
#
# Why this exists:
#  - Supabase REST occasionally returns 503 when overloaded (e.g., when
#    multiple processes hammer it). Workers in classify-backlog see
#    fetchNext() fail across all regions and exit prematurely with
#    "no more unclassified rows" — a false negative.
#  - On Windows, TaskStop in Claude Code doesn't reliably kill grandchild
#    pnpm/tsx processes, leading to multi-process races. This wrapper is
#    a single bash loop, so killing it kills the whole subtree cleanly.
#  - Cerebras free tier resets daily (UTC midnight) — when keys exhaust
#    mid-run, the script exits; this wrapper waits and resumes after reset.
#
# Loop behavior:
#  1. Probe Supabase health. If 503, wait 30s, retry. Loop until healthy.
#  2. Run classify-backlog.ts.
#  3. After it exits, query remaining row count.
#  4. If <100 rows remain → DONE, exit.
#  5. Otherwise sleep 60s and loop back to step 1.
#
# Run:
#   bash scripts/classify-backlog-loop.sh 2>&1 | tee .cache/classify-loop.log

set -uo pipefail

cd "$(dirname "$0")/.."

# Load env from .env.local
set -a
. .env.local 2>/dev/null || { echo "missing .env.local"; exit 1; }
set +a

SUPA_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [ -z "$SUPA_URL" ] || [ -z "$SUPA_KEY" ]; then
  echo "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  exit 1
fi

REGIONS="${REGIONS:-jakarta,bali,bandung,surabaya,medan,semarang,makassar,palembang,yogyakarta}"
BATCH="${BATCH:-100}"
GROQ_KEYS="${GROQ_KEYS:-0}"
DONE_THRESHOLD="${DONE_THRESHOLD:-100}"
HEALTH_WAIT_S="${HEALTH_WAIT_S:-30}"
RESTART_GAP_S="${RESTART_GAP_S:-60}"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

probe_supabase() {
  # 2xx response on /rest/v1/road_segments = healthy
  local code
  code=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' \
    "$SUPA_URL/rest/v1/road_segments?limit=1" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo 0)
  [ "$code" -ge 200 ] && [ "$code" -lt 400 ]
}

count_remaining() {
  # Use Range/count=exact to read total via Content-Range header
  local headers
  headers=$(curl -sS -I --max-time 30 \
    "$SUPA_URL/rest/v1/road_segments?ai_classified_at=is.null&region=in.(${REGIONS//,/%2C})" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
    -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null || true)
  printf '%s' "$headers" | grep -i '^content-range:' | grep -oE '/[0-9]+' | tr -d '/'
}

iteration=0
while true; do
  iteration=$((iteration + 1))
  log "=== iteration $iteration ==="

  # Step 1: wait for Supabase
  while ! probe_supabase; do
    log "supabase unhealthy, sleep ${HEALTH_WAIT_S}s"
    sleep "$HEALTH_WAIT_S"
  done
  log "supabase healthy"

  # Step 2: run classify-backlog
  log "starting classify-backlog (groq-keys=$GROQ_KEYS, batch=$BATCH, regions=$REGIONS)"
  pnpm tsx scripts/classify-backlog.ts \
    --batch="$BATCH" \
    --groq-keys="$GROQ_KEYS" \
    --regions="$REGIONS" 2>&1 | tee .cache/classify-backlog.log
  exit_code=${PIPESTATUS[0]}
  log "classify-backlog exited $exit_code"

  # Step 3: check remaining
  remaining=$(count_remaining)
  remaining=${remaining:-?}
  log "remaining unclassified: $remaining"

  # Step 4: done?
  if [ "$remaining" != "?" ] && [ "$remaining" -le "$DONE_THRESHOLD" ]; then
    log "BACKLOG DONE (under threshold $DONE_THRESHOLD)"
    break
  fi

  # Step 5: pause then loop
  log "still work to do, sleeping ${RESTART_GAP_S}s before next iteration"
  sleep "$RESTART_GAP_S"
done

#!/bin/bash
#
# deploy-functions-batched.sh — deploy Cloud Functions in small batches.
#
# WHY THIS EXISTS
#
# This project is at the Cloud Run CPU quota for europe-west2. A whole-estate deploy
# (`firebase deploy --only functions`, 258 functions) spikes concurrent container
# health-checks past that ceiling and a chunk of the deploy dies with:
#
#   Could not create or update Cloud Run service <name>, Container Healthcheck failed.
#   Quota exceeded for total allowable CPU per project per region.
#
# Measured on 2026-08-03: a 251-function deploy failed 24. Retrying just those 24 as one
# batch still failed 17. Deploying a single function succeeded first time. The quota is on
# CONCURRENT health-checks, not on total work — so small batches converge where one big
# batch cannot.
#
# The proper fix is a GCP quota increase (IAM & Admin > Quotas > Cloud Run Admin API >
# "CPU allocation, per region" > europe-west2), which only the project owner can request.
# Until that lands, this script is how a full deploy completes.
#
# This matters most for a RUNTIME CHANGE (e.g. Node 20 -> 22), which invalidates every
# function's build and therefore forces all of them to redeploy at once.
#
# USAGE
#   ./scripts/deploy-functions-batched.sh                  # all codebases, batch 8
#   ./scripts/deploy-functions-batched.sh --batch 5        # smaller batches
#   ./scripts/deploy-functions-batched.sh --codebase chores
#   ./scripts/deploy-functions-batched.sh --dry-run        # list the batches, deploy nothing
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

BATCH_SIZE=8
PAUSE_SECONDS=30
ONLY_CODEBASE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch)     BATCH_SIZE="$2"; shift 2 ;;
    --pause)     PAUSE_SECONDS="$2"; shift 2 ;;
    --codebase)  ONLY_CODEBASE="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[0;34m[INFO]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[ ✓ ]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[WARN]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[FAIL]\033[0m %s\n' "$*"; }

# Codebase name -> source directory, mirroring firebase.json.
CODEBASES="default:functions chores:functions-chores"

# Names come from actually loading index.js and reading the exports Firebase would deploy
# (anything carrying a __endpoint). Parsing the source with grep would also match commented-out
# and conditionally-skipped exports, and deploying a name that does not exist aborts the batch.
list_functions() {
  local dir="$1"
  (cd "$dir" && node -e "
    const idx = require('./index.js');
    console.log(Object.keys(idx).filter((k) => idx[k] && idx[k].__endpoint).join('\n'));
  " 2>/dev/null)
}

FAILED_ALL=()
DEPLOYED_COUNT=0

for entry in $CODEBASES; do
  codebase="${entry%%:*}"
  dir="${entry##*:}"

  [[ -n "$ONLY_CODEBASE" && "$ONLY_CODEBASE" != "$codebase" ]] && continue
  [[ -d "$dir" ]] || { warn "$dir not found, skipping codebase '$codebase'"; continue; }

  # `mapfile` is bash 4+; macOS ships bash 3.2, so read the list the portable way.
  fns=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && fns+=("$line")
  done < <(list_functions "$dir")
  if [[ ${#fns[@]} -eq 0 ]]; then
    err "Could not enumerate functions in $dir — does 'node -e \"require(\\\"./index.js\\\")\"' work there?"
    exit 1
  fi

  log "Codebase '$codebase' ($dir): ${#fns[@]} functions, batches of $BATCH_SIZE"

  total=${#fns[@]}
  batch_num=0
  for ((i = 0; i < total; i += BATCH_SIZE)); do
    batch=("${fns[@]:i:BATCH_SIZE}")
    batch_num=$((batch_num + 1))
    targets=""
    for f in "${batch[@]}"; do
      targets+="${targets:+,}functions:${codebase}:${f}"
    done

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  batch $batch_num: ${batch[*]}"
      continue
    fi

    log "  batch $batch_num ($((i + 1))-$((i + ${#batch[@]})) of $total): ${batch[*]}"
    batch_log="$(mktemp -t bob_batch_deploy)"
    # Output goes to a file, never a pipe into head/grep: with this many log lines a pipe that
    # closes early SIGPIPEs the firebase process and kills the deploy mid-flight while still
    # reporting success. That exact bug cost a silent partial deploy on 2026-07-21.
    firebase deploy --only "$targets" --force > "$batch_log" 2>&1
    status=$?

    if [[ $status -eq 0 ]]; then
      ok "  batch $batch_num deployed"
      DEPLOYED_COUNT=$((DEPLOYED_COUNT + ${#batch[@]}))
    else
      # Pull out which ones actually failed; the rest of the batch did land.
      # Two error shapes, both seen in production:
      #   "- Error Failed to update function NAME in region europe-west2"   (quota, transient)
      #   "Error: [NAME(europe-west2)] Upgrading from 1st Gen to 2nd Gen..." (structural)
      # Matching only the first meant a Gen 1 batch produced no per-function names, fell into
      # the whole-batch fallback below, and retried eight functions that were mostly fine.
      batch_failed=()
      while IFS= read -r line; do
        [[ -n "$line" ]] && batch_failed+=("$line")
      done < <({
        grep -oE '^- Error Failed to (update|create) function [^ ]+' "$batch_log" | awk '{print $NF}'
        grep -oE '^Error: \[[A-Za-z0-9_]+\(' "$batch_log" | sed -E 's/^Error: \[([A-Za-z0-9_]+)\($/\1/'
      } | sort -u)
      if [[ ${#batch_failed[@]} -eq 0 ]]; then
        err "  batch $batch_num failed with no per-function errors — see $batch_log"
        grep -E "Error" "$batch_log" | head -5 >&2
        FAILED_ALL+=("${batch[@]/#/${codebase}:}")
      else
        warn "  batch $batch_num: ${#batch_failed[@]} of ${#batch[@]} failed — will retry individually"
        FAILED_ALL+=("${batch_failed[@]/#/${codebase}:}")
        DEPLOYED_COUNT=$((DEPLOYED_COUNT + ${#batch[@]} - ${#batch_failed[@]}))
      fi
    fi

    # Let the health-check containers from this batch drain before starting the next, which is
    # the whole point — back-to-back batches recreate the concurrency spike being avoided.
    if (( i + BATCH_SIZE < total )); then
      sleep "$PAUSE_SECONDS"
    fi
  done
done

[[ "$DRY_RUN" == "true" ]] && { log "Dry run — nothing deployed."; exit 0; }

# Individual retries. One at a time is the configuration measured to succeed against the quota.
if [[ ${#FAILED_ALL[@]} -gt 0 ]]; then
  log "Retrying ${#FAILED_ALL[@]} failed function(s) individually..."
  STILL_FAILED=()
  for qualified in "${FAILED_ALL[@]}"; do
    cb="${qualified%%:*}"
    fn="${qualified##*:}"
    retry_log="$(mktemp -t bob_retry_deploy)"
    firebase deploy --only "functions:${cb}:${fn}" --force > "$retry_log" 2>&1
    if [[ $? -eq 0 ]]; then
      ok "  $fn"
      DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
    else
      err "  $fn — see $retry_log"
      STILL_FAILED+=("$fn")
    fi
    sleep 10
  done

  if [[ ${#STILL_FAILED[@]} -gt 0 ]]; then
    err "${#STILL_FAILED[@]} function(s) still not deployed:"
    printf '       %s\n' "${STILL_FAILED[@]}" >&2
    err "Re-run this script to try again, or request the GCP quota increase (see header)."
    exit 1
  fi
fi

ok "All functions deployed ($DEPLOYED_COUNT)."

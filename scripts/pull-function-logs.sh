#!/usr/bin/env bash
set -euo pipefail

# Pull recent Cloud Functions (Gen2) logs into a timestamped folder for offline analysis.
#
# Usage:
#   scripts/pull-function-logs.sh [PROJECT_ID] [REGION] [LIMIT]
#
# Defaults:
#   PROJECT_ID = bob20250810
#   REGION     = europe-west2
#   LIMIT      = 1000 (per function)
#
# Output:
#   logs/functions/<UTC_TIMESTAMP>/
#     functions.txt                # list of functions
#     <func>.describe.txt          # gcloud functions describe
#     <func>.logs.txt              # raw logs (via `gcloud functions logs read`)
#     combined.logs.txt            # concatenated logs (all functions)

PROJECT_ID="${1:-bob20250810}"
REGION="${2:-europe-west2}"
LIMIT="${3:-1000}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI not found. Please install and auth (gcloud init)." >&2
  exit 1
fi

TS=$(date -u +%Y%m%d_%H%M%S)
OUTDIR="logs/functions/${TS}"
mkdir -p "${OUTDIR}"

echo "Project: ${PROJECT_ID}  Region: ${REGION}  Limit: ${LIMIT}"
echo "Output:  ${OUTDIR}"

echo "Listing functions (Gen2)…" | tee "${OUTDIR}/_status.txt"
gcloud functions list --gen2 --region "${REGION}" --project "${PROJECT_ID}" \
  --format="value(name)" | tee "${OUTDIR}/functions.txt"

mapfile -t FUNCS < "${OUTDIR}/functions.txt"
if [[ ${#FUNCS[@]} -eq 0 ]]; then
  echo "No functions found in region ${REGION}." | tee -a "${OUTDIR}/_status.txt"
  exit 0
fi

COMBINED="${OUTDIR}/combined.logs.txt"
>"${COMBINED}"

for F in "${FUNCS[@]}"; do
  [[ -z "${F}" ]] && continue
  echo "\n=== ${F} ===" | tee -a "${OUTDIR}/_status.txt"

  # Describe output for context
  gcloud functions describe "${F}" --gen2 --region "${REGION}" --project "${PROJECT_ID}" \
    > "${OUTDIR}/${F}.describe.txt" 2>&1 || true

  # Try native logs read first (human-friendly; fastest)
  if gcloud functions logs read "${F}" --gen2 --region "${REGION}" --limit "${LIMIT}" \
    --project "${PROJECT_ID}" > "${OUTDIR}/${F}.logs.txt" 2>&1; then
    echo "wrote: ${OUTDIR}/${F}.logs.txt"
  else
    echo "fallback to Cloud Logging API for ${F}" | tee -a "${OUTDIR}/_status.txt"
    # Fallback: Cloud Logging filter (Gen2 runs on Cloud Run under the hood)
    gcloud logging read \
      "resource.type=cloud_run_revision AND resource.labels.service_name='${F}' AND resource.labels.location='${REGION}'" \
      --project "${PROJECT_ID}" \
      --limit "${LIMIT}" --format="text" > "${OUTDIR}/${F}.logs.txt" 2>&1 || true
  fi

  { echo "\n===== ${F} ====="; cat "${OUTDIR}/${F}.logs.txt"; } >> "${COMBINED}"
done

echo "\nCollected logs for ${#FUNCS[@]} functions. Combined: ${COMBINED}" | tee -a "${OUTDIR}/_status.txt"


#!/usr/bin/env bash
set -euo pipefail

# Pull logs for ALL Cloud Functions (Gen2 and Gen1) across regions into a structured directory.
# Also exports JSON from Cloud Logging for deeper parsing.
#
# Usage:
#   scripts/pull-all-function-logs.sh [PROJECT_ID] [FRESHNESS] [LIMIT]
#
# Defaults:
#   PROJECT_ID = bob20250810
#   FRESHNESS  = 24h        (how far back to query using Cloud Logging API)
#   LIMIT      = 1000       (per function, per source)
#
# Output example:
#   logs/functions/20250101_120000/
#     gen2/<region>/<func>.describe.txt
#     gen2/<region>/<func>.logs.txt         (from `gcloud functions logs read`)
#     gen2/<region>/<func>.jsonl            (from Cloud Logging API)
#     gen1/<region>/<func>.describe.txt
#     gen1/<region>/<func>.logs.txt
#     gen1/<region>/<func>.jsonl
#     combined.gen2.logs.txt
#     combined.gen1.logs.txt

PROJECT_ID="${1:-bob20250810}"
FRESHNESS="${2:-24h}"
LIMIT="${3:-1000}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI not found. Please install and authenticate (gcloud init)." >&2
  exit 1
fi

TS=$(date -u +%Y%m%d_%H%M%S)
ROOT="logs/functions/${TS}"
mkdir -p "${ROOT}" && : >"${ROOT}/_status.txt"

echo "Project: ${PROJECT_ID}" | tee -a "${ROOT}/_status.txt"
echo "Freshness: ${FRESHNESS}  Limit: ${LIMIT}" | tee -a "${ROOT}/_status.txt"

combined_gen2="${ROOT}/combined.gen2.logs.txt"
combined_gen1="${ROOT}/combined.gen1.logs.txt"
>"${combined_gen2}"; >"${combined_gen1}"

# -----------------
# Gen2 enumeration
# -----------------
echo "Enumerating Gen2 functions…" | tee -a "${ROOT}/_status.txt"
GEN2_JSON=$(gcloud functions list --v2 --project "${PROJECT_ID}" --format json || echo '[]')
echo "${GEN2_JSON}" > "${ROOT}/gen2.functions.json"

gen2_count=$(echo "${GEN2_JSON}" | jq 'length')
echo "Gen2 count: ${gen2_count}" | tee -a "${ROOT}/_status.txt"

for row in $(echo "${GEN2_JSON}" | jq -r '.[] | @base64'); do
  _jq(){ echo "$row" | base64 --decode | jq -r "$1"; }
  full=$(_jq '.name')         # projects/<pid>/locations/<region>/functions/<func>
  [[ -z "${full}" ]] && continue
  region=$(_jq '.name | split("/")[3]')
  short=$(_jq '.name | split("/")[5]')
  [[ -z "${region}" || -z "${short}" ]] && continue

  dir="${ROOT}/gen2/${region}"
  mkdir -p "${dir}"
  echo "Gen2: ${short} (${region})" | tee -a "${ROOT}/_status.txt"

  # Describe
  gcloud functions describe "${short}" --v2 --region "${region}" --project "${PROJECT_ID}" \
    > "${dir}/${short}.describe.txt" 2>&1 || true

  # Read human logs (best-effort)
  gcloud functions logs read "${short}" --v2 --region "${region}" --limit "${LIMIT}" \
    --project "${PROJECT_ID}" > "${dir}/${short}.logs.txt" 2>&1 || true
  { echo "\n===== ${region}/${short} ====="; cat "${dir}/${short}.logs.txt"; } >> "${combined_gen2}"

  # JSON logs via Cloud Logging API (use Cloud Run service name)
  service_name=$(_jq '.serviceConfig.service | split("/") | last')
  gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name='${service_name}' AND resource.labels.location='${region}'" \
    --freshness "${FRESHNESS}" --project "${PROJECT_ID}" --limit "${LIMIT}" --format=json \
    > "${dir}/${short}.jsonl" 2>/dev/null || true
done

# -----------------
# Gen1 enumeration
# -----------------
echo "Enumerating Gen1 functions…" | tee -a "${ROOT}/_status.txt"
GEN1_JSON=$(gcloud functions list --project "${PROJECT_ID}" --format json || echo '[]')
echo "${GEN1_JSON}" > "${ROOT}/gen1.functions.json"
gen1_count=$(echo "${GEN1_JSON}" | jq 'length')
echo "Gen1 count: ${gen1_count}" | tee -a "${ROOT}/_status.txt"

for row in $(echo "${GEN1_JSON}" | jq -r '.[] | @base64'); do
  _jq(){ echo "$row" | base64 --decode | jq -r "$1"; }
  full=$(_jq '.name')
  [[ -z "${full}" ]] && continue
  region=$(_jq '.name | split("/")[3]')
  short=$(_jq '.name | split("/")[5]')
  [[ -z "${region}" || -z "${short}" ]] && continue
  dir="${ROOT}/gen1/${region}"
  mkdir -p "${dir}"
  echo "Gen1: ${short} (${region})" | tee -a "${ROOT}/_status.txt"

  gcloud functions describe "${short}" --region "${region}" --project "${PROJECT_ID}" \
    > "${dir}/${short}.describe.txt" 2>&1 || true

  gcloud functions logs read "${short}" --region "${region}" --limit "${LIMIT}" \
    --project "${PROJECT_ID}" > "${dir}/${short}.logs.txt" 2>&1 || true
  { echo "\n===== ${region}/${short} ====="; cat "${dir}/${short}.logs.txt"; } >> "${combined_gen1}"

  gcloud logging read \
    "resource.type=cloud_function AND resource.labels.function_name='${short}' AND resource.labels.region='${region}'" \
    --freshness "${FRESHNESS}" --project "${PROJECT_ID}" --limit "${LIMIT}" --format=json \
    > "${dir}/${short}.jsonl" 2>/dev/null || true
done

echo "\nWrote: ${ROOT}" | tee -a "${ROOT}/_status.txt"
echo "Combined logs: ${combined_gen2}, ${combined_gen1}" | tee -a "${ROOT}/_status.txt"

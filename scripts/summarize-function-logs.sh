#!/usr/bin/env bash
set -euo pipefail

# Summarize a folder of function logs produced by pull-function-logs.sh
# Usage: scripts/summarize-function-logs.sh logs/functions/<timestamp>

DIR="${1:-}"
if [[ -z "${DIR}" || ! -d "${DIR}" ]]; then
  echo "Provide the logs directory (e.g., logs/functions/20250101_000000)" >&2
  exit 1
fi

OUTTXT="${DIR}/summary.txt"
OUTCSV="${DIR}/summary.csv"
echo "function,total,error,unauth,invalid_arg,permission,quota,unavailable,planBusy,calendarErr" > "${OUTCSV}"
> "${OUTTXT}"

for file in "${DIR}"/*.logs.txt; do
  [[ ! -f "${file}" ]] && continue
  fn=$(basename "${file}" .logs.txt)
  total=$(wc -l <"${file}" | tr -d ' ')
  error=$(grep -Ei "\berror\b|https?Error|exception" -c "${file}" || true)
  unauth=$(grep -Ei "unauthenticated|401" -c "${file}" || true)
  invalid=$(grep -Ei "invalid-argument|400" -c "${file}" || true)
  perm=$(grep -Ei "permission|denied" -c "${file}" || true)
  quota=$(grep -Ei "RESOURCE_EXHAUSTED|quota" -c "${file}" || true)
  unavail=$(grep -Ei "UNAVAILABLE|deadline|timeout" -c "${file}" || true)
  planbusy=$(grep -Ei "\[planBlocksV2\].*busy fetch failed" -c "${file}" || true)
  calerr=$(grep -Ei "calendar|googleapis.*(4..|5..)" -c "${file}" || true)

  printf "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n" \
    "$fn" "$total" "$error" "$unauth" "$invalid" "$perm" "$quota" "$unavail" "$planbusy" "$calerr" \
    >> "${OUTCSV}"

  {
    echo "==== ${fn} ===="
    echo "lines: $total  errors: $error  unauth: $unauth  invalid-arg: $invalid  perm: $perm  quota: $quota  unavailable: $unavail  planBusyFail: $planbusy  calErr: $calerr"
    echo
    grep -E "(HttpsError|unauthenticated|invalid-argument|permission|RESOURCE_EXHAUSTED|UNAVAILABLE|deadline|\[planBlocksV2\]|googleapis)" -n "${file}" || true
    echo
  } >> "${OUTTXT}"
done

echo "Wrote summaries: ${OUTTXT} and ${OUTCSV}" >&2


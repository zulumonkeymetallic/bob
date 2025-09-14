#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://bob20250810.web.app}"
UID="${UID:-YOUR_USER_ID}"
SECRET="${SECRET:-YOUR_SECRET}"

curl -sS -H "x-reminders-secret: ${SECRET}" \
  "${BASE}/reminders/push?uid=${UID}" | jq .


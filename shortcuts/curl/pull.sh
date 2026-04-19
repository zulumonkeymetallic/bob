#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://bob20250810.web.app}"
UID="${UID:-YOUR_USER_ID}"
SECRET="${SECRET:-YOUR_SECRET}"

BODY='{"tasks":[{"id":"REPLACE_WITH_TASK_ID","reminderId":"REMINDER_ID","completed":true}]}'

curl -sS -X POST -H "x-reminders-secret: ${SECRET}" -H "Content-Type: application/json" \
  -d "$BODY" \
  "${BASE}/reminders/pull?uid=${UID}" | jq .


#!/usr/bin/env bash

# Bob API Tester — interactive curl menu for Functions/Webhooks
# Requirements: bash, curl. Optional: jq, xdg-open/open (for OAuth links)

set -euo pipefail

SCRIPT_NAME="bob-api-tester"

# Colors
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo -e "${RED}Error:${NC} '$1' not found"; exit 1; }
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

pp_json() {
  if has_cmd jq; then jq "."; else cat; fi
}

banner() {
  echo -e "${CYAN}==============================================${NC}"
  echo -e "${CYAN}  $SCRIPT_NAME — Firebase Functions tester${NC}"
  echo -e "${CYAN}==============================================${NC}"
}

prompt_default() {
  local prompt="$1"; local default="${2-}"
  if [ -n "${default}" ]; then
    read -r -p "${prompt} [${default}]: " REPLY || true
    echo "${REPLY:-$default}"
  else
    read -r -p "${prompt}: " REPLY || true
    echo "${REPLY}"
  fi
}

random_nonce() { openssl rand -hex 8 2>/dev/null || echo "$RANDOM$RANDOM"; }

# Global env (can be set before running or loaded from .env)
REGION="${REGION:-europe-west2}"
PROJECT="${PROJECT:-}"
BASE="${BASE:-}"
OWNER_UID="${OWNER_UID:-}"
ID_TOKEN="${ID_TOKEN:-}"
N8N_WEBHOOK_SECRET="${N8N_WEBHOOK_SECRET:-}"
REMINDERS_WEBHOOK_SECRET="${REMINDERS_WEBHOOK_SECRET:-}"
LOG_DIR="${LOG_DIR:-${PWD}/logs}"
LOG_FILE=""

init_logs() {
  mkdir -p "$LOG_DIR"
  LOG_FILE="${LOG_DIR}/api-test-$(date +%Y%m%d-%H%M%S).log"
  : >"$LOG_FILE"
  echo -e "${GREEN}Logging to:${NC} $LOG_FILE"
}

log() { echo -e "$*" | tee -a "$LOG_FILE" >/dev/null; }
log_section() { echo -e "\n${CYAN}== $* ==${NC}" | tee -a "$LOG_FILE"; }
log_json() { if has_cmd jq; then jq "." | tee -a "$LOG_FILE"; else tee -a "$LOG_FILE"; fi }

# Load key=value pairs from .env-like file (safe parser: ignores non KEY=VALUE lines)
load_env_file() {
  local file="$1"
  if [ ! -f "$file" ]; then echo -e "${RED}File not found:${NC} $file"; return 1; fi
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading/trailing whitespace
    line="${line%%[[:space:]]*}${line#*[![:space:]]}"
    # Skip comments/blank
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      key="${line%%=*}"
      val="${line#*=}"
      # strip surrounding quotes
      if [[ "$val" =~ ^\".*\"$ ]]; then val="${val:1:${#val}-2}"; fi
      if [[ "$val" =~ ^\'.*\'$ ]]; then val="${val:1:${#val}-2}"; fi
      export "$key=$val"
    fi
  done < "$file"
  echo -e "${GREEN}Loaded env from:${NC} $file"
}

# Attempt initial .env load from common locations unless disabled
initial_env_load() {
  local dir script_dir env_file
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for env_file in "${BOB_ENV_FILE:-}" \
                   "$PWD/.env" \
                   "$PWD/bob-api-tester.env" \
                   "$script_dir/.env" \
                   "$script_dir/../.env" \
                   "$script_dir/bob-api-tester.env" \
                   "$script_dir/bob-api-tester.env.local"; do
    [ -n "$env_file" ] || continue
    if [ -f "$env_file" ]; then load_env_file "$env_file"; break; fi
  done
}

ensure_env() {
  REGION=$(prompt_default "Cloud Functions region" "${REGION}")
  PROJECT=$(prompt_default "Firebase project id" "${PROJECT}")
  if [ -z "${PROJECT}" ]; then echo -e "${RED}Project is required${NC}"; return 1; fi
  BASE="https://${REGION}-${PROJECT}.cloudfunctions.net"
  OWNER_UID=$(prompt_default "Owner UID (Firestore user id)" "${OWNER_UID}")
  ID_TOKEN=$(prompt_default "Firebase ID token (paste)" "${ID_TOKEN}")
  N8N_WEBHOOK_SECRET=$(prompt_default "n8n webhook secret (x-webhook-secret)" "${N8N_WEBHOOK_SECRET}")
  REMINDERS_WEBHOOK_SECRET=$(prompt_default "Reminders webhook secret" "${REMINDERS_WEBHOOK_SECRET}")
  export REGION PROJECT BASE OWNER_UID ID_TOKEN N8N_WEBHOOK_SECRET REMINDERS_WEBHOOK_SECRET
  echo -e "${GREEN}Environment configured.${NC} BASE=${BASE}"
}

open_url() {
  local url="$1"
  if has_cmd open; then open "$url" >/dev/null 2>&1 || true
  elif has_cmd xdg-open; then xdg-open "$url" >/dev/null 2>&1 || true
  else echo "Open in browser: $url"; fi
}

ensure_auth() {
  if [ -z "${ID_TOKEN}" ]; then echo -e "${YELLOW}ID_TOKEN is not set. Use 'Configure env' first.${NC}"; return 1; fi
}

tmp_json() { mktemp "${TMPDIR:-/tmp}/bob-json.XXXXXX.json"; }

post_callable() {
  # $1 endpoint name, $2 raw JSON for data object (e.g. '{"foo":1}')
  ensure_auth || return 1
  local ep="$1"; shift
  local data_json="$1"; shift || true
  local body; body=$(tmp_json)
  printf '{"data": %s}\n' "$data_json" >"$body"
  log "POST callable: $ep"
  curl -sS -X POST "$BASE/$ep" \
    -H "Authorization: Bearer $ID_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @"$body" | log_json
  rm -f "$body"
}

post_http() {
  # $1 path, $2 raw JSON
  local path="$1"; shift
  local json="$1"; shift || true
  log "POST http: $path"
  curl -sS -X POST "$BASE/$path" -H "Content-Type: application/json" -d "$json" | log_json
}

# === Actions ===

action_plan_calendar() {
  local persona horizon apply
  persona=$(prompt_default "Persona" "personal")
  horizon=$(prompt_default "Horizon (days)" "7")
  apply=$(prompt_default "Apply if score >=" "0.8")
  post_callable "planCalendar" "{\"persona\":\"$persona\",\"horizonDays\":$horizon,\"applyIfScoreGe\":$apply}"
}

action_prioritize_backlog() {
  echo "Paste tasks JSON array or leave empty for sample:"; read -r tasks || true
  if [ -z "$tasks" ]; then
    tasks='[{"id":"t1","title":"Write report","priority":3},{"id":"t2","title":"Email client","priority":2}]'
  fi
  post_callable "prioritizeBacklog" "{\"tasks\":$tasks}"
}

action_gcal_create() {
  local summary start end
  summary=$(prompt_default "Summary" "Focus block")
  start=$(prompt_default "Start ISO" "$(date -u -v+1H +%Y-%m-%dT%H:00:00Z 2>/dev/null || date -u -d '+1 hour' +%Y-%m-%dT%H:00:00Z)")
  end=$(prompt_default "End ISO" "$(date -u -v+3H +%Y-%m-%dT%H:00:00Z 2>/dev/null || date -u -d '+3 hour' +%Y-%m-%dT%H:00:00Z)")
  post_callable "createCalendarEvent" "{\"summary\":\"$summary\",\"start\":\"$start\",\"end\":\"$end\"}"
}

action_gcal_list() {
  local max; max=$(prompt_default "Max results" "10")
  post_callable "listUpcomingEvents" "{\"maxResults\":$max}"
}

action_gcal_update() {
  local id summary start end
  id=$(prompt_default "Event ID" "")
  summary=$(prompt_default "New summary (optional)" "")
  start=$(prompt_default "New start ISO (optional)" "")
  end=$(prompt_default "New end ISO (optional)" "")
  # Build JSON with only provided fields
  local fields="\"eventId\":\"$id\""; [ -n "$summary" ] && fields="$fields,\"summary\":\"$summary\""; [ -n "$start" ] && fields="$fields,\"start\":\"$start\""; [ -n "$end" ] && fields="$fields,\"end\":\"$end\""
  post_callable "updateCalendarEvent" "{$fields}"
}

action_gcal_delete() {
  local id; id=$(prompt_default "Event ID" "")
  post_callable "deleteCalendarEvent" "{\"eventId\":\"$id\"}"
}

action_gcal_sync_plan() {
  local day; day=$(prompt_default "Day (YYYY-MM-DD)" "$(date +%F)")
  post_callable "syncPlanToGoogleCalendar" "{\"day\":\"$day\"}"
}

action_monzo_oauth_start() {
  local nonce; nonce=$(random_nonce)
  local url="$BASE/monzoOAuthStart?uid=${OWNER_UID}&nonce=${nonce}"
  echo "Opening: $url"; open_url "$url"
}

action_monzo_list_accounts() {
  post_callable "monzoListAccounts" "{}"
}

action_monzo_register_webhook() {
  local acc; acc=$(prompt_default "Monzo accountId" "")
  local url="$BASE/monzoWebhook"
  post_callable "monzoRegisterWebhook" "{\"accountId\":\"$acc\",\"url\":\"$url\"}"
}

action_monzo_sync_tx() {
  local acc since; acc=$(prompt_default "Monzo accountId" ""); since=$(prompt_default "Since (ISO, optional)" "")
  if [ -n "$since" ]; then
    post_callable "monzoSyncTransactions" "{\"accountId\":\"$acc\",\"since\":\"$since\"}"
  else
    post_callable "monzoSyncTransactions" "{\"accountId\":\"$acc\"}"
  fi
}

action_monzo_webhook_sim() {
  local acc; acc=$(prompt_default "Monzo accountId to simulate" "acc_123456789")
  post_http "monzoWebhook" "{\"type\":\"transaction.created\",\"data\":{\"id\":\"tx_test\",\"created\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"description\":\"Test Shop\",\"amount\":-999,\"currency\":\"GBP\",\"account_id\":\"$acc\"}}"
}

ms_from_now() {
  local minutes="$1"; local now_s; now_s=$(date +%s)
  echo $(( (now_s + minutes*60) * 1000 ))
}

action_n8n_block_create() {
  local title theme start_min end_min
  title=$(prompt_default "Block title" "Deep Work")
  theme=$(prompt_default "Theme" "Work")
  start_min=$(prompt_default "Start offset minutes from now" "60")
  end_min=$(prompt_default "End offset minutes from now" "180")
  local start_ms end_ms; start_ms=$(ms_from_now "$start_min"); end_ms=$(ms_from_now "$end_min")
  post_http "n8nCalendarWebhook" "{\"action\":\"create\",\"ownerUid\":\"$OWNER_UID\",\"block\":{\"title\":\"$title\",\"theme\":\"$theme\",\"start\":$start_ms,\"end\":$end_ms}}" \
    | tee /dev/stderr | (has_cmd jq && jq -r '.id' || true)
}

action_n8n_block_update() {
  local id new_title; id=$(prompt_default "Block ID" ""); new_title=$(prompt_default "New title" "Updated Block")
  post_http "n8nCalendarWebhook" "{\"action\":\"update\",\"ownerUid\":\"$OWNER_UID\",\"id\":\"$id\",\"block\":{\"title\":\"$new_title\"}}"
}

action_n8n_block_delete() {
  local id; id=$(prompt_default "Block ID" "")
  post_http "n8nCalendarWebhook" "{\"action\":\"delete\",\"ownerUid\":\"$OWNER_UID\",\"id\":\"$id\"}"
}

action_reminders_push() {
  curl -sS "$BASE/remindersPush?uid=${OWNER_UID}&secret=${REMINDERS_WEBHOOK_SECRET}" | pp_json
}

action_reminders_pull() {
  local taskId; taskId=$(prompt_default "Task ID to mark completed" "")
  local payload
  if [ -n "$taskId" ]; then
    payload="{\"uid\":\"$OWNER_UID\",\"tasks\":[{\"id\":\"$taskId\",\"completed\":true}]}"
  else
    payload="{\"uid\":\"$OWNER_UID\",\"tasks\":[]}"
  fi
  curl -sS -X POST "$BASE/remindersPull" \
    -H "Content-Type: application/json" \
    -H "x-reminders-secret: $REMINDERS_WEBHOOK_SECRET" \
    -d "$payload" | pp_json
}

action_email_test() { post_callable "sendTestEmail" "{}"; }
action_email_daily_now() { post_callable "sendDailySummaryNow" "{}"; }
action_email_quality_now() { post_callable "sendDataQualityNow" "{}"; }

# === Automation helpers ===
fetch_id_token_password_flow() {
  local api_key email password
  api_key=$(prompt_default "Firebase Web API Key (FIREBASE_WEB_API_KEY)" "${FIREBASE_WEB_API_KEY:-}")
  email=$(prompt_default "Auth email (AUTH_EMAIL)" "${AUTH_EMAIL:-}")
  read -r -s -p "Auth password (AUTH_PASSWORD): " password; echo ""
  [ -z "$api_key" ] && { echo -e "${RED}API key required${NC}"; return 1; }
  [ -z "$email" ] && { echo -e "${RED}Email required${NC}"; return 1; }
  [ -z "$password" ] && { echo -e "${RED}Password required${NC}"; return 1; }
  export FIREBASE_WEB_API_KEY="$api_key" AUTH_EMAIL="$email" AUTH_PASSWORD="$password"
  log_section "Acquire ID token"
  local resp; resp=$(curl -sS -X POST \
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$AUTH_EMAIL\",\"password\":\"$AUTH_PASSWORD\",\"returnSecureToken\":true}") || true
  if has_cmd jq; then
    local tok; tok=$(echo "$resp" | jq -r '.idToken // empty')
    echo "$resp" | log_json >/dev/null
    if [ -n "$tok" ]; then ID_TOKEN="$tok"; export ID_TOKEN; echo -e "${GREEN}ID_TOKEN acquired and set.${NC}"; else echo "$resp" | pp_json; fi
  else
    # naive extraction
    local tok; tok=$(echo "$resp" | sed -n 's/.*"idToken"\s*:\s*"\([^"]*\)".*/\1/p')
    if [ -n "$tok" ]; then ID_TOKEN="$tok"; export ID_TOKEN; echo -e "${GREEN}ID_TOKEN acquired and set.${NC}"; else echo "$resp"; fi
  fi
}

action_google_oauth_start() {
  local url="$BASE/oauthStart"; echo "Opening: $url"; open_url "$url"
}

# === Auto checks & run-all ===
try_list_gcal() { post_callable "listUpcomingEvents" "{\"maxResults\":1}"; }
ensure_gcal_oauth() {
  log_section "Check Google Calendar OAuth"
  if try_list_gcal >/dev/null 2>&1; then log "GCal token OK"; return 0; fi
  echo -e "${YELLOW}Google OAuth not completed. Opening consent...${NC}"
  action_google_oauth_start
  echo "Waiting for consent... (up to 5 minutes)"
  local start_ts=$(date +%s)
  while true; do
    sleep 5
    if try_list_gcal >/dev/null 2>&1; then log "GCal token acquired"; break; fi
    local now=$(date +%s)
    if [ $((now-start_ts)) -gt 300 ]; then echo -e "${RED}Timed out waiting for Google OAuth${NC}"; return 1; fi
  done
}

list_monzo_accounts_raw() { post_callable "monzoListAccounts" "{}"; }
ensure_monzo_oauth() {
  log_section "Check Monzo OAuth"
  if list_monzo_accounts_raw >/dev/null 2>&1; then log "Monzo token OK"; return 0; fi
  echo -e "${YELLOW}Monzo OAuth not completed. Opening consent...${NC}"
  action_monzo_oauth_start
  echo "Waiting for consent... (up to 5 minutes)"
  local start_ts=$(date +%s)
  while true; do
    sleep 5
    if list_monzo_accounts_raw >/dev/null 2>&1; then log "Monzo token acquired"; break; fi
    local now=$(date +%s)
    if [ $((now-start_ts)) -gt 300 ]; then echo -e "${RED}Timed out waiting for Monzo OAuth${NC}"; return 1; fi
  done
}

auto_register_monzo_webhook() {
  log_section "Register Monzo webhook (first account)"
  local resp; resp=$(curl -sS -X POST "$BASE/monzoListAccounts" -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" -d '{"data":{}}')
  echo "$resp" | log_json >/dev/null
  local acc
  if has_cmd jq; then
    acc=$(echo "$resp" | jq -r '.accounts[0].id // empty')
  else
    acc=$(echo "$resp" | sed -n 's/.*"id"\s*:\s*"\([^"]*\)".*/\1/p' | head -n1)
  fi
  if [ -z "$acc" ]; then echo -e "${YELLOW}No accounts found to register webhook${NC}"; return 0; fi
  post_callable "monzoRegisterWebhook" "{\"accountId\":\"$acc\",\"url\":\"$BASE/monzoWebhook\"}"
}

run_all() {
  banner
  init_logs
  if [ -z "${PROJECT:-}" ]; then ensure_env; fi
  # Acquire token if missing
  if [ -z "${ID_TOKEN:-}" ]; then fetch_id_token_password_flow || { echo -e "${RED}Failed to acquire ID token${NC}"; return 1; }; fi
  ensure_gcal_oauth || return 1
  ensure_monzo_oauth || return 1
  auto_register_monzo_webhook || true

  log_section "AI: Plan Calendar"
  action_plan_calendar || true

  log_section "GCal: Sync Plan"
  action_gcal_sync_plan || true

  log_section "Monzo: Simulate webhook + Sync"
  action_monzo_webhook_sim || true
  action_monzo_sync_tx || true

  log_section "Email: Test + Daily + Data Quality"
  action_email_test || true
  action_email_daily_now || true
  action_email_quality_now || true

  log_section "Reminders: Push"
  action_reminders_push || true

  echo -e "${GREEN}Run-all complete. Logs at:${NC} $LOG_FILE"
}

print_menu() {
  echo ""
  echo -e "${CYAN}== Main Menu ==${NC} (BASE=${BASE:-unset})"
  cat <<'EOF'
1) Configure environment (region/project/uid/token/secrets)
L) Load environment from .env file
A) Acquire ID token (email/password)
R) Run ALL (automated end-to-end test & log)

AI / Planning
2) Plan calendar (LLM, Gemini)
3) Prioritize backlog (LLM, Gemini)

Google Calendar
G) Start Google OAuth (opens browser)
4) Create event
5) List upcoming events
6) Update event
7) Delete event
8) Sync plan assignments to Google (day)

Monzo
9) Start Monzo OAuth (opens browser)
10) List Monzo accounts
11) Register Monzo webhook for account
12) Sync Monzo transactions
13) Simulate Monzo webhook (transaction.created)

Calendar Blocks via n8n webhook
14) Create block
15) Update block
16) Delete block

Reminders bridge
17) Reminders Push (fetch to export)
18) Reminders Pull (apply updates)

Email (Nylas)
19) Send Test Email
20) Send Daily Summary Now
21) Send Data Quality Now

0) Exit
EOF
}

main() {
  require_cmd curl
  banner
  initial_env_load
  init_logs
  # Allow non-interactive run-all: e.g., ./bob-api-tester.sh run-all
  if [ "${1-}" = "run-all" ]; then run_all; exit $?; fi
  while true; do
    print_menu
    read -r -p "> Select option: " opt || exit 0
    case "$opt" in
      1) ensure_env ;;
      L|l) \
        file_path=$(prompt_default "Path to .env file" "${PWD}/.env"); \
        load_env_file "$file_path"; \
        ;;
      A|a) fetch_id_token_password_flow ;;
      R|r) run_all ;;
      2) action_plan_calendar ;;
      3) action_prioritize_backlog ;;
      G|g) action_google_oauth_start ;;
      4) action_gcal_create ;;
      5) action_gcal_list ;;
      6) action_gcal_update ;;
      7) action_gcal_delete ;;
      8) action_gcal_sync_plan ;;
      9) action_monzo_oauth_start ;;
      10) action_monzo_list_accounts ;;
      11) action_monzo_register_webhook ;;
      12) action_monzo_sync_tx ;;
      13) action_monzo_webhook_sim ;;
      14) action_n8n_block_create ;;
      15) action_n8n_block_update ;;
      16) action_n8n_block_delete ;;
      17) action_reminders_push ;;
      18) action_reminders_pull ;;
      19) action_email_test ;;
      20) action_email_daily_now ;;
      21) action_email_quality_now ;;
      0) echo "Bye"; exit 0 ;;
      *) echo -e "${YELLOW}Unknown option${NC}" ;;
    esac
  done
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

# Simple helper to set Firebase Functions secrets used by BOB integrations
# Usage:
#   ./scripts/set-secrets.sh    # interactive prompts
#   or set env vars:
#   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_WEBHOOK_VERIFY_TOKEN=... ./scripts/set-secrets.sh
# Optional: place values in .secrets.env (or .env.local / .env) and they will be sourced.

# Load dotenv files if present (order of precedence)
for f in .secrets.env .env.local .env; do
  if [ -f "$f" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$f"
    set +a
  fi
done

prompt_secret() {
  local var="$1"; local label="$2"; local current="${!var-}"
  if [ -z "${current}" ]; then
    read -r -p "Enter ${label}: " val
    export "${var}=${val}"
  fi
}

echo "Setting Strava secrets (Ctrl+C to cancel)"
prompt_secret STRAVA_CLIENT_ID "STRAVA_CLIENT_ID"
prompt_secret STRAVA_CLIENT_SECRET "STRAVA_CLIENT_SECRET"
prompt_secret STRAVA_WEBHOOK_VERIFY_TOKEN "STRAVA_WEBHOOK_VERIFY_TOKEN (any random string)"

printf "%s" "$STRAVA_CLIENT_ID" | firebase functions:secrets:set STRAVA_CLIENT_ID
printf "%s" "$STRAVA_CLIENT_SECRET" | firebase functions:secrets:set STRAVA_CLIENT_SECRET
printf "%s" "$STRAVA_WEBHOOK_VERIFY_TOKEN" | firebase functions:secrets:set STRAVA_WEBHOOK_VERIFY_TOKEN

echo "Optional: set other secrets if needed (press Enter to skip)"
read -r -p "OPENAI_API_KEY: " OPENAI_API_KEY || true
if [ -n "${OPENAI_API_KEY:-}" ]; then
  printf "%s" "$OPENAI_API_KEY" | firebase functions:secrets:set OPENAI_API_KEY
fi
read -r -p "GOOGLE_OAUTH_CLIENT_ID: " GOOGLE_OAUTH_CLIENT_ID || true
if [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
  printf "%s" "$GOOGLE_OAUTH_CLIENT_ID" | firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID
fi
read -r -p "GOOGLE_OAUTH_CLIENT_SECRET: " GOOGLE_OAUTH_CLIENT_SECRET || true
if [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  printf "%s" "$GOOGLE_OAUTH_CLIENT_SECRET" | firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
fi
read -r -p "TRAKT_CLIENT_ID: " TRAKT_CLIENT_ID || true
if [ -n "${TRAKT_CLIENT_ID:-}" ]; then
  printf "%s" "$TRAKT_CLIENT_ID" | firebase functions:secrets:set TRAKT_CLIENT_ID
fi
read -r -p "STEAM_WEB_API_KEY: " STEAM_WEB_API_KEY || true
if [ -n "${STEAM_WEB_API_KEY:-}" ]; then
  printf "%s" "$STEAM_WEB_API_KEY" | firebase functions:secrets:set STEAM_WEB_API_KEY
fi

echo "All requested secrets have been set. Deploy with:"
echo "  firebase deploy --only functions,firestore:indexes"

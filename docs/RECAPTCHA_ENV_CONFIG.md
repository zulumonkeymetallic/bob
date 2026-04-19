# reCAPTCHA Environment Configuration

This file documents all environment variables needed for reCAPTCHA security.

## Frontend (.env)

Create or update `react-app/.env`:

```bash
# reCAPTCHA V2 Invisible Configuration
# Site Key: Used by frontend to generate tokens
# Get from: https://www.google.com/recaptcha/admin
REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED

# Optional: Enable debug logging
# REACT_APP_DEBUG_RECAPTCHA=true

# Optional: App Check configuration (if you want to enable it separately)
# REACT_APP_ENABLE_APPCHECK=false
# REACT_APP_APPCHECK_DEBUG_TOKEN=false
```

## Backend (Firebase Functions)

Set via Firebase CLI:

```bash
# Get your Secret Key from: https://www.google.com/recaptcha/admin
# Copy the "Secret Key" from your BOB site settings

# Set it once in your Firebase project
firebase functions:config:set recaptcha.secret_key="[YOUR_SECRET_KEY_HERE]"

# Verify it was set
firebase functions:config:get

# Should output something like:
# recaptcha:
#   secret_key: 638a...82c4
```

## Development Environment

For local development with emulator:

```bash
# Start emulator with secrets
firebase emulators:start

# In another terminal, set environment variable
export RECAPTCHA_SECRET_KEY="your-test-key"

# Run your functions locally
npm run dev
```

## Production Environment

Your production Firebase project automatically:
- ✅ Reads `recaptcha.secret_key` from Config
- ✅ Sets `RECAPTCHA_SECRET_KEY` environment variable automatically
- ✅ No additional setup needed once `firebase functions:config:set` is run

## .env.example (Commit This)

**react-app/.env.example** - Commit this to repo:

```bash
# Frontend Configuration
REACT_APP_API_KEY=AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk
REACT_APP_AUTH_DOMAIN=bob20250810.firebaseapp.com
REACT_APP_PROJECT_ID=bob20250810

# Security
REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED

# Optional: Debugging
# REACT_APP_DEBUG_RECAPTCHA=false
```

## .gitignore

Ensure `.env` is in `.gitignore` to never commit secrets:

```bash
# In react-app/.gitignore
.env
.env.local
.env.*.local
```

## Docker / CI/CD

If deploying via Docker or CI/CD pipeline:

```dockerfile
# Dockerfile example
FROM node:18

WORKDIR /app

# Build args for secrets
ARG REACT_APP_RECAPTCHA_V2_SITE_KEY
ENV REACT_APP_RECAPTCHA_V2_SITE_KEY=$REACT_APP_RECAPTCHA_V2_SITE_KEY

COPY react-app .
RUN npm install && npm run build
```

Deploy with:
```bash
docker build \
  --build-arg REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED \
  -t my-app:latest .
```

## GitHub Actions / CI

Example for GitHub Actions:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

env:
  REACT_APP_RECAPTCHA_V2_SITE_KEY: ${{ secrets.RECAPTCHA_V2_SITE_KEY }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: cd react-app && npm install

      - name: Build
        run: cd react-app && npm run build

      - name: Deploy Firebase
        run: |
          firebase deploy \
            --token ${{ secrets.FIREBASE_TOKEN }} \
            --project bob20250810
```

Add secrets via GitHub:
- Settings → Secrets and variables → Actions → New repository secret
- `RECAPTCHA_V2_SITE_KEY` = `6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED`
- `FIREBASE_TOKEN` = (from `firebase login:ci`)

## Verifying Configuration

### Check Frontend

```bash
cd react-app
npm start

# In browser console:
# Should see:
# [reCAPTCHA] reCAPTCHA initialized successfully
```

### Check Backend

```bash
firebase functions:config:get

# Should output:
# functions:
#   recaptcha:
#     secret_key: "638a...82c4"
```

### Check Functions Have Access

```bash
# Deploy a test function
firebase deploy --only functions

# Check logs
firebase functions:log --follow

# Trigger a protected function
# Should see: [reCAPTCHA] reCAPTCHA passed with score X.XX
```

## Troubleshooting Configuration

| Problem | Solution |
|---------|----------|
| `key not defined` in frontend | Add `REACT_APP_RECAPTCHA_V2_SITE_KEY` to `react-app/.env` |
| Frontend says "No site key configured" | Ensure `.env` is loaded: `rm -rf node_modules/.cache` and restart |
| Backend says "Secret key not configured" | Run `firebase functions:config:set recaptcha.secret_key="..."`  |
| Functions can't read secret | Run `firebase deploy --only functions` after setting config |
| Dev server not picking up .env | Restart dev server: `npm start` |

## Rotating Keys (Security)

If you need to rotate reCAPTCHA keys:

1. **Generate new keys** in Google reCAPTCHA console
2. **Update frontend** `.env`:
   ```bash
   REACT_APP_RECAPTCHA_V2_SITE_KEY=new_site_key
   ```
3. **Update backend** config:
   ```bash
   firebase functions:config:set recaptcha.secret_key="new_secret_key"
   ```
4. **Redeploy**:
   ```bash
   firebase deploy --only functions hosting
   ```
5. **Verify** in logs: `firebase functions:log --follow`
6. **Optional**: Delete old keys from Google console

## Backup & Recovery

**Backup your keys:**
```bash
# Export current config
firebase functions:config:get > functions-config-backup.json

# Store in secure location (not git)
# Example: password manager, secret vault
```

**Restore if needed:**
```bash
# Read from backup
firebase functions:config:set recaptcha.secret_key="[from backup]"
```

---

## Summary

✅ **Frontend**: `REACT_APP_RECAPTCHA_V2_SITE_KEY` in `.env`
✅ **Backend**: `recaptcha.secret_key` via `firebase functions:config:set`
✅ **Never commit** `.env` file or `functions-config-backup.json`
✅ **Always verify** after setting: `firebase functions:config:get`

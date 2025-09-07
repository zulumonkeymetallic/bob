CI/CD — GitHub Actions + Firebase Hosting

- Workflow `ci.yml` (PRs, feature/fix branches):
  - Install root + `react-app` deps, install Playwright browsers
  - Build CRA app under `react-app/`
  - Run Playwright E2E against static build (PW_USE_BUILD=1)
  - Upload HTML report, traces/videos, and JUnit XML
  - On failure, auto-create issue with labels `ci`, `e2e`, `regression`

- Workflow `deploy.yml` (push to `main`):
  - Gate on green E2E (same as CI flow)
  - Deploy to Firebase Hosting via `FirebaseExtended/action-hosting-deploy`
  - Post release note with short commit hash and project id

Secrets

- `FIREBASE_SERVICE_ACCOUNT` (JSON)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CHANNEL` (e.g., `live`)
- `TEST_USER_EMAIL`
- `TEST_USER_PASSWORD`
- `CI` set to `true`


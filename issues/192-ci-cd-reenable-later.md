# 192 – Reintroduce CI/CD pipelines (low priority)

- Type: enhancement
- Priority: P3 (low)
- Status: Backlog

## Context
GitHub Actions workflows for CI and Firebase deploy previews were removed temporarily to simplify manual deploys while stabilizing core features (roadmap, routines, chores/goals).

Removed workflows:
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-preview.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/cleanup-preview.yml`
- `.github/workflows/post-merge-rename-branch.yml`

## Acceptance Criteria
- Restore a minimal CI pipeline that:
  - Builds the React app
  - Runs Playwright tests against a preview environment (optional)
- Add a manual dispatch workflow for:
  - Functions deploy to `bob20250810`
  - Hosting deploy (preview + live)
- Use repo secrets `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID`.

## Notes
- Current manual deploy flow is documented in the PR and in firebase.json.
- Tests live under `e2e/`; emulator-based headless runs preferred.


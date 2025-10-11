# AGENTS.md — Agent Guide for BOB Repo

Scope: This guide applies to the entire repository. It provides high‑signal pointers for building, testing, deploying, and finding specs/issues so agents can act quickly and safely.

Quick Links
- App (prod): https://bob20250810.web.app
- GitHub: https://github.com/zulumonkeymetallic/bob
- Issues: https://github.com/zulumonkeymetallic/bob/issues
- Requirements: gemini.md

Build & Run
- App build: `npm run build --prefix react-app`
- Local preview: `npm run preview:build` at repo root, or `serve -s react-app/build -l 4173`
- Functions deps: `npm ci --prefix functions`

Deploy
- Fast deploy script (prod): `./scripts/deploy.sh`
  - Builds CRA app, installs Functions deps, then runs `firebase deploy --only functions,hosting` against project `bob20250810`.
- Full deploy (rules + functions + hosting): `./scripts/deploy-full.sh`
- GitHub Actions (manual): `.github/workflows/deploy-prod.yml` (Run on branch `main`).

Secrets & Env
- Gemini: `GOOGLEAISTUDIOAPIKEY` (Functions secret), required for LLM features.
- Nylas: `NYLAS_API_KEY` (Functions secret) for email.
- Optional: `APP_BASE_URL` for callback links.
- Set via Firebase: `firebase functions:secrets:set <NAME>`.

Issue Tracking (all locations)
- GitHub Issues: `https://github.com/zulumonkeymetallic/bob/issues`
- Local markdown issues: `issues/` (numbered files, e.g., `issues/192-task-sprint-alignment.md`)
- Templates/seed: `.gh-issue-bodies/`, `.gh-issue-comments/`, `.gh-new-issues/`
- Serialized backlog snapshot: `issues.json`

Branches
- Main development: `main`
- Feature branches: `feat/<short-desc>`
- Fix branches: `fix/<short-desc>`
- Epic working branches: `epic/<issue>-<slug>` (e.g., `epic/336-planning-matrix-v2`)

Testing
- Unit/E2E via GitHub Actions (see `.github/workflows/ci.yml`).
- Local E2E (Playwright): build app then run `npx playwright test` (see CI for env vars).

Notes
- CRA build treats warnings as errors only when `CI=true`.
- Production deploy requires Firebase CLI auth or service account (already configured in CI). For local script deploy, ensure `firebase login` or `FIREBASE_SERVICE_ACCOUNT` is available.


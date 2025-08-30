# deployment.md — Automated Test → Backup → Version → Release Playbook

**Date:** 30 Aug 2025  
**Owner:** BA AI (executor: Coding/Agentic AI)  
**Goal:** Zero-regression deployments guarded by full E2E tests, with backups, versioning, changelog and in‑app status updates.

---

## Pipeline Overview (Gated)
1. **Prepare**
   - Checkout main branch, clean workspace.
   - Install deps; run lint/typecheck/unit tests.

2. **Seed Test Data & Auth Strategy**
   - Use **test environment** with simplified auth **or** a **test-mode login** (bypass OAuth for E2E only).
   - Seed dummy Goals/Stories/Tasks/Sprints via script.

3. **E2E Tests (Selenium/Playwright)**
   - Run suites from `tests.md` (TST-xxxx).
   - **Gate:** if any fail → abort pipeline.

4. **Backup & Versioning**
   - Create a timestamped backup branch: `backup/{datetime}`.
   - Bump version (`x.y.z`) based on commit types (feat/fix/docs…).
   - Generate/update `CHANGELOG.md` (Conventional Commits).

5. **Commit & Tag**
   - `git add -A && git commit -m "chore(release): vX.Y.Z"`
   - `git tag vX.Y.Z`

6. **Push & Release**
   - Push branch + tags to origin.
   - Create release notes (from changelog) and attach artifacts (screenshots, reports).

7. **In‑App Status Update**
   - Update the **Development Dashboard** in app: counts of open/closed **DEF/ENH**, latest release, test pass rate.

---

## Example: GitHub Actions Workflow (`.github/workflows/ci.yml`)

```yaml
name: CI-CD
on:
  push:
    branches: [ main ]
  workflow_dispatch: {}

jobs:
  build-test-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install
        run: npm ci
      - name: Lint & Typecheck
        run: npm run lint && npm run typecheck
      - name: Unit tests
        run: npm test -- --ci --reporters=default
      - name: Seed test data
        run: node scripts/seed-test-data.mjs
      - name: E2E (Playwright)
        run: npx playwright install --with-deps && npx playwright test
      - name: Gate on failures
        if: ${{ failure() }}
        run: |
          echo "E2E failed — aborting release"
          exit 1
      - name: Backup branch
        run: |
          BR=backup/$(date +%Y%m%d-%H%M%S)
          git checkout -b $BR
          git push origin $BR
          git checkout main
      - name: Version bump & changelog
        run: |
          npm version patch -m "chore(release): %s"
          npx conventional-changelog -p angular -i CHANGELOG.md -s || true
          git add CHANGELOG.md package.json package-lock.json
          git commit -m "docs(changelog): update"
      - name: Tag & Push
        run: |
          VER=$(node -p "require('./package.json').version")
          git tag v$VER
          git push origin main --tags
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: e2e-artifacts
          path: |
            playwright-report
            coverage
            CHANGELOG.md
```

> Swap Selenium if you prefer; the test gate remains identical.

---

## Local Script (for Agentic AI)

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "1) Clean & install"
git checkout main && git pull
npm ci

echo "2) Lint/typecheck/unit"
npm run lint
npm run typecheck
npm test -- --ci

echo "3) Seed test data"
node scripts/seed-test-data.mjs

echo "4) Run E2E (Playwright)"
npx playwright install --with-deps
npx playwright test

echo "5) Backup branch"
BR="backup/$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BR"
git push origin "$BR"
git checkout main

echo "6) Version & changelog"
npm version patch -m "chore(release): %s"
npx conventional-changelog -p angular -i CHANGELOG.md -s || true
git add CHANGELOG.md package.json package-lock.json
git commit -m "docs(changelog): update"

echo "7) Tag & push"
VER=$(node -p "require('./package.json').version")
git tag "v$VER"
git push origin main --tags

echo "8) Done — deploy/release handled by platform"
```

---

## Requirements Traceability
- **REQ-0017** CI/CD gate on E2E tests with backup + version + changelog.
- **REQ-0018** In‑app Development Dashboard reflects releases, test pass rate, open/closed DEF/ENH.

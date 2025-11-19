BOB App — Agents Guide

Purpose
- Make it fast for agents and testers to validate Firestore access, sprint loading, and performance locally and in prod.

Environments
- Project: bob20250810
- Frontend: React (CRA) in `react-app/`
- Firestore: rules enforce owner-only (`ownerUid == request.auth.uid`); persona is a filter only

Secrets
- Service account JSON should NOT be in the repo. Place it on disk and reference it by path.
- Example (local Mac): `~/.secrets/bob/bob20250810-service-account.json`

Key Commands
- Deploy rules: `npm run deploy:rules`
- Deploy indexes: `npm run deploy:indexes`
- Fast dev (force long polling): `npm run react:dev:fast`
- Dev with sprint guardrail logs: `npm run react:dev:guardrail`
- E2E validator (uses Playwright + custom token):
  - `npm run -s validate:sprints`

Validator Details
- Location: `scripts/validate-sprints-perf.js`
- What it does:
  - Mints a custom token for a target UID using a service account
  - Starts the dev server with `REACT_APP_FIRESTORE_FORCE_LONG_POLLING=true`
  - Signs in headlessly via `window.BOB_SIGNIN_WITH_CUSTOM_TOKEN(token)`
  - Sets persona to `personal`
  - Navigates to `/sprints/table`, captures `sprints_attach` timing and console errors
- Required flags:
  - `--serviceAccount=/absolute/path/to/sa.json`
  - `--uid=<firebase-auth-uid>`
  - `--project=bob20250810`
- Example: the npm script `validate:sprints` is pre-wired for UID `3L3nnXSuTPfr08c8DTXG5zYX37A2` and your service account path

Dev Flags
- `REACT_APP_FIRESTORE_FORCE_LONG_POLLING=true`: skips WebChannel probing; faster attach
- `REACT_APP_SPRINT_DEV_GUARDRAIL=true`: logs if persona-scoped sprint query returns 0 but owner-only probe finds orphaned sprints

Task Points
- Every task document now requires `points` (1–8) and maps 1 point = 1 hour. Functions auto-derive points from `estimateMin`/`effort`, and Firestore triggers clamp outliers.
- Nightly maintenance runs an LLM sizing pass to fill in missing estimates on both tasks and stories; use `npm run backfill:task-points -- --dryRun` for one-off corrections, then rerun without `--dryRun` once output looks correct.
- Tasks sized above four hours (≥ 4 points) are auto-converted into stories via the LLM pipeline immediately (trigger) and again during nightly maintenance.
- Calendar AI now runs nightly to create sprint-aligned focus blocks that include deep links plus enriched descriptions.

Relevant Code Anchors
- Sprint query and perf log: `react-app/src/contexts/SprintContext.tsx:185`
- Firestore init (long polling flag + custom-token helper): `react-app/src/firebase.ts:25`, `react-app/src/firebase.ts:66`
- Playwright validator: `scripts/validate-sprints-perf.js:1`
- Dev scripts: `package.json: scripts.react:dev:fast`, `scripts.react:dev:guardrail`, `scripts.validate:sprints`

Data Backfills
- Owner UID filler: `scripts/backfill-ownerUid.js`
  - Run: `FIREBASE_PROJECT=bob20250810 node scripts/backfill-ownerUid.js --assign <UID>`
- Sprint persona filler: `scripts/backfill-sprint-persona.js`
  - Run (dry): `npm run backfill:sprint-persona -- --uid <UID> --persona personal --project bob20250810 --dry-run`
  - Run (apply): `npm run backfill:sprint-persona -- --uid <UID> --persona personal --project bob20250810`

Hosting Deploy (prod)
- Build: `npm run -s build --prefix react-app`
- Deploy: `firebase deploy --only hosting --project bob20250810`
- Hosting config: `firebase.json`

Troubleshooting
- Permission denied for sprints:
  - Ensure each sprint doc has `ownerUid` == `request.auth.uid` and a persona matching your app persona
  - Confirm rules/indexes deployed (see commands above)
- Slow `sprints_attach` in dev:
  - Use `REACT_APP_FIRESTORE_FORCE_LONG_POLLING=true` to bypass probing
  - Check for transient SDK logs during first connection; steady-state attaches should be < 1000ms
- Custom token minting fails:
  - Ensure the service account JSON path is valid and has token creator rights

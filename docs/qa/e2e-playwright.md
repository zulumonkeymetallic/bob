E2E — Playwright Regression Suite

- Install deps: `npm ci && npm ci --prefix react-app`
- Build (optional for local): `npm run build --prefix react-app`
- Run tests (dev server auto): `npm run test:e2e`
- Headed mode: `npm run test:e2e:headed`
- CI mode: `npm run test:e2e:ci`

Env vars

- `APP_BASE_URL`: base URL. Default `http://localhost:4173`
- `TEST_USER_EMAIL`: test user email (default agenticaitestuser@jc1.tech)
- `TEST_USER_PASSWORD`: password (default SecureAgenticAI2025!)
- `PW_USE_BUILD=1`: serve from `react-app/build` via `npx serve` (CI)
- `FIREBASE_SERVICE_ACCOUNT`: JSON for cleanup script (admin SDK)
- `TEST_USER_UID`: UID of test user (default `agentic-ai-test-user`)

Covers

- CRUD: Goals, Stories, Tasks, Sprints
- Kanban: drag-and-drop story between lanes
- Theming: auto/light/dark with WCAG AA color-contrast via axe
- Guardrails: no “[object Object]” text renders
- Artifacts: traces, videos, screenshots on failure

Additional notes

- CI pre/post cleans Firestore for the test user via `scripts/cleanup-e2e-data.js` to keep datasets tidy. This uses `firebase-admin` with `FIREBASE_SERVICE_ACCOUNT`.
- To run cleanup locally: `FIREBASE_SERVICE_ACCOUNT='$(cat firebase-service-account.json)' TEST_USER_UID='agentic-ai-test-user' node scripts/cleanup-e2e-data.js`.

# Repo Map

Last updated: 2026-04-22

This document explains the live structure of the Bob workspace and which parts are canonical versus archival.

## Primary Code Surfaces

| Path | Role | Notes |
| --- | --- | --- |
| `run_agent.py` | Hermes runtime entrypoint | Defines `AIAgent` and the core sync conversation loop. |
| `model_tools.py` | Hermes tool orchestration | Discovers tools from `tools/registry.py`, resolves schemas, dispatches handlers. |
| `toolsets.py` | Hermes toolset aliases/composition | Central place for named tool bundles. |
| `cli.py` | Hermes interactive TUI | Large REPL/TUI implementation used by `hermes chat`. |
| `hermes_state.py` | Session persistence | SQLite + FTS5 session/message store. |
| `agent/` | Hermes runtime internals | Prompt building, compression, adapters, display, metadata, memory helpers. |
| `tools/` | Hermes tool implementations | Self-registering tool modules; includes terminal, file, browser, MCP, delegation, etc. |
| `hermes_cli/` | Hermes subcommands and config UX | Setup, auth, model switch, skins, tools/skills config, doctor, profiles. |
| `gateway/` | Hermes messaging gateway | Platform adapters for Telegram, Slack, Discord, WhatsApp, Signal, etc. |
| `cron/` | Hermes cron scheduling | Stores jobs and scheduler logic for recurring Hermes tasks. |
| `functions/` | Bob Firebase Functions backend | Node 20, Firebase Functions Gen 2, `europe-west2`. |
| `react-app/` | Main Bob product frontend | CRA + React 18 + TypeScript + Firebase Web SDK. |
| `ios-app/` | Bob iOS code | Separate mobile-related code and assets. |
| `website/` | Hermes public docs site | Docusaurus documentation for Hermes Agent. |
| `web/` | Separate Vite web app | Newer React 19/Vite/Tailwind surface; not the main Bob app. |
| `scripts/` | Utilities and deployment helpers | Mixed JS/Python/shell scripts for backfills, deploys, validation, and support tasks. |

## Entry Points

### Hermes

- CLI binary: `pyproject.toml` -> `hermes = "hermes_cli.main:main"`
- Agent runtime: `run_agent.py`
- Interactive TUI: `cli.py`
- Gateway runner: `gateway/run.py`
- ACP/editor integration: `acp_adapter/`

### Bob

- Frontend app bootstrap: `react-app/src/index.tsx`
- Frontend route map: `react-app/src/App.tsx`
- Firebase client wiring: `react-app/src/firebase.ts`
- Backend deployment entrypoint: `functions/index.js`

## Build And Test Paths

### Python / Hermes

Always activate the virtualenv first:

```bash
source venv/bin/activate
python -m pytest tests/ -q
```

Useful focused runs:

```bash
python -m pytest tests/tools/ -q
python -m pytest tests/gateway/ -q
python -m pytest tests/hermes_cli/ -q
```

### Bob Frontend

```bash
npm run build --prefix react-app
npm test --prefix react-app -- --watchAll=false
```

### Bob Functions

```bash
cd functions
npm install
```

Deploy behavior is centered around Firebase and repo scripts such as `scripts/deploy.sh`, `scripts/deploy-with-version.sh`, `scripts/quick-deploy.sh`, and related validation helpers.

## Live Versus Archival Areas

### Canonical Runtime Areas

- `run_agent.py`
- `model_tools.py`
- `toolsets.py`
- `cli.py`
- `agent/`
- `tools/`
- `hermes_cli/`
- `gateway/`
- `cron/`
- `functions/`
- `react-app/src/`

### Usually Archival / Situational

- Most root `*.md` files
- `deployment-logs/`
- `test-results/`
- `archive/`
- `issues/`
- `build-logs/`
- `Business Analyst AI/`

These are often useful for history or decision context, but they are not current architecture truth unless confirmed in code.

## High-Signal Files To Open First

### Hermes Runtime

- `run_agent.py`
- `model_tools.py`
- `toolsets.py`
- `cli.py`
- `hermes_state.py`
- `tools/registry.py`
- `gateway/run.py`
- `hermes_cli/main.py`

### Bob Frontend

- `react-app/src/index.tsx`
- `react-app/src/App.tsx`
- `react-app/src/firebase.ts`
- `react-app/src/types.ts`
- `react-app/src/contexts/*`
- `react-app/src/services/agentClient.ts`

### Bob Backend

- `functions/index.js`
- `functions/nightlyOrchestration.js`
- `functions/calendarSync.js`
- `functions/transcriptIngestion.js`
- `functions/finance/enhancements.js`
- `functions/coach/index.js`

## Known Caveats

- `functions/index.js` mixes Firebase v1 and v2 APIs.
- Some Firebase export names are duplicated or reassigned later in `functions/index.js`; the last assignment wins.
- `react-app/src/` contains many backup files that look real at a glance.
- `website/` documents Hermes publicly, but it does not document the full Bob workspace.

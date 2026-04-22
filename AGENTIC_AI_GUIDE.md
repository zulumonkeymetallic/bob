# Agentic AI Guide

Last updated: 2026-04-22

This file now serves as the short pointer to the canonical AI documentation set.

The previous version of this guide had drifted from the codebase and treated the repo like a smaller Bob-only app. That is no longer accurate.

## Start Here

- `AGENTS.md`
- `docs/ai/README.md`
- `docs/ai/repo-map.md`
- `docs/ai/hermes-runtime.md`
- `docs/ai/bob-frontend.md`
- `docs/ai/firebase-functions.md`
- `docs/ai/work-tracking.md`

## What Changed

The current workspace is a mixed repo containing:

- Hermes Agent Python runtime and CLI
- Bob React frontend in `react-app/`
- Bob Firebase backend in `functions/`
- Hermes public docs in `website/`
- Additional web, iOS, and tooling surfaces

## Rules For Other Agents

- Treat source code as truth.
- Treat `docs/ai/*.md` as the maintained AI-facing map.
- Treat most root `*.md` files as historical unless code confirms them.
- Be careful in `react-app/src/`: backup and stray non-code files are mixed into the tree.
- Be careful in `functions/index.js`: some exports are reassigned later in the file.

## Minimal Working Orientation

- In-repo runtime/orchestration code: `run_agent.py`, `model_tools.py`, `cli.py`, `toolsets.py`, `agent/`, `tools/`, `gateway/`, `hermes_cli/`
- Bob frontend: `react-app/src/index.tsx`, `react-app/src/App.tsx`, `react-app/src/firebase.ts`
- Bob backend: `functions/index.js` and the modules it re-exports

Treat `docs/ai/*.md` as the maintained AI map and treat older deployment/handoff markdown as historical unless code confirms it.

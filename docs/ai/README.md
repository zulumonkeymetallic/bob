# AI Docs Index

Last updated: 2026-04-22

This is the canonical AI-facing documentation set for the `/Users/jim/git/bob` workspace.

If you are an external agent working in this repo, start here before trusting older Markdown in the repo root.

## What This Repo Actually Is

This workspace is not a single-purpose Bob app and it should not be treated as a clean Hermes checkout either.

It is a mixed codebase containing:

- Agent/runtime infrastructure in Python
- The Bob product frontend in `react-app/`
- Bob Firebase backend logic in `functions/`
- Additional web/docs surfaces in `web/` and `website/`
- iOS-related code in `ios-app/`
- Large amounts of historical handoff, deployment, and status Markdown

## Source Of Truth Order

When docs disagree, use this order:

1. Source code
2. `docs/ai/*.md`
3. `website/docs/*` for public Hermes behavior and user-facing runtime docs
4. Everything else in the repo as historical or situational context

## Master Index

This file is the master index for AI agents working in this repo.

## Start Here

- [Repo Map](./repo-map.md): directory-by-directory orientation, entrypoints, build/test paths, and what is archival noise.
- [Hermes Runtime](./hermes-runtime.md): the in-repo Python runtime/orchestration code that external agents may need to inspect.
- [Bob Frontend](./bob-frontend.md): React app boot flow, route families, shared state, and frontend caveats.
- [Firebase Functions](./firebase-functions.md): grouped reference for the deployed Bob backend functions and supporting modules.
- [Work Tracking](./work-tracking.md): GitHub-vs-Bob tracking policy, migrated Bob Improvement stories, and current gap snapshot.

## Fast Navigation

If you need to:

- Understand the in-repo agent/runtime code: open `run_agent.py`, `model_tools.py`, `cli.py`, `toolsets.py`, and [Hermes Runtime](./hermes-runtime.md).
- Change Bob product behavior: open `react-app/src/App.tsx`, `react-app/src/firebase.ts`, relevant `react-app/src/components/*`, and [Bob Frontend](./bob-frontend.md).
- Change server-side Bob logic: open `functions/index.js`, related `functions/*.js` modules, and [Firebase Functions](./firebase-functions.md).
- Understand what is still tracked where: open [Work Tracking](./work-tracking.md).

## Find Functions Fast

If you are looking for backend functions specifically:

- Start with [Firebase Functions](./firebase-functions.md).
- For the full deployment entrypoint, open `functions/index.js`.
- For calendar sync, open `functions/calendarSync.js`.
- For nightly planning/orchestration, open `functions/nightlyOrchestration.js`.
- For task/story enrichment and conversions, inspect `functions/index.js` and `functions/aiPlanning.js`.
- For sprint and calendar capacity calculations, open `functions/capacityPlanning.js`.
- Understand public Hermes docs: open `website/docs/`.
- Understand the newer Vite/Tailwind web surface: inspect `web/`.

## Important Repo Realities

- `functions/index.js` is a very large aggregator and still the primary deployment entrypoint for Bob backend behavior.
- `react-app/src/` contains real production code mixed with backups and stray artifacts such as `.bak`, `.backup`, `.new`, `.broken`, `.md`, and `.ini` files. Do not assume every file in that tree is live.
- The top-level `README.md` is still primarily a public Hermes README. Treat it as product-facing context, not the full workspace map.
- Many root Markdown files are release notes, audits, deployment logs, or historical handoffs. They are useful for archaeology, not for current architecture truth.

## Recommended First Reads For AI Agents

1. `AGENTS.md`
2. This file
3. [Repo Map](./repo-map.md)
4. The domain-specific doc for the area you are changing

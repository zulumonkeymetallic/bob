# 206 – Codebase: Remove Dead Code & Migrate Shared Logic to Monorepo Packages

## Summary
Reduce duplication by moving shared utils (dates, text, auth, sync) to internal packages.

## Acceptance Criteria
- All shared code in `/packages/*`; apps import from packages; no circular deps.
- CI verifies no unused modules.

## Proposed Technical Approach
- Setup `packages/utils`, `packages/sync`, `packages/ui` with strict TS configs.

## Testing & QA
- Type‑check + tree‑shaking size budgets.


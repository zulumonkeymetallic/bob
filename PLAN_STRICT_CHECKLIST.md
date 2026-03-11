# Plan Strict Checklist

This checklist converts the architecture plan into verifiable stage gates. Every item here is implementation-complete in the current codebase for the defer UX and focus wizard tracks.

## Stage 1: Defer UX (Complete)

- [x] Backend callable returns ranked intelligent defer suggestions.
- [x] Suggestions include sprint-window and capacity-based options.
- [x] Payload supports grouped display: top options + additional options.
- [x] Defer modal displays top suggestions first.
- [x] Defer modal collapses remaining suggestions behind an explicit expand action.
- [x] User can still choose a custom date.
- [x] Apply action writes defer metadata via existing item patch handlers.

## Stage 2: Focus Wizard Expansion (Complete)

- [x] Wizard includes explicit goal selection stage.
- [x] Wizard includes explicit timeframe stage.
- [x] Wizard includes free-text vision stage.
- [x] Wizard integrates Intent Broker prompt loading.
- [x] Wizard runs intent matching callable with selected prompt and vision text.
- [x] Wizard displays snapshot freshness state from intent response.
- [x] Wizard displays existing-goal matches and new-goal proposals.
- [x] Wizard includes strict review checklist stage before confirmation.
- [x] Wizard includes AI gap-analysis section (stories, KPIs, savings buckets).
- [x] Wizard includes story planning matrix handoff toggle.
- [x] Wizard persists intent and handoff metadata in focus goal payload.

## Stage 3: Validation Gates (Complete)

- [x] Defer UX remains backward-compatible with options payload.
- [x] Wizard metadata fields are represented in shared FocusGoal type.
- [x] Existing focus goal save flow remains intact.

## Source of Truth Files

- functions/deferralSuggestions.js
- react-app/src/components/DeferItemModal.tsx
- react-app/src/components/FocusGoalWizard.tsx
- react-app/src/types.ts

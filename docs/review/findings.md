BOB Codebase Review — Findings (initial)

- Theme System: Two providers coexist (`contexts/ThemeContext` and `contexts/ModernThemeContext`) which can lead to mismatches and style leakage. Only one source of truth should set tokens and classes. Current approach applies classes to `body` and `documentElement`; recommend a single `data-theme` or `class` on `html` before hydration, with all components reading the same contract.
- Contrast: Several components set inline colors while mixing Bootstrap variants. Use variables derived from theme tokens to ensure minimum AA contrast. Tests added to catch regressions.
- Firestore Timestamps: Many subscribers convert timestamps to `Date` to avoid React error #31, which is good; ensure all list/detail views do so consistently. Verified across Goals/Stories/Tasks/Sprints.
- Testability: Limited `data-testid` attributes. Key areas now covered via role/label, but adding lightweight `data-testid` on table rows/actions would harden E2E.
- CRUD Surfaces: Goals via AddGoalModal; Stories via AddStoryModal; Tasks via Quick Actions and Tasks Management; Sprints via ModernSprintsTable (full CRUD). Legacy/placeholder sprint modal in `SprintManagementView` is not used.
- Kanban: DnD via dnd-kit on EnhancedKanban; droppable areas use deterministic ids (e.g., `#active-stories`) leveraged in tests.

Recommended next steps

- Unify theme provider (see docs/design/theme.md) and add hydration guard script in `public/index.html`.
- Add small, consistent `data-testid` on key actions (row-level Edit/Delete, headers) to de-flake selectors.
- Add CI lint/typecheck once repo is stable (CRA is used under `react-app/`).
- Consider seeding an isolated Firestore namespace for CI test artifacts or auto-cleanup by ownerUid/tag.


## Summary
- **Problem**: Tasks list crashes with Firestore 12.1.0 `Unexpected state (ID: ca9)` assertion when live updates stream in.
- **Scope**: `react-app/src/components/TasksList-Enhanced.tsx` listener lifecycle & derived context mapping.
- **Impact**: Entire productivity UI becomes unusable for affected users; regression introduced after Firebase SDK bump.

## Steps to Reproduce
1. Sign in to the web app and open *Tasks (Enhanced)*.
2. Ensure multiple tasks, stories, and sprints exist for the active persona.
3. Wait for background automation (scheduler or reminders sync) to touch tasks, or manually edit a task in another tab.
4. Observe console: Firestore throws `INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)` and the UI stops updating.

## Expected Behaviour
- Firestore listeners stay mounted across downstream updates; task list re-renders cleanly without crashes.

## Actual Behaviour
- Recomputing context triggers cascading `onSnapshot` re-subscriptions.
- Firestore receives overlapping target removals/additions and aborts with assertion `ID: ca9` (and related `ID: b815`).

## Technical Notes
- The current effect depends on `stories`, `goals`, and `sprints`, so every snapshot update tears down and recreates the task listener.
- Firebase SDK 12.1.0 tightened invariants around target shutdown, exposing the bug.
- Fix applied: isolate the Firestore subscription (dependent only on `currentUser`/`currentPersona`) and derive task context in a separate effect.

## Acceptance Criteria
- [ ] No Firestore assertion when streaming updates (manual QA + console monitoring).
- [ ] React profiler shows a single active listener for `tasks` despite downstream state changes.
- [ ] Automated smoke test (or manual checklist) confirms task CRUD still updates reference numbers, sprint linkage, and theme propagation.

## Rollout / Verification
- Target release: next patch to production.
- Manual verification: run `npm run react:dev` with Firebase emulator or staging project, edit tasks and watch console.

# Last 24 Hours — Change Summary

**Scope note**
This summary reflects changes made in the current working tree and deployments executed in the last 24 hours. It focuses on the work delivered for the requests in this thread.

**Summary**
In the last 24 hours I added a new Goals-by-Year planner view, extended goal editing with a duration-based date helper, expanded goal metrics to include savings totals, tightened tag normalization across web, functions, and mac sync (including sprint tag format change to `sprint42`), and improved Kanban visibility (Mac sync timestamp and sprint-scoped task metrics). I also wired navigation for the new planner and deployed hosting + functions.

**Changes (What + Why)**
1. **Goals by Year planner page (new UI)**
   Added a Kanban-style planner for goals where each column is a year and goals are cards.
   Files: `react-app/src/components/GoalsYearPlanner.tsx`, `react-app/src/App.tsx`, `react-app/src/components/SidebarLayout.tsx`
   Why: You requested a sprint/kanban-style view for goals by year with drag-and-drop, filters, and savings/progress metrics.
   Behavior: Dragging a goal between columns updates `targetYear`. If existing start/end dates fall outside the target year, a date-adjust modal prompts for updates.

2. **Goal edit duration helper**
   Added a small duration (days) field that auto-updates the end date when start date changes.
   File: `react-app/src/components/EditGoalModal.tsx`
   Why: You asked for a duration helper in the goal edit modal and to reuse it in the year-move modal.
   Behavior: Editing start date or duration updates end date. Duration is computed from start/end when both are set.

3. **Goal list metrics: total estimated cost + total saved**
   Added metrics to Goals Management for total estimated cost (filtered goals) and total saved from linked Monzo pots.
   File: `react-app/src/components/GoalsManagement.tsx`
   Why: You requested cost/savings totals to accompany the existing goal metrics.
   Behavior: Sums `estimatedCost` for filtered goals; sums linked pot balances with de-duplication per pot.

4. **Goal list filter: goals without linked pots**
   Added a toggle to show only goals with no linked pot.
   File: `react-app/src/components/GoalsManagement.tsx`
   Why: You wanted a quick filter to identify goals missing pot links.

5. **Tag normalization across web + functions + mac sync**
   Centralized and enforced tag normalization for task types/persona/sprint/theme and removed parent goal/story tags.
   Files: `react-app/src/utils/taskTagging.ts`, `react-app/src/utils/tagDisplay.ts`, `functions/index.js`, `/Users/jim/GitHub/bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift`
   Why: You asked for consistent tags across app + mac sync, with parent goal/story removed and top3 retained.
   Behavior:
   - Tags stored as plain strings (no `#` prefix). UI shows `#` when rendering.
   - Normalization adds type/persona/sprint/theme, removes parent goal/story tags.
   - Sprint tag format changed to `sprint42` (no hyphen) everywhere.

6. **Mac sync tag behavior and metadata rebuild**
   Updated mac sync to build sprint tags as `sprint42` and strip parent goal/story tags during tag composition.
   File: `/Users/jim/GitHub/bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift`
   Why: You required consistent sprint tag format and removal of parent tags for tasks in Reminders.

7. **Kanban: show last Mac sync and sprint-scoped task metrics**
   Added “Mac sync” timestamp to task cards and made sprint task completion metrics count only tasks due within the sprint date range.
   Files: `react-app/src/components/KanbanCardV2.tsx`, `react-app/src/components/SprintKanbanPageV2.tsx`
   Why: You wanted Mac sync visibility on task cards and more accurate sprint completion counts.

8. **Sidebar navigation updates**
   Added “Goal Planner” under the Goals section, wired to `/goals/year-planner`.
   File: `react-app/src/components/SidebarLayout.tsx`
   Why: You asked for a sidebar entry pointing to the new planner.

9. **Theme fix in sidebar**
   Restored `themeHex` usage in the sidebar to fix a build error.
   File: `react-app/src/components/GlobalSidebar.tsx`
   Why: Build failed due to missing `themeHex` after recent refactors.

**Deployments Executed**
- **Hosting**: deployed to `bob20250810` on **2026-02-10**.
- **Functions**: deployed to `bob20250810` on **2026-02-10**. There were temporary 429 (quota) retries, but deployment completed.

**Build/Deploy Notes**
- CRA build completed with warnings (Browserslist data out of date; rrule source-map warnings). These do not block deployment.
- Cloud Functions emitted a warning about Node.js 20 deprecation (April 30, 2026), and a cleanup warning for build images.

If you want a more granular, per-file diff log in this document, tell me and I’ll expand it with before/after details.

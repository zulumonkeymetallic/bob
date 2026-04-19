Title: Auto-assign Orchestrated Work to Active Sprint

Description
- When orchestration creates stories/tasks, automatically place them into the currently active sprint (if any) based on theme/goal and capacity.
- Respect sprint WIP limits and allow overflow to backlog with a “Next Sprint” suggestion.

Acceptance Criteria
- [ ] Detect active sprint for persona; if capacity remains, assign new AI-created stories/tasks.
- [ ] Overflow handling: tag with `sprintCandidate: next` and surface in Sprint Planning.
- [ ] Activity log entry records sprint assignment.
- [ ] Setting in profile: `autoAssignAiWorkToSprint` with default off.
- [ ] UI Badge on newly created items indicating sprint assignment source: `entry_method: 'ai_orchestration'`.

Technical Plan
- Functions: after `orchestrateGoalPlanning`, call `assignToActiveSprint(uid, storyIds, taskIds)` that checks sprint capacity and assigns accordingly.
- Data: update `stories.sprintId` / `tasks.sprintId`; maintain order index.
- Planner: include these in the next nightly plan and display on Kanban.

Links
- Relates to: #305 (Orchestration), #309 (AI Goal Chat)


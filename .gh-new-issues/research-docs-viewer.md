Title: Goal Research Docs Viewer + Re-run AI Research

Description
- Add in-app viewer for `research_docs` linked from the Goal sidebar; allow re-run of deep research with updated context.
- Show brief metadata (questions, outline) and email status.

Acceptance Criteria
- [ ] `Research` tab/section in Global Sidebar for goals with a research doc.
- [ ] Button to "Re-run Research" that calls `orchestrateGoalPlanning` in research-only mode.
- [ ] Link to email send status and open doc in a modal/markdown viewer.

Technical Plan
- Client: research viewer component; fetch from `research_docs` by goalId.
- Functions: add `orchestrateGoalPlanning` option `{ researchOnly: true }` to skip story/task creation when desired.


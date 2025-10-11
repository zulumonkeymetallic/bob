Title: AI Story Orchestration: Sub-Goal Research → Tasks → Schedule

Description
- Provide the same orchestration flow at the story level: optional lightweight research, auto-create tasks, and schedule time blocks focused on the story.

Acceptance Criteria
- [ ] Story menu: “AI Orchestrate (Story)” that generates tasks under the story and schedules focused blocks.
- [ ] Optional research brief created under `research_docs` with `storyId`.
- [ ] Respects planner prefs and theme; attaches deep links to blocks.

Technical Plan
- Functions: `orchestrateStoryPlanning` mirroring goal variant with a reduced prompt and direct task creation.
- Client: add menu item in Story management pages and Global Sidebar for stories.

Links
- Relates to: #305, #309


**Description**
Allow BOB themes (e.g., Growth, Health, Tribe, Home) to automatically generate and manage calendar blocks aligned with related tasks and goals.

**Acceptance Criteria**
- [ ] User can assign a theme to a goal/story.
- [ ] Calendar blocks are auto-generated based on active sprint tasks linked to themes.
- [ ] AI scheduling engine respects work hours and blocked time.
- [ ] Each block contains a link back to the BOB item.

**Proposed Technical Implementation**
- Extend Firestore schema with `themeId` field for goals/stories.
- Build a Firebase Function to generate Google Calendar events dynamically.
- Use n8n (or Calendar API) to push/pull changes for two-way sync.
- Add React Kanban view with drag-and-drop for theme-based scheduling.

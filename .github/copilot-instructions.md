# Copilot Instructions for BOB Codebase

## Big Picture Architecture
- **Frontend:** React app in `react-app/` (Create React App). Key UI features: Gantt charts, Kanban boards, goal/OKR management, activity streams.
- **Backend:** Firebase Functions (not in this repo), Firestore as main data store. External integrations (Calendar, Reminders, Finance, Health) orchestrated via n8n workflows (see `docs/integrations/n8n/`).
- **Integration Pattern:** Deterministic business logic and scheduling in Firebase Functions; external API I/O in n8n. Firestore documents act as contracts between services.

## Developer Workflows
- **Run frontend:**
  ```sh
  cd react-app
  npm start
  ```
  App runs at http://localhost:3000.
- **Build frontend:**
  ```sh
  npm run build
  ```
- **Test frontend:**
  ```sh
  npm test
  ```
- **n8n workflows:**
  - Use JSON files in `docs/integrations/n8n/workflows/` as templates.
  - Update credentials and node params before deploying.

## Project-Specific Conventions
- **Firestore contracts:** Use composite keys (e.g., `storyId+start`) and `status` fields for idempotency.
- **UI patterns:**
  - Gantt chart components: see `react-app/src/components/visualization/EnhancedGanttChart*`, `RoadmapV2*`, `RoadmapGoalCard*`.
  - Kanban/goal cards: color-coded by area (growth/tribe/wealth/health/home).
  - Drag-and-drop: via `@dnd-kit/core`.
- **Bulk import:** Supports `.xlsx`, `.csv`, `.json` for goals, okrs, tasks, resources, trips.
- **AI helpers:** Functions like `classifyGoal`, `prioritizeBacklog`, `rankResources` use OpenAI (requires secret).

## Integration Points
- **n8n ↔ Firebase Functions:**
  - Scheduling/compute in Functions; API I/O in n8n.
  - Firestore documents as intent/status/result contracts.
  - OAuth/token handling and signature verification in Functions.
  - n8n calls secured HTTPS endpoints to write to Firestore.

## Key Files/Directories
- `react-app/src/components/visualization/`: Gantt chart, roadmap, goal card components.
- `docs/integrations/n8n/README.md`: n8n integration patterns and workflow contracts.
- `Developer AI/README.md`: Kanban, bulk import, AI helper details.

---
**For new features:**
- Follow existing UI/component patterns for Gantt/Kanban.
- Use Firestore contract conventions for new integrations.
- Reference n8n workflow templates for external API orchestration.

---
*Update this file if major architectural or workflow changes occur.*

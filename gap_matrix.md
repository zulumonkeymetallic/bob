| Requirement | Implementation Status | File Paths | Code Snippets | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **Mac Agent Integration (Code)** | **MISSING** | N/A | N/A | **CRITICAL** |
| **Mac Agent Integration (Live)** | **VERIFIED** | Firestore `tasks` | `source: "MacApp"` | **OK** |
| **Routine/Chore Generation** | **INCOMPLETE** | `functions/aiPlanning.js` | `async function generateRoutineTasks(db, userId) { ... }` (Empty) | **CRITICAL** |
| **Sub-Goal Data Model** | **NOT IMPLEMENTED** | `react-app/src/components/SprintPlannerMatrix.tsx` | `// TODO: Load sub-goals...` | **CRITICAL** |
| **Deep Link Matching** | **NOT IMPLEMENTED** | N/A | N/A | **HIGH** |
| **Prompt: Drag-and-Drop Reasoning** | **NOT IMPLEMENTED** | N/A | N/A | **HIGH** |
| **Google Calendar Sync** | **VERIFIED** | `functions/index.js` | `status: "synced"`, `_gcal_` IDs | **OK** |
| **7-Day Rolling Calendar** | **VERIFIED** | `functions/aiPlanning.js` | Live blocks present for next 7 days | **OK** |
| **Task Due Today Enforcement** | **IMPLEMENTED** | `functions/aiPlanning.js` | `enforceTaskDueToday` | **LOW** |

# Codebase Fix List

1.  **Implement Mac Agent**: Create a new repository or directory for the Mac Agent (Swift/Objective-C) and implement the two-way sync logic.
2.  **Implement Routine Generation**: Flesh out the `generateRoutineTasks` function in `functions/aiPlanning.js` to actually generate tasks from routines.
3.  **Implement Sub-Goals**: Create the `sub_goals` collection in Firestore and update `SprintPlannerMatrix.tsx` to load and display them.
4.  **Add Deep Link Logic**: Implement logic to generate and handle deep links for the Mac Agent.
5.  **Create Prompt Templates**: Create a centralized prompt management system and implement the missing prompts (drag-and-drop, calendar placement).

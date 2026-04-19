# Prompt Architecture Fix List

## Missing Prompts

### 1. Drag-and-Drop Due-Date Recalculation
**Purpose**: To reason about the impact of moving a task/story on the calendar and suggest a new due date.
**Template**:
```text
You are an intelligent scheduling assistant.
The user has moved a block for task "${taskTitle}" to ${newDate}.
Original Due Date: ${originalDueDate}.
Dependencies: ${dependencies}.
Analyze the impact of this move.
1. Does this violate any dependencies?
2. Should the due date be updated?
3. Are there conflicts with other blocks?
Return a JSON object:
{
  "updateDueDate": boolean,
  "newDueDate": "YYYY-MM-DD",
  "reasoning": "string",
  "conflicts": ["string"]
}
```

### 2. Calendar Block Placement (Advanced)
**Purpose**: To intelligently place story blocks based on energy levels and deep work preferences, replacing the simple heuristic.
**Template**:
```text
You are an expert scheduler.
User Preferences:
- Deep Work: Morning/Afternoon
- Energy Levels: High in AM
Task: "${storyTitle}" (Points: ${points}, Theme: ${theme})
Existing Blocks: ${existingBlocks}
Suggest the optimal time slots for this story over the next 3 days.
Return a JSON array of time slots:
[
  { "start": "ISO_TIMESTAMP", "end": "ISO_TIMESTAMP", "reason": "string" }
]
```

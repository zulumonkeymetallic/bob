# BOB v3.6.2 - Enhanced Activity Stream Logging for AI & Calendar Operations

## Overview
The ActivityStreamService has been enhanced to provide comprehensive tracking of AI function calls and calendar operations, particularly for the scheduled time blocks feature in the Goals dropdown.

## New Activity Types

### AI Call Tracking
- `ai_call_initiated` - When an AI function is called
- `ai_call_completed` - When an AI function completes successfully  
- `ai_call_failed` - When an AI function fails

### Calendar Integration
- `calendar_scheduled` - When calendar scheduling is performed
- `calendar_block_created` - When individual calendar blocks are created
- `calendar_sync` - When calendar synchronization occurs

## Enhanced Fields

### AI Tracking Fields
```typescript
aiCallId?: string;           // Unique identifier for tracking AI call lifecycle
aiFunction?: string;         // Name of the AI function (e.g., 'planCalendar')
aiParameters?: string;       // JSON stringified input parameters
aiResults?: string;          // JSON stringified results
aiError?: string;            // Error message for failed calls
aiContext?: string;          // Additional context (e.g., "goal scheduling")
aiExecutionTime?: number;    // Execution time in milliseconds
```

### Calendar Integration Fields
```typescript
calendarStartTime?: string;  // ISO string
calendarEndTime?: string;    // ISO string
calendarTitle?: string;      // Calendar block title
calendarDescription?: string; // Calendar block description
isAiGenerated?: boolean;     // Whether calendar block was AI-generated
blocksCreated?: number;      // Number of calendar blocks created
timeRequested?: number;      // Minutes of time requested
schedulingType?: string;     // 'goal_focus' | 'general' | 'habit' | 'project'
dateRange?: string;          // Date range for scheduling
syncAction?: string;         // 'import' | 'export' | 'bidirectional'
itemsProcessed?: number;     // For sync operations
conflicts?: number;          // Number of conflicts during sync
syncSource?: string;         // Source of sync (e.g., "Google Calendar")
```

## New Methods

### AI Call Tracking
```typescript
// Start tracking an AI call
const callId = await ActivityStreamService.logAICallInitiated(
  entityId: string,
  entityType: ActivityEntry['entityType'],
  aiFunction: string,
  parameters: any,
  userId: string,
  userEmail?: string,
  context?: string
);

// Log successful completion
await ActivityStreamService.logAICallCompleted(
  callId: string,
  entityId: string,
  entityType: ActivityEntry['entityType'],
  aiFunction: string,
  results: any,
  userId: string,
  userEmail?: string,
  executionTimeMs?: number
);

// Log failure
await ActivityStreamService.logAICallFailed(
  callId: string,
  entityId: string,
  entityType: ActivityEntry['entityType'],
  aiFunction: string,
  error: any,
  userId: string,
  userEmail?: string,
  executionTimeMs?: number
);
```

### Calendar Operations
```typescript
// Log calendar block creation
await ActivityStreamService.logCalendarBlockCreated(
  entityId: string,
  entityType: ActivityEntry['entityType'],
  blockDetails: {
    startTime: string;
    endTime: string;
    title: string;
    description?: string;
    isAiGenerated?: boolean;
  },
  userId: string,
  userEmail?: string,
  aiCallId?: string
);

// Log bulk scheduling results
await ActivityStreamService.logCalendarSchedulingResult(
  entityId: string,
  entityType: ActivityEntry['entityType'],
  schedulingResult: {
    blocksCreated: number;
    timeRequested?: number;
    schedulingType: 'goal_focus' | 'general' | 'habit' | 'project';
    dateRange?: string;
  },
  userId: string,
  userEmail?: string,
  aiCallId?: string
);
```

## Implementation Example

In the Goals dropdown scheduled time blocks feature:

```typescript
const scheduleGoalTime = async (goal: Goal) => {
  let aiCallId: string | undefined;
  const startTime = Date.now();

  try {
    // 🤖 Log AI call initiation
    const parameters = {
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      persona: currentPersona || 'personal',
      focusGoalId: goal.id,
      goalTimeRequest: goal.timeToMasterHours ? Math.min(goal.timeToMasterHours * 60, 300) : 120
    };

    aiCallId = await ActivityStreamService.logAICallInitiated(
      goal.id,
      'goal',
      'planCalendar',
      parameters,
      currentUser.uid,
      currentUser.email || undefined,
      `Scheduling time blocks for goal: ${goal.title}`
    );

    // Make the AI call
    const planCalendar = httpsCallable(functions, 'planCalendar');
    const result = await planCalendar(parameters);
    const planResult = result.data as any;
    const executionTime = Date.now() - startTime;

    // 🤖 Log AI call completion
    await ActivityStreamService.logAICallCompleted(
      aiCallId,
      goal.id,
      'goal',
      'planCalendar',
      planResult,
      currentUser.uid,
      currentUser.email || undefined,
      executionTime
    );

    // 📅 Log calendar scheduling result
    await ActivityStreamService.logCalendarSchedulingResult(
      goal.id,
      'goal',
      {
        blocksCreated: planResult.blocksCreated,
        timeRequested: goal.timeToMasterHours ? Math.min(goal.timeToMasterHours * 60, 300) : 120,
        schedulingType: 'goal_focus',
        dateRange: `${new Date().toISOString().split('T')[0]} to ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}`
      },
      currentUser.uid,
      currentUser.email || undefined,
      aiCallId
    );

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    // 🤖 Log AI call failure
    if (aiCallId) {
      await ActivityStreamService.logAICallFailed(
        aiCallId,
        goal.id,
        'goal',
        'planCalendar',
        error,
        currentUser.uid,
        currentUser.email || undefined,
        executionTime
      );
    }
  }
};
```

## Benefits

1. **Complete AI Call Lifecycle Tracking**: Track initiation, completion, and failures of AI functions
2. **Calendar Operation Visibility**: See exactly what calendar changes were made by AI
3. **Performance Monitoring**: Track execution times for AI calls
4. **Error Analysis**: Detailed error tracking for failed AI operations
5. **Audit Trail**: Complete history of AI-generated calendar scheduling
6. **Context Preservation**: Maintain link between AI calls and resulting calendar changes

## Activity Stream Icons

The enhanced icon system now includes:
- 🤖 AI call initiated
- ✅ AI call completed
- ❌ AI call failed
- 📅 Calendar scheduled
- ⏰ Calendar block created
- 🔄 Calendar sync

## Querying Enhanced Activities

You can filter activities by the new types:
```typescript
// Get all AI-related activities for a goal
const aiActivities = activities.filter(a => 
  a.activityType.startsWith('ai_call_') && a.entityId === goalId
);

// Get all calendar-related activities
const calendarActivities = activities.filter(a => 
  a.activityType.startsWith('calendar_') && a.entityId === goalId
);

// Find linked AI call and calendar results
const linkedActivities = activities.filter(a => 
  a.aiCallId === specificCallId
);
```

This enhancement provides complete visibility into AI operations and calendar changes, making it easy to understand what the AI did and what changes were made to the calendar as a result.

export type BlockPriority = 1 | 2 | 3 | 4 | 5; // 1 = highest, 5 = lowest
export type SourceType = 'chore' | 'routine';
export type ScheduledInstanceStatus =
  | 'draft'
  | 'planned'
  | 'committed'
  | 'completed'
  | 'missed'
  | 'skipped'
  | 'unscheduled'
  | 'cancelled';

type IsoDate = string; // YYYY-MM-DD

type IsoDateTime = string; // ISO8601 string, always UTC when persisted

export interface QuietHoursWindow {
  /** Days of week aligned to RFC5545 (MO = 1 .. SU = 7). Empty/null = applies every day. */
  daysOfWeek?: number[];
  /** Local start time, HH:mm (24h) */
  startTime: string;
  /** Local end time, HH:mm (24h) */
  endTime: string;
}

export interface BlockTimeWindow {
  /** Days of week aligned to RFC5545 (MO = 1 .. SU = 7). */
  daysOfWeek: number[];
  /** Inclusive start time within block local TZ, HH:mm */
  startTime: string;
  /** Exclusive end time within block local TZ, HH:mm */
  endTime: string;
  /** Optional start date (ISO8601 date) limiting the window */
  startDate?: IsoDate;
  /** Optional end date (ISO8601 date) limiting the window */
  endDate?: IsoDate;
}

export interface BlockBuffers {
  /** Minutes required before an instance begins */
  before: number;
  /** Minutes required after an instance completes */
  after: number;
}

export interface BlockConstraints {
  /** Location tag enforced for scheduled items (e.g. 'home', 'office') */
  location?: string;
  /** Quiet hours excluded from scheduling within the block */
  quietHours?: QuietHoursWindow[];
  /** Required device identifiers (e.g. 'laptop', 'gym-equipment') */
  deviceNeeded?: string[];
  /** Items must advertise at least one of these tags */
  requiredTags?: string[];
  /** Items bearing any of these tags are disallowed */
  excludedTags?: string[];
}

export interface BlockRecurrence {
  /** RFC5545 RRULE string; DTSTART handled separately */
  rrule: string;
  /** ISO8601 datetime identifying DTSTART / anchor in block timezone */
  dtstart?: IsoDateTime;
  /** Olson timezone identifier (e.g. 'Europe/London') */
  timezone: string;
}

export interface BlockModel {
  id: string;
  ownerUid: string;
  name: string;
  color: string;
  description?: string;
  recurrence: BlockRecurrence;
  /** One or more time windows describing when the block is available */
  windows: BlockTimeWindow[];
  /** Minimum minutes a scheduled instance may consume */
  minDurationMinutes: number;
  /** Maximum minutes a scheduled instance may consume */
  maxDurationMinutes: number;
  /** Maximum total minutes per day for the block */
  dailyCapacityMinutes: number;
  /** Block priority: lower number wins */
  priority: BlockPriority;
  /** Buffers inserted before/after every scheduled instance */
  buffers: BlockBuffers;
  /** Whether the block participates in scheduling */
  enabled: boolean;
  constraints?: BlockConstraints;
  /** Whether the block should render on calendar/list views */
  visible?: boolean;
  /** Optional manual ordering hint */
  order?: number;
  createdAt: number;
  updatedAt: number;
}

export type RecurrenceSource = 'natural_language' | 'rrule';

export interface RecurrenceDefinition {
  /** RFC5545 RRULE (no DTSTART) */
  rrule: string;
  /** ISO8601 DTSTART */
  dtstart?: IsoDateTime;
  /** Olson timezone identifier */
  timezone: string;
  /** Explicit exception dates (ISO8601 local dates) */
  exdates?: IsoDate[];
  /** Original natural language provided by user (for editing UX) */
  naturalLanguage?: string;
  /** Tracking for validation */
  source: RecurrenceSource;
}

export interface SchedulingPolicy {
  mode: 'roll_forward' | 'skip' | 'escalate_to_next_priority_block';
  /** Grace window in minutes before escalating or marking missed */
  graceWindowMinutes?: number;
  /** Optional explicit escalation targets when mode === 'escalate_to_next_priority_block' */
  escalateBlockIds?: string[];
}

export interface LocationNeeds {
  /** Required location tag (aligned with BlockConstraints.location) */
  requiredLocation?: string;
  /** Allowed location tags; empty => any */
  allowedLocations?: string[];
}

export interface AttachmentRef {
  id: string;
  url: string;
  contentType?: string;
  title?: string;
  sizeBytes?: number;
}

export interface ChoreModel {
  id: string;
  ownerUid: string;
  title: string;
  description?: string;
  recurrence: RecurrenceDefinition;
  /** Estimated minutes used for scheduling */
  durationMinutes: number;
  /** Optional override block requirement */
  requiredBlockId?: string;
  /** Additional eligible block ids (by tag matching) */
  eligibleBlockIds?: string[];
  priority: BlockPriority;
  policy: SchedulingPolicy;
  locationNeeds?: LocationNeeds;
  attachments?: AttachmentRef[];
  tags?: string[];
  goalId?: string;
  storyId?: string;
  themeId?: string;
  /** Last computed occurrences for quick display */
  nextOccurrence?: IsoDateTime | null;
  /** Last completion info */
  lastCompletedAt?: IsoDateTime | null;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export type RoutineType = 'boolean' | 'quantitative' | 'streak';

export interface RoutineWindow {
  daysOfWeek?: number[];
  startTime: string;
  endTime: string;
}

export interface StreakSettings {
  /** Local timezone for day boundaries */
  timezone: string;
  /** Minutes after local day end allowed to keep streak */
  graceMinutes?: number;
  /** Dates that pause streak tracking (ISO8601) */
  pausedDates?: IsoDate[];
}

export interface RoutineModel {
  id: string;
  ownerUid: string;
  title: string;
  description?: string;
  type: RoutineType;
  unit?: string;
  dailyTarget?: number;
  /** Optional estimate of minutes required; fallback to 15 if absent */
  durationMinutes?: number;
  recurrence: RecurrenceDefinition;
  windows?: RoutineWindow[];
  requiredBlockId?: string;
  eligibleBlockIds?: string[];
  priority: BlockPriority;
  policy: SchedulingPolicy;
  locationNeeds?: LocationNeeds;
  tags?: string[];
  attachments?: AttachmentRef[];
  streakSettings?: StreakSettings;
  goalId?: string;
  storyId?: string;
  themeId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface ExternalSyncState {
  gcalEventId?: string;
  remindersId?: string;
  mfpLogId?: string;
  /** Hash of metadata payload stored in external notes */
  notesMetaHash?: string;
  /** Timestamp of last sync to each system */
  lastSyncedAt?: {
    gcal?: number;
    reminders?: number;
    mfp?: number;
  };
}

export interface ScheduledInstanceModel {
  id: string;
  ownerUid: string;
  userId: string;
  sourceType: SourceType;
  sourceId: string;
  title?: string;
  occurrenceDate: IsoDate;
  blockId?: string;
  priority: BlockPriority;
  plannedStart?: IsoDateTime;
  plannedEnd?: IsoDateTime;
  /** Minutes of buffer applied from block definition */
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  durationMinutes: number;
  status: ScheduledInstanceStatus;
  /** Reason for unscheduled/missed, used for notifications */
  statusReason?: string;
  requiredBlockId?: string | null;
  candidateBlockIds?: string[];
  /** When status last changed */
  statusUpdatedAt?: number;
  /** Scheduling metadata for audit */
  schedulingContext?: {
    blockPriority?: BlockPriority;
    solverRunId?: string;
    tieBreaker?: 'blockPriority' | 'earliestFeasible' | 'leastFragmentation';
  };
  external?: ExternalSyncState;
  createdAt: number;
  updatedAt: number;
}

export interface PlanningJobKey {
  userId: string;
  planningDate: IsoDate;
}

export interface PlanningJobState extends PlanningJobKey {
  solverRunId: string;
  startedAt: number;
  completedAt?: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
  windowStart: string;
  windowEnd: string;
  plannedCount?: number;
  unscheduledCount?: number;
}

export interface SchedulePreview {
  instances: ScheduledInstanceModel[];
  unscheduled: Array<{
    sourceType: SourceType;
    sourceId: string;
    reason: string;
    dayKey: IsoDate;
    title?: string;
    requiredBlockId?: string | null;
    candidateBlockIds?: string[];
  }>;
  conflicts: SchedulingConflict[];
}

export interface SchedulingConflict {
  dayKey: IsoDate;
  blockId?: string;
  reason: 'capacity' | 'no-block' | 'quiet-hours' | 'busy' | 'unknown';
  message: string;
  detail?: string;
}

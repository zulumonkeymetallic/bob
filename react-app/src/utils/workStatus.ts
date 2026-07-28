/**
 * Canonical work status — Backlog / In Progress / Done. Nothing else.
 *
 * Two mappings had drifted apart and were both live:
 *   config/choices.ts     offered 0/2/4 and labelled story status 2 "In Progress"
 *   utils/statusHelpers.ts read story status 2 as "Review"
 * so a story dragged to In Progress on the Kanban (which writes 1) showed as
 * "Backlog" in one place and "In Progress" in another, and a story edited via the
 * dropdown (which wrote 2) came back as "Review" on the triage table. Jim's call,
 * 2026-07-28: there is no Review lane on any surface — collapse to three.
 *
 * The reconciliation is read-tolerant and write-strict:
 *   READ   story 0 → Backlog, 1/2/3 → In Progress, >=4 → Done
 *          task  0 → Backlog, 1/3   → In Progress, >=2 → Done
 *   WRITE  always one of the canonical values below
 * so the 12 stories already sitting on the old "Review" value 2 (and the 45 on 1)
 * both render as In Progress with no data migration, and drift back is impossible
 * because every writer now goes through these constants.
 */

export type WorkLane = 'backlog' | 'in-progress' | 'done';

export const STORY_STATUS = {
    BACKLOG: 0,
    IN_PROGRESS: 1,
    DONE: 4,
} as const;

export const TASK_STATUS = {
    BACKLOG: 0,
    IN_PROGRESS: 1,
    DONE: 2,
} as const;

export const LANE_LABELS: Record<WorkLane, string> = {
    'backlog': 'Backlog',
    'in-progress': 'In Progress',
    'done': 'Done',
};

/** Bootstrap variant per lane, so every status chip in the app agrees on colour. */
export const LANE_VARIANTS: Record<WorkLane, string> = {
    'backlog': 'secondary',
    'in-progress': 'primary',
    'done': 'success',
};

export const LANE_COLORS: Record<WorkLane, string> = {
    'backlog': 'var(--muted, #6c757d)',
    'in-progress': 'var(--brand, #0d6efd)',
    'done': 'var(--green, #198754)',
};

const DONE_WORDS = ['done', 'complete', 'completed', 'finished', 'closed', 'archived'];
const IN_PROGRESS_WORDS = ['in-progress', 'in progress', 'active', 'doing', 'wip', 'testing', 'qa', 'review', 'started'];

/**
 * Blocked deliberately lands in Backlog, not Done — work that is stuck is not
 * finished. (The old iOS `kanbanColumn` default arm sent it to Done; that mapping
 * is not carried over here.)
 */
export const storyLane = (status: unknown): WorkLane => {
    const numeric = typeof status === 'string' && /^\d+$/.test(status) ? Number(status) : status;
    if (typeof numeric === 'number' && Number.isFinite(numeric)) {
        if (numeric >= 4) return 'done';
        if (numeric >= 1) return 'in-progress'; // legacy 2 (Review) and 3 (review_gate) fold in
        return 'backlog';
    }
    const s = String(status || '').trim().toLowerCase().replace(/_/g, '-');
    if (DONE_WORDS.includes(s)) return 'done';
    if (IN_PROGRESS_WORDS.includes(s)) return 'in-progress';
    return 'backlog';
};

export const taskLane = (status: unknown): WorkLane => {
    const numeric = typeof status === 'string' && /^\d+$/.test(status) ? Number(status) : status;
    if (typeof numeric === 'number' && Number.isFinite(numeric)) {
        if (numeric === 3) return 'in-progress'; // blocked — still open work
        if (numeric >= 2) return 'done';
        if (numeric === 1) return 'in-progress';
        return 'backlog';
    }
    const s = String(status || '').trim().toLowerCase().replace(/_/g, '-');
    if (DONE_WORDS.includes(s)) return 'done';
    if (IN_PROGRESS_WORDS.includes(s) || s === 'blocked') return 'in-progress';
    return 'backlog';
};

export const laneFor = (status: unknown, kind: 'story' | 'task'): WorkLane =>
    kind === 'story' ? storyLane(status) : taskLane(status);

export const statusLabel = (status: unknown, kind: 'story' | 'task'): string =>
    LANE_LABELS[laneFor(status, kind)];

export const isDoneStatus = (status: unknown, kind: 'story' | 'task'): boolean =>
    laneFor(status, kind) === 'done';

/** The numeric value to persist when an item is moved into `lane`. */
export const statusValueForLane = (lane: WorkLane, kind: 'story' | 'task'): number => {
    const scale = kind === 'story' ? STORY_STATUS : TASK_STATUS;
    if (lane === 'done') return scale.DONE;
    if (lane === 'in-progress') return scale.IN_PROGRESS;
    return scale.BACKLOG;
};

export interface StatusOption { value: number; label: string; lane: WorkLane }

/** The only options any status dropdown should offer. */
export const statusOptions = (kind: 'story' | 'task'): StatusOption[] => {
    const scale = kind === 'story' ? STORY_STATUS : TASK_STATUS;
    return [
        { value: scale.BACKLOG, label: 'Backlog', lane: 'backlog' },
        { value: scale.IN_PROGRESS, label: 'In Progress', lane: 'in-progress' },
        { value: scale.DONE, label: 'Done', lane: 'done' },
    ];
};

/**
 * Value to preselect in a dropdown for an item whose stored status is a legacy one
 * (story 2/3, task 3). Without this the select would render with no matching option
 * and silently show the first entry, so opening a "Review" story and saving anything
 * else would knock it back to Backlog.
 */
export const canonicalStatusValue = (status: unknown, kind: 'story' | 'task'): number =>
    statusValueForLane(laneFor(status, kind), kind);

export const ORDERED_LANES: WorkLane[] = ['backlog', 'in-progress', 'done'];

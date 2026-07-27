/**
 * Canonical three-state workflow status.
 *
 * BOB only has three workflow states — Backlog, In Progress, Done — on every
 * surface (web board, triage table, mobile, iOS). The extra "Planned",
 * "Review"/"Testing" and "Blocked" rungs are legacy numeric values that still
 * exist in Firestore; they are *read* into one of the three states here and are
 * never offered as a choice again. Writing goes through
 * {@link workflowStatusToRaw}, which emits the same numbers KanbanBoardV2's
 * drag-and-drop already writes, so a change made in the table and a change made
 * by dragging a card land on identical data.
 *
 * Raw numeric semantics (from types.ts, kept for backwards compatibility):
 *   Story: 0 Backlog | 1 Planned | 2 In Progress | 3 Testing | 4 Done
 *   Task:  0 To Do   | 1 In Progress | 2 Done | 3 Blocked
 */

export type WorkflowStatus = 'backlog' | 'in-progress' | 'done';
export type WorkflowEntity = 'story' | 'task';

export const WORKFLOW_STATUSES: WorkflowStatus[] = ['backlog', 'in-progress', 'done'];

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
    backlog: 'Backlog',
    'in-progress': 'In Progress',
    done: 'Done',
};

/** Bootstrap contextual variant per state — keeps badges consistent everywhere. */
export const WORKFLOW_STATUS_VARIANTS: Record<WorkflowStatus, string> = {
    backlog: 'secondary',
    'in-progress': 'primary',
    done: 'success',
};

/** Hex colours for surfaces that style inline rather than with Bootstrap classes. */
export const WORKFLOW_STATUS_COLORS: Record<WorkflowStatus, string> = {
    backlog: '#6c757d',
    'in-progress': '#0d6efd',
    done: '#198754',
};

const DONE_WORDS = ['done', 'complete', 'completed', 'finished', 'closed', 'archived'];
const IN_PROGRESS_WORDS = [
    'in-progress', 'in progress', 'inprogress', 'active', 'doing', 'wip', 'work in progress',
    'testing', 'qa', 'review', 'blocked', 'paused', 'on-hold', 'onhold', 'stalled', 'waiting',
    'planned', 'ready',
];

/**
 * Collapse any raw status (number or string, story or task) into one of the
 * three canonical states. Mirrors KanbanBoardV2's column bucketing exactly:
 * a card sitting in the board's "In Progress" column reads back as
 * 'in-progress' here, whichever legacy number it happens to carry.
 */
export function toWorkflowStatus(raw: any, entity: WorkflowEntity): WorkflowStatus {
    const numeric = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;

    if (typeof numeric === 'number' && Number.isFinite(numeric)) {
        if (entity === 'story') {
            if (numeric >= 4) return 'done';
            if (numeric >= 1) return 'in-progress'; // 1 planned, 2 active, 3 testing
            return 'backlog';
        }
        // Task: 2 (and the odd legacy 4) are done, 1 active / 3 blocked are in flight.
        if (numeric === 2 || numeric >= 4) return 'done';
        if (numeric === 1 || numeric === 3) return 'in-progress';
        return 'backlog';
    }

    const s = String(raw ?? '').trim().toLowerCase().replace(/_/g, '-');
    if (!s) return 'backlog';
    if (DONE_WORDS.includes(s)) return 'done';
    if (IN_PROGRESS_WORDS.includes(s)) return 'in-progress';
    return 'backlog';
}

/**
 * The raw value to persist for a canonical state. Stories move to 2 (not 1) for
 * In Progress because that is what dragging a card onto the board's In Progress
 * column writes — picking 1 here would have the table and the board disagree
 * about what "In Progress" means the moment either one wrote.
 */
export function workflowStatusToRaw(status: WorkflowStatus, entity: WorkflowEntity): number {
    if (entity === 'story') {
        if (status === 'done') return 4;
        if (status === 'in-progress') return 2;
        return 0;
    }
    if (status === 'done') return 2;
    if (status === 'in-progress') return 1;
    return 0;
}

export function workflowStatusLabel(raw: any, entity: WorkflowEntity): string {
    return WORKFLOW_STATUS_LABELS[toWorkflowStatus(raw, entity)];
}

export function isWorkflowDone(raw: any, entity: WorkflowEntity): boolean {
    return toWorkflowStatus(raw, entity) === 'done';
}

/** Options for a status <select>, in board order. */
export const WORKFLOW_STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] =
    WORKFLOW_STATUSES.map((value) => ({ value, label: WORKFLOW_STATUS_LABELS[value] }));

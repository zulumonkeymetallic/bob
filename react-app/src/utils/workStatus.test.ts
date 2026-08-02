import {
    STORY_STATUS,
    TASK_STATUS,
    canonicalStatusValue,
    goalLane,
    isDoneGoal,
    isDoneStatus,
    laneFor,
    statusLabel,
    statusOptions,
    statusValueForLane,
    storyLane,
    taskLane,
} from './workStatus';
import { isStatus } from './statusHelpers';

/**
 * The status model is read by roughly fifteen components and written by the Kanban drag,
 * the triage table, every card's status chip and the choice config. The bug it replaced —
 * two mappings that disagreed about whether story status 2 meant "In Progress" or "Review"
 * — was invisible until you compared two screens side by side, which is exactly the kind of
 * drift a test catches and review does not.
 */

describe('storyLane', () => {
    it('places only 0 in backlog', () => {
        expect(storyLane(0)).toBe('backlog');
    });

    it('folds the legacy Review (2) and review_gate (3) values into In Progress', () => {
        // The whole point of the reconciliation: these values still exist in Firestore and
        // must not read as Backlog (which would hide active work) or Done.
        expect(storyLane(1)).toBe('in-progress');
        expect(storyLane(2)).toBe('in-progress');
        expect(storyLane(3)).toBe('in-progress');
    });

    it('treats 4 and anything above it as done', () => {
        expect(storyLane(4)).toBe('done');
        expect(storyLane(5)).toBe('done');
    });

    it('accepts numeric strings, which Firestore docs genuinely contain', () => {
        expect(storyLane('0')).toBe('backlog');
        expect(storyLane('2')).toBe('in-progress');
        expect(storyLane('4')).toBe('done');
    });

    it('maps legacy string statuses', () => {
        expect(storyLane('backlog')).toBe('backlog');
        expect(storyLane('in-progress')).toBe('in-progress');
        expect(storyLane('in_progress')).toBe('in-progress');
        expect(storyLane('testing')).toBe('in-progress');
        expect(storyLane('review')).toBe('in-progress');
        expect(storyLane('done')).toBe('done');
        expect(storyLane('complete')).toBe('done');
    });

    it('defaults to backlog for null, undefined and nonsense', () => {
        expect(storyLane(null)).toBe('backlog');
        expect(storyLane(undefined)).toBe('backlog');
        expect(storyLane('')).toBe('backlog');
        expect(storyLane('wat')).toBe('backlog');
        expect(storyLane(NaN)).toBe('backlog');
    });
});

describe('taskLane', () => {
    it('uses the task scale, where 2 is Done rather than Review', () => {
        // This is the collision that made a shared, type-blind helper impossible:
        // story 2 is In Progress, task 2 is Done.
        expect(taskLane(0)).toBe('backlog');
        expect(taskLane(1)).toBe('in-progress');
        expect(taskLane(2)).toBe('done');
    });

    it('keeps blocked (3) as open work, not finished', () => {
        expect(taskLane(3)).toBe('in-progress');
    });

    it('maps legacy string statuses', () => {
        expect(taskLane('todo')).toBe('backlog');
        expect(taskLane('in-progress')).toBe('in-progress');
        expect(taskLane('blocked')).toBe('in-progress');
        expect(taskLane('done')).toBe('done');
    });
});

describe('the story and task scales never merge', () => {
    it('reads raw value 2 differently per entity type', () => {
        expect(laneFor(2, 'story')).toBe('in-progress');
        expect(laneFor(2, 'task')).toBe('done');
    });

    it('reads raw value 4 differently per entity type', () => {
        expect(laneFor(4, 'story')).toBe('done');
        expect(laneFor(4, 'task')).toBe('done');
    });
});

describe('statusValueForLane', () => {
    it('writes 1 for a story moved to In Progress, never the legacy 2', () => {
        // The Kanban drag has always written 1; the dropdown used to write 2, which is how
        // the two mappings drifted apart in the first place.
        expect(statusValueForLane('in-progress', 'story')).toBe(1);
        expect(statusValueForLane('in-progress', 'story')).toBe(STORY_STATUS.IN_PROGRESS);
    });

    it('writes 4 for a done story and 2 for a done task', () => {
        expect(statusValueForLane('done', 'story')).toBe(4);
        expect(statusValueForLane('done', 'task')).toBe(TASK_STATUS.DONE);
    });

    it('round-trips through laneFor for every canonical value', () => {
        (['backlog', 'in-progress', 'done'] as const).forEach((lane) => {
            (['story', 'task'] as const).forEach((kind) => {
                expect(laneFor(statusValueForLane(lane, kind), kind)).toBe(lane);
            });
        });
    });
});

describe('statusOptions', () => {
    it('offers exactly three lanes and never a Review option', () => {
        (['story', 'task'] as const).forEach((kind) => {
            const labels = statusOptions(kind).map((o) => o.label);
            expect(labels).toEqual(['Backlog', 'In Progress', 'Done']);
            expect(labels).not.toContain('Review');
        });
    });

    it('offers story values 0/1/4 — not the legacy 2', () => {
        expect(statusOptions('story').map((o) => o.value)).toEqual([0, 1, 4]);
    });
});

describe('canonicalStatusValue', () => {
    it('snaps a legacy Review story onto the In Progress option', () => {
        // Without this a select would render with no matching option, silently show the
        // first entry, and demote the story to Backlog on the next save.
        expect(canonicalStatusValue(2, 'story')).toBe(1);
        expect(canonicalStatusValue(3, 'story')).toBe(1);
    });

    it('leaves already-canonical values alone', () => {
        expect(canonicalStatusValue(0, 'story')).toBe(0);
        expect(canonicalStatusValue(4, 'story')).toBe(4);
        expect(canonicalStatusValue(1, 'task')).toBe(1);
    });
});

describe('isDoneStatus', () => {
    it('does not treat a blocked task as finished', () => {
        expect(isDoneStatus(3, 'task')).toBe(false);
    });

    it('does not treat a legacy Review story as finished', () => {
        expect(isDoneStatus(2, 'story')).toBe(false);
    });

    it('recognises real completion', () => {
        expect(isDoneStatus(4, 'story')).toBe(true);
        expect(isDoneStatus(2, 'task')).toBe(true);
    });
});

describe('statusLabel', () => {
    it('never emits the word Review', () => {
        [0, 1, 2, 3, 4, 'review', 'testing'].forEach((raw) => {
            expect(statusLabel(raw, 'story')).not.toBe('Review');
        });
    });
});

describe('isStatus with an entity kind', () => {
    it('does not mistake a done task for in-progress', () => {
        // The regression guarded here: widening "in-progress" to cover story 2/3 without a
        // kind parameter made every completed task (status 2) read as in-progress.
        expect(isStatus(2, 'in_progress', 'task')).toBe(false);
        expect(isStatus(2, 'done', 'task')).toBe(true);
    });

    it('includes legacy Review stories in an in-progress filter', () => {
        expect(isStatus(2, 'in-progress', 'story')).toBe(true);
        expect(isStatus(2, 'active', 'story')).toBe(true);
    });

    it('matches nothing for the removed Review lane', () => {
        expect(isStatus(2, 'review', 'story')).toBe(false);
        expect(isStatus(3, 'review_gate', 'story')).toBe(false);
    });

    it('does not match unrelated words against the backlog lane', () => {
        // laneFor answers 'backlog' for anything it does not recognise, so the fast path is
        // gated on a known lane word — otherwise a bogus filter would match every backlog row.
        expect(isStatus(0, 'bogus-status', 'story')).toBe(false);
    });
});


describe('goalLane', () => {
    it('reads 2 as Complete and 4 as Deferred — the opposite of a story', () => {
        // The number that means DONE on a story means DEFERRED on a goal. The roadmap chip had
        // `isDone = status === 4` and so rendered all 80 deferred goals on the live account as
        // finished. Both the goal status dropdown and the goals list page agree on this mapping.
        expect(goalLane(2)).toBe('done');
        expect(goalLane(4)).toBe('deferred');
        expect(isDoneGoal(2)).toBe(true);
        expect(isDoneGoal(4)).toBe(false);
    });

    it('treats New as backlog, and both Work in Progress and Blocked as in progress', () => {
        expect(goalLane(0)).toBe('backlog');
        expect(goalLane(1)).toBe('in-progress');
        expect(goalLane(3)).toBe('in-progress');
    });

    it('accepts numeric strings, which the live data contains', () => {
        expect(goalLane('2')).toBe('done');
        expect(goalLane('4')).toBe('deferred');
    });

    it('understands the word forms too, including the live "active"', () => {
        // 8 of the live goals carry the string 'active' rather than a number.
        expect(goalLane('active')).toBe('in-progress');
        expect(goalLane('deferred')).toBe('deferred');
        expect(goalLane('complete')).toBe('done');
    });

    it('falls back to backlog rather than throwing on junk', () => {
        [null, undefined, '', 'nonsense', {}].forEach((v) => {
            expect(goalLane(v as any)).toBe('backlog');
        });
    });
});

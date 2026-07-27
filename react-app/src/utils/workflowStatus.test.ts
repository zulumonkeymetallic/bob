import {
    WORKFLOW_STATUS_OPTIONS,
    isWorkflowDone,
    toWorkflowStatus,
    workflowStatusLabel,
    workflowStatusToRaw,
} from './workflowStatus';

describe('workflowStatus', () => {
    test('offers exactly three states', () => {
        expect(WORKFLOW_STATUS_OPTIONS.map(o => o.value)).toEqual(['backlog', 'in-progress', 'done']);
        expect(WORKFLOW_STATUS_OPTIONS.map(o => o.label)).toEqual(['Backlog', 'In Progress', 'Done']);
    });

    describe('stories', () => {
        test('collapses legacy Planned/Testing into In Progress', () => {
            expect(toWorkflowStatus(0, 'story')).toBe('backlog');
            expect(toWorkflowStatus(1, 'story')).toBe('in-progress'); // was "Planned"
            expect(toWorkflowStatus(2, 'story')).toBe('in-progress');
            expect(toWorkflowStatus(3, 'story')).toBe('in-progress'); // was "Testing"/"Review"
            expect(toWorkflowStatus(4, 'story')).toBe('done');
            expect(toWorkflowStatus(5, 'story')).toBe('done');
        });

        test('handles legacy string statuses', () => {
            expect(toWorkflowStatus('backlog', 'story')).toBe('backlog');
            expect(toWorkflowStatus('active', 'story')).toBe('in-progress');
            expect(toWorkflowStatus('review', 'story')).toBe('in-progress');
            expect(toWorkflowStatus('in_progress', 'story')).toBe('in-progress');
            expect(toWorkflowStatus('completed', 'story')).toBe('done');
            expect(toWorkflowStatus(null, 'story')).toBe('backlog');
            expect(toWorkflowStatus('2', 'story')).toBe('in-progress');
        });

        test('writes the same values the board drag writes', () => {
            expect(workflowStatusToRaw('backlog', 'story')).toBe(0);
            expect(workflowStatusToRaw('in-progress', 'story')).toBe(2);
            expect(workflowStatusToRaw('done', 'story')).toBe(4);
        });
    });

    describe('tasks', () => {
        test('reads 2 as done and 1/3 as in progress', () => {
            expect(toWorkflowStatus(0, 'task')).toBe('backlog');
            expect(toWorkflowStatus(1, 'task')).toBe('in-progress');
            expect(toWorkflowStatus(2, 'task')).toBe('done');
            expect(toWorkflowStatus(3, 'task')).toBe('in-progress'); // was "Blocked"
        });

        test('writes canonical task values', () => {
            expect(workflowStatusToRaw('backlog', 'task')).toBe(0);
            expect(workflowStatusToRaw('in-progress', 'task')).toBe(1);
            expect(workflowStatusToRaw('done', 'task')).toBe(2);
        });
    });

    test('round-trips every state for both entity types', () => {
        (['story', 'task'] as const).forEach((entity) => {
            WORKFLOW_STATUS_OPTIONS.forEach(({ value }) => {
                expect(toWorkflowStatus(workflowStatusToRaw(value, entity), entity)).toBe(value);
            });
        });
    });

    test('story 2 and task 1 both read as In Progress, not Review', () => {
        expect(workflowStatusLabel(2, 'story')).toBe('In Progress');
        expect(workflowStatusLabel(1, 'task')).toBe('In Progress');
    });

    test('isWorkflowDone matches the done bucket', () => {
        expect(isWorkflowDone(4, 'story')).toBe(true);
        expect(isWorkflowDone(2, 'story')).toBe(false);
        expect(isWorkflowDone(2, 'task')).toBe(true);
        expect(isWorkflowDone('done', 'task')).toBe(true);
    });
});

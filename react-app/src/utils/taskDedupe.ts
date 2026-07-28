import { Task } from '../types';

/**
 * Collapses duplicate task rows for display.
 *
 * Two separate things multiply tasks, and both come from the Mac reminders sync
 * (bob-mac-sync FirebaseSyncService.swift), which mirrors every Apple Reminder into a
 * BOB task keyed on the reminder's UUID and imports completed ones as well as open ones:
 *
 *   1. The same reminder re-imported more than once. Both copies share a `duplicateKey`
 *      (`reminder:<uuid>`), and onTaskWritten's duplicate detection sets `duplicateFlag`
 *      on each of them — on the original too, so filtering on that flag alone would hide
 *      the row entirely rather than deduplicate it.
 *   2. A repeating reminder. Apple mints a fresh UUID for every completed occurrence, so
 *      one daily habit comes back as one BOB task per occurrence — all with the same
 *      title and due date, all distinct documents with distinct duplicateKeys. This is
 *      what turned "Program 100 bicep curls" into 36 rows on 2026-07-27.
 *
 * The second case only collapses for `ios_reminder`-sourced tasks: two hand-created
 * tasks that happen to share a title and a due date are genuinely two pieces of work and
 * must both survive. Oldest wins, matching onTaskWritten's "prefer keeping the oldest".
 */

const createdAtMs = (task: Task): number => {
    const raw = (task as any).createdAt;
    if (!raw) return Number.MAX_SAFE_INTEGER;
    if (typeof raw === 'number') return raw;
    if (typeof raw?.toDate === 'function') return raw.toDate().getTime();
    const parsed = Date.parse(String(raw));
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

const dedupeKey = (task: Task): string | null => {
    const explicit = String((task as any).duplicateKey || '').trim();
    if (explicit) return explicit;
    const source = String((task as any).source || '').trim().toLowerCase();
    if (source !== 'ios_reminder') return null;
    const title = String(task.title || '').trim().toLowerCase();
    if (!title) return null;
    return `imported:${title}|${String((task as any).dueDate ?? '')}`;
};

export function dedupeTasks(tasks: Task[]): Task[] {
    const firstSeen = new Map<string, Task>();
    const out: Task[] = [];

    for (const task of tasks) {
        const key = dedupeKey(task);
        if (!key) { out.push(task); continue; }
        const existing = firstSeen.get(key);
        if (!existing) {
            firstSeen.set(key, task);
            out.push(task);
            continue;
        }
        // Keep whichever is older; swap in place so list order is otherwise untouched.
        if (createdAtMs(task) < createdAtMs(existing)) {
            firstSeen.set(key, task);
            out[out.indexOf(existing)] = task;
        }
    }

    return out;
}

/** How many rows `dedupeTasks` would hide — for a "n duplicates hidden" hint. */
export function countHiddenDuplicates(tasks: Task[]): number {
    return tasks.length - dedupeTasks(tasks).length;
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { Activity, Clock3, Wand2, Pencil, Trash2, ExternalLink, MessageSquarePlus, Settings, Eye, EyeOff } from 'lucide-react';
import {
    doc, updateDoc, deleteDoc, serverTimestamp,
    collection, query, where, orderBy, limit, onSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { Story, Task, Goal } from '../types';
import { themeVars } from '../utils/themeVars';
import { useThemeAwareColors } from '../hooks/useThemeAwareColors';
import { applyPlannerDefer } from '../utils/plannerDeferral';
import { findItemWithManualPriorityRank, getManualPriorityLabel, getManualPriorityRank, getNextManualPriorityRank } from '../utils/manualPriority';
import DeferItemModal from './DeferItemModal';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { canonicalStatusValue, isDoneStatus, laneFor, statusLabel, statusOptions } from '../utils/workStatus';
import { MISSING_INFO_CELL_BG, MISSING_INFO_CELL_BG_HOVER } from '../utils/dataQuality';
import { normalizePriorityValue } from '../utils/priorityUtils';
import { POINTS_STEP, STORY_POINTS_MAX, TASK_POINTS_MAX, normalizePointsValue, parsePointsValue } from '../utils/points';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { compareTimestamps, formatTimestampCell } from '../utils/timestamps';

const BASE_URL = 'https://bob.jc1.tech';
const EXCLUDED_TASK_TYPES = new Set(['chore', 'routine', 'habit', 'core', 'read', 'watch']);

interface Sprint { id: string; name: string; }
type RowType = 'story' | 'task';
type SortKey = 'type' | 'ref' | 'title' | 'status' | 'ai' | 'dueDate' | 'createdAt';
type SortDir = 'asc' | 'desc';

type ColumnKey =
    | 'type' | 'ref' | 'title' | 'parent' | 'description' | 'acceptanceCriteria'
    | 'status' | 'criticality' | 'ai' | 'points' | 'dueDate' | 'timeOfDay'
    | 'sprint' | 'note' | 'createdAt';

interface TriageColumn {
    key: ColumnKey;
    label: string;
    minWidth: number;
    /** Set only on columns the table can sort by; the rest render an inert header. */
    sortKey?: SortKey;
    /** In the reduced set used on iPad landscape, where the full 15 need horizontal
     *  scrolling to read anything. Everything else starts hidden there. */
    compact?: boolean;
}

/**
 * The column set, in render order. Replaces the hand-maintained pairs of
 * `{!compactColumns && <TH .../>}` / `{!compactColumns && <td>...</td>}` guards, which meant
 * the header list and the cell list could drift apart and gave the user no say either way.
 * Order/Actions are not here: Actions is always rendered last, and this table has no drag
 * column (reordering a mixed story+task list has no single field to write).
 */
const TRIAGE_COLUMNS: TriageColumn[] = [
    { key: 'type', label: 'Type', minWidth: 70, sortKey: 'type' },
    { key: 'ref', label: 'Ref', minWidth: 80, sortKey: 'ref' },
    { key: 'title', label: 'Title', minWidth: 200, sortKey: 'title', compact: true },
    // Parent sits directly after Title — what a row rolls up to is read together with what
    // it is, not eight columns away.
    { key: 'parent', label: 'Parent', minWidth: 180 },
    { key: 'description', label: 'Description', minWidth: 160 },
    { key: 'acceptanceCriteria', label: 'Acceptance criteria', minWidth: 220 },
    { key: 'status', label: 'Status', minWidth: 100, sortKey: 'status', compact: true },
    { key: 'criticality', label: 'Criticality', minWidth: 100 },
    { key: 'ai', label: 'AI', minWidth: 50, sortKey: 'ai', compact: true },
    { key: 'points', label: 'Points', minWidth: 70 },
    { key: 'dueDate', label: 'Due', minWidth: 90, sortKey: 'dueDate' },
    { key: 'timeOfDay', label: 'Time of day', minWidth: 100 },
    { key: 'sprint', label: 'Sprint', minWidth: 130 },
    { key: 'note', label: 'Last note', minWidth: 180 },
    // Last data column, so it sits immediately left of Actions — same position as the
    // Created column on the Modern goals/stories/tasks tables.
    { key: 'createdAt', label: 'Created', minWidth: 140, sortKey: 'createdAt' },
];

interface SprintTriageTableProps {
    stories: Story[];
    tasks: Task[];
    goals: Goal[];
    sprints: Sprint[];
    filterSprintId: string | null;
    onEditStory: (story: Story) => void;
    onEditTask: (task: Task) => void;
    onEditGoal?: (goal: Goal) => void;
    /** iPad landscape: show only Title/Status/AI/Actions — the rest needs horizontal
     * scrolling on that width. Confirmed by Jim, 2026-07-24. */
    compactColumns?: boolean;
    /** Case-insensitive title substring match, shared with the board/swimlane views via
     * SprintKanbanPageV2's toolbar. */
    searchTerm?: string;
}

// Three canonical lanes only — see utils/workStatus.ts. This dropdown previously offered a
// "Review" option for stories (raw 2) which nothing else in the app had a lane for, and
// statusColor painted it the same green as Done, so a story parked in Review read as
// finished. Removed per Jim, 2026-07-28.
const isDone = (status: number, type: RowType) => isDoneStatus(status, type);

/**
 * Lane colours for the triage table: grey backlog, green in progress, blue complete.
 *
 * NOTE this is NOT the shared LANE_COLORS from utils/workStatus, which the Kanban board uses
 * and which maps in-progress→blue and done→green — the reverse of the last two. Requested for
 * this table specifically by Jim, 2026-08-03. Kept local rather than changed at source, because
 * editing LANE_COLORS would silently repaint the board, the cards and every other consumer.
 * If the board should match, that is a deliberate change to workStatus.ts, not a side effect
 * of this one.
 */
const LANE_TEXT: Record<string, string> = {
    'backlog': '#6c757d',
    'in-progress': '#198754',
    'done': '#0d6efd',
};

/** Subtle enough to scan a column by, faint enough not to fight the text on it. */
const LANE_CELL_BG: Record<string, string> = {
    'backlog': 'rgba(108, 117, 125, 0.10)',
    'in-progress': 'rgba(25, 135, 84, 0.12)',
    'done': 'rgba(13, 110, 253, 0.12)',
};

function statusColor(status: number, type: RowType) {
    return LANE_TEXT[laneFor(status, type)] || (themeVars.muted as string);
}

function statusCellBg(status: number, type: RowType) {
    return LANE_CELL_BG[laneFor(status, type)];
}

function fmtDate(v: any): string {
    if (!v) return '';
    if (typeof v === 'string') return v.slice(0, 10);
    if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
    if (v?.toDate) return v.toDate().toISOString().slice(0, 10);
    return '';
}
function parseDateMs(s: string) { const ms = Date.parse(s); return Number.isNaN(ms) ? null : ms; }

function itemRef(item: Story | Task, type: RowType): string {
    return (item as any).ref || (type === 'story' ? 'ST-?' : 'TK-?');
}

const TH_BASE: React.CSSProperties = {
    padding: '12px 8px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    borderRight: `1px solid ${themeVars.border}`,
    position: 'sticky',
    top: 0,
    zIndex: 5,
    cursor: 'pointer',
    userSelect: 'none',
};

// Padding, size and line height match ModernStoriesTable's cells, so a row reads the same
// on the Kanban's table view as it does on /stories. Per Jim, 2026-08-05.
const TD: React.CSSProperties = {
    padding: '12px 8px',
    fontSize: 14,
    lineHeight: 1.4,
    verticalAlign: 'middle',
    wordBreak: 'break-word',
    borderRight: `1px solid ${themeVars.border}`,
};

const abtn = (color?: string): React.CSSProperties => ({
    color: color || (themeVars.muted as string),
    padding: 4,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
});

const SprintTriageTable: React.FC<SprintTriageTableProps> = ({
    stories, tasks, goals, sprints, filterSprintId,
    onEditStory, onEditTask, onEditGoal, compactColumns = false,
    searchTerm = '',
}) => {
    const navigate = useNavigate();
    const { backgrounds } = useThemeAwareColors();
    const { showSidebar } = useSidebar();
    const { currentUser } = useAuth();
    const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null);
    const [editVal, setEditVal] = useState('');
    const [saving, setSaving] = useState(new Set<string>());
    const [deferItem, setDeferItem] = useState<{ id: string; type: RowType; title: string } | null>(null);
    const [converting, setConverting] = useState<string | null>(null);
    const [convertedStory, setConvertedStory] = useState<{ ref: string; id: string } | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('type');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [showConfig, setShowConfig] = useState(false);
    // Seeded once from compactColumns rather than tracked: the prop is device-derived
    // (isIPad && isTablet in SprintKanbanPageV2) and stable for the session, so re-deriving
    // it would only ever throw away a choice the user has since made here.
    const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
        () => new Set(TRIAGE_COLUMNS.filter(c => !compactColumns || c.compact).map(c => c.key)),
    );
    const show = useCallback((key: ColumnKey) => visibleColumns.has(key), [visibleColumns]);
    const toggleColumn = (key: ColumnKey) => setVisibleColumns((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const [hovered, setHovered] = useState<string | null>(null);
    const [latestNotes, setLatestNotes] = useState<Record<string, string>>({});
    const [hideDone, setHideDone] = useState(true);
    const [flaggingPriorityId, setFlaggingPriorityId] = useState<string | null>(null);
    const [savingNote, setSavingNote] = useState<string | null>(null);
    // Optimistic overlay. Tasks on this table come from `sprint_task_index`, a materialised
    // copy that a Cloud Function re-mirrors from `tasks/{id}` after a write — so a status
    // change lands in Firestore but the row on screen keeps its old value until the trigger
    // catches up, which reads as "the change didn't take". These two hold the intended state
    // until the listener agrees. Confirmed by Jim, 2026-07-28.
    const [pendingPatches, setPendingPatches] = useState<Record<string, Record<string, any>>>({});
    const [hiddenRowIds, setHiddenRowIds] = useState<Set<string>>(new Set());

    const applyPatch = useCallback(<T extends Story | Task>(item: T): T => {
        const patch = pendingPatches[item.id];
        return patch ? ({ ...item, ...patch } as T) : item;
    }, [pendingPatches]);

    // Drop an overlay once the incoming props actually carry the value we wrote, otherwise
    // a later legitimate change made elsewhere would be masked by a stale local patch.
    useEffect(() => {
        setPendingPatches((prev) => {
            const ids = Object.keys(prev);
            if (ids.length === 0) return prev;
            const byId = new Map<string, any>([
                ...stories.map((s) => [s.id, s] as [string, any]),
                ...tasks.map((t) => [t.id, t] as [string, any]),
            ]);
            let changed = false;
            const next: Record<string, Record<string, any>> = {};
            for (const id of ids) {
                const live = byId.get(id);
                if (!live) { next[id] = prev[id]; continue; } // row gone entirely — keep until it disappears
                const settled = Object.entries(prev[id]).every(([k, v]) => live[k] === v);
                if (settled) changed = true;
                else next[id] = prev[id];
            }
            return changed ? next : prev;
        });
    }, [stories, tasks]);

    const handleFlagPriority = async (story: Story) => {
        if (!currentUser) return;
        setFlaggingPriorityId(story.id);
        try {
            const storyPersona = String((story as any).persona || 'personal');
            const currentRank = getManualPriorityRank(story);
            if (currentRank) {
                await updateDoc(doc(db, 'stories', story.id), {
                    userPriorityFlag: false, userPriorityRank: null, userPriorityFlagAt: null, updatedAt: serverTimestamp(),
                });
            } else {
                const allStories = stories.filter(s => (s as any).status !== 4);
                const nextRank = getNextManualPriorityRank(allStories, storyPersona, story.id);
                const conflict = findItemWithManualPriorityRank(allStories, storyPersona, nextRank, story.id);
                if (conflict?.id) {
                    await updateDoc(doc(db, 'stories', conflict.id), {
                        userPriorityFlag: false, userPriorityRank: null, userPriorityFlagAt: null, updatedAt: serverTimestamp(),
                    });
                }
                await updateDoc(doc(db, 'stories', story.id), {
                    userPriorityFlag: true, userPriorityRank: nextRank, userPriorityFlagAt: new Date().toISOString(), updatedAt: serverTimestamp(),
                });
                httpsCallable(functions, 'deltaPriorityRescore')({ entityId: story.id, entityType: 'story' }).catch(() => {});
            }
        } catch (e) {
            console.warn('Failed to toggle user priority', e);
        } finally {
            setFlaggingPriorityId(null);
        }
    };

    // Sprint-scoped data (with the optimistic overlay applied, and rows the user has just
    // deleted removed immediately rather than waiting on the index listener)
    const searchTermNormalized = searchTerm.trim().toLowerCase();

    const sprintStories = useMemo(() =>
        stories
            .filter(s => !hiddenRowIds.has(s.id))
            .map(applyPatch)
            .filter(s => !filterSprintId || (s as any).sprintId === filterSprintId)
            .filter(s => !searchTermNormalized || String(s.title || '').toLowerCase().includes(searchTermNormalized)),
    [stories, filterSprintId, hiddenRowIds, applyPatch, searchTermNormalized]);

    const sprintTasks = useMemo(() =>
        tasks
            .filter(t => !hiddenRowIds.has(t.id))
            .map(applyPatch)
            .filter(t => !filterSprintId || (t as any).sprintId === filterSprintId)
            .filter(t => !EXCLUDED_TASK_TYPES.has(String((t as any).type || '').toLowerCase()))
            .filter(t => !searchTermNormalized || String(t.title || '').toLowerCase().includes(searchTermNormalized)),
    [tasks, filterSprintId, hiddenRowIds, applyPatch, searchTermNormalized]);

    // Activity stream subscription for latest notes
    useEffect(() => {
        const uid = currentUser?.uid;
        if (!uid) return;
        const ids = new Set([
            ...sprintStories.map(s => s.id),
            ...sprintTasks.map(t => t.id),
        ]);
        if (ids.size === 0) { setLatestNotes({}); return; }
        const q = query(
            collection(db, 'activity_stream'),
            where('ownerUid', '==', uid),
            where('activityType', '==', 'note_added'),
            orderBy('timestamp', 'desc'),
            limit(Math.min(500, ids.size * 3))
        );
        return onSnapshot(q, snap => {
            const next: Record<string, string> = {};
            snap.docs.forEach(d => {
                const data = d.data() as any;
                const eid = data.entityId || data.storyId || data.taskId;
                if (!eid || !ids.has(eid) || next[eid]) return;
                const txt = typeof data.noteContent === 'string' ? data.noteContent.trim() : '';
                if (txt) next[eid] = txt;
            });
            setLatestNotes(next);
        }, () => setLatestNotes({}));
    }, [currentUser?.uid, sprintStories, sprintTasks]);

    // Dropdown option lists
    const goalOptions = useMemo(() =>
        goals.filter(g => g.status !== 4).map(g => ({ id: g.id, label: `${g.ref ? g.ref + ' — ' : ''}${g.title}` })),
    [goals]);

    const storyOptions = useMemo(() =>
        sprintStories.map(s => ({ id: s.id, label: `${(s as any).ref ? (s as any).ref + ' — ' : ''}${s.title}` })),
    [sprintStories]);

    // Progress helpers
    const storyProgress = (storyId: string) => {
        const t = sprintTasks.filter(t => (t as any).parentId === storyId || (t as any).storyId === storyId);
        if (!t.length) return null;
        const done = t.filter(t => Number((t as any).status) === 2).length;
        return { done, total: t.length, pct: Math.round(done / t.length * 100) };
    };

    const goalProgress = (goalId: string) => {
        const s = sprintStories.filter(s => (s as any).goalId === goalId);
        if (!s.length) return null;
        const done = s.filter(s => isDone(Number((s as any).status), 'story')).length;
        return { done, total: s.length, pct: Math.round(done / s.length * 100) };
    };

    // Firestore saves
    const addSaving = (id: string) => setSaving(p => new Set([...p, id]));
    const rmSaving = (id: string) => setSaving(p => { const s = new Set(p); s.delete(id); return s; });

    const saveItem = async (id: string, collection_: 'stories' | 'tasks', updates: Record<string, any>) => {
        addSaving(id);
        setPendingPatches((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...updates } }));
        const rollback = () => setPendingPatches((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        try {
            await updateDoc(doc(db, collection_, id), { ...updates, updatedAt: serverTimestamp() });
        } catch (err: any) {
            rollback();
            // The row's own doc was already deleted but a stale sprint_task_index/materialized
            // entry kept it visible here (orphaned index row — see onTaskWritten's delete-cleanup
            // in functions/index.js, which doesn't always run for pre-existing legacy orphans).
            // The listener can't drop it on its own — sprint_task_index is server-write-only —
            // so hide it here instead of leaving a row that silently swallows every edit.
            // Confirmed live 2026-07-23: TK-OO1ZBB's index row pointed at a tasks/{id} doc that
            // no longer exists, throwing not-found on every inline edit.
            if (err?.code === 'not-found') {
                console.warn(`[SprintTriageTable] save ${collection_}/${id} skipped — doc no longer exists (stale index row); hiding it`);
                setHiddenRowIds((prev) => new Set(prev).add(id));
                return;
            }
            // Legacy guardrail: docs with a missing/mismatched ownerUid can fail Firestore's
            // update rule even though the null-owner fallback usually covers it (e.g. a real
            // mismatched, non-null owner from an old writer). Retry once after claiming
            // ownership — same pattern handleDelete already uses in this file — before giving
            // up and surfacing the failure. Previously this swallowed silently (no .catch on
            // any call site), so an inline status/field edit could fail and just revert with
            // zero feedback. Confirmed by Jim, 2026-07-23: marking a task Done on the Kanban
            // table view "doesn't change" — this was a silent write failure, not a rendering bug.
            if (currentUser?.uid) {
                try {
                    await updateDoc(doc(db, collection_, id), { ...updates, ownerUid: currentUser.uid, updatedAt: serverTimestamp() });
                    return;
                } catch (retryErr: any) {
                    console.error(`[SprintTriageTable] save ${collection_}/${id} failed`, retryErr);
                    alert(`Failed to save change: ${retryErr?.message || 'permission denied'}`);
                    return;
                }
            }
            console.error(`[SprintTriageTable] save ${collection_}/${id} failed`, err);
            alert(`Failed to save change: ${err?.message || 'permission denied'}`);
        } finally {
            rmSaving(id);
        }
    };

    const commitEdit = (item: Story | Task, type: RowType, valueOverride?: string) => {
        if (!editCell) return;
        const col = type === 'story' ? 'stories' : 'tasks';
        const { field } = editCell;
        const val = valueOverride ?? editVal;
        let updates: Record<string, any> = {};
        if (field === 'title') updates.title = val.trim();
        else if (field === 'description') updates.description = val.trim();
        else if (field === 'acceptanceCriteria') {
            updates.acceptanceCriteria = val.split('\n').map((c) => c.trim()).filter(Boolean);
        } else if (field === 'points') {
            // Clamp to the entity's own ceiling and the 0.25 step, same as the edit modals —
            // a raw number typed here would otherwise bypass every points rule in the app.
            const parsed = parsePointsValue(val);
            if (parsed == null) { setEditCell(null); setEditVal(''); return; }
            updates.points = normalizePointsValue(parsed, {
                max: type === 'story' ? STORY_POINTS_MAX : TASK_POINTS_MAX,
            });
        }
        else if (field === 'status') updates.status = Number(val);
        else if (field === 'dueDate') updates.dueDate = parseDateMs(val);
        else if (field === 'sprintId') updates.sprintId = val || null;
        else if (field === 'goalId') {
            // resolve typed title back to an id
            const match = goals.find(g => g.id === val || g.title === val);
            updates.goalId = match ? match.id : (val || null);
        } else if (field === 'parentId') {
            const match = sprintStories.find(s => s.id === val || s.title === val);
            updates.parentId = match ? match.id : (val || null);
        } else return;
        if (Object.keys(updates).length) saveItem(item.id, col as any, updates);
        setEditCell(null); setEditVal('');
    };

    const startEdit = (id: string, field: string, val: string) => { setEditCell({ id, field }); setEditVal(val); };
    const cancelEdit = () => { setEditCell(null); setEditVal(''); };

    /** Notes are activity_stream entries, not fields on the doc, so they do not go through
     *  commitEdit/saveItem — nothing on stories/{id} changes. */
    const commitNote = async (item: Story | Task, type: RowType) => {
        const text = editVal.trim();
        setEditCell(null);
        setEditVal('');
        if (!text || !currentUser?.uid) return;
        setSavingNote(item.id);
        try {
            await ActivityStreamService.addNote(
                item.id,
                type,
                text,
                currentUser.uid,
                currentUser.email || undefined,
                String((item as any).persona || 'personal'),
                (item as any).ref || undefined,
                'human',
            );
        } catch (err: any) {
            console.error('[SprintTriageTable] add note failed', err);
            alert(`Failed to add note: ${err?.message || 'permission denied'}`);
        } finally {
            setSavingNote(null);
        }
    };

    const handleConvert = async (task: Task) => {
        setConverting(task.id);
        try {
            const resp: any = await httpsCallable(functions, 'convertTasksToStories')({
                conversions: [{ taskId: task.id, storyTitle: task.title || '', storyDescription: (task as any).description || '', goalId: (task as any).goalId || null }]
            });
            const c = (resp?.data?.created || resp?.data?.stories || resp?.data?.results || [])[0] || {};
            if (c.storyId || c.id) {
                const sid = c.storyId || c.id;
                await updateDoc(doc(db, 'stories', sid), { status: 1, updatedAt: serverTimestamp() });
                await updateDoc(doc(db, 'tasks', task.id), { status: 2, convertedToStoryId: sid, updatedAt: serverTimestamp() });
                const ref = c.storyRef || c.ref || c.reference;
                if (ref) setConvertedStory({ ref, id: sid });
            }
        } catch (e: any) { alert(e?.message || 'Convert failed'); }
        finally { setConverting(null); }
    };

    const handleDelete = async (id: string, type: RowType) => {
        if (!window.confirm(`Delete this ${type}? Cannot be undone.`)) return;
        const col = type === 'story' ? 'stories' : 'tasks';
        addSaving(id);
        try {
            // Claim ownership first so docs without ownerUid can be deleted. This is a
            // best-effort step: if the doc is already gone the claim throws not-found, and the
            // old code bailed out of the whole function on that error — so a row backed by an
            // orphaned sprint_task_index entry could never be removed, and the Delete button
            // looked broken. Swallow the claim failure and still attempt the delete.
            if (currentUser?.uid) {
                try {
                    await updateDoc(doc(db, col, id), { ownerUid: currentUser.uid, updatedAt: serverTimestamp() });
                } catch (claimErr: any) {
                    if (claimErr?.code !== 'not-found') throw claimErr;
                }
            }
            await deleteDoc(doc(db, col, id));
            setHiddenRowIds((prev) => new Set(prev).add(id));
        } catch (err: any) {
            // Already gone (e.g. a stale index row pointing at a deleted doc) — the underlying
            // doc is deleted as far as the user is concerned, so drop the row from the table.
            if (err?.code === 'not-found') {
                setHiddenRowIds((prev) => new Set(prev).add(id));
                return;
            }
            console.error(`[SprintTriageTable] delete ${type} failed`, err);
            alert(`Failed to delete ${type}: ${err?.message || 'permission denied'}`);
        } finally {
            rmSaving(id);
        }
    };

    /** Actions (180) plus whatever data columns are on, so hiding columns actually narrows
     *  the table instead of leaving it padded out to the full 15-column width. */
    const visibleMinWidth = useMemo(
        () => 180 + TRIAGE_COLUMNS.filter(c => visibleColumns.has(c.key)).reduce((sum, c) => sum + c.minWidth, 0),
        [visibleColumns],
    );

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    };

    // Merged sorted rows
    const rows = useMemo(() => {
        const all = [
            ...sprintStories
                .filter(s => !hideDone || !isDone(Number((s as any).status ?? 0), 'story'))
                .map(s => ({ item: s as Story | Task, rowType: 'story' as RowType })),
            ...sprintTasks
                .filter(t => !hideDone || !isDone(Number((t as any).status ?? 0), 'task'))
                .map(t => ({ item: t as Story | Task, rowType: 'task' as RowType })),
        ];
        return [...all].sort((a, b) => {
            let av: string | number = '', bv: string | number = '';
            if (sortKey === 'type') { av = a.rowType; bv = b.rowType; }
            else if (sortKey === 'ref') { av = itemRef(a.item, a.rowType); bv = itemRef(b.item, b.rowType); }
            else if (sortKey === 'title') { av = a.item.title || ''; bv = b.item.title || ''; }
            else if (sortKey === 'status') { av = Number((a.item as any).status ?? 0); bv = Number((b.item as any).status ?? 0); }
            else if (sortKey === 'ai') { av = Number((a.item as any).aiCriticalityScore ?? -1); bv = Number((b.item as any).aiCriticalityScore ?? -1); }
            else if (sortKey === 'dueDate') { av = fmtDate((a.item as any).dueDate); bv = fmtDate((b.item as any).dueDate); }
            else if (sortKey === 'createdAt') {
                // createdAt is a Timestamp/Date/millis, none of which compare correctly as the
                // strings this comparator otherwise works in.
                return compareTimestamps((a.item as any).createdAt, (b.item as any).createdAt, sortDir === 'asc' ? 1 : -1);
            }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        // hideDone must be a dependency: it's read inside the filter above, but wasn't listed
        // here, so toggling "Showing active only" (or a status edit that flips a row across the
        // hide/show boundary, e.g. marking a task Done) never recomputed this memo — the row just
        // silently stayed as it was. Root cause of "marking a task Done on Kanban doesn't change
        // anything." Confirmed by Jim, 2026-07-23.
    }, [sprintStories, sprintTasks, sortKey, sortDir, hideDone]);

    // Render helpers
    /** Text arrows shown only on the active column — same indicator ModernStoriesTable uses,
     *  rather than this table's previous lucide chevrons. Per Jim, 2026-08-05. */
    const SortIcon = ({ col }: { col: SortKey }) =>
        sortKey !== col ? null :
        <span style={{ fontSize: '10px', color: themeVars.text as string }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;

    const TH = ({ label, col, style }: { label: string; col?: SortKey; style?: React.CSSProperties }) => (
        <th
            style={{ ...TH_BASE, color: themeVars.muted as string, backgroundColor: themeVars.card as string, ...style, cursor: col ? 'pointer' : 'default' }}
            onClick={col ? () => handleSort(col) : undefined}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {label}{col && <SortIcon col={col} />}
            </span>
        </th>
    );

    /** `wrap` renders the value over as many lines as it needs instead of clipping it to one
     *  with an ellipsis. Titles and acceptance criteria use it — the point of this table is
     *  triage, and a truncated title you have to hover to read defeats that. Confirmed by
     *  Jim, 2026-08-03. */
    const inlineText = (
        item: Story | Task, type: RowType, field: string, val: string,
        multiline = false, wrap = false, rows = 2,
    ) => {
        const editing = editCell?.id === item.id && editCell?.field === field;
        if (editing) {
            const shared = {
                autoFocus: true as boolean,
                value: editVal,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEditVal(e.target.value),
                onBlur: () => commitEdit(item, type),
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commitEdit(item, type); }
                    if (e.key === 'Escape') cancelEdit();
                },
                style: { fontSize: 13, padding: '2px 6px', width: '100%' },
                className: 'form-control form-control-sm',
            };
            return multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} />;
        }
        return (
            <span
                onClick={() => startEdit(item.id, field, val)}
                style={wrap
                    ? { cursor: 'text', display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.35 }
                    : { cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={wrap ? undefined : (val || '—')}
            >
                {val || <span style={{ color: themeVars.muted as string }}>—</span>}
            </span>
        );
    };

    /** Missing-data shading, same red as ModernStoriesTable's data-quality columns so the two
     *  surfaces mean the same thing by the same colour. Applied per cell, not per row: the
     *  point is to show WHICH field is missing at a glance. */
    const missingBg = (isMissing: boolean, isHovered: boolean): string | undefined => {
        if (!isMissing) return undefined;
        return isHovered ? MISSING_INFO_CELL_BG_HOVER : MISSING_INFO_CELL_BG;
    };

    /** A story's parent is its goal; a task's is its story. Either way, unparented work is
     *  work nothing will roll up — which is what the shading is flagging. */
    const hasParent = (item: Story | Task, type: RowType): boolean => {
        const id = type === 'story'
            ? (item as any).goalId
            : ((item as any).parentId || (item as any).storyId);
        return String(id || '').trim().length > 0;
    };

    /** Acceptance criteria are stored as string[] on stories (tasks carry them only when a
     *  writer has set the same field). Edited as one criterion per line, which is how they
     *  read, and stored back as the array the rest of the app expects. */
    const acceptanceCriteriaLines = (item: Story | Task): string[] => {
        const raw = (item as any).acceptanceCriteria;
        if (Array.isArray(raw)) return raw.map((c) => String(c).trim()).filter(Boolean);
        if (typeof raw === 'string') return raw.split('\n').map((c) => c.trim()).filter(Boolean);
        return [];
    };

    const acceptanceCriteriaCell = (item: Story | Task, type: RowType) => {
        const lines = acceptanceCriteriaLines(item);
        const editing = editCell?.id === item.id && editCell?.field === 'acceptanceCriteria';
        if (editing) {
            return inlineText(item, type, 'acceptanceCriteria', lines.join('\n'), true, true, Math.min(8, Math.max(3, lines.length + 1)));
        }
        if (lines.length === 0) {
            return (
                <span
                    onClick={() => startEdit(item.id, 'acceptanceCriteria', '')}
                    style={{ cursor: 'text', color: themeVars.muted as string, display: 'block' }}
                >
                    —
                </span>
            );
        }
        return (
            <ul
                onClick={() => startEdit(item.id, 'acceptanceCriteria', lines.join('\n'))}
                style={{ cursor: 'text', margin: 0, paddingLeft: 16, lineHeight: 1.35, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            >
                {lines.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
            </ul>
        );
    };

    // Always-live select rather than a click-to-edit cell. The old version rendered a chip
    // that swapped to a <select> on click, with onBlur={cancelEdit}: on Safari the blur fired
    // before the change event, so cancelEdit() unmounted the select and the change never
    // committed — "marking a task Done on the Kanban table does nothing". Confirmed by Jim,
    // 2026-07-28. A permanently-mounted select has no edit mode to lose.
    const inlineStatus = (item: Story | Task, type: RowType) => {
        const raw = (item as any).status;
        const value = canonicalStatusValue(raw, type);
        const col = statusColor(value, type);
        // No chip fill in any lane — the cell behind this is shaded by lane instead, so a
        // filled box on top of it would just be a second, smaller box saying the same thing.
        // Still a select, so it stays editable; the caret is what signals that. Per Jim,
        // 2026-08-03 (first "no box on in progress", then lane shading on the cell).
        return (
            <select
                className="form-select form-select-sm"
                value={value}
                disabled={saving.has(item.id)}
                onChange={(e) => {
                    const next = Number(e.target.value);
                    if (next === canonicalStatusValue(raw, type)) return;
                    saveItem(item.id, type === 'story' ? 'stories' : 'tasks', { status: next });
                }}
                title={statusLabel(raw, type)}
                style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 6px', width: 'auto', minWidth: 104,
                    color: col,
                    // Longhands, not `border: 'none'` — jsdom's CSS engine silently drops that
                    // shorthand, so the style would be untestable (and the test that caught it
                    // would have been asserting against a rule that never rendered).
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    borderStyle: 'none',
                    boxShadow: 'none',
                    paddingLeft: 0,
                }}
            >
                {statusOptions(type).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        );
    };

    /**
     * Criticality — the human-set `priority` field (4 Critical … 1 Low), not the AI's computed
     * `aiCriticalityScore`, which is a 0–100 number the model owns and the AI column shows
     * read-only. Stored values are a mix of ints, 'P1'-style strings and words, so the current
     * value goes through normalizePriorityValue before it can select an option.
     */
    const PRIORITY_OPTIONS = [
        { value: 4, label: 'Critical', color: '#dc3545' },
        { value: 3, label: 'High', color: '#fd7e14' },
        { value: 2, label: 'Medium', color: '#0d6efd' },
        { value: 1, label: 'Low', color: themeVars.muted as string },
        { value: 0, label: 'None', color: themeVars.muted as string },
    ];

    const inlinePriority = (item: Story | Task, type: RowType) => {
        const value = normalizePriorityValue((item as any).priority);
        const opt = PRIORITY_OPTIONS.find((o) => o.value === value) || PRIORITY_OPTIONS[4];
        return (
            <select
                className="form-select form-select-sm"
                value={opt.value}
                disabled={saving.has(item.id)}
                onChange={(e) => saveItem(item.id, type === 'story' ? 'stories' : 'tasks', { priority: Number(e.target.value) })}
                title={`Criticality (priority): ${opt.label}`}
                style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 6px', width: 'auto', minWidth: 92,
                    backgroundColor: opt.color + '22', color: opt.color, borderColor: opt.color + '44',
                }}
            >
                {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        );
    };

    /** Points cap differs by entity — a task tops out at 8, a story at 13 (utils/points). */
    const inlinePoints = (item: Story | Task, type: RowType) => {
        const editing = editCell?.id === item.id && editCell?.field === 'points';
        const raw = (item as any).points;
        const display = raw == null || raw === '' ? '' : String(raw);
        if (editing) {
            return (
                <input
                    autoFocus
                    type="number"
                    min={0}
                    max={type === 'story' ? STORY_POINTS_MAX : TASK_POINTS_MAX}
                    step={POINTS_STEP}
                    className="form-control form-control-sm"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(item, type)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitEdit(item, type); }
                        if (e.key === 'Escape') cancelEdit();
                    }}
                    style={{ fontSize: 12, padding: '2px 4px', width: 64 }}
                />
            );
        }
        return (
            <span
                onClick={() => startEdit(item.id, 'points', display)}
                style={{ cursor: 'text', display: 'block', fontSize: 12, fontWeight: 600 }}
                title="Points"
            >
                {display || <span style={{ color: themeVars.muted as string, fontWeight: 400 }}>—</span>}
            </span>
        );
    };

    const inlineTimeOfDay = (item: Story | Task, type: RowType) => (
        <select
            className="form-select form-select-sm"
            value={String((item as any).timeOfDay || '')}
            disabled={saving.has(item.id)}
            onChange={(e) => saveItem(item.id, type === 'story' ? 'stories' : 'tasks', { timeOfDay: e.target.value || null })}
            title="Time of day — the planner uses this when placing calendar blocks"
            style={{ fontSize: 11, padding: '2px 4px', width: 'auto', minWidth: 96 }}
        >
            <option value="">Any time</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
        </select>
    );

    const inlineSprintSelect = (item: Story | Task, type: RowType) => (
        <select
            value={(item as any).sprintId || ''}
            onChange={e => saveItem(item.id, type === 'story' ? 'stories' : 'tasks', { sprintId: e.target.value || null })}
            style={{ width: '100%', minWidth: 110, padding: '3px 6px', borderRadius: 4, border: `1px solid ${themeVars.border}`, backgroundColor: backgrounds.surface, color: themeVars.text as string, fontSize: 12 }}
        >
            <option value="">No sprint</option>
            {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
    );

    // Parent cell: goal for stories, story for tasks — searchable datalist + hyperlink + progress
    const parentCell = (item: Story | Task, type: RowType) => {
        const editing = (id: string, field: string) => editCell?.id === id && editCell?.field === field;

        if (type === 'story') {
            const goalId = (item as any).goalId || '';
            const goal = goals.find(g => g.id === goalId); // search ALL goals, not just active
            const field = 'goalId';

            if (editing(item.id, field)) {
                const listId = `goal-dl-${item.id}`;
                return (
                    <div>
                        <input
                            autoFocus
                            list={listId}
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={() => commitEdit(item, type)}
                            onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter') commitEdit(item, type); }}
                            placeholder="Search goals…"
                            style={{ width: '100%', padding: '3px 6px', fontSize: 12, border: `2px solid ${themeVars.brand}`, borderRadius: 4, backgroundColor: backgrounds.surface, color: themeVars.text as string, outline: 'none' }}
                        />
                        <datalist id={listId}>
                            {goalOptions.map(g => <option key={g.id} value={g.label} />)}
                        </datalist>
                    </div>
                );
            }

            const prog = goal ? goalProgress(goal.id) : null;
            const goalLabel = goal ? `${goal.ref ? goal.ref + ' — ' : ''}${goal.title}` : '';
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
                    {goal ? (
                        <>
                            <button
                                type="button"
                                style={{ border: 'none', background: 'none', color: themeVars.brand as string, padding: 0, fontSize: 12, fontWeight: 500, cursor: 'pointer', textDecoration: 'underline', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                                title={goal.title}
                                onClick={(e) => { e.stopPropagation(); navigate(`/goals/${goal.id}`); }}
                            >
                                {goalLabel}
                            </button>
                            <button
                                type="button"
                                style={{ ...abtn(themeVars.muted as string), padding: 0 }}
                                title="Open goal"
                                onClick={(e) => { e.stopPropagation(); navigate(`/goals/${goal.id}`); }}
                            >
                                <ExternalLink size={12} />
                            </button>
                        </>
                    ) : goalId ? (
                        <span style={{ color: themeVars.muted as string, fontSize: 12, fontStyle: 'italic' }} title={`Goal ID: ${goalId}`}>Unknown goal</span>
                    ) : (
                        <span style={{ color: themeVars.muted as string, fontSize: 12 }}>Unassigned</span>
                    )}
                    {prog && (
                        <span style={{ fontSize: 10, color: prog.pct === 100 ? '#198754' : themeVars.muted as string, whiteSpace: 'nowrap' }}>
                            ({prog.done}/{prog.total} · {prog.pct}%)
                        </span>
                    )}
                    <button style={{ ...abtn(themeVars.muted as string), padding: 2 }} title="Change goal" onClick={() => startEdit(item.id, field, goal?.title || '')}>
                        <Pencil size={10} />
                    </button>
                </div>
            );
        } else {
            // Task: parent story
            const parentId = (item as any).parentId || (item as any).storyId || '';
            const parentStory = sprintStories.find(s => s.id === parentId) || stories.find(s => s.id === parentId);
            const field = 'parentId';

            if (editing(item.id, field)) {
                const listId = `story-dl-${item.id}`;
                return (
                    <div>
                        <input
                            autoFocus
                            list={listId}
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={() => commitEdit(item, type)}
                            onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter') commitEdit(item, type); }}
                            placeholder="Search stories…"
                            style={{ width: '100%', padding: '3px 6px', fontSize: 12, border: `2px solid ${themeVars.brand}`, borderRadius: 4, backgroundColor: backgrounds.surface, color: themeVars.text as string, outline: 'none' }}
                        />
                        <datalist id={listId}>
                            {storyOptions.map(s => <option key={s.id} value={s.label} />)}
                        </datalist>
                    </div>
                );
            }

            const prog = parentStory ? storyProgress(parentStory.id) : null;
            const storyLabel = parentStory ? ((parentStory as any).ref || parentStory.title.slice(0, 24)) : '';
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
                    {parentStory ? (
                        <>
                            <button
                                type="button"
                                style={{ border: 'none', background: 'none', color: themeVars.brand as string, padding: 0, fontSize: 12, fontWeight: 500, cursor: 'pointer', textDecoration: 'underline', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                                title={parentStory.title}
                                onClick={(e) => { e.stopPropagation(); navigate(`/stories/${parentStory.id}`); }}
                            >
                                {storyLabel}
                            </button>
                            <button
                                type="button"
                                style={{ ...abtn(themeVars.muted as string), padding: 0 }}
                                title="Open story"
                                onClick={(e) => { e.stopPropagation(); navigate(`/stories/${parentStory.id}`); }}
                            >
                                <ExternalLink size={12} />
                            </button>
                        </>
                    ) : parentId ? (
                        <span style={{ color: themeVars.muted as string, fontSize: 12, fontStyle: 'italic' }} title={`Story ID: ${parentId}`}>Unknown story</span>
                    ) : (
                        <span style={{ color: themeVars.muted as string, fontSize: 12 }}>Unassigned</span>
                    )}
                    {prog && (
                        <span style={{ fontSize: 10, color: prog.pct === 100 ? '#198754' : themeVars.muted as string, whiteSpace: 'nowrap' }}>
                            ({prog.done}/{prog.total} · {prog.pct}%)
                        </span>
                    )}
                    <button style={{ ...abtn(themeVars.muted as string), padding: 2 }} title="Change story" onClick={() => startEdit(item.id, field, parentStory?.title || '')}>
                        <Pencil size={10} />
                    </button>
                </div>
            );
        }
    };

    /**
     * Last note, and a way to add one without leaving the table.
     *
     * Writes through ActivityStreamService.addNote rather than addDoc'ing activity_stream
     * directly: that service sets `ownerUid` from userId (Firestore rules require it on create)
     * and the `note_added` / `noteContent` shape this table's own listener queries for. A
     * hand-rolled write that missed either would save without error and then never appear.
     *
     * No local state for the result — the existing activity_stream subscription picks the new
     * note up and re-renders the cell.
     */
    const noteCell = (item: Story | Task, type: RowType) => {
        const note = latestNotes[item.id];
        const editing = editCell?.id === item.id && editCell?.field === 'note';

        if (editing) {
            return (
                <textarea
                    autoFocus
                    rows={2}
                    className="form-control form-control-sm"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={() => commitNote(item, type)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitNote(item, type); }
                        if (e.key === 'Escape') cancelEdit();
                    }}
                    placeholder="Add a note… ⌘/Ctrl+Enter to save"
                    style={{ fontSize: 12, padding: '2px 6px', width: '100%' }}
                />
            );
        }

        return (
            <div
                onClick={() => startEdit(item.id, 'note', '')}
                style={{ cursor: 'text', display: 'flex', alignItems: 'flex-start', gap: 4 }}
                title={note || 'Add a note'}
            >
                {note ? (
                    <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.35 }}>{note}</span>
                ) : (
                    <span style={{ color: themeVars.muted as string, display: 'inline-flex', alignItems: 'center', gap: 3, fontStyle: 'italic' }}>
                        <MessageSquarePlus size={12} /> Add note
                    </span>
                )}
                {savingNote === item.id && <Spinner animation="border" size="sm" style={{ width: 10, height: 10, flexShrink: 0 }} />}
            </div>
        );
    };

    const actionCell = (item: Story | Task, type: RowType) => {
        const isConverting = converting === item.id;
        const isFlaggingPriority = flaggingPriorityId === item.id;
        const manualRank = type === 'story' ? getManualPriorityRank(item) : null;
        const manualLabel = type === 'story' ? getManualPriorityLabel(item) : null;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button style={abtn()} title="Activity stream" onClick={() => showSidebar(item, type)}>
                    <Activity size={15} />
                </button>
                {type === 'story' ? (
                    <>
                        <button style={abtn()} title="AI: Generate tasks"
                            onClick={async () => {
                                try { await httpsCallable(functions, 'orchestrateStoryPlanning')({ storyId: item.id }); }
                                catch (e: any) { alert(e?.message || 'Failed'); }
                            }}>
                            <Wand2 size={15} />
                        </button>
                        <button
                            style={{ ...abtn(manualRank ? '#dc3545' : (themeVars.muted as string)), opacity: isFlaggingPriority ? 0.5 : 1, minWidth: 22, fontWeight: 800, fontSize: 11 }}
                            title={manualRank ? `Remove ${manualLabel || 'manual priority'}` : 'Set manual priority'}
                            disabled={isFlaggingPriority}
                            onClick={() => handleFlagPriority(item as Story)}
                        >
                            {isFlaggingPriority ? <Spinner animation="border" size="sm" style={{ width: 11, height: 11 }} /> : (manualRank || 1)}
                        </button>
                    </>
                ) : (
                    <button style={abtn(isConverting ? (themeVars.muted as string) : (themeVars.brand as string))}
                        title={isConverting ? 'Converting…' : 'Convert to story'}
                        disabled={isConverting}
                        onClick={() => handleConvert(item as Task)}>
                        {isConverting ? <Spinner animation="border" size="sm" style={{ width: 13, height: 13 }} /> : <Wand2 size={15} />}
                    </button>
                )}
                <button style={abtn()} title="Defer" onClick={() => setDeferItem({ id: item.id, type, title: item.title || '' })}>
                    <Clock3 size={15} />
                </button>
                <button style={abtn()} title="Open" onClick={() => navigate(`/${type === 'story' ? 'stories' : 'tasks'}/${item.id}`)}>
                    <ExternalLink size={15} />
                </button>
                <button style={abtn(themeVars.brand as string)} title="Edit" onClick={() => type === 'story' ? onEditStory(item as Story) : onEditTask(item as Task)}>
                    <Pencil size={15} />
                </button>
                <button style={abtn('#dc3545')} title="Delete" onClick={() => handleDelete(item.id, type)}>
                    <Trash2 size={15} />
                </button>
                {saving.has(item.id) && <Spinner animation="border" size="sm" style={{ width: 12, height: 12 }} />}
            </div>
        );
    };

    return (
        <>
            {/* Same affordance and wording as the Modern tables' Configure Table button, so
                column visibility is found in the same place on every table surface. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                    type="button"
                    onClick={() => setShowConfig(v => !v)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        fontSize: 12,
                        borderRadius: 6,
                        border: `1px solid ${showConfig ? themeVars.brand : themeVars.border}`,
                        background: showConfig ? (themeVars.card as string) : 'transparent',
                        color: themeVars.text as string,
                        cursor: 'pointer',
                    }}
                >
                    <Settings size={14} />
                    {showConfig ? 'Hide Columns' : 'Columns'}
                </button>
            </div>

            {showConfig && (
                <div style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${themeVars.border}`,
                    backgroundColor: themeVars.panel as string,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                }}>
                    {TRIAGE_COLUMNS.map(column => {
                        const visible = show(column.key);
                        return (
                            <button
                                key={column.key}
                                type="button"
                                onClick={() => toggleColumn(column.key)}
                                aria-pressed={visible}
                                // The visible text is just the column name; on its own it does
                                // not say that pressing it toggles anything, or which way.
                                aria-label={visible ? `Hide ${column.label}` : `Show ${column.label}`}
                                title={visible ? `Hide ${column.label}` : `Show ${column.label}`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    borderRadius: 999,
                                    border: `1px solid ${visible ? themeVars.brand : themeVars.border}`,
                                    background: 'transparent',
                                    color: visible ? (themeVars.text as string) : (themeVars.muted as string),
                                    cursor: 'pointer',
                                }}
                            >
                                {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                                {column.label}
                            </button>
                        );
                    })}
                </div>
            )}

            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '70vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: visibleMinWidth }}>
                    {/* Matches ModernStoriesTable's header rule, which this table was missing. */}
                    <thead style={{ borderBottom: `1px solid ${themeVars.border}` }}>
                        <tr>
                            {TRIAGE_COLUMNS.filter(c => show(c.key)).map(c => (
                                <TH
                                    key={c.key}
                                    label={c.label}
                                    col={c.sortKey}
                                    style={{
                                        minWidth: c.minWidth,
                                        ...(c.key === 'acceptanceCriteria' ? { whiteSpace: 'normal' } : null),
                                    }}
                                />
                            ))}
                            <TH label="Actions" style={{ minWidth: 180, cursor: 'default' }} />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={visibleColumns.size + 1} style={{ padding: 32, textAlign: 'center', color: themeVars.muted as string, fontSize: 13 }}>
                                    No stories or tasks in this sprint.
                                </td>
                            </tr>
                        )}
                        {rows.map(({ item, rowType }) => {
                            const isHovered = hovered === item.id;
                            const bg = isHovered ? (themeVars.card as string) : backgrounds.surface;
                            const aiScore = (item as any).aiCriticalityScore;
                            const hasAcceptanceCriteria = acceptanceCriteriaLines(item).length > 0;
                            return (
                                <tr key={item.id}
                                    style={{ backgroundColor: bg, transition: 'background-color 0.1s', borderBottom: `1px solid ${themeVars.border}` }}
                                    onMouseEnter={() => setHovered(item.id)}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    {/* Type */}
                                    {show('type') && (
                                    <td style={TD}>
                                        <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', backgroundColor: rowType === 'story' ? '#0d6efd22' : '#6c757d22', color: rowType === 'story' ? '#0d6efd' : '#6c757d' }}>
                                            {rowType === 'story' ? 'Story' : ((item as any).type || 'Task')}
                                        </span>
                                    </td>
                                    )}
                                    {/* Ref — opens the same edit modal as the row's Edit action,
                                        rather than navigating to a separate page. Confirmed by
                                        Jim, 2026-07-23: clicking the ref should stay on this page. */}
                                    {show('ref') && (
                                    <td style={{ ...TD, fontFamily: 'monospace', fontSize: 13 }}>
                                        <button
                                            type="button"
                                            onClick={() => rowType === 'story' ? onEditStory(item as Story) : onEditTask(item as Task)}
                                            style={{ background: 'none', border: 'none', padding: 0, color: themeVars.brand as string, textDecoration: 'none', cursor: 'pointer', font: 'inherit' }}
                                        >
                                            {itemRef(item, rowType)}
                                        </button>
                                    </td>
                                    )}
                                    {/* Title — wrapped, so the whole thing is readable without
                                        hovering for a tooltip. Vertically centred: acceptance
                                        criteria make rows tall, and a short title pinned to the
                                        top of a five-line row reads as belonging to nothing. */}
                                    {show('title') && (
                                    <td style={{ ...TD, maxWidth: 320, fontWeight: 500, verticalAlign: 'middle' }}>
                                        {inlineText(item, rowType, 'title', item.title || '', false, true)}
                                    </td>
                                    )}
                                    {/* Parent + progress — shaded when nothing parents this row,
                                        because unparented work rolls up to nothing. */}
                                    {show('parent') && (
                                    <td style={{ ...TD, minWidth: 180, verticalAlign: 'top', backgroundColor: missingBg(!hasParent(item, rowType), isHovered) }}>
                                        {parentCell(item, rowType)}
                                    </td>
                                    )}
                                    {/* Description — centred with the title, same reasoning. */}
                                    {show('description') && (
                                    <td style={{ ...TD, maxWidth: 240, color: themeVars.muted as string, verticalAlign: 'middle' }}>
                                        {inlineText(item, rowType, 'description', (item as any).description || '', true, true, 3)}
                                    </td>
                                    )}
                                    {/* Acceptance criteria — wrapped bullet list, click to edit
                                        (one criterion per line). Shaded when there are none. */}
                                    {show('acceptanceCriteria') && (
                                    <td style={{ ...TD, maxWidth: 340, fontSize: 13, verticalAlign: 'top', backgroundColor: missingBg(!hasAcceptanceCriteria, isHovered) }}>
                                        {acceptanceCriteriaCell(item, rowType)}
                                    </td>
                                    )}
                                    {/* Status — cell shaded by lane (grey backlog, green in
                                        progress, blue complete) so the column can be scanned
                                        without reading it. */}
                                    {show('status') && (
                                    <td style={{ ...TD, verticalAlign: 'top', backgroundColor: statusCellBg(canonicalStatusValue((item as any).status, rowType), rowType) }}>
                                        {inlineStatus(item, rowType)}
                                    </td>
                                    )}
                                    {/* Criticality — the human-set priority, next to Status.
                                        Distinct from the AI column, which is the model's
                                        computed 0–100 score. */}
                                    {show('criticality') && (
                                    <td style={{ ...TD, verticalAlign: 'top' }}>{inlinePriority(item, rowType)}</td>
                                    )}
                                    {/* AI score */}
                                    {show('ai') && (
                                    <td style={{ ...TD, textAlign: 'center', minWidth: 50, verticalAlign: 'top' }}>
                                        {aiScore != null ? (
                                            <span style={{ fontSize: 13, fontWeight: 600, color: aiScore >= 70 ? '#dc3545' : aiScore >= 40 ? '#fd7e14' : themeVars.muted as string }}>
                                                {aiScore}
                                            </span>
                                        ) : <span style={{ color: themeVars.muted as string, fontSize: 12 }}>—</span>}
                                    </td>
                                    )}
                                    {/* Points */}
                                    {show('points') && (
                                    <td style={{ ...TD, minWidth: 70, verticalAlign: 'top' }}>
                                        {inlinePoints(item, rowType)}
                                    </td>
                                    )}
                                    {/* Due */}
                                    {show('dueDate') && (
                                    <td style={{ ...TD, minWidth: 90, verticalAlign: 'top' }}>
                                        {inlineText(item, rowType, 'dueDate', fmtDate((item as any).dueDate))}
                                    </td>
                                    )}
                                    {/* Time of day */}
                                    {show('timeOfDay') && (
                                    <td style={{ ...TD, minWidth: 100, verticalAlign: 'top' }}>
                                        {inlineTimeOfDay(item, rowType)}
                                    </td>
                                    )}
                                    {/* Sprint */}
                                    {show('sprint') && (
                                    <td style={{ ...TD, minWidth: 130, verticalAlign: 'top' }}>
                                        {inlineSprintSelect(item, rowType)}
                                    </td>
                                    )}
                                    {/* Last note — click to add one, written straight to the
                                        activity stream. */}
                                    {show('note') && (
                                    <td style={{ ...TD, maxWidth: 240, color: themeVars.muted as string, fontSize: 13, verticalAlign: 'top' }}>
                                        {noteCell(item, rowType)}
                                    </td>
                                    )}
                                    {/* Created — read-only, written once by Firestore. */}
                                    {show('createdAt') && (
                                    <td style={{ ...TD, minWidth: 140, verticalAlign: 'top', color: themeVars.muted as string, whiteSpace: 'nowrap' }}>
                                        {formatTimestampCell((item as any).createdAt)
                                            || <span style={{ color: themeVars.muted as string }}>—</span>}
                                    </td>
                                    )}
                                    {/* Actions */}
                                    <td style={{ ...TD, minWidth: 180, whiteSpace: 'nowrap' }}>
                                        {actionCell(item, rowType)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: themeVars.muted as string, display: 'flex', alignItems: 'center', gap: 16 }}>
                <button
                    onClick={() => setHideDone(h => !h)}
                    style={{
                        padding: '3px 10px',
                        borderRadius: 6,
                        border: `1px solid ${themeVars.border}`,
                        background: hideDone ? (themeVars.card as string) : 'transparent',
                        color: themeVars.text as string,
                        fontSize: 12,
                        cursor: 'pointer',
                        fontWeight: hideDone ? 600 : 400,
                    }}
                >
                    {hideDone ? 'Showing active only' : 'Showing all incl. done'}
                </button>
                <span>{sprintStories.length} {sprintStories.length === 1 ? 'story' : 'stories'} · {sprintTasks.length} {sprintTasks.length === 1 ? 'task' : 'tasks'} · {rows.length} shown</span>
                {convertedStory && (
                    <span style={{ color: '#198754' }}>
                        Story created: <a href={`${BASE_URL}/stories/${convertedStory.id}`} target="_blank" rel="noreferrer" style={{ color: '#198754' }}>{convertedStory.ref} →</a>
                        {' '}<button style={{ fontSize: 11, background: 'none', border: 'none', color: themeVars.muted as string, cursor: 'pointer', padding: 0 }} onClick={() => setConvertedStory(null)}>✕</button>
                    </span>
                )}
            </div>

            {deferItem && (
                <DeferItemModal
                    show
                    onHide={() => setDeferItem(null)}
                    itemType={deferItem.type}
                    itemId={deferItem.id}
                    itemTitle={deferItem.title}
                    allowAdvancedSearch
                    onApply={async payload => {
                        await applyPlannerDefer({
                            itemType: deferItem.type,
                            item: deferItem.type === 'story'
                                ? (sprintStories.find(s => s.id === deferItem.id) as any)
                                : (sprintTasks.find(t => t.id === deferItem.id) as any),
                            payload,
                            sourceFallback: 'sprint_triage_table',
                            linkedBlockId: null,
                            durationMinutes: null,
                        });
                        setDeferItem(null);
                    }}
                />
            )}
        </>
    );
};

export default SprintTriageTable;

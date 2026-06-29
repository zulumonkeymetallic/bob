import React, { useState, useEffect, useMemo } from 'react';
import { Spinner } from 'react-bootstrap';
import { Activity, Clock3, Wand2, Pencil, Trash2, ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
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
import DeferItemModal from './DeferItemModal';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';

const BASE_URL = 'https://bob.jc1.tech';
const EXCLUDED_TASK_TYPES = new Set(['chore', 'routine', 'habit', 'core', 'read', 'watch']);

interface Sprint { id: string; name: string; }
type RowType = 'story' | 'task';
type SortKey = 'type' | 'ref' | 'title' | 'status' | 'ai' | 'dueDate';
type SortDir = 'asc' | 'desc';

interface SprintTriageTableProps {
    stories: Story[];
    tasks: Task[];
    goals: Goal[];
    sprints: Sprint[];
    filterSprintId: string | null;
    onEditStory: (story: Story) => void;
    onEditTask: (task: Task) => void;
    onEditGoal?: (goal: Goal) => void;
}

// Canonical status labels — 0=Backlog, 1=In Progress, 2=Review(stories)/Done(tasks), 4=Bin
const STORY_STATUS: Record<number, string> = { 0: 'Backlog', 1: 'In Progress', 2: 'Review', 4: 'Bin' };
const TASK_STATUS: Record<number, string> = { 0: 'Backlog', 1: 'In Progress', 2: 'Done' };
// "done" threshold per entity type (used for hide-done filter)
const isDone = (status: number, type: RowType) => type === 'story' ? status >= 4 : status >= 2;

function statusColor(status: number, type: RowType) {
    if (status === 1) return '#0d6efd';
    if (status === 2) return '#198754';
    if (status === 4) return '#dc3545';
    return themeVars.muted as string;
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

const TD: React.CSSProperties = {
    padding: '10px 8px',
    fontSize: 13,
    verticalAlign: 'middle',
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
    onEditStory, onEditTask, onEditGoal,
}) => {
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
    const [hovered, setHovered] = useState<string | null>(null);
    const [latestNotes, setLatestNotes] = useState<Record<string, string>>({});
    const [hideDone, setHideDone] = useState(true);

    // Sprint-scoped data
    const sprintStories = useMemo(() =>
        filterSprintId
            ? stories.filter(s => (s as any).sprintId === filterSprintId && (s as any).status !== 4)
            : stories.filter(s => (s as any).status !== 4),
    [stories, filterSprintId]);

    const sprintTasks = useMemo(() =>
        (filterSprintId
            ? tasks.filter(t => (t as any).sprintId === filterSprintId && (t as any).status !== 4)
            : tasks.filter(t => (t as any).status !== 4)
        ).filter(t => !EXCLUDED_TASK_TYPES.has(String((t as any).type || '').toLowerCase())),
    [tasks, filterSprintId]);

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
        const done = s.filter(s => Number((s as any).status) === 2).length;
        return { done, total: s.length, pct: Math.round(done / s.length * 100) };
    };

    // Firestore saves
    const addSaving = (id: string) => setSaving(p => new Set([...p, id]));
    const rmSaving = (id: string) => setSaving(p => { const s = new Set(p); s.delete(id); return s; });

    const saveItem = async (id: string, collection_: 'stories' | 'tasks', updates: Record<string, any>) => {
        addSaving(id);
        try { await updateDoc(doc(db, collection_, id), { ...updates, updatedAt: serverTimestamp() }); }
        finally { rmSaving(id); }
    };

    const commitEdit = (item: Story | Task, type: RowType) => {
        if (!editCell) return;
        const col = type === 'story' ? 'stories' : 'tasks';
        const { field } = editCell;
        let updates: Record<string, any> = {};
        if (field === 'title') updates.title = editVal.trim();
        else if (field === 'description') updates.description = editVal.trim();
        else if (field === 'status') updates.status = Number(editVal);
        else if (field === 'dueDate') updates.dueDate = parseDateMs(editVal);
        else if (field === 'sprintId') updates.sprintId = editVal || null;
        else if (field === 'goalId') {
            // resolve typed title back to an id
            const match = goals.find(g => g.id === editVal || g.title === editVal);
            updates.goalId = match ? match.id : (editVal || null);
        } else if (field === 'parentId') {
            const match = sprintStories.find(s => s.id === editVal || s.title === editVal);
            updates.parentId = match ? match.id : (editVal || null);
        } else return;
        if (Object.keys(updates).length) saveItem(item.id, col as any, updates);
        setEditCell(null); setEditVal('');
    };

    const startEdit = (id: string, field: string, val: string) => { setEditCell({ id, field }); setEditVal(val); };
    const cancelEdit = () => { setEditCell(null); setEditVal(''); };

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
        await deleteDoc(doc(db, type === 'story' ? 'stories' : 'tasks', id));
    };

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
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [sprintStories, sprintTasks, sortKey, sortDir]);

    // Render helpers
    const SortIcon = ({ col }: { col: SortKey }) =>
        sortKey !== col ? null :
        sortDir === 'asc' ? <ChevronUp size={11} style={{ marginLeft: 2 }} /> : <ChevronDown size={11} style={{ marginLeft: 2 }} />;

    const TH = ({ label, col, style }: { label: string; col?: SortKey; style?: React.CSSProperties }) => (
        <th
            style={{ ...TH_BASE, color: themeVars.muted as string, backgroundColor: themeVars.card as string, ...style, cursor: col ? 'pointer' : 'default' }}
            onClick={col ? () => handleSort(col) : undefined}
        >
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                {label}{col && <SortIcon col={col} />}
            </span>
        </th>
    );

    const inlineText = (item: Story | Task, type: RowType, field: string, val: string, multiline = false) => {
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
            return multiline ? <textarea {...shared} rows={2} /> : <input {...shared} />;
        }
        return (
            <span
                onClick={() => startEdit(item.id, field, val)}
                style={{ cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={val || '—'}
            >
                {val || <span style={{ color: themeVars.muted as string }}>—</span>}
            </span>
        );
    };

    const inlineStatus = (item: Story | Task, type: RowType) => {
        const status = Number((item as any).status ?? 0);
        const labels = type === 'story' ? STORY_STATUS : TASK_STATUS;
        const statuses = type === 'story' ? [0, 1, 2, 4] : [0, 1, 2];
        const editing = editCell?.id === item.id && editCell?.field === 'status';
        if (editing) {
            return (
                <select autoFocus className="form-select form-select-sm" value={editVal}
                    style={{ fontSize: 12, padding: '2px 6px' }}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(item, type)}
                    onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                >
                    {statuses.map(s => <option key={s} value={s}>{labels[s]}</option>)}
                </select>
            );
        }
        const col = statusColor(status, type);
        return (
            <span
                onClick={() => startEdit(item.id, 'status', String(status))}
                style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: 'pointer', backgroundColor: col + '22', color: col, border: `1px solid ${col}44` }}
            >
                {labels[status] ?? status}
            </span>
        );
    };

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
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
                    {goal ? (
                        <button
                            style={{ ...abtn(themeVars.brand as string), padding: 0, fontSize: 12, fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                            title={goal.title}
                            onClick={() => onEditGoal ? onEditGoal(goal) : window.open(`${BASE_URL}/goals/${goal.id}`, '_blank')}
                        >
                            {goal.ref ? `${goal.ref}` : ''}{goal.ref && goal.title ? ' — ' : ''}{goal.title}
                        </button>
                    ) : goalId ? (
                        <span style={{ color: themeVars.muted as string, fontSize: 12, fontStyle: 'italic' }} title={`Goal ID: ${goalId}`}>Unknown goal</span>
                    ) : (
                        <span style={{ color: themeVars.muted as string, fontSize: 12 }}>—</span>
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
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
                    {parentStory ? (
                        <button
                            style={{ ...abtn(themeVars.brand as string), padding: 0, fontSize: 12, fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
                            title={parentStory.title}
                            onClick={() => onEditStory(parentStory)}
                        >
                            {(parentStory as any).ref || parentStory.title.slice(0, 24)}
                        </button>
                    ) : parentId ? (
                        <span style={{ color: themeVars.muted as string, fontSize: 12, fontStyle: 'italic' }} title={`Story ID: ${parentId}`}>Unknown story</span>
                    ) : (
                        <span style={{ color: themeVars.muted as string, fontSize: 12 }}>—</span>
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

    const actionCell = (item: Story | Task, type: RowType) => {
        const isConverting = converting === item.id;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button style={abtn()} title="Activity stream" onClick={() => showSidebar(item, type)}>
                    <Activity size={15} />
                </button>
                {type === 'story' ? (
                    <button style={abtn()} title="AI: Generate tasks"
                        onClick={async () => {
                            try { await httpsCallable(functions, 'orchestrateStoryPlanning')({ storyId: item.id }); }
                            catch (e: any) { alert(e?.message || 'Failed'); }
                        }}>
                        <Wand2 size={15} />
                    </button>
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
                <a href={`${BASE_URL}/${type === 'story' ? 'stories' : 'tasks'}/${item.id}`} target="_blank" rel="noreferrer" style={{ ...abtn(), textDecoration: 'none' }} title="Deep link">
                    <ExternalLink size={15} />
                </a>
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
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '70vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                    <thead>
                        <tr>
                            <TH label="Type" col="type" style={{ minWidth: 70 }} />
                            <TH label="Ref" col="ref" style={{ minWidth: 80 }} />
                            <TH label="Title" col="title" style={{ minWidth: 200 }} />
                            <TH label="Description" style={{ minWidth: 160, cursor: 'default' }} />
                            <TH label="Status" col="status" style={{ minWidth: 100 }} />
                            <TH label="AI" col="ai" style={{ minWidth: 50 }} />
                            <TH label="Due" col="dueDate" style={{ minWidth: 90 }} />
                            <TH label="Sprint" style={{ minWidth: 130, cursor: 'default' }} />
                            <TH label="Parent" style={{ minWidth: 180, cursor: 'default' }} />
                            <TH label="Last note" style={{ minWidth: 160, cursor: 'default' }} />
                            <TH label="Actions" style={{ minWidth: 180, cursor: 'default' }} />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={11} style={{ padding: 32, textAlign: 'center', color: themeVars.muted as string, fontSize: 13 }}>
                                    No stories or tasks in this sprint.
                                </td>
                            </tr>
                        )}
                        {rows.map(({ item, rowType }) => {
                            const bg = hovered === item.id ? (themeVars.card as string) : backgrounds.surface;
                            const aiScore = (item as any).aiCriticalityScore;
                            const note = latestNotes[item.id];
                            return (
                                <tr key={item.id}
                                    style={{ backgroundColor: bg, transition: 'background-color 0.1s', borderBottom: `1px solid ${themeVars.border}` }}
                                    onMouseEnter={() => setHovered(item.id)}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    {/* Type */}
                                    <td style={TD}>
                                        <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', backgroundColor: rowType === 'story' ? '#0d6efd22' : '#6c757d22', color: rowType === 'story' ? '#0d6efd' : '#6c757d' }}>
                                            {rowType === 'story' ? 'Story' : ((item as any).type || 'Task')}
                                        </span>
                                    </td>
                                    {/* Ref */}
                                    <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12 }}>
                                        <a href={`${BASE_URL}/${rowType === 'story' ? 'stories' : 'tasks'}/${item.id}`} target="_blank" rel="noreferrer" style={{ color: themeVars.brand as string, textDecoration: 'none' }}>
                                            {itemRef(item, rowType)}
                                        </a>
                                    </td>
                                    {/* Title */}
                                    <td style={{ ...TD, maxWidth: 240, fontWeight: 500 }}>
                                        {inlineText(item, rowType, 'title', item.title || '')}
                                    </td>
                                    {/* Description */}
                                    <td style={{ ...TD, maxWidth: 180, color: themeVars.muted as string }}>
                                        {inlineText(item, rowType, 'description', (item as any).description || '', true)}
                                    </td>
                                    {/* Status */}
                                    <td style={TD}>{inlineStatus(item, rowType)}</td>
                                    {/* AI score */}
                                    <td style={{ ...TD, textAlign: 'center', minWidth: 50 }}>
                                        {aiScore != null ? (
                                            <span style={{ fontSize: 12, fontWeight: 600, color: aiScore >= 70 ? '#dc3545' : aiScore >= 40 ? '#fd7e14' : themeVars.muted as string }}>
                                                {aiScore}
                                            </span>
                                        ) : <span style={{ color: themeVars.muted as string, fontSize: 11 }}>—</span>}
                                    </td>
                                    {/* Due */}
                                    <td style={{ ...TD, minWidth: 90 }}>
                                        {inlineText(item, rowType, 'dueDate', fmtDate((item as any).dueDate))}
                                    </td>
                                    {/* Sprint */}
                                    <td style={{ ...TD, minWidth: 130 }}>
                                        {inlineSprintSelect(item, rowType)}
                                    </td>
                                    {/* Parent + progress */}
                                    <td style={{ ...TD, minWidth: 180 }}>
                                        {parentCell(item, rowType)}
                                    </td>
                                    {/* Last note */}
                                    <td style={{ ...TD, maxWidth: 200, color: themeVars.muted as string, fontSize: 12 }}>
                                        {note ? (
                                            <span title={note} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {note}
                                            </span>
                                        ) : <span style={{ fontStyle: 'italic' }}>—</span>}
                                    </td>
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

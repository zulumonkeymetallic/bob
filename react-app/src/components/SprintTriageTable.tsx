import React, { useState, useCallback } from 'react';
import { Spinner } from 'react-bootstrap';
import { Activity, Clock3, Wand2, Pencil, Trash2, ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
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

interface Sprint {
    id: string;
    name: string;
}

interface SprintTriageTableProps {
    stories: Story[];
    tasks: Task[];
    goals: Goal[];
    sprints: Sprint[];
    filterSprintId: string | null;
    onEditStory: (story: Story) => void;
    onEditTask: (task: Task) => void;
}

type RowType = 'story' | 'task';
type SortKey = 'type' | 'ref' | 'title' | 'status' | 'dueDate';
type SortDir = 'asc' | 'desc';

const STORY_STATUS_LABELS: Record<number, string> = { 0: 'Backlog', 1: 'In Progress', 2: 'Review', 4: 'Bin' };
const TASK_STATUS_LABELS: Record<number, string> = { 0: 'To Do', 1: 'In Progress', 2: 'Done' };
const STORY_STATUSES = [0, 1, 2, 4];
const TASK_STATUSES = [0, 1, 2];

function statusColor(status: number, type: RowType): string {
    if (type === 'story') {
        if (status === 1) return '#0d6efd';
        if (status === 2) return '#198754';
        if (status === 4) return '#dc3545';
        return themeVars.muted as string;
    }
    if (status === 1) return '#0d6efd';
    if (status === 2) return '#198754';
    return themeVars.muted as string;
}

function formatDueDate(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
    if (value?.toDate) return value.toDate().toISOString().slice(0, 10);
    return '';
}

function parseDueDateToMs(dateStr: string): number | null {
    if (!dateStr) return null;
    const ms = Date.parse(dateStr);
    return Number.isNaN(ms) ? null : ms;
}

function refLabel(item: Story | Task, type: RowType): string {
    return (item as any).ref || (type === 'story' ? 'ST-?' : 'TK-?');
}

const TH: React.CSSProperties = {
    padding: '12px 8px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    borderRight: `1px solid ${themeVars.border}`,
};

const TD: React.CSSProperties = {
    padding: '10px 8px',
    fontSize: 13,
    verticalAlign: 'middle',
    borderRight: `1px solid ${themeVars.border}`,
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

const actionBtn = (color?: string): React.CSSProperties => ({
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
    stories,
    tasks,
    goals,
    sprints,
    filterSprintId,
    onEditStory,
    onEditTask,
}) => {
    const { backgrounds } = useThemeAwareColors();
    const { showSidebar } = useSidebar();
    const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [deferItem, setDeferItem] = useState<{ id: string; type: RowType; title: string } | null>(null);
    const [converting, setConverting] = useState<string | null>(null);
    const [convertedStory, setConvertedStory] = useState<{ ref: string; id: string } | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('type');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [hoverId, setHoverId] = useState<string | null>(null);

    const activeGoals = goals.filter(g => g.status !== 4);
    const sprintStories = filterSprintId
        ? stories.filter(s => (s as any).sprintId === filterSprintId && (s as any).status !== 4)
        : stories.filter(s => (s as any).status !== 4);
    const sprintTasks = filterSprintId
        ? tasks.filter(t =>
            (t as any).sprintId === filterSprintId &&
            (t as any).status !== 4 &&
            !EXCLUDED_TASK_TYPES.has(String((t as any).type || '').toLowerCase()))
        : tasks.filter(t =>
            (t as any).status !== 4 &&
            !EXCLUDED_TASK_TYPES.has(String((t as any).type || '').toLowerCase()));

    const sprintOptions = [
        { value: '', label: 'No sprint' },
        ...sprints.map(s => ({ value: s.id, label: s.name || s.id })),
    ];
    const goalOptions = [
        { value: '', label: 'No goal' },
        ...activeGoals.map(g => ({ value: g.id, label: `${g.ref ? g.ref + ' — ' : ''}${g.title}` })),
    ];
    const storyOptions = [
        { value: '', label: 'No story' },
        ...sprintStories.map(s => ({ value: s.id, label: `${(s as any).ref ? (s as any).ref + ' — ' : ''}${s.title}` })),
    ];

    const isSaving = (id: string) => saving.has(id);
    const addSaving = (id: string) => setSaving(prev => new Set([...prev, id]));
    const removeSaving = (id: string) => setSaving(prev => { const s = new Set(prev); s.delete(id); return s; });

    const saveStory = useCallback(async (story: Story, field: string, raw: string) => {
        const updates: Record<string, any> = { updatedAt: serverTimestamp() };
        if (field === 'title') updates.title = raw.trim();
        else if (field === 'description') updates.description = raw.trim();
        else if (field === 'status') updates.status = Number(raw);
        else if (field === 'dueDate') updates.dueDate = parseDueDateToMs(raw);
        else if (field === 'goalId') updates.goalId = raw || null;
        else if (field === 'sprintId') updates.sprintId = raw || null;
        else return;
        addSaving(story.id);
        try { await updateDoc(doc(db, 'stories', story.id), updates); } finally { removeSaving(story.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveTask = useCallback(async (task: Task, field: string, raw: string) => {
        const updates: Record<string, any> = { updatedAt: serverTimestamp() };
        if (field === 'title') updates.title = raw.trim();
        else if (field === 'description') updates.description = raw.trim();
        else if (field === 'status') updates.status = Number(raw);
        else if (field === 'dueDate') updates.dueDate = parseDueDateToMs(raw);
        else if (field === 'parentId') updates.parentId = raw || null;
        else if (field === 'sprintId') updates.sprintId = raw || null;
        else return;
        addSaving(task.id);
        try { await updateDoc(doc(db, 'tasks', task.id), updates); } finally { removeSaving(task.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const commitEdit = (item: Story | Task, type: RowType) => {
        if (!editingCell) return;
        if (type === 'story') saveStory(item as Story, editingCell.field, editValue);
        else saveTask(item as Task, editingCell.field, editValue);
        setEditingCell(null);
        setEditValue('');
    };

    const startEdit = (id: string, field: string, value: string) => {
        setEditingCell({ id, field });
        setEditValue(value);
    };

    const cancelEdit = () => { setEditingCell(null); setEditValue(''); };

    const handleConvertTask = async (task: Task) => {
        setConverting(task.id);
        try {
            const convert = httpsCallable(functions, 'convertTasksToStories');
            const resp: any = await convert({
                conversions: [{
                    taskId: task.id,
                    storyTitle: task.title || '',
                    storyDescription: (task as any).description || '',
                    goalId: (task as any).goalId || null,
                }]
            });
            const created = (resp?.data?.created || resp?.data?.stories || resp?.data?.results || [])[0] || {};
            const newStoryId = created.storyId || created.id || null;
            const newStoryRef = created.storyRef || created.ref || created.reference || null;
            if (newStoryId) {
                await updateDoc(doc(db, 'stories', newStoryId), { status: 1, updatedAt: serverTimestamp() });
                await updateDoc(doc(db, 'tasks', task.id), { status: 2, convertedToStoryId: newStoryId, updatedAt: serverTimestamp() });
                if (newStoryRef) setConvertedStory({ ref: newStoryRef, id: newStoryId });
            }
        } catch (err: any) {
            alert(err?.message || 'Convert failed');
        } finally {
            setConverting(null);
        }
    };

    const handleDelete = async (id: string, type: RowType) => {
        if (!window.confirm(`Delete this ${type}? This cannot be undone.`)) return;
        await deleteDoc(doc(db, type === 'story' ? 'stories' : 'tasks', id));
    };

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    };

    // Merge and sort
    type Row = { item: Story | Task; rowType: RowType };
    const allRows: Row[] = [
        ...sprintStories.map(s => ({ item: s as Story | Task, rowType: 'story' as RowType })),
        ...sprintTasks.map(t => ({ item: t as Story | Task, rowType: 'task' as RowType })),
    ];

    const sortedRows = [...allRows].sort((a, b) => {
        let av: string | number = '';
        let bv: string | number = '';
        if (sortKey === 'type') { av = a.rowType; bv = b.rowType; }
        else if (sortKey === 'ref') { av = refLabel(a.item, a.rowType); bv = refLabel(b.item, b.rowType); }
        else if (sortKey === 'title') { av = a.item.title || ''; bv = b.item.title || ''; }
        else if (sortKey === 'status') { av = Number((a.item as any).status ?? 0); bv = Number((b.item as any).status ?? 0); }
        else if (sortKey === 'dueDate') { av = formatDueDate((a.item as any).dueDate); bv = formatDueDate((b.item as any).dueDate); }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const SortIcon: React.FC<{ col: SortKey }> = ({ col }) => {
        if (sortKey !== col) return null;
        return sortDir === 'asc' ? <ChevronUp size={12} style={{ marginLeft: 2 }} /> : <ChevronDown size={12} style={{ marginLeft: 2 }} />;
    };

    const inlineSelect = (
        id: string,
        field: string,
        value: string,
        options: { value: string; label: string }[],
        item: Story | Task,
        type: RowType
    ) => {
        const isEditing = editingCell?.id === id && editingCell?.field === field;
        const label = options.find(o => o.value === value)?.label ?? (value ? value.slice(0, 24) : '—');
        if (isEditing) {
            return (
                <select
                    autoFocus
                    className="form-select form-select-sm"
                    value={editValue}
                    style={{ fontSize: 12, padding: '2px 6px', minWidth: 120 }}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(item, type)}
                    onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                >
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            );
        }
        return (
            <span
                onClick={() => startEdit(id, field, value)}
                style={{ cursor: 'pointer', color: value ? (themeVars.text as string) : (themeVars.muted as string) }}
                title="Click to edit"
            >
                {label}
            </span>
        );
    };

    const inlineText = (id: string, field: string, value: string, item: Story | Task, type: RowType, multiline = false) => {
        const isEditing = editingCell?.id === id && editingCell?.field === field;
        if (isEditing) {
            const sharedProps = {
                autoFocus: true as boolean,
                value: editValue,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEditValue(e.target.value),
                onBlur: () => commitEdit(item, type),
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commitEdit(item, type); }
                    if (e.key === 'Escape') cancelEdit();
                },
                style: { fontSize: 13, padding: '2px 6px', width: '100%' },
                className: 'form-control form-control-sm',
            };
            return multiline ? <textarea {...sharedProps} rows={2} /> : <input {...sharedProps} />;
        }
        return (
            <span
                onClick={() => startEdit(id, field, value)}
                style={{ cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={value || '—'}
            >
                {value || <span style={{ color: themeVars.muted as string }}>—</span>}
            </span>
        );
    };

    const inlineStatus = (item: Story | Task, type: RowType) => {
        const status = Number((item as any).status ?? 0);
        const statuses = type === 'story' ? STORY_STATUSES : TASK_STATUSES;
        const labels = type === 'story' ? STORY_STATUS_LABELS : TASK_STATUS_LABELS;
        const isEditing = editingCell?.id === item.id && editingCell?.field === 'status';
        if (isEditing) {
            return (
                <select
                    autoFocus
                    className="form-select form-select-sm"
                    value={editValue}
                    style={{ fontSize: 12, padding: '2px 6px' }}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(item, type)}
                    onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                >
                    {statuses.map(s => <option key={s} value={s}>{labels[s]}</option>)}
                </select>
            );
        }
        return (
            <span
                onClick={() => startEdit(item.id, 'status', String(status))}
                style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: statusColor(status, type) + '22',
                    color: statusColor(status, type),
                    border: `1px solid ${statusColor(status, type)}44`,
                }}
            >
                {labels[status] ?? status}
            </span>
        );
    };

    // Clickable parent cell — for stories: goal link; for tasks: parent story link
    const parentCell = (item: Story | Task, type: RowType) => {
        if (type === 'story') {
            const goalId = (item as any).goalId || '';
            const goal = activeGoals.find(g => g.id === goalId);
            if (!goal) {
                return inlineSelect(item.id, 'goalId', goalId, goalOptions, item, type);
            }
            const isEditing = editingCell?.id === item.id && editingCell?.field === 'goalId';
            if (isEditing) {
                return inlineSelect(item.id, 'goalId', goalId, goalOptions, item, type);
            }
            return (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <button
                        style={{ ...actionBtn(themeVars.brand as string), padding: 0, fontSize: 12, fontWeight: 500, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={`Open goal: ${goal.title}`}
                        onClick={() => onEditStory(item as Story)} // opens story modal; goal editing available from there
                    >
                        {goal.ref ? `${goal.ref}` : goal.title.slice(0, 20)}
                    </button>
                    <button
                        style={{ ...actionBtn(themeVars.muted as string), padding: 2 }}
                        title="Change goal"
                        onClick={() => startEdit(item.id, 'goalId', goalId)}
                    >
                        <Pencil size={10} />
                    </button>
                </span>
            );
        } else {
            const parentId = (item as any).parentId || (item as any).storyId || '';
            const parentStory = sprintStories.find(s => s.id === parentId);
            if (!parentStory) {
                return inlineSelect(item.id, 'parentId', parentId, storyOptions, item, type);
            }
            const isEditing = editingCell?.id === item.id && editingCell?.field === 'parentId';
            if (isEditing) {
                return inlineSelect(item.id, 'parentId', parentId, storyOptions, item, type);
            }
            return (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <button
                        style={{ ...actionBtn(themeVars.brand as string), padding: 0, fontSize: 12, fontWeight: 500, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={`Open story: ${parentStory.title}`}
                        onClick={() => onEditStory(parentStory)}
                    >
                        {(parentStory as any).ref || parentStory.title.slice(0, 20)}
                    </button>
                    <button
                        style={{ ...actionBtn(themeVars.muted as string), padding: 2 }}
                        title="Change story"
                        onClick={() => startEdit(item.id, 'parentId', parentId)}
                    >
                        <Pencil size={10} />
                    </button>
                </span>
            );
        }
    };

    const actionCell = (item: Story | Task, type: RowType) => {
        const isConverting = converting === item.id;
        const taskForDefer = type === 'task'
            ? sprintTasks.find(t => t.id === item.id)
            : sprintStories.find(s => s.id === item.id);
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'nowrap' }}>
                {/* Sprint select — matching ModernTaskTable native select */}
                <select
                    value={(item as any).sprintId || ''}
                    onChange={async e => {
                        const val = e.target.value;
                        if (type === 'story') await saveStory(item as Story, 'sprintId', val);
                        else await saveTask(item as Task, 'sprintId', val);
                    }}
                    style={{
                        minWidth: 100,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: `1px solid ${themeVars.border}`,
                        backgroundColor: backgrounds.surface,
                        color: themeVars.text as string,
                        fontSize: 12,
                    }}
                    title="Assign sprint"
                >
                    <option value="">Sprint…</option>
                    {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>

                <button style={actionBtn()} title="Activity stream" onClick={() => showSidebar(item, type)}>
                    <Activity size={15} />
                </button>

                {type === 'story' && (
                    <button
                        style={actionBtn()}
                        title="AI: Generate tasks"
                        onClick={async () => {
                            try { await httpsCallable(functions, 'orchestrateStoryPlanning')({ storyId: item.id }); }
                            catch (e: any) { alert(e?.message || 'Failed'); }
                        }}
                    >
                        <Wand2 size={15} />
                    </button>
                )}
                {type === 'task' && (
                    <button
                        style={actionBtn(isConverting ? (themeVars.muted as string) : (themeVars.brand as string))}
                        title={isConverting ? 'Converting…' : 'Convert to story'}
                        disabled={isConverting}
                        onClick={() => handleConvertTask(item as Task)}
                    >
                        {isConverting ? <Spinner animation="border" size="sm" style={{ width: 13, height: 13 }} /> : <Wand2 size={15} />}
                    </button>
                )}

                <button
                    style={actionBtn()}
                    title="Defer"
                    onClick={() => setDeferItem({ id: item.id, type, title: item.title || '' })}
                >
                    <Clock3 size={15} />
                </button>

                <a
                    href={`${BASE_URL}/${type === 'story' ? 'stories' : 'tasks'}/${item.id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...actionBtn(), textDecoration: 'none' }}
                    title="Open deep link"
                >
                    <ExternalLink size={15} />
                </a>

                <button
                    style={actionBtn(themeVars.brand as string)}
                    title="Edit"
                    onClick={() => type === 'story' ? onEditStory(item as Story) : onEditTask(item as Task)}
                >
                    <Pencil size={15} />
                </button>

                <button
                    style={actionBtn('#dc3545')}
                    title="Delete"
                    onClick={() => handleDelete(item.id, type)}
                >
                    <Trash2 size={15} />
                </button>

                {isSaving(item.id) && <Spinner animation="border" size="sm" style={{ width: 12, height: 12, marginLeft: 2 }} />}
            </div>
        );
    };

    const headerCell = (label: string, col?: SortKey) => (
        <th
            key={label}
            style={{
                ...TH,
                color: themeVars.muted as string,
            }}
            onClick={col ? () => handleSort(col) : undefined}
        >
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                {label}{col && <SortIcon col={col} />}
            </span>
        </th>
    );

    return (
        <>
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '70vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                    <thead style={{
                        backgroundColor: themeVars.card as string,
                        borderBottom: `1px solid ${themeVars.border}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 5,
                    }}>
                        <tr>
                            {headerCell('Type', 'type')}
                            {headerCell('Ref', 'ref')}
                            {headerCell('Title', 'title')}
                            {headerCell('Description')}
                            {headerCell('Status', 'status')}
                            {headerCell('Due', 'dueDate')}
                            {headerCell('Parent')}
                            <th style={{ ...TH, color: themeVars.muted as string, cursor: 'default', minWidth: 340 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.length === 0 && (
                            <tr>
                                <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: themeVars.muted as string, fontSize: 13 }}>
                                    No stories or tasks in this sprint.
                                </td>
                            </tr>
                        )}
                        {sortedRows.map(({ item, rowType }) => {
                            const isHovered = hoverId === item.id;
                            const rowBg = isHovered
                                ? (themeVars.card as string)
                                : rowType === 'task'
                                    ? backgrounds.surface
                                    : backgrounds.surface;
                            return (
                                <tr
                                    key={item.id}
                                    style={{ backgroundColor: rowBg, transition: 'background-color 0.1s ease', borderBottom: `1px solid ${themeVars.border}` }}
                                    onMouseEnter={() => setHoverId(item.id)}
                                    onMouseLeave={() => setHoverId(null)}
                                >
                                    <td style={{ ...TD, maxWidth: 70 }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '2px 7px',
                                            borderRadius: 10,
                                            fontSize: 10,
                                            fontWeight: 700,
                                            textTransform: 'uppercase',
                                            backgroundColor: rowType === 'story' ? '#0d6efd22' : '#6c757d22',
                                            color: rowType === 'story' ? '#0d6efd' : '#6c757d',
                                        }}>
                                            {rowType === 'story' ? 'Story' : ((item as any).type || 'Task')}
                                        </span>
                                    </td>
                                    <td style={{ ...TD, maxWidth: 90, fontFamily: 'monospace', fontSize: 12 }}>
                                        <a
                                            href={`${BASE_URL}/${rowType === 'story' ? 'stories' : 'tasks'}/${item.id}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ color: themeVars.brand as string, textDecoration: 'none' }}
                                        >
                                            {refLabel(item, rowType)}
                                        </a>
                                    </td>
                                    <td style={{ ...TD, maxWidth: 240, fontWeight: 500 }}>
                                        {inlineText(item.id, 'title', item.title || '', item, rowType)}
                                    </td>
                                    <td style={{ ...TD, maxWidth: 200, color: themeVars.muted as string }}>
                                        {inlineText(item.id, 'description', (item as any).description || '', item, rowType, true)}
                                    </td>
                                    <td style={{ ...TD, maxWidth: 110 }}>
                                        {inlineStatus(item, rowType)}
                                    </td>
                                    <td style={{ ...TD, maxWidth: 110 }}>
                                        {inlineText(item.id, 'dueDate', formatDueDate((item as any).dueDate), item, rowType)}
                                    </td>
                                    <td style={{ ...TD, maxWidth: 180 }}>
                                        {parentCell(item, rowType)}
                                    </td>
                                    <td style={{ ...TD, maxWidth: 'none', whiteSpace: 'nowrap' }}>
                                        {actionCell(item, rowType)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: themeVars.muted as string, display: 'flex', alignItems: 'center', gap: 16 }}>
                <span>{sprintStories.length} {sprintStories.length === 1 ? 'story' : 'stories'} · {sprintTasks.length} {sprintTasks.length === 1 ? 'task' : 'tasks'}</span>
                {convertedStory && (
                    <span style={{ color: '#198754' }}>
                        Story created:{' '}
                        <a href={`${BASE_URL}/stories/${convertedStory.id}`} target="_blank" rel="noreferrer" style={{ color: '#198754' }}>
                            {convertedStory.ref} →
                        </a>
                        {' '}
                        <button
                            style={{ fontSize: 11, background: 'none', border: 'none', color: themeVars.muted as string, cursor: 'pointer', padding: 0 }}
                            onClick={() => setConvertedStory(null)}
                        >✕</button>
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
                    onApply={async (payload) => {
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

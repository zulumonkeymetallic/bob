import React, { useState, useCallback } from 'react';
import { Button, Badge, Spinner } from 'react-bootstrap';
import { Activity, Clock3, Wand2, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { Story, Task, Goal } from '../types';
import { themeVars } from '../utils/themeVars';
import { applyPlannerDefer } from '../utils/plannerDeferral';
import DeferItemModal from './DeferItemModal';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { displayRefForEntity } from '../utils/referenceGenerator';

const BASE_URL = 'https://bob.jc1.tech';

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
type EditingCell = { id: string; field: string } | null;

const STATUS_STORY_LABELS: Record<number, string> = { 0: 'Backlog', 1: 'In Progress', 2: 'Review', 4: 'Bin' };
const STATUS_TASK_LABELS: Record<number, string> = { 0: 'To Do', 1: 'In Progress', 2: 'Done' };
const STORY_STATUSES = [0, 1, 2, 4];
const TASK_STATUSES = [0, 1, 2];

function statusBadgeVariant(status: number, type: RowType) {
    if (type === 'story') {
        if (status === 1) return 'primary';
        if (status === 2) return 'success';
        if (status === 4) return 'danger';
        return 'secondary';
    }
    if (status === 1) return 'primary';
    if (status === 2) return 'success';
    return 'secondary';
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

const CELL_STYLE: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: 13,
    color: themeVars.text,
    verticalAlign: 'middle',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

const HEADER_STYLE: React.CSSProperties = {
    padding: '8px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: themeVars.muted,
    borderBottom: `1px solid ${themeVars.border}`,
    whiteSpace: 'nowrap',
    backgroundColor: 'var(--notion-hover)',
};

const SprintTriageTable: React.FC<SprintTriageTableProps> = ({
    stories,
    tasks,
    goals,
    sprints,
    filterSprintId,
    onEditStory,
    onEditTask,
}) => {
    const { currentUser } = useAuth();
    const { showSidebar } = useSidebar();
    const [editingCell, setEditingCell] = useState<EditingCell>(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState<string | null>(null); // entityId being saved
    const [deferItem, setDeferItem] = useState<{ id: string; type: RowType; title: string } | null>(null);
    const [converting, setConverting] = useState<string | null>(null);
    const [convertedStory, setConvertedStory] = useState<{ ref: string; id: string } | null>(null);

    const activeGoals = goals.filter(g => g.status !== 4);
    const sprintStories = filterSprintId
        ? stories.filter(s => (s as any).sprintId === filterSprintId && (s as any).status !== 4)
        : stories.filter(s => (s as any).status !== 4);
    const sprintTasks = filterSprintId
        ? tasks.filter(t => (t as any).sprintId === filterSprintId && (t as any).status !== 4)
        : tasks.filter(t => (t as any).status !== 4);

    const startEdit = (id: string, field: string, currentValue: string) => {
        setEditingCell({ id, field });
        setEditValue(currentValue);
    };

    const cancelEdit = () => {
        setEditingCell(null);
        setEditValue('');
    };

    const saveStoryField = useCallback(async (story: Story, field: string, raw: string) => {
        let updates: Record<string, any> = { updatedAt: serverTimestamp() };
        if (field === 'title') updates.title = raw.trim();
        else if (field === 'description') updates.description = raw.trim();
        else if (field === 'status') updates.status = Number(raw);
        else if (field === 'dueDate') updates.dueDate = parseDueDateToMs(raw);
        else if (field === 'goalId') updates.goalId = raw || null;
        else if (field === 'sprintId') updates.sprintId = raw || null;
        else return;
        setSaving(story.id);
        try { await updateDoc(doc(db, 'stories', story.id), updates); } finally { setSaving(null); }
    }, []);

    const saveTaskField = useCallback(async (task: Task, field: string, raw: string) => {
        let updates: Record<string, any> = { updatedAt: serverTimestamp() };
        if (field === 'title') updates.title = raw.trim();
        else if (field === 'description') updates.description = raw.trim();
        else if (field === 'status') updates.status = Number(raw);
        else if (field === 'dueDate') updates.dueDate = parseDueDateToMs(raw);
        else if (field === 'parentId') updates.parentId = raw || null;
        else if (field === 'sprintId') updates.sprintId = raw || null;
        else return;
        setSaving(task.id);
        try { await updateDoc(doc(db, 'tasks', task.id), updates); } finally { setSaving(null); }
    }, []);

    const commitEdit = (item: Story | Task, type: RowType) => {
        if (!editingCell) return;
        if (type === 'story') saveStoryField(item as Story, editingCell.field, editValue);
        else saveTaskField(item as Task, editingCell.field, editValue);
        cancelEdit();
    };

    const handleDelete = async (id: string, type: RowType) => {
        if (!window.confirm(`Delete this ${type}? This cannot be undone.`)) return;
        await deleteDoc(doc(db, type === 'story' ? 'stories' : 'tasks', id));
    };

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

    const EditableText: React.FC<{
        item: Story | Task;
        type: RowType;
        field: string;
        value: string;
        multiline?: boolean;
    }> = ({ item, type, field, value, multiline }) => {
        const isEditing = editingCell?.id === item.id && editingCell?.field === field;
        if (isEditing) {
            const props = {
                autoFocus: true,
                value: editValue,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEditValue(e.target.value),
                onBlur: () => commitEdit(item, type),
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commitEdit(item, type); }
                    if (e.key === 'Escape') cancelEdit();
                },
                style: { fontSize: 13, padding: '2px 4px', width: '100%', minWidth: 120 },
            };
            return multiline
                ? <textarea {...props} rows={2} className="form-control form-control-sm" />
                : <input {...props} className="form-control form-control-sm" />;
        }
        return (
            <span
                style={{ cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={value || '—'}
                onClick={() => startEdit(item.id, field, value)}
            >
                {value || <span style={{ color: themeVars.muted }}>—</span>}
            </span>
        );
    };

    const EditableSelect: React.FC<{
        item: Story | Task;
        type: RowType;
        field: string;
        value: string;
        options: { value: string; label: string }[];
    }> = ({ item, type, field, value, options }) => {
        const isEditing = editingCell?.id === item.id && editingCell?.field === field;
        if (isEditing) {
            return (
                <select
                    autoFocus
                    className="form-select form-select-sm"
                    value={editValue}
                    style={{ fontSize: 13, padding: '2px 4px' }}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(item, type)}
                    onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                >
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            );
        }
        const label = options.find(o => o.value === value)?.label ?? value ?? '—';
        return (
            <span
                style={{ cursor: 'pointer' }}
                onClick={() => startEdit(item.id, field, value)}
            >
                {label}
            </span>
        );
    };

    const ActionIcons: React.FC<{ item: Story | Task; type: RowType }> = ({ item, type }) => {
        const isConverting = converting === item.id;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    style={{ color: themeVars.muted, width: 26, height: 26 }}
                    title="Activity stream"
                    onClick={() => showSidebar(item, type)}
                >
                    <Activity size={14} />
                </Button>

                {type === 'story' && (
                    <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ color: themeVars.muted, width: 26, height: 26 }}
                        title="AI: Generate tasks"
                        onClick={async () => {
                            try {
                                const fn = httpsCallable(functions, 'orchestrateStoryPlanning');
                                await fn({ storyId: item.id });
                            } catch (e: any) { alert(e?.message || 'Failed'); }
                        }}
                    >
                        <Wand2 size={14} />
                    </Button>
                )}

                {type === 'task' && (
                    <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ color: themeVars.muted, width: 26, height: 26 }}
                        title="Convert to story"
                        disabled={isConverting}
                        onClick={() => handleConvertTask(item as Task)}
                    >
                        {isConverting ? <Spinner animation="border" size="sm" style={{ width: 12, height: 12 }} /> : <Wand2 size={14} />}
                    </Button>
                )}

                <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    style={{ color: themeVars.muted, width: 26, height: 26 }}
                    title="Defer"
                    onClick={() => setDeferItem({ id: item.id, type, title: item.title || '' })}
                >
                    <Clock3 size={14} />
                </Button>

                <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    style={{ color: themeVars.muted, width: 26, height: 26 }}
                    title="Open deep link"
                    as="a"
                    href={`${BASE_URL}/${type === 'story' ? 'stories' : 'tasks'}/${item.id}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    <ExternalLink size={14} />
                </Button>

                <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    style={{ color: themeVars.muted, width: 26, height: 26 }}
                    title="Edit"
                    onClick={() => type === 'story' ? onEditStory(item as Story) : onEditTask(item as Task)}
                >
                    <Pencil size={14} />
                </Button>

                <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    style={{ color: 'var(--danger, #dc3545)', width: 26, height: 26 }}
                    title="Delete"
                    onClick={() => handleDelete(item.id, type)}
                >
                    <Trash2 size={14} />
                </Button>

                {saving === item.id && <Spinner animation="border" size="sm" style={{ width: 12, height: 12 }} />}
            </div>
        );
    };

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

    const renderStoryRow = (story: Story) => {
        const ref = displayRefForEntity('story', story.id) || (story as any).ref || '—';
        const status = Number((story as any).status ?? 0);
        const goalId = (story as any).goalId || '';
        const sprintId = (story as any).sprintId || '';
        const dueDate = formatDueDate((story as any).dueDate);

        return (
            <tr key={story.id} style={{ borderBottom: `1px solid ${themeVars.border}` }}>
                <td style={CELL_STYLE}>
                    <Badge bg="primary" style={{ fontSize: 10, fontWeight: 600 }}>Story</Badge>
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 90 }}>
                    <a href={`${BASE_URL}/stories/${story.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {ref}
                    </a>
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 220 }}>
                    <EditableText item={story} type="story" field="title" value={story.title || ''} />
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 200 }}>
                    <EditableText item={story} type="story" field="description" value={(story as any).description || ''} multiline />
                </td>
                <td style={CELL_STYLE}>
                    <Badge bg={statusBadgeVariant(status, 'story')} style={{ fontSize: 11, cursor: 'pointer' }}
                        onClick={() => startEdit(story.id, 'status', String(status))}
                    >
                        {editingCell?.id === story.id && editingCell?.field === 'status'
                            ? <select
                                autoFocus
                                className="form-select form-select-sm"
                                value={editValue}
                                style={{ fontSize: 11, padding: '0 2px', background: 'transparent', border: 'none', color: 'inherit' }}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(story, 'story')}
                                onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                            >
                                {STORY_STATUSES.map(s => <option key={s} value={s}>{STATUS_STORY_LABELS[s]}</option>)}
                            </select>
                            : STATUS_STORY_LABELS[status] ?? status
                        }
                    </Badge>
                </td>
                <td style={CELL_STYLE}>
                    <EditableSelect item={story} type="story" field="sprintId" value={sprintId} options={sprintOptions} />
                </td>
                <td style={CELL_STYLE}>
                    <EditableText item={story} type="story" field="dueDate" value={dueDate} />
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 160 }}>
                    <EditableSelect item={story} type="story" field="goalId" value={goalId} options={goalOptions} />
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 'none' }}>
                    <ActionIcons item={story} type="story" />
                </td>
            </tr>
        );
    };

    const renderTaskRow = (task: Task) => {
        const ref = displayRefForEntity('task', task.id) || (task as any).ref || '—';
        const status = Number((task as any).status ?? 0);
        const parentId = (task as any).parentId || (task as any).storyId || '';
        const sprintId = (task as any).sprintId || '';
        const dueDate = formatDueDate((task as any).dueDate);
        const taskType = (task as any).type || 'task';

        return (
            <tr key={task.id} style={{ borderBottom: `1px solid ${themeVars.border}`, backgroundColor: 'var(--notion-hover)' }}>
                <td style={CELL_STYLE}>
                    <Badge bg="secondary" style={{ fontSize: 10, fontWeight: 600 }}>{taskType}</Badge>
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 90 }}>
                    <a href={`${BASE_URL}/tasks/${task.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {ref}
                    </a>
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 220 }}>
                    <EditableText item={task} type="task" field="title" value={task.title || ''} />
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 200 }}>
                    <EditableText item={task} type="task" field="description" value={(task as any).description || ''} multiline />
                </td>
                <td style={CELL_STYLE}>
                    <Badge bg={statusBadgeVariant(status, 'task')} style={{ fontSize: 11, cursor: 'pointer' }}
                        onClick={() => startEdit(task.id, 'status', String(status))}
                    >
                        {editingCell?.id === task.id && editingCell?.field === 'status'
                            ? <select
                                autoFocus
                                className="form-select form-select-sm"
                                value={editValue}
                                style={{ fontSize: 11, padding: '0 2px', background: 'transparent', border: 'none', color: 'inherit' }}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(task, 'task')}
                                onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                            >
                                {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_TASK_LABELS[s]}</option>)}
                            </select>
                            : STATUS_TASK_LABELS[status] ?? status
                        }
                    </Badge>
                </td>
                <td style={CELL_STYLE}>
                    <EditableSelect item={task} type="task" field="sprintId" value={sprintId} options={sprintOptions} />
                </td>
                <td style={CELL_STYLE}>
                    <EditableText item={task} type="task" field="dueDate" value={dueDate} />
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 160 }}>
                    <EditableSelect item={task} type="task" field="parentId" value={parentId} options={storyOptions} />
                </td>
                <td style={{ ...CELL_STYLE, maxWidth: 'none' }}>
                    <ActionIcons item={task} type="task" />
                </td>
            </tr>
        );
    };

    return (
        <>
            <div style={{ overflowX: 'auto', border: `1px solid ${themeVars.border}`, borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                    <thead>
                        <tr>
                            {['Type', 'Ref', 'Title', 'Description', 'Status', 'Sprint', 'Due', 'Parent', 'Actions'].map(col => (
                                <th key={col} style={HEADER_STYLE}>{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sprintStories.length === 0 && sprintTasks.length === 0 && (
                            <tr>
                                <td colSpan={9} style={{ ...CELL_STYLE, textAlign: 'center', color: themeVars.muted, padding: 32 }}>
                                    No stories or tasks in this sprint.
                                </td>
                            </tr>
                        )}
                        {sprintStories.map(renderStoryRow)}
                        {sprintTasks.map(renderTaskRow)}
                    </tbody>
                </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: themeVars.muted }}>
                {sprintStories.length} {sprintStories.length === 1 ? 'story' : 'stories'} · {sprintTasks.length} {sprintTasks.length === 1 ? 'task' : 'tasks'}
                {convertedStory && (
                    <span style={{ marginLeft: 16, color: 'var(--green, #28a745)' }}>
                        Story created: <a href={`${BASE_URL}/stories/${convertedStory.id}`} target="_blank" rel="noreferrer">{convertedStory.ref}</a>
                        {' '}<button style={{ fontSize: 11, background: 'none', border: 'none', color: themeVars.muted, cursor: 'pointer' }} onClick={() => setConvertedStory(null)}>✕</button>
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

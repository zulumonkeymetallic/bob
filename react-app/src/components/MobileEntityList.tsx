/**
 * MobileEntityList — the compact row list that Goals / Stories / Tasks render on a phone
 * instead of their desktop Modern*Table.
 *
 * Those tables are 12+ columns wide. On a 390pt screen the browser squeezes each header
 * down to one letter per line and the body becomes unreadable — that is what /goals and
 * /tasks looked like via the bottom tab bar. This gives those routes the same two-mode
 * shape the Daily Plan already has on mobile:
 *
 *   list    one line per item: ref, title, and a single meta line
 *   detail  a card per item: adds description, status chip, AI score, due date, actions
 *
 * Deliberately not a third card component: GoalsCardView/StoriesCardView/TasksCardView are
 * the *desktop* card layouts (multi-column grids, hover rails). This is the phone one.
 */

import React from 'react';
import { Badge, Button, Form, ListGroup } from 'react-bootstrap';
import { Pencil, ExternalLink, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Goal, Story, Task } from '../types';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { LANE_VARIANTS, laneFor, statusLabel } from '../utils/workStatus';

export type MobileEntityKind = 'goal' | 'story' | 'task';
export type MobileEntityViewType = 'list' | 'detail';

type AnyEntity = Goal | Story | Task;

interface MobileEntityListProps {
    kind: MobileEntityKind;
    items: AnyEntity[];
    viewType: MobileEntityViewType;
    /** Resolves the parent line under the title, e.g. a story's goal or a task's story. */
    parentLabel?: (item: AnyEntity) => string | null;
    onEdit?: (item: any) => void;
    onDelete?: (id: string) => void;
    /** Tasks only — the checkbox toggles done. */
    onToggleComplete?: (item: Task, done: boolean) => void;
    emptyMessage?: string;
}

const themeColor = (value: any): string | undefined => {
    if (value == null || value === '') return undefined;
    const id = typeof value === 'number' ? value : Number(value);
    const match = Number.isFinite(id)
        ? GLOBAL_THEMES.find((t) => t.id === id)
        : GLOBAL_THEMES.find((t) => t.label.toLowerCase() === String(value).toLowerCase());
    return match?.color;
};

const dueLabel = (raw: any): string | null => {
    if (!raw) return null;
    const ms = typeof raw === 'number' ? raw : (raw?.toDate?.()?.getTime?.() ?? Date.parse(String(raw)));
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const isOverdue = (raw: any): boolean => {
    if (!raw) return false;
    const ms = typeof raw === 'number' ? raw : (raw?.toDate?.()?.getTime?.() ?? Date.parse(String(raw)));
    if (!Number.isFinite(ms)) return false;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return ms < start.getTime();
};

const MobileEntityList: React.FC<MobileEntityListProps> = ({
    kind, items, viewType, parentLabel, onEdit, onDelete, onToggleComplete,
    emptyMessage = 'Nothing here yet.',
}) => {
    const navigate = useNavigate();
    const routeBase = kind === 'goal' ? '/goals' : kind === 'story' ? '/stories' : '/tasks';

    if (items.length === 0) {
        return <div className="text-muted text-center py-4" style={{ fontSize: 13 }}>{emptyMessage}</div>;
    }

    const iconBtn: React.CSSProperties = {
        color: 'var(--bs-secondary-color)', padding: 4, borderRadius: 4,
        border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 0, flexShrink: 0,
    };

    const statusChip = (item: AnyEntity) => {
        // Goals keep their own five-value scale (New/WIP/Complete/Blocked/Deferred); only
        // stories and tasks share the three canonical lanes.
        if (kind === 'goal') return null;
        const lane = laneFor((item as any).status, kind === 'story' ? 'story' : 'task');
        return (
            <Badge bg={LANE_VARIANTS[lane]} style={{ fontSize: 10 }}>
                {statusLabel((item as any).status, kind === 'story' ? 'story' : 'task')}
            </Badge>
        );
    };

    return (
        <ListGroup variant="flush">
            {items.map((item) => {
                const ref = (item as any).ref || (item as any).referenceNumber || '';
                const colour = themeColor((item as any).theme);
                const due = dueLabel((item as any).dueDate ?? (item as any).targetDate ?? (item as any).endDate);
                const overdue = isOverdue((item as any).dueDate ?? (item as any).targetDate);
                const parent = parentLabel?.(item) || null;
                const aiScore = Number((item as any).aiCriticalityScore);
                const meta = [parent, due ? `Due ${due}` : null].filter(Boolean).join(' · ');

                if (viewType === 'list') {
                    return (
                        <ListGroup.Item
                            key={item.id}
                            className="d-flex align-items-center gap-2 py-2 px-2"
                            style={colour ? { borderLeft: `4px solid ${colour}` } : undefined}
                        >
                            {kind === 'task' && onToggleComplete && (
                                <Form.Check
                                    type="checkbox"
                                    checked={laneFor((item as any).status, 'task') === 'done'}
                                    onChange={(e) => onToggleComplete(item as Task, e.target.checked)}
                                    aria-label={`Complete ${item.title}`}
                                />
                            )}
                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                <div className="fw-semibold text-truncate" style={{ lineHeight: 1.25, fontSize: 14 }}>
                                    {item.title || 'Untitled'}
                                </div>
                                <div className="text-muted text-truncate" style={{ fontSize: 11 }}>
                                    {[ref, meta].filter(Boolean).join(' · ') || '—'}
                                </div>
                            </div>
                            {overdue && <Badge bg="danger" style={{ fontSize: 9 }}>Overdue</Badge>}
                            <button type="button" style={iconBtn} title="Open"
                                onClick={() => navigate(`${routeBase}/${item.id}`)}>
                                <ExternalLink size={14} />
                            </button>
                            {onEdit && (
                                <button type="button" style={iconBtn} title="Edit" onClick={() => onEdit(item)}>
                                    <Pencil size={14} />
                                </button>
                            )}
                        </ListGroup.Item>
                    );
                }

                return (
                    <ListGroup.Item
                        key={item.id}
                        className="py-3 px-2"
                        style={colour ? { borderLeft: `4px solid ${colour}` } : undefined}
                    >
                        <div className="d-flex align-items-start gap-2">
                            {kind === 'task' && onToggleComplete && (
                                <Form.Check
                                    type="checkbox"
                                    className="mt-1"
                                    checked={laneFor((item as any).status, 'task') === 'done'}
                                    onChange={(e) => onToggleComplete(item as Task, e.target.checked)}
                                    aria-label={`Complete ${item.title}`}
                                />
                            )}
                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                                    {ref && <span className="text-primary" style={{ fontSize: 11, fontWeight: 600 }}>{ref}</span>}
                                    {statusChip(item)}
                                    {Number.isFinite(aiScore) && (
                                        <Badge bg="light" text="dark" style={{ fontSize: 10 }}>AI {aiScore}</Badge>
                                    )}
                                    {overdue && <Badge bg="danger" style={{ fontSize: 10 }}>Overdue</Badge>}
                                </div>
                                <div className="fw-semibold" style={{ fontSize: 15, lineHeight: 1.3 }}>
                                    {item.title || 'Untitled'}
                                </div>
                                {(item as any).description && (
                                    <div
                                        className="text-muted mt-1"
                                        style={{ fontSize: 12, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                                    >
                                        {(item as any).description}
                                    </div>
                                )}
                                <div className="text-muted mt-1" style={{ fontSize: 11 }}>{meta || '—'}</div>
                            </div>
                        </div>
                        <div className="d-flex gap-2 mt-2">
                            <Button size="sm" variant="outline-secondary" onClick={() => navigate(`${routeBase}/${item.id}`)}>
                                <ExternalLink size={13} className="me-1" />Open
                            </Button>
                            {onEdit && (
                                <Button size="sm" variant="outline-primary" onClick={() => onEdit(item)}>
                                    <Pencil size={13} className="me-1" />Edit
                                </Button>
                            )}
                            {onDelete && (
                                <Button
                                    size="sm"
                                    variant="outline-danger"
                                    className="ms-auto"
                                    onClick={() => {
                                        if (window.confirm(`Delete this ${kind}? Cannot be undone.`)) onDelete(item.id);
                                    }}
                                >
                                    <Trash2 size={13} />
                                </Button>
                            )}
                        </div>
                    </ListGroup.Item>
                );
            })}
        </ListGroup>
    );
};

export default MobileEntityList;

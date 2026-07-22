/**
 * DailyPlanList — the "List" mode row renderer for the unified daily-plan timeline.
 * Extracted from MobileHome.tsx's daily_plan tab so the desktop DailyPlanWidget can render
 * identical rows.
 *
 * Per Jim, 2026-07-21: checkbox-to-complete is reserved for chore/habit/routine rows only.
 * Task and story rows instead get a compact badge cluster (Top3 star, priority/order, AI
 * score — "a little like the kanban card badges") plus a status-select chip styled the same
 * way KanbanCardV2's status dropdown is, so changing status doesn't require opening the full
 * edit modal. Raw GCal event rows stay a shaded, non-interactive row — deduped against any
 * task/story already matched to that title upstream in useDailyPlanTimeline, so a scheduled
 * task never renders twice (once as itself, once again as its own calendar block).
 */
import React, { useEffect, useState } from 'react';
import { Badge, Form, ListGroup } from 'react-bootstrap';
import { CalendarDays, Clock3, Star, Trash2 } from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getPriorityBadge } from '../../utils/statusHelpers';
import type { Story, Task } from '../../types';
import type { DailyPlanTimelineItem } from '../../hooks/useDailyPlanTimeline';
import '../../styles/KanbanCards.css';

export interface DailyPlanDeferTarget {
  type: 'task' | 'story';
  id: string;
  title: string;
  listView?: boolean;
}

export interface DailyPlanListProps {
  items: DailyPlanTimelineItem[];
  choreCompletionBusy?: Record<string, boolean>;
  onCompleteChore: (task: Task) => void;
  /** Optional — when omitted, the delete (trash) icon is not rendered. Mirrors
   * DeferralCandidatesBanner's quick-delete: no sidebar, direct deleteDoc. */
  onDelete?: (item: DailyPlanTimelineItem) => void;
  /** Optional — ids currently mid-delete, shows the trash icon disabled/spinning. */
  deleteBusy?: Record<string, boolean>;
  /** Optional — when omitted, the defer button is not rendered. */
  onDefer?: (target: DailyPlanDeferTarget) => void;
  /** Optional — when omitted, the ref badge isn't clickable. Opens the entity's edit modal
   * from the human-readable ref (TK-XXXX / ST-XXXXX) rather than needing a separate pencil
   * icon — the ref itself doubles as the "open this" affordance on mobile. */
  onEdit?: (item: DailyPlanTimelineItem) => void;
}

const normalizeStatusValue = (rawStatus: any, entityType: 'story' | 'task'): number => {
  if (typeof rawStatus === 'number' && Number.isFinite(rawStatus)) return rawStatus;
  const status = String(rawStatus || '').toLowerCase();
  if (entityType === 'story') {
    if (['done', 'complete', 'completed', 'finished'].includes(status)) return 4;
    if (['testing', 'qa', 'review'].includes(status)) return 3;
    if (['in-progress', 'active', 'doing', 'blocked', 'in progress'].includes(status)) return 2;
    if (['planned', 'ready'].includes(status)) return 1;
    return 0;
  }
  if (['done', 'complete', 'completed', 'finished'].includes(status)) return 2;
  if (['blocked'].includes(status)) return 3;
  if (['in-progress', 'active', 'doing', 'in progress'].includes(status)) return 1;
  return 0;
};

// Mirrors KanbanCardV2's statusBadge map exactly, so a story/task reads the same colour
// wherever it's shown.
const STATUS_BADGE: Record<'story' | 'task', Record<number, { bg: string; text: string }>> = {
  story: {
    0: { bg: 'secondary', text: 'Backlog' },
    1: { bg: 'info', text: 'Planned' },
    2: { bg: 'primary', text: 'In progress' },
    3: { bg: 'warning', text: 'Review' },
    4: { bg: 'success', text: 'Done' },
  },
  task: {
    0: { bg: 'secondary', text: 'To do' },
    1: { bg: 'primary', text: 'Doing' },
    2: { bg: 'success', text: 'Done' },
    3: { bg: 'danger', text: 'Blocked' },
  },
};

const getManualPriorityRank = (entity: any): number | null => {
  const explicit = Number(entity?.userPriorityRank);
  if (explicit >= 1 && explicit <= 5) return explicit;
  return entity?.userPriorityFlag === true ? 1 : null;
};

const getAiScoreRounded = (entity: any): number | null => {
  const value = Number(entity?.aiCriticalityScore);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
};

// The badge+status-chip cluster for a single task/story row — its own component so the
// status <select>'s local optimistic state doesn't have to live in the parent list.
const DailyPlanEntityControls: React.FC<{
  entity: Task | Story;
  entityType: 'story' | 'task';
  isTop3?: boolean;
}> = ({ entity, entityType, isTop3 }) => {
  const [statusValue, setStatusValue] = useState<number>(normalizeStatusValue((entity as any).status, entityType));
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setStatusValue(normalizeStatusValue((entity as any).status, entityType));
  }, [entity, entityType]);

  const manualRank = getManualPriorityRank(entity);
  const priorityBadge = getPriorityBadge((entity as any).priority);
  const aiScore = getAiScoreRounded(entity);
  const statusBadge = STATUS_BADGE[entityType][statusValue] || STATUS_BADGE[entityType][0];

  const handleStatusChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    event.stopPropagation();
    const previous = statusValue;
    const next = Number(event.target.value);
    setStatusValue(next);
    setUpdating(true);
    try {
      const collectionName = entityType === 'story' ? 'stories' : 'tasks';
      await updateDoc(doc(db, collectionName, entity.id), { status: next, updatedAt: serverTimestamp() });
    } catch (err) {
      console.warn('DailyPlanList: failed to update status', err);
      setStatusValue(previous);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
      {(isTop3 || manualRank) && (
        <Star size={13} fill="#f59e0b" style={{ color: '#f59e0b', flexShrink: 0 }} />
      )}
      {manualRank && (
        <Badge bg="dark" style={{ fontSize: 10 }}>#{manualRank}</Badge>
      )}
      {priorityBadge.text !== 'None' && (
        <Badge bg={priorityBadge.bg as any} style={{ fontSize: 10 }}>{priorityBadge.text}</Badge>
      )}
      {aiScore != null && (
        <Badge bg="light" text="dark" style={{ fontSize: 10, border: '1px solid var(--bs-border-color)' }}>AI {aiScore}</Badge>
      )}
      <select
        className="kanban-card__chip-select"
        value={statusValue}
        onChange={handleStatusChange}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={updating}
        title="Status"
        style={{
          backgroundColor: `var(--bs-${statusBadge.bg})`,
          color: statusBadge.bg === 'warning' || statusBadge.bg === 'light' ? '#000' : '#fff',
        }}
      >
        {entityType === 'story' ? (
          <>
            <option value={0}>Backlog</option>
            <option value={1}>Planned</option>
            <option value={2}>In progress</option>
            <option value={3}>Review</option>
            <option value={4}>Done</option>
          </>
        ) : (
          <>
            <option value={0}>To do</option>
            <option value={1}>Doing</option>
            <option value={3}>Blocked</option>
            <option value={2}>Done</option>
          </>
        )}
      </select>
    </div>
  );
};

const DailyPlanList: React.FC<DailyPlanListProps> = ({
  items,
  choreCompletionBusy = {},
  onCompleteChore,
  onDelete,
  deleteBusy = {},
  onDefer,
  onEdit,
}) => {
  return (
    <ListGroup variant="flush">
      {items.map((item) => {
        // Checkbox-to-complete is chore/habit/routine only — tasks and stories get the
        // badge+status-chip cluster instead (see DailyPlanEntityControls above).
        const isChore = item.kind === 'chore';
        const isEntity = item.kind === 'task' || item.kind === 'story';
        const isEvent = item.kind === 'event';
        const entity: Task | Story | undefined = item.story ?? item.task;
        const deleteId = item.story?.id ?? item.task?.id;
        const isDeleteBusy = !!deleteId && !!deleteBusy[deleteId];
        const iconBtnStyle: React.CSSProperties = {
          background: 'none', border: 'none', padding: '4px 6px',
          color: 'var(--bs-secondary)', cursor: 'pointer', flexShrink: 0,
        };
        return (
          <ListGroup.Item
            key={item.id}
            className="d-flex align-items-center gap-2 py-2"
            style={{
              fontSize: 14,
              flexWrap: 'wrap',
              ...(isEvent ? { background: '#f8fafc', opacity: 0.85 } : null),
            }}
          >
            {isChore && item.task ? (
              <Form.Check
                type="checkbox"
                checked={Number(item.task.status ?? 0) === 2 || !!choreCompletionBusy[item.task.id]}
                disabled={Number(item.task.status ?? 0) === 2 || !!choreCompletionBusy[item.task.id]}
                onChange={() => onCompleteChore(item.task!)}
                aria-label={`Complete ${item.title}`}
                style={{ flexShrink: 0 }}
              />
            ) : isEvent ? (
              <CalendarDays size={14} style={{ flexShrink: 0, color: 'var(--bs-secondary)' }} />
            ) : (
              <span style={{ width: 18, flexShrink: 0 }} />
            )}
            <div className="flex-grow-1" style={{ minWidth: 140, flexBasis: 140 }}>
              {/* Ref renders on its own line above the title rather than beside it. minWidth
                  guarantees this container real estate before the entity-controls cluster
                  (badges + status select, ~200px+) — the row now wraps (flexWrap:'wrap' on
                  ListGroup.Item) so controls drop to their own line instead of squeezing the
                  title/ref down to zero width at phone viewports. */}
              {!isEvent && entity && (entity as any).ref && (
                onEdit ? (
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="text-decoration-none d-block"
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      fontSize: 11, fontWeight: 700, color: 'var(--bs-primary)',
                      cursor: 'pointer', lineHeight: 1.3,
                    }}
                    title={`Open ${(entity as any).ref}`}
                  >
                    {(entity as any).ref}
                  </button>
                ) : (
                  <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.3 }}>{(entity as any).ref}</div>
                )
              )}
              <div className={isEvent ? 'text-truncate text-muted' : 'fw-semibold text-truncate'} style={{ lineHeight: 1.2 }}>{item.title}</div>
              {item.timeLabel && <div className="text-muted" style={{ fontSize: 11 }}>{item.timeLabel}</div>}
            </div>
            {isEntity && entity && (
              <DailyPlanEntityControls entity={entity} entityType={item.story ? 'story' : 'task'} isTop3={item.isTop3} />
            )}
            {onDefer && (item.task || item.story) && (
              <button
                type="button"
                style={iconBtnStyle}
                title="Defer"
                onClick={() => onDefer({
                  type: item.story ? 'story' : 'task',
                  id: item.story ? item.story.id : item.task!.id,
                  title: item.title,
                  listView: true,
                })}
              >
                <Clock3 size={14} />
              </button>
            )}
            {onDelete && (item.task || item.story) && (
              <button
                type="button"
                style={{ ...iconBtnStyle, color: 'var(--text-danger, #dc2626)', opacity: isDeleteBusy ? 0.5 : 1 }}
                title="Delete"
                aria-label={`Delete ${item.title}`}
                disabled={isDeleteBusy}
                onClick={() => onDelete(item)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </ListGroup.Item>
        );
      })}
    </ListGroup>
  );
};

export default DailyPlanList;

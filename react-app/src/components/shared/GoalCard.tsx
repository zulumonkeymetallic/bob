/**
 * Shared GoalCard — used by /planner?level=year, /planner?level=quarter, and
 * (in a follow-up) /goals. Three detail levels:
 *
 *   minimal: ref, title, theme chip, focus chip, parent goal path,
 *            start/end/duration, top-right icons.
 *   medium (default): minimal + status chip + Top 3 / AI badges +
 *            story/task counts.
 *   full: medium + description preview + no-pot warning chip.
 *
 * Designed so /goals can later inject its richer panels (KPI status, budget bar,
 * latest activity) via the optional `extraFullContent` slot without changing the
 * planner integration.
 */

import React, { useEffect, useRef } from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { Edit3, Activity, Wand2, CalendarPlus, PanelsTopLeft } from 'lucide-react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { Goal } from '../../types';
import { getThemeName, getStatusName } from '../../utils/statusHelpers';

export type GoalCardDetailLevel = 'minimal' | 'medium' | 'full';

export interface GoalCardMetrics {
  storyCount: number;
  taskCount: number;
  top3Count: number;
  aiScoredCount: number;
  maxAiScore: number | null;
  earliestDueMs: number | null;
  isFocusAligned: boolean;
}

export interface GoalCardProps {
  goal: Goal;
  metrics: GoalCardMetrics;
  themeColor: string;
  detailLevel?: GoalCardDetailLevel;
  parentPath?: string;
  draggablePayload?: Record<string, any>;
  showNoPot?: boolean;
  /** Optional extra panels (KPI, budget, etc) rendered only when detailLevel === 'full'. */
  extraFullContent?: React.ReactNode;
  onEdit?: (goal: Goal) => void;
  onActivity?: (goal: Goal) => void;
  onGenerateStories?: (goal: Goal) => void;
  onSchedule?: (goal: Goal) => void;
  onWorkspace?: (goal: Goal) => void;
  onClick?: (goal: Goal) => void;
}

// Resolve assorted Firestore date shapes to ms-since-epoch.
const dateMs = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? null : parsed;
};

const startMs = (g: Goal): number | null =>
  dateMs((g as any).startDate) ?? dateMs((g as any).createdAt);
const endMs = (g: Goal): number | null =>
  dateMs((g as any).endDate) ?? dateMs((g as any).targetDate) ?? dateMs((g as any).dueDate);

const fmtShort = (ms: number | null): string | null =>
  ms == null ? null : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

const fmtDuration = (sMs: number | null, eMs: number | null): string | null => {
  if (sMs == null || eMs == null || eMs < sMs) return null;
  const days = Math.round((eMs - sMs) / (1000 * 60 * 60 * 24));
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
};

export const GoalCard: React.FC<GoalCardProps> = ({
  goal,
  metrics,
  themeColor,
  detailLevel = 'medium',
  parentPath,
  draggablePayload,
  showNoPot,
  extraFullContent,
  onEdit,
  onActivity,
  onGenerateStories,
  onSchedule,
  onWorkspace,
  onClick,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draggablePayload) return;
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({ type: 'goal', item: goal, id: goal.id, ...draggablePayload }),
    });
  }, [goal, draggablePayload]);

  const sMs = startMs(goal);
  const eMs = endMs(goal);
  const sLabel = fmtShort(sMs);
  const eLabel = fmtShort(eMs);
  const durationLabel = fmtDuration(sMs, eMs);
  const description = (goal as any).description as string | undefined;

  return (
    <Card
      ref={ref}
      className="shadow-sm border-0"
      onClick={onClick ? () => onClick(goal) : undefined}
      style={{
        cursor: draggablePayload ? 'grab' : (onClick ? 'pointer' : 'default'),
        background: 'var(--card, #fff)',
        border: `1px solid ${themeColor}40`,
        borderTop: `4px solid ${themeColor}`,
        borderRadius: 12,
      }}
    >
      <Card.Body className="p-3">
        <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="small fw-semibold text-uppercase" style={{ color: themeColor, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
              {String((goal as any).ref || goal.id).slice(0, 16)}
            </div>
            <div className="fw-semibold" style={{ lineHeight: 1.3 }}>{goal.title || 'Untitled goal'}</div>
          </div>
          <div className="d-flex align-items-center gap-1 flex-wrap justify-content-end">
            {onActivity && (
              <Button size="sm" variant="link" className="p-0 text-muted" onClick={(e) => { e.stopPropagation(); onActivity(goal); }} title="Open activity stream">
                <Activity size={15} />
              </Button>
            )}
            {onEdit && (
              <Button size="sm" variant="link" className="p-0 text-muted" onClick={(e) => { e.stopPropagation(); onEdit(goal); }} title="Edit goal">
                <Edit3 size={15} />
              </Button>
            )}
            {onGenerateStories && (
              <Button size="sm" variant="link" className="p-0 text-muted" onClick={(e) => { e.stopPropagation(); onGenerateStories(goal); }} title="Generate stories">
                <Wand2 size={15} />
              </Button>
            )}
            {onSchedule && (
              <Button size="sm" variant="link" className="p-0 text-muted" onClick={(e) => { e.stopPropagation(); onSchedule(goal); }} title="Schedule calendar blocks">
                <CalendarPlus size={15} />
              </Button>
            )}
            {onWorkspace && (
              <Button size="sm" variant="link" className="p-0 text-muted" onClick={(e) => { e.stopPropagation(); onWorkspace(goal); }} title="Open planning workspace">
                <PanelsTopLeft size={15} />
              </Button>
            )}
          </div>
        </div>
        {parentPath && (
          <div className="text-muted small mb-2">{parentPath}</div>
        )}
        <div className="d-flex gap-1 flex-wrap mb-2">
          <Badge bg="light" text="dark">{getThemeName((goal as any).theme)}</Badge>
          {metrics.isFocusAligned && <Badge bg="primary">Focus</Badge>}
          {detailLevel !== 'minimal' && (
            <Badge bg="secondary">{getStatusName((goal as any).status)}</Badge>
          )}
          {detailLevel !== 'minimal' && metrics.top3Count > 0 && (
            <Badge bg="danger">Top 3 {metrics.top3Count}</Badge>
          )}
          {detailLevel !== 'minimal' && metrics.aiScoredCount > 0 && (
            <Badge bg="info">AI {metrics.aiScoredCount}</Badge>
          )}
          {detailLevel === 'full' && showNoPot && (
            <Badge bg="warning" text="dark">No pot</Badge>
          )}
        </div>
        <div className="small text-muted mb-2">
          <div>
            {sLabel ? <>Start <strong>{sLabel}</strong></> : <span className="fst-italic">No start date</span>}
            {eLabel && <> · End <strong>{eLabel}</strong></>}
            {durationLabel && <> · {durationLabel}</>}
          </div>
          {detailLevel !== 'minimal' && (
            <div>
              {metrics.storyCount} stories · {metrics.taskCount} tasks
              {metrics.maxAiScore != null ? ` · max AI ${metrics.maxAiScore}` : ''}
            </div>
          )}
        </div>
        {detailLevel === 'full' && description && (
          <div className="small mt-1" style={{ color: 'var(--bs-body-color)' }}>
            {String(description).slice(0, 240)}
            {String(description).length > 240 ? '…' : ''}
          </div>
        )}
        {detailLevel === 'full' && extraFullContent}
      </Card.Body>
    </Card>
  );
};

export default GoalCard;

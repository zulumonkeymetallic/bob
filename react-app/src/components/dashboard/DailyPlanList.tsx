/**
 * DailyPlanList — the "List" mode row renderer for the unified daily-plan timeline
 * (checkbox for task/chore rows, plain row for story rows, shaded non-interactive
 * row for raw Google Calendar event rows). Extracted from MobileHome.tsx's
 * daily_plan tab so the desktop DailyPlanWidget can render identical rows.
 */
import React from 'react';
import { Form, ListGroup } from 'react-bootstrap';
import { CalendarDays, Clock3 } from 'lucide-react';
import type { Task } from '../../types';
import type { DailyPlanTimelineItem } from '../../hooks/useDailyPlanTimeline';

export interface DailyPlanDeferTarget {
  type: 'task' | 'story';
  id: string;
  title: string;
  listView?: boolean;
}

export interface DailyPlanListProps {
  items: DailyPlanTimelineItem[];
  choreCompletionBusy?: Record<string, boolean>;
  onCompleteTask: (task: Task) => void;
  onCompleteChore: (task: Task) => void;
  /** Optional — when omitted, the defer button is not rendered. */
  onDefer?: (target: DailyPlanDeferTarget) => void;
}

const DailyPlanList: React.FC<DailyPlanListProps> = ({
  items,
  choreCompletionBusy = {},
  onCompleteTask,
  onCompleteChore,
  onDefer,
}) => {
  return (
    <ListGroup variant="flush">
      {items.map((item) => {
        const isTask = item.kind === 'task' || item.kind === 'chore';
        const isEvent = item.kind === 'event';
        const isDone = !!item.task && Number(item.task.status ?? 0) === 2;
        const iconBtnStyle: React.CSSProperties = {
          background: 'none', border: 'none', padding: '4px 6px',
          color: 'var(--bs-secondary)', cursor: 'pointer', flexShrink: 0,
        };
        return (
          <ListGroup.Item
            key={item.id}
            className="d-flex align-items-center gap-2 py-2"
            style={isEvent ? { fontSize: 14, background: '#f8fafc', opacity: 0.85 } : { fontSize: 14 }}
          >
            {isTask && item.task ? (
              <Form.Check
                type="checkbox"
                checked={isDone || !!choreCompletionBusy[item.task.id]}
                disabled={isDone || !!choreCompletionBusy[item.task.id]}
                onChange={() => {
                  if (item.kind === 'chore') onCompleteChore(item.task!);
                  else onCompleteTask(item.task!);
                }}
                aria-label={`Complete ${item.title}`}
                style={{ flexShrink: 0 }}
              />
            ) : isEvent ? (
              <CalendarDays size={14} style={{ flexShrink: 0, color: 'var(--bs-secondary)' }} />
            ) : (
              <span style={{ width: 18, flexShrink: 0 }} />
            )}
            <div className="flex-grow-1" style={{ minWidth: 0 }}>
              <div className={isEvent ? 'text-truncate text-muted' : 'fw-semibold text-truncate'} style={{ lineHeight: 1.2 }}>{item.title}</div>
              {item.timeLabel && <div className="text-muted" style={{ fontSize: 11 }}>{item.timeLabel}</div>}
            </div>
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
          </ListGroup.Item>
        );
      })}
    </ListGroup>
  );
};

export default DailyPlanList;

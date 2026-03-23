import React from 'react';
import { Button, Card, Form } from 'react-bootstrap';
import { Activity, CalendarClock, CalendarPlus, Check, ChevronDown, ChevronUp, Clock3, Edit3, MoveRight, Sparkles, Target } from 'lucide-react';
import type { PlannerItem } from '../../utils/plannerItems';
import { priorityLabel as formatPriorityLabel, priorityPillClass, storyStatusText, taskStatusText } from '../../utils/storyCardFormatting';
import { getManualPriorityLabel } from '../../utils/manualPriority';
import { GLOBAL_THEMES } from '../../constants/globalThemes';
import '../../styles/KanbanCards.css';

type PlannerCardContext = 'daily' | 'weekly';

interface PlannerCardRecommendation {
  label: string;
  rationale: string;
}

interface PlannerWorkCardProps {
  item: PlannerItem;
  context: PlannerCardContext;
  isMobileLayout: boolean;
  applyingKey?: string | null;
  showDoneControl?: boolean;
  doneAsCheckbox?: boolean;
  showInlineRecommendation?: boolean;
  recommendation?: PlannerCardRecommendation | null;
  canEditState?: boolean;
  canShowActions?: boolean;
  expanded?: boolean;
  onToggleExpanded?: (item: PlannerItem) => void;
  onToggleDone?: (item: PlannerItem) => void;
  onOpenActivity?: (item: PlannerItem) => void;
  onOpenEditor?: (item: PlannerItem) => void;
  onSchedule?: (item: PlannerItem) => void;
  onMove?: (item: PlannerItem) => void;
  onDefer?: (item: PlannerItem) => void;
  onAcceptRecommendation?: (item: PlannerItem) => void;
  onCycleStatus?: (item: PlannerItem) => void;
  onCyclePriority?: (item: PlannerItem) => void;
  onStatusChange?: (item: PlannerItem, nextStatus: number) => void;
  onPriorityChange?: (item: PlannerItem, nextPriority: number) => void;
}

const normalizeAiScore = (value: any): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 1) return Math.round(numeric * 100);
  return Math.round(numeric);
};

const formatDateChip = (value?: number | null) => {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const buildChildMeta = (child: PlannerItem) => {
  const parts = [child.ref, child.timeLabel].filter(Boolean);
  return parts.join(' · ');
};

const PlannerWorkCard: React.FC<PlannerWorkCardProps> = ({
  item,
  context,
  isMobileLayout,
  applyingKey = null,
  showDoneControl = true,
  doneAsCheckbox = false,
  showInlineRecommendation = false,
  recommendation = null,
  canEditState = true,
  canShowActions = true,
  expanded = false,
  onToggleExpanded,
  onToggleDone,
  onOpenActivity,
  onOpenEditor,
  onSchedule,
  onMove,
  onDefer,
  onAcceptRecommendation,
  onCycleStatus,
  onCyclePriority,
  onStatusChange,
  onPriorityChange,
}) => {
  const isEvent = item.kind === 'event';
  const isGroup = Array.isArray(item.childItems) && item.childItems.length > 0;
  const itemKindLabel = item.kind === 'story' ? 'Story' : item.kind === 'chore' ? (isGroup ? 'Chore block' : 'Chore') : item.kind === 'event' ? 'Event' : 'Task';
  const choiceTable = item.rawStory ? 'story' : 'task';
  const statusValue = item.rawStory ? Number((item.rawStory as any)?.status ?? 0) : Number((item.rawTask as any)?.status ?? 0);
  const priorityValue = Number((item.rawTask as any)?.priority ?? (item.rawStory as any)?.priority ?? 0);
  const statusLabel = item.kind === 'event'
    ? 'Event'
    : choiceTable === 'story'
      ? storyStatusText(statusValue)
      : taskStatusText(statusValue);
  const priorityLabel = formatPriorityLabel(priorityValue, 'No priority');
  const manualPriorityLabel = getManualPriorityLabel(item.rawStory || item.rawTask);
  const aiScore = normalizeAiScore(
    (item.rawTask as any)?.aiCriticalityScore
    ?? (item.rawTask as any)?.metadata?.aiScore
    ?? (item.rawTask as any)?.metadata?.aiCriticalityScore
    ?? (item.rawStory as any)?.metadata?.aiScore
    ?? (item.rawStory as any)?.metadata?.aiCriticalityScore
    ?? (item.rawStory as any)?.aiCriticalityScore
    ?? null,
  );
  const dueValue = formatDateChip(item.dueAt);
  const deferredLabel = item.deferredUntilMs
    ? `Deferred to ${new Date(item.deferredUntilMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null;
  const scheduledBlockLabel = (() => {
    if (!item.timeLabel) return null;
    if (item.scheduledBlockStart && item.scheduledBlockEnd) {
      const start = new Date(item.scheduledBlockStart);
      const end = new Date(item.scheduledBlockEnd);
      const dayLabel = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeLabel = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}-${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return `Planned ${dayLabel} ${timeLabel}`;
    }
    if (item.scheduledBlockStart) {
      const start = new Date(item.scheduledBlockStart);
      const dayLabel = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `Planned ${dayLabel} ${timeLabel}`;
    }
    return item.timeLabel;
  })();
  const scheduledSourceClassName = String(item.scheduledSourceLabel || '').toLowerCase().includes('gcal')
    ? 'kanban-card__source-note kanban-card__source-note--quiet'
    : 'kanban-card__source-note';
  const pointsValue = Number((item.rawTask as any)?.points ?? (item.rawStory as any)?.points ?? 0);
  const actionButtons = canShowActions && !isEvent;
  // Use goal theme color when available — same approach as KanbanCardV2 — fallback to kind colour
  const themeColor = (() => {
    if (!item.goalTheme) return null;
    const themeNum = Number(item.goalTheme);
    const match = Number.isFinite(themeNum)
      ? GLOBAL_THEMES.find(t => t.id === themeNum)
      : GLOBAL_THEMES.find(t => String(t.label).toLowerCase() === String(item.goalTheme).toLowerCase());
    return match?.color ?? null;
  })();
  const kindColor = item.kind === 'story' ? '#0dcaf0' : item.kind === 'chore' ? '#198754' : item.kind === 'event' ? '#6c757d' : '#0d6efd';
  const color = themeColor || kindColor;
  const compactWeekly = context === 'weekly';
  const secondaryMeta = compactWeekly
    ? [item.ref].filter(Boolean).join(' · ')
    : [item.ref, !scheduledBlockLabel ? item.timeLabel : null].filter(Boolean).join(' · ');

  return (
    <Card
      key={item.id}
      className="border shadow-sm"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <Card.Body className={isMobileLayout ? 'p-2' : context === 'weekly' ? 'p-2' : 'p-3'}>
        <div className="d-flex align-items-start gap-2">
          {showDoneControl && !isEvent && !isGroup && onToggleDone && (
            doneAsCheckbox ? (
              <Form.Check
                type="checkbox"
                checked={false}
                disabled={applyingKey === item.id}
                onChange={() => onToggleDone(item)}
                className="mt-1"
              />
            ) : (
              <Button
                size="sm"
                variant="outline-success"
                className="rounded-circle d-inline-flex align-items-center justify-content-center p-1 mt-1 flex-shrink-0"
                onClick={() => onToggleDone(item)}
                disabled={applyingKey === item.id}
              >
                <Check size={14} />
              </Button>
            )
          )}

          <div className="flex-grow-1 min-w-0">
            <div className={`d-flex ${isMobileLayout ? 'flex-column' : 'align-items-start justify-content-between'} gap-2`}>
              <div className="min-w-0">
                <div className="fw-semibold small kanban-card__title mb-1" style={{ lineHeight: 1.25 }}>
                    {item.title}
                </div>
                <div className="kanban-card__meta">
                  {!isEvent && !isGroup && canEditState && (
                    onPriorityChange ? (
                      <Form.Select
                        size="sm"
                        aria-label="Priority"
                        value={priorityValue}
                        onChange={(event) => onPriorityChange(item, Number(event.target.value))}
                        className={priorityPillClass(priorityValue > 0 ? priorityValue : null)}
                        style={{ minWidth: isMobileLayout ? 110 : 120, backgroundClip: 'padding-box' }}
                      >
                        <option value={0}>No priority</option>
                        <option value={1}>Low</option>
                        <option value={2}>Medium</option>
                        <option value={3}>High</option>
                        <option value={4}>Critical</option>
                      </Form.Select>
                    ) : onCyclePriority ? (
                      <button
                        type="button"
                        className={priorityPillClass(priorityValue > 0 ? priorityValue : null)}
                        style={{ appearance: 'none', backgroundClip: 'padding-box', cursor: 'pointer' }}
                        onClick={() => onCyclePriority(item)}
                        title="Tap to cycle priority"
                      >
                        {priorityLabel}
                      </button>
                    ) : null
                  )}
                  {manualPriorityLabel && (
                    <span
                      className="kanban-card__meta-badge"
                      style={{
                        borderColor: 'rgba(220, 53, 69, 0.45)',
                        backgroundColor: 'rgba(220, 53, 69, 0.12)',
                        color: 'var(--bs-danger)',
                      }}
                      title="Manual priority"
                    >
                      {manualPriorityLabel}
                    </span>
                  )}
                  {item.isTop3 && (
                    <span className="kanban-card__meta-badge kanban-card__meta-badge--top3" title="Top 3 priority">
                      Top 3
                    </span>
                  )}
                  {item.isFocusAligned && (
                    <span
                      className="kanban-card__meta-badge"
                      style={{
                        borderColor: 'rgba(99, 102, 241, 0.45)',
                        backgroundColor: 'rgba(99, 102, 241, 0.12)',
                        color: '#6366f1',
                        fontWeight: 600,
                      }}
                      title="Aligned to an active Focus Goal"
                    >
                      <Target size={10} style={{ marginRight: 3, marginTop: -1 }} />
                      Focus
                    </span>
                  )}
                  {isGroup && (
                    <span className="kanban-card__meta-badge" title="Grouped recurring items">
                      {item.childItems!.length} items
                    </span>
                  )}
                  {pointsValue > 0 && (
                    <span className="kanban-card__meta-badge" title="Estimated points">
                      {pointsValue} pts
                    </span>
                  )}
                  {item.progressPct != null && (item.kind === 'task' || item.kind === 'story') && (
                    <span className="kanban-card__meta-badge" title="Progress">
                      Progress {Math.round(item.progressPct)}%
                    </span>
                  )}
                  {!compactWeekly && scheduledBlockLabel && (
                    <span className="d-inline-flex flex-column" style={{ lineHeight: 1.2 }}>
                      <span
                        className="kanban-card__meta-badge"
                        style={{
                          borderColor: 'rgba(37, 99, 235, 0.45)',
                          backgroundColor: 'rgba(37, 99, 235, 0.12)',
                          color: '#2563eb',
                        }}
                        title={scheduledBlockLabel}
                      >
                        <CalendarClock size={11} style={{ marginRight: 4, marginTop: -1 }} />
                        {scheduledBlockLabel}
                      </span>
                      {item.scheduledSourceLabel && (
                        <span className={scheduledSourceClassName} style={{ marginTop: 2 }}>
                          {item.scheduledSourceLabel}
                        </span>
                      )}
                    </span>
                  )}
                  {!compactWeekly && deferredLabel && (
                    <span
                      className="kanban-card__meta-badge"
                      style={{
                        borderColor: 'rgba(245, 158, 11, 0.45)',
                        backgroundColor: 'rgba(245, 158, 11, 0.12)',
                        color: '#b45309',
                      }}
                      title={deferredLabel}
                    >
                      <Clock3 size={11} style={{ marginRight: 4, marginTop: -1 }} />
                      Deferred
                    </span>
                  )}
                  {!compactWeekly && dueValue && (
                    <span className="kanban-card__meta-badge" title={`Due ${dueValue}`}>
                      Due {dueValue}
                    </span>
                  )}
                  {item.isFocusAligned && (
                    <span className="kanban-card__meta-badge" style={{ borderColor: 'rgba(22, 163, 74, 0.35)', color: '#15803d', backgroundColor: 'rgba(34, 197, 94, 0.1)' }}>
                      Focus
                    </span>
                  )}
                  {!compactWeekly && itemKindLabel && (
                    <span className="kanban-card__meta-badge" title="Item type">
                      {itemKindLabel}
                    </span>
                  )}
                  {!compactWeekly && aiScore != null && (
                    <span className="kanban-card__meta-badge" title="AI score">
                      AI {aiScore}/100
                    </span>
                  )}
                  {!isEvent && !isGroup && canEditState && onStatusChange ? (
                    <Form.Select
                      size="sm"
                      aria-label="Status"
                      value={statusValue}
                      onChange={(event) => onStatusChange(item, Number(event.target.value))}
                      className="dashboard-chip-select"
                      style={{ minWidth: isMobileLayout ? 118 : 132 }}
                    >
                      {choiceTable === 'story' ? (
                        <>
                          <option value={0}>Backlog</option>
                          <option value={1}>Ready</option>
                          <option value={2}>In Progress</option>
                          <option value={3}>Review</option>
                          <option value={4}>Done</option>
                        </>
                      ) : (
                        <>
                          <option value={0}>To do</option>
                          <option value={1}>Doing</option>
                          <option value={2}>Done</option>
                        </>
                      )}
                    </Form.Select>
                  ) : (
                    <span className="kanban-card__meta-text" title="Status">
                      {statusLabel}
                    </span>
                  )}
                </div>
                {secondaryMeta && (
                  <div className="text-muted kanban-card__description" style={{ fontSize: '0.74rem' }}>
                    {secondaryMeta}
                  </div>
                )}
                {item.goalTitle && !compactWeekly && (
                  <div className="kanban-card__goal mt-1">
                    <Target size={12} />
                    <span style={{ overflowWrap: 'anywhere' }}>{item.goalTitle}</span>
                  </div>
                )}
                {showInlineRecommendation && recommendation && (
                  <div className="mt-2 small">
                    <div className="fw-semibold d-inline-flex align-items-center gap-1"><Sparkles size={13} /> {recommendation.label}</div>
                    <div className="text-muted">{recommendation.rationale}</div>
                  </div>
                )}
                {isGroup && item.childItems && item.childItems.length > 0 && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className="rounded-pill py-0 px-2"
                      onClick={() => onToggleExpanded?.(item)}
                    >
                      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {expanded ? 'Hide items' : 'Show items'}
                    </Button>
                    {expanded && (
                      <div className="mt-2 d-flex flex-column gap-2">
                        {item.childItems.map((child) => (
                          <div key={child.id} className="border rounded px-2 py-1">
                            <div className="d-flex align-items-start gap-2">
                              {onToggleDone && (
                                <Form.Check
                                  type="checkbox"
                                  checked={false}
                                  disabled={applyingKey === child.id}
                                  onChange={() => onToggleDone(child)}
                                  className="mt-1"
                                />
                              )}
                              <div className="min-w-0 flex-grow-1">
                                <div className="fw-semibold small" style={{ overflowWrap: 'anywhere' }}>{child.title}</div>
                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>{buildChildMeta(child)}</div>
                              </div>
                              {onDefer && (
                                <Button
                                  size="sm"
                                  variant="outline-warning"
                                  className="p-1 d-inline-flex align-items-center justify-content-center"
                                  onClick={() => onDefer(child)}
                                >
                                  <Clock3 size={14} />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {actionButtons && (
                <div className="d-flex align-items-center gap-1 flex-wrap">
                  {onOpenActivity && (item.rawTask || item.rawStory) && (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className={isMobileLayout ? 'px-2 py-1 d-inline-flex align-items-center justify-content-center' : 'p-1 d-inline-flex align-items-center justify-content-center'}
                      onClick={() => onOpenActivity(item)}
                    >
                      <Activity size={14} className={isMobileLayout ? 'me-1' : undefined} />
                      {isMobileLayout ? 'Note' : null}
                    </Button>
                  )}
                  {onOpenEditor && (item.rawTask || item.rawStory) && (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className={isMobileLayout ? 'px-2 py-1 d-inline-flex align-items-center justify-content-center' : 'p-1 d-inline-flex align-items-center justify-content-center'}
                      onClick={() => onOpenEditor(item)}
                    >
                      <Edit3 size={14} className={isMobileLayout ? 'me-1' : undefined} />
                      {isMobileLayout ? 'Edit' : null}
                    </Button>
                  )}
                  {onSchedule && !isGroup && (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className={isMobileLayout ? 'px-2 py-1 d-inline-flex align-items-center justify-content-center' : 'p-1 d-inline-flex align-items-center justify-content-center'}
                      onClick={() => onSchedule(item)}
                    >
                      <CalendarPlus size={14} className={isMobileLayout ? 'me-1' : undefined} />
                      {isMobileLayout ? 'Schedule' : null}
                    </Button>
                  )}
                  {onMove && (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className={isMobileLayout ? 'px-2 py-1 d-inline-flex align-items-center justify-content-center' : 'p-1 d-inline-flex align-items-center justify-content-center'}
                      onClick={() => onMove(item)}
                    >
                      <MoveRight size={14} className={isMobileLayout ? 'me-1' : undefined} />
                      {isMobileLayout ? 'Move' : null}
                    </Button>
                  )}
                  {showInlineRecommendation && recommendation && onAcceptRecommendation ? (
                    <>
                      <Button size="sm" variant="primary" disabled={applyingKey === item.id} onClick={() => onAcceptRecommendation(item)}>
                        {applyingKey === item.id ? 'Applying…' : 'Accept'}
                      </Button>
                      {onDefer && !isGroup && (
                        <Button size="sm" variant="outline-warning" onClick={() => onDefer(item)}>
                          More
                        </Button>
                      )}
                    </>
                  ) : (
                    onDefer && !isGroup && (
                      <Button
                        size="sm"
                        variant="outline-warning"
                        className={isMobileLayout ? 'px-2 py-1 d-inline-flex align-items-center justify-content-center' : 'p-1 d-inline-flex align-items-center justify-content-center'}
                        onClick={() => onDefer(item)}
                      >
                        <Clock3 size={14} className={isMobileLayout ? 'me-1' : undefined} />
                        {isMobileLayout ? 'Defer' : null}
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default PlannerWorkCard;

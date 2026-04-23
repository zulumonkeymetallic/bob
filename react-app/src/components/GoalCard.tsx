import React from 'react';
import { colorWithAlpha } from '../utils/storyCardFormatting';
import { getThemeName, getStatusName } from '../utils/statusHelpers';
import './GoalsCardView.css';

export interface GoalCardProps {
  /** Raw goal data */
  goal: {
    id: string;
    title?: string;
    description?: string;
    status?: any;
    theme?: any;
    goalKind?: string;
    kpis?: Array<{ name: string; target: any; unit?: string }>;
    [key: string]: any;
  };
  /** Resolved hex theme colour */
  themeColor: string;
  /** Theme label text (e.g. "Health", "Career") */
  themeLabel?: string;
  /** Whether this goal is the active focus goal or in the focus hierarchy */
  isFocusAligned?: boolean;
  /** Whether this card is the currently selected item */
  isSelected?: boolean;
  /** ring style override for link-mode (canvas) */
  ringOverride?: string;
  /** How much detail to show */
  detailLevel?: 'minimal' | 'compact' | 'full';
  /** Optional width cap (canvas nodes have fixed widths) */
  maxWidth?: number;
  /** KPI summary label */
  kpiLabel?: string;
  kpiTone?: 'success' | 'danger' | 'muted';
  /** Progress 0–100 */
  progressPercent?: number;
  /** Story counts */
  totalStories?: number | null;
  doneStories?: number | null;
  /** Click handler */
  onClick?: () => void;
  /** Optional action toolbar rendered at the bottom */
  actions?: React.ReactNode;
}

const statusLabel = (status: any, goalKind?: string): string => {
  if (goalKind === 'story' || goalKind === undefined) {
    if (typeof status === 'number') return getStatusName(status) || String(status);
  }
  return String(status ?? '');
};

const GoalCard: React.FC<GoalCardProps> = ({
  goal,
  themeColor,
  themeLabel,
  isFocusAligned = false,
  isSelected = false,
  ringOverride,
  detailLevel = 'compact',
  maxWidth,
  kpiLabel,
  kpiTone,
  progressPercent,
  totalStories,
  doneStories,
  onClick,
  actions,
}) => {
  const ring = ringOverride
    ? ringOverride
    : isSelected
    ? `0 0 0 2px ${themeColor}`
    : isFocusAligned
    ? 'var(--focus-gold-ring)'
    : '0 2px 6px rgba(0,0,0,0.08)';

  const borderColor = isFocusAligned
    ? 'var(--focus-gold)'
    : colorWithAlpha(themeColor, 0.3);

  const kpiColor =
    kpiTone === 'success' ? 'var(--green)' :
    kpiTone === 'danger'  ? 'var(--red)' :
    'var(--muted)';

  return (
    <div
      className={`goal-card${isFocusAligned ? ' goal-card--focus' : ''}`}
      style={{
        width: maxWidth ? maxWidth : undefined,
        border: `1px solid ${borderColor}`,
        boxShadow: ring,
        cursor: onClick ? 'pointer' : undefined,
      }}
      onClick={onClick}
    >
      <div className="goal-card__theme-strip" style={{ background: themeColor }} />
      <div className="goal-card__body">
        <div className="goal-card__title">{goal.title || 'Untitled'}</div>

        <div className="goal-card__badges">
          {/* Focus badge */}
          {isFocusAligned && (
            <span
              className="kanban-card__meta-badge"
              style={{ background: 'var(--focus-gold)', color: '#fff' }}
            >
              Focus
            </span>
          )}
          {/* Theme badge */}
          {(themeLabel || goal.theme) && (
            <span className="kanban-card__meta-badge">
              {themeLabel || getThemeName(goal.theme)}
            </span>
          )}
          {/* Status badge (compact / full) */}
          {detailLevel !== 'minimal' && goal.status != null && (
            <span className="kanban-card__meta-badge">
              {statusLabel(goal.status, goal.goalKind)}
            </span>
          )}
          {/* Goal kind (compact / full) */}
          {detailLevel !== 'minimal' && goal.goalKind && (
            <span
              className="kanban-card__meta-badge"
              style={{ textTransform: 'capitalize' }}
            >
              {goal.goalKind}
            </span>
          )}
          {/* KPI status (compact / full) */}
          {detailLevel !== 'minimal' && kpiLabel && (
            <span className="kanban-card__meta-badge" style={{ color: kpiColor }}>
              KPI: {kpiLabel}
            </span>
          )}
        </div>

        {/* KPI targets (compact / full, if kpis array present) */}
        {detailLevel !== 'minimal' && Array.isArray(goal.kpis) && goal.kpis.length > 0 && (
          <div className="goal-card__kpis">
            {goal.kpis.slice(0, 2).map((k: any) => `${k.name}: ${k.target}${k.unit ?? ''}`).join(' · ')}
          </div>
        )}

        {/* Progress bar (compact / full) */}
        {detailLevel !== 'minimal' && progressPercent != null && (
          <div style={{ marginTop: 4 }}>
            <div className="goals-card-progress__bar" style={{ background: colorWithAlpha(themeColor, 0.18) }}>
              <div
                className="goals-card-progress__bar-fill"
                style={{ width: `${progressPercent}%`, background: colorWithAlpha(themeColor, 0.55) }}
              />
            </div>
            {(totalStories != null) && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {doneStories ?? 0}/{totalStories} stories
              </div>
            )}
          </div>
        )}

        {/* Description (full only) */}
        {detailLevel === 'full' && goal.description && (
          <div className="goal-card__description">
            {String(goal.description).slice(0, 120)}
            {goal.description.length > 120 ? '…' : ''}
          </div>
        )}

        {actions && <div style={{ marginTop: 4 }}>{actions}</div>}
      </div>
    </div>
  );
};

export default GoalCard;

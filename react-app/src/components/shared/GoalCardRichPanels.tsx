/**
 * GoalCardRichPanels — the "rich" content slot used inside the shared GoalCard.
 *
 * Renders progress bars (story completion + savings) when the data is supplied.
 * Optional slots for KPI status and latest activity preview accept React nodes,
 * so the heavy data fetching can be done at the page level (different on /goals
 * vs the planner) and just dropped in here.
 *
 * Used by /goals (full inline data) and /planner?level=quarter|year (partial).
 */

import React from 'react';

export interface GoalCardRichPanelsProps {
  themeColor: string;
  /** Number of done stories under this goal. */
  doneStories?: number | null;
  /** Total number of stories under this goal. */
  totalStories?: number | null;
  /** Estimated cost in GBP (whole units). */
  estimatedCostGbp?: number | null;
  /** Current pot balance in GBP (whole units). */
  potBalanceGbp?: number | null;
  /** Optional pre-rendered KPI status chip (provided by /goals page). */
  kpiSlot?: React.ReactNode;
  /** Optional pre-rendered latest-activity preview (provided by /goals page). */
  activitySlot?: React.ReactNode;
}

const fmtMoney = (v: number | null | undefined): string => {
  if (v == null) return '';
  try {
    return v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
  } catch {
    return `£${Math.round(v)}`;
  }
};

const ProgressBar: React.FC<{ pct: number; color: string; label: string; right?: React.ReactNode }> = ({ pct, color, label, right }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--bs-secondary-color)' }}>{label}</span>
        <span style={{ color: 'var(--bs-secondary-color)', fontVariantNumeric: 'tabular-nums' }}>{right ?? `${clamped}%`}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: `${color}1f`, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: color, transition: 'width 200ms ease' }} />
      </div>
    </div>
  );
};

export const GoalCardRichPanels: React.FC<GoalCardRichPanelsProps> = ({
  themeColor,
  doneStories,
  totalStories,
  estimatedCostGbp,
  potBalanceGbp,
  kpiSlot,
  activitySlot,
}) => {
  const storyPct = (totalStories != null && totalStories > 0)
    ? ((doneStories ?? 0) / totalStories) * 100
    : null;
  const savingsPct = (estimatedCostGbp != null && estimatedCostGbp > 0)
    ? ((potBalanceGbp ?? 0) / estimatedCostGbp) * 100
    : null;

  // If there's nothing useful to show, render nothing — the GoalCard will skip.
  if (storyPct == null && savingsPct == null && !kpiSlot && !activitySlot) return null;

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {kpiSlot && <div>{kpiSlot}</div>}
      {storyPct != null && (
        <ProgressBar
          pct={storyPct}
          color={themeColor}
          label="Stories"
          right={`${doneStories ?? 0}/${totalStories} (${Math.round(storyPct)}%)`}
        />
      )}
      {savingsPct != null && (
        <ProgressBar
          pct={savingsPct}
          color={themeColor}
          label="Savings"
          right={`${fmtMoney(potBalanceGbp)} / ${fmtMoney(estimatedCostGbp)}`}
        />
      )}
      {activitySlot && (
        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--bs-secondary-color)' }}>
          {activitySlot}
        </div>
      )}
    </div>
  );
};

export default GoalCardRichPanels;

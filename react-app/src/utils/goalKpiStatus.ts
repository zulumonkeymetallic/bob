export type GoalKpiStatusLabel = 'On target' | 'Behind' | 'No KPI';
export type GoalKpiStatusTone = 'success' | 'danger' | 'muted';

export interface ResolvedGoalKpi {
  name?: string;
  metricKey?: string;
  currentDisplay?: string | null;
  currentValue?: number | null;
  target?: number | null;
  unit?: string | null;
  progressPct?: number | null;
}

export interface GoalKpiSummary {
  progressPct: number | null;
  kpiSummary: string;
  laggingReason: string | null;
}

export interface GoalKpiStatusResult extends GoalKpiSummary {
  label: GoalKpiStatusLabel;
  tone: GoalKpiStatusTone;
  reason: string;
}

const toNumber = (value: any): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const clampPct = (value: number): number => Math.max(0, Math.min(200, value));

const pct = (value: number): number => Number(clampPct(value).toFixed(1));

const average = (values: number[]): number | null => {
  if (!values.length) return null;
  return pct(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const metricLabel = (metric: ResolvedGoalKpi, index: number): string => {
  const raw = String(metric?.name || metric?.metricKey || '').trim();
  return raw || `KPI ${index + 1}`;
};

const targetLabel = (metric: ResolvedGoalKpi): string => {
  const targetNum = toNumber(metric?.target);
  const unit = String(metric?.unit || '').trim();
  if (targetNum == null) return 'target n/a';
  return unit ? `${targetNum}${unit}` : String(targetNum);
};

const currentLabel = (metric: ResolvedGoalKpi): string => {
  const currentDisplay = String(metric?.currentDisplay || '').trim();
  if (currentDisplay) return currentDisplay;
  const currentNum = toNumber(metric?.currentValue);
  if (currentNum == null) return 'current n/a';
  return String(Number(currentNum.toFixed(2)));
};

export const summariseResolvedGoalKpis = (resolvedKpis: ResolvedGoalKpi[] = []): GoalKpiSummary => {
  const rows = (resolvedKpis || [])
    .map((metric, index) => {
      const progressPct = toNumber(metric?.progressPct);
      return {
        metric,
        index,
        label: metricLabel(metric, index),
        progressPct: progressPct == null ? null : pct(progressPct),
      };
    });

  const progressRows = rows.filter((row) => row.progressPct != null) as Array<{
    metric: ResolvedGoalKpi;
    index: number;
    label: string;
    progressPct: number;
  }>;

  const progressPct = average(progressRows.map((row) => row.progressPct));
  const lagging = [...progressRows].sort((a, b) => a.progressPct - b.progressPct)[0] || null;
  const laggingReason = lagging
    ? `${lagging.label} is at ${Math.round(lagging.progressPct)}% of target`
    : null;

  const summary = rows.slice(0, 3).map((row) => {
    const metric = row.metric;
    return `${row.label}: ${currentLabel(metric)} / ${targetLabel(metric)}`;
  });
  const suffix = rows.length > 3 ? ` +${rows.length - 3} more` : '';
  const kpiSummary = summary.length ? `${summary.join(' • ')}${suffix}` : 'No KPI attached';

  return { progressPct, kpiSummary, laggingReason };
};

export const computeWindowExpectedProgress = (
  startMs: number | null | undefined,
  endMs: number | null | undefined,
  nowMs: number = Date.now(),
): number | null => {
  if (!Number.isFinite(Number(startMs)) || !Number.isFinite(Number(endMs))) return null;
  const start = Number(startMs);
  const end = Number(endMs);
  if (end <= start) return null;
  const elapsed = Math.max(0, Math.min(nowMs - start, end - start));
  return pct((elapsed / (end - start)) * 100);
};

export const evaluateGoalTargetStatus = ({
  resolvedKpis = [],
  fallbackProgressPct = null,
  expectedProgressPct = null,
  scopeLabel = 'timeline',
}: {
  resolvedKpis?: ResolvedGoalKpi[];
  fallbackProgressPct?: number | null;
  expectedProgressPct?: number | null;
  scopeLabel?: string;
}): GoalKpiStatusResult => {
  const summary = summariseResolvedGoalKpis(resolvedKpis);
  const fallback = toNumber(fallbackProgressPct);
  const expected = toNumber(expectedProgressPct);
  const progressPct = summary.progressPct ?? (fallback == null ? null : pct(fallback));

  if (progressPct == null) {
    return {
      ...summary,
      progressPct: null,
      label: 'No KPI',
      tone: 'muted',
      reason: 'No KPI progress has been recorded for this goal yet.',
    };
  }

  if (expected != null) {
    const onTarget = progressPct >= expected - 5;
    const baselineReason = onTarget
      ? `Progress ${Math.round(progressPct)}% vs expected ${Math.round(expected)}% for ${scopeLabel}.`
      : `Progress ${Math.round(progressPct)}% is below expected ${Math.round(expected)}% for ${scopeLabel}.`;
    return {
      ...summary,
      progressPct,
      label: onTarget ? 'On target' : 'Behind',
      tone: onTarget ? 'success' : 'danger',
      reason: !onTarget && summary.laggingReason
        ? `${summary.laggingReason}. ${baselineReason}`
        : baselineReason,
    };
  }

  const onTarget = progressPct >= 95;
  const fallbackReason = onTarget
    ? `Progress is ${Math.round(progressPct)}% against linked KPI targets.`
    : `Progress is ${Math.round(progressPct)}% against linked KPI targets.`;
  return {
    ...summary,
    progressPct,
    label: onTarget ? 'On target' : 'Behind',
    tone: onTarget ? 'success' : 'danger',
    reason: !onTarget && summary.laggingReason
      ? `${summary.laggingReason}. ${fallbackReason}`
      : fallbackReason,
  };
};

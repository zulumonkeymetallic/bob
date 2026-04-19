const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const clampPct = (value) => Math.max(0, Math.min(200, value));

const pct = (value) => Number(clampPct(value).toFixed(1));

const computeExpectedProgressPct = (startMs, endMs, nowMs = Date.now()) => {
  const start = toNumber(startMs);
  const end = toNumber(endMs);
  if (start == null || end == null || end <= start) return null;
  const elapsed = Math.max(0, Math.min(nowMs - start, end - start));
  return pct((elapsed / (end - start)) * 100);
};

const average = (values) => {
  if (!Array.isArray(values) || !values.length) return null;
  return pct(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const metricLabel = (metric, index) => {
  const raw = String(metric?.name || metric?.metricKey || '').trim();
  return raw || `KPI ${index + 1}`;
};

const targetLabel = (metric) => {
  const targetNum = toNumber(metric?.target);
  const unit = String(metric?.unit || '').trim();
  if (targetNum == null) return 'target n/a';
  return unit ? `${targetNum}${unit}` : String(targetNum);
};

const currentLabel = (metric) => {
  const display = String(metric?.currentDisplay || '').trim();
  if (display) return display;
  const currentNum = toNumber(metric?.currentValue);
  if (currentNum == null) return 'current n/a';
  return String(Number(currentNum.toFixed(2)));
};

const summariseResolvedGoalKpis = (resolvedKpis = []) => {
  const rows = (Array.isArray(resolvedKpis) ? resolvedKpis : [])
    .map((metric, index) => {
      const progressPct = toNumber(metric?.progressPct);
      return {
        metric,
        label: metricLabel(metric, index),
        progressPct: progressPct == null ? null : pct(progressPct),
      };
    });

  const progressRows = rows.filter((row) => row.progressPct != null);
  const progressPct = average(progressRows.map((row) => row.progressPct));
  const lagging = [...progressRows].sort((a, b) => a.progressPct - b.progressPct)[0] || null;
  const laggingReason = lagging
    ? `${lagging.label} is at ${Math.round(lagging.progressPct)}% of target`
    : null;

  const summaryParts = rows.slice(0, 3).map((row) => (
    `${row.label}: ${currentLabel(row.metric)} / ${targetLabel(row.metric)}`
  ));
  const suffix = rows.length > 3 ? ` +${rows.length - 3} more` : '';
  const kpiSummary = summaryParts.length ? `${summaryParts.join(' • ')}${suffix}` : 'No KPI attached';

  return { progressPct, kpiSummary, laggingReason };
};

const evaluateGoalKpiStatus = ({
  resolvedKpis = [],
  fallbackProgressPct = null,
  expectedProgressPct = null,
  scopeLabel = 'timeline',
}) => {
  const summary = summariseResolvedGoalKpis(resolvedKpis);
  const fallback = toNumber(fallbackProgressPct);
  const expected = toNumber(expectedProgressPct);
  const progressPct = summary.progressPct != null ? summary.progressPct : (fallback == null ? null : pct(fallback));

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
  const fallbackReason = `Progress is ${Math.round(progressPct)}% against linked KPI targets.`;
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

module.exports = {
  computeExpectedProgressPct,
  summariseResolvedGoalKpis,
  evaluateGoalKpiStatus,
};

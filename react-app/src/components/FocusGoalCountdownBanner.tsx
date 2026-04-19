import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, ProgressBar, Row, Col, Button } from 'react-bootstrap';
import { AlertCircle, Zap, Target } from 'lucide-react';
import { FocusGoal, Goal, Story } from '../types';
import { FitnessKPIQuickStatus } from './FitnessKPIDisplay';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { getGoalDisplayPath, getProtectedFocusGoalIds, isGoalInHierarchySet } from '../utils/goalHierarchy';

interface MonzoGoalSummary {
  goalId: string;
  potBalance: number;
  fundedPercent: number | null;
  shortfall: number;
  monthlyRequired: number | null;
  potName: string | null;
}

interface GoalKpiMetricRow {
  resolvedKpis?: any[];
  updatedAt?: any;
}

interface FocusGoalCountdownBannerProps {
  focusGoal: FocusGoal;
  goals: Goal[];
  stories: Story[];
  onEdit?: () => void;
  onDelete?: () => void;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  compact?: boolean;
  monzoBudgetSummary?: any;
  monzoGoalAlignment?: { goals: MonzoGoalSummary[] } | null;
}

const getUrgency = (daysRemaining: number): 'critical' | 'high' | 'normal' | 'low' => {
  if (daysRemaining <= 3) return 'critical';
  if (daysRemaining <= 7) return 'high';
  if (daysRemaining <= 14) return 'normal';
  return 'low';
};

const getUrgencyColor = (urgency: 'critical' | 'high' | 'normal' | 'low'): string => {
  switch (urgency) {
    case 'critical':
      return 'var(--color-urgency-critical)';
    case 'high':
      return 'var(--color-urgency-high)';
    case 'normal':
      return 'var(--brand)';
    case 'low':
      return 'var(--color-urgency-low)';
  }
};

const getUrgencyIcon = (urgency: 'critical' | 'high' | 'normal' | 'low'): string => {
  switch (urgency) {
    case 'critical':
      return '🔥';
    case 'high':
      return '⚡';
    case 'normal':
      return '🎯';
    case 'low':
      return '✓';
  }
};

/**
 * Countdown banner showing focus goals with progress & time remaining
 * Displays in:
 * - Metrics/Progress dashboard (main widget)
 * - Goal list view (compact)
 * - Email template (text-only)
 */
export const FocusGoalCountdownBanner: React.FC<FocusGoalCountdownBannerProps> = ({
  focusGoal,
  goals,
  stories,
  monzoBudgetSummary,
  monzoGoalAlignment,
  onEdit,
  onDelete,
  onRefresh,
  refreshing = false,
  compact = false
}) => {
  const [goalKpiMetrics, setGoalKpiMetrics] = useState<Record<string, GoalKpiMetricRow>>({});
  const protectedGoalIds = useMemo(() => new Set(getProtectedFocusGoalIds(focusGoal)), [focusGoal]);
  const ownerUid = useMemo(
    () => String((focusGoal as any)?.ownerUid || goals.find((goal) => !!(goal as any)?.ownerUid)?.ownerUid || '').trim(),
    [focusGoal, goals]
  );

  const focusRootGoalIds = useMemo(() => (
    Array.isArray(focusGoal.focusRootGoalIds) && focusGoal.focusRootGoalIds.length > 0
      ? focusGoal.focusRootGoalIds
      : focusGoal.goalIds || []
  ), [focusGoal.focusRootGoalIds, focusGoal.goalIds]);

  const focusLeafGoalIds = useMemo(() => (
    Array.isArray(focusGoal.focusLeafGoalIds) && focusGoal.focusLeafGoalIds.length > 0
      ? focusGoal.focusLeafGoalIds
      : focusGoal.goalIds || []
  ), [focusGoal.focusLeafGoalIds, focusGoal.goalIds]);

  useEffect(() => {
    if (!ownerUid) {
      setGoalKpiMetrics({});
      return;
    }
    const metricsQuery = query(collection(db, 'goal_kpi_metrics'), where('ownerUid', '==', ownerUid));
    const unsubscribe = onSnapshot(metricsQuery, (snap) => {
      const next: Record<string, GoalKpiMetricRow> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const goalId = String(data?.goalId || '').trim();
        if (!goalId || !isGoalInHierarchySet(goalId, goals, protectedGoalIds)) return;
        next[goalId] = {
          resolvedKpis: Array.isArray(data?.resolvedKpis) ? data.resolvedKpis : [],
          updatedAt: data?.updatedAt || null,
        };
      });
      setGoalKpiMetrics(next);
    }, () => {
      setGoalKpiMetrics({});
    });
    return () => unsubscribe();
  }, [goals, ownerUid, protectedGoalIds]);

  const buildKpiSeries = (kpi: any): number[] => {
    const series = Array.isArray(kpi?.weeklyValues)
      ? kpi.weeklyValues
          .map((entry: any) => Number(entry?.value))
          .filter((value: number) => Number.isFinite(value))
      : [];
    if (series.length >= 2) return series.slice(-8);
    const current = Number(kpi?.currentValue);
    const target = Number(kpi?.targetNormalized ?? kpi?.target);
    if (Number.isFinite(current) && Number.isFinite(target) && target > 0) {
      const baseline = Math.max(0, Math.min(target, current * 0.75));
      return [baseline, current, target];
    }
    if (Number.isFinite(current)) return [Math.max(0, current * 0.75), current];
    return [];
  };

  const renderMiniSparkline = (values: number[]) => {
    if (!values || values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const width = 72;
    const height = 22;
    const points = values
      .map((value, idx) => {
        const x = values.length === 1 ? 0 : (idx / (values.length - 1)) * width;
        const y = height - ((value - min) / range) * (height - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="KPI trend">
        <polyline
          points={points}
          fill="none"
          stroke="#667eea"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  // Get selected goals
  const selectedGoals = useMemo(
    () => goals.filter(g => focusLeafGoalIds.includes(g.id)),
    [goals, focusLeafGoalIds]
  );

  const rootGoals = useMemo(
    () => goals.filter((goal) => focusRootGoalIds.includes(goal.id)),
    [goals, focusRootGoalIds]
  );

  // Get stories linked to focus goals
  const focusStories = useMemo(
    () => stories.filter((story) => isGoalInHierarchySet(String(story.goalId || '').trim(), goals, protectedGoalIds)),
    [goals, protectedGoalIds, stories]
  );

  // Calculate story progress
  const storyStats = useMemo(() => {
    const total = focusStories.length;
    const done = focusStories.filter(s => s.status === 4).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, progress };
  }, [focusStories]);

  const alignmentStats = useMemo(() => {
    const nonFocus = goals.filter((goal) => !isGoalInHierarchySet(goal.id, goals, protectedGoalIds) && goal.status !== 2);
    const deferredNonFocus = nonFocus.filter((g) => Number(g.status || 0) === 4).length;
    const alignedPercent = nonFocus.length
      ? Math.round((deferredNonFocus / nonFocus.length) * 100)
      : 100;
    return {
      nonFocusCount: nonFocus.length,
      deferredNonFocus,
      alignedPercent,
    };
  }, [goals, protectedGoalIds]);

  // Build a quick lookup: goalId → Monzo alignment summary
  const monzoPotByGoalId = useMemo(() => {
    const map: Record<string, MonzoGoalSummary> = {};
    for (const gs of (monzoGoalAlignment?.goals ?? [])) {
      map[gs.goalId] = gs;
    }
    return map;
  }, [monzoGoalAlignment]);

  // Finance guardrail: fires when current-month discretionary > 50% of income while < 50% of month elapsed
  const financeGuardrail = useMemo(() => {
    if (!monzoBudgetSummary) return null;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cm = (monzoBudgetSummary.monthly ?? {})[monthKey];
    if (!cm) return null;
    const income = cm.income || monzoBudgetSummary.totals?.income || 0;
    const optional = cm.optional || 0;
    if (income <= 0) return null;
    const discretionaryPct = (optional / income) * 100;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthElapsedPct = (now.getDate() / daysInMonth) * 100;
    if (discretionaryPct > 50 && monthElapsedPct < 50) {
      return {
        discretionaryPct: Math.round(discretionaryPct),
        monthElapsedPct: Math.round(monthElapsedPct),
        optionalSpend: optional,
      };
    }
    return null;
  }, [monzoBudgetSummary]);

  const urgency = getUrgency(focusGoal.daysRemaining || 0);
  const urgencyColor = getUrgencyColor(urgency);

  if (compact) {
    return (
      <div
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px'
        }}
      >
        <Zap size={18} />
        <div style={{ flex: 1 }}>
          <strong>{selectedGoals.length} focus goals</strong> • {focusGoal.daysRemaining} days left
        </div>
        {onEdit && (
          <Button size="sm" variant="light" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card
      style={{
        border: `2px solid ${urgencyColor}`,
        background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%)',
        marginBottom: '24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}
    >
      <Card.Body style={{ padding: '20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                fontSize: '32px',
                background: urgencyColor,
                color: 'white',
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Zap size={24} />
            </div>
            <div>
              <h5 style={{ margin: 0, fontWeight: '700' }}>
                {getUrgencyIcon(urgency)} {focusGoal.title?.trim() || 'Focus Goals'}
              </h5>
              <small style={{ color: 'var(--muted)' }}>
                {focusGoal.timeframe === 'sprint'
                  ? 'This Sprint'
                  : focusGoal.timeframe === 'quarter'
                    ? 'This Quarter'
                    : 'This Year'}
              </small>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: urgencyColor }}>
              {focusGoal.daysRemaining}
            </div>
            <small style={{ color: 'var(--muted)' }}>days left</small>
            {onRefresh && (
              <div style={{ marginTop: '8px' }}>
                <Button size="sm" variant="outline-secondary" onClick={onRefresh} disabled={refreshing}>
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Days remaining progress */}
        <div style={{ marginBottom: '20px' }}>
          <ProgressBar now={Math.max(0, 100 - ((focusGoal.daysRemaining || 0) / 14) * 100)} variant="warning" />
          <small style={{ color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
            {focusGoal.daysRemaining === 1 ? '1 day remains' : `${focusGoal.daysRemaining} days remain`}
          </small>
        </div>

        {/* Finance guardrail warning */}
        {financeGuardrail && (
          <div style={{
            background: 'color-mix(in srgb, var(--color-urgency-medium) 12%, var(--card))',
            border: '1px solid color-mix(in srgb, var(--color-urgency-medium) 40%, transparent)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px'
          }}>
            <AlertCircle size={18} style={{ color: 'var(--color-urgency-medium)', flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '13px', color: 'var(--color-urgency-medium)' }}>
              <strong>Finance Guardrail:</strong> Discretionary spend is{' '}
              <strong>{financeGuardrail.discretionaryPct}% of income</strong> but only{' '}
              {financeGuardrail.monthElapsedPct}% of the month has elapsed.
              Consider reviewing non-essential spending to protect goal budgets.
            </div>
          </div>
        )}

        {/* Goals Overview */}
        <Row style={{ marginBottom: '20px' }}>
          <Col md={4}>
            <div style={{ textAlign: 'center', padding: '12px', background: 'var(--panel)', borderRadius: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--brand)' }}>
                {rootGoals.length}
              </div>
              <small style={{ color: 'var(--muted)' }}>Programs</small>
            </div>
          </Col>
          <Col md={4}>
            <div style={{ textAlign: 'center', padding: '12px', background: 'var(--panel)', borderRadius: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--color-status-done)' }}>
                {selectedGoals.length}
              </div>
              <small style={{ color: 'var(--muted)' }}>Leaf Goals</small>
            </div>
          </Col>
          <Col md={4}>
            <div style={{ textAlign: 'center', padding: '12px', background: 'var(--panel)', borderRadius: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#fd7e14' }}>
                {storyStats.total > 0
                  ? `${storyStats.done}/${storyStats.total}`
                  : '—'}
              </div>
              <small style={{ color: 'var(--muted)' }}>Stories Complete</small>
            </div>
          </Col>
        </Row>

        <div style={{
          marginBottom: '16px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: 'var(--panel)',
          border: '1px solid #e9ecef',
          fontSize: '12px',
          color: '#495057'
        }}>
          <strong>Focus Alignment:</strong> {rootGoals.length} program goal{rootGoals.length === 1 ? '' : 's'} • {selectedGoals.length} execution leaf goal{selectedGoals.length === 1 ? '' : 's'} • {alignmentStats.deferredNonFocus}/{alignmentStats.nonFocusCount} non-focus goals deferred ({alignmentStats.alignedPercent}% aligned)
        </div>

        {rootGoals.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <h6 style={{ fontWeight: '600', marginBottom: '8px' }}>Program Goals</h6>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {rootGoals.map((goal) => (
                <Badge key={goal.id} bg="light" text="dark" pill style={{ padding: '8px 10px', fontWeight: 500 }}>
                  {getGoalDisplayPath(goal.id, goals)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Goals List */}
        <div style={{ marginBottom: '16px' }}>
          <h6 style={{ fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Target size={16} />
            Execution Leaf Goals
          </h6>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {selectedGoals.map(goal => {
              const goalStories = focusStories.filter(s => s.goalId === goal.id);
              const storyDone = goalStories.filter(s => s.status === 4).length;
              const storyProgress = goalStories.length > 0 ? Math.round((storyDone / goalStories.length) * 100) : 0;
              const monzoPot = monzoPotByGoalId[goal.id] ?? null;
              const resolvedKpis = Array.isArray(goalKpiMetrics[goal.id]?.resolvedKpis)
                ? goalKpiMetrics[goal.id]?.resolvedKpis || []
                : [];

              return (
                <Card key={goal.id} style={{ borderLeft: `4px solid #667eea` }}>
                  <Card.Body style={{ padding: '12px' }}>
                    <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '13px' }}>
                      {getGoalDisplayPath(goal.id, goals)}
                      {goal.status === 2 && (
                        <Badge bg="success" className="ms-2" style={{ fontSize: '10px' }}>
                          ✓
                        </Badge>
                      )}
                    </div>

                    {goalStories.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '11px',
                            color: 'var(--muted)',
                            marginBottom: '4px'
                          }}
                        >
                          <span>Stories</span>
                          <span>
                            {storyDone}/{goalStories.length}
                          </span>
                        </div>
                        <ProgressBar now={Math.round(storyProgress)} style={{ height: '6px' }} />
                      </div>
                    )}

                    {/* Fitness KPIs if present */}
                    {goal.kpis && goal.kpis.length > 0 && (
                      <div style={{ marginTop: '8px', fontSize: '11px' }}>
                        <FitnessKPIQuickStatus kpis={goal.kpis} />
                      </div>
                    )}

                    {resolvedKpis.length > 0 && (
                      <div style={{ marginTop: '8px', fontSize: '11px' }}>
                        <div style={{ color: '#495057', fontWeight: 600, marginBottom: '4px' }}>
                          KPI trends
                        </div>
                        {resolvedKpis.slice(0, 2).map((kpi: any, idx: number) => {
                          const current = Number(kpi?.currentValue);
                          const target = Number(kpi?.targetNormalized ?? kpi?.target);
                          const currentDisplay = kpi?.currentDisplay || (Number.isFinite(current) ? String(Math.round(current * 100) / 100) : '—');
                          const targetDisplay = Number.isFinite(target) ? String(Math.round(target * 100) / 100) : '—';
                          const series = buildKpiSeries(kpi);

                          return (
                            <div key={`${goal.id}-kpi-${idx}`} style={{ marginBottom: idx < 1 ? '6px' : 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ color: '#6c757d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {String(kpi?.name || 'KPI')}
                                  </div>
                                  <div style={{ color: '#212529', fontWeight: 600 }}>
                                    {currentDisplay} / {targetDisplay}
                                  </div>
                                </div>
                                {renderMiniSparkline(series)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Savings pot progress (Monzo-linked) */}
                    {goal.estimatedCost && goal.estimatedCost > 0 && monzoPot ? (
                      <div style={{ marginTop: '8px', fontSize: '11px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: '3px' }}>
                          <span>💰 {monzoPot.potName ?? 'Savings pot'}</span>
                          <span style={{ color: monzoPot.fundedPercent && monzoPot.fundedPercent >= 100 ? '#28a745' : '#fd7e14', fontWeight: '600' }}>
                            £{monzoPot.potBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} / £{goal.estimatedCost.toLocaleString()}
                          </span>
                        </div>
                        {monzoPot.fundedPercent != null && (
                          <ProgressBar
                            now={monzoPot.fundedPercent}
                            variant={monzoPot.fundedPercent >= 100 ? 'success' : monzoPot.fundedPercent >= 50 ? 'warning' : 'danger'}
                            style={{ height: '5px' }}
                          />
                        )}
                        {monzoPot.shortfall > 0 && monzoPot.monthlyRequired && (
                          <div style={{ color: '#6c757d', marginTop: '3px' }}>
                            £{Math.ceil(monzoPot.monthlyRequired).toLocaleString()}/mo needed
                          </div>
                        )}
                      </div>
                    ) : goal.estimatedCost && goal.estimatedCost > 0 ? (
                      <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--muted)' }}>
                        💰 Budget: £{goal.estimatedCost.toLocaleString()}
                      </div>
                    ) : null}
                  </Card.Body>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Overall Progress */}
        <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--panel)', borderRadius: '8px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontWeight: '600'
            }}
          >
            <span>Overall Progress</span>
            <span style={{ color: 'var(--brand)' }}>{storyStats.progress}%</span>
          </div>
          <ProgressBar now={storyStats.progress} variant="info" />
          <small style={{ color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
            {storyStats.done}/{storyStats.total} stories complete
          </small>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {onEdit && (
            <Button size="sm" variant="outline-primary" onClick={onEdit}>
              Edit Focus Goals
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="outline-danger" onClick={onDelete}>
              Delete Focus Set
            </Button>
          )}
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => window.location.href = '/metrics/progress'}
          >
            View Details
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

/**
 * Text-only banner for email templates
 */
export const FocusGoalCountdownEmailBanner = (focusGoal: FocusGoal, goals: Goal[]): string => {
  const protectedGoalIds = new Set(getProtectedFocusGoalIds(focusGoal));
  const selectedGoals = goals.filter((goal) => isGoalInHierarchySet(goal.id, goals, protectedGoalIds));
  const urgency = getUrgency(focusGoal.daysRemaining || 0);

  return `
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
        <span style="font-size: 28px;">${getUrgencyIcon(urgency)}</span>
        <div>
          <strong style="font-size: 18px;">Focus Goals Reminder</strong>
          <div style="font-size: 12px; opacity: 0.9;">${focusGoal.daysRemaining} days remaining</div>
        </div>
      </div>
      <div style="margin-bottom: 12px;">
        <strong>${selectedGoals.length} goals in focus:</strong>
        <ul style="margin: 8px 0; padding-left: 20px; font-size: 13px;">
          ${selectedGoals.map((goal) => `<li>${getGoalDisplayPath(goal.id, goals)}</li>`).join('')}
        </ul>
      </div>
      <a href="https://bob.jc1.tech/metrics/progress" style="background: white; color: #667eea; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; font-size: 12px;">
        View Focus Goals Progress →
      </a>
    </div>
  `;
};

export default FocusGoalCountdownBanner;

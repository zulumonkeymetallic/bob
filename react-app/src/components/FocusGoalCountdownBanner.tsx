import React, { useMemo } from 'react';
import { Card, Badge, ProgressBar, Row, Col, Button } from 'react-bootstrap';
import { AlertCircle, Zap, Calendar, Target, TrendingUp } from 'lucide-react';
import { FocusGoal, Goal, Story } from '../types';
import { FitnessKPIQuickStatus } from './FitnessKPIDisplay';

interface MonzoGoalSummary {
  goalId: string;
  potBalance: number;
  fundedPercent: number | null;
  shortfall: number;
  monthlyRequired: number | null;
  potName: string | null;
}

interface FocusGoalCountdownBannerProps {
  focusGoal: FocusGoal;
  goals: Goal[];
  stories: Story[];
  onEdit?: () => void;
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
      return '#dc3545';
    case 'high':
      return '#fd7e14';
    case 'normal':
      return '#0066cc';
    case 'low':
      return '#6c757d';
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
  onRefresh,
  refreshing = false,
  compact = false
}) => {
  // Get selected goals
  const selectedGoals = useMemo(
    () => goals.filter(g => focusGoal.goalIds.includes(g.id)),
    [goals, focusGoal.goalIds]
  );

  // Get stories linked to focus goals
  const focusStories = useMemo(
    () => stories.filter(s => focusGoal.goalIds.includes(s.goalId)),
    [stories, focusGoal.goalIds]
  );

  // Calculate story progress
  const storyStats = useMemo(() => {
    const total = focusStories.length;
    const done = focusStories.filter(s => s.status === 4).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, progress };
  }, [focusStories]);

  // Calculate overall goal progress
  const goalProgress = useMemo(() => {
    const total = selectedGoals.length;
    const done = selectedGoals.filter(g => g.status === 2).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, progress };
  }, [selectedGoals]);

  const alignmentStats = useMemo(() => {
    const selectedSet = new Set(focusGoal.goalIds || []);
    const nonFocus = goals.filter((g) => !selectedSet.has(g.id) && g.status !== 2);
    const deferredNonFocus = nonFocus.filter((g) => Number(g.status || 0) === 4).length;
    const alignedPercent = nonFocus.length
      ? Math.round((deferredNonFocus / nonFocus.length) * 100)
      : 100;
    return {
      nonFocusCount: nonFocus.length,
      deferredNonFocus,
      alignedPercent,
    };
  }, [goals, focusGoal.goalIds]);

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
                {getUrgencyIcon(urgency)} Focus Goals
              </h5>
              <small style={{ color: '#666' }}>
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
            <small style={{ color: '#666' }}>days left</small>
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
          <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
            {focusGoal.daysRemaining === 1 ? '1 day remains' : `${focusGoal.daysRemaining} days remain`}
          </small>
        </div>

        {/* Finance guardrail warning */}
        {financeGuardrail && (
          <div style={{
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px'
          }}>
            <AlertCircle size={18} style={{ color: '#856404', flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '13px', color: '#856404' }}>
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
            <div style={{ textAlign: 'center', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#0066cc' }}>
                {selectedGoals.length}
              </div>
              <small style={{ color: '#666' }}>Focus Goals</small>
            </div>
          </Col>
          <Col md={4}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#28a745' }}>
                {storyStats.total}
              </div>
              <small style={{ color: '#666' }}>Stories</small>
            </div>
          </Col>
          <Col md={4}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#fd7e14' }}>
                {goalProgress.total > 0
                  ? `${goalProgress.done}/${goalProgress.total}`
                  : '—'}
              </div>
              <small style={{ color: '#666' }}>Goals Complete</small>
            </div>
          </Col>
        </Row>

        <div style={{
          marginBottom: '16px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          fontSize: '12px',
          color: '#495057'
        }}>
          <strong>Focus Alignment:</strong> {selectedGoals.length} goals selected • {alignmentStats.deferredNonFocus}/{alignmentStats.nonFocusCount} non-focus goals deferred ({alignmentStats.alignedPercent}% aligned)
        </div>

        {/* Goals List */}
        <div style={{ marginBottom: '16px' }}>
          <h6 style={{ fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Target size={16} />
            Selected Goals
          </h6>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {selectedGoals.map(goal => {
              const goalStories = focusStories.filter(s => s.goalId === goal.id);
              const storyDone = goalStories.filter(s => s.status === 4).length;
              const storyProgress = goalStories.length > 0 ? Math.round((storyDone / goalStories.length) * 100) : 0;
              const monzoPot = monzoPotByGoalId[goal.id] ?? null;

              return (
                <Card key={goal.id} style={{ borderLeft: `4px solid #667eea` }}>
                  <Card.Body style={{ padding: '12px' }}>
                    <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '13px' }}>
                      {goal.title}
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
                            color: '#666',
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

                    {/* Savings pot progress (Monzo-linked) */}
                    {goal.estimatedCost && goal.estimatedCost > 0 && monzoPot ? (
                      <div style={{ marginTop: '8px', fontSize: '11px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', marginBottom: '3px' }}>
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
                      <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
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
        <div style={{ marginBottom: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontWeight: '600'
            }}
          >
            <span>Overall Progress</span>
            <span style={{ color: '#0066cc' }}>{storyStats.progress}%</span>
          </div>
          <ProgressBar now={storyStats.progress} variant="info" />
          <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
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
  const selectedGoals = goals.filter(g => focusGoal.goalIds.includes(g.id));
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
          ${selectedGoals.map(g => `<li>${g.title}</li>`).join('')}
        </ul>
      </div>
      <a href="https://bob.jc1.tech/metrics/progress" style="background: white; color: #667eea; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; font-size: 12px;">
        View Focus Goals Progress →
      </a>
    </div>
  `;
};

export default FocusGoalCountdownBanner;

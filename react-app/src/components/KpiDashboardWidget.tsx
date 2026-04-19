import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ProgressBar, Spinner } from 'react-bootstrap';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Activity, Pin, Target, TrendingUp } from 'lucide-react';
import { db } from '../firebase';
import { useSidebar } from '../contexts/SidebarContext';
import type { Goal, Story, Task } from '../types';
import type { Kpi } from '../types/KpiTypes';
import { buildSprintDeferRecommendations, type CapacitySummaryLike, type SprintLike } from '../utils/prioritizationInsights';
import { isGoalInHierarchySet } from '../utils/goalHierarchy';
import { formatKpiValue, getKpiStateBadge, getKpiStateLabel, toKpiNumber } from '../utils/kpiDisplay';
import { ActivityStreamService } from '../services/ActivityStreamService';

interface GoalMetricDoc {
  resolvedKpis?: Array<Record<string, any>>;
  updatedAt?: any;
}

interface KpiDashboardWidgetProps {
  ownerUid: string;
  goals: Goal[];
  stories: Story[];
  tasks: Task[];
  activeFocusGoalIds?: Set<string>;
  selectedSprintId?: string | null;
  capacitySummary?: CapacitySummaryLike | null;
  nextSprint?: SprintLike | null;
  onOpenFocusGoals?: () => void;
}

interface DashboardKpiCard {
  goalId: string;
  goalTitle: string;
  kpiId: string;
  name: string;
  type: string;
  visualizationType: string;
  target: number | null;
  unit: string;
  progressPct: number | null;
  currentDisplay: string;
  targetDisplay: string;
  series: number[];
  healthy?: boolean | null;
  stale?: boolean | null;
}

const toSeries = (kpi: Record<string, any>): number[] => {
  const weeklyValues = Array.isArray(kpi?.weeklyValues) ? kpi.weeklyValues : [];
  const values = weeklyValues
    .map((entry: any) => Number(entry?.value))
    .filter((value: number) => Number.isFinite(value));
  if (values.length >= 2) return values.slice(-8);
  const current = toKpiNumber(kpi?.currentValue ?? kpi?.current);
  const target = toKpiNumber(kpi?.targetNormalized ?? kpi?.target);
  if (current != null && target != null) return [Math.max(0, current * 0.75), current, target];
  if (current != null) return [Math.max(0, current * 0.75), current];
  return [];
};

const renderSparkline = (values: number[], variant: 'line' | 'bar') => {
  if (values.length < 2) return null;
  const width = 86;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  if (variant === 'bar') {
    const barWidth = Math.max(6, Math.floor(width / values.length) - 3);
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="KPI bars">
        {values.map((value, index) => {
          const x = index * (barWidth + 3);
          const barHeight = Math.max(2, ((value - min) / range) * (height - 4));
          return (
            <rect
              key={`${value}-${index}`}
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              fill="#2563eb"
            />
          );
        })}
      </svg>
    );
  }

  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="KPI trend">
      <polyline
        points={points}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const KpiDashboardWidget: React.FC<KpiDashboardWidgetProps> = ({
  ownerUid,
  goals,
  stories,
  tasks,
  activeFocusGoalIds = new Set<string>(),
  selectedSprintId = null,
  capacitySummary = null,
  nextSprint = null,
  onOpenFocusGoals,
}) => {
  const { showSidebar } = useSidebar();
  const [metricsByGoal, setMetricsByGoal] = useState<Record<string, GoalMetricDoc>>({});
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerUid) {
      setMetricsByGoal({});
      return;
    }
    const metricsQuery = query(collection(db, 'goal_kpi_metrics'), where('ownerUid', '==', ownerUid));
    const unsubscribe = onSnapshot(metricsQuery, (snap) => {
      const next: Record<string, GoalMetricDoc> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const goalId = String(data?.goalId || '').trim();
        if (!goalId) return;
        next[goalId] = {
          resolvedKpis: Array.isArray(data?.resolvedKpis) ? data.resolvedKpis : [],
          updatedAt: data?.updatedAt || null,
        };
      });
      setMetricsByGoal(next);
    }, () => {
      setMetricsByGoal({});
    });
    return () => unsubscribe();
  }, [ownerUid]);

  const pinnedKpis = useMemo<DashboardKpiCard[]>(() => {
    const cards: DashboardKpiCard[] = [];
    const activeFocusIds = activeFocusGoalIds.size > 0 ? activeFocusGoalIds : new Set(goals.map((goal) => goal.id));

    goals
      .filter((goal) => isGoalInHierarchySet(goal.id, goals, activeFocusIds) || Array.isArray((goal as any).kpisV2))
      .forEach((goal) => {
        const rawKpis = (Array.isArray((goal as any).kpisV2) ? (goal as any).kpisV2 : []) as Kpi[];
        const metricRows = metricsByGoal[goal.id]?.resolvedKpis || [];

        rawKpis
          .filter((kpi) => kpi.displayOnDashboard === true)
          .forEach((kpi) => {
            const resolved = metricRows.find((entry) => String(entry?.id || entry?.metricKey || entry?.name || '') === String(kpi.id || kpi.metricId || kpi.name || ''))
              || metricRows.find((entry) => String(entry?.name || '').trim() === String(kpi.name || '').trim())
              || {};
            const currentValue = toKpiNumber(resolved?.currentValue ?? (kpi as any).current);
            const targetValue = toKpiNumber(resolved?.targetNormalized ?? resolved?.target ?? kpi.target);
            cards.push({
              goalId: goal.id,
              goalTitle: goal.title,
              kpiId: kpi.id,
              name: kpi.name,
              type: kpi.type,
              visualizationType: kpi.visualizationType || 'progress',
              target: targetValue,
              unit: resolved?.unit || kpi.unit || '',
              progressPct: toKpiNumber(resolved?.progressPct ?? (kpi as any).progress),
              currentDisplay: String(resolved?.currentDisplay || formatKpiValue(currentValue, resolved?.unit || kpi.unit || '')),
              targetDisplay: targetValue == null ? '—' : formatKpiValue(targetValue, resolved?.unit || kpi.unit || ''),
              series: toSeries({
                ...resolved,
                currentValue,
                target: targetValue,
              }),
              healthy: resolved?.healthy === true,
              stale: resolved?.stale === true || resolved?.healthy === false,
            });
          });
      });

    if (cards.length > 0) return cards.slice(0, 4);

    const fallback: DashboardKpiCard[] = [];
    goals
      .filter((goal) => isGoalInHierarchySet(goal.id, goals, activeFocusIds))
      .slice(0, 4)
      .forEach((goal) => {
        const resolved = (metricsByGoal[goal.id]?.resolvedKpis || [])[0];
        if (!resolved) return;
        const currentValue = toKpiNumber(resolved?.currentValue);
        const targetValue = toKpiNumber(resolved?.targetNormalized ?? resolved?.target);
        fallback.push({
          goalId: goal.id,
          goalTitle: goal.title,
          kpiId: String(resolved?.id || resolved?.metricKey || resolved?.name || goal.id),
          name: String(resolved?.name || 'KPI'),
          type: String(resolved?.metricKey || 'custom'),
          visualizationType: 'progress',
          target: targetValue,
          unit: String(resolved?.unit || ''),
          progressPct: toKpiNumber(resolved?.progressPct),
          currentDisplay: String(resolved?.currentDisplay || formatKpiValue(currentValue, resolved?.unit || '')),
          targetDisplay: targetValue == null ? '—' : formatKpiValue(targetValue, resolved?.unit || ''),
          series: toSeries(resolved),
          healthy: resolved?.healthy === true,
          stale: resolved?.stale === true || resolved?.healthy === false,
        });
      });
    return fallback;
  }, [activeFocusGoalIds, goals, metricsByGoal]);

  const deferRecommendations = useMemo(() => buildSprintDeferRecommendations({
    goals,
    stories,
    tasks,
    activeFocusGoalIds,
    selectedSprintId,
    nextSprint,
    capacitySummary,
  }), [activeFocusGoalIds, capacitySummary, goals, nextSprint, selectedSprintId, stories, tasks]);

  const applyRecommendation = async (item: ReturnType<typeof buildSprintDeferRecommendations>['recommended'][number]) => {
    if (!item.nextSprintId || !item.nextSprintStartMs) return;
    setApplyingId(item.id);
    try {
      const sourceStory = item.type === 'story' ? stories.find((story) => story.id === item.id) || null : null;
      const sourceTask = item.type === 'task' ? tasks.find((task) => task.id === item.id) || null : null;
      if (item.type === 'story') {
        await updateDoc(doc(db, 'stories', item.id), {
          sprintId: item.nextSprintId,
          targetDate: item.nextSprintStartMs,
          dueDate: item.nextSprintStartMs,
          plannedStartDate: item.nextSprintStartMs,
          deferredUntil: item.nextSprintStartMs,
          deferredReason: `Deferred from dashboard capacity review to ${nextSprint?.name || 'next sprint'}.`,
          deferredBy: 'dashboard_capacity_review',
          deferredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'tasks', item.id), {
          sprintId: item.nextSprintId,
          dueDate: item.nextSprintStartMs,
          dueDateMs: item.nextSprintStartMs,
          deferredUntil: item.nextSprintStartMs,
          deferredReason: `Deferred from dashboard capacity review to ${nextSprint?.name || 'next sprint'}.`,
          deferredBy: 'dashboard_capacity_review',
          deferredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await ActivityStreamService.addActivity({
        entityId: item.id,
        entityType: item.type,
        activityType: 'sprint_changed',
        userId: ownerUid,
        userEmail: undefined,
        description: `Deferred from capacity review to ${nextSprint?.name || 'next sprint'} starting ${new Date(item.nextSprintStartMs).toLocaleDateString()}.`,
        persona: String((sourceStory as any)?.persona || (sourceTask as any)?.persona || 'personal'),
        referenceNumber: String((sourceStory as any)?.ref || (sourceStory as any)?.referenceNumber || (sourceTask as any)?.ref || '').trim() || undefined,
        source: 'human',
        sourceDetails: 'dashboard_capacity_review',
        metadata: {
          previousSprintId: String((sourceStory as any)?.sprintId || (sourceTask as any)?.sprintId || '') || null,
          nextSprintId: item.nextSprintId,
          previousDueAt: (sourceStory as any)?.dueDate || (sourceStory as any)?.targetDate || (sourceTask as any)?.dueDate || null,
          nextDueAt: item.nextSprintStartMs,
          keepScore: item.keepScore,
        },
      });
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <Card className="shadow-sm border-0 mb-3 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between gap-2">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <Pin size={16} /> Pinned Focus KPIs
        </div>
        <div className="d-flex align-items-center gap-2">
          <Badge bg={pinnedKpis.length > 0 ? 'primary' : 'secondary'} pill>{pinnedKpis.length}</Badge>
          {onOpenFocusGoals && (
            <Button variant="outline-secondary" size="sm" onClick={onOpenFocusGoals}>
              Open Focus Goals
            </Button>
          )}
        </div>
      </Card.Header>
      <Card.Body className="p-3">
        <div className="mb-3">
          <div className="text-muted small mb-2">
            Dashboard pins from your focus-goal KPI definitions, plus defer guidance when sprint load exceeds capacity.
          </div>
          {pinnedKpis.length === 0 ? (
            <div className="text-muted small">
              No pinned focus KPIs yet. Design them in Focus Goals and enable "Pin to dashboard".
            </div>
          ) : (
            <div className="d-grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {pinnedKpis.map((card) => {
                const stateBadge = getKpiStateBadge(card.healthy, card.stale);
                return (
                  <div key={`${card.goalId}-${card.kpiId}`} className="border rounded p-2">
                    <div className="d-flex align-items-start justify-content-between gap-2">
                      <div>
                        <div className="fw-semibold small">{card.name}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>{card.goalTitle}</div>
                      </div>
                      <div className="d-flex align-items-center gap-1 flex-wrap justify-content-end">
                        <Badge bg={stateBadge.bg}>{stateBadge.label}</Badge>
                        <Badge bg="light" text="dark">{card.visualizationType}</Badge>
                      </div>
                    </div>
                    <div className="d-flex align-items-end justify-content-between mt-2 gap-2">
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{card.currentDisplay}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>Target {card.targetDisplay}</div>
                      </div>
                      {(card.visualizationType === 'line' || card.visualizationType === 'bar')
                        ? renderSparkline(card.series, card.visualizationType === 'bar' ? 'bar' : 'line')
                        : <TrendingUp size={18} className="text-primary" />}
                    </div>
                    {card.visualizationType === 'progress' && (
                      <div className="mt-2">
                        <ProgressBar
                          now={Math.max(0, Math.min(100, Number(card.progressPct || 0)))}
                          style={{ height: 6 }}
                        />
                      </div>
                    )}
                    <div className="text-muted mt-2" style={{ fontSize: 11 }}>
                      {getKpiStateLabel(card.progressPct, card.healthy, card.stale)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-2 border-top">
          <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
            <div className="fw-semibold d-flex align-items-center gap-2">
              <Target size={16} /> Capacity deferral hints
            </div>
            {deferRecommendations.overCapacityHours > 0 ? (
              <Badge bg="warning" text="dark">
                Over by {deferRecommendations.overCapacityHours.toFixed(1)}h
              </Badge>
            ) : (
              <Badge bg="success">Within capacity</Badge>
            )}
          </div>
          {deferRecommendations.recommended.length === 0 ? (
            <div className="text-muted small">No current defer candidates.</div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {deferRecommendations.recommended.map((item) => (
                <div key={`${item.type}-${item.id}`} className="border rounded p-2">
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <div>
                      <div className="fw-semibold small">{item.title}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {item.type === 'story' ? 'Story' : 'Task'} · frees ~{item.effortHours.toFixed(1)}h
                        {item.alignedToFocus ? ' · focus aligned' : ' · not focus aligned'}
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      {(item.type === 'story'
                        ? stories.find((story) => story.id === item.id)
                        : tasks.find((task) => task.id === item.id)) && (
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          className="p-1 d-inline-flex align-items-center justify-content-center"
                          title="Open activity stream"
                          onClick={() => {
                            const target = item.type === 'story'
                              ? stories.find((story) => story.id === item.id)
                              : tasks.find((task) => task.id === item.id);
                            if (target) showSidebar(target as any, item.type);
                          }}
                        >
                          <Activity size={14} />
                        </Button>
                      )}
                      <Badge bg={item.alignedToFocus ? 'success' : 'secondary'}>
                        {item.alignedToFocus ? 'Focus aligned' : 'Defer candidate'}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-muted mt-2" style={{ fontSize: 11 }}>{item.rationale}</div>
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline-warning"
                      disabled={!item.nextSprintId || applyingId === item.id}
                      onClick={() => void applyRecommendation(item)}
                    >
                      {applyingId === item.id ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-1" />
                          Deferring…
                        </>
                      ) : (
                        `Move to ${nextSprint?.name || 'next sprint'}`
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default KpiDashboardWidget;

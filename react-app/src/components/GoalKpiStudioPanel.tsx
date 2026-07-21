import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ProgressBar } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { BarChart3, Pin, Plus, Target } from 'lucide-react';
import { db } from '../firebase';
import type { Goal } from '../types';
import type { Kpi } from '../types/KpiTypes';
import type { GlobalTheme } from '../constants/globalThemes';
import { resolveThemeDefinition } from '../utils/themeResolver';
import { formatKpiValue, getKpiStateBadge, getKpiStateLabel, toKpiNumber } from '../utils/kpiDisplay';

interface GoalMetricDoc {
  resolvedKpis?: Array<Record<string, any>>;
}

interface GoalKpiStudioPanelProps {
  ownerUid: string;
  goals: Goal[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  onCreateKpi: (goalId?: string) => void;
  /** Resolves goal.theme (a raw numeric/legacy id) to a real label/color instead of showing
   * the id verbatim — pass useGlobalThemes()'s `themes`. Falls back to the default palette. */
  themes?: GlobalTheme[];
}

interface GoalKpiCardProps {
  goal: Goal;
  kpis: Kpi[];
  resolved: Array<Record<string, any>>;
  themeDef: GlobalTheme;
  onCreateKpi: (goalId?: string) => void;
  /** True for a phase/sub-goal rendered nested under its parent — smaller, indented, tinted
   * by the parent's border so the grouping reads visually without a deep tree widget. */
  nested?: boolean;
}

const GoalKpiCard: React.FC<GoalKpiCardProps> = ({ goal, kpis, resolved, themeDef, onCreateKpi, nested }) => (
  <div
    className="border rounded p-3"
    style={nested ? { marginLeft: 24, borderLeftWidth: 3, borderLeftColor: themeDef.color, borderLeftStyle: 'solid' } : undefined}
  >
    <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap mb-2">
      <div>
        <div className="fw-semibold">{goal.title}</div>
        <div className="text-muted small d-flex align-items-center gap-1">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: themeDef.color, display: 'inline-block' }} />
          {themeDef.label || themeDef.name} · {kpis.length} KPI{kpis.length === 1 ? '' : 's'}
        </div>
      </div>
      <Button size="sm" variant="outline-secondary" onClick={() => onCreateKpi(goal.id)}>
        <Plus size={14} className="me-1" /> {kpis.length > 0 ? 'Edit KPIs' : 'Design KPI'}
      </Button>
    </div>

    {kpis.length === 0 ? (
      <div className="text-muted small">No KPIs attached yet.</div>
    ) : (
      <div className="d-flex flex-column gap-2">
        {kpis.map((kpi) => {
          const resolvedRow = resolved.find((entry) => String(entry?.id || entry?.metricKey || entry?.name || '') === String(kpi.id || kpi.metricId || kpi.name || ''))
            || resolved.find((entry) => String(entry?.name || '').trim() === String(kpi.name || '').trim())
            || {};
          const progressPct = toKpiNumber(resolvedRow?.progressPct ?? (kpi as any).progress);
          const currentValue = toKpiNumber(resolvedRow?.currentValue ?? (kpi as any).current);
          const targetValue = toKpiNumber(resolvedRow?.targetNormalized ?? resolvedRow?.target ?? kpi.target);
          const unit = String(resolvedRow?.unit || kpi.unit || '');
          const stateBadge = getKpiStateBadge(resolvedRow?.healthy === true, resolvedRow?.stale === true || resolvedRow?.healthy === false);

          return (
            <div key={kpi.id} className="border rounded p-2">
              <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap">
                <div>
                  <div className="fw-semibold small">{kpi.name}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {String(kpi.sourceLabel || kpi.sourceId || 'manual')}
                    {' → '}
                    {String((kpi as any).sourceFieldPath || kpi.metricId || kpi.type || 'metric')}
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <Badge bg={stateBadge.bg}>{stateBadge.label}</Badge>
                  <Badge bg={(kpi as any).designerMode === 'registry' ? 'info' : 'primary'}>
                    {(kpi as any).designerMode === 'registry' ? 'Registry' : 'Curated'}
                  </Badge>
                  <Badge bg="light" text="dark">{kpi.visualizationType || 'progress'}</Badge>
                  {kpi.displayOnDashboard && (
                    <Badge bg="warning" text="dark"><Pin size={12} className="me-1" />Dashboard</Badge>
                  )}
                  <Badge bg="secondary">{kpi.timeframe}</Badge>
                </div>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-2 mt-2 flex-wrap">
                <div className="small">
                  <strong>{formatKpiValue(currentValue, unit)}</strong>
                  {' / '}
                  {formatKpiValue(targetValue, unit)}
                </div>
                <div className="text-muted small d-flex align-items-center gap-1">
                  <Target size={12} />
                  {getKpiStateLabel(progressPct, resolvedRow?.healthy === true, resolvedRow?.stale === true || resolvedRow?.healthy === false)}
                </div>
              </div>

              <div className="mt-2">
                <ProgressBar now={Math.max(0, Math.min(100, Number(progressPct || 0)))} style={{ height: 6 }} />
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const GoalKpiStudioPanel: React.FC<GoalKpiStudioPanelProps> = ({
  ownerUid,
  goals,
  title = 'Focus KPI Studio',
  subtitle = 'Design KPIs here, then review their live metrics on focus cards and the dashboard.',
  emptyMessage = 'No goals available for KPI design.',
  onCreateKpi,
  themes,
}) => {
  const [metricsByGoal, setMetricsByGoal] = useState<Record<string, GoalMetricDoc>>({});

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
        };
      });
      setMetricsByGoal(next);
    }, () => {
      setMetricsByGoal({});
    });
    return () => unsubscribe();
  }, [ownerUid]);

  const goalsWithKpis = useMemo(() => goals.map((goal) => {
    const kpis = (Array.isArray((goal as any).kpisV2) ? (goal as any).kpisV2 : []) as Kpi[];
    return {
      goal,
      kpis,
      resolved: metricsByGoal[goal.id]?.resolvedKpis || [],
      themeDef: resolveThemeDefinition((goal as any).theme, themes),
    };
  }), [goals, metricsByGoal, themes]);

  // Groups phase/sub-goals under their parent (one level — covers the common case, e.g. an
  // Ironman goal's Base Building / Build / Race Prep phases, without a deep-recursion tree
  // this page doesn't need). A child whose parent isn't in the current `goals` set (e.g. the
  // parent goal itself isn't in scope) falls back to rendering at the top level rather than
  // silently disappearing.
  const goalRows = useMemo(() => {
    const byId = new Map(goalsWithKpis.map((row) => [row.goal.id, row]));
    const childrenByParent = new Map<string, typeof goalsWithKpis>();
    const topLevel: typeof goalsWithKpis = [];
    goalsWithKpis.forEach((row) => {
      const parentId = String((row.goal as any).parentGoalId || '').trim();
      if (parentId && byId.has(parentId)) {
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId)!.push(row);
      } else {
        topLevel.push(row);
      }
    });
    return topLevel.map((row) => ({ ...row, children: childrenByParent.get(row.goal.id) || [] }));
  }, [goalsWithKpis]);

  const totalKpis = goalsWithKpis.reduce((sum, row) => sum + row.kpis.length, 0);

  return (
    <Card className="border-0 shadow-sm mb-4">
      <Card.Header className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <div>
          <div className="fw-semibold d-flex align-items-center gap-2">
            <BarChart3 size={16} /> {title}
          </div>
          <div className="text-muted small">{subtitle}</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Badge bg={totalKpis > 0 ? 'primary' : 'secondary'} pill>{totalKpis} KPI{totalKpis === 1 ? '' : 's'}</Badge>
          <Button size="sm" variant="outline-primary" onClick={() => onCreateKpi()}>
            <Plus size={14} className="me-1" /> Design KPI
          </Button>
        </div>
      </Card.Header>
      <Card.Body className="p-3">
        {goalRows.length === 0 ? (
          <div className="text-muted small">{emptyMessage}</div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {goalRows.map(({ goal, kpis, resolved, themeDef, children }) => (
              <div key={goal.id} className="d-flex flex-column gap-2">
                <GoalKpiCard goal={goal} kpis={kpis} resolved={resolved} themeDef={themeDef} onCreateKpi={onCreateKpi} />
                {children.map((child) => (
                  <GoalKpiCard
                    key={child.goal.id}
                    goal={child.goal}
                    kpis={child.kpis}
                    resolved={child.resolved}
                    themeDef={child.themeDef}
                    onCreateKpi={onCreateKpi}
                    nested
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default GoalKpiStudioPanel;

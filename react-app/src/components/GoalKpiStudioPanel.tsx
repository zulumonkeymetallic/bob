import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ProgressBar } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { BarChart3, Pin, Plus, Target } from 'lucide-react';
import { db } from '../firebase';
import type { Goal } from '../types';
import type { Kpi } from '../types/KpiTypes';

interface GoalMetricDoc {
  resolvedKpis?: Array<Record<string, any>>;
}

interface GoalKpiStudioPanelProps {
  ownerUid: string;
  goals: Goal[];
  title?: string;
  subtitle?: string;
  onCreateKpi: (goalId?: string) => void;
}

const toNumber = (value: any): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatValue = (value: number | null, unit: string) => {
  if (value == null) return '—';
  if (unit === 'GBP') return `£${Math.round(value).toLocaleString()}`;
  if (unit === '%') return `${Math.round(value)}%`;
  if (unit === 'km' || unit === 'hours') return `${Number(value.toFixed(1))}`;
  return `${Math.round(value)}`;
};

const GoalKpiStudioPanel: React.FC<GoalKpiStudioPanelProps> = ({
  ownerUid,
  goals,
  title = 'KPI Studio',
  subtitle = 'Map goal KPIs to real sources and dashboard visuals.',
  onCreateKpi,
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
    };
  }), [goals, metricsByGoal]);

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
            <Plus size={14} className="me-1" /> Add KPI
          </Button>
        </div>
      </Card.Header>
      <Card.Body className="p-3">
        {goalsWithKpis.length === 0 ? (
          <div className="text-muted small">No goals available for KPI design.</div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {goalsWithKpis.map(({ goal, kpis, resolved }) => (
              <div key={goal.id} className="border rounded p-3">
                <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap mb-2">
                  <div>
                    <div className="fw-semibold">{goal.title}</div>
                    <div className="text-muted small">Theme {goal.theme} · {kpis.length} KPI{kpis.length === 1 ? '' : 's'}</div>
                  </div>
                  <Button size="sm" variant="outline-secondary" onClick={() => onCreateKpi(goal.id)}>
                    <Plus size={14} className="me-1" /> Design KPI
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
                      const progressPct = toNumber(resolvedRow?.progressPct ?? (kpi as any).progress);
                      const currentValue = toNumber(resolvedRow?.currentValue ?? (kpi as any).current);
                      const targetValue = toNumber(resolvedRow?.targetNormalized ?? resolvedRow?.target ?? kpi.target);
                      const unit = String(resolvedRow?.unit || kpi.unit || '');

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
                              <strong>{formatValue(currentValue, unit)}</strong>
                              {' / '}
                              {formatValue(targetValue, unit)}
                            </div>
                            <div className="text-muted small d-flex align-items-center gap-1">
                              <Target size={12} />
                              {progressPct != null ? `${Math.round(progressPct)}%` : 'Waiting for sync'}
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
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default GoalKpiStudioPanel;

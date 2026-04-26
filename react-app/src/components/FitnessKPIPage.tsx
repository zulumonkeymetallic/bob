import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Spinner } from 'react-bootstrap';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { Activity, Settings, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { FitnessKPIPanel } from './FitnessKPIDisplay';
import GoalKpiStudioPanel from './GoalKpiStudioPanel';
import type { Goal } from '../types';

interface ResolvedKpi {
  id?: string;
  name?: string;
  currentValue?: number | null;
  targetNormalized?: number | null;
  target?: number | null;
  progressPct?: number | null;
  unit?: string;
  resolvedAt?: string;
  observedAt?: number;
  healthy?: boolean;
}

const toFitnessKpiShape = (r: ResolvedKpi) => ({
  name: String(r.name || 'KPI'),
  target: Number(r.targetNormalized ?? r.target ?? 0),
  unit: String(r.unit || ''),
  current: r.currentValue != null ? Number(r.currentValue) : undefined,
  progress: r.progressPct != null ? Number(r.progressPct) : undefined,
  status: deriveStatus(r.progressPct, r.healthy),
  lastUpdated: r.resolvedAt || undefined,
});

function deriveStatus(
  pctRaw: number | null | undefined,
  healthy: boolean | undefined
): 'on-target' | 'good' | 'ok' | 'behind' | 'no-data' {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return 'no-data';
  if (pct >= 100) return 'on-target';
  if (pct >= 80) return 'good';
  if (pct >= 60) return 'ok';
  return 'behind';
}

function trafficLight(pctRaw: number | null | undefined): { bg: string; text?: string; label: string } {
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return { bg: 'secondary', label: 'No data' };
  if (pct >= 100) return { bg: 'success', label: `${Math.round(pct)}%` };
  if (pct >= 80) return { bg: 'warning', text: 'dark', label: `${Math.round(pct)}%` };
  if (pct >= 70) return { bg: 'warning', text: 'dark', label: `${Math.round(pct)}%` };
  return { bg: 'danger', label: `${Math.round(pct)}%` };
}

const isFitnessOrHealth = (goal: any): boolean => {
  const cat = String(goal.category || '').toLowerCase();
  if (cat === 'fitness' || cat === 'health') return true;
  return Array.isArray(goal.kpisV2) && goal.kpisV2.length > 0;
};

interface BodyFatPoint {
  date: string;
  value: number;
}

const FitnessKPIPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [metricsByGoal, setMetricsByGoal] = useState<Record<string, any>>({});
  const [bodyFatPct, setBodyFatPct] = useState<number | null>(null);
  const [bodyFatHistory, setBodyFatHistory] = useState<BodyFatPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [editGoalId, setEditGoalId] = useState<string | null>(null);
  const uid = currentUser?.uid || '';

  useEffect(() => {
    if (!uid) { setGoals([]); setLoading(false); return; }
    const q = query(collection(db, 'goals'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => { setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal))); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) { setMetricsByGoal({}); return; }
    const q = query(collection(db, 'goal_kpi_metrics'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(q, (snap) => {
      const next: Record<string, any> = {};
      snap.docs.forEach(d => {
        const data = d.data() as any;
        const goalId = String(data?.goalId || '').trim();
        if (goalId) next[goalId] = data;
      });
      setMetricsByGoal(next);
    }, () => {});
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'profiles', uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        setBodyFatPct(data.healthkitBodyFatPct ?? null);
      }
    }, () => {});
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'metric_observations'),
      where('ownerUid', '==', uid),
      where('metricKey', '==', 'healthkitBodyFatPct')
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: BodyFatPoint[] = snap.docs
        .map(d => d.data() as any)
        .filter(d => d.value != null && d.observedAt)
        .map(d => {
          const ms = typeof d.observedAt === 'number' ? d.observedAt : (d.observedAt?.toMillis?.() ?? 0);
          return { ms, value: Number(d.value) };
        })
        .sort((a, b) => a.ms - b.ms)
        .slice(-30)
        .map(d => ({
          date: new Date(d.ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          value: d.value,
        }));
      setBodyFatHistory(rows);
    }, () => {});
    return () => unsub();
  }, [uid]);

  const fitnessGoals = useMemo(() => goals.filter(isFitnessOrHealth), [goals]);
  const editGoal = useMemo(() => goals.find(g => g.id === editGoalId) ?? null, [goals, editGoalId]);

  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: 240 }}>
        <Spinner animation="border" size="sm" className="me-2" />
        Loading fitness KPIs…
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <div className="d-flex align-items-center gap-2 mb-4">
        <Activity size={22} style={{ color: '#0066cc' }} />
        <h4 className="mb-0 fw-bold">Fitness KPIs</h4>
      </div>

      {fitnessGoals.length === 0 ? (
        <div className="text-muted small">
          No fitness or health goals found. Add a goal with category "fitness" or "health" and attach KPIs to see them here.
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {fitnessGoals.map(goal => {
            const metricDoc = metricsByGoal[goal.id];
            const resolvedKpis: ResolvedKpi[] = Array.isArray(metricDoc?.resolvedKpis) ? metricDoc.resolvedKpis : [];
            const rawKpis = Array.isArray((goal as any).kpisV2) ? (goal as any).kpisV2 : [];
            const kpisForPanel = resolvedKpis.length > 0
              ? resolvedKpis.map(toFitnessKpiShape)
              : rawKpis.map((k: any) => toFitnessKpiShape({
                  name: k.name,
                  currentValue: k.current,
                  targetNormalized: k.target,
                  progressPct: k.progress,
                  unit: k.unit,
                  healthy: k.status === 'on-target',
                }));

            return (
              <Card key={goal.id} className="shadow-sm border-0">
                <Card.Body>
                  <div className="d-flex align-items-start justify-content-between gap-2 mb-3">
                    <div>
                      <div className="fw-semibold">{(goal as any).title}</div>
                      {(goal as any).description && (
                        <div className="text-muted small mt-1">{(goal as any).description}</div>
                      )}
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end flex-shrink-0">
                      {resolvedKpis.map((rk, i) => {
                        const tl = trafficLight(rk.progressPct);
                        return (
                          <Badge
                            key={i}
                            bg={tl.bg}
                            text={tl.text as any}
                            style={{ fontSize: 11 }}
                            title={String(rk.name || '')}
                          >
                            {String(rk.name || 'KPI').slice(0, 24)} · {tl.label}
                          </Badge>
                        );
                      })}
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        className="d-inline-flex align-items-center gap-1"
                        onClick={() => setEditGoalId(goal.id)}
                      >
                        <Settings size={13} /> Edit KPIs
                      </Button>
                    </div>
                  </div>

                  {kpisForPanel.length > 0 ? (
                    <FitnessKPIPanel kpis={kpisForPanel} showLastUpdated />
                  ) : (
                    <div className="text-muted small">
                      No KPIs configured. Click "Edit KPIs" to add some.
                    </div>
                  )}
                </Card.Body>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-4 pt-3 border-top">
        <div className="d-flex align-items-center gap-2 mb-3">
          <TrendingUp size={18} style={{ color: '#0066cc' }} />
          <h6 className="mb-0 fw-semibold">Body Fat Trend</h6>
          {bodyFatPct != null && (
            <Badge bg="secondary">{bodyFatPct.toFixed(1)}% current</Badge>
          )}
        </div>
        {bodyFatHistory.length >= 2 ? (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bodyFatHistory} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Body Fat']} />
                <Line type="monotone" dataKey="value" stroke="#0066cc" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-muted small">
            {bodyFatPct != null
              ? `Current reading: ${bodyFatPct.toFixed(1)}%. No historical trend data available yet — readings will appear here as HealthKit syncs.`
              : 'No body fat data found. Enable HealthKit sync to see your body fat percentage here.'}
          </div>
        )}
      </div>

      {editGoalId && editGoal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 1050, display: 'flex', alignItems: 'flex-start',
            justifyContent: 'center', overflowY: 'auto', padding: '40px 16px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditGoalId(null); }}
        >
          <div style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 700, padding: 24 }}>
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h6 className="mb-0 fw-semibold">KPI Studio — {(editGoal as any).title}</h6>
              <Button variant="outline-secondary" size="sm" onClick={() => setEditGoalId(null)}>
                Close
              </Button>
            </div>
            <GoalKpiStudioPanel
              ownerUid={uid}
              goals={[editGoal]}
              title={`KPIs for ${(editGoal as any).title}`}
              onCreateKpi={() => {}}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default FitnessKPIPage;

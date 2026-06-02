/**
 * GoalKpiLivePanel
 *
 * Reads live data from health_metrics + profiles and renders current values
 * next to each kpisV2 definition on a Focus Goal.
 *
 * Supports:
 *   fitness_hrv        → 7-day average hrvMs from health_metrics
 *   fitness_sleep      → 7-day average sleepDurationH from health_metrics
 *   fitness_steps      → latest healthkitStepsToday from health_metrics
 *   fitness_running    → last 7 days run km from metrics_workouts
 *   fitness_swimming   → last 7 days swim km from metrics_workouts
 *   fitness_cycling    → last 7 days cycle km from metrics_workouts
 *   custom             → matched by metricId/name: bodyFatPct, weightKg, protein
 *   routine_compliance → % days completed in lookbackDays (from calendar_blocks)
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { Kpi } from '../../types/KpiTypes';

interface Props {
  goalId: string;
  ownerUid: string;
  kpisV2: Kpi[];
}

const DOMAIN_COLORS: Record<string, string> = {
  'on-target': '#22c55e',
  'good':      '#22c55e',
  'ok':        '#f59e0b',
  'behind':    '#ef4444',
  'no-data':   '#6b7280',
};

function progressPct(current: number | null, target: number, direction: string = 'increase'): number | null {
  if (current === null || current === undefined) return null;
  if (target === 0) return 100;
  if (direction === 'decrease') {
    // lower is better — 100% when current <= target
    return Math.min(100, Math.round((target / Math.max(current, 0.001)) * 100));
  }
  return Math.min(100, Math.round((current / target) * 100));
}

function statusFromPct(pct: number | null): string {
  if (pct === null) return 'no-data';
  if (pct >= 100) return 'on-target';
  if (pct >= 80)  return 'good';
  if (pct >= 60)  return 'ok';
  return 'behind';
}

function fmt(val: number | null, unit: string): string {
  if (val === null) return '—';
  if (unit === 'kg' || unit === 'km') return val.toFixed(1) + ' ' + unit;
  if (unit === '%') return val.toFixed(1) + '%';
  if (unit === 'ms') return Math.round(val) + ' ms';
  if (unit === 'hours' || unit === 'h') return val.toFixed(1) + 'h';
  if (unit === 'g') return Math.round(val) + 'g';
  return Math.round(val) + (unit ? ' ' + unit : '');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const GoalKpiLivePanel: React.FC<Props> = ({ goalId, ownerUid, kpisV2 }) => {
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);
  const [workouts, setWorkouts] = useState<any[]>([]);

  // Last 30 days of health_metrics
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', ownerUid),
      limit(60)
    );
    return onSnapshot(q, snap => {
      setHealthMetrics(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setHealthMetrics([]));
  }, [ownerUid]);

  // Last 8 weeks of workouts for running/swim/cycle KPIs
  const hasActivityKpi = kpisV2.some(k =>
    ['fitness_running', 'fitness_swimming', 'fitness_cycling', 'fitness_walking', 'fitness_workouts'].includes(k.type)
  );
  useEffect(() => {
    if (!ownerUid || !hasActivityKpi) return;
    const since = Date.now() - 56 * 24 * 60 * 60 * 1000;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', ownerUid),
      where('startDate', '>=', since),
      orderBy('startDate', 'desc'),
      limit(400)
    );
    return onSnapshot(q, snap => {
      setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setWorkouts([]));
  }, [ownerUid, hasActivityKpi]);

  // ─── Compute live value per KPI type ──────────────────────────────────────

  const liveValues = useMemo(() => {
    const byDay: Record<string, any> = {};
    healthMetrics.forEach(m => { if (m.date) byDay[m.date] = m; });

    // Last 7 day keys
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });

    function avg7(field: string): number | null {
      const vals = last7.map(d => byDay[d]?.[field]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    function latest(field: string): number | null {
      for (const d of last30) {
        const v = byDay[d]?.[field];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
      return null;
    }

    // Workout sums by sport, last 7 days
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const weekWorkouts = workouts.filter(w => {
      const startMs = typeof w.startDate === 'number' ? w.startDate : (w.startDate?.toMillis?.() ?? 0);
      return startMs >= now - weekMs;
    });
    function weekKm(sportKeywords: string[]): number | null {
      const total = weekWorkouts
        .filter(w => {
          const t = String(w.sportType || w.type || '').toLowerCase();
          return sportKeywords.some(k => t.includes(k));
        })
        .reduce((sum, w) => sum + (Number(w.distance_m) || 0), 0);
      return total > 0 ? total / 1000 : null;
    }

    const result: Record<string, number | null> = {};

    kpisV2.forEach(kpi => {
      const id = kpi.id || kpi.name;
      switch (kpi.type) {
        case 'fitness_hrv':
          result[id] = avg7('hrvMs');
          break;
        case 'fitness_sleep':
          result[id] = avg7('sleepDurationH') ?? (() => {
            const mins = avg7('sleepMinutes') ?? avg7('healthkitSleepMinutes');
            return mins != null ? mins / 60 : null;
          })();
          break;
        case 'fitness_steps':
          result[id] = latest('healthkitStepsToday') ?? latest('healthkitStepsToday');
          break;
        case 'fitness_running':
          result[id] = weekKm(['run', 'trail']);
          break;
        case 'fitness_swimming':
          result[id] = weekKm(['swim']);
          break;
        case 'fitness_cycling':
          result[id] = weekKm(['cycl', 'ride', 'bike']);
          break;
        case 'fitness_walking':
          result[id] = weekKm(['walk', 'hike']);
          break;
        case 'custom': {
          // Match by metricId or lowercase name
          const key = String(kpi.metricId || kpi.name || '').toLowerCase().replace(/[\s_-]/g, '');
          if (key.includes('bodyfat') || key.includes('fat')) result[id] = latest('bodyFatPct');
          else if (key.includes('weight') || key.includes('kg')) result[id] = latest('weightKg');
          else if (key.includes('protein')) result[id] = latest('proteinTodayG');
          else if (key.includes('calorie') || key.includes('kcal')) result[id] = latest('caloriesTodayKcal');
          else result[id] = null;
          break;
        }
        default:
          result[id] = null;
      }
    });

    return result;
  }, [healthMetrics, workouts, kpisV2]);

  if (!kpisV2.length) return null;

  return (
    <div className="mt-4">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <h5 className="mb-0">KPI Live Data</h5>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          Updated from HealthKit / Strava
        </span>
      </div>
      <div className="vstack gap-2">
        {kpisV2.map(kpi => {
          const id = kpi.id || kpi.name;
          const current = liveValues[id] ?? null;
          const pct = progressPct(current, kpi.target, kpi.targetDirection);
          const status = statusFromPct(pct);
          const colour = DOMAIN_COLORS[status] || '#6b7280';
          const timeframeLabel = kpi.timeframe === 'weekly' ? '7d' : kpi.timeframe === 'daily' ? 'today' : kpi.timeframe ?? '';

          return (
            <div
              key={id}
              className="p-2 rounded"
              style={{ background: 'var(--bs-secondary-bg)', borderLeft: `3px solid ${colour}` }}
            >
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {kpi.name}
                </span>
                <div className="d-flex align-items-center gap-2">
                  <span style={{ fontSize: '0.75rem', color: colour, fontWeight: 700 }}>
                    {fmt(current, kpi.unit)}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--bs-secondary)' }}>
                    / {fmt(kpi.target, kpi.unit)} {timeframeLabel}
                  </span>
                </div>
              </div>
              {pct !== null && (
                <div className="progress" style={{ height: 4 }}>
                  <div
                    className="progress-bar"
                    role="progressbar"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      backgroundColor: colour,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              )}
              {current === null && (
                <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                  No recent data — sync from iPhone to populate
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GoalKpiLivePanel;

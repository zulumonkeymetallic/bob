/**
 * ZonesPanel — heart-rate zone distribution, 30 days and per session.
 *
 * Answers one question: how much of your training is actually in Zone 2–3?
 *
 * ## Why the colours are a single-hue ramp and not the usual zone rainbow
 *
 * Zones are an **ordered** scale, not five unrelated categories. A blue/green/
 * yellow/orange/red rainbow implies identity — that Z2 and Z4 are different *kinds*
 * of thing rather than different *amounts* of the same thing — and adjacent hues in
 * a rainbow are the first pairs to collapse under colour-vision deficiency. A
 * monotone ramp encodes the ordering in the ink itself. Both the light and dark
 * ramps below were validated (monotone lightness, ≥0.06 ΔL between steps, light end
 * clearing 2:1 against the surface, single hue).
 *
 * The target band carries the emphasis instead of a hue: Z2+Z3 is the hero figure,
 * because that is the number being managed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from 'react-bootstrap';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { excludeDuplicateWorkouts } from '../../utils/workoutFilters';
import { activityFromWorkout, labelFor, ActivityKey } from '../../utils/activityTaxonomy';

/** Ordinal ramp, light→dark. Validated for both surfaces — see the note above. */
const ZONE_RAMP_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const ZONE_RAMP_DARK  = ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

/** The band the training plan is aiming for. */
const TARGET_ZONES = [2, 3];
const DEFAULT_TARGET_SHARE_PCT = 70;

const WINDOW_DAYS = 30;
const RECENT_SESSIONS = 10;

interface WorkoutRow {
  id: string;
  startDate?: number;
  provider?: string;
  type?: string;
  sportType?: string;
  activity?: string;
  isTrainer?: boolean;
  distance_m?: number;
  movingTime_s?: number;
  elapsedTime_s?: number;
  maxHrUsed?: number;
  isDuplicate?: boolean;
  hrZones?: { z1Time_s?: number; z2Time_s?: number; z3Time_s?: number; z4Time_s?: number; z5Time_s?: number };
}

const zoneSeconds = (w: WorkoutRow, zone: number): number =>
  Number(w.hrZones?.[`z${zone}Time_s` as keyof NonNullable<WorkoutRow['hrZones']>] || 0) || 0;

const totalZoneSeconds = (w: WorkoutRow): number =>
  [1, 2, 3, 4, 5].reduce((sum, z) => sum + zoneSeconds(w, z), 0);

const formatHours = (seconds: number): string => {
  if (seconds < 60) return '0m';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

/** Zone boundaries as percentages of max — matches hrZonesFromMax on the server. */
const zoneBounds = (maxHr: number | null): string[] => {
  if (!maxHr) return ['', '', '', '', ''];
  const at = (pct: number) => Math.round(pct * maxHr);
  return [
    `< ${at(0.6)}`,
    `${at(0.6)}–${at(0.7)}`,
    `${at(0.7)}–${at(0.8)}`,
    `${at(0.8)}–${at(0.9)}`,
    `${at(0.9)}+`,
  ];
};

const useDarkMode = (): boolean => {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.getAttribute('data-bs-theme')
        || document.documentElement.getAttribute('data-theme');
      if (attr) { setDark(attr === 'dark'); return; }
      setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
    };
    read();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme', 'data-theme'] });
    return () => { mq?.removeEventListener?.('change', read); observer.disconnect(); };
  }, []);
  return dark;
};

const ZonesPanel: React.FC = () => {
  const { currentUser } = useAuth();
  const dark = useDarkMode();
  const ramp = dark ? ZONE_RAMP_DARK : ZONE_RAMP_LIGHT;

  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [profileMaxHr, setProfileMaxHr] = useState<number | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc'),
      limit(500),
    );
    return onSnapshot(
      q,
      snap => setWorkouts(excludeDuplicateWorkouts(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as WorkoutRow[],
      )),
      () => setWorkouts([]),
    );
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    getDoc(doc(db, 'profiles', currentUser.uid))
      .then(snap => setProfileMaxHr(Number(snap.data()?.maxHr) || null))
      .catch(() => setProfileMaxHr(null));
  }, [currentUser?.uid]);

  const windowWorkouts = useMemo(() => {
    const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return workouts.filter(w => Number(w.startDate || 0) >= cutoff);
  }, [workouts]);

  const withZones = useMemo(
    () => windowWorkouts.filter(w => totalZoneSeconds(w) > 0),
    [windowWorkouts],
  );

  const zoneTotals = useMemo(
    () => [1, 2, 3, 4, 5].map(z => withZones.reduce((sum, w) => sum + zoneSeconds(w, z), 0)),
    [withZones],
  );
  const grandTotal = zoneTotals.reduce((a, b) => a + b, 0);
  const targetSeconds = TARGET_ZONES.reduce((sum, z) => sum + zoneTotals[z - 1], 0);
  const targetSharePct = grandTotal > 0 ? (targetSeconds / grandTotal) * 100 : null;

  /** Sessions whose zones were computed against a max HR that is no longer current. */
  const staleMaxHrCount = useMemo(
    () => (profileMaxHr
      ? withZones.filter(w => Number(w.maxHrUsed || 0) !== profileMaxHr).length
      : withZones.length),
    [withZones, profileMaxHr],
  );

  const recent = useMemo(
    () => windowWorkouts.slice(0, RECENT_SESSIONS),
    [windowWorkouts],
  );

  const byActivity = useMemo(() => {
    const counts = new Map<ActivityKey, { sessions: number; lastMs: number }>();
    for (const w of windowWorkouts) {
      const activity = activityFromWorkout(w) as ActivityKey;
      const entry = counts.get(activity) || { sessions: 0, lastMs: 0 };
      entry.sessions += 1;
      entry.lastMs = Math.max(entry.lastMs, Number(w.startDate || 0));
      counts.set(activity, entry);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1].sessions - a[1].sessions);
  }, [windowWorkouts]);

  const bounds = zoneBounds(profileMaxHr);
  const pieData = zoneTotals
    .map((seconds, i) => ({ name: `Zone ${i + 1}`, value: seconds, index: i }))
    .filter(d => d.value > 0);

  if (grandTotal === 0) {
    return (
      <Card className="shadow-sm border-0">
        <Card.Body className="p-4 text-center">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No heart-rate data in the last {WINDOW_DAYS} days</div>
          <div className="text-muted small">
            {windowWorkouts.length === 0
              ? 'No sessions recorded in this window at all.'
              : `${windowWorkouts.length} session${windowWorkouts.length === 1 ? '' : 's'} recorded, none with a heart-rate stream.`}
          </div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <div className="d-flex flex-column gap-3">
      {(!profileMaxHr || staleMaxHrCount > 0) && (
        <div
          className="d-flex align-items-start gap-2 p-2 rounded small"
          style={{ background: 'var(--bs-warning-bg-subtle)', color: 'var(--bs-warning-text-emphasis)' }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            {!profileMaxHr ? (
              <>No max heart rate set, so these zones were derived from a guess. Set it in
              Settings — every boundary below is a percentage of it.</>
            ) : (
              <>{staleMaxHrCount} of {withZones.length} sessions were computed against a
              different max heart rate and are provisional until re-enriched.</>
            )}
          </div>
        </div>
      )}

      <Card className="shadow-sm border-0">
        <Card.Header className="fw-semibold">Zone {TARGET_ZONES.join('–')} share · last {WINDOW_DAYS} days</Card.Header>
        <Card.Body className="p-3">
          <div className="row g-3 align-items-center">
            {/* Hero figure — the one number being managed. */}
            <div className="col-12 col-md-4 text-center">
              <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.05, color: 'var(--bs-body-color)' }}>
                {targetSharePct === null ? '—' : `${targetSharePct.toFixed(0)}%`}
              </div>
              <div className="text-muted small">
                of {formatHours(grandTotal)} recorded, target {DEFAULT_TARGET_SHARE_PCT}%
              </div>
              <div className="small mt-1" style={{ color: 'var(--bs-secondary-color)' }}>
                {withZones.length} session{withZones.length === 1 ? '' : 's'} with heart rate
              </div>
            </div>

            <div className="col-12 col-md-4" style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    innerRadius="58%"
                    outerRadius="88%"
                    // 2px of surface between segments, per the mark spec.
                    paddingAngle={1}
                    stroke="var(--bs-body-bg)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {pieData.map(d => <Cell key={d.name} fill={ramp[d.index]} />)}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: any, name: any) => [
                      `${formatHours(Number(value))} · ${((Number(value) / grandTotal) * 100).toFixed(1)}%`,
                      name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend — identity is never colour alone; each row names its zone and range. */}
            <div className="col-12 col-md-4">
              {zoneTotals.map((seconds, i) => {
                const pct = grandTotal > 0 ? (seconds / grandTotal) * 100 : 0;
                const isTarget = TARGET_ZONES.includes(i + 1);
                return (
                  <div key={i} className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: 12 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 2, background: ramp[i], flexShrink: 0,
                    }} />
                    <span style={{
                      color: 'var(--bs-body-color)',
                      fontWeight: isTarget ? 700 : 400,
                      minWidth: 52,
                    }}>
                      Zone {i + 1}
                    </span>
                    <span className="text-muted" style={{ minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>
                      {bounds[i]}
                    </span>
                    <span style={{ marginLeft: 'auto', color: 'var(--bs-body-color)', fontVariantNumeric: 'tabular-nums' }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card.Body>
      </Card>

      <Card className="shadow-sm border-0">
        <Card.Header className="fw-semibold">Recent sessions</Card.Header>
        <Card.Body className="p-3">
          {recent.length === 0 && <div className="text-muted small">No sessions in this window.</div>}
          {recent.map(w => {
            const total = totalZoneSeconds(w);
            const date = w.startDate ? new Date(w.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
            const activity = labelFor(activityFromWorkout(w) as ActivityKey);
            const km = Number(w.distance_m || 0) / 1000;
            return (
              <div key={w.id} className="mb-3">
                <div className="d-flex align-items-baseline gap-2 mb-1" style={{ fontSize: 12 }}>
                  <span className="text-muted" style={{ minWidth: 52 }}>{date}</span>
                  <span style={{ color: 'var(--bs-body-color)', fontWeight: 600 }}>{activity}</span>
                  {km > 0 && <span className="text-muted">{km.toFixed(1)} km</span>}
                  <span className="text-muted ms-auto">
                    {total > 0 ? formatHours(total) : 'no heart rate recorded'}
                  </span>
                </div>
                {total > 0 ? (
                  <div className="d-flex" style={{ height: 12, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map(z => {
                      const seconds = zoneSeconds(w, z);
                      if (seconds === 0) return null;
                      const pct = (seconds / total) * 100;
                      return (
                        <div
                          key={z}
                          title={`Zone ${z}: ${formatHours(seconds)} (${pct.toFixed(0)}%)`}
                          style={{ width: `${pct}%`, background: ramp[z - 1] }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  // Unfilled, with the reason — never an empty bar, which reads as no training.
                  <div style={{
                    height: 12, borderRadius: 4,
                    border: '1px dashed var(--bs-border-color)',
                  }} />
                )}
              </div>
            );
          })}
        </Card.Body>
      </Card>

      <Card className="shadow-sm border-0">
        <Card.Header className="fw-semibold">Sessions by activity · last {WINDOW_DAYS} days</Card.Header>
        <Card.Body className="p-3">
          {byActivity.length === 0 && <div className="text-muted small">No sessions in this window.</div>}
          {byActivity.map(([activity, { sessions, lastMs }]) => {
            const days = lastMs ? Math.floor((Date.now() - lastMs) / 86400000) : null;
            return (
              <div key={activity} className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--bs-body-color)', minWidth: 110 }}>{labelFor(activity)}</span>
                <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {sessions} session{sessions === 1 ? '' : 's'}
                </span>
                <span className="text-muted ms-auto">
                  {days === null ? '—' : days === 0 ? 'today' : `${days}d ago`}
                </span>
              </div>
            );
          })}
        </Card.Body>
      </Card>
    </div>
  );
};

export default ZonesPanel;

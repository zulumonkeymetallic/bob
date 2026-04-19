/**
 * RecoveryWidget — HRV, Sleep, Workout mins, Calories dashboard widget.
 *
 * Data sources:
 *   profiles/{uid}  — today's HealthKit snapshot
 *   metrics_hrv     — daily HRV readings (last 90 days)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Activity, Moon, Zap, Flame } from 'lucide-react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  MetricCard,
  RangeSelector,
  num,
  fmtHours,
  type RangeKey,
} from './shared';

const RecoveryWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [profile, setProfile] = useState<any>(null);
  const [hrvReadings, setHrvReadings] = useState<Array<{ date: string; value: number }>>([]);
  const [rangeDays, setRangeDays] = useState<RangeKey>(30);

  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'profiles', uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : null);
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const q = query(
      collection(db, 'metrics_hrv'),
      where('ownerUid', '==', uid),
      where('date', '>=', cutoffStr),
      orderBy('date', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setHrvReadings(
        snap.docs
          .map((d) => ({
            date: d.data().date as string,
            value: Number(d.data().value ?? d.data().rMSSD ?? d.data().hrv),
          }))
          .filter((r) => isFinite(r.value) && r.value > 0),
      );
    });
  }, [uid]);

  const cutoffMs = Date.now() - rangeDays * 86_400_000;

  const hrvInRange = useMemo(
    () => hrvReadings.filter((r) => Date.parse(r.date + 'T00:00:00') >= cutoffMs),
    [hrvReadings, cutoffMs],
  );

  const avgHrv = useMemo(() => {
    if (!hrvInRange.length) return null;
    return Math.round(hrvInRange.reduce((s, r) => s + r.value, 0) / hrvInRange.length);
  }, [hrvInRange]);

  const latestHrv = hrvInRange.length > 0 ? Math.round(hrvInRange[hrvInRange.length - 1].value) : null;
  const hrvSparkline = useMemo(() => hrvReadings.slice(-30).map((r) => r.value), [hrvReadings]);

  const sleepMins = num(profile, 'healthkitSleepMinutes', 'manualSleepMinutes');
  const deepSleepMins = profile ? (profile['healthkitDeepSleepMinutes'] ?? null) as number | null : null;
  const remSleepMins = profile ? (profile['healthkitRemSleepMinutes'] ?? null) as number | null : null;
  const coreSleepMins = profile ? (profile['healthkitCoreSleepMinutes'] ?? null) as number | null : null;
  const workoutMins = num(profile, 'healthkitWorkoutMinutesToday', 'manualWorkoutMinutesToday');
  const calories = num(profile, 'healthkitCaloriesTodayKcal', 'manualCaloriesKcal');
  const bodyFatPct = num(profile, 'healthkitBodyFatPct', 'manualBodyFatPct');

  const sleepSubtitle = (() => {
    if (sleepMins == null) return 'No data yet';
    const parts: string[] = [];
    if (deepSleepMins != null) parts.push(`Deep ${Math.round(deepSleepMins)}m`);
    if (remSleepMins != null) parts.push(`REM ${Math.round(remSleepMins)}m`);
    if (coreSleepMins != null) parts.push(`Core ${Math.round(coreSleepMins)}m`);
    return parts.length > 0 ? parts.join(' · ') : `${fmtHours(sleepMins / 60)} — target 8h`;
  })();

  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Recovery
        </span>
        <RangeSelector rangeDays={rangeDays} onChange={setRangeDays} isDark={isDark} />
      </div>
      <Row className="g-2">
        <Col xs={12} sm={6}>
          <MetricCard
            icon={<Activity size={16} />}
            title="HRV"
            value={latestHrv ?? avgHrv}
            unit="ms"
            subtitle={avgHrv != null ? `${rangeDays}d avg: ${avgHrv} ms` : 'No data yet'}
            trend={hrvSparkline}
            trendColor="#10b981"
            isDark={isDark}
            badge={
              latestHrv && avgHrv
                ? latestHrv >= avgHrv
                  ? { text: 'Above avg', variant: 'success' }
                  : { text: 'Below avg', variant: 'warning' }
                : undefined
            }
          />
        </Col>
        <Col xs={12} sm={6}>
          <MetricCard
            icon={<Moon size={16} />}
            title="Sleep"
            value={sleepMins != null ? (sleepMins / 60).toFixed(1) : null}
            unit="hrs last night"
            subtitle={sleepSubtitle}
            trendColor="#8b5cf6"
            isDark={isDark}
            badge={
              sleepMins != null
                ? sleepMins >= 450
                  ? { text: '✓ Good', variant: 'success' }
                  : sleepMins >= 360
                  ? { text: 'Adequate', variant: 'warning' }
                  : { text: 'Short', variant: 'danger' }
                : undefined
            }
          />
        </Col>
        <Col xs={12} sm={6}>
          <MetricCard
            icon={<Zap size={16} />}
            title="Workout mins"
            value={workoutMins != null ? Math.round(workoutMins) : null}
            unit="mins today"
            subtitle="Active minutes from HealthKit"
            trendColor="#f59e0b"
            isDark={isDark}
          />
        </Col>
        <Col xs={12} sm={6}>
          <MetricCard
            icon={<Flame size={16} />}
            title="Calories"
            value={calories != null ? Math.round(calories) : null}
            unit="kcal today"
            subtitle={bodyFatPct != null ? `Body fat: ${bodyFatPct.toFixed(1)}%` : 'Energy burned today'}
            trendColor="#ef4444"
            isDark={isDark}
          />
        </Col>
      </Row>
    </div>
  );
};

export default RecoveryWidget;

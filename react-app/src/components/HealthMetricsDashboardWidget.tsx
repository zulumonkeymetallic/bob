import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from 'react-bootstrap';
import { Activity, Moon, Heart } from 'lucide-react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { MetricCard, trendIcon } from './MetricsOverview';

const HealthMetricsDashboardWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [profile, setProfile] = useState<any>(null);
  const [hrvReadings, setHrvReadings] = useState<Array<{ date: string; value: number }>>([]);

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
    cutoff.setDate(cutoff.getDate() - 30);
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
          .map((d) => ({ date: d.data().date as string, value: Number(d.data().value ?? d.data().rMSSD ?? d.data().hrv) }))
          .filter((r) => isFinite(r.value) && r.value > 0),
      );
    });
  }, [uid]);

  const hrvSparkline = useMemo(() => hrvReadings.slice(-14).map((r) => r.value), [hrvReadings]);
  const latestHrv = hrvReadings.length > 0 ? Math.round(hrvReadings[hrvReadings.length - 1].value) : null;
  const avgHrv = useMemo(() => {
    if (!hrvReadings.length) return null;
    return Math.round(hrvReadings.reduce((s, r) => s + r.value, 0) / hrvReadings.length);
  }, [hrvReadings]);

  const sleepMins = profile
    ? Number(profile.healthkitSleepMinutes ?? profile.manualSleepMinutes ?? null) || null
    : null;
  const sleepH = sleepMins !== null ? `${Math.floor(sleepMins / 60)}h ${sleepMins % 60}m` : null;

  const stepsToday = profile
    ? Number(profile.healthkitStepsToday ?? profile.manualStepsToday ?? null) || null
    : null;

  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Health &amp; Recovery
        </span>
        <Link to="/metrics/overview" style={{ fontSize: 11, color: muted, textDecoration: 'none' }}>
          Full metrics →
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <MetricCard
          icon={<Activity size={14} />}
          title="HRV"
          value={latestHrv}
          unit="ms"
          subtitle={avgHrv !== null ? `30d avg: ${avgHrv} ms ${trendIcon(hrvSparkline) as any}` : undefined}
          trend={hrvSparkline}
          trendColor="#10b981"
          isDark={isDark}
        />
        <MetricCard
          icon={<Moon size={14} />}
          title="Sleep"
          value={sleepH}
          subtitle={stepsToday !== null ? `${stepsToday.toLocaleString()} steps` : undefined}
          trendColor="#6366f1"
          isDark={isDark}
        />
      </div>
    </div>
  );
};

export default HealthMetricsDashboardWidget;

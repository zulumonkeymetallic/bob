/**
 * FitnessWidget — Running, Swimming, Cycling SportCards dashboard widget.
 *
 * Data sources:
 *   metrics_workouts — Strava/parkrun workouts (last 90 days)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Activity, Waves, Bike } from 'lucide-react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { SportCard, RangeSelector, type RangeKey } from './shared';

function sportDistM(sport: 'run' | 'swim' | 'bike', ws: any[]): number {
  return ws
    .filter((w) => {
      if (w.provider === 'parkrun' || w.run === true) return sport === 'run';
      const t = String(w.type || w.sportType || '').toLowerCase();
      if (sport === 'swim') return t.includes('swim');
      if (sport === 'bike') return t.includes('ride') || t.includes('bike') || t.includes('cycling');
      return t.includes('run') || t.includes('walk') || t.includes('hike');
    })
    .reduce((s, w) => s + (Number(w.distance_m) || 0), 0);
}

const FitnessWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [workouts, setWorkouts] = useState<any[]>([]);
  const [rangeDays, setRangeDays] = useState<RangeKey>(30);

  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    const cutoff = Date.now() - 90 * 86_400_000;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', uid),
      orderBy('startDate', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setWorkouts(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((w: any) => (Number(w.startDate) || 0) >= cutoff),
      );
    });
  }, [uid]);

  const now = Date.now();
  const cutoffMs = now - rangeDays * 86_400_000;
  const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const weekMs = now - 7 * 86_400_000;

  const workoutsInRange = useMemo(
    () => workouts.filter((w) => (Number(w.startDate) || 0) >= cutoffMs),
    [workouts, cutoffMs],
  );
  const ytdWorkouts = useMemo(
    () => workouts.filter((w) => (Number(w.startDate) || 0) >= ytdStart),
    [workouts, ytdStart],
  );
  const weekWorkouts = useMemo(
    () => workouts.filter((w) => (Number(w.startDate) || 0) >= weekMs),
    [workouts, weekMs],
  );

  function buildBarData(sport: 'run' | 'swim' | 'bike') {
    const weeks = Math.ceil(rangeDays / 7);
    return Array.from({ length: weeks }, (_, i) => {
      const wStart = now - (weeks - i) * 7 * 86_400_000;
      const wEnd = wStart + 7 * 86_400_000;
      const ws = workouts.filter((w) => {
        const ms = Number(w.startDate) || 0;
        return ms >= wStart && ms < wEnd;
      });
      const label = new Date(wStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return { label, km: sportDistM(sport, ws) / 1000 };
    });
  }

  const muted = isDark ? '#9ca3af' : '#6b7280';

  const sports = [
    { sport: 'run' as const, label: 'Running', icon: <Activity size={16} />, color: '#3b82f6' },
    { sport: 'swim' as const, label: 'Swimming', icon: <Waves size={16} />, color: '#06b6d4' },
    { sport: 'bike' as const, label: 'Cycling', icon: <Bike size={16} />, color: '#f59e0b' },
  ] as const;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Fitness
        </span>
        <RangeSelector rangeDays={rangeDays} onChange={setRangeDays} isDark={isDark} />
      </div>
      <Row className="g-2">
        {sports.map(({ sport, label, icon, color }) => (
          <Col xs={12} md={4} key={sport}>
            <SportCard
              icon={icon}
              sport={label}
              ytdM={sportDistM(sport, ytdWorkouts)}
              rangeM={sportDistM(sport, workoutsInRange)}
              rangeLabel={`Last ${rangeDays}d`}
              weekM={sportDistM(sport, weekWorkouts)}
              color={color}
              barData={buildBarData(sport)}
              isDark={isDark}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default FitnessWidget;

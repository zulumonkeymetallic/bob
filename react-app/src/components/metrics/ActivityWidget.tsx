/**
 * ActivityWidget — Steps + HRV trend line chart dashboard widget.
 *
 * Data sources:
 *   profiles/{uid}  — today's HealthKit snapshot (steps)
 *   metrics_hrv     — daily HRV readings (last 90 days)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Footprints } from 'lucide-react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { MetricCard, RangeSelector, num, shortDate, type RangeKey } from './shared';

const ActivityWidget: React.FC = () => {
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

  const stepsToday = num(profile, 'healthkitStepsToday', 'manualStepsToday');

  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Activity
        </span>
        <RangeSelector rangeDays={rangeDays} onChange={setRangeDays} isDark={isDark} />
      </div>
      <Row className="g-2">
        <Col xs={12} sm={4}>
          <MetricCard
            icon={<Footprints size={16} />}
            title="Steps"
            value={stepsToday != null ? Math.round(stepsToday).toLocaleString() : null}
            unit="today"
            subtitle="Target: 10,000 steps"
            trendColor="#3b82f6"
            isDark={isDark}
            badge={
              stepsToday != null
                ? stepsToday >= 10000
                  ? { text: '✓ Goal hit', variant: 'success' }
                  : { text: `${Math.round((stepsToday / 10000) * 100)}%`, variant: 'info' }
                : undefined
            }
          />
        </Col>
        <Col xs={12} sm={8}>
          {hrvInRange.length > 2 ? (
            <div
              style={{
                background: isDark ? '#1e2433' : '#ffffff',
                border: `1px solid ${border}`,
                borderRadius: 12,
                padding: '16px 18px',
                height: '100%',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 8,
                }}
              >
                HRV Trend — last {rangeDays} days
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart
                  data={hrvInRange.map((r) => ({ date: shortDate(r.date), v: r.value }))}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? '#2d3748' : '#f1f5f9'}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1e2433' : '#fff',
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(v: number) => [`${v} ms`, 'HRV']}
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div
              style={{
                background: isDark ? '#1e2433' : '#ffffff',
                border: `1px solid ${border}`,
                borderRadius: 12,
                padding: '16px 18px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: muted,
                fontSize: 13,
              }}
            >
              No HRV data for selected range
            </div>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default ActivityWidget;

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, ButtonGroup, Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { format, subMonths, startOfDay, eachDayOfInterval } from 'date-fns';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface YouTubeHistoryItem {
  id: string;
  ownerUid?: string;
  videoId?: string | null;
  title?: string | null;
  channelTitle?: string | null;
  watchedAt?: number | null;
  watchedAtMs?: number | null;
  durationSec?: number | null;
  durationMinutes?: number | null;
  watchTimeSec?: number | null;
  watchTimeMinutes?: number | null;
}

const rangeOptions = [1, 3, 6];

const getWatchedAtMs = (item: YouTubeHistoryItem): number | null => {
  const raw = item.watchedAt ?? item.watchedAtMs;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
};

const getWatchSeconds = (item: YouTubeHistoryItem): number => {
  if (typeof item.watchTimeSec === 'number' && Number.isFinite(item.watchTimeSec)) return item.watchTimeSec;
  if (typeof item.watchTimeMinutes === 'number' && Number.isFinite(item.watchTimeMinutes)) return item.watchTimeMinutes * 60;
  if (typeof item.durationSec === 'number' && Number.isFinite(item.durationSec)) return item.durationSec;
  if (typeof item.durationMinutes === 'number' && Number.isFinite(item.durationMinutes)) return item.durationMinutes * 60;
  return 0;
};

const formatMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hrs}h ${mins}m`;
};

const YouTubeHistoryDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [rangeMonths, setRangeMonths] = useState<number>(3);
  const [items, setItems] = useState<YouTubeHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const since = startOfDay(subMonths(new Date(), rangeMonths));
        const sinceMs = since.getTime();
        const q = query(
          collection(db, 'youtube_history'),
          where('ownerUid', '==', currentUser.uid),
          where('watchedAt', '>=', sinceMs),
          orderBy('watchedAt', 'asc')
        );
        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as YouTubeHistoryItem[];
        setItems(rows);
      } catch (err: any) {
        console.error('Failed to load YouTube history', err);
        setError(err?.message || 'Failed to load YouTube history');
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser, rangeMonths]);

  const sinceDate = useMemo(() => startOfDay(subMonths(new Date(), rangeMonths)), [rangeMonths]);
  const dailySeries = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const watchedAt = getWatchedAtMs(item);
      if (!watchedAt) return;
      const dayKey = format(new Date(watchedAt), 'yyyy-MM-dd');
      const minutes = getWatchSeconds(item) / 60;
      map.set(dayKey, (map.get(dayKey) || 0) + minutes);
    });

    const days = eachDayOfInterval({ start: sinceDate, end: new Date() });
    return days.map((d) => {
      const key = format(d, 'yyyy-MM-dd');
      return {
        date: format(d, 'MMM d'),
        minutes: Math.round(map.get(key) || 0),
      };
    });
  }, [items, sinceDate]);

  const channelSeries = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const channel = item.channelTitle || 'Unknown';
      const minutes = getWatchSeconds(item) / 60;
      map.set(channel, (map.get(channel) || 0) + minutes);
    });
    return Array.from(map.entries())
      .map(([channel, minutes]) => ({ channel, minutes: Math.round(minutes) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);
  }, [items]);

  const totals = useMemo(() => {
    const totalSeconds = items.reduce((sum, item) => sum + getWatchSeconds(item), 0);
    const totalMinutes = totalSeconds / 60;
    const topChannel = channelSeries[0]?.channel || '—';
    const avgPerDay = dailySeries.length ? totalMinutes / dailySeries.length : 0;
    return {
      totalMinutes,
      totalVideos: items.length,
      avgPerDay,
      topChannel,
    };
  }, [items, channelSeries, dailySeries]);

  if (!currentUser) {
    return <Alert variant="warning">Sign in to view YouTube history.</Alert>;
  }

  return (
    <div className="p-2">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h4 className="mb-0">YouTube History</h4>
          <div className="text-muted small">Watch history over the last {rangeMonths} month{rangeMonths > 1 ? 's' : ''}.</div>
        </div>
        <ButtonGroup size="sm">
          {rangeOptions.map((option) => (
            <Button
              key={option}
              variant={rangeMonths === option ? 'primary' : 'outline-primary'}
              onClick={() => setRangeMonths(option)}
            >
              {option}m
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && (
        <div className="d-flex align-items-center gap-2 text-muted mb-3">
          <Spinner animation="border" size="sm" /> Loading history…
        </div>
      )}

      <Row className="g-2 mb-3">
        <Col xs={6} md={3}>
          <Card className="h-100">
            <Card.Body className="p-2">
              <div className="text-muted small">Total watch time</div>
              <div className="fw-semibold">{formatMinutes(totals.totalMinutes)}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100">
            <Card.Body className="p-2">
              <div className="text-muted small">Videos watched</div>
              <div className="fw-semibold">{totals.totalVideos}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100">
            <Card.Body className="p-2">
              <div className="text-muted small">Avg per day</div>
              <div className="fw-semibold">{formatMinutes(totals.avgPerDay)}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} md={3}>
          <Card className="h-100">
            <Card.Body className="p-2">
              <div className="text-muted small">Top channel</div>
              <div className="fw-semibold text-truncate" title={totals.topChannel}>{totals.topChannel}</div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-2">
        <Col md={7}>
          <Card className="h-100">
            <Card.Header className="d-flex align-items-center justify-content-between">
              <div className="fw-semibold">Daily watch time</div>
              <Badge bg="secondary">Last {rangeMonths}m</Badge>
            </Card.Header>
            <Card.Body style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailySeries} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value: any) => [`${value}m`, 'Minutes']} />
                  <Line type="monotone" dataKey="minutes" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card.Body>
          </Card>
        </Col>
        <Col md={5}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Top channels</Card.Header>
            <Card.Body style={{ height: 260 }}>
              {channelSeries.length === 0 ? (
                <div className="text-muted small">No channel data yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={channelSeries} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="channel" type="category" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip formatter={(value: any) => [`${value}m`, 'Minutes']} />
                    <Bar dataKey="minutes" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default YouTubeHistoryDashboard;

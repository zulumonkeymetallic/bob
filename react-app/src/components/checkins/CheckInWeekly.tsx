import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from 'firebase/firestore';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface WeeklyCheckInDoc {
  id: string;
  ownerUid: string;
  weekKey: string;
  weekStartMs: number;
  weekEndMs: number;
  metrics: {
    themes: Array<{ label: string; planned: number; completed: number }>;
    routines: Array<{ label: string; planned: number; completed: number }>;
    stories: Array<{ label: string; planned: number; completed: number; minutes: number }>;
    tasks: Array<{ label: string; planned: number; completed: number; minutes: number }>;
    spendLast3DaysPence?: number | null;
    spendLast7DaysPence?: number | null;
  };
  reflection: {
    wentWell: string;
    toImprove: string;
    blockers: string;
    nextFocus: string;
  };
  createdAt?: any;
  updatedAt?: any;
}

const WEEK_FORMAT = "yyyy-'W'II";

const formatMoney = (val: number, currency = 'GBP') =>
  (val / 100).toLocaleString('en-GB', { style: 'currency', currency });

const CheckInWeekly: React.FC = () => {
  const { currentUser } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }),
  );
  const [metrics, setMetrics] = useState<WeeklyCheckInDoc['metrics'] | null>(null);
  const [reflection, setReflection] = useState<WeeklyCheckInDoc['reflection']>({
    wentWell: '',
    toImprove: '',
    blockers: '',
    nextFocus: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekKey = useMemo(() => format(weekStart, WEEK_FORMAT), [weekStart]);

  const loadWeeklyData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const ownerUid = currentUser.uid;
      const startKey = format(weekStart, 'yyyyMMdd');
      const endKey = format(weekEnd, 'yyyyMMdd');
      const checkinsSnap = await getDocs(
        query(
          collection(db, 'daily_checkins'),
          where('ownerUid', '==', ownerUid),
          where('dateKey', '>=', startKey),
          where('dateKey', '<=', endKey),
        ),
      );
      const checkins = checkinsSnap.docs.map((docSnap) => docSnap.data() as any);

      const themeMap = new Map<string, { planned: number; completed: number }>();
      const routineMap = new Map<string, { planned: number; completed: number }>();
      const storyMap = new Map<string, { planned: number; completed: number; minutes: number }>();
      const taskMap = new Map<string, { planned: number; completed: number; minutes: number }>();

      checkins.forEach((checkin) => {
        (checkin.items || []).forEach((item: any) => {
          const label = item.theme || 'General';
          const duration = Number(item.durationMin || 0);
          if (item.type === 'block') {
            const themeRow = themeMap.get(label) || { planned: 0, completed: 0 };
            themeRow.planned += 1;
            if (item.completed) themeRow.completed += 1;
            themeMap.set(label, themeRow);
          }
          if (item.type === 'instance' || item.type === 'habit') {
            const routineLabel = item.title || (item.type === 'habit' ? 'Habit' : 'Routine');
            const routineRow = routineMap.get(routineLabel) || { planned: 0, completed: 0 };
            routineRow.planned += 1;
            if (item.completed) routineRow.completed += 1;
            routineMap.set(routineLabel, routineRow);
          }
          if (item.storyRef || item.storyId) {
            const storyLabel = item.storyRef || item.storyId || 'Story';
            const storyRow = storyMap.get(storyLabel) || { planned: 0, completed: 0, minutes: 0 };
            storyRow.planned += 1;
            storyRow.minutes += duration;
            if (item.completed) storyRow.completed += 1;
            storyMap.set(storyLabel, storyRow);
          }
          if (item.taskRef || item.taskId) {
            const taskLabel = item.taskRef || item.taskId || 'Task';
            const taskRow = taskMap.get(taskLabel) || { planned: 0, completed: 0, minutes: 0 };
            taskRow.planned += 1;
            taskRow.minutes += duration;
            if (item.completed) taskRow.completed += 1;
            taskMap.set(taskLabel, taskRow);
          }
        });
      });

      const spendLast3Days = await getDocs(
        query(
          collection(db, 'monzo_transactions'),
          where('ownerUid', '==', ownerUid),
          where('createdAt', '>=', new Date(weekEnd.getTime() - 2 * 24 * 60 * 60 * 1000)),
          orderBy('createdAt', 'desc'),
        ),
      );
      let spendLast3DaysPence = 0;
      spendLast3Days.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const amount = Number(data.amountMinor ?? data.amount ?? 0);
        if (amount < 0) spendLast3DaysPence += Math.abs(amount);
      });

      const spendLast7Days = await getDocs(
        query(
          collection(db, 'monzo_transactions'),
          where('ownerUid', '==', ownerUid),
          where('createdAt', '>=', weekStart),
          orderBy('createdAt', 'desc'),
        ),
      );
      let spendLast7DaysPence = 0;
      spendLast7Days.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const amount = Number(data.amountMinor ?? data.amount ?? 0);
        if (amount < 0) spendLast7DaysPence += Math.abs(amount);
      });

      setMetrics({
        themes: Array.from(themeMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        routines: Array.from(routineMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        stories: Array.from(storyMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        tasks: Array.from(taskMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        spendLast3DaysPence,
        spendLast7DaysPence,
      });

      const existing = await getDoc(doc(db, 'weekly_checkins', `${ownerUid}_${weekKey}`));
      if (existing.exists()) {
        const data = existing.data() as WeeklyCheckInDoc;
        setReflection(data.reflection || reflection);
      }
    } catch (err) {
      console.error('Failed to load weekly check-in', err);
      setError('Unable to load weekly check-in data.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, weekEnd, weekKey, weekStart, reflection]);

  useEffect(() => {
    loadWeeklyData();
  }, [loadWeeklyData]);

  const handleSave = useCallback(async () => {
    if (!currentUser || !metrics) return;
    setSaving(true);
    try {
      const payload: WeeklyCheckInDoc = {
        id: `${currentUser.uid}_${weekKey}`,
        ownerUid: currentUser.uid,
        weekKey,
        weekStartMs: weekStart.getTime(),
        weekEndMs: weekEnd.getTime(),
        metrics,
        reflection,
      };
      await setDoc(doc(db, 'weekly_checkins', payload.id), {
        ...payload,
        updatedAt: new Date(),
        createdAt: new Date(),
      }, { merge: true });
    } catch (err) {
      console.error('Failed to save weekly check-in', err);
      setError('Failed to save weekly check-in.');
    } finally {
      setSaving(false);
    }
  }, [currentUser, metrics, reflection, weekEnd, weekKey, weekStart]);

  return (
    <div className="p-3">
      <h3 className="mb-3">Weekly Check-in</h3>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <Form.Control
          type="date"
          value={format(weekStart, 'yyyy-MM-dd')}
          onChange={(e) => setWeekStart(startOfWeek(new Date(e.target.value), { weekStartsOn: 1 }))}
          style={{ maxWidth: 200 }}
        />
        <Badge bg="secondary">
          {format(weekStart, 'dd MMM')} – {format(weekEnd, 'dd MMM')}
        </Badge>
        <Button variant="primary" onClick={handleSave} disabled={saving || loading || !metrics}>
          {saving ? 'Saving…' : 'Submit weekly check-in'}
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading || !metrics ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" animation="border" /> Loading weekly metrics…
        </div>
      ) : (
        <>
          <Row className="g-3 mb-3">
            <Col lg={6}>
              <Card className="shadow-sm border-0">
                <Card.Header className="fw-semibold">Planned vs completed (Themes)</Card.Header>
                <Card.Body>
                  {metrics.themes.length === 0 ? (
                    <div className="text-muted">No themed blocks this week.</div>
                  ) : (
                    metrics.themes.map((row) => (
                      <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                        <span>{row.label}</span>
                        <Badge bg={row.completed === row.planned ? 'success' : 'secondary'}>
                          {row.completed}/{row.planned}
                        </Badge>
                      </div>
                    ))
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="shadow-sm border-0">
                <Card.Header className="fw-semibold">Habits</Card.Header>
                <Card.Body>
                  {metrics.routines.length === 0 ? (
                    <div className="text-muted">No habits logged.</div>
                  ) : (
                    metrics.routines.map((row) => (
                      <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                        <span>{row.label}</span>
                        <Badge bg={row.completed === row.planned ? 'success' : 'secondary'}>
                          {row.completed}/{row.planned}
                        </Badge>
                      </div>
                    ))
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mb-3">
            <Col lg={6}>
              <Card className="shadow-sm border-0">
                <Card.Header className="fw-semibold">Stories worked on</Card.Header>
                <Card.Body>
                  {metrics.stories.length === 0 ? (
                    <div className="text-muted">No story blocks logged.</div>
                  ) : (
                    metrics.stories.map((row) => (
                      <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                        <span>{row.label}</span>
                        <span className="text-muted small">
                          {row.completed}/{row.planned} · {row.minutes} min
                        </span>
                      </div>
                    ))
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="shadow-sm border-0">
                <Card.Header className="fw-semibold">Tasks worked on</Card.Header>
                <Card.Body>
                  {metrics.tasks.length === 0 ? (
                    <div className="text-muted">No task blocks logged.</div>
                  ) : (
                    metrics.tasks.map((row) => (
                      <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                        <span>{row.label}</span>
                        <span className="text-muted small">
                          {row.completed}/{row.planned} · {row.minutes} min
                        </span>
                      </div>
                    ))
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mb-3">
            <Col lg={6}>
              <Card className="shadow-sm border-0">
                <Card.Header className="fw-semibold">Spend (Monzo)</Card.Header>
                <Card.Body>
                  <div className="d-flex justify-content-between">
                    <span>Last 3 days</span>
                    <span className="fw-semibold">
                      {metrics.spendLast3DaysPence != null ? formatMoney(metrics.spendLast3DaysPence) : '—'}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between">
                    <span>Last 7 days</span>
                    <span className="fw-semibold">
                      {metrics.spendLast7DaysPence != null ? formatMoney(metrics.spendLast7DaysPence) : '—'}
                    </span>
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="shadow-sm border-0">
                <Card.Header className="fw-semibold">Reflection</Card.Header>
                <Card.Body className="d-flex flex-column gap-2">
                  <Form.Control
                    as="textarea"
                    rows={2}
                    placeholder="What went well?"
                    value={reflection.wentWell}
                    onChange={(e) => setReflection((prev) => ({ ...prev, wentWell: e.target.value }))}
                  />
                  <Form.Control
                    as="textarea"
                    rows={2}
                    placeholder="What could be improved?"
                    value={reflection.toImprove}
                    onChange={(e) => setReflection((prev) => ({ ...prev, toImprove: e.target.value }))}
                  />
                  <Form.Control
                    as="textarea"
                    rows={2}
                    placeholder="Blockers or friction?"
                    value={reflection.blockers}
                    onChange={(e) => setReflection((prev) => ({ ...prev, blockers: e.target.value }))}
                  />
                  <Form.Control
                    as="textarea"
                    rows={2}
                    placeholder="Next week focus"
                    value={reflection.nextFocus}
                    onChange={(e) => setReflection((prev) => ({ ...prev, nextFocus: e.target.value }))}
                  />
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};

export default CheckInWeekly;

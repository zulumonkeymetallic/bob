import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { CalendarCheck, CalendarDays } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { format, startOfWeek, addDays } from 'date-fns';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const DAILY_DISMISS_KEY = (dateKey: string) => `checkin-daily-dismissed-${dateKey}`;
const WEEKLY_DISMISS_KEY = (weekKey: string) => `checkin-weekly-dismissed-${weekKey}`;

const CheckInBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [showDaily, setShowDaily] = useState(false);
  const [showWeekly, setShowWeekly] = useState(false);
  const [dailyMessage, setDailyMessage] = useState('Review today’s planned items and mark what you completed.');
  const [dailyKey, setDailyKey] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeek(addDays(today, -7), { weekStartsOn: 1 }), [today]);
  const weekKey = useMemo(() => format(weekStart, "yyyy-'W'II"), [weekStart]);

  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    if (now.getHours() < 18) {
      next.setHours(18, 0, 0, 0);
    } else {
      next.setDate(now.getDate() + 1);
      next.setHours(0, 0, 0, 0);
    }
    const delay = Math.max(60 * 1000, next.getTime() - now.getTime());
    const timer = setTimeout(() => setRefreshTick((prev) => prev + 1), delay);
    return () => clearTimeout(timer);
  }, [refreshTick]);

  useEffect(() => {
    const run = async () => {
      if (!currentUser) return;
      const now = new Date();
      const isAfterSix = now.getHours() >= 18;
      const targetDate = isAfterSix ? now : addDays(now, -1);
      const targetKey = format(targetDate, 'yyyyMMdd');
      const message = isAfterSix
        ? 'Review today’s planned items and mark what you completed.'
        : 'Review yesterday’s planned items.';
      setDailyKey(targetKey);
      setDailyMessage(message);

      const dailyDismissed = localStorage.getItem(DAILY_DISMISS_KEY(targetKey));
      const weeklyDismissed = localStorage.getItem(WEEKLY_DISMISS_KEY(weekKey));

      const dailySnap = await getDoc(doc(db, 'daily_checkins', `${currentUser.uid}_${targetKey}`));
      if (!dailySnap.exists()) {
        setShowDaily(!dailyDismissed);
      } else {
        setShowDaily(false);
      }

      const weeklySnap = await getDoc(doc(db, 'weekly_checkins', `${currentUser.uid}_${weekKey}`));
      const weekShouldPrompt = today.getTime() >= startOfWeek(today, { weekStartsOn: 1 }).getTime();
      setShowWeekly(weekShouldPrompt && !weeklySnap.exists() && !weeklyDismissed);
    };
    run();
  }, [currentUser, weekKey, today, refreshTick]);

  if (!showDaily && !showWeekly) return null;

  return (
    <div className="mb-3">
      {showDaily && (
        <Alert
          variant="info"
          dismissible
          onClose={() => {
            if (dailyKey) {
              localStorage.setItem(DAILY_DISMISS_KEY(dailyKey), 'true');
            }
            setShowDaily(false);
          }}
          className="border-0 shadow-sm"
        >
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <CalendarCheck size={20} />
              <div>
                <div className="fw-semibold">Daily check-in</div>
                <div className="text-muted small">{dailyMessage}</div>
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => navigate('/checkin/daily')}>
              Start
            </Button>
          </div>
        </Alert>
      )}
      {showWeekly && (
        <Alert
          variant="secondary"
          dismissible
          onClose={() => {
            localStorage.setItem(WEEKLY_DISMISS_KEY(weekKey), 'true');
            setShowWeekly(false);
          }}
          className="border-0 shadow-sm"
        >
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <CalendarDays size={20} />
              <div>
                <div className="fw-semibold">Weekly check-in</div>
                <div className="text-muted small">Review last week’s planned vs completed items.</div>
              </div>
            </div>
            <Button size="sm" variant="outline-primary" onClick={() => navigate('/checkin/weekly')}>
              Review week
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
};

export default CheckInBanner;

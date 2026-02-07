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

  const today = useMemo(() => new Date(), []);
  const dateKey = useMemo(() => format(today, 'yyyyMMdd'), [today]);
  const weekStart = useMemo(() => startOfWeek(addDays(today, -7), { weekStartsOn: 1 }), [today]);
  const weekKey = useMemo(() => format(weekStart, "yyyy-'W'II"), [weekStart]);

  useEffect(() => {
    const run = async () => {
      if (!currentUser) return;
      const dailyDismissed = localStorage.getItem(DAILY_DISMISS_KEY(dateKey));
      const weeklyDismissed = localStorage.getItem(WEEKLY_DISMISS_KEY(weekKey));

      const dailySnap = await getDoc(doc(db, 'daily_checkins', `${currentUser.uid}_${dateKey}`));
      if (!dailySnap.exists()) {
        setShowDaily(!dailyDismissed);
      } else {
        const dailyData = dailySnap.data() as any;
        const plannedCount = Number(dailyData?.plannedCount || 0);
        const completedCount = Number(dailyData?.completedCount || 0);
        const hasIncomplete = plannedCount > 0 && completedCount < plannedCount;
        setShowDaily(hasIncomplete);
      }

      const weeklySnap = await getDoc(doc(db, 'weekly_checkins', `${currentUser.uid}_${weekKey}`));
      const weekShouldPrompt = today.getTime() >= startOfWeek(today, { weekStartsOn: 1 }).getTime();
      setShowWeekly(weekShouldPrompt && !weeklySnap.exists() && !weeklyDismissed);
    };
    run();
  }, [currentUser, dateKey, weekKey, today]);

  if (!showDaily && !showWeekly) return null;

  return (
    <div className="mb-3">
      {showDaily && (
        <Alert
          variant="info"
          dismissible
          onClose={() => {
            localStorage.setItem(DAILY_DISMISS_KEY(dateKey), 'true');
            setShowDaily(false);
          }}
          className="border-0 shadow-sm"
        >
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <CalendarCheck size={20} />
              <div>
                <div className="fw-semibold">Daily check-in</div>
                <div className="text-muted small">Review today’s planned items and mark what you completed.</div>
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

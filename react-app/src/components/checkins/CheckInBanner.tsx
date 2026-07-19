import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { format, startOfWeek, addDays } from 'date-fns';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const DAILY_DISMISS_KEY = (dateKey: string) => `checkin-daily-dismissed-${dateKey}`;
const WEEKLY_DISMISS_KEY = (weekKey: string) => `checkin-weekly-dismissed-${weekKey}`;
const DAILY_CUTOFF_HOUR = 13;

const getDailyTargetDate = (now: Date): Date => {
  const target = new Date(now);
  if (now.getHours() < DAILY_CUTOFF_HOUR) {
    target.setDate(now.getDate() - 1);
  }
  return target;
};

const getEndOfTuesdayForWeek = (weekStart: Date): Date => {
  const cutoff = new Date(weekStart);
  cutoff.setDate(weekStart.getDate() + 1);
  cutoff.setHours(23, 59, 59, 999);
  return cutoff;
};

// Only ever mounted inside NotificationStream's bell dropdown (confirmed: no other call
// sites) — matches the plain-row style the rest of that dropdown already uses
// (DeferralCandidatesBanner, GlobalGoalFocusBanner, CoachVerdictBanner's compact mode)
// instead of a full-width react-bootstrap Alert with its own icon/button chrome.
const CheckInBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [showDaily, setShowDaily] = useState(false);
  const [showWeekly, setShowWeekly] = useState(false);
  const [dailyMessage, setDailyMessage] = useState('Review today’s planned items and mark what you completed.');
  const [dailyKey, setDailyKey] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const now = useMemo(() => new Date(), [refreshTick]);
  const today = useMemo(() => now, [now]);
  const weekStart = useMemo(() => startOfWeek(addDays(today, -7), { weekStartsOn: 1 }), [today]);
  const weekKey = useMemo(() => format(weekStart, "yyyy-'W'II"), [weekStart]);

  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    if (now.getHours() < DAILY_CUTOFF_HOUR) {
      next.setHours(DAILY_CUTOFF_HOUR, 0, 0, 0);
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
      const beforeCutoff = now.getHours() < DAILY_CUTOFF_HOUR;
      const targetDate = getDailyTargetDate(now);
      const targetKey = format(targetDate, 'yyyyMMdd');
      const message = beforeCutoff
        ? 'Review yesterday’s planned items.'
        : 'Daily check-in closes at 1pm, so it is now hidden until tomorrow.';
      setDailyKey(targetKey);
      setDailyMessage(message);

      const dailyDismissed = localStorage.getItem(DAILY_DISMISS_KEY(targetKey));
      const weeklyDismissed = localStorage.getItem(WEEKLY_DISMISS_KEY(weekKey));

      const dailySnap = await getDoc(doc(db, 'daily_checkins', `${currentUser.uid}_${targetKey}`));
      if (!dailySnap.exists() && beforeCutoff) {
        setShowDaily(!dailyDismissed);
      } else {
        setShowDaily(false);
      }

      const weeklySnap = await getDoc(doc(db, 'weekly_checkins', `${currentUser.uid}_${weekKey}`));
      const weekShouldPrompt = now.getTime() <= getEndOfTuesdayForWeek(startOfWeek(now, { weekStartsOn: 1 })).getTime();
      setShowWeekly(weekShouldPrompt && !weeklySnap.exists() && !weeklyDismissed);
    };
    run();
  }, [currentUser, weekKey, today, refreshTick]);

  if (!showDaily && !showWeekly) return null;

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--notion-hover, rgba(0,0,0,0.04))',
    border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
    padding: '5px 8px', textAlign: 'left', cursor: 'pointer', width: '100%',
  };
  const dismissStyle: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, fontSize: 10,
    color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0,
  };

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>
        Check-in
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {showDaily && (
          <button type="button" style={rowStyle} onClick={() => navigate('/checkin/daily')}>
            <CalendarCheck size={13} style={{ flexShrink: 0, color: 'var(--brand, #5f77dc)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Daily check-in</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{dailyMessage}</div>
            </span>
            <span
              role="button"
              tabIndex={0}
              style={dismissStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (dailyKey) localStorage.setItem(DAILY_DISMISS_KEY(dailyKey), 'true');
                setShowDaily(false);
              }}
            >
              Dismiss
            </span>
          </button>
        )}
        {showWeekly && (
          <button type="button" style={rowStyle} onClick={() => navigate('/checkin/weekly')}>
            <CalendarDays size={13} style={{ flexShrink: 0, color: 'var(--brand, #5f77dc)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Weekly check-in</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Review last week’s planned vs completed items.</div>
            </span>
            <span
              role="button"
              tabIndex={0}
              style={dismissStyle}
              onClick={(e) => {
                e.stopPropagation();
                localStorage.setItem(WEEKLY_DISMISS_KEY(weekKey), 'true');
                setShowWeekly(false);
              }}
            >
              Dismiss
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default CheckInBanner;

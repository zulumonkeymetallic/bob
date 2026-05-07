import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button } from 'react-bootstrap';
import { CalendarDays, Target, X } from 'lucide-react';
import { Goal } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISS_PREFIX = 'dashboard-goal-rotation-dismiss:';
const ROTATION_CURSOR_KEY = 'dashboard-goal-rotation-cursor';

interface RotatingGoalFocusBannerProps {
  goals: Goal[];
  defaultGoalIds?: string[];
  onOpenGoal?: (goalId: string) => void;
}

const toDateMs = (value: any): number | null => {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      const converted = value.toDate();
      const ms = converted?.getTime?.();
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const parseGoalStartMs = (goal: Goal): number | null => {
  const direct = toDateMs((goal as any).startDate);
  if (direct) return direct;
  const target = toDateMs((goal as any).targetDate);
  if (target) return target;
  const due = toDateMs((goal as any).dueDate);
  if (due) return due;
  return toDateMs((goal as any).endDate);
};

const parseGoalEndMs = (goal: Goal): number | null => {
  const direct = toDateMs((goal as any).endDate);
  if (direct) return direct;
  const target = toDateMs((goal as any).targetDate);
  if (target) return target;
  return toDateMs((goal as any).dueDate);
};

const isGoalBannerFlagged = (goal: Goal, defaultGoalIds: Set<string>): boolean => {
  const tags = Array.isArray((goal as any).tags)
    ? (goal as any).tags.map((tag: any) => String(tag || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const tagSet = new Set(tags);
  const hasTagFlag = (
    tagSet.has('banner') ||
    tagSet.has('daily-banner') ||
    tagSet.has('focus-banner') ||
    tagSet.has('rotation-banner') ||
    tagSet.has('project45')
  );
  const hasFieldFlag = (
    (goal as any).showInDashboardBanner === true ||
    (goal as any).dashboardBanner === true ||
    (goal as any).isBannerGoal === true
  );
  return hasTagFlag || hasFieldFlag || defaultGoalIds.has(String(goal.id || ''));
};

const RotatingGoalFocusBanner: React.FC<RotatingGoalFocusBannerProps> = ({
  goals,
  defaultGoalIds = [],
  onOpenGoal,
}) => {
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const defaultGoalIdSet = useMemo(
    () => new Set((defaultGoalIds || []).map((goalId) => String(goalId || '').trim()).filter(Boolean)),
    [defaultGoalIds]
  );

  const flaggedGoals = useMemo(
    () =>
      goals
        .filter((goal) => Number((goal as any).status || 0) !== 2)
        .filter((goal) => isGoalBannerFlagged(goal, defaultGoalIdSet))
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
    [goals, defaultGoalIdSet]
  );

  const eligibleGoals = useMemo(() => {
    const now = Date.now();
    return flaggedGoals.filter((goal) => {
      if (typeof window === 'undefined') return true;
      const raw = window.localStorage.getItem(`${DISMISS_PREFIX}${goal.id}`);
      if (!raw) return true;
      const dismissedAt = Date.parse(raw);
      if (Number.isNaN(dismissedAt)) return true;
      return (now - dismissedAt) >= DAY_MS;
    });
  }, [flaggedGoals, refreshTick]);

  useEffect(() => {
    if (initializedRef.current || eligibleGoals.length === 0 || typeof window === 'undefined') return;
    initializedRef.current = true;
    const previousCursor = Number(window.localStorage.getItem(ROTATION_CURSOR_KEY));
    const safePrevious = Number.isFinite(previousCursor) ? previousCursor : -1;
    const maxStep = Math.max(1, Math.min(eligibleGoals.length, 3));
    const step = 1 + Math.floor(Math.random() * maxStep);
    const nextCursor = (safePrevious + step + eligibleGoals.length) % eligibleGoals.length;
    window.localStorage.setItem(ROTATION_CURSOR_KEY, String(nextCursor));
    setActiveGoalId(eligibleGoals[nextCursor].id);
  }, [eligibleGoals]);

  useEffect(() => {
    if (eligibleGoals.length === 0) {
      setActiveGoalId(null);
      return;
    }
    if (!activeGoalId || !eligibleGoals.some((goal) => goal.id === activeGoalId)) {
      setActiveGoalId(eligibleGoals[0].id);
    }
  }, [activeGoalId, eligibleGoals]);

  const activeGoal = useMemo(
    () => eligibleGoals.find((goal) => goal.id === activeGoalId) || null,
    [eligibleGoals, activeGoalId]
  );

  const handleDismiss = useCallback(() => {
    if (!activeGoal || typeof window === 'undefined') return;
    window.localStorage.setItem(`${DISMISS_PREFIX}${activeGoal.id}`, new Date().toISOString());
    const remaining = eligibleGoals.filter((goal) => goal.id !== activeGoal.id);
    if (remaining.length > 0) {
      const nextIndex = Math.floor(Math.random() * remaining.length);
      setActiveGoalId(remaining[nextIndex].id);
    } else {
      setActiveGoalId(null);
    }
    setRefreshTick((tick) => tick + 1);
  }, [activeGoal, eligibleGoals]);

  if (!activeGoal) return null;

  const now = Date.now();
  const startMs = parseGoalStartMs(activeGoal);
  const endMs = parseGoalEndMs(activeGoal);
  const formattedStart = startMs
    ? new Date(startMs).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date not set';
  const daysUntilStart = startMs
    ? Math.max(0, Math.ceil((startMs - now) / DAY_MS))
    : null;

  const progressPct = (() => {
    if (!startMs || !endMs || endMs <= startMs) return 0;
    const elapsed = now - startMs;
    const total = endMs - startMs;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  })();

  return (
    <Card
      className="mb-3 border-0"
      style={{
        background: 'linear-gradient(135deg, #5f77dc 0%, #7054a8 100%)',
        color: '#fff',
        boxShadow: '0 6px 18px rgba(64, 34, 113, 0.25)',
      }}
    >
      <Card.Body style={{ padding: '10px 14px' }}>
        <div className="d-flex align-items-start gap-2">
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              flexShrink: 0,
            }}
          >
            <CalendarDays size={18} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ margin: 0, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeGoal.title || 'Flagged goal'}
            </div>
            <div style={{ marginTop: 2, fontSize: 11, opacity: 0.88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Start {formattedStart}
              {typeof daysUntilStart === 'number' ? ` • ${daysUntilStart} day${daysUntilStart === 1 ? '' : 's'} to go` : ''}
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>
              {typeof daysUntilStart === 'number' ? daysUntilStart : '—'}
            </div>
            <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>{progressPct}% elapsed</div>
          </div>

          <button
            onClick={handleDismiss}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            title="Dismiss for 24 hours"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant="light"
            onClick={() => onOpenGoal?.(activeGoal.id)}
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Open focus goals
          </Button>
          <div style={{ fontSize: 11, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <Target size={12} />
            <span>{eligibleGoals.length} flagged goal{eligibleGoals.length === 1 ? '' : 's'} in rotation</span>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default RotatingGoalFocusBanner;

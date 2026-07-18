/**
 * DailyPlanWidget — the single "what should I do today" surface. Shows the same unified
 * daily-plan list as mobile's /mobile?tab=daily_plan (tasks/stories/chores due today plus
 * shaded Google Calendar event rows, grouped into Morning/Afternoon/Evening buckets), plus:
 *  - a pinned Top 3 section at the top (folded in from the old standalone `top3` widget —
 *    same items also still appear in their normal time-of-day bucket below);
 *  - All/Tasks/Stories/Chores filter chips (folded in from the old standalone `choresHabits`
 *    widget, which covered the same due-today chore scope as this hook's chore inclusion).
 * See useDailyPlanTimeline for the shared derivation logic and DailyPlanList for the shared
 * row markup.
 */
import React, { useMemo, useState } from 'react';
import { Badge, Card, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { CalendarDays, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useDailyPlanTimeline, type DailyPlanBucket, type DailyPlanTimelineItem } from '../../hooks/useDailyPlanTimeline';
import DailyPlanList from './DailyPlanList';

const BUCKETS: Array<{ key: DailyPlanBucket; label: string }> = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

type KindFilter = 'all' | 'task' | 'story' | 'chore';
const KIND_FILTERS: Array<{ key: KindFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'story', label: 'Stories' },
  { key: 'chore', label: 'Chores' },
];

const DailyPlanWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  const { items, bucketCounts, loading, choreCompletionBusy, completeTask, completeChore } = useDailyPlanTimeline({
    uid: currentUser?.uid,
    persona: currentPersona,
  });

  const filteredItems = useMemo<DailyPlanTimelineItem[]>(
    () => (kindFilter === 'all' ? items : items.filter((item) => item.kind === kindFilter)),
    [items, kindFilter],
  );

  const pinnedTop3 = useMemo(
    () => filteredItems.filter((item) => item.isTop3),
    [filteredItems],
  );

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <CalendarDays size={15} />
          Today's Plan
        </div>
        <div className="d-flex align-items-center gap-2">
          <Link to="/dashboard/habit-tracking" className="btn btn-sm btn-outline-secondary">Tracking</Link>
          <Link to="/chores/checklist" className="btn btn-sm btn-outline-secondary">Checklist</Link>
          <Badge bg="secondary" pill>{filteredItems.length}</Badge>
        </div>
      </Card.Header>
      <Card.Body className="p-2" style={{ overflowY: 'auto' }}>
        <div className="d-flex align-items-center gap-1 flex-wrap px-1 mb-2">
          {KIND_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setKindFilter(key)}
              className={`btn btn-sm ${kindFilter === key ? 'btn-primary' : 'btn-outline-secondary'}`}
              style={{ fontSize: '0.72rem', padding: '2px 10px', borderRadius: 999 }}
            >
              {label}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small p-2">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-muted small p-2">
            {items.length === 0
              ? 'No tasks, stories, chores, or calendar events scheduled today.'
              : 'Nothing matches this filter today.'}
          </div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {pinnedTop3.length > 0 && (
              <div
                style={{
                  background: 'var(--bs-warning-bg-subtle, #fff8e1)',
                  border: '1px solid var(--bs-warning-border-subtle, #ffe69c)',
                  borderRadius: 6,
                  padding: '4px 2px',
                }}
              >
                <div
                  className="text-uppercase fw-semibold px-1 mb-1 d-flex align-items-center gap-1"
                  style={{ fontSize: '0.68rem', letterSpacing: '0.05em', color: 'var(--bs-warning-text-emphasis, #664d03)' }}
                >
                  <Star size={11} /> Top 3 <span className="text-muted">({pinnedTop3.length})</span>
                </div>
                <DailyPlanList
                  items={pinnedTop3}
                  choreCompletionBusy={choreCompletionBusy}
                  onCompleteTask={(task) => { void completeTask(task); }}
                  onCompleteChore={(task) => { void completeChore(task); }}
                />
              </div>
            )}
            {BUCKETS.map(({ key, label }) => {
              const bucketItems = filteredItems.filter((item) => item.bucket === key);
              if (bucketItems.length === 0) return null;
              return (
                <div key={key}>
                  <div
                    className="text-uppercase text-muted fw-semibold px-1 mb-1"
                    style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}
                  >
                    {label} <span className="text-muted">({kindFilter === 'all' ? bucketCounts[key] : bucketItems.length})</span>
                  </div>
                  <DailyPlanList
                    items={bucketItems}
                    choreCompletionBusy={choreCompletionBusy}
                    onCompleteTask={(task) => { void completeTask(task); }}
                    onCompleteChore={(task) => { void completeChore(task); }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default DailyPlanWidget;

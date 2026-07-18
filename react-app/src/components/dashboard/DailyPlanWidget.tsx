/**
 * DailyPlanWidget — desktop dashboard widget showing the same unified daily-plan list as
 * mobile's /mobile?tab=daily_plan: tasks/stories/chores due today plus shaded Google Calendar
 * event rows, grouped into Morning/Afternoon/Evening buckets. Replaces the old "Today's Agenda"
 * and "Add to Calendar" widgets. See useDailyPlanTimeline for the shared derivation logic and
 * DailyPlanList for the shared row markup.
 */
import React from 'react';
import { Badge, Card, Spinner } from 'react-bootstrap';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useDailyPlanTimeline, type DailyPlanBucket } from '../../hooks/useDailyPlanTimeline';
import DailyPlanList from './DailyPlanList';

const BUCKETS: Array<{ key: DailyPlanBucket; label: string }> = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

const DailyPlanWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const { items, bucketCounts, loading, choreCompletionBusy, completeTask, completeChore } = useDailyPlanTimeline({
    uid: currentUser?.uid,
    persona: currentPersona,
  });

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <CalendarDays size={15} />
          Today's Plan
        </div>
        <Badge bg="secondary" pill>{items.length}</Badge>
      </Card.Header>
      <Card.Body className="p-2" style={{ overflowY: 'auto' }}>
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small p-2">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted small p-2">No tasks, stories, chores, or calendar events scheduled today.</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {BUCKETS.map(({ key, label }) => {
              const bucketItems = items.filter((item) => item.bucket === key);
              if (bucketItems.length === 0) return null;
              return (
                <div key={key}>
                  <div
                    className="text-uppercase text-muted fw-semibold px-1 mb-1"
                    style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}
                  >
                    {label} <span className="text-muted">({bucketCounts[key]})</span>
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

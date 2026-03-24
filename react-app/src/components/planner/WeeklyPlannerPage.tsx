import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Form } from 'react-bootstrap';
import { addDays, addWeeks, format, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSprint } from '../../contexts/SprintContext';
import WeeklyPlannerSurface from './WeeklyPlannerSurface';
import PlanActionBar from './PlanActionBar';
import { useDetailLevel } from '../../contexts/DetailLevelContext';

const WeeklyPlannerPage: React.FC = () => {
  const { sprints, selectedSprintId } = useSprint();
  const { setDetailLevel } = useDetailLevel();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }));

  // Default to minimal card detail on the weekly planner (dense grid)
  useEffect(() => { setDetailLevel('minimal'); }, [setDetailLevel]);
  const isPlanningPromptWeek = useMemo(() => {
    const day = new Date().getDay();
    return day === 0 || day === 1;
  }, []);
  const currentSprint = useMemo(() => {
    const nowMs = Date.now();
    const selected = sprints.find((sprint) => sprint.id === selectedSprintId);
    if (selected) return selected;
    const active = sprints.find((sprint) => {
      const start = typeof sprint.startDate === 'number' ? sprint.startDate : 0;
      const end = typeof sprint.endDate === 'number' ? sprint.endDate : 0;
      return start > 0 && end > 0 && nowMs >= start && nowMs <= end;
    });
    if (active) return active;
    return sprints[0] || null;
  }, [selectedSprintId, sprints]);
  const sprintWeekOptions = useMemo(() => {
    if (!currentSprint?.startDate || !currentSprint?.endDate) return [];
    const options: Array<{ key: string; start: Date; label: string }> = [];
    let cursor = startOfWeek(new Date(currentSprint.startDate), { weekStartsOn: 1 });
    const sprintEnd = new Date(currentSprint.endDate);
    let index = 0;
    while (cursor.getTime() <= sprintEnd.getTime()) {
      options.push({
        key: format(cursor, 'yyyy-MM-dd'),
        start: cursor,
        label: `Week ${index + 1}`,
      });
      cursor = addWeeks(cursor, 1);
      index += 1;
    }
    return options;
  }, [currentSprint]);
  const sprintLabel = useMemo(() => {
    if (!currentSprint) return 'Current sprint';
    return String((currentSprint as any).name || (currentSprint as any).title || (currentSprint as any).label || 'Current sprint');
  }, [currentSprint]);
  const activeSprintWeekKey = format(weekStart, 'yyyy-MM-dd');

  useEffect(() => {
    if (!sprintWeekOptions.length) return;
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const currentWeekKey = format(currentWeekStart, 'yyyy-MM-dd');
    const hasActiveWeek = sprintWeekOptions.some((option) => option.key === activeSprintWeekKey);
    if (hasActiveWeek) return;
    const currentSprintWeek = sprintWeekOptions.find((option) => option.key === currentWeekKey);
    setWeekStart((currentSprintWeek || sprintWeekOptions[0]).start);
  }, [activeSprintWeekKey, sprintWeekOptions]);

  return (
    <div className="p-3">
      <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
        <div>
          <h3 className="mb-1">7-Day Prioritisation</h3>
          <div className="text-muted small">Review story and task placement over the next 7 days and rebalance priority before execution.</div>
        </div>
        <Badge bg="info">
          {format(weekStart, 'dd MMM')} – {format(addDays(weekStart, 6), 'dd MMM yyyy')}
        </Badge>
      </div>

      <Card className="shadow-sm border-0 mb-3">
        <Card.Body className="py-2">
          <PlanActionBar />
        </Card.Body>
      </Card>

      {isPlanningPromptWeek && (
        <Alert variant="warning" className="py-2 d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div className="small">
            Review the week ahead now so Daily Plan starts with realistic loads and clear defer decisions.
          </div>
          <Button size="sm" variant="outline-dark" onClick={() => setWeekStart(startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }))}>
            Jump to next week
          </Button>
        </Alert>
      )}

      <Card className="shadow-sm border-0 mb-3">
        <Card.Body className="d-flex align-items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline-secondary" onClick={() => setWeekStart((prev) => startOfWeek(addDays(prev, -7), { weekStartsOn: 1 }))}>
            <ChevronLeft size={14} />
          </Button>
          <Form.Control
            type="date"
            value={format(weekStart, 'yyyy-MM-dd')}
            onChange={(e) => setWeekStart(startOfWeek(new Date(e.target.value), { weekStartsOn: 1 }))}
            style={{ maxWidth: 180 }}
          />
          <Button size="sm" variant="outline-secondary" onClick={() => setWeekStart((prev) => startOfWeek(addDays(prev, 7), { weekStartsOn: 1 }))}>
            <ChevronRight size={14} />
          </Button>
        </Card.Body>
      </Card>

      {sprintWeekOptions.length > 0 && (
        <Card className="shadow-sm border-0 mb-3">
          <Card.Body className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div>
              <div className="fw-semibold">{sprintLabel}</div>
              <div className="text-muted small">Jump between sprint weeks and review capacity week by week.</div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {sprintWeekOptions.map((option) => (
                <Button
                  key={option.key}
                  size="sm"
                  variant={option.key === activeSprintWeekKey ? 'primary' : 'outline-secondary'}
                  onClick={() => setWeekStart(option.start)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </Card.Body>
        </Card>
      )}

      <WeeklyPlannerSurface weekStart={weekStart} title="7-Day Prioritisation Matrix" />
    </div>
  );
};

export default WeeklyPlannerPage;

import React, { useMemo } from 'react';
import { Card, Button, Badge, ProgressBar, Spinner } from 'react-bootstrap';
import { Target, ArrowRight, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { FocusGoal, Goal } from '../types';
import { themeVars } from '../utils/themeVars';

interface FocusGoalsWidgetProps {
  focusGoals: FocusGoal[];
  goals: Goal[];
  loading?: boolean;
  onViewMore?: () => void;
  onManualRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
}

const FocusGoalsWidget: React.FC<FocusGoalsWidgetProps> = ({
  focusGoals,
  goals,
  loading = false,
  onViewMore,
  onManualRefresh,
  refreshing = false,
}) => {
  const navigate = useNavigate();

  // Filter active focus goals (isActive === true)
  const activeFocusGoals = useMemo(
    () => focusGoals.filter((fg) => fg.isActive === true),
    [focusGoals],
  );

  // Calculate progress for each active focus goal set
  const focusGoalProgress = useMemo(() => {
    return activeFocusGoals.map((fg) => {
      const linkedGoals = goals.filter((g) => fg.goalIds?.includes(g.id));
      const completedGoals = linkedGoals.filter((g) => g.status === 2).length;
      const totalGoals = linkedGoals.length;
      const progressPct = totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0;

      // Calculate days remaining
      const now = new Date();
      const endDate = fg.endDate instanceof Date ? fg.endDate : new Date((fg.endDate as any)?.toDate?.() || fg.endDate);
      const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return {
        id: fg.id,
        title: fg.title || `Focus ${fg.timeframe}`,
        goalIds: fg.goalIds,
        completedGoals,
        totalGoals,
        progressPct,
        daysRemaining: Math.max(0, daysRemaining),
        timeframe: fg.timeframe,
      };
    });
  }, [activeFocusGoals, goals]);

  const handleViewFocusGoals = () => {
    navigate('/focus-goals');
    onViewMore?.();
  };

  if (loading) {
    return (
      <Card style={{ borderRadius: 12, border: `1px solid ${themeVars.border}` }}>
        <Card.Body className="d-flex justify-content-center align-items-center">
          <Spinner animation="border" size="sm" className="me-2" />
          <span className="text-muted">Loading focus goals...</span>
        </Card.Body>
      </Card>
    );
  }

  // Empty state
  if (focusGoalProgress.length === 0) {
    return (
      <Card style={{ borderRadius: 12, border: `1px solid ${themeVars.border}` }}>
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div className="d-flex align-items-center gap-2">
              <Target size={20} className="text-muted" />
              <strong>Focus Goals</strong>
            </div>
            {onManualRefresh && (
              <Button size="sm" variant="outline-secondary" onClick={onManualRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            )}
          </div>
          <div className="text-muted small mb-3">
            No active focus goals. Create a focus goal set to prioritize and track specific goals over a timeframe.
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={handleViewFocusGoals}
            className="w-100"
          >
            <Zap size={14} className="me-1" />
            Create Focus Goals
          </Button>
        </Card.Body>
      </Card>
    );
  }

  // Active focus goals
  return (
    <Card style={{ borderRadius: 12, border: `1px solid ${themeVars.border}`, marginBottom: 16 }}>
      <Card.Body>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <div className="d-flex align-items-center gap-2">
            <Zap size={20} className="text-warning" />
            <strong>Active Focus Goals</strong>
            {focusGoalProgress.length > 0 && (
              <Badge bg="warning" text="dark" className="ms-2">
                {focusGoalProgress.length}
              </Badge>
            )}
          </div>
          {onManualRefresh && (
            <Button size="sm" variant="outline-secondary" onClick={onManualRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {focusGoalProgress.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 12,
                borderRadius: 8,
                background: themeVars.card as string,
                border: `1px solid ${themeVars.border}`,
              }}
            >
              <div className="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {item.completedGoals}/{item.totalGoals} goals completed
                    {item.daysRemaining > 0 && (
                      <>
                        {' '}
                        · <strong>{item.daysRemaining}d</strong> remaining
                      </>
                    )}
                  </div>
                </div>
                <Badge bg={item.progressPct >= 75 ? 'success' : item.progressPct >= 50 ? 'info' : 'secondary'}>
                  {item.progressPct}%
                </Badge>
              </div>

              <ProgressBar
                now={item.progressPct}
                variant={item.progressPct >= 75 ? 'success' : item.progressPct >= 50 ? 'info' : 'secondary'}
                style={{ height: 6 }}
              />
            </div>
          ))}
        </div>

        <Button
          size="sm"
          variant="outline-primary"
          onClick={handleViewFocusGoals}
          className="w-100 mt-3"
        >
          View Focus Goals
          <ArrowRight size={14} className="ms-1" />
        </Button>
      </Card.Body>
    </Card>
  );
};

export default FocusGoalsWidget;

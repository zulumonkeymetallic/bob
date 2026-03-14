import React, { useMemo } from 'react';
import { Card, Button, Form, Badge } from 'react-bootstrap';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Goal } from '../../types';
import DraggableGoalCard from './DraggableGoalCard';

interface GoalListPanelProps {
  goals: Goal[];
  travelGoals: Goal[];
  expanded: boolean;
  onToggleExpanded: (expanded: boolean) => void;
  showTravelGoalsOnly: boolean;
  onToggleTravelGoalsOnly: (only: boolean) => void;
  linkedEntriesByGoalId?: Record<string, number>;
}

const GoalListPanel: React.FC<GoalListPanelProps> = ({
  goals,
  travelGoals,
  expanded,
  onToggleExpanded,
  showTravelGoalsOnly,
  onToggleTravelGoalsOnly,
  linkedEntriesByGoalId = {},
}) => {
  const displayGoals = useMemo(() => {
    const toDisplay = showTravelGoalsOnly ? travelGoals : goals;
    return [...toDisplay].sort((a, b) => (b.orderIndex || 0) - (a.orderIndex || 0));
  }, [goals, travelGoals, showTravelGoalsOnly]);

  if (!expanded) {
    return (
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: '200px',
          width: '40px',
          height: '100px',
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '0 8px 8px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          zIndex: 100,
          boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
        }}
      >
        <Button
          size="sm"
          variant="outline-secondary"
          style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => onToggleExpanded(true)}
          title="Expand goal list"
        >
          <ChevronRight size={16} />
        </Button>
        <Badge bg="primary" style={{ fontSize: '10px' }}>
          {displayGoals.length}
        </Badge>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: '180px',
        width: '290px',
        maxHeight: '500px',
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '0 8px 8px 0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        boxShadow: '2px 0 8px rgba(0,0,0,0.1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f9fafb',
        }}
      >
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>
            Drag Goals to Map
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
            {displayGoals.length} goal{displayGoals.length !== 1 ? 's' : ''}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none' }}
          onClick={() => onToggleExpanded(false)}
          title="Collapse"
        >
          <ChevronDown size={16} />
        </Button>
      </div>

      {/* Filter Toggle */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <Form.Check
          type="checkbox"
          id="travel-goals-only"
          label="Travel goals only"
          checked={showTravelGoalsOnly}
          onChange={(e) => onToggleTravelGoalsOnly(e.target.checked)}
          style={{ fontSize: '12px', margin: 0 }}
        />
      </div>

      {/* Goal List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          minHeight: 0,
        }}
      >
        {displayGoals.length === 0 ? (
          <div style={{ padding: '12px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
            No goals to display
          </div>
        ) : (
          <div>
            {displayGoals.map((goal) => (
              <DraggableGoalCard
                key={goal.id}
                goal={goal}
                linkedEntriesCount={linkedEntriesByGoalId[goal.id] || 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Help */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #e5e7eb',
          background: '#f9fafb',
          fontSize: '11px',
          color: '#666',
          lineHeight: '1.4',
        }}
      >
        💡 Drag a goal card onto the map to create a travel entry
      </div>
    </div>
  );
};

export default GoalListPanel;

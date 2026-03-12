import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from 'react-bootstrap';
import { Goal } from '../../types';
import { GripVertical } from 'lucide-react';

interface DraggableGoalCardProps {
  goal: Goal;
  linkedEntriesCount?: number;
  theme?: any;
}

const DraggableGoalCard: React.FC<DraggableGoalCardProps> = ({
  goal,
  linkedEntriesCount = 0,
  theme,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `goal-${goal.id}`,
    data: { goalId: goal.id, goalTitle: goal.title },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    transition: isDragging ? 'none' : 'opacity 200ms ease-in-out',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="d-flex align-items-center gap-2 p-2 mb-1 bg-white rounded border"
      {...(isDragging ? { style: { ...style, background: '#f0fdf4', borderColor: '#86efac' } } : {})}
    >
      <button
        type="button"
        className="btn btn-sm p-0 text-muted"
        style={{ cursor: 'grab', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        {...listeners}
        {...attributes}
        aria-label="Drag to map"
        title="Drag goal onto map to create travel entry"
      >
        <GripVertical size={16} />
      </button>
      
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {goal.title}
        </div>
        {linkedEntriesCount > 0 && (
          <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
            {linkedEntriesCount} travel entr{linkedEntriesCount === 1 ? 'y' : 'ies'}
          </div>
        )}
      </div>

      {goal.theme !== undefined && (
        <Badge bg="light" text="dark" style={{ fontSize: '10px', marginLeft: 'auto', flexShrink: 0 }}>
          #{goal.theme}
        </Badge>
      )}
    </div>
  );
};

export default DraggableGoalCard;

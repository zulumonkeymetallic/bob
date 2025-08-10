import React from 'react';
import { Draggable } from 'react-beautiful-dnd';
import { Task } from '../types';

interface TaskCardProps {
  task: Task;
  index: number;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, index }) => {
  const colorMap: { [key: string]: string } = {
    growth: '#4A86E8',
    tribe: '#674EA7',
    wealth: '#93C47D',
    health: '#E06666',
    home: '#F6B26B',
  };

  const cardStyle = {
    backgroundColor: colorMap[task.goalArea?.toLowerCase() || ''] || 'white',
    color: task.goalArea ? '#000' : 'inherit',
  };

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          className="card mb-2"
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={{
            ...provided.draggableProps.style,
            ...cardStyle,
          }}
        >
          <div className="card-body">
            {task.title}
            {task.goalArea && <span className="badge ms-2">{task.goalArea}</span>}
          </div>
        </div>
      )}
    </Draggable>
  );
};

export default TaskCard;

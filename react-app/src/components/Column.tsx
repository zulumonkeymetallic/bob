import React from 'react';
import { Droppable } from 'react-beautiful-dnd';
import TaskCard from './TaskCard';
import { Task, Column as ColumnType } from '../types';

interface ColumnProps {
  column: ColumnType;
  tasks: Task[];
}

const Column: React.FC<ColumnProps> = ({ column, tasks }) => {
  return (
    <div className="col-md-4">
      <div className="card">
        <div className="card-header">
          <h3>{column.title}</h3>
        </div>
        <Droppable droppableId={column.id}>
          {(provided, snapshot) => (
            <div
              className="card-body"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {tasks.map((task, index) => (
                <TaskCard key={task.id} task={task} index={index} />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    </div>
  );
};

export default Column;

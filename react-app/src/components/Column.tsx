import React from 'react';
import { Droppable } from 'react-beautiful-dnd';
import StoryCard from './StoryCard';
import { rgbaCard } from '../utils/themeVars';
import { Column as ColumnType, Story } from '../types';

interface ColumnProps {
  column: ColumnType;
  stories: Story[];
}

const Column: React.FC<ColumnProps> = ({ column, stories }) => {
  return (
    <div className="col-md-4">
      <div className="card kanban-column glass-effect">
        <div className="card-header">
          <h4 className="column-title">{column.title}</h4>
        </div>
        <Droppable droppableId={column.id}>
          {(provided, snapshot) => (
            <div
              className="task-list"
              ref={provided.innerRef}
              style={{
                backgroundColor: snapshot.isDraggingOver ? rgbaCard(0.1) : 'transparent',
              }}
              {...provided.droppableProps}
            >
              {stories.map((story, index) => (
                <StoryCard key={story.id} story={story} index={index} />
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
export {};

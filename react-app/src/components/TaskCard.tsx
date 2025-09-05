import React from 'react';
import { Draggable } from 'react-beautiful-dnd';
import '../styles/TaskCard.css';
import { Task } from '../types';

interface TaskCardProps {
  task: Task;
  index: number;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, index, onEdit, onDelete }) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedTask, setEditedTask] = React.useState(task);

  const handleEdit = () => {
    setIsEditing(true);
    setEditedTask({ ...task });
  };

  const handleSave = () => {
    onEdit(editedTask);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedTask(task);
  };
  
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          className={`task-card glass-effect ${snapshot.isDragging ? 'is-dragging' : ''}`}
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          data-parent-theme={task.theme}
        >
          <div className="task-content">
            {isEditing ? (
              <div className="task-edit-form">
                <input
                  type="text"
                  value={editedTask.title}
                  onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                  className="task-edit-input"
                  placeholder="Task title"
                />
                <div className="task-edit-buttons">
                  <button onClick={handleSave} className="btn btn-sm btn-primary">Save</button>
                  <button onClick={handleCancel} className="btn btn-sm btn-secondary">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="task-header">
                  <div className="task-title">{task.title}</div>
                  <div className="task-actions">
                    <button onClick={handleEdit} className="btn btn-sm btn-link">
                      <i className="bi bi-pencil"></i>
                    </button>
                    <button onClick={() => onDelete(task.id)} className="btn btn-sm btn-link text-danger">
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
};

export default TaskCard;
export {};

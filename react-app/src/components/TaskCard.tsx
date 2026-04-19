import React, { useState } from 'react';
import { Draggable } from 'react-beautiful-dnd';
import '../styles/TaskCard.css';
import { Task } from '../types';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../firebase';
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Clock3 } from 'lucide-react';
import DeferItemModal from './DeferItemModal';

interface TaskCardProps {
  task: Task;
  index: number;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, index, onEdit, onDelete }) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedTask, setEditedTask] = React.useState(task);
  const [isConverting, setIsConverting] = React.useState(false);
  const [showDeferModal, setShowDeferModal] = useState(false);

  // Deferred state
  const deferredUntilRaw = (task as any).deferredUntil ?? null;
  const deferredUntilMs = typeof deferredUntilRaw === 'number'
    ? deferredUntilRaw
    : deferredUntilRaw?.toDate?.()?.getTime() ?? null;
  const isDeferred = typeof deferredUntilMs === 'number' && deferredUntilMs > Date.now();
  const deferredLabel = isDeferred
    ? `Deferred to ${new Date(deferredUntilMs!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : 'Defer intelligently';

  const applyPatch = async (patch: Record<string, any>) => {
    await updateDoc(doc(db, 'tasks', task.id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  };

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

  const handleConvertToStory = async () => {
    if (isConverting) return;
    setIsConverting(true);
    try {
      const suggestCallable = httpsCallable(functions, 'suggestTaskStoryConversions');
      const convertCallable = httpsCallable(functions, 'convertTasksToStories');

      const response: any = await suggestCallable({
        persona: task.persona || 'personal',
        taskIds: [task.id],
        limit: 1
      });
      const suggestions: any[] = Array.isArray(response?.data?.suggestions) ? response.data.suggestions : [];
      const suggestion = suggestions.find(item => item.taskId === task.id) || suggestions[0] || null;

      const storyTitle = (suggestion?.storyTitle || task.title || 'New Story').slice(0, 140);
      const storyDescription = (suggestion?.storyDescription || task.description || '').slice(0, 1200);
      const goalId = suggestion?.goalId || task.goalId || null;

      await convertCallable({
        conversions: [{
          taskId: task.id,
          storyTitle,
          storyDescription,
          goalId
        }]
      });

      console.log('🪄 TaskCard: Task converted to story', {
        taskId: task.id,
        storyTitle,
        goalId
      });
    } catch (error) {
      console.error('TaskCard convert failed:', error);
      window.alert('Could not convert this task to a story. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };
  
  return (
    <>
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
                      <button
                        onClick={handleConvertToStory}
                        className="btn btn-sm btn-link"
                        disabled={isConverting}
                        title={isConverting ? 'Converting…' : 'Convert to Story'}
                      >
                        <i className={`bi ${isConverting ? 'bi-hourglass-split' : 'bi-stars'}`}></i>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeferModal(true); }}
                        className="btn btn-sm btn-link p-0"
                        style={{ width: 24, height: 24, color: isDeferred ? '#b45309' : undefined }}
                        title={deferredLabel}
                      >
                        <Clock3 size={12} />
                      </button>
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
      {showDeferModal && (
        <DeferItemModal
          show={showDeferModal}
          onHide={() => setShowDeferModal(false)}
          itemType="task"
          itemId={task.id}
          itemTitle={task.title || ''}
          onApply={async ({ dateMs, rationale, source }) => {
            await applyPatch({
              deferredUntil: dateMs,
              deferredReason: rationale,
              deferredBy: source,
            });
            setShowDeferModal(false);
          }}
        />
      )}
    </>
  );
};

export default TaskCard;
export {};

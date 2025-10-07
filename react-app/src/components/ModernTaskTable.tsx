import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  Settings, 
  GripVertical, 
  Eye, 
  EyeOff,
  ChevronRight,
  ChevronDown,
  Wand2,
  Pencil,
  Trash2,
  Plus,
  Activity
} from 'lucide-react';
import { Task, Story, Goal, Sprint } from '../types';
import { Toast, ToastContainer } from 'react-bootstrap';
import { useSidebar } from '../contexts/SidebarContext';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { themeVars, rgbaCard } from '../utils/themeVars';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { deriveTaskSprint, effectiveSprintId, isDueDateWithinStorySprint, sprintNameForId } from '../utils/taskSprintHelpers';

interface TaskTableRow extends Task {
  storyTitle?: string;
  goalTitle?: string;
  sprintName?: string;
  sortOrder: number;
}

interface Column {
  key: string;
  label: string;
  width?: string;
  visible: boolean;
  editable: boolean;
  type: 'text' | 'select' | 'date' | 'number';
  options?: string[];
}

interface ModernTaskTableProps {
  tasks: Task[];
  stories: Story[];
  goals: Goal[];
  sprints: Sprint[];
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onTaskDelete: (taskId: string) => Promise<void>;
  onTaskPriorityChange: (taskId: string, newPriority: number) => Promise<void>;
  defaultColumns?: string[];
  compact?: boolean;
  onTaskCreate?: (newTask: Partial<Task>) => Promise<void>;
}

const defaultColumns: Column[] = [
  { 
    key: 'ref', 
    label: 'Ref', 
    width: '10%', 
    visible: true, 
    editable: false, 
    type: 'text' 
  },
  { 
    key: 'title', 
    label: 'Title', 
    width: '20%', 
    visible: true, 
    editable: true, 
    type: 'text' 
  },
  { 
    key: 'description', 
    label: 'Description', 
    width: '30%', 
    visible: true, 
    editable: true, 
    type: 'text' 
  },
  { 
    key: 'status', 
    label: 'Status', 
    width: '12%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: ['todo', 'planned', 'in-progress', 'blocked', 'done']
  },
  { 
    key: 'priority', 
    label: 'Priority', 
    width: '10%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: ['low', 'med', 'high']
  },
  { 
    key: 'effort', 
    label: 'Effort', 
    width: '8%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: ['S', 'M', 'L']
  },
  { 
    key: 'dueDate', 
    label: 'Due Date', 
    width: '15%', 
    visible: true, 
    editable: true, 
    type: 'date' 
  },
  { 
    key: 'theme', 
    label: 'Theme', 
    width: '12%', 
    visible: true, 
    editable: false, 
    type: 'select',
    options: ['Health', 'Growth', 'Wealth', 'Tribe', 'Home']
  },
  { 
    key: 'source', 
    label: 'Source', 
    width: '10%', 
    visible: true, 
    editable: false, 
    type: 'text'
  },
  { 
    key: 'syncState', 
    label: 'State', 
    width: '10%', 
    visible: true, 
    editable: false, 
    type: 'text'
  },
  { 
    key: 'storyTitle', 
    label: 'Story', 
    width: '15%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: []
  },
  { 
    key: 'sprintName', 
    label: 'Sprint', 
    width: '15%', 
    visible: true, 
    editable: false, 
    type: 'text'
  },
];

const roundHours = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

interface SortableRowProps {
  task: TaskTableRow;
  columns: Column[];
  index: number;
  stories: Story[];
  sprints: Sprint[];
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onTaskDelete: (taskId: string) => Promise<void>;
  onEditRequest: (task: TaskTableRow) => void;
  onSprintAssign: (taskId: string, sprintId: string | null) => Promise<void>;
  onConvertToStory: (task: TaskTableRow) => Promise<void>;
  convertLoadingId: string | null;
}

const SortableRow: React.FC<SortableRowProps> = ({ 
  task, 
  columns, 
  index, 
  stories,
  sprints,
  onTaskUpdate, 
  onTaskDelete, 
  onEditRequest,
  onSprintAssign,
  onConvertToStory,
  convertLoadingId,
}) => {
  const { showSidebar } = useSidebar();
  const { trackCRUD, trackFieldChange } = useActivityTracking();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isConverting = convertLoadingId === task.id;

  const handleCellEdit = (key: string, value: string) => {
    setEditingCell(key);
    setEditValue(value || '');
  };

  const handleCellSave = async (key: string) => {
    try {
      const oldValue = (task as any)[key]; // Store the original value
      
      // Only proceed if the value actually changed
      if (oldValue !== editValue) {
        let updates: Partial<Task>;
        
        // Special handling for story selection
        if (key === 'storyTitle') {
          // Find the story by title and update storyId instead
          const selectedStory = stories.find(story => story.title === editValue);
          if (selectedStory) {
            updates = { storyId: selectedStory.id };
            
            // Track the field change with story title for display
            trackFieldChange(
              task.id,
              'task',
              'story',
              task.storyTitle || 'No story',
              editValue,
              task.ref
            );
            
            console.log(`🎯 Task story changed: from "${task.storyTitle || 'No story'}" to "${editValue}" (ID: ${selectedStory.id}) for task ${task.id}`);
          } else {
            // Clear story assignment
            updates = { storyId: '' };
            
            trackFieldChange(
              task.id,
              'task',
              'story',
              task.storyTitle || 'No story',
              'No story',
              task.ref
            );
            
            console.log(`🎯 Task story cleared for task ${task.id}`);
          }
        } else if (key === 'dueDate') {
          const normalizedValue = editValue ? new Date(editValue).getTime() : null;
          updates = { dueDate: normalizedValue ?? null };
        } else {
          // Regular field update
          updates = { [key]: editValue };
          
          // Track the field change for activity stream
          trackFieldChange(
            task.id,
            'task',
            key,
            oldValue,
            editValue,
            task.ref
          );
          
          console.log(`🎯 Task field changed: ${key} from "${oldValue}" to "${editValue}" for task ${task.id}`);
        }
        
        await onTaskUpdate(task.id, updates);
      }
      
      setEditingCell(null);
    } catch (error) {
      console.error('Error saving task field:', error);
      setEditingCell(null);
    }
  };

  const handleSprintChange = async (value: string) => {
    try {
      const newSprintId = value === 'none' ? null : (value || null);
      await onSprintAssign(task.id, newSprintId);
    } catch (error) {
      console.error('Error assigning sprint:', error);
    }
  };

  const formatValue = (key: string, value: any): string => {
    if (key === 'dueDate') {
      if (typeof value === 'number') {
        const date = new Date(value);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
      }
      if (typeof value === 'string') {
        return value;
      }
      return '';
    }
    if (key === 'theme' && typeof value === 'number') {
      const theme = GLOBAL_THEMES.find(t => t.id === value);
      return theme ? theme.name : '';
    }
    return value || '';
  };

  const getThemeColor = (themeId: number): string => {
    const theme = GLOBAL_THEMES.find(t => t.id === themeId);
    return theme ? theme.color : (themeVars.muted as string);
  };

  const renderCell = (column: Column) => {
    const value = task[column.key as keyof TaskTableRow];
    const isEditing = editingCell === column.key;

    if (isEditing && column.editable) {
      if (column.type === 'select' && column.options) {
        return (
          <td key={column.key} style={{ width: column.width }}>
            <div className="relative">
              <select
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => handleCellSave(column.key)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `1px solid ${themeVars.brand}`,
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: themeVars.panel,
                  color: themeVars.text,
                  outline: 'none',
                  boxShadow: `0 0 0 2px ${rgbaCard(0.2)}`,
                }}
                autoFocus
              >
                {column.options.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </td>
        );
      }

      return (
        <td key={column.key} style={{ width: column.width }}>
          <div className="relative">
            <input
              type={column.type === 'date' ? 'date' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleCellSave(column.key)}
              onKeyPress={(e) => e.key === 'Enter' && handleCellSave(column.key)}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid ${themeVars.brand}`,
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: themeVars.panel,
                color: themeVars.text,
                outline: 'none',
                boxShadow: `0 0 0 2px ${rgbaCard(0.2)}`,
              }}
              autoFocus
            />
          </div>
        </td>
      );
    }

    return (
      <td 
        key={column.key} 
        style={{ 
          width: column.width,
          padding: '12px 8px',
          borderRight: `1px solid ${themeVars.border}`,
          cursor: column.editable ? 'pointer' : 'default',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = themeVars.card as string;
          }
        }}
        onMouseLeave={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
        onClick={() => column.editable && handleCellEdit(column.key, formatValue(column.key, value))}
      >
        <div style={{
          minHeight: '20px',
          fontSize: '14px',
          color: column.key === 'ref' ? (themeVars.brand as string) : (themeVars.text as string),
          fontWeight: column.key === 'ref' ? '600' : 'normal',
          fontFamily: column.key === 'ref' ? 'monospace' : 'inherit',
          wordBreak: 'break-word',
          whiteSpace: 'normal',
          lineHeight: '1.4',
        }}>
          {column.key === 'theme' && value ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '500',
                backgroundColor: getThemeColor(value as number),
                color: 'var(--on-accent)',
              }}
            >
              {formatValue(column.key, value)}
            </span>
          ) : (
            formatValue(column.key, value)
          )}
        </div>
      </td>
    );
  };

  return (
    <tr
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: backgrounds.surface,
        borderBottom: `1px solid ${themeVars.border}`,
        transition: 'background-color 0.15s ease',
      }}
      {...attributes}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = themeVars.card as string;
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = backgrounds.surface;
        }
      }}
    >
      <td style={{
        padding: '12px 8px',
        textAlign: 'center',
        borderRight: `1px solid ${themeVars.border}`,
        width: '48px',
      }}>
        <button
          {...listeners}
          style={{
            color: themeVars.muted as string,
            padding: '4px',
            borderRadius: '4px',
            border: 'none',
            background: 'none',
            cursor: 'grab',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = themeVars.text as string;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = themeVars.muted as string;
          }}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>
      </td>
      {columns.filter(col => col.visible).map(renderCell)}
      <td style={{
        padding: '12px 8px',
        textAlign: 'center',
        width: '96px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={task.sprintId || ''}
            onChange={(e) => handleSprintChange(e.target.value)}
            style={{
              minWidth: '110px',
              padding: '4px 6px',
              borderRadius: 4,
              border: `1px solid ${themeVars.border}`,
              backgroundColor: themeVars.panel as string,
              color: themeVars.text as string,
              fontSize: '12px'
            }}
            title="Assign sprint"
          >
            <option value="">Sprint…</option>
            <option value="none">No Sprint</option>
            {sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
            ))}
          </select>
          {/* Activity stream */}
          <button
            onClick={() => {
              console.log('🧭 ModernTaskTable: Activity button clicked', { taskId: task.id });
              showSidebar(task, 'task');
            }}
            style={{ color: themeVars.muted as string, padding: 4, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}
            title="Activity stream"
          >
            <Activity size={16} />
          </button>
          {/* AI action */}
          <button
            onClick={() => onConvertToStory(task)}
            disabled={isConverting}
            style={{ 
              color: isConverting ? themeVars.muted as string : themeVars.brand as string,
              padding: 4,
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              cursor: isConverting ? 'wait' : 'pointer'
            }}
            title={isConverting ? 'Converting…' : 'Convert to Story'}
          >
            <Wand2 size={16} style={{ opacity: isConverting ? 0.5 : 1 }} />
          </button>
          {/* Edit action opens modal */}
          <button
            onClick={() => onEditRequest(task)}
            style={{ color: themeVars.brand as string, padding: 4, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}
            title="Edit task"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => {
              console.log('🗑️ ModernTaskTable: DELETE button clicked', {
                action: 'delete_button_clicked',
                taskId: task.id,
                taskTitle: task.title,
                taskStatus: task.status,
                confirmationRequired: true,
                timestamp: new Date().toISOString()
              });
              onTaskDelete(task.id);
            }}
            style={{ color: 'var(--red)', padding: 4, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer' }}
            title="Delete task"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
};

const ModernTaskTable: React.FC<ModernTaskTableProps> = ({
  tasks,
  stories,
  goals,
  sprints,
  onTaskUpdate,
  onTaskDelete,
  onTaskPriorityChange,
  onTaskCreate,
  defaultColumns: defaultColumnKeys,
  compact = false,
}) => {
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  
  // Initialize columns based on defaultColumns prop or use all columns
  const initializeColumns = () => {
    if (defaultColumnKeys && defaultColumnKeys.length > 0) {
      return defaultColumns.map(col => ({
        ...col,
        visible: defaultColumnKeys.includes(col.key),
        width: compact ? undefined : col.width // Remove fixed widths in compact mode
      }));
    }
    return defaultColumns;
  };
  
  const [columns, setColumns] = useState<Column[]>(initializeColumns());
  const [showConfig, setShowConfig] = useState(false);
  const [configExpanded, setConfigExpanded] = useState({
    columns: true,
    filters: false,
    display: false,
  });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskTableRow | null>(null);
  const [editForm, setEditForm] = useState<Partial<TaskTableRow>>({});
  const [storySearch, setStorySearch] = useState('');
  const [sprintFilter, setSprintFilter] = useState<string>('all');
  const [convertLoadingId, setConvertLoadingId] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ show: boolean; message: string; variant: 'danger' | 'info' | 'success' }>({ show: false, message: '', variant: 'danger' });

  const showToast = (message: string, variant: 'danger' | 'info' | 'success' = 'danger') => {
    setToastState({ show: true, message, variant });
  };

  const closeToast = () => setToastState(prev => ({ ...prev, show: false }));

  // Update story column options when stories change
  useEffect(() => {
    setColumns(prev => 
      prev.map(col => 
        col.key === 'storyTitle' 
          ? { ...col, options: stories.map(story => story.title) }
          : col
      )
    );
  }, [stories]);

  const handleValidatedUpdate = async (taskId: string, updates: Partial<Task>) => {
    const existingTask = tasks.find(t => t.id === taskId);
    if (!existingTask) return;

    try {
      const derivation = deriveTaskSprint({
        task: existingTask,
        updates,
        stories,
        sprints,
      });

      if (!isDueDateWithinStorySprint(derivation.dueDateMs, derivation.story, sprints)) {
        showToast('Task due date must stay within the linked story sprint window.');
        return;
      }

      const payload: Partial<Task> = { ...updates };

      if ('dueDate' in updates) {
        payload.dueDate = derivation.dueDateMs ?? null;
      }

      if (payload.estimatedHours !== undefined) {
        const hours = Number(payload.estimatedHours);
        if (!Number.isNaN(hours)) {
          payload.estimatedHours = roundHours(hours);
          payload.estimateMin = Math.max(5, Math.round(payload.estimatedHours * 60));
        } else {
          delete payload.estimatedHours;
        }
      } else if (payload.estimateMin !== undefined) {
        const minutes = Number(payload.estimateMin);
        if (!Number.isNaN(minutes)) {
          payload.estimatedHours = roundHours(minutes / 60);
        }
      }

      if (derivation.story?.sprintId) {
        payload.sprintId = derivation.story.sprintId;
      } else if ('sprintId' in payload || derivation.sprintId !== existingTask.sprintId) {
        payload.sprintId = derivation.sprintId ?? null;
      }

      if (payload.sprintId === existingTask.sprintId || (payload.sprintId == null && !existingTask.sprintId)) {
        delete payload.sprintId;
      }

      await onTaskUpdate(taskId, payload);
    } catch (error: any) {
      console.error('ModernTaskTable: failed to update task', { taskId, updates, error });
      showToast('Unable to update task. Please try again.');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const filteredTasks = tasks.filter((task) => {
    const derivedSprintId = effectiveSprintId(task, stories, sprints);
    if (sprintFilter === 'none') return !derivedSprintId;
    if (sprintFilter !== 'all') return derivedSprintId === sprintFilter;
    return true;
  });

  // Convert tasks to table rows with sort order and story titles
  const tableRows: TaskTableRow[] = filteredTasks.map((task, index) => {
    const story = stories.find(s => s.id === task.storyId);
    const derivedSprintId = effectiveSprintId(task, stories, sprints);
    return {
      ...task,
      sprintId: derivedSprintId ?? null,
      sprintName: sprintNameForId(sprints, derivedSprintId),
      sortOrder: index,
      storyTitle: story?.title || '',
    };
  });

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    console.log('🔄 ModernTaskTable: Drag operation initiated', {
      action: 'drag_start',
      activeId: active.id,
      overId: over?.id,
      timestamp: new Date().toISOString()
    });

    if (over && active.id !== over.id) {
      const oldIndex = tableRows.findIndex(item => item.id === active.id);
      const newIndex = tableRows.findIndex(item => item.id === over.id);
      
      console.log('🎯 ModernTaskTable: Task reorder operation', {
        action: 'task_reorder',
        taskId: active.id,
        oldPosition: oldIndex + 1,
        newPosition: newIndex + 1,
        oldIndex,
        newIndex,
        totalTasks: tableRows.length,
        timestamp: new Date().toISOString()
      });

      try {
        // Update priority based on new position (1-indexed)
        await onTaskPriorityChange(active.id as string, newIndex + 1);
        
        console.log('✅ ModernTaskTable: Task reorder successful', {
          action: 'task_reorder_success',
          taskId: active.id,
          newPriority: newIndex + 1,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ ModernTaskTable: Task reorder failed', {
          action: 'task_reorder_error',
          taskId: active.id,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      console.log('↩️ ModernTaskTable: Drag cancelled - no position change', {
        action: 'drag_cancelled',
        activeId: active.id,
        overId: over?.id,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleSprintAssign = async (taskId: string, newSprintId: string | null) => {
    await handleValidatedUpdate(taskId, { sprintId: newSprintId });
  };

  const handleConvertToStory = async (task: TaskTableRow) => {
    if (!task) return;
    setConvertLoadingId(task.id);
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

      console.log('🪄 ModernTaskTable: Task converted to story', {
        taskId: task.id,
        storyTitle,
        goalId
      });
    } catch (error) {
      console.error('Error converting task to story:', error);
    } finally {
      setConvertLoadingId(null);
    }
  };

  const toggleColumn = (key: string) => {
    setColumns(prev => 
      prev.map(col => 
        col.key === key ? { ...col, visible: !col.visible } : col
      )
    );
  };

  const visibleColumnsCount = columns.filter(col => col.visible).length;

  return (
    <>
    <div style={{ 
      position: 'relative', 
      backgroundColor: themeVars.panel as string, 
      borderRadius: '8px', 
      border: `1px solid ${themeVars.border}`,
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      overflow: 'hidden' 
    }}>
      {/* Header with controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        borderBottom: `1px solid ${themeVars.border}`,
        backgroundColor: themeVars.card as string,
      }}>
        <div>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: themeVars.text as string, 
            margin: 0, 
            marginBottom: '4px' 
          }}>
            Tasks
          </h3>
          <p style={{ 
            fontSize: '14px', 
            color: themeVars.muted as string, 
            margin: 0 
          }}>
            {filteredTasks.length} of {tasks.length} tasks • {visibleColumnsCount} columns visible
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '12px', color: themeVars.muted as string, display: 'flex', alignItems: 'center', gap: '6px' }}>
              Sprint
              <select
                value={sprintFilter}
                onChange={(e) => setSprintFilter(e.target.value)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: `1px solid ${themeVars.border}`,
                  backgroundColor: themeVars.panel as string,
                  color: themeVars.text as string,
                  fontSize: '12px'
                }}
              >
                <option value="all">All</option>
                <option value="none">No Sprint</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <button
          onClick={() => setShowConfig(!showConfig)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            transition: 'all 0.15s ease',
            cursor: 'pointer',
            border: showConfig ? `1px solid ${themeVars.brand}` : `1px solid ${themeVars.border}`,
            backgroundColor: showConfig ? rgbaCard(0.2) : (themeVars.panel as string),
            color: themeVars.text as string,
          }}
          onMouseEnter={(e) => {
            if (!showConfig) {
              e.currentTarget.style.backgroundColor = themeVars.card as string;
            }
          }}
          onMouseLeave={(e) => {
            if (!showConfig) {
              e.currentTarget.style.backgroundColor = themeVars.panel as string;
            }
          }}
        >
          <Settings size={16} />
          {showConfig ? 'Hide Configuration' : 'Configure Table'}
        </button>
      </div>

      <div style={{ display: 'flex' }}>
        {/* Main Table */}
        <div style={{
          flex: 1,
          overflowX: 'auto',
          transition: 'margin-right 0.3s ease',
          marginRight: showConfig ? '320px' : '0',
        }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <table style={{ 
              width: '100%',
              borderCollapse: 'collapse',
            }}>
              <thead style={{ 
                backgroundColor: themeVars.card as string, 
                borderBottom: `1px solid ${themeVars.border}` 
              }}>
                <tr>
                  <th style={{
                    padding: '12px 8px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: themeVars.muted as string,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderRight: `1px solid ${themeVars.border}`,
                    width: '48px',
                  }}>
                    Order
                  </th>
                  {columns.filter(col => col.visible).map(column => (
                    <th 
                      key={column.key} 
                      style={{
                        padding: '12px 8px',
                        textAlign: 'left',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: themeVars.muted as string,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderRight: `1px solid ${themeVars.border}`,
                        width: column.width,
                      }}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th style={{
                    padding: '12px 8px',
                    textAlign: 'center',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: themeVars.muted as string,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    width: '96px',
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                <SortableContext 
                  items={tableRows.map(row => row.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {tableRows.map((task, index) => (
                    <SortableRow
                      key={task.id}
                      task={task}
                      columns={columns}
                      index={index}
                      stories={stories}
                      sprints={sprints}
                      onTaskUpdate={handleValidatedUpdate}
                      onTaskDelete={onTaskDelete}
                      onEditRequest={(t) => {
                        setEditingTask(t);
                        setEditForm({ ...t });
                        setStorySearch(t.storyTitle || '');
                        setShowEditModal(true);
                      }}
                      onSprintAssign={handleSprintAssign}
                      onConvertToStory={handleConvertToStory}
                      convertLoadingId={convertLoadingId}
                    />
                  ))}
                </SortableContext>
              </tbody>
            </table>
          </DndContext>
        </div>

        {/* Optional: Add Task button */}
        {onTaskCreate && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
            <button
              onClick={() => {
                setEditingTask(null);
                setEditForm({ title: '', description: '', priority: 2, status: 'planned' as any });
                setStorySearch('');
                setShowEditModal(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                border: `2px dashed ${themeVars.brand}`,
                background: 'transparent',
                color: themeVars.brand as string,
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(0,0,0,0.03)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }}
              title="Add Task"
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
              Add Task
            </button>
          </div>
        )}

        {/* Configuration Panel */}
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: '320px',
          backgroundColor: themeVars.panel as string,
          borderLeft: `1px solid ${themeVars.border}`,
          transition: 'transform 0.3s ease',
          boxShadow: '-4px 0 16px 0 rgba(0, 0, 0, 0.1)',
          transform: showConfig ? 'translateX(0)' : 'translateX(100%)',
        }}>
          <div style={{ 
            padding: '16px', 
            height: '100%', 
            overflowY: 'auto' 
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Column Configuration */}
              <div>
                <button
                  onClick={() => setConfigExpanded(prev => ({ ...prev, columns: !prev.columns }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '8px',
                    textAlign: 'left',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: themeVars.text as string,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = themeVars.card as string;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span>Column Visibility</span>
                  {configExpanded.columns ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                
                {configExpanded.columns && (
                  <div style={{ 
                    marginTop: '12px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '8px' 
                  }}>
                    {columns.map(column => (
                      <div key={column.key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px',
                        borderRadius: '4px',
                        transition: 'background-color 0.15s ease',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = themeVars.card as string;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                      onClick={() => toggleColumn(column.key)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '4px',
                            border: '2px solid',
                            borderColor: column.visible ? (themeVars.brand as string) : (themeVars.border as string),
                            backgroundColor: column.visible ? (themeVars.brand as string) : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease',
                          }}>
                            {column.visible && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
                                <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span style={{ fontSize: '14px', color: themeVars.text as string }}>{column.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {column.visible ? (
                            <Eye size={14} style={{ color: themeVars.muted as string }} />
                          ) : (
                            <EyeOff size={14} style={{ color: themeVars.muted as string }} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Table Settings */}
              <div>
                <button
                  onClick={() => setConfigExpanded(prev => ({ ...prev, display: !prev.display }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '8px',
                    textAlign: 'left',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: themeVars.text as string,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = themeVars.card as string;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span>Display Options</span>
                  {configExpanded.display ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                
                {configExpanded.display && (
                  <div style={{ 
                    marginTop: '12px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '12px' 
                  }}>
                    <div style={{
                      padding: '12px',
                      backgroundColor: themeVars.card as string,
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: themeVars.text as string, 
                        margin: '0 0 8px 0' 
                      }}>
                        Text Wrapping
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: themeVars.muted as string, 
                        margin: '0 0 8px 0',
                        lineHeight: '1.4',
                      }}>
                        Table cells automatically wrap text for better readability with proper line height and spacing
                      </p>
                      <div style={{ 
                        width: '100%', 
                        height: '8px', 
                        backgroundColor: rgbaCard(0.15), 
                        borderRadius: '4px' 
                      }}>
                        <div style={{ 
                          height: '8px', 
                          backgroundColor: 'var(--green)', 
                          borderRadius: '4px',
                          width: '100%',
                        }}></div>
                      </div>
                    </div>
                    
                    <div style={{
                      padding: '12px',
                      backgroundColor: themeVars.card as string,
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: themeVars.text as string, 
                        margin: '0 0 8px 0' 
                      }}>
                        Inline Editing
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: themeVars.muted as string, 
                        margin: 0,
                        lineHeight: '1.4',
                      }}>
                        Click any editable cell to modify values directly in the table with modern form controls
                      </p>
                    </div>

                    <div style={{
                      padding: '12px',
                      backgroundColor: themeVars.card as string,
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: themeVars.text as string, 
                        margin: '0 0 8px 0' 
                      }}>
                        Modern Actions
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: themeVars.muted as string, 
                        margin: 0,
                        lineHeight: '1.4',
                      }}>
                        Text-based action buttons (Edit/Delete) follow design system guidelines with proper hover states
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Edit/Create Modal (lightweight) */}
    {showEditModal && (
      <div className="modal d-block" tabIndex={-1} role="dialog" style={{ background: 'rgba(0,0,0,0.35)' }}>
        <div className="modal-dialog modal-lg" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{editingTask ? 'Edit Task' : 'Add Task'}</h5>
              <button type="button" className="btn-close" onClick={() => setShowEditModal(false)} />
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label">Title</label>
                <input className="form-control" value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
              </div>
              <div className="mb-3">
                <label className="form-label">Description</label>
                <textarea className="form-control" rows={3} value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label">Link to Story</label>
                  <input className="form-control" placeholder="Type to search..." value={storySearch} onChange={(e) => setStorySearch(e.target.value)} />
                  <div className="list-group" style={{ maxHeight: 180, overflow: 'auto' }}>
                    {stories.filter(s => s.title?.toLowerCase().includes((storySearch||'').toLowerCase())).slice(0, 10).map(s => (
                      <button key={s.id} type="button" className="list-group-item list-group-item-action"
                        onClick={() => {
                          setEditForm({ ...editForm, storyId: s.id, storyTitle: s.title, priority: (editingTask ? editingTask.priority : (editForm.priority as any)) || (s as any).priority || 2 });
                          setStorySearch(s.title || '');
                        }}
                      >{s.title}</button>
                    ))}
                  </div>
                </div>
                <div className="col-md-3 mb-3">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={String(editForm.priority ?? '2')} onChange={(e) => setEditForm({ ...editForm, priority: parseInt(e.target.value) as any })}>
                    <option value="1">High</option>
                    <option value="2">Medium</option>
                    <option value="3">Low</option>
                  </select>
                </div>
                <div className="col-md-3 mb-3">
                  <label className="form-label">Due Date</label>
                  <input type="date" className="form-control" value={editForm.dueDate ? new Date(editForm.dueDate as any).toISOString().slice(0,10) : ''} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={async () => {
                if (!editForm.title) return;
                if (editingTask) {
                  await handleValidatedUpdate(editingTask.id, {
                    title: editForm.title,
                    description: editForm.description,
                    priority: editForm.priority as any,
                    dueDate: editForm.dueDate as any,
                    storyId: (editForm as any).storyId
                  });
                } else if (onTaskCreate) {
                  await onTaskCreate({
                    title: editForm.title,
                    description: editForm.description,
                    priority: editForm.priority as any,
                    dueDate: editForm.dueDate as any,
                    storyId: (editForm as any).storyId
                  });
                }
                setShowEditModal(false);
              }}>Save</button>
            </div>
          </div>
        </div>
      </div>
    )}
    <ToastContainer position="bottom-end" className="p-3">
      <Toast bg={toastState.variant} onClose={closeToast} show={toastState.show} delay={4000} autohide>
        <Toast.Body className={toastState.variant === 'info' ? '' : 'text-white'}>{toastState.message}</Toast.Body>
      </Toast>
    </ToastContainer>
    </>
  );
};

export default ModernTaskTable;

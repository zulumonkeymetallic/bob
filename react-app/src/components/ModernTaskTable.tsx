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
import TagInput from './common/TagInput';
import { formatTaskTagLabel } from '../utils/tagDisplay';
import { useSidebar } from '../contexts/SidebarContext';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { themeVars, rgbaCard } from '../utils/themeVars';
import { taskStatusText } from '../utils/storyCardFormatting';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../firebase';
import { deriveTaskSprint, effectiveSprintId, findSprintForDate, isDueDateWithinStorySprint, sprintNameForId } from '../utils/taskSprintHelpers';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { usePersona } from '../contexts/PersonaContext';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { normalizeTaskTags } from '../utils/taskTagging';
import { parsePointsValue } from '../utils/points';
import EditTaskModal from './EditTaskModal';
import EditStoryModal from './EditStoryModal';
import { MISSING_INFO_CELL_BG, MISSING_INFO_CELL_BG_HOVER, hasLinkedId, isBlankText, isMissingPoints } from '../utils/dataQuality';

interface TaskTableRow extends Task {
  storyTitle?: string;
  linkedGoal?: string;
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

const TASK_TYPE_OPTIONS = ['task', 'read', 'watch', 'chore', 'routine', 'habit'] as const;
const RECURRING_TASK_TYPES = new Set(['chore', 'routine', 'habit']);

function normalizeTaskType(value: any): string {
  const raw = String(value || 'task').toLowerCase();
  return raw === 'habitual' ? 'habit' : raw;
}

function formatTaskTypeLabel(value: any): string {
  const normalized = normalizeTaskType(value);
  switch (normalized) {
    case 'read':
      return 'Read';
    case 'watch':
      return 'Watch';
    case 'chore':
      return 'Chore';
    case 'routine':
      return 'Routine';
    case 'habit':
      return 'Habit';
    case 'task':
      return 'Task';
    default:
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Task';
  }
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
    visible: false,
    editable: true,
    type: 'text'
  },
  {
    key: 'url',
    label: 'URL',
    width: '20%',
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
    // values are numeric-as-string for editing; labels are rendered via taskStatusText
    // Standardize to Backlog/To Do (0), In Progress (1), Done (2)
    options: ['0', '1', '2']
  },
  {
    key: 'type',
    label: 'Type',
    width: '10%',
    visible: true,
    editable: true,
    type: 'select',
    options: [...TASK_TYPE_OPTIONS]
  },
  {
    key: 'priority',
    label: 'Priority',
    width: '10%',
    visible: true,
    editable: true,
    type: 'select',
    options: ['4', '1', '2', '3', '5']
  },
  {
    key: 'effort',
    label: 'Effort',
    width: '8%',
    visible: false,
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
    key: 'createdAt',
    label: 'Created',
    width: '16%',
    visible: false,
    editable: false,
    type: 'text'
  },
  {
    key: 'points',
    label: 'Points',
    width: '8%',
    visible: true,
    editable: true,
    type: 'number'
  },
  {
    key: 'aiCriticalityScore',
    label: 'AI Score',
    width: '10%',
    visible: false,
    editable: false,
    type: 'number'
  },
  {
    key: 'aiCriticalityReason',
    label: 'AI Reason',
    width: '25%',
    visible: false,
    editable: false,
    type: 'text'
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
    key: 'storyTitle',
    label: 'Story',
    width: '15%',
    visible: true,
    editable: true,
    type: 'select',
    options: []
  },
  {
    key: 'linkedGoal',
    label: 'Linked Goal',
    width: '15%',
    visible: true,
    editable: false,
    type: 'text'
  },
  {
    key: 'sprintName',
    label: 'Sprint',
    width: '15%',
    visible: true,
    editable: false,
    type: 'text'
  },
  {
    key: 'repeatFrequency',
    label: 'Frequency',
    width: '12%',
    visible: false,
    editable: true,
    type: 'select',
    options: ['daily', 'weekly', 'monthly', 'yearly']
  },
  {
    key: 'repeatInterval',
    label: 'Interval',
    width: '8%',
    visible: false,
    editable: true,
    type: 'number'
  },
  {
    key: 'daysOfWeek',
    label: 'Days of Week',
    width: '15%',
    visible: false,
    editable: true,
    type: 'text'
  },
];

const roundHours = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

const formatExternalUrlLabel = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}`.slice(0, 64);
  } catch {
    return raw.slice(0, 64);
  }
};

const timestampToMillis = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any)?.toDate === 'function') {
    const date = (value as any).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  }
  if (typeof (value as any)?.seconds === 'number') {
    const nanos = typeof (value as any)?.nanoseconds === 'number' ? (value as any).nanoseconds : 0;
    return ((value as any).seconds * 1000) + Math.round(nanos / 1e6);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const formatTimestampCell = (value: unknown): string => {
  const millis = timestampToMillis(value);
  if (millis == null) return '';
  return new Date(millis).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const taskHasStoryLink = (task: Partial<Task>, stories: Story[]): boolean => {
  const storyId = String((task as any).storyId || '').trim();
  return hasLinkedId(storyId) && stories.some((story) => story.id === storyId);
};

const resolveTaskGoalId = (task: Partial<Task>, stories: Story[]): string => {
  const storyId = String((task as any).storyId || '').trim();
  const storyGoalId = storyId ? String((stories.find((story) => story.id === storyId) as any)?.goalId || '').trim() : '';
  const directGoalId = String((task as any).goalId || '').trim();
  return storyGoalId || directGoalId;
};

const taskHasGoalLink = (task: Partial<Task>, stories: Story[], goals: Goal[]): boolean => {
  const goalId = resolveTaskGoalId(task, stories);
  return hasLinkedId(goalId) && goals.some((goal) => goal.id === goalId);
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
  onStoryEditRequest: (story: Story | null) => void;
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
  onStoryEditRequest,
  onSprintAssign,
  onConvertToStory,
  convertLoadingId,
}) => {
  const { showSidebar } = useSidebar();
  const { trackCRUD, trackFieldChange, addNote } = useActivityTracking();
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

  const handleCellSave = async (key: string, sourceValue?: string) => {
    try {
      const oldValue = (task as any)[key];
      const valueToSave = sourceValue ?? editValue;
      let updates: Partial<Task> | null = null;
      let oldComparable = oldValue == null ? '' : String(oldValue);
      let newComparable = valueToSave == null ? '' : String(valueToSave);

      // Special handling for story selection
      if (key === 'storyTitle') {
        const selectedStory = stories.find(story => story.title === valueToSave);
        const previousStoryId = String((task as any).storyId || '');
        const nextStoryId = selectedStory ? selectedStory.id : '';
        oldComparable = previousStoryId;
        newComparable = nextStoryId;

        if (selectedStory) {
          updates = { storyId: selectedStory.id };

          trackFieldChange(
            task.id,
            'task',
            'story',
            task.storyTitle || 'No story',
            valueToSave,
            task.ref
          );

          console.log(`🎯 Task story changed: from "${task.storyTitle || 'No story'}" to "${valueToSave}" (ID: ${selectedStory.id}) for task ${task.id}`);
        } else {
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
        const dueDateMs = valueToSave ? new Date(valueToSave).getTime() : null;
        const normalizedValue = Number.isFinite(dueDateMs as number) ? dueDateMs : null;
        oldComparable = oldValue == null ? '' : String(oldValue);
        newComparable = normalizedValue == null ? '' : String(normalizedValue);
        updates = { dueDate: normalizedValue ?? null };
      } else if (key === 'status') {
        const next = Number(valueToSave);
        const canonical = Number.isFinite(next)
          ? (next >= 3 ? 3 : next >= 2 ? 2 : next <= 0 ? 0 : 1)
          : valueToSave;
        oldComparable = oldValue == null ? '' : String(oldValue);
        newComparable = canonical == null ? '' : String(canonical);
        updates = { status: canonical } as any;
        trackFieldChange(task.id, 'task', 'status', oldValue, canonical, task.ref);
      } else if (key === 'priority') {
        const next = Number(valueToSave);
        const canonical = Number.isFinite(next) ? (next as any) : (valueToSave as any);
        oldComparable = oldValue == null ? '' : String(oldValue);
        newComparable = canonical == null ? '' : String(canonical);
        updates = { priority: canonical } as any;
      } else if (key === 'points') {
        const fallbackPoints = parsePointsValue((task as any).points) ?? 1;
        const parsedPoints = parsePointsValue(valueToSave);
        const normalizedPoints = parsedPoints == null ? fallbackPoints : parsedPoints;
        const previousPoints = parsePointsValue(oldValue) ?? fallbackPoints;
        oldComparable = String(previousPoints);
        newComparable = String(normalizedPoints);
        updates = { points: normalizedPoints } as any;
      } else if (key === 'repeatFrequency') {
        updates = { repeatFrequency: valueToSave || null } as any;
      } else if (key === 'repeatInterval') {
        const n = parseInt(valueToSave, 10);
        updates = { repeatInterval: Number.isFinite(n) ? Math.max(1, n) : 1 } as any;
      } else if (key === 'daysOfWeek') {
        const days = valueToSave.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
        updates = { daysOfWeek: days } as any;
      } else {
        updates = { [key]: valueToSave };
        oldComparable = oldValue == null ? '' : String(oldValue);
        newComparable = valueToSave == null ? '' : String(valueToSave);

        trackFieldChange(
          task.id,
          'task',
          key,
          oldValue,
          valueToSave,
          task.ref
        );

        console.log(`🎯 Task field changed: ${key} from "${oldValue}" to "${valueToSave}" for task ${task.id}`);
      }

      if (updates && oldComparable !== newComparable) {
        console.log(`💾 Persisting task update: ${key} = ${newComparable} (was: ${oldComparable})`);
        await onTaskUpdate(task.id, updates);
      } else {
        console.log(`🔄 No change detected for ${key}: ${oldComparable} === ${newComparable}`);
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
    if (key === 'createdAt' || key === 'updatedAt') {
      return formatTimestampCell(value);
    }
    if (key === 'status') {
      return taskStatusText(value);
    }
    if (key === 'points') {
      const pts = parsePointsValue(value);
      return pts != null ? String(pts) : '';
    }
    if (key === 'aiCriticalityScore' && typeof value === 'number') {
      return String(Math.round(value));
    }
    if (key === 'aiCriticalityReason') {
      return String(value || '');
    }
    if (key === 'type') {
      return formatTaskTypeLabel(value);
    }
    if (key === 'url') {
      return formatExternalUrlLabel(value);
    }
    if (key === 'theme' && typeof value === 'number') {
      const theme = GLOBAL_THEMES.find(t => t.id === value);
      return theme ? theme.name : '';
    }
    if (key === 'linkedGoal') {
      return String(value || 'Unlinked goal');
    }
    if (key === 'daysOfWeek') {
      if (Array.isArray(value)) return value.join(', ');
      return String(value || '');
    }
    if (key === 'repeatFrequency') {
      const s = String(value || '');
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    }
    if (key === 'repeatInterval') {
      return value != null ? String(value) : '';
    }
    return value || '';
  };

  const getThemeColor = (themeId: number): string => {
    const theme = GLOBAL_THEMES.find(t => t.id === themeId);
    return theme ? theme.color : (themeVars.muted as string);
  };

  const renderCell = (column: Column) => {
    const value = task[column.key as keyof TaskTableRow];
    const formattedValue = formatValue(column.key, value);
    const isEditing = editingCell === column.key;
    const missingStory = !taskHasStoryLink(task, stories);
    const missingGoal = !String(task.linkedGoal || '').trim();
    const missingPoints = isMissingPoints((task as any).points);
    const missingDescription = isBlankText((task as any).description);
    const isMissingDataCell =
      (column.key === 'storyTitle' && missingStory)
      || (column.key === 'linkedGoal' && missingGoal)
      || (column.key === 'points' && missingPoints)
      || (column.key === 'description' && missingDescription);
    const cellBaseBackground = isMissingDataCell ? MISSING_INFO_CELL_BG : 'transparent';
    const editValueForColumn = (() => {
      if (column.key === 'url') {
        return String(value || '');
      }
      if (column.key === 'dueDate') {
        return formatValue(column.key, value);
      }
      if (column.key === 'status') {
        const next = Number(value);
        if (Number.isFinite(next)) {
          return String(next >= 2 ? 2 : next <= 0 ? 0 : 1);
        }
        const statusLabel = String(value || '').toLowerCase();
        if (['blocked', 'paused', 'on-hold', 'onhold', 'stalled', 'waiting'].includes(statusLabel)) return '3';
        if (['done', 'complete', 'completed', 'closed', 'finished'].includes(statusLabel)) return '2';
        if (['in-progress', 'in progress', 'active', 'doing'].includes(statusLabel)) return '1';
        return '0';
      }
      if (column.key === 'type') {
        return normalizeTaskType(value || 'task');
      }
      if (column.key === 'priority' || column.key === 'points' || column.key === 'repeatInterval') {
        return value == null ? '' : String(value);
      }
      if (column.key === 'daysOfWeek') {
        if (Array.isArray(value)) return value.join(',');
        return String(value || '');
      }
      if (column.type === 'select') {
        return value == null ? '' : String(value);
      }
      return formattedValue;
    })();

    if (isEditing && column.editable) {
      if (column.type === 'select') {
        return (
          <td key={column.key} style={{ width: column.width }}>
            <div className="relative">
              <select
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={(e) => handleCellSave(column.key, e.currentTarget.value)}
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
                {column.key === 'status' ? (
                  <>
                    <option value={'0'}>To Do</option>
                    <option value={'1'}>In Progress</option>
                    <option value={'2'}>Done</option>
                    <option value={'3'}>Blocked</option>
                  </>
                ) : column.key === 'priority' ? (
                  <>
                    <option value={'1'}>P1 - High</option>
                    <option value={'2'}>P2 - Med-High</option>
                    <option value={'3'}>P3 - Medium</option>
                    <option value={'4'}>P4 - Low-Med</option>
                    <option value={'5'}>P5 - Low</option>
                  </>
                ) : (
                  (column.options || []).map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))
                )}
              </select>
            </div>
          </td >
        );
      }

      return (
        <td key={column.key} style={{ width: column.width }}>
          <div className="relative">
            <input
              type={column.type === 'date' ? 'date' : (column.type === 'number' ? 'number' : 'text')}
              step={column.key === 'points' ? 'any' : undefined}
              inputMode={column.key === 'points' ? 'decimal' : undefined}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={(e) => handleCellSave(column.key, e.currentTarget.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCellSave(column.key, (e.currentTarget as HTMLInputElement).value)}
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
          backgroundColor: cellBaseBackground,
        }}
        onMouseEnter={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = isMissingDataCell ? MISSING_INFO_CELL_BG_HOVER : (themeVars.card as string);
          }
        }}
        onMouseLeave={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = cellBaseBackground;
          }
        }}
        onClick={() => column.editable && handleCellEdit(column.key, editValueForColumn)}
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
          ) : column.key === 'storyTitle' ? (
            (() => {
              const linkedStory = stories.find((story) => story.id === task.storyId || story.title === formattedValue);
              const display = formattedValue || 'Unlinked story';
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStoryEditRequest(linkedStory || null);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: themeVars.brand as string,
                    textDecoration: 'underline',
                    cursor: linkedStory ? 'pointer' : 'default',
                  }}
                >
                  {display}
                </button>
              );
            })()
          ) : column.key === 'url' && value ? (
            <a
              href={String(value)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={String(value)}
            >
              {formatExternalUrlLabel(value)}
            </a>
          ) : (
            formattedValue
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
  const { currentPersona } = usePersona();
  const { themes: globalThemes } = useGlobalThemes();

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
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'sortOrder',
    direction: 'asc'
  });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskTableRow | null>(null);
  const [showStoryEditModal, setShowStoryEditModal] = useState(false);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [editForm, setEditForm] = useState<Partial<TaskTableRow>>({});
  const [storySearch, setStorySearch] = useState('');
  const [goalSearch, setGoalSearch] = useState('');
  const [sprintFilter, setSprintFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dataQualityFilter, setDataQualityFilter] = useState<string>('all');
  const [convertLoadingId, setConvertLoadingId] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ show: boolean; message: string; variant: 'danger' | 'info' | 'success' }>({ show: false, message: '', variant: 'danger' });

  const showToast = (message: string, variant: 'danger' | 'info' | 'success' = 'danger') => {
    setToastState({ show: true, message, variant });
  };

  const closeToast = () => setToastState(prev => ({ ...prev, show: false }));

  const handleStoryEditRequest = (story: Story | null) => {
    if (!story) return;
    setEditingStory(story);
    setShowStoryEditModal(true);
  };

  // Activity stream helpers
  const { addNote, trackFieldChange } = useActivityTracking();

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

      // Allow due date edits even if story sprint isn't defined - only warn if conflict exists
      if ('dueDate' in updates && derivation.story?.sprintId && !isDueDateWithinStorySprint(derivation.dueDateMs, derivation.story, sprints)) {
        console.warn(`⚠️ Due date ${new Date(derivation.dueDateMs || 0).toISOString().split('T')[0]} falls outside linked story sprint - auto-aligning to matching sprint`);
      }

      const payload: Partial<Task> = { ...updates };
      const existingOwnerUid = (existingTask as any)?.ownerUid;
      const existingPersona = ((existingTask as any)?.persona || currentPersona || 'personal') as any;

      if (existingOwnerUid) {
        (payload as any).ownerUid = existingOwnerUid;
      }
      if (!(payload as any).persona && existingPersona) {
        (payload as any).persona = existingPersona;
      }
      (payload as any).serverUpdatedAt = Date.now();

      if ('dueDate' in updates) {
        payload.dueDate = derivation.dueDateMs ?? null;
        payload.dueDateLocked = true;
        (payload as any).dueDateReason = 'user';
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
      } else if ('dueDate' in updates) {
        const matched = findSprintForDate(sprints, derivation.dueDateMs ?? null);
        payload.sprintId = matched?.id ?? null;
      } else if ('sprintId' in payload || derivation.sprintId !== existingTask.sprintId) {
        payload.sprintId = derivation.sprintId ?? null;
      }

      if (payload.sprintId === existingTask.sprintId || (payload.sprintId == null && !existingTask.sprintId)) {
        delete payload.sprintId;
      }

      const nextStoryId = ('storyId' in updates) ? (updates.storyId as any) : existingTask.storyId;
      const nextStory = nextStoryId ? stories.find((s) => s.id === nextStoryId) : null;
      const goalIdFromUpdates = ('goalId' in updates) ? (updates.goalId as any) : existingTask.goalId;
      const resolvedGoalId = nextStory?.goalId || goalIdFromUpdates || null;
      if ('storyId' in updates) {
        payload.goalId = nextStory?.goalId || null;
      }

      const shouldNormalizeTags = (
        'type' in updates
        || 'persona' in updates
        || 'sprintId' in updates
        || 'storyId' in updates
        || 'goalId' in updates
        || 'tags' in updates
      );

      if (shouldNormalizeTags) {
        const sprintIdForTag = payload.sprintId ?? derivation.sprintId ?? existingTask.sprintId ?? null;
        const sprintForTag = sprintIdForTag ? sprints.find((s) => s.id === sprintIdForTag) : null;
        const goalForTag = resolvedGoalId ? goals.find((g) => g.id === resolvedGoalId) : null;
        const themeValue = (goalForTag as any)?.theme
          ?? (nextStory as any)?.theme
          ?? (existingTask as any)?.theme
          ?? (existingTask as any)?.themeId
          ?? (existingTask as any)?.theme_id
          ?? null;
        const normalizedTags = normalizeTaskTags({
          tags: Array.isArray(updates.tags) ? updates.tags : (existingTask.tags || []),
          type: (updates.type as any) ?? existingTask.type,
          persona: (updates.persona as any) ?? (existingTask as any).persona ?? currentPersona ?? 'personal',
          sprint: sprintForTag || null,
          themeValue,
          goalRef: (goalForTag as any)?.ref || null,
          storyRef: (nextStory as any)?.ref || null,
          themes: globalThemes,
        });
        payload.tags = normalizedTags as any;
      }

      await onTaskUpdate(taskId, payload);

      // Activity stream annotation when due date causes sprint alignment
      const alignedSprintId = (payload as any).sprintId ?? derivation.sprintId ?? null;
      if ('dueDate' in updates && (alignedSprintId ?? null) !== (existingTask.sprintId ?? null)) {
        const sprintName = sprintNameForId(sprints, alignedSprintId ?? null);
        const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0, 10) : 'unknown';
        try {
          await addNote(taskId, 'task', `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.`, (existingTask as any).ref);
          await trackFieldChange(taskId, 'task', 'sprintId', String(existingTask.sprintId || ''), String(alignedSprintId || ''), (existingTask as any).ref);
        } catch { }
      }
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

  const editType = normalizeTaskType((editForm as any)?.type || 'task');
  const isRecurringEditType = RECURRING_TASK_TYPES.has(editType);
  const selectedStoryId = (editForm as any)?.storyId || null;
  const selectedStory = selectedStoryId ? stories.find((s) => s.id === selectedStoryId) : null;
  const selectedGoalId = (selectedStory as any)?.goalId || (editForm as any)?.goalId || '';
  const selectedGoal = selectedGoalId ? goals.find((g) => g.id === selectedGoalId) : null;
  const resolveStoryCreateSelection = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setEditForm((prev) => ({ ...prev, storyId: '', storyTitle: '' }));
      setStorySearch('');
      return;
    }
    const match = stories.find((s) => s.title === trimmed || s.id === trimmed);
    if (!match) {
      setEditForm((prev) => ({ ...prev, storyId: '', storyTitle: '' }));
      return;
    }
    const linkedGoalId = (match as any).goalId || '';
    const linkedGoal = linkedGoalId ? goals.find((g) => g.id === linkedGoalId) : null;
    setEditForm((prev) => ({
      ...prev,
      storyId: match.id,
      storyTitle: match.title,
      goalId: linkedGoalId || prev.goalId || '',
      priority: (prev.priority as any) || (match as any).priority || 2,
    }));
    setStorySearch(match.title || '');
    if (linkedGoal) setGoalSearch(linkedGoal.title || '');
  };
  const resolveGoalCreateSelection = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setEditForm((prev) => ({ ...prev, goalId: '' }));
      setGoalSearch('');
      return;
    }
    const match = goals.find((g) => g.title === trimmed || g.id === trimmed);
    if (!match) {
      setEditForm((prev) => ({ ...prev, goalId: '' }));
      return;
    }
    setEditForm((prev) => ({ ...prev, goalId: match.id }));
    setGoalSearch(match.title || '');
  };

  const filteredTasks = tasks.filter((task) => {
    const derivedSprintId = effectiveSprintId(task, stories, sprints);
    const normalizedType = normalizeTaskType((task as any)?.type || (task as any)?.task_type || 'task');
    if (sprintFilter === 'none' && derivedSprintId) return false;
    if (sprintFilter !== 'all' && sprintFilter !== 'none' && derivedSprintId !== sprintFilter) return false;
    if (typeFilter !== 'all' && normalizedType !== typeFilter) return false;
    if (dataQualityFilter !== 'all') {
      const missingStory = !taskHasStoryLink(task, stories);
      const missingGoal = !taskHasGoalLink(task, stories, goals);
      const missingPoints = isMissingPoints((task as any).points);
      const missingDescription = isBlankText((task as any).description);
      const missingAny = missingStory || missingGoal || missingPoints || missingDescription;
      if (dataQualityFilter === 'missing_any' && !missingAny) return false;
      if (dataQualityFilter === 'missing_link' && !(missingStory || missingGoal)) return false;
      if (dataQualityFilter === 'missing_points' && !missingPoints) return false;
      if (dataQualityFilter === 'missing_description' && !missingDescription) return false;
    }
    return true;
  });

  // Convert tasks to table rows with sort order and story titles
  const tableRows: TaskTableRow[] = filteredTasks.map((task, index) => {
    const story = stories.find(s => s.id === task.storyId);
    const resolvedGoalId = (story as any)?.goalId || String((task as any)?.goalId || '').trim();
    const goal = resolvedGoalId ? goals.find((g) => g.id === resolvedGoalId) : undefined;
    const derivedSprintId = effectiveSprintId(task, stories, sprints);
    return {
      ...task,
      sprintId: derivedSprintId ?? null,
      sprintName: sprintNameForId(sprints, derivedSprintId),
      sortOrder: index,
      storyTitle: story?.title || '',
      linkedGoal: goal?.title || '',
    };
  });

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const renderHeaderLabel = (column: Column) => {
    const isActive = sortConfig.key === column.key;
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {column.label}
        <span style={{ fontSize: '10px' }}>
          {isActive ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '⇅'}
        </span>
      </span>
    );
  };

  const sortedRows = React.useMemo(() => {
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    const list = [...tableRows];
    list.sort((a, b) => {
      const valA = (a as any)[sortConfig.key];
      const valB = (b as any)[sortConfig.key];
      if (sortConfig.key === 'createdAt' || sortConfig.key === 'updatedAt') {
        const timeA = timestampToMillis(valA);
        const timeB = timestampToMillis(valB);
        if (timeA != null && timeB != null) {
          if (timeA === timeB) return 0;
          return timeA > timeB ? dir : -dir;
        }
      }
      const numA = typeof valA === 'number' ? valA : (valA ? Number(valA) : null);
      const numB = typeof valB === 'number' ? valB : (valB ? Number(valB) : null);
      if (numA !== null && numB !== null && !Number.isNaN(numA) && !Number.isNaN(numB)) {
        if (numA === numB) return 0;
        return numA > numB ? dir : -dir;
      }
      const aStr = (valA ?? '').toString().toLowerCase();
      const bStr = (valB ?? '').toString().toLowerCase();
      if (aStr === bStr) return 0;
      return aStr > bStr ? dir : -dir;
    });
    return list;
  }, [sortConfig, tableRows]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    console.log('🔄 ModernTaskTable: Drag operation initiated', {
      action: 'drag_start',
      activeId: active.id,
      overId: over?.id,
      timestamp: new Date().toISOString()
    });

    if (over && active.id !== over.id) {
      const oldIndex = sortedRows.findIndex(item => item.id === active.id);
      const newIndex = sortedRows.findIndex(item => item.id === over.id);

      console.log('🎯 ModernTaskTable: Task reorder operation', {
        action: 'task_reorder',
        taskId: active.id,
        oldPosition: oldIndex + 1,
        newPosition: newIndex + 1,
        oldIndex,
        newIndex,
        totalTasks: sortedRows.length,
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
    // When assigning a sprint, align due date to sprint start and cascade to parent story
    const sprint = newSprintId ? sprints.find(s => s.id === newSprintId) : null;
    const dueDate = sprint ? sprint.startDate : null;

    const updates: Partial<Task> = { sprintId: newSprintId, dueDate };
    await handleValidatedUpdate(taskId, updates);

    // Cascade sprint to parent story if present
    const task = tasks.find(t => t.id === taskId);
    const parentStoryId = (task as any)?.storyId;
    if (parentStoryId && newSprintId) {
      try {
        await updateDoc(doc(db, 'stories', parentStoryId as string), {
          sprintId: newSprintId,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Failed to cascade sprint to story', parentStoryId, e);
      }
    }
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
        boxShadow: '0 1px 3px 0 var(--glass-shadow-color)',
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
              <label style={{ fontSize: '12px', color: themeVars.muted as string, display: 'flex', alignItems: 'center', gap: '6px' }}>
                Type
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: `1px solid ${themeVars.border}`,
                    backgroundColor: themeVars.panel as string,
                    color: themeVars.text as string,
                    fontSize: '12px'
                  }}
                >
                  <option value="all">All Types</option>
                  <option value="task">Task</option>
                  <option value="read">Read</option>
                  <option value="watch">Watch</option>
                  <option value="chore">Chore</option>
                  <option value="habit">Habit</option>
                  <option value="routine">Routine</option>
                </select>
              </label>
              <label style={{ fontSize: '12px', color: themeVars.muted as string, display: 'flex', alignItems: 'center', gap: '6px' }}>
                Data Quality
                <select
                  value={dataQualityFilter}
                  onChange={(e) => setDataQualityFilter(e.target.value)}
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
                  <option value="missing_any">Missing Any</option>
                  <option value="missing_link">Missing Link</option>
                  <option value="missing_points">Missing Points</option>
                  <option value="missing_description">Missing Description</option>
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
            overflowY: 'auto',
            maxHeight: '70vh',
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
                  borderBottom: `1px solid ${themeVars.border}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 5
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
                          cursor: 'pointer',
                          userSelect: 'none'
                        }}
                        onClick={() => handleSort(column.key)}
                      >
                        {renderHeaderLabel(column)}
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
                    items={sortedRows.map(row => row.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sortedRows.map((task, index) => (
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
                          setShowEditModal(true);
                        }}
                        onStoryEditRequest={handleStoryEditRequest}
                        onSprintAssign={handleSprintAssign}
                        onConvertToStory={handleConvertToStory}
                        convertLoadingId={convertLoadingId}
                      />
                    ))}
                  </SortableContext>
                  {onTaskCreate && (
                    <tr>
                      <td
                        colSpan={columns.filter(col => col.visible).length + 2}
                        style={{
                          padding: '12px',
                          textAlign: 'center',
                          borderTop: `1px dashed ${themeVars.border}`,
                          backgroundColor: themeVars.card as string
                        }}
                      >
                        <button
                          onClick={() => {
                            setEditingTask(null);
                            setEditForm({
                              title: '',
                              description: '',
                              url: '',
                              priority: 2,
                              status: 0 as any,
                              tags: [],
                              type: 'task',
                              goalId: '',
                              repeatFrequency: null,
                              repeatInterval: 1,
                              daysOfWeek: [],
                            });
                            setStorySearch('');
                            setGoalSearch('');
                            setShowEditModal(true);
                          }}
                          style={{
                            color: themeVars.brand as string,
                            backgroundColor: 'transparent',
                            border: `1px dashed ${themeVars.brand}`,
                            borderRadius: '8px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = rgbaCard(0.12);
                            e.currentTarget.style.borderColor = themeVars.brand as string;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.borderColor = themeVars.brand as string;
                          }}
                          title="Add Task"
                        >
                          + Add Task
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DndContext>
          </div>

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
            boxShadow: '-4px 0 16px 0 var(--glass-shadow-color)',
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
                                  <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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

      {/* Edit Task Modal (consistent with sidebar) */}
      <EditTaskModal
        show={showEditModal && !!editingTask}
        task={editingTask as Task | null}
        onHide={() => { setShowEditModal(false); setEditingTask(null); }}
      />
      <EditStoryModal
        show={showStoryEditModal && !!editingStory}
        story={editingStory}
        goals={goals}
        onHide={() => {
          setShowStoryEditModal(false);
          setEditingStory(null);
        }}
      />

      {/* Create Task Modal (lightweight, only used for inline add) */}
      {showEditModal && !editingTask && (
        <div className="modal d-block" tabIndex={-1} role="dialog" style={{ background: 'var(--bs-backdrop-bg)' }}>
          <div className="modal-dialog modal-lg" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add Task</h5>
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
                <div className="mb-3">
                  <label className="form-label">Source URL</label>
                  <input className="form-control" type="url" value={(editForm as any).url || ''} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} placeholder="https://..." />
                </div>
                <div className="mb-3">
                  <label className="form-label">Tags</label>
                  <TagInput
                    value={editForm.tags || []}
                    onChange={(tags) => setEditForm({ ...editForm, tags })}
                    placeholder="Add tags..."
                    formatTag={(tag) => formatTaskTagLabel(tag, goals, sprints)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Task type</label>
                  <select
                    className="form-select"
                    value={editType}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value as any })}
                  >
                    <option value="task">Task</option>
                    <option value="read">Read</option>
                    <option value="watch">Watch</option>
                    <option value="chore">Chore</option>
                    <option value="routine">Routine</option>
                    <option value="habit">Habit</option>
                  </select>
                </div>
                {isRecurringEditType && (
                  <div className="mb-3">
                    <div className="row">
                      <div className="col-md-4 mb-2">
                        <label className="form-label">Frequency</label>
                        <select
                          className="form-select"
                          value={(editForm as any).repeatFrequency || ''}
                          onChange={(e) => setEditForm({ ...editForm, repeatFrequency: e.target.value as any })}
                        >
                          <option value="">None</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>
                      <div className="col-md-4 mb-2">
                        <label className="form-label">Interval</label>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          className="form-control"
                          value={(editForm as any).repeatInterval ?? ''}
                          onChange={(e) => setEditForm({
                            ...editForm,
                            repeatInterval: (e.target.value === '' ? '' : e.target.value) as any,
                          } as any)}
                        />
                      </div>
                    </div>
                    {(editForm as any).repeatFrequency === 'weekly' && (
                      <div className="mt-2">
                        <label className="form-label">Days of week</label>
                        <div className="d-flex flex-wrap gap-3">
                          {[
                            { label: 'Mon', value: 'mon' },
                            { label: 'Tue', value: 'tue' },
                            { label: 'Wed', value: 'wed' },
                            { label: 'Thu', value: 'thu' },
                            { label: 'Fri', value: 'fri' },
                            { label: 'Sat', value: 'sat' },
                            { label: 'Sun', value: 'sun' },
                          ].map((day) => {
                            const days = Array.isArray((editForm as any).daysOfWeek) ? (editForm as any).daysOfWeek : [];
                            const checked = days.includes(day.value);
                            return (
                              <label key={day.value} className="form-check form-check-inline">
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={checked}
                                  onChange={() => {
                                    const next = checked
                                      ? days.filter((d: string) => d !== day.value)
                                      : [...days, day.value];
                                    setEditForm({ ...editForm, daysOfWeek: next });
                                  }}
                                />
                                <span className="form-check-label">{day.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Link to Story</label>
                    <input
                      className="form-control"
                      list="modern-task-create-story-options"
                      placeholder="Search story by title..."
                      value={storySearch}
                      onChange={(e) => setStorySearch(e.target.value)}
                      onBlur={(e) => resolveStoryCreateSelection(e.target.value)}
                    />
                    <datalist id="modern-task-create-story-options">
                      {stories.map((s) => (
                        <option key={s.id} value={s.title || ''} />
                      ))}
                    </datalist>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">Link to Goal</label>
                    <input
                      className="form-control"
                      list="modern-task-create-goal-options"
                      placeholder="Search goal by title..."
                      value={selectedStoryId ? (selectedGoal?.title || '') : goalSearch}
                      onChange={(e) => setGoalSearch(e.target.value)}
                      onBlur={(e) => resolveGoalCreateSelection(e.target.value)}
                      disabled={!!selectedStoryId}
                    />
                    <datalist id="modern-task-create-goal-options">
                      {goals.map((goal) => (
                        <option key={goal.id} value={goal.title || ''} />
                      ))}
                    </datalist>
                    {selectedStoryId && selectedGoal && (
                      <div className="form-text">Goal derived from linked story.</div>
                    )}
                  </div>
                  <div className="col-md-3 mb-3">
                    <label className="form-label">Priority</label>
                    <select className="form-select" value={String(editForm.priority ?? '2')} onChange={(e) => setEditForm({ ...editForm, priority: parseInt(e.target.value) as any })}>
                      <option value="1">P1 - High</option>
                      <option value="2">P2 - Med-High</option>
                      <option value="3">P3 - Medium</option>
                      <option value="4">P4 - Low-Med</option>
                      <option value="5">P5 - Low</option>
                    </select>
                  </div>
                  <div className="col-md-3 mb-3">
                    <label className="form-label">Due Date</label>
                    <input type="date" className="form-control" value={editForm.dueDate ? new Date(editForm.dueDate as any).toISOString().slice(0, 10) : ''} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={async () => {
                  if (!editForm.title) return;
                  const isRecurring = RECURRING_TASK_TYPES.has(editType);
                  const normalizedFrequency = isRecurring ? ((editForm as any).repeatFrequency || null) : null;
                  const normalizedInterval = isRecurring ? Math.max(1, Number((editForm as any).repeatInterval || 1)) : null;
                  const normalizedDays = isRecurring && (editForm as any).repeatFrequency === 'weekly'
                    ? (Array.isArray((editForm as any).daysOfWeek) ? (editForm as any).daysOfWeek : [])
                    : [];
                  const linkedStoryId = (editForm as any).storyId || (editingTask as any)?.storyId || null;
                  const linkedStory = linkedStoryId ? stories.find((s) => s.id === linkedStoryId) : null;
                  const linkedGoalId = linkedStory?.goalId || (editForm as any)?.goalId || (editingTask as any)?.goalId || null;
                  const linkedGoal = linkedGoalId ? goals.find((g) => g.id === linkedGoalId) : null;
                  const sprintIdValue = (editForm as any).sprintId
                    || (editingTask as any)?.sprintId
                    || (linkedStory as any)?.sprintId
                    || null;
                  const sprintForTag = sprintIdValue ? sprints.find((s) => s.id === sprintIdValue) : null;
                  const themeValue = (linkedGoal as any)?.theme
                    ?? (linkedStory as any)?.theme
                    ?? (editingTask as any)?.theme
                    ?? (editingTask as any)?.themeId
                    ?? (editingTask as any)?.theme_id
                    ?? null;
                  const personaValue = (editForm as any).persona
                    || (editingTask as any)?.persona
                    || currentPersona
                    || 'personal';
                  const normalizedTags = normalizeTaskTags({
                    tags: (editForm as any).tags || [],
                    type: editType,
                    persona: personaValue,
                    sprint: sprintForTag || null,
                    themeValue,
                    goalRef: (linkedGoal as any)?.ref || null,
                    storyRef: (linkedStory as any)?.ref || null,
                    themes: globalThemes,
                  });
                    if (editingTask) {
                      await handleValidatedUpdate(editingTask.id, {
                        title: editForm.title,
                        description: editForm.description,
                        url: (editForm as any).url,
                        priority: editForm.priority as any,
                        dueDate: editForm.dueDate as any,
                        storyId: (editForm as any).storyId,
                        goalId: linkedGoalId as any,
                        type: editType,
                        tags: normalizedTags as any,
                        repeatFrequency: normalizedFrequency as any,
                        repeatInterval: normalizedInterval as any,
                        daysOfWeek: normalizedDays as any,
                    });
                    } else if (onTaskCreate) {
                      await onTaskCreate({
                        title: editForm.title,
                        description: editForm.description,
                        url: (editForm as any).url,
                        priority: editForm.priority as any,
                        dueDate: editForm.dueDate as any,
                        storyId: (editForm as any).storyId,
                        goalId: linkedGoalId as any,
                        type: editType,
                        tags: normalizedTags as any,
                        repeatFrequency: normalizedFrequency as any,
                        repeatInterval: normalizedInterval as any,
                        daysOfWeek: normalizedDays as any,
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
          <Toast.Body style={{ color: toastState.variant === 'info' ? themeVars.text : themeVars.onAccent }}>
            {toastState.message}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </>
  );
};

export default ModernTaskTable;

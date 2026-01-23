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
import { useActivityTracking } from '../hooks/useActivityTracking';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import { 
  Settings, 
  GripVertical, 
  Eye, 
  EyeOff,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { Activity, Pencil, Trash2, Wand2, ExternalLink } from 'lucide-react';
import { Story, Goal, Sprint, Task } from '../types';
import StoryTasksPanel from './StoryTasksPanel';
import ModernTaskTable from './ModernTaskTable';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
import { useSidebar } from '../contexts/SidebarContext';
import { useNavigate } from 'react-router-dom';
import { useSprint } from '../contexts/SprintContext';
import { themeVars, rgbaCard } from '../utils/themeVars';
import { storyStatusText } from '../utils/storyCardFormatting';

interface StoryTableRow extends Story {
  goalTitle?: string;
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

interface ModernStoriesTableProps {
  stories: Story[];
  goals: Goal[];
  onStoryUpdate: (storyId: string, updates: Partial<Story>) => Promise<void>;
  onStoryDelete: (storyId: string) => Promise<void>;
  onStoryPriorityChange: (storyId: string, newPriority: number) => Promise<void>;
  onStoryAdd: (storyData: Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>) => Promise<void>;
  onStorySelect?: (story: Story) => void; // New prop for story selection
  onEditStory?: (story: Story) => void; // New prop for story editing
  highlightStoryId?: string;
  goalId?: string; // Made optional for full stories table
  enableInlineTasks?: boolean; // Only show green caret + inline tasks when true
  onStoryReorder?: (activeId: string, overId: string) => Promise<void>;
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
    label: 'Story Title', 
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
    key: 'goalTitle', 
    label: 'Goal', 
    width: '15%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: [] // Will be populated dynamically with goal titles
  },
  { 
    key: 'status', 
    label: 'Status', 
    width: '10%', 
    visible: true, 
    editable: true, 
    type: 'select',
    // Canonical story statuses only
    options: ['Backlog', 'In Progress', 'Done']
  },
  { 
    key: 'priority', 
    label: 'Priority', 
    width: '8%', 
    visible: false, 
    editable: true, 
    type: 'select',
    options: ['low', 'medium', 'high', 'critical']
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
    key: 'effort', 
    label: 'Effort', 
    width: '8%', 
    visible: false, 
    editable: true, 
    type: 'select',
    options: ['XS', 'S', 'M', 'L', 'XL']
  },
  { 
    key: 'sprintId', 
    label: 'Sprint', 
    width: '18%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: [] // Will be populated dynamically with sprint names
  },
];

// New Story Row Component
interface NewStoryRowProps {
  columns: Column[];
  goals: Goal[];
  sprints: Sprint[];
  newStoryData: Partial<Story>;
  onFieldChange: (field: string, value: any) => void;
  onSave: () => void;
  onCancel: () => void;
}

const NewStoryRow: React.FC<NewStoryRowProps> = ({ 
  columns, 
  goals, 
  sprints, 
  newStoryData, 
  onFieldChange, 
  onSave, 
  onCancel 
}) => {
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const renderNewCell = (column: Column) => {
    const value = newStoryData[column.key as keyof Story];

    if (!column.editable || column.key === 'ref') {
      return (
        <td key={column.key} style={{ width: column.width, padding: '12px 8px', borderRight: `1px solid ${themeVars.border}` }}>
          <div style={{ fontSize: '14px', color: themeVars.muted, fontStyle: 'italic' }}>
            {column.key === 'ref' ? 'Auto-generated' : 'Auto'}
          </div>
        </td>
      );
    }

    if (column.key === 'goalTitle') {
      // Searchable goal selector (datalist) sets goalId
      const listId = 'new-story-goals';
      return (
        <td key={column.key} style={{ width: column.width, padding: '12px 8px', borderRight: `1px solid ${themeVars.border}` }}>
          <input
            list={listId}
            value={(newStoryData.goalId && goals.find(g => g.id === newStoryData.goalId)?.title) || ''}
            onChange={(e) => {
              const typed = e.target.value;
              const match = goals.find(g => g.title === typed || g.id === typed);
              onFieldChange('goalId', match ? match.id : '');
            }}
            placeholder="Search goals..."
            style={{
              width: '100%',
              padding: '6px 8px',
              border: `2px solid ${themeVars.brand}`,
              borderRadius: '4px',
              fontSize: '14px',
              backgroundColor: themeVars.panel,
              outline: 'none',
            }}
          />
          <datalist id={listId}>
            {goals.map(g => (
              <option key={g.id} value={g.title} />
            ))}
          </datalist>
        </td>
      );
    }

    if (column.type === 'select' && column.options) {
      return (
        <td key={column.key} style={{ width: column.width, padding: '12px 8px', borderRight: `1px solid ${themeVars.border}` }}>
          <select
            value={value || ''}
            onChange={(e) => onFieldChange(column.key, e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: `2px solid ${themeVars.brand}`,
              borderRadius: '4px',
              fontSize: '14px',
              backgroundColor: themeVars.panel,
              outline: 'none',
            }}
          >
            {column.key === 'sprintId' ? (
              <>
                <option value="">No Sprint</option>
                {sprints.map(sprint => (
                  <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                ))}
              </>
            ) : (
              column.options.map(option => (
                <option key={option} value={option}>{option}</option>
              ))
            )}
          </select>
        </td>
      );
    }

    return (
      <td key={column.key} style={{ width: column.width, padding: '12px 8px', borderRight: `1px solid ${themeVars.border}` }}>
        <input
          type={column.type === 'number' ? 'number' : 'text'}
          value={value || ''}
          onChange={(e) => onFieldChange(column.key, column.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
          placeholder={`Enter ${column.label.toLowerCase()}...`}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: `2px solid ${themeVars.brand}`,
            borderRadius: '4px',
            fontSize: '14px',
            backgroundColor: themeVars.panel,
            outline: 'none',
          }}
        />
      </td>
    );
  };

  return (
    <tr style={{
      backgroundColor: themeVars.card as string,
      borderBottom: `2px solid ${themeVars.brand}`,
      border: `2px solid ${themeVars.brand}`,
    }}>
      <td style={{
        padding: '12px 8px',
        textAlign: 'center',
        borderRight: `1px solid ${themeVars.border}`,
        width: '48px',
      }}>
        <div style={{ color: themeVars.brand, fontSize: '12px', fontWeight: '600' }}>NEW</div>
      </td>
      {columns.filter(col => col.visible).map(renderNewCell)}
      <td style={{
        padding: '12px 8px',
        textAlign: 'center',
        width: '96px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <button
            onClick={onSave}
            style={{
              color: themeVars.onAccent as string,
              backgroundColor: 'var(--green)',
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
            }}
            title="Save new story"
          >
            Save
          </button>
          <button
            onClick={onCancel}
            style={{
              color: themeVars.onAccent as string,
              backgroundColor: 'var(--red)',
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
            }}
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
};

interface SortableRowProps {
  story: StoryTableRow;
  columns: Column[];
  index: number;
  sprints: Sprint[];
  goals: Goal[];
  onStoryUpdate: (storyId: string, updates: Partial<Story>) => Promise<void>;
  onStoryDelete: (storyId: string) => Promise<void>;
  onStorySelect?: (story: Story) => void;
  onEditStory?: (story: Story) => void;
  onToggleExpand?: (storyId: string) => void;
  isExpanded?: boolean;
  isHighlighted?: boolean;
}

const SortableRow: React.FC<SortableRowProps> = ({ 
  story, 
  columns, 
  index, 
  sprints,
  goals,
  onStoryUpdate, 
  onStoryDelete,
  onStorySelect,
  onEditStory,
  onToggleExpand,
  isExpanded,
  isHighlighted
}) => {
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const { showSidebar } = useSidebar();
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: story.id });

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [generatingStoryId, setGeneratingStoryId] = useState<string | null>(null);
  const { trackFieldChange } = useActivityTracking();

  // Track story view when component mounts (only once per story)
  React.useEffect(() => {
    // Remove automatic view tracking to prevent infinite loops
    // View tracking should only happen on explicit user interactions
  }, [story.id]); // Only re-run when story ID changes

  const baseRowColor = isHighlighted ? '#eff6ff' : themeVars.card as string;
  const hoverRowColor = isHighlighted ? '#dbeafe' : rgbaCard(0.08);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleCellEdit = (key: string, value: string) => {
    setEditingCell(key);
    // For goalTitle, we want to edit the goalId, so set editValue to the current goalId
    if (key === 'goalTitle') {
      const currentTitle = goals.find(g => g.id === story.goalId)?.title || '';
      setEditValue(currentTitle);
    } else if (key === 'status') {
      setEditValue(storyStatusText(value));
    } else {
      setEditValue(value || '');
    }
  };

  const handleCellSave = async (key: string) => {
    try {
      // For goalTitle editing, we're actually editing goalId
      const actualKey = key === 'goalTitle' ? 'goalId' : key;
      const oldValue = (story as any)[actualKey]; // Store the original value
      let valueToSave: any = editValue;

      // If saving goalId, map typed goal title/id to canonical goalId
      if (actualKey === 'goalId') {
        const match = goals.find(g => g.id === editValue || g.title === editValue);
        valueToSave = match ? match.id : editValue;
      } else if (actualKey === 'status') {
        // Map human label/number to canonical numeric status (0,2,4)
        const label = String(editValue).toLowerCase();
        const map: Record<string, number> = {
          '0': 0,
          '1': 2,
          '2': 2,
          '3': 2,
          '4': 4,
          'backlog': 0,
          'planned': 0,
          'in progress': 2,
          'in-progress': 2,
          'active': 2,
          'done': 4,
          'complete': 4,
        };
        valueToSave = map[label] ?? editValue;
      }
      
      // Only proceed if the value actually changed
      if (oldValue !== valueToSave) {
        const updates: Partial<Story> = { [actualKey]: valueToSave } as any;
        // If goal changed, inherit theme from selected goal
        if (actualKey === 'goalId') {
          const newGoal = goals.find(g => g.id === valueToSave);
          if (newGoal && (newGoal as any).theme !== undefined) {
            (updates as any).theme = (newGoal as any).theme;
          }
        }
        await onStoryUpdate(story.id, updates);
        
        // Track the field change for activity stream
        trackFieldChange(
          story.id,
          'story',
          actualKey,
          oldValue,
          valueToSave,
          story.ref
        );
        
        console.log(`🎯 Story field changed: ${actualKey} from "${oldValue}" to "${valueToSave}" for story ${story.id}`);
      }
      
      setEditingCell(null);
    } catch (error) {
      console.error('Error saving story field:', error);
      setEditingCell(null);
    }
  };

  const formatValue = (key: string, value: any): string => {
    // Handle Firebase timestamp objects - React error #31 fix
    if (value && typeof value === 'object') {
      // Check if it's a Firebase Timestamp object
      if (value.seconds !== undefined && value.nanoseconds !== undefined) {
        const date = new Date(value.seconds * 1000 + value.nanoseconds / 1000000);
        if (key === 'updatedAt' || key === 'createdAt') {
          return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
        return date.toISOString();
      }
      // If it's already a Date object
      if (value instanceof Date) {
        if (key === 'updatedAt' || key === 'createdAt') {
          return value.toLocaleDateString() + ' ' + value.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
        return value.toISOString();
      }
      // For other objects, convert to string safely
      return String(value);
    }
    
    if (key === 'status') {
      return storyStatusText(value);
    }
    if (key === 'sprintId' && value) {
      const sprint = sprints.find(s => s.id === value);
      return sprint ? sprint.name : value;
    }
    return value || '';
  };

  const renderCell = (column: Column) => {
    const value = story[column.key as keyof StoryTableRow];
    const isEditing = editingCell === column.key;

    if (isEditing && column.editable) {
      // Searchable goal selector using datalist
      if (column.key === 'goalTitle') {
        const datalistId = `goals-${story.id}`;
        return (
          <td key={column.key} style={{ width: column.width }}>
            <div className="relative">
              <input
                list={datalistId}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => {
                  // Map typed goal title or id to goalId
                  const match = goals.find(g => g.id === editValue || g.title === editValue);
                  if (match) {
                    setEditValue(match.id);
                  }
                  handleCellSave(column.key);
                }}
                onKeyPress={(e) => e.key === 'Enter' && handleCellSave(column.key)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: `2px solid ${themeVars.brand}`,
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: themeVars.panel,
                  outline: 'none',
                  boxShadow: 'none',
                }}
                placeholder="Search goals..."
                autoFocus
              />
              <datalist id={datalistId}>
                {goals.map(g => (
                  <option key={g.id} value={g.title} />
                ))}
              </datalist>
            </div>
          </td>
        );
      }
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
                  border: `2px solid ${themeVars.brand}`,
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: themeVars.panel,
                  outline: 'none',
                  boxShadow: 'none',
                }}
                autoFocus
              >
                {column.key === 'sprintId' ? (
                  <>
                    <option value="">No Sprint</option>
                    {sprints.map(sprint => (
                      <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                    ))}
                  </>
                ) : column.key === 'goalTitle' ? (
                  <>
                    <option value="">Select Goal</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>{goal.title}</option>
                    ))}
                  </>
                ) : (
                  column.options.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))
                )}
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
              border: `2px solid ${themeVars.brand}`,
              borderRadius: '4px',
              fontSize: '14px',
              backgroundColor: themeVars.panel,
              outline: 'none',
              boxShadow: 'none',
            }}
            autoFocus
          />
        </div>
      </td>
    );
    }

    const displayValue = formatValue(column.key, value);
    const canLinkGoal = column.key === 'goalTitle' && !!story.goalId;
    const linkedGoal = canLinkGoal ? goals.find((goal) => goal.id === story.goalId) : undefined;
    const goalRefOrId = linkedGoal?.ref || story.goalId;

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
            e.currentTarget.style.backgroundColor = rgbaCard(0.08);
          }
        }}
        onMouseLeave={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
        onClick={() => column.editable && handleCellEdit(column.key, displayValue)}
      >
        <div style={{
          minHeight: '20px',
          fontSize: '14px',
          color: column.key === 'ref' ? 'var(--red)' : (themeVars.text as string),
          fontWeight: column.key === 'ref' ? '600' : 'normal',
          fontFamily: column.key === 'ref' ? 'monospace' : 'inherit',
          wordBreak: 'break-word',
          whiteSpace: 'normal',
          lineHeight: '1.4',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          {canLinkGoal ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/goals/${goalRefOrId}`);
                }}
                title="Open goal"
                style={{
                  border: 'none',
                  background: 'none',
                  color: themeVars.brand as string,
                  padding: 0,
                  display: 'inline-flex',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {displayValue || 'View goal'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/goals/${goalRefOrId}`);
                }}
                title="Open goal in table"
                style={{
                  border: 'none',
                  background: 'none',
                  color: themeVars.muted as string,
                  padding: 0,
                  display: 'inline-flex',
                  cursor: 'pointer',
                }}
              >
                <ExternalLink size={14} />
              </button>
            </>
          ) : (
            <span>{displayValue}</span>
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
        backgroundColor: baseRowColor,
        borderBottom: `1px solid ${themeVars.border}`,
        boxShadow: isHighlighted ? 'inset 0 0 0 2px #2563eb' : undefined,
        transition: 'background-color 0.15s ease',
        cursor: onStorySelect ? 'pointer' : 'default',
      }}
      {...attributes}
      onClick={(e) => {
        // Don't trigger story selection if clicking on buttons or form elements
        if (
          onStorySelect && 
          e.target instanceof HTMLElement && 
          !e.target.closest('button') && 
          !e.target.closest('input') && 
          !e.target.closest('select')
        ) {
          onStorySelect(story);
        }
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = hoverRowColor;
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = baseRowColor;
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {onToggleExpand && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(story.id); }}
              style={{
                color: 'var(--green)',
                padding: '4px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontSize: '12px',
                fontWeight: 500,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = rgbaCard(0.04);
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--green)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--green)';
              }}
              title={isExpanded ? 'Hide tasks' : 'Show tasks'}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          <button
            onClick={() => showSidebar(story as any, 'story')}
            style={{
              color: themeVars.muted as string,
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontSize: '11px',
              fontWeight: '500',
            }}
            title="Activity stream"
          >
            <Activity size={14} />
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              try {
                setGeneratingStoryId(story.id);
                const fn = httpsCallable(functions, 'generateTasksForStory');
                await fn({ storyId: story.id });
              } catch (err) {
                console.error('generateTasksForStory failed', err);
                alert('Failed to generate tasks for this story.');
              } finally {
                setGeneratingStoryId(null);
              }
            }}
            style={{
              color: themeVars.brand as string,
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: generatingStoryId === story.id ? 'wait' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: generatingStoryId === story.id ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.15);
              e.currentTarget.style.color = themeVars.brand as string;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = themeVars.brand as string;
            }}
            title={generatingStoryId === story.id ? 'Generating tasks…' : 'AI: Generate tasks for story'}
            disabled={generatingStoryId === story.id}
          >
            <Wand2 size={14} />
          </button>
          <button
            onClick={() => onEditStory ? onEditStory(story) : handleCellEdit('title', story.title)}
            style={{
              color: themeVars.brand as string,
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.15);
              e.currentTarget.style.color = themeVars.brand as string;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = themeVars.brand as string;
            }}
            title={onEditStory ? 'Edit story in modal' : 'Quick edit story title'}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onStoryDelete(story.id)}
            style={{
              color: 'var(--red)',
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontSize: '11px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.15);
              e.currentTarget.style.color = 'var(--red)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--red)';
            }}
            title="Delete story"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
};

const ModernStoriesTable: React.FC<ModernStoriesTableProps> = ({
  stories,
  goals,
  onStoryUpdate,
  onStoryDelete,
  onStoryPriorityChange,
  onStoryAdd,
  onStorySelect,
  onEditStory,
  highlightStoryId,
  goalId,
  enableInlineTasks = false,
  onStoryReorder,
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const { selectedSprintId, sprints } = useSprint();
  const [columns, setColumns] = useState<Column[]>(defaultColumns);
  const [showConfig, setShowConfig] = useState(false);
  const [configExpanded, setConfigExpanded] = useState({
    columns: true,
    filters: false,
    display: false,
  });
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [generatingStoryId, setGeneratingStoryId] = useState<string | null>(null);
  
  // New story row state
  const [isAddingNewStory, setIsAddingNewStory] = useState(false);
  const [newStoryData, setNewStoryData] = useState<Partial<Story>>({});
  
  // Enhanced filtering and search state
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    priority: '',
    theme: '',
    sprintId: '',
    points: '',
    hasGoal: ''
  });

  // Inline tasks expansion state (declare before effects that depend on it)
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);

  // Subscribe to inline tasks only for the expanded story to avoid loading all tasks
  useEffect(() => {
    if (!enableInlineTasks || !currentUser || !expandedStoryId) return;
    const tasksQ = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('parentType', '==', 'story'),
      where('parentId', '==', expandedStoryId)
    );
    const unsub = onSnapshot(tasksQ, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Task[];
      setAllTasks(list);
    });
    return () => {
      unsub();
      // Clear tasks when collapsing to prevent stale cross-story data
      setAllTasks([]);
    };
  }, [enableInlineTasks, currentUser, currentPersona, expandedStoryId]);
  const [sortConfig, setSortConfig] = useState({
    key: 'updatedAt',
    direction: 'desc' as 'asc' | 'desc'
  });

  // Enhanced logging for component mount and props
  useEffect(() => {
    console.log('📊 ModernStoriesTable: Component mounted/updated');
    console.log('📊 Stories count:', stories?.length || 0);
    console.log('📊 Goal ID filter:', goalId || 'None (showing all stories)');
    console.log('📊 Goals passed:', goals?.length || 0);
    console.log('📊 User:', currentUser?.email || 'Not logged in');
    console.log('📊 Persona:', currentPersona);
  }, [stories, goalId, goals, currentUser, currentPersona]);

  useEffect(() => {
    setColumns(prev =>
      prev.map(col =>
        col.key === 'sprintId'
          ? {
              ...col,
              options: ['', ...sprints.map(sprint => sprint.id)]
            }
          : col
      )
    );
  }, [sprints]);

  // Handle adding new story row
  const handleAddNewStory = () => {
    setIsAddingNewStory(true);
    
    // Auto-link goal only if we're filtering by a specific goal (Goals Management page context)
    // If goalId is 'all' or undefined, don't auto-select (Stories Management page context)
    const autoGoalId = (goalId && goalId !== 'all') ? goalId : '';
    
    console.log('🎯 New Story Creation Context:');
    console.log('📊 Goal ID prop:', goalId);
    console.log('🎯 Auto-selected goal:', autoGoalId);
    console.log('📝 Available goals:', goals.length);
    
    setNewStoryData({
      title: '',
      description: '',
      goalId: autoGoalId,
      status: 0, // Backlog
      priority: 3, // P3
      points: 1,
      wipLimit: 3,
      orderIndex: 0,
      theme: 1, // Health
      tags: [],
      acceptanceCriteria: []
    });
  };

  const handleSaveNewStory = async () => {
    if (!newStoryData.title || !newStoryData.goalId) {
      alert('Please provide at least a title and select a goal');
      return;
    }

    try {
      console.log('🎯 ModernStoriesTable: Starting new story save...');
      const linkedGoal = goals.find(g => g.id === newStoryData.goalId);
      const payload = {
        ...newStoryData,
        theme: (linkedGoal && (linkedGoal as any).theme !== undefined) ? (linkedGoal as any).theme : newStoryData.theme
      } as Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>;
      await onStoryAdd(payload);
      console.log('✅ ModernStoriesTable: Story add completed, clearing form...');
      
      // Clear the form data but keep the add row visible briefly
      setNewStoryData({});
      
      // Hide the add row after a short delay to allow real-time update to show
      setTimeout(() => {
        console.log('🎯 ModernStoriesTable: Hiding add row after successful creation');
        setIsAddingNewStory(false);
      }, 500);
      
    } catch (error) {
      console.error('❌ ModernStoriesTable: Error saving new story:', error);
      alert('Failed to save story. Please try again.');
    }
  };

  const handleCancelNewStory = () => {
    setIsAddingNewStory(false);
    setNewStoryData({});
  };

  const handleNewStoryFieldChange = (field: string, value: any) => {
    setNewStoryData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Convert stories to table rows with goal titles and sort order
  // Filter by goalId if provided, otherwise show all stories
  const filteredStories = (goalId && goalId !== 'all') ? stories.filter(story => story.goalId === goalId) : stories;
  
  // Debug logs removed to improve performance in production
  const hasMatchingStories = stories.some(story => story.goalId === goalId);
  
  const tableRows: StoryTableRow[] = filteredStories.map((story, index) => {
    const goal = goals.find(g => g.id === story.goalId);
    const shortRef = (story as any).referenceNumber || story.ref;
    const displayRef = shortRef && validateRef(shortRef, 'story')
      ? shortRef
      : displayRefForEntity('story', story.id);
    return {
      ...story,
      ref: displayRef,
      goalTitle: goal?.title || 'Unassigned',
      sortOrder: index,
    };
  });

  // Apply filtering and search
  const filteredRows = tableRows.filter(story => {
    // Respect global sprint selection from context: when a sprint is chosen, enforce it
    if (selectedSprintId && selectedSprintId !== '' && story.sprintId !== selectedSprintId) {
      return false;
    }
    // Search filter (searches title, description, ref, and goal title)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matches = [
        story.title?.toLowerCase(),
        story.description?.toLowerCase(),
        story.ref?.toLowerCase(),
        story.goalTitle?.toLowerCase()
      ].some(field => field?.includes(searchLower));
      
      if (!matches) return false;
    }

    // Status filter (convert string to number, normalize 1/3 into In Progress)
    if (filters.status) {
      const filterVal = parseInt(filters.status, 10);
      const canonicalStoryStatus = typeof story.status === 'number'
        ? (story.status >= 4 ? 4 : story.status >= 2 ? 2 : 0)
        : 0;
      const canonicalFilter = filterVal >= 4 ? 4 : filterVal >= 2 ? 2 : 0;
      if (canonicalStoryStatus !== canonicalFilter) return false;
    }

    // Priority filter (convert string to number)
    if (filters.priority && story.priority !== parseInt(filters.priority)) return false;

    // Theme filter (convert string to number)
    if (filters.theme && story.theme !== parseInt(filters.theme)) return false;

    // Sprint filter
    if (filters.sprintId) {
      if (filters.sprintId === 'unassigned') {
        const hasSprint = typeof story.sprintId === 'string' && story.sprintId.trim() !== '';
        if (hasSprint) return false;
      } else if (story.sprintId !== filters.sprintId) {
        return false;
      }
    }

    // Points filter
    if (filters.points && story.points?.toString() !== filters.points) return false;

    // Has Goal filter
    if (filters.hasGoal) {
      const hasGoal = story.goalId && story.goalId.trim() !== '';
      if (filters.hasGoal === 'yes' && !hasGoal) return false;
      if (filters.hasGoal === 'no' && hasGoal) return false;
    }

    return true;
  });

  // Apply sorting
  const sortedRows = [...filteredRows].sort((a, b) => {
    const { key, direction } = sortConfig;
    let aValue = a[key as keyof StoryTableRow];
    let bValue = b[key as keyof StoryTableRow];

    // Handle different data types
    if (key === 'updatedAt' || key === 'createdAt') {
      aValue = new Date(aValue as string).getTime();
      bValue = new Date(bValue as string).getTime();
    } else if (key === 'points') {
      aValue = Number(aValue) || 0;
      bValue = Number(bValue) || 0;
    } else if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = (bValue as string).toLowerCase();
    }

    if (aValue < bValue) return direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  // Handle column sorting
  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Reset filters
  const resetFilters = () => {
    setFilters({
      search: '',
      status: '',
      priority: '',
      theme: '',
      sprintId: '',
      points: '',
      hasGoal: ''
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    if (onStoryReorder) {
      try {
        await onStoryReorder(active.id as string, over.id as string);
      } catch (error) {
        console.error('Error reordering stories:', error);
      }
      return;
    }

    const newIndex = sortedRows.findIndex(item => item.id === over.id);
    if (newIndex >= 0) {
      await onStoryPriorityChange(active.id as string, newIndex + 1);
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

  // Inline tasks expansion state moved earlier
  const handleToggleExpand = (storyId: string) => {
    setExpandedStoryId(prev => (prev === storyId ? null : storyId));
  };

  return (
    <div 
      data-component="ModernStoriesTable"
      style={{ 
        position: 'relative', 
        backgroundColor: 'var(--panel)', 
        borderRadius: '8px', 
        border: '1px solid var(--line)', 
        boxShadow: '0 1px 3px 0 var(--glass-shadow-color)',
        overflow: 'hidden' 
      }}
    >
      {/* Header with controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        borderBottom: '1px solid var(--line)',
        backgroundColor: 'var(--card)',
      }}>
        <div>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: 'var(--text)', 
            margin: 0, 
            marginBottom: '4px' 
          }}>
            Stories
          </h3>
          <p style={{ 
            fontSize: '14px', 
            color: 'var(--muted)', 
            margin: 0 
          }}>
            {sortedRows.length} of {stories.length} stories • {visibleColumnsCount} columns visible
          </p>
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
            border: showConfig ? '1px solid var(--brand)' : '1px solid var(--line)',
            backgroundColor: showConfig ? 'rgba(var(--card-rgb), 0.3)' : 'var(--panel)',
            color: 'var(--text)',
          }}
          onMouseEnter={(e) => {
            if (!showConfig) e.currentTarget.style.backgroundColor = 'var(--card)';
          }}
          onMouseLeave={(e) => {
            if (!showConfig) e.currentTarget.style.backgroundColor = 'var(--panel)';
          }}
        >
          <Settings size={16} />
          {showConfig ? 'Hide Configuration' : 'Configure Table'}
        </button>
      </div>

      {/* Enhanced Filter Controls */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--line)',
        backgroundColor: 'var(--card)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        alignItems: 'end'
      }}>
        {/* Search Input */}
        <div>
          <label style={{ 
            display: 'block', 
            fontSize: '12px', 
            fontWeight: '500', 
            color: 'var(--text)', 
            marginBottom: '4px' 
          }}>
            Search Stories
          </label>
          <input
            type="text"
            placeholder="Search title, description, ref..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '14px',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              backgroundColor: 'var(--panel)',
            }}
          />
        </div>

        {/* Status Filter */}
        <div>
          <label style={{ 
            display: 'block', 
            fontSize: '12px', 
            fontWeight: '500', 
            color: 'var(--text)', 
            marginBottom: '4px' 
          }}>
            Status
          </label>
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '14px',
              border: '1px solid var(--line)',
              borderRadius: '4px',
            backgroundColor: 'var(--panel)'
          }}
        >
          <option value="">All Statuses</option>
          <option value="0">Backlog</option>
          <option value="2">In Progress</option>
          <option value="4">Done</option>
        </select>
      </div>

        {/* Priority Filter */}
        <div>
          <label style={{ 
            display: 'block', 
            fontSize: '12px', 
            fontWeight: '500', 
            color: 'var(--text)', 
            marginBottom: '4px' 
          }}>
            Priority
          </label>
          <select
            value={filters.priority}
            onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '14px',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              backgroundColor: 'var(--panel)'
            }}
          >
            <option value="">All Priorities</option>
            <option value="1">P1 (High)</option>
            <option value="2">P2 (Medium)</option>
            <option value="3">P3 (Low)</option>
          </select>
        </div>

        {/* Sprint Filter */}
        <div>
          <label style={{ 
            display: 'block', 
            fontSize: '12px', 
            fontWeight: '500', 
            color: 'var(--text)', 
            marginBottom: '4px' 
          }}>
            Sprint
          </label>
          <select
            value={filters.sprintId}
            onChange={(e) => setFilters(prev => ({ ...prev, sprintId: e.target.value }))}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '14px',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              backgroundColor: 'var(--panel)'
            }}
          >
            <option value="">All Sprints</option>
            <option value="unassigned">Unassigned</option>
            {sprints.map(sprint => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name} ({sprint.status})
              </option>
            ))}
          </select>
        </div>

        {/* Has Goal Filter */}
        <div>
          <label style={{ 
            display: 'block', 
            fontSize: '12px', 
            fontWeight: '500', 
            color: 'var(--text)', 
            marginBottom: '4px' 
          }}>
            Goal Link
          </label>
          <select
            value={filters.hasGoal}
            onChange={(e) => setFilters(prev => ({ ...prev, hasGoal: e.target.value }))}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '14px',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              backgroundColor: 'var(--panel)'
            }}
          >
            <option value="">All Stories</option>
            <option value="yes">Linked to Goal</option>
            <option value="no">Not Linked</option>
          </select>
        </div>

        {/* Reset Filters Button */}
        <div>
          <button
            onClick={resetFilters}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: '500',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              backgroundColor: 'var(--panel)',
              color: 'var(--text)',
              cursor: 'pointer',
              width: '100%'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--card)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--panel)';
            }}
          >
            Reset Filters
          </button>
        </div>
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
                backgroundColor: 'var(--card)', 
                borderBottom: '1px solid var(--line)',
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
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderRight: '1px solid var(--line)',
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
                        color: 'var(--muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderRight: '1px solid var(--line)',
                        width: column.width,
                        cursor: 'pointer',
                        position: 'relative',
                        userSelect: 'none'
                      }}
                      onClick={() => handleSort(column.key)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--card)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {column.label}
                        {sortConfig.key === column.key && (
                          <span style={{ fontSize: '10px', color: 'var(--text)' }}>
                            {sortConfig.direction === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
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
                {/* Add New Story Row */}
                {isAddingNewStory && (
                  <NewStoryRow
                    columns={columns}
                    goals={goals}
                    sprints={sprints}
                    newStoryData={newStoryData}
                    onFieldChange={handleNewStoryFieldChange}
                    onSave={handleSaveNewStory}
                    onCancel={handleCancelNewStory}
                  />
                )}
                
                <SortableContext 
                  items={sortedRows.map(row => row.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {sortedRows.map((story, index) => (
                    <React.Fragment key={story.id}>
                      <SortableRow
                        story={story}
                        columns={columns}
                        index={index}
                        sprints={sprints}
                        goals={goals}
                        onStoryUpdate={onStoryUpdate}
                        onStoryDelete={onStoryDelete}
                        onStorySelect={onStorySelect}
                        onEditStory={onEditStory}
                        onToggleExpand={handleToggleExpand}
                        isExpanded={expandedStoryId === story.id}
                        isHighlighted={highlightStoryId === story.id}
                      />
                      {enableInlineTasks && expandedStoryId === story.id && (
                        <tr>
                          <td colSpan={columns.filter(col => col.visible).length + 2} style={{ padding: 0, borderTop: 'none' }}>
                            <div style={{ 
                              backgroundColor: themeVars.card as string, 
                              padding: '16px',
                              borderLeft: `4px solid ${themeVars.brand}`,
                              borderBottom: `1px solid ${themeVars.border}`
                            }}>
                              <h4 style={{ 
                                margin: '0 0 12px 0', 
                                fontSize: '14px', 
                                fontWeight: '600', 
                                color: themeVars.text as string
                              }}>
                                🧩 Tasks for: {story.title}
                              </h4>
                              <ModernTaskTable
                                tasks={allTasks.filter(t => (t as any).parentType === 'story' && (t as any).parentId === story.id)}
                                stories={stories as any}
                                goals={goals as any}
                                sprints={sprints as any}
                                onTaskCreate={async (newTask) => {
                                  const linkedGoal = goals.find(g => g.id === (story as any).goalId);
                                  await addDoc(collection(db, 'tasks'), {
                                    title: newTask.title || '',
                                    description: newTask.description || '',
                                    parentType: 'story',
                                    parentId: story.id,
                                    status: (newTask as any).status ?? 'planned',
                                    priority: (newTask as any).priority ?? 2,
                                    effort: (newTask as any).effort ?? 'M',
                                    dueDate: (newTask as any).dueDate || null,
                                    theme: (linkedGoal as any)?.theme ?? 1,
                                    ownerUid: currentUser!.uid,
                                    persona: currentPersona,
                                    createdAt: serverTimestamp(),
                                    updatedAt: serverTimestamp(),
                                  } as any);
                                }}
                                onTaskUpdate={async (taskId, updates) => {
                                  await updateDoc(doc(db, 'tasks', taskId), { ...updates, updatedAt: serverTimestamp() } as any);
                                }}
                                onTaskDelete={async (taskId) => {
                                  await deleteDoc(doc(db, 'tasks', taskId));
                                }}
                                onTaskPriorityChange={async (taskId, newPriority) => {
                                  await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() } as any);
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </SortableContext>
                
                {/* Add New Story Button Row */}
                {!isAddingNewStory && (
                  <tr>
                    <td colSpan={columns.filter(col => col.visible).length + 2} style={{ 
                      padding: '16px', 
                      textAlign: 'center',
                      borderTop: `2px dashed ${themeVars.border}`,
                      backgroundColor: themeVars.card as string
                    }}>
                      <button
                        onClick={handleAddNewStory}
                        style={{
                          color: themeVars.brand as string,
                          backgroundColor: 'transparent',
                          border: `2px dashed ${themeVars.brand}`,
                          borderRadius: '8px',
                          padding: '8px 16px',
                          fontSize: '14px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = rgbaCard(0.2);
                          e.currentTarget.style.borderColor = themeVars.brand as string;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = themeVars.brand as string;
                        }}
                      >
                        + Add New Story
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

              {/* Display Options */}
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
                        Story Management
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: themeVars.muted as string, 
                        margin: 0,
                        lineHeight: '1.4',
                      }}>
                        Organize user stories by priority and effort. Stories automatically show their associated goal. Drag to reorder by importance.
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
  );
};

export default ModernStoriesTable;

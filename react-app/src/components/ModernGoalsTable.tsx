import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Button, Badge, Form, Modal, Alert, Dropdown } from 'react-bootstrap';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
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
import { useSidebar } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { 
  Settings, 
  GripVertical, 
  Eye, 
  EyeOff,
  ChevronRight,
  ChevronDown,
  Plus
} from 'lucide-react';
import { Goal, Story } from '../types';
import { ChoiceHelper } from '../config/choices';
import { getStatusName, getThemeName } from '../utils/statusHelpers';
import { toDisplayDate } from '../utils/date';
import ModernStoriesTable from './ModernStoriesTable';
import { useTheme } from '../contexts/ModernThemeContext';

interface GoalTableRow extends Goal {
  storiesCount?: number;
  sprintStoriesCount?: number;
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

interface ModernGoalsTableProps {
  goals: Goal[];
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => Promise<void>;
  onGoalDelete: (goalId: string) => Promise<void>;
  onGoalPriorityChange: (goalId: string, newPriority: number) => Promise<void>;
  onEditModal?: (goal: Goal) => void;
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
    label: 'Goal Title', 
    width: '25%', 
    visible: true, 
    editable: true, 
    type: 'text' 
  },
  { 
    key: 'description', 
    label: 'Description', 
    width: '35%', 
    visible: true, 
    editable: true, 
    type: 'text' 
  },
  { 
    key: 'theme', 
    label: 'Theme', 
    width: '12%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: ChoiceHelper.getChoices('goal', 'theme').map(choice => choice.label)
  },
  { 
    key: 'status', 
    label: 'Status', 
    width: '15%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: ChoiceHelper.getChoices('goal', 'status').map(choice => choice.label)
  },
  { 
    key: 'storiesCount', 
    label: 'Stories', 
    width: '10%', 
    visible: true, 
    editable: false, 
    type: 'text' 
  },
  { 
    key: 'sprintStoriesCount', 
    label: 'In Sprint', 
    width: '10%', 
    visible: true, 
    editable: false, 
    type: 'text' 
  },
  { 
    key: 'startDate', 
    label: 'Start Date', 
    width: '15%', 
    visible: true, 
    editable: true, 
    type: 'date' 
  },
  { 
    key: 'targetDate', 
    label: 'Target Date', 
    width: '15%', 
    visible: true, 
    editable: true, 
    type: 'date' 
  },
];

interface SortableRowProps {
  goal: Goal;
  columns: Column[];
  index: number;
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => void;
  onGoalDelete: (goalId: string) => void;
  onEditModal: (goal: Goal) => void;
  onRowClick: (goal: Goal) => void;
  expandedGoalId: string | null;
  goalStories: { [goalId: string]: Story[] };
  onGoalExpand: (goalId: string) => void;
  onStoryUpdate: (storyId: string, updates: Partial<Story>) => Promise<void>;
  onStoryDelete: (storyId: string) => Promise<void>;
  onStoryPriorityChange: (storyId: string, newPriority: number) => Promise<void>;
  onStoryAdd: (goalId: string) => (storyData: Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>) => Promise<void>;
}

const SortableRow: React.FC<SortableRowProps> = ({ 
  goal, 
  columns, 
  index,
  expandedGoalId,
  goalStories,
  onGoalUpdate, 
  onGoalDelete,
  onEditModal,
  onRowClick,
  onGoalExpand,
  onStoryUpdate,
  onStoryDelete,
  onStoryPriorityChange,
  onStoryAdd
}) => {
  const { theme } = useTheme();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id });

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const { trackCRUD, trackClick, trackFieldChange } = useActivityTracking();
  const { currentUser } = useAuth();

  // LOGGING: Individual goal row rendering
  console.log(`🏆 Goal Row ${index + 1} Rendering`, {
    component: 'SortableRow',
    goalId: goal.id,
    goalTitle: goal.title,
    theme: theme,
    isDark: isDark,
    colors: colors,
    backgrounds: backgrounds,
    goalData: goal,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    timestamp: new Date().toISOString()
  });

  // Note: Removed view tracking to focus activity stream on meaningful changes only

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleCellEdit = (key: string, value: string) => {
    trackClick({
      elementId: `goal-cell-edit-${key}`,
      elementType: 'edit',
      entityId: goal.id,
      entityType: 'goal',
      entityTitle: goal.title,
      additionalData: { field: key, originalValue: value }
    });
    setEditingCell(key);
    setEditValue(value || '');
  };

  const handleEditClick = () => {
    console.log('✏️ ModernGoalsTable: Edit button clicked');
    console.log('✏️ Goal:', goal.id, goal.title);
    console.log('✏️ Has onEditModal prop:', !!onEditModal);
    if (onEditModal) {
      console.log('✏️ Calling onEditModal handler');
      onEditModal(goal);
    } else {
      console.log('✏️ No onEditModal handler - this is an issue');
    }
  };

  const handleCellSave = async (key: string) => {
    try {
      let valueToSave: string | number = editValue;
      const oldValue = (goal as any)[key]; // Store the original value
      
      // Convert choice labels back to integer values for ServiceNow choice system
      if (key === 'status') {
        const statusChoice = ChoiceHelper.getChoices('goal', 'status').find(choice => choice.label === editValue);
        valueToSave = statusChoice ? statusChoice.value : editValue;
        console.log(`🎯 Status conversion: "${editValue}" -> ${valueToSave} (oldValue: ${oldValue})`);
      } else if (key === 'theme') {
        const themeChoice = ChoiceHelper.getChoices('goal', 'theme').find(choice => choice.label === editValue);
        valueToSave = themeChoice ? themeChoice.value : editValue;
        console.log(`🎯 Theme conversion: "${editValue}" -> ${valueToSave} (oldValue: ${oldValue})`);
      }
      
      // Only proceed if the value actually changed
      if (oldValue !== valueToSave) {
        const updates: Partial<Goal> = { [key]: valueToSave };
        console.log(`🎯 Goal update for ${goal.id}:`, updates);
        
        await onGoalUpdate(goal.id, updates);
        
        // Track the field change for activity stream
        trackFieldChange(
          goal.id,
          'goal',
          key,
          oldValue,
          valueToSave,
          goal.title // This is the referenceNumber parameter
        );
        
        trackClick({
          elementId: `goal-cell-save-${key}`,
          elementType: 'button',
          entityId: goal.id,
          entityType: 'goal',
          entityTitle: goal.title,
          additionalData: { 
            field: key, 
            oldValue: oldValue,
            newValue: valueToSave,
            action: 'inline_edit_save'
          }
        });
        
        console.log(`✅ Goal field changed: ${key} from "${oldValue}" to "${valueToSave}" for goal ${goal.id}`);
      } else {
        console.log(`🔄 No change detected for ${key}: ${oldValue} === ${valueToSave}`);
      }
      
      setEditingCell(null);
    } catch (error) {
      console.error('❌ Error saving goal cell edit:', error);
      setEditingCell(null); // Clear editing state even on error
    }
  };

  const formatValue = (key: string, value: any): string => {
    // Wrap all date-like fields with toDisplayDate
    if ([
      'createdAt', 'updatedAt', 'startDate', 'targetDate', 'dueDate', 'completedAt', 'timestamp', 'endDate'
    ].includes(key)) {
      return toDisplayDate(value);
    }
    if (key === 'storiesCount') {
      return `${value || 0} stories`;
    }
    if (key === 'sprintStoriesCount') {
      return `${value || 0} in sprint`;
    }
    if (key === 'status') {
      return getStatusName(value);
    }
    if (key === 'theme') {
      return getThemeName(value);
    }
    return value || '';
  };

  const renderCell = (column: Column) => {
    const value = goal[column.key as keyof GoalTableRow];
    const isEditing = editingCell === column.key;

    if (isEditing && column.editable) {
      if (column.type === 'select' && column.options) {
        return (
          <td key={column.key} style={{ width: column.width }}>
            <div className="relative">
              <select
                value={editValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setEditValue(newValue);
                  trackClick({
                    elementId: `goal-dropdown-${column.key}`,
                    elementType: 'dropdown',
                    entityId: goal.id,
                    entityType: 'goal',
                    entityTitle: goal.title,
                    additionalData: { 
                      field: column.key, 
                      newValue: newValue,
                      action: 'dropdown_change'
                    }
                  });
                  // Auto-save on dropdown change
                  setTimeout(() => {
                    handleCellSave(column.key);
                  }, 50);
                }}
                onBlur={() => {
                  // For dropdowns, we auto-save on change, so just clear editing state
                  if (editingCell === column.key) {
                    setEditingCell(null);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: backgrounds.surface,
                  color: colors.onSurface,
                  outline: 'none',
                  boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.2)',
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
                border: '1px solid #3b82f6',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: backgrounds.surface,
                color: colors.onSurface,
                outline: 'none',
                boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.2)',
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
          borderRight: `1px solid ${theme.colors.border}`,
          cursor: column.editable ? 'pointer' : 'default',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = '#f9fafb';
          }
        }}
        onMouseLeave={(e) => {
          if (column.editable) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
        onClick={() => {
          if (column.editable) {
            // For dropdown fields, we need to use the formatted (label) value for editing
            const editValueToUse = (column.type === 'select') ? formatValue(column.key, value) : formatValue(column.key, value);
            handleCellEdit(column.key, editValueToUse);
          }
        }}
      >
        <div style={{
          minHeight: '20px',
          fontSize: '14px',
          color: column.key === 'ref' ? '#059669' : '#374151',
          fontWeight: column.key === 'ref' ? '600' : 'normal',
          fontFamily: column.key === 'ref' ? 'monospace' : 'inherit',
          wordBreak: 'break-word',
          whiteSpace: 'normal',
          lineHeight: '1.4',
        }}>
          {formatValue(column.key, value)}
        </div>
      </td>
    );
  };

  return (
    <>
      <tr
      ref={setNodeRef}
      data-testid={`goal-row-${goal.id}`}
      style={{
        ...style,
        backgroundColor: backgrounds.surface,
        borderBottom: '1px solid #f3f4f6',
        transition: 'background-color 0.15s ease',
        cursor: 'pointer',
      }}
      {...attributes}
      onClick={(e) => {
        // Only handle row click if not clicking on editable cells or buttons
        const target = e.target as HTMLElement;
        if (!target.closest('button') && !target.closest('input') && !target.closest('select')) {
          onRowClick(goal);
        }
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = '#f9fafb';
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
        borderRight: `1px solid ${theme.colors.border}`,
        width: '48px',
      }}>
        <button
          {...listeners}
          style={{
            color: theme.colors.onSurface,
            padding: '4px',
            borderRadius: '4px',
            border: 'none',
            background: 'none',
            cursor: 'grab',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#6b7280';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#9ca3af';
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <button
            onClick={() => onGoalExpand(goal.id)}
            style={{
              color: '#059669',
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontSize: '12px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#d1fae5';
              e.currentTarget.style.color = '#047857';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#059669';
            }}
            title="View stories"
          >
            {expandedGoalId === goal.id ? '▼' : '▶'}
          </button>
          <button
            onClick={() => handleEditClick()}
            style={{
              color: '#2563eb',
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontSize: '12px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#dbeafe';
              e.currentTarget.style.color = '#1d4ed8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#2563eb';
            }}
            title="Edit goal"
            data-testid="goal-edit-btn"
          >
            Edit
          </button>
          <button
            onClick={() => onGoalDelete(goal.id)}
            style={{
              color: '#dc2626',
              padding: '4px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontSize: '12px',
              fontWeight: '500',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#fee2e2';
              e.currentTarget.style.color = '#b91c1c';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#dc2626';
            }}
            title="Delete goal"
            data-testid="goal-delete-btn"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
    {/* Expanded row for stories */}
    {expandedGoalId === goal.id && (
      <tr>
        <td colSpan={columns.filter(col => col.visible).length + 2} style={{ padding: 0, borderTop: 'none' }}>
          <div style={{ 
            backgroundColor: '#f8fafc', 
            padding: '16px',
            borderLeft: '4px solid #059669',
            borderBottom: `1px solid ${theme.colors.border}`
          }}>
            <h4 style={{ 
              margin: '0 0 12px 0', 
              fontSize: '14px', 
              fontWeight: '600', 
              color: theme.colors.onSurface,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              📚 Stories for: {goal.title}
            </h4>
            <ModernStoriesTable
              stories={goalStories[goal.id] || []}
              goals={[]}
              goalId={goal.id}
              onStoryUpdate={onStoryUpdate}
              onStoryDelete={onStoryDelete}
              onStoryPriorityChange={onStoryPriorityChange}
              onStoryAdd={onStoryAdd(goal.id)}
            />
          </div>
        </td>
      </tr>
    )}
    </>
  );
};

const ModernGoalsTable: React.FC<ModernGoalsTableProps> = ({
  goals,
  onGoalUpdate,
  onGoalDelete,
  onGoalPriorityChange,
  onEditModal,
}) => {
  const { theme } = useTheme();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const [columns, setColumns] = useState<Column[]>(defaultColumns);
  const [showConfig, setShowConfig] = useState(false);
  const [configExpanded, setConfigExpanded] = useState({
    columns: true,
    filters: false,
    display: false,
  });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [goalStories, setGoalStories] = useState<{ [goalId: string]: Story[] }>({});
  const { trackClick } = useActivityTracking();
  const { showSidebar } = useSidebar();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  // LOGGING: Component load and theme info
  console.log('📊 ModernGoalsTable Component Loading', {
    component: 'ModernGoalsTable',
    theme: theme,
    isDark: isDark,
    colors: colors,
    backgrounds: backgrounds,
    goalsCount: goals?.length || 0,
    goals: goals,
    currentPersona: currentPersona,
    currentUser: currentUser?.email,
    timestamp: new Date().toISOString()
  });

  // LOGGING: Check for React Error #31 issues in goals data
  if (goals && goals.length > 0) {
    goals.forEach((goal, index) => {
      console.log(`🔍 Goal ${index + 1} Analysis for React Error #31`, {
        goalId: goal.id,
        goalTitle: goal.title,
        createdAt: goal.createdAt,
        createdAtType: typeof goal.createdAt,
        updatedAt: goal.updatedAt,
        updatedAtType: typeof goal.updatedAt,
        isCreatedAtObject: typeof goal.createdAt === 'object' && goal.createdAt !== null && !(goal.createdAt instanceof Date),
        isUpdatedAtObject: typeof goal.updatedAt === 'object' && goal.updatedAt !== null && !(goal.updatedAt instanceof Date),
        potentialIssue: (typeof goal.createdAt === 'object' && goal.createdAt !== null && !(goal.createdAt instanceof Date)) || 
                        (typeof goal.updatedAt === 'object' && goal.updatedAt !== null && !(goal.updatedAt instanceof Date)),
        fullGoalData: goal
      });
    });
  }

  // Load stories for expanded goals
  useEffect(() => {
    if (!currentUser || !expandedGoalId) {
      console.log('📚 ModernGoalsTable: Story loading skipped', {
        hasUser: !!currentUser,
        expandedGoalId,
        reason: !currentUser ? 'No user' : 'No expanded goal'
      });
      return;
    }

    console.log('📚 ModernGoalsTable: Starting story load');
    console.log('📚 Goal ID:', expandedGoalId);
    console.log('📚 User:', currentUser.email);
    console.log('📚 Persona:', currentPersona);

    const storiesQuery = query(
      collection(db, 'stories'),
      where('goalId', '==', expandedGoalId),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );

    console.log('📚 ModernGoalsTable: Query created, setting up listener');

    const unsubscribe = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id, 
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        };
      }) as Story[];
      
      console.log(`📚 ModernGoalsTable: Query result received`);
      console.log(`📚 Stories found: ${storiesData.length}`);
      console.log(`📚 Goal: ${expandedGoalId}`);
      if (storiesData.length > 0) {
        console.log(`📚 First story:`, storiesData[0]);
      }
      
      setGoalStories(prev => ({
        ...prev,
        [expandedGoalId]: storiesData
      }));
    }, (error) => {
      console.error('📚 ModernGoalsTable: Query error:', error);
    });

    return unsubscribe;
  }, [currentUser, expandedGoalId, currentPersona]);

  const handleEditModal = (goal: Goal) => {
    trackClick({
      elementId: 'goal-edit-modal-open',
      elementType: 'button',
      entityId: goal.id,
      entityType: 'goal',
      entityTitle: goal.title,
      additionalData: { action: 'open_edit_modal' }
    });
    setEditingGoal(goal);
    setShowEditModal(true);
  };

  const handleRowClick = (goal: Goal) => {
    trackClick({
      elementId: 'goal-row-click',
      elementType: 'button',
      entityId: goal.id,
      entityType: 'goal',
      entityTitle: goal.title,
      additionalData: { action: 'open_sidebar', source: 'goals_table' }
    });
    showSidebar(goal, 'goal');
  };

  // Story management handlers
  const handleStoryUpdate = async (storyId: string, updates: Partial<Story>) => {
    // Implementation will be passed from parent component or handled here
    console.log('Story update:', storyId, updates);
  };

  const handleStoryDelete = async (storyId: string) => {
    // Implementation will be passed from parent component or handled here
    console.log('Story delete:', storyId);
  };

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    // Implementation will be passed from parent component or handled here
    console.log('Story priority change:', storyId, newPriority);
  };

  const handleStoryAdd = (goalId: string) => async (storyData: Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>) => {
    // Implementation will be passed from parent component or handled here
    console.log('Story add:', goalId, storyData);
  };

  const handleGoalExpand = (goalId: string) => {
    const isExpanding = expandedGoalId !== goalId;
    console.log('🎯 ModernGoalsTable: Goal expansion click');
    console.log('🎯 Goal ID:', goalId);
    console.log('🎯 Action:', isExpanding ? 'EXPANDING' : 'COLLAPSING');
    console.log('🎯 Current expanded goal:', expandedGoalId);
    console.log('🎯 User:', currentUser?.email);
    console.log('🎯 Persona:', currentPersona);
    
    setExpandedGoalId(expandedGoalId === goalId ? null : goalId);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Convert goals to table rows with sort order
  const tableRows: GoalTableRow[] = goals.map((goal, index) => ({
    ...goal,
    sortOrder: index,
  }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const newIndex = tableRows.findIndex(item => item.id === over.id);
      
      // Update priority based on new position (1-indexed)
      await onGoalPriorityChange(active.id as string, newIndex + 1);
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
    <div 
      data-component="ModernGoalsTable"
      style={{ 
        position: 'relative', 
        backgroundColor: theme.colors.surface, 
        borderRadius: '8px', 
        border: `1px solid ${theme.colors.border}`, 
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        overflow: 'hidden' 
      }}
    >
      {/* Header with controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: '#f9fafb',
      }}>
        <div>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: theme.colors.onBackground, 
            margin: 0, 
            marginBottom: '4px' 
          }}>
            Goals
          </h3>
          <p style={{ 
            fontSize: '14px', 
            color: theme.colors.onSurface, 
            margin: 0 
          }}>
            {goals.length} goals • {visibleColumnsCount} columns visible
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
            border: showConfig ? '1px solid #bfdbfe' : '1px solid #d1d5db',
            backgroundColor: showConfig ? '#dbeafe' : backgrounds.surface,
            color: showConfig ? '#1e40af' : colors.primary,
          }}
          onMouseEnter={(e) => {
            if (!showConfig) {
              e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f9fafb';
            }
          }}
          onMouseLeave={(e) => {
            if (!showConfig) {
              e.currentTarget.style.backgroundColor = backgrounds.surface;
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
                backgroundColor: '#f9fafb', 
                borderBottom: `1px solid ${theme.colors.border}` 
              }}>
                <tr>
                  <th style={{
                    padding: '12px 8px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: theme.colors.onSurface,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderRight: `1px solid ${theme.colors.border}`,
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
                        color: theme.colors.onSurface,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderRight: `1px solid ${theme.colors.border}`,
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
                    color: theme.colors.onSurface,
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
                  {tableRows.map((goal, index) => (
                    <SortableRow
                      key={goal.id}
                      goal={goal}
                      columns={columns}
                      index={index}
                      expandedGoalId={expandedGoalId}
                      goalStories={goalStories}
                      onGoalUpdate={onGoalUpdate}
                      onGoalDelete={onGoalDelete}
                      onEditModal={handleEditModal}
                      onRowClick={handleRowClick}
                      onGoalExpand={handleGoalExpand}
                      onStoryUpdate={handleStoryUpdate}
                      onStoryDelete={handleStoryDelete}
                      onStoryPriorityChange={handleStoryPriorityChange}
                      onStoryAdd={handleStoryAdd}
                    />
                  ))}
                </SortableContext>
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
          backgroundColor: theme.colors.surface,
          borderLeft: '1px solid #e5e7eb',
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
                    color: theme.colors.onBackground,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
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
                        e.currentTarget.style.backgroundColor = '#f9fafb';
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
                            borderColor: column.visible ? '#2563eb' : '#d1d5db',
                            backgroundColor: column.visible ? '#2563eb' : 'transparent',
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
                          <span style={{ fontSize: '14px', color: theme.colors.onBackground }}>{column.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {column.visible ? (
                            <Eye size={14} style={{ color: theme.colors.onSurface }} />
                          ) : (
                            <EyeOff size={14} style={{ color: theme.colors.onSurface }} />
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
                    color: theme.colors.onBackground,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
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
                      backgroundColor: '#f9fafb',
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: theme.colors.onBackground, 
                        margin: '0 0 8px 0' 
                      }}>
                        Goals Management
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: theme.colors.onSurface, 
                        margin: 0,
                        lineHeight: '1.4',
                      }}>
                        Drag to reorder goals by priority. Click any cell to edit. Use theme categories to organize your objectives.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Goal Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit Goal</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editingGoal && (
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Goal Title</Form.Label>
                <Form.Control
                  type="text"
                  defaultValue={editingGoal.title}
                  onChange={(e) => setEditingGoal({...editingGoal, title: e.target.value})}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  defaultValue={editingGoal.description}
                  onChange={(e) => setEditingGoal({...editingGoal, description: e.target.value})}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  defaultValue={editingGoal.theme}
                  onChange={(e) => setEditingGoal({...editingGoal, theme: parseInt(e.target.value) || 0})}
                >
                  {GLOBAL_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Status</Form.Label>
                <Form.Select
                  defaultValue={editingGoal.status}
                  onChange={(e) => setEditingGoal({...editingGoal, status: e.target.value as any})}
                >
                  <option value="New">New</option>
                  <option value="Work in Progress">Work in Progress</option>
                  <option value="Complete">Complete</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Deferred">Deferred</option>
                </Form.Select>
              </Form.Group>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={() => {
              if (editingGoal) {
                onGoalUpdate(editingGoal.id, {
                  title: editingGoal.title,
                  description: editingGoal.description,
                  theme: editingGoal.theme,
                  status: editingGoal.status
                });
                setShowEditModal(false);
                setEditingGoal(null);
              }
            }}
          >
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default ModernGoalsTable;

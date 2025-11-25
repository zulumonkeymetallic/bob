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
import { useSprint } from '../contexts/SprintContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { collection, query, where, onSnapshot, doc, getDoc, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { GLOBAL_THEMES, GlobalTheme } from '../constants/globalThemes';
import {
  Settings,
  GripVertical,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Plus,
  Activity,
  Wand2,
  Pencil,
  Trash2
} from 'lucide-react';
import { Goal, Story } from '../types';
import { ChoiceHelper } from '../config/choices';
import { getStatusName, getThemeName } from '../utils/statusHelpers';
import ModernStoriesTable from './ModernStoriesTable';
import { themeVars, rgbaCard } from '../utils/themeVars';

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
  onGoalReorder?: (activeId: string, overId: string) => Promise<void>;
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
    key: 'progress',
    label: 'Progress',
    width: '15%',
    visible: true,
    editable: false,
    type: 'number'
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
  globalThemes: GlobalTheme[];
  availableGoals: Goal[];
  storyCounts: Record<string, number>;
  sprintStoryCounts: Record<string, number>;
  storyPointsData: Record<string, { total: number; completed: number; progress: number }>;
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
  onStoryAdd,
  globalThemes,
  availableGoals,
  storyCounts,
  sprintStoryCounts,
  storyPointsData
}) => {
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
  const { showSidebar } = useSidebar();
  const [generating, setGenerating] = useState<boolean>(false);

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

  const handleGenerateStories = async () => {
    if (!currentUser) return;
    try {
      setGenerating(true);
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      const resp: any = await callable({ goalId: goal.id });
      const created = resp?.data?.created ?? 0;
      alert(created > 0 ? `Generated ${created} stories for "${goal.title}"` : 'No stories generated');
      trackClick({ elementId: 'goal-generate-stories', elementType: 'button', entityId: goal.id, entityType: 'goal', entityTitle: goal.title, additionalData: { created } });
    } catch (e: any) {
      console.error('generateStoriesForGoal failed', e);
      alert('Failed to generate stories: ' + (e?.message || 'Unknown error'));
    } finally {
      setGenerating(false);
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
        // Prefer user-configured global themes over static choices
        const themeFromSettings = globalThemes.find(t => t.label === editValue || t.name === editValue);
        if (themeFromSettings) {
          valueToSave = themeFromSettings.id;
        } else {
          // Fallback: try static ChoiceHelper mapping or numeric parse
          const themeChoice = ChoiceHelper.getChoices('goal', 'theme').find(choice => choice.label === editValue);
          valueToSave = themeChoice ? themeChoice.value : (isNaN(Number(editValue)) ? oldValue : Number(editValue));
        }
        console.log(`🎯 Theme conversion (dynamic): "${editValue}" -> ${valueToSave} (oldValue: ${oldValue})`);
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
    if (key === 'targetDate' && typeof value === 'number') {
      return new Date(value).toLocaleDateString();
    }
    if (key === 'storiesCount') {
      return `${storyCounts[goal.id] || 0} stories`;
    }
    if (key === 'sprintStoriesCount') {
      return `${sprintStoryCounts[goal.id] || 0} in sprint`;
    }
    if (key === 'progress') {
      const data = storyPointsData[goal.id];
      if (!data || data.total === 0) return '0%';
      return `${Math.round(data.progress)}% (${data.completed}/${data.total} pts)`;
    }
    if (key === 'status') {
      return getStatusName(value);
    }
    // theme formatting will be overridden in parent where global themes are known
    return value || '';
  };

  const renderCell = (column: Column) => {
    const value = goal[column.key as keyof GoalTableRow];
    const isEditing = editingCell === column.key;

    if (isEditing && column.editable) {
      // Special handling for theme: use searchable input tied to global themes
      if (column.key === 'theme') {
        const datalistId = `theme-options-${goal.id}`;
        return (
          <td key={column.key} style={{ width: column.width }}>
            <div className="relative">
              <input
                list={datalistId}
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
                  backgroundColor: themeVars.panel as string,
                  color: themeVars.text as string,
                  outline: 'none',
                  boxShadow: 'none'
                }}
                placeholder="Search themes..."
                autoFocus
              />
              <datalist id={datalistId}>
                {globalThemes.map((t) => (
                  <option key={t.id} value={t.label} />
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
                  border: `2px solid ${themeVars.brand}`,
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: themeVars.panel as string,
                  color: themeVars.text as string,
                  outline: 'none',
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
            e.currentTarget.style.backgroundColor = rgbaCard(0.08);
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
            const editValueToUse = (() => {
              if (column.key === 'theme') {
                const themeId = value as unknown as number;
                const t = globalThemes.find(gt => gt.id === themeId);
                return t ? t.label : '';
              }
              return (column.type === 'select') ? formatValue(column.key, value) : formatValue(column.key, value);
            })();
            handleCellEdit(column.key, editValueToUse);
          }
        }}
      >
        <div style={{
          minHeight: '20px',
          fontSize: '14px',
          color: column.key === 'ref' ? ('var(--green)' as string) : (themeVars.text as string),
          fontWeight: column.key === 'ref' ? '600' : 'normal',
          fontFamily: column.key === 'ref' ? 'monospace' : 'inherit',
          wordBreak: 'break-word',
          whiteSpace: 'normal',
          lineHeight: '1.4',
        }}>
          {(() => {
            if (column.key === 'theme') {
              const themeId = value as unknown as number;
              const theme = globalThemes.find(t => t.id === themeId);
              if (theme) {
                return (
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: theme.color,
                    color: getContrastTextColor(theme.color),
                    fontSize: '12px',
                  }}>
                    {theme.label}
                  </span>
                );
              }
            }
            return (
              <span>{formatValue(column.key, value)}</span>
            );
          })()}
        </div>
      </td>
    );
  };

  return (
    <>
      <tr
        ref={setNodeRef}
        style={{
          ...style,
          backgroundColor: backgrounds.surface,
          borderBottom: `1px solid ${themeVars.border}`,
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
            e.currentTarget.style.backgroundColor = rgbaCard(0.08);
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <button
              onClick={() => showSidebar(goal, 'goal')}
              style={{
                color: themeVars.muted as string,
                padding: '4px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = rgbaCard(0.08);
                e.currentTarget.style.color = themeVars.text as string;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = themeVars.muted as string;
              }}
              title="Activity stream"
            >
              <Activity size={14} />
            </button>
            <button
              onClick={() => onGoalExpand(goal.id)}
              style={{
                color: 'var(--green)',
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
                e.currentTarget.style.backgroundColor = rgbaCard(0.08);
                e.currentTarget.style.color = 'var(--green)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--green)';
              }}
              title="View stories"
            >
              {expandedGoalId === goal.id ? '▼' : '▶'}
            </button>
            <button
              onClick={handleGenerateStories}
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
                e.currentTarget.style.backgroundColor = rgbaCard(0.08);
                e.currentTarget.style.color = themeVars.brand as string;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = themeVars.brand as string;
              }}
              disabled={generating}
              title={generating ? 'Generating…' : 'Auto-generate stories'}
            >
              <Wand2 size={14} />
            </button>
            <button
              onClick={() => handleEditClick()}
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
                e.currentTarget.style.backgroundColor = rgbaCard(0.08);
                e.currentTarget.style.color = themeVars.brand as string;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = themeVars.brand as string;
              }}
              title="Edit goal"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => onGoalDelete(goal.id)}
              style={{
                color: 'var(--red)',
                padding: '4px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = rgbaCard(0.08);
                e.currentTarget.style.color = 'var(--red)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--red)';
              }}
              title="Delete goal"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
      {/* Expanded row for stories */}
      {expandedGoalId === goal.id && (
        <tr>
          <td colSpan={columns.filter(col => col.visible).length + 2} style={{ padding: 0, borderTop: 'none' }}>
            <div style={{
              backgroundColor: themeVars.card as string,
              padding: '16px',
              borderLeft: `4px solid var(--green)`,
              borderBottom: `1px solid ${themeVars.border}`
            }}>
              <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '14px',
                fontWeight: '600',
                color: themeVars.text as string,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                📚 Stories for: {goal.title}
              </h4>
              <ModernStoriesTable
                stories={goalStories[goal.id] || []}
                goals={availableGoals}
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
  onGoalReorder,
}) => {
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
  const [allGoals, setAllGoals] = useState<Goal[]>([]);
  const { trackClick } = useActivityTracking();
  const { showSidebar } = useSidebar();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [globalThemes, setGlobalThemes] = useState<GlobalTheme[]>(GLOBAL_THEMES);
  const [storyCounts, setStoryCounts] = useState<Record<string, number>>({});
  const [sprintStoryCounts, setSprintStoryCounts] = useState<Record<string, number>>({});
  const [storyPointsData, setStoryPointsData] = useState<Record<string, { total: number; completed: number; progress: number }>>({});
  const { selectedSprintId } = useSprint();

  // Load user-defined global themes
  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        const ref = doc(db, 'global_themes', currentUser.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data.themes) && data.themes.length) {
            setGlobalThemes(data.themes as GlobalTheme[]);
          }
        }
      } catch (e) {
        console.warn('ModernGoalsTable: failed to load global themes', e);
      }
    };
    load();
  }, [currentUser]);

  // Sync theme column options with loaded themes
  useEffect(() => {
    setColumns(prev => prev.map(col => (
      col.key === 'theme' && col.type === 'select'
        ? { ...col, options: globalThemes.map(t => t.label) }
        : col
    )));
  }, [globalThemes]);

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

    // Avoid composite index requirement: filter only, then sort in memory
    const storiesQuery = query(
      collection(db, 'stories'),
      where('goalId', '==', expandedGoalId),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
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

      // Sort newest first (desc) in memory
      storiesData.sort((a, b) => {
        const ad = a.createdAt instanceof Date ? a.createdAt : new Date(0);
        const bd = b.createdAt instanceof Date ? b.createdAt : new Date(0);
        return bd.getTime() - ad.getTime();
      });

      setGoalStories(prev => ({
        ...prev,
        [expandedGoalId]: storiesData
      }));
    }, (error) => {
      console.error('📚 ModernGoalsTable: Query error:', error);
    });

    return unsubscribe;
  }, [currentUser, expandedGoalId, currentPersona]);

  // Load all goals for searchable goal lists in expanded stories tables
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[];
      setAllGoals(list);
    }, (err) => console.warn('ModernGoalsTable: goals load failed', err));
    return unsub;
  }, [currentUser, currentPersona]);

  // Aggregate story counts AND story points per goal and per selected sprint
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const unsub = onSnapshot(q, (snap) => {
      const counts: Record<string, number> = {};
      const sprintCounts: Record<string, number> = {};
      const pointsData: Record<string, { total: number; completed: number; progress: number }> = {};

      snap.docs.forEach(d => {
        const s = d.data() as any;
        const gid = s.goalId;
        if (!gid) return;

        // Story count (existing logic)
        counts[gid] = (counts[gid] || 0) + 1;
        if (selectedSprintId && s.sprintId === selectedSprintId) {
          sprintCounts[gid] = (sprintCounts[gid] || 0) + 1;
        }

        // Story points aggregation (NEW)
        if (!pointsData[gid]) {
          pointsData[gid] = { total: 0, completed: 0, progress: 0 };
        }

        const points = s.points || 0;
        pointsData[gid].total += points;

        // Story status 4 = Done
        if (s.status === 4) {
          pointsData[gid].completed += points;
        }
      });

      // Calculate progress percentages
      Object.keys(pointsData).forEach(gid => {
        const data = pointsData[gid];
        data.progress = data.total > 0 ? (data.completed / data.total) * 100 : 0;
      });

      setStoryCounts(counts);
      setSprintStoryCounts(sprintCounts);
      setStoryPointsData(pointsData);
    });
    return unsub;
  }, [currentUser, currentPersona, selectedSprintId]);

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
    try {
      if (!currentUser) throw new Error('No user');

      // Generate unique reference number for story for this owner
      const existing = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)));
      const existingRefs = existing.docs.map(d => (d.data() as any).ref).filter(Boolean) as string[];
      const { generateRef } = await import('../utils/referenceGenerator');
      const ref = generateRef('story', existingRefs);

      // Get goal theme to inherit if available
      let themeToUse = (storyData as any).theme ?? 1;
      try {
        const gSnap = await getDoc(doc(db, 'goals', goalId));
        const gData: any = gSnap.exists() ? gSnap.data() : null;
        if (gData && typeof gData.theme !== 'undefined') themeToUse = gData.theme;
      } catch { }

      const payload: any = {
        ...storyData,
        ref,
        goalId,
        theme: themeToUse,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'stories'), payload);
      console.log('✅ ModernGoalsTable: Inline story created', { goalId, ref });
    } catch (e) {
      console.error('❌ ModernGoalsTable: Failed to add story inline', e);
      throw e;
    }
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
    sortOrder: goal.orderIndex ?? index,
  }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    if (onGoalReorder) {
      try {
        await onGoalReorder(active.id as string, over.id as string);
      } catch (error) {
        console.error('Error reordering goals:', error);
      }
      return;
    }

    const newIndex = tableRows.findIndex(item => item.id === over.id);
    if (newIndex >= 0) {
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
        backgroundColor: themeVars.panel as string,
        borderRadius: '8px',
        border: `1px solid ${themeVars.border}`,
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
            Goals
          </h3>
          <p style={{
            fontSize: '14px',
            color: themeVars.muted as string,
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
                  {tableRows.map((goal, index) => (
                    <SortableRow
                      key={goal.id}
                      goal={goal}
                      columns={columns}
                      index={index}
                      storyCounts={storyCounts}
                      sprintStoryCounts={sprintStoryCounts}
                      storyPointsData={storyPointsData}
                      globalThemes={globalThemes}
                      availableGoals={allGoals}
                      expandedGoalId={expandedGoalId}
                      goalStories={goalStories}
                      onGoalUpdate={onGoalUpdate}
                      onGoalDelete={onGoalDelete}
                      onEditModal={onEditModal ? onEditModal : handleEditModal}
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
          backgroundColor: themeVars.card as string,
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
                    e.currentTarget.style.backgroundColor = rgbaCard(0.08);
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
                          e.currentTarget.style.backgroundColor = rgbaCard(0.08);
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
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
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
                    e.currentTarget.style.backgroundColor = rgbaCard(0.08);
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
                        Goals Management
                      </h4>
                      <p style={{
                        fontSize: '12px',
                        color: themeVars.muted as string,
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
                  onChange={(e) => setEditingGoal({ ...editingGoal, title: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  defaultValue={editingGoal.description}
                  onChange={(e) => setEditingGoal({ ...editingGoal, description: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Control
                  list="modal-theme-options"
                  defaultValue={(globalThemes.find(t => t.id === (editingGoal.theme as any))?.label) || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = globalThemes.find(t => t.label === val || t.name === val);
                    setEditingGoal({ ...editingGoal, theme: match ? match.id : (parseInt(val) || 0) });
                  }}
                  placeholder="Search themes..."
                />
                <datalist id="modal-theme-options">
                  {globalThemes.map(t => (
                    <option key={t.id} value={t.label} />
                  ))}
                </datalist>
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Status</Form.Label>
                <Form.Select
                  defaultValue={editingGoal.status}
                  onChange={(e) => setEditingGoal({ ...editingGoal, status: e.target.value as any })}
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

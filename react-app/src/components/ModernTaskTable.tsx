import React, { useState } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { Task, Story, Goal, Sprint } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useActivityTracking } from '../hooks/useActivityTracking';

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
];

interface SortableRowProps {
  task: TaskTableRow;
  columns: Column[];
  index: number;
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onTaskDelete: (taskId: string) => Promise<void>;
}

const SortableRow: React.FC<SortableRowProps> = ({ 
  task, 
  columns, 
  index, 
  onTaskUpdate, 
  onTaskDelete 
}) => {
  const { showSidebar } = useSidebar();
  const { trackClick, trackFieldChange } = useActivityTracking();
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

  const handleCellEdit = (key: string, value: string) => {
    setEditingCell(key);
    setEditValue(value || '');
  };

  const handleCellSave = async (key: string) => {
    try {
      const oldValue = (task as any)[key]; // Store the original value
      
      // Only proceed if the value actually changed
      if (oldValue !== editValue) {
        const updates: Partial<Task> = { [key]: editValue };
        await onTaskUpdate(task.id, updates);
        
        // Track the field change for activity stream
        trackFieldChange(
          task.id,
          'task',
          key,
          oldValue,
          editValue,
          task.title,
          task.ref
        );
        
        console.log(`🎯 Task field changed: ${key} from "${oldValue}" to "${editValue}" for task ${task.id}`);
      }
      
      setEditingCell(null);
    } catch (error) {
      console.error('Error saving task field:', error);
      setEditingCell(null);
    }
  };

  const formatValue = (key: string, value: any): string => {
    if (key === 'dueDate' && typeof value === 'number') {
      return new Date(value).toLocaleDateString();
    }
    if (key === 'theme' && typeof value === 'number') {
      const themes = ['', 'Health', 'Growth', 'Wealth', 'Tribe', 'Home'];
      return themes[value] || '';
    }
    return value || '';
  };

  const getThemeColor = (theme: number): string => {
    const colors = ['', '#ef4444', '#8b5cf6', '#059669', '#f59e0b', '#3b82f6'];
    return colors[theme] || '#6b7280';
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
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: 'white',
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
                backgroundColor: 'white',
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
          borderRight: '1px solid #f3f4f6',
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
        onClick={() => column.editable && handleCellEdit(column.key, formatValue(column.key, value))}
      >
        <div style={{
          minHeight: '20px',
          fontSize: '14px',
          color: column.key === 'ref' ? '#4f46e5' : '#374151',
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
                color: 'white',
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
        backgroundColor: 'white',
        borderBottom: '1px solid #f3f4f6',
        transition: 'background-color 0.15s ease',
      }}
      {...attributes}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = 'white';
        }
      }}
    >
      <td style={{
        padding: '12px 8px',
        textAlign: 'center',
        borderRight: '1px solid #f3f4f6',
        width: '48px',
      }}>
        <button
          {...listeners}
          style={{
            color: '#9ca3af',
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <button
            onClick={async () => {
              console.log('🔧 ModernTaskTable: EDIT button clicked', {
                action: 'edit_button_clicked',
                taskId: task.id,
                taskTitle: task.title,
                taskStatus: task.status,
                timestamp: new Date().toISOString()
              });
              
              // 🎯 BOB v3.2.4: Enhanced Activity Tracking
              await trackClick({
                elementId: 'task-edit-btn',
                elementType: 'edit',
                entityId: task.id,
                entityType: 'task',
                entityTitle: task.title,
                additionalData: {
                  taskStatus: task.status,
                  taskPriority: task.priority,
                  action: 'edit_button_clicked'
                }
              });
              
              showSidebar(task, 'task');
            }}
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
            title="Edit task"
          >
            Edit
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
            title="Delete task"
          >
            Delete
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
  defaultColumns: defaultColumnKeys,
  compact = false,
}) => {
  const { trackClick } = useActivityTracking();
  
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Convert tasks to table rows with sort order
  const tableRows: TaskTableRow[] = tasks.map((task, index) => ({
    ...task,
    sortOrder: index,
  }));

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

  const toggleColumn = (key: string) => {
    setColumns(prev => 
      prev.map(col => 
        col.key === key ? { ...col, visible: !col.visible } : col
      )
    );
  };

  const visibleColumnsCount = columns.filter(col => col.visible).length;

  return (
    <div style={{ 
      position: 'relative', 
      backgroundColor: 'white', 
      borderRadius: '8px', 
      border: '1px solid #e5e7eb', 
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      overflow: 'hidden' 
    }}>
      {/* Header with controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#f9fafb',
      }}>
        <div>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: 0, 
            marginBottom: '4px' 
          }}>
            Tasks
          </h3>
          <p style={{ 
            fontSize: '14px', 
            color: '#6b7280', 
            margin: 0 
          }}>
            {tasks.length} tasks • {visibleColumnsCount} columns visible
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
            backgroundColor: showConfig ? '#dbeafe' : 'white',
            color: showConfig ? '#1e40af' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (!showConfig) {
              e.currentTarget.style.backgroundColor = '#f9fafb';
            }
          }}
          onMouseLeave={(e) => {
            if (!showConfig) {
              e.currentTarget.style.backgroundColor = 'white';
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
                borderBottom: '1px solid #e5e7eb' 
              }}>
                <tr>
                  <th style={{
                    padding: '12px 8px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderRight: '1px solid #f3f4f6',
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
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderRight: '1px solid #f3f4f6',
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
                    color: '#6b7280',
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
                      onTaskUpdate={onTaskUpdate}
                      onTaskDelete={onTaskDelete}
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
          backgroundColor: 'white',
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
                    color: '#111827',
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
                          <span style={{ fontSize: '14px', color: '#111827' }}>{column.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {column.visible ? (
                            <Eye size={14} style={{ color: '#9ca3af' }} />
                          ) : (
                            <EyeOff size={14} style={{ color: '#9ca3af' }} />
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
                    color: '#111827',
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
                        color: '#111827', 
                        margin: '0 0 8px 0' 
                      }}>
                        Text Wrapping
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: '#6b7280', 
                        margin: '0 0 8px 0',
                        lineHeight: '1.4',
                      }}>
                        Table cells automatically wrap text for better readability with proper line height and spacing
                      </p>
                      <div style={{ 
                        width: '100%', 
                        height: '8px', 
                        backgroundColor: '#dcfce7', 
                        borderRadius: '4px' 
                      }}>
                        <div style={{ 
                          height: '8px', 
                          backgroundColor: '#16a34a', 
                          borderRadius: '4px',
                          width: '100%',
                        }}></div>
                      </div>
                    </div>
                    
                    <div style={{
                      padding: '12px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: '#111827', 
                        margin: '0 0 8px 0' 
                      }}>
                        Inline Editing
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: '#6b7280', 
                        margin: 0,
                        lineHeight: '1.4',
                      }}>
                        Click any editable cell to modify values directly in the table with modern form controls
                      </p>
                    </div>

                    <div style={{
                      padding: '12px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '8px',
                    }}>
                      <h4 style={{ 
                        fontSize: '14px', 
                        fontWeight: '500', 
                        color: '#111827', 
                        margin: '0 0 8px 0' 
                      }}>
                        Modern Actions
                      </h4>
                      <p style={{ 
                        fontSize: '12px', 
                        color: '#6b7280', 
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
  );
};

export default ModernTaskTable;

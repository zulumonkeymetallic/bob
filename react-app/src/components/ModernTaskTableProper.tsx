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
import { themeVars, rgbaCard } from '../utils/themeVars';

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
}

const defaultColumns: Column[] = [
  { 
    key: 'title', 
    label: 'Title', 
    width: '25%', 
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
    options: ['0','1','2','3']
  },
  { 
    key: 'priority', 
    label: 'Priority', 
    width: '10%', 
    visible: true, 
    editable: true, 
    type: 'select',
    options: ['1','2','3']
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
    let updates: Partial<Task>;
    if (key === 'status') {
      const next = Number(editValue);
      updates = { status: Number.isFinite(next) ? (next as any) : (editValue as any) } as any;
    } else if (key === 'priority') {
      const next = Number(editValue);
      updates = { priority: Number.isFinite(next) ? (next as any) : (editValue as any) } as any;
    } else if (key === 'dueDate') {
      updates = { dueDate: editValue ? new Date(editValue).getTime() : null } as any;
    } else {
      updates = { [key]: editValue } as any;
    }
    await onTaskUpdate(task.id, updates);
    setEditingCell(null);
  };

  const formatValue = (key: string, value: any): string => {
    if (key === 'dueDate' && typeof value === 'number') {
      return new Date(value).toLocaleDateString();
    }
    return value || '';
  };

  const renderCell = (column: Column) => {
    const value = task[column.key as keyof TaskTableRow];
    const isEditing = editingCell === column.key;

    if (isEditing && column.editable) {
      if (column.type === 'select') {
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
                    <option value={'1'}>High</option>
                    <option value={'2'}>Medium</option>
                    <option value={'3'}>Low</option>
                  </>
                ) : (
                  (column.options || []).map(option => (
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
                border: `1px solid ${themeVars.brand}`,
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: themeVars.panel,
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
          color: themeVars.text as string,
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
    <tr
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: themeVars.panel as string,
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
          e.currentTarget.style.backgroundColor = themeVars.panel as string;
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
          <button
            onClick={() => {/* Handle edit modal */}}
            style={{
              color: themeVars.brand as string,
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
              e.currentTarget.style.backgroundColor = rgbaCard(0.2);
              e.currentTarget.style.color = themeVars.brand as string;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = themeVars.brand as string;
            }}
            title="Edit task"
          >
            Edit
          </button>
          <button
            onClick={() => onTaskDelete(task.id)}
            style={{
              color: 'var(--red)',
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
              e.currentTarget.style.backgroundColor = rgbaCard(0.15);
              e.currentTarget.style.color = 'var(--red)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--red)';
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
}) => {
  const [columns, setColumns] = useState<Column[]>(defaultColumns);
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

    if (over && active.id !== over.id) {
      const newIndex = tableRows.findIndex(item => item.id === over.id);
      
      // Update priority based on new position (1-indexed)
      await onTaskPriorityChange(active.id as string, newIndex + 1);
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
  );
};

export default ModernTaskTable;

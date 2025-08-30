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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, Story, Goal, Sprint } from '../types';

interface TaskTableRow extends Omit<Task, 'priority'> {
  storyTitle?: string;
  goalTitle?: string;
  sprintName?: string;
  theme?: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  priority: 'low' | 'med' | 'high';
  sortOrder: number;
}

interface Column {
  key: string;
  label: string;
  width?: string;
  visible: boolean;
  editable: boolean;
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
  { key: 'title', label: 'Title', width: '25%', visible: true, editable: true },
  { key: 'description', label: 'Description', width: '30%', visible: true, editable: true },
  { key: 'status', label: 'Status', width: '12%', visible: true, editable: true },
  { key: 'priority', label: 'Priority', width: '10%', visible: true, editable: true },
  { key: 'effort', label: 'Effort', width: '8%', visible: true, editable: true },
  { key: 'dueDate', label: 'Due Date', width: '15%', visible: true, editable: true },
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
    backgroundColor: '#fff',
    borderBottom: '1px solid #e5e5e5',
  };

  const handleCellEdit = (key: string, value: string) => {
    setEditingCell(key);
    setEditValue(value || '');
  };

  const handleCellSave = async (key: string) => {
    const updates: Partial<Task> = { [key]: editValue };
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

    const cellStyle = {
      padding: '12px 8px',
      borderRight: '1px solid #f0f0f0',
      verticalAlign: 'top' as const,
      width: column.width,
      position: 'relative' as const,
    };

    if (isEditing && column.editable) {
      return (
        <td key={column.key} style={cellStyle}>
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => handleCellSave(column.key)}
            onKeyPress={(e) => e.key === 'Enter' && handleCellSave(column.key)}
            style={{
              width: '100%',
              border: '1px solid #007bff',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '14px',
            }}
            autoFocus
          />
        </td>
      );
    }

    return (
      <td 
        key={column.key} 
        style={cellStyle}
        onClick={() => column.editable && handleCellEdit(column.key, formatValue(column.key, value))}
      >
        <div style={{
          cursor: column.editable ? 'pointer' : 'default',
          minHeight: '20px',
          fontSize: '14px',
          color: '#333',
        }}>
          {formatValue(column.key, value)}
        </div>
      </td>
    );
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      {...attributes}
    >
      <td style={{
        padding: '12px 8px',
        borderRight: '1px solid #f0f0f0',
        width: '40px',
        textAlign: 'center',
        cursor: 'grab',
      }}
      {...listeners}
      >
        <div style={{
          fontSize: '18px',
          color: '#666',
          userSelect: 'none',
        }}>
          ⋮⋮
        </div>
      </td>
      {columns.filter(col => col.visible).map(renderCell)}
      <td style={{
        padding: '12px 8px',
        width: '60px',
        textAlign: 'center',
      }}>
        <button
          onClick={() => onTaskDelete(task.id)}
          style={{
            background: 'none',
            border: 'none',
            color: '#dc3545',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '4px',
          }}
          title="Delete task"
        >
          🗑️
        </button>
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Convert tasks to table rows with sort order
  const tableRows: TaskTableRow[] = tasks.map((task, index) => ({
    ...task,
    priority: task.priority as 'low' | 'med' | 'high',
    sortOrder: index,
  }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tableRows.findIndex(item => item.id === active.id);
      const newIndex = tableRows.findIndex(item => item.id === over.id);
      
      const newRows = arrayMove(tableRows, oldIndex, newIndex);
      
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

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse' as const,
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    borderRadius: '8px',
    overflow: 'hidden',
  };

  const headerStyle = {
    backgroundColor: '#f8f9fa',
    borderBottom: '2px solid #e5e5e5',
  };

  const headerCellStyle = {
    padding: '16px 8px',
    textAlign: 'left' as const,
    fontWeight: '600' as const,
    fontSize: '14px',
    color: '#495057',
    borderRight: '1px solid #e5e5e5',
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Configuration Panel */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: showConfig ? 0 : '-300px',
        width: '280px',
        height: '100%',
        backgroundColor: '#fff',
        borderLeft: '1px solid #e5e5e5',
        boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
        transition: 'right 0.3s ease',
        zIndex: 10,
        padding: '20px',
      }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>
          Configure Columns
        </h3>
        {columns.map(column => (
          <div key={column.key} style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '12px',
            padding: '8px',
            backgroundColor: column.visible ? '#f8f9fa' : '#fff',
            borderRadius: '4px',
            border: '1px solid #e5e5e5',
          }}>
            <input
              type="checkbox"
              checked={column.visible}
              onChange={() => toggleColumn(column.key)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px' }}>{column.label}</span>
          </div>
        ))}
      </div>

      {/* Configuration Toggle Button */}
      <button
        onClick={() => setShowConfig(!showConfig)}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 20,
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        ⚙️ {showConfig ? 'Hide' : 'Show'} Config
      </button>

      {/* Main Table */}
      <div style={{ marginRight: showConfig ? '300px' : '0', transition: 'margin-right 0.3s ease' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table style={tableStyle}>
            <thead style={headerStyle}>
              <tr>
                <th style={{ ...headerCellStyle, width: '40px' }}>⋮⋮</th>
                {columns.filter(col => col.visible).map(column => (
                  <th key={column.key} style={{ ...headerCellStyle, width: column.width }}>
                    {column.label}
                  </th>
                ))}
                <th style={{ ...headerCellStyle, width: '60px' }}>Actions</th>
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
    </div>
  );
};

export default ModernTaskTable;

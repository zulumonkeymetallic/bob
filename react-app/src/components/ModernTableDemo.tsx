import React, { useState } from 'react';
import ModernTaskTable from './ModernTaskTable';
import { Task } from '../types';
import { useTheme } from '../contexts/ModernThemeContext';

// Sample data for testing
const sampleTasks: Task[] = [
  {
    id: '1',
    ref: 'TSK-001',
    persona: 'personal',
    parentType: 'story',
    parentId: 'story-1',
    title: 'Fix drag and drop functionality',
    description: 'Implement proper drag and drop using @dnd-kit',
    status: 1, // 'in-progress' -> 1
    priority: 1, // 'high' -> 1  
    effort: 'L',
    estimateMin: 120,
    dueDate: Date.now() + 86400000 * 15, // 15 days from now
    alignedToGoal: true,
    theme: 2, // 'Growth' -> 2
    source: 'web',
    aiLinkConfidence: 0.9,
    hasGoal: true,
    syncState: 'clean',
    serverUpdatedAt: Date.now(),
    createdBy: 'user1',
    ownerUid: 'user1',
    labels: ['frontend', 'ux']
  },
  {
    id: '2',
    ref: 'TSK-002',
    persona: 'personal',
    parentType: 'story',
    parentId: 'story-1',
    title: 'Add inline editing capabilities',
    description: 'Allow users to edit tasks directly in the table',
    status: 0, // 'todo' -> 0
    priority: 2, // 'med' -> 2
    effort: 'M',
    estimateMin: 90,
    dueDate: Date.now() + 86400000 * 20, // 20 days from now
    alignedToGoal: true,
    theme: 2, // 'Growth' -> 2
    source: 'web',
    aiLinkConfidence: 0.8,
    hasGoal: true,
    syncState: 'clean',
    serverUpdatedAt: Date.now(),
    createdBy: 'user1',
    ownerUid: 'user1',
    labels: ['frontend', 'editing']
  },
  {
    id: '3',
    ref: 'TSK-003',
    persona: 'personal',
    parentType: 'story',
    parentId: 'story-1',
    title: 'Implement configurable columns',
    description: 'Let users customize which columns are visible',
    status: 0, // 'todo' -> 0
    priority: 2, // 'med' -> 2
    effort: 'M',
    estimateMin: 60,
    dueDate: Date.now() + 86400000 * 25, // 25 days from now
    alignedToGoal: true,
    theme: 2, // 'Growth' -> 2
    source: 'web',
    aiLinkConfidence: 0.7,
    hasGoal: true,
    syncState: 'clean',
    serverUpdatedAt: Date.now(),
    createdBy: 'user1',
    ownerUid: 'user1',
    labels: ['frontend', 'customization']
  },
  {
    id: '4',
    ref: 'TSK-004',
    persona: 'personal',
    parentType: 'story',
    parentId: 'story-2',
    title: 'Add responsive design',
    description: 'Ensure table works well on mobile devices',
    status: 0, // 'todo' -> 0
    priority: 3, // 'low' -> 3
    effort: 'S',
    estimateMin: 45,
    dueDate: Date.now() + 86400000 * 31, // 31 days from now
    alignedToGoal: true,
    theme: 2, // 'Growth' -> 2
    source: 'web',
    aiLinkConfidence: 0.6,
    hasGoal: true,
    syncState: 'clean',
    serverUpdatedAt: Date.now(),
    createdBy: 'user1',
    ownerUid: 'user1',
    labels: ['responsive', 'mobile']
  },
  {
    id: '5',
    ref: 'TSK-005',
    persona: 'personal',
    parentType: 'story',
    parentId: 'story-2',
    title: 'Performance optimization',
    description: 'Optimize table rendering for large datasets',
    status: 0, // 'todo' -> 0
    priority: 3, // 'low' -> 3
    effort: 'L',
    estimateMin: 180,
    dueDate: Date.now() + 86400000 * 45, // 45 days from now
    alignedToGoal: false,
    theme: 2, // 'Growth' -> 2
    source: 'web',
    aiLinkConfidence: 0.5,
    hasGoal: false,
    syncState: 'clean',
    serverUpdatedAt: Date.now(),
    createdBy: 'user1',
    ownerUid: 'user1',
    labels: ['performance', 'optimization']
  }
];

const ModernTableDemo: React.FC = () => {
  const { theme } = useTheme();
  const [tasks, setTasks] = useState<Task[]>(sampleTasks);

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>): Promise<void> => {
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === taskId ? { ...task, ...updates, serverUpdatedAt: Date.now() } : task
      )
    );
  };

  const handleTaskDelete = async (taskId: string): Promise<void> => {
    setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));
  };

    const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    // In a real app, this would be an API call
    console.log(`Updating task ${taskId} priority to ${newPriority}`);
    
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === taskId ? { ...task, priority: newPriority, serverUpdatedAt: Date.now() } : task
      )
    );
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f5f5f5', 
      padding: '24px' 
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ 
            fontSize: '2rem', 
            fontWeight: 'bold', 
            color: '#333', 
            marginBottom: '8px' 
          }}>
            Modern Task Table Demo
          </h1>
          <p style={{ color: '#666', fontSize: '1rem' }}>
            Interactive table with drag-and-drop priority reordering, inline editing, and configurable columns
          </p>
        </div>

        <div style={{ 
          backgroundColor: theme.colors.surface, 
          borderRadius: '8px', 
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)', 
          padding: '24px',
          marginBottom: '32px' 
        }}>
          <ModernTaskTable
            tasks={tasks}
            stories={[]}
            goals={[]}
            sprints={[]}
            onTaskUpdate={handleTaskUpdate}
            onTaskDelete={handleTaskDelete}
            onTaskPriorityChange={handleTaskPriorityChange}
          />
        </div>

        <div style={{ 
          backgroundColor: theme.colors.surface, 
          borderRadius: '8px', 
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)', 
          padding: '24px' 
        }}>
          <h2 style={{ 
            fontSize: '1.25rem', 
            fontWeight: '600', 
            color: '#333', 
            marginBottom: '16px' 
          }}>
            Features Demonstrated
          </h2>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
            gap: '16px' 
          }}>
            <div style={{ padding: '16px', backgroundColor: theme.colors.background, borderRadius: '6px' }}>
              <h3 style={{ fontWeight: '500', color: '#333', marginBottom: '8px' }}>
                ✨ Drag & Drop
              </h3>
              <p style={{ color: '#666', fontSize: '0.875rem', margin: 0 }}>
                Drag rows to reorder task priorities
              </p>
            </div>
            <div style={{ padding: '16px', backgroundColor: theme.colors.background, borderRadius: '6px' }}>
              <h3 style={{ fontWeight: '500', color: '#333', marginBottom: '8px' }}>
                ✏️ Inline Editing
              </h3>
              <p style={{ color: '#666', fontSize: '0.875rem', margin: 0 }}>
                Click cells to edit values directly
              </p>
            </div>
            <div style={{ padding: '16px', backgroundColor: theme.colors.background, borderRadius: '6px' }}>
              <h3 style={{ fontWeight: '500', color: '#333', marginBottom: '8px' }}>
                ⚙️ Configurable Columns
              </h3>
              <p style={{ color: '#666', fontSize: '0.875rem', margin: 0 }}>
                Show/hide columns using the settings panel
              </p>
            </div>
            <div style={{ padding: '16px', backgroundColor: theme.colors.background, borderRadius: '6px' }}>
              <h3 style={{ fontWeight: '500', color: '#333', marginBottom: '8px' }}>
                🎨 Modern Design
              </h3>
              <p style={{ color: '#666', fontSize: '0.875rem', margin: 0 }}>
                Clean modern styling with accessibility
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModernTableDemo;

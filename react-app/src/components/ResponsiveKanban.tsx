import React, { useEffect } from 'react';
import ModernKanbanBoard from './ModernKanbanBoard';
import { Story, Task } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useTheme } from '../contexts/ModernThemeContext';

const ResponsiveKanban: React.FC = () => {
  const { theme } = useTheme();
  const { showSidebar, setUpdateHandler } = useSidebar();

  // Set up the update handler for the global sidebar
  useEffect(() => {
    const handleItemUpdate = async (item: Story | Task, type: 'story' | 'task', updates: any) => {
      try {
        const collection_name = type === 'story' ? 'stories' : 'tasks';
        await updateDoc(doc(db, collection_name, item.id), {
          ...updates,
          updatedAt: serverTimestamp()
        });
        console.log(`${type} updated successfully`);
      } catch (error) {
        console.error('Error updating item:', error);
        throw error;
      }
    };

    setUpdateHandler(handleItemUpdate);
  }, [setUpdateHandler]);

  const handleItemSelect = (item: Story | Task, type: 'story' | 'task') => {
    showSidebar(item, type);
  };

  return (
    <div style={{ position: 'relative' }}>
      <ModernKanbanBoard onItemSelect={handleItemSelect} />
    </div>
  );
};

export default ResponsiveKanban;

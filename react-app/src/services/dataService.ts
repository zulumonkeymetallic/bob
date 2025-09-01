import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { isStatus, isTheme } from '../utils/statusHelpers';

export interface ProjectStats {
  totalCriticalDefects: number;
  completedCriticalDefects: number;
  criticalCompletionRate: number;
  totalWeekendItems: number;
  completedWeekendItems: number;
  weekendCompletionRate: number;
  recentUpdates: string[];
  nextPriorities: string[];
}

export interface DefectInfo {
  id: string;
  title: string;
  impact: string;
  estimate: string;
  status: 'COMPLETE' | 'IN PROGRESS' | 'TODO';
}

// Parse PROJECT_STATUS.md content to extract statistics
export const parseProjectStatus = (content: string): ProjectStats => {
  const lines = content.split('\n');
  
  // Count critical defects
  const criticalSection = lines.findIndex(line => line.includes('CRITICAL DEFECTS'));
  const criticalDefects: DefectInfo[] = [];
  
  if (criticalSection !== -1) {
    for (let i = criticalSection; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('| **C') && line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 5) {
          const id = parts[1].replace(/\*\*/g, '');
          const title = parts[2];
          const impact = parts[3];
          const estimate = parts[4];
          const statusText = parts[5];
          
          let status: 'COMPLETE' | 'IN PROGRESS' | 'TODO' = 'TODO';
          if (statusText.includes('✅') || statusText.includes('COMPLETE')) {
            status = 'COMPLETE';
          } else if (statusText.includes('🟡') || statusText.includes('IN PROGRESS')) {
            status = 'IN PROGRESS';
          }
          
          criticalDefects.push({ id, title, impact, estimate, status });
        }
      }
      
      // Stop when we hit the next section
      if (line.includes('##') && i > criticalSection + 1) break;
    }
  }
  
  // Count weekend items
  const weekendSection = lines.findIndex(line => line.includes('WEEKEND PRIORITIES'));
  const weekendItems: { id: string; status: string }[] = [];
  
  if (weekendSection !== -1) {
    for (let i = weekendSection; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('- **W') || line.includes('- **C')) {
        const status = line.includes('✅') ? 'COMPLETE' : 
                     line.includes('🟡') ? 'IN PROGRESS' : 'TODO';
        const id = line.match(/\*\*(W\d+[a-z]?|C\d+)\*\*/)?.[1] || '';
        weekendItems.push({ id, status });
      }
      
      // Stop when we hit the next section
      if (line.includes('###') && i > weekendSection + 1) break;
    }
  }
  
  // Extract recent updates (completed items)
  const recentUpdates = criticalDefects
    .filter(d => d.status === 'COMPLETE')
    .slice(-5)
    .map(d => `${d.id}: ${d.title}`);
  
  // Extract next priorities (TODO items)
  const nextPriorities = criticalDefects
    .filter(d => d.status === 'TODO' || d.status === 'IN PROGRESS')
    .slice(0, 3)
    .map(d => `${d.id}: ${d.title}`);
  
  const completedCritical = criticalDefects.filter(d => d.status === 'COMPLETE').length;
  const completedWeekend = weekendItems.filter(w => w.status === 'COMPLETE').length;
  
  return {
    totalCriticalDefects: criticalDefects.length,
    completedCriticalDefects: completedCritical,
    criticalCompletionRate: criticalDefects.length > 0 ? (completedCritical / criticalDefects.length) * 100 : 0,
    totalWeekendItems: weekendItems.length,
    completedWeekendItems: completedWeekend,
    weekendCompletionRate: weekendItems.length > 0 ? (completedWeekend / weekendItems.length) * 100 : 0,
    recentUpdates,
    nextPriorities
  };
};

// Fetch project status from GitHub (if available) or return mock data
export const fetchProjectStatus = async (): Promise<ProjectStats> => {
  try {
    // Try to fetch from the GitHub raw content
    const response = await fetch('https://raw.githubusercontent.com/zulumonkeymetallic/bob/react-ui/PROJECT_STATUS.md');
    
    if (response.ok) {
      const content = await response.text();
      return parseProjectStatus(content);
    }
  } catch (error) {
    console.log('Could not fetch from GitHub, using mock data');
  }
  
  // Fallback to current known status (from our recent work)
  return {
    totalCriticalDefects: 16,
    completedCriticalDefects: 14,
    criticalCompletionRate: 87.5,
    totalWeekendItems: 20,
    completedWeekendItems: 15,
    weekendCompletionRate: 75.0,
    recentUpdates: [
      'C14: Edit buttons missing - COMPLETE',
      'C15: Story completion with open tasks - COMPLETE', 
      'C16: Remove unwanted arrow buttons - COMPLETE',
      'C11: Story completion system failure - COMPLETE',
      'C10: Calendar integration crashes - COMPLETE'
    ],
    nextPriorities: [
      'C12: Dev tracking dashboard outdated counts',
      'C13: Drag & Drop not working (testing)',
      'W13: Gantt Chart View implementation'
    ]
  };
};

// Get Stories data
export const getStoriesData = async (userUid: string) => {
  const q = query(collection(db, 'stories'), where('ownerUid', '==', userUid));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Get Goals data  
export const getGoalsData = async (userUid: string) => {
  const q = query(collection(db, 'goals'), where('ownerUid', '==', userUid));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Get Tasks data
export const getTasksData = async (userUid: string) => {
  const q = query(collection(db, 'tasks'), where('ownerUid', '==', userUid));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// DELETE FUNCTIONS - ADDED FOR C20 FIX

// Delete a Goal
export const deleteGoal = async (goalId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'goals', goalId));
    console.log('Goal deleted successfully:', goalId);
  } catch (error) {
    console.error('Error deleting goal:', error);
    throw new Error(`Failed to delete goal: ${error.message}`);
  }
};

// Delete a Story  
export const deleteStory = async (storyId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'stories', storyId));
    console.log('Story deleted successfully:', storyId);
  } catch (error) {
    console.error('Error deleting story:', error);
    throw new Error(`Failed to delete story: ${error.message}`);
  }
};

// Delete a Task
export const deleteTask = async (taskId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
    console.log('Task deleted successfully:', taskId);
  } catch (error) {
    console.error('Error deleting task:', error);
    throw new Error(`Failed to delete task: ${error.message}`);
  }
};

// Delete multiple items (for bulk operations)
export const deleteBulkItems = async (
  itemType: 'goals' | 'stories' | 'tasks', 
  itemIds: string[]
): Promise<void> => {
  try {
    const deletePromises = itemIds.map(id => deleteDoc(doc(db, itemType, id)));
    await Promise.all(deletePromises);
    console.log(`Bulk deleted ${itemIds.length} ${itemType}:`, itemIds);
  } catch (error) {
    console.error(`Error bulk deleting ${itemType}:`, error);
    throw new Error(`Failed to bulk delete ${itemType}: ${error.message}`);
  }
};
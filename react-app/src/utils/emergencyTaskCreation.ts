import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface TaskCreationOptions {
  maxRetries?: number;
  retryDelay?: number;
  fallbackMethod?: boolean;
}

export const emergencyCreateTask = async (
  taskData: any, 
  userId: string, 
  options: TaskCreationOptions = {}
) => {
  const { maxRetries = 3, retryDelay = 1000, fallbackMethod = true } = options;
  
  let lastError: Error | null = null;
  
  // Method 1: Standard addDoc with retry
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Task creation attempt ${attempt}/${maxRetries}`);
      
      const docRef = await addDoc(collection(db, 'tasks'), {
        ...taskData,
        userId,
        ownerUid: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        emergencyCreated: true,
        creationMethod: 'standard',
        attempt
      });
      
      console.log('✅ Task created successfully with ID:', docRef.id);
      return { success: true, id: docRef.id, method: 'standard', attempt };
      
    } catch (error: any) {
      lastError = error;
      console.warn(`❌ Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }
  
  // Method 2: Fallback with custom document ID
  if (fallbackMethod) {
    try {
      console.log('🆘 Attempting fallback task creation method...');
      
      const customId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const taskRef = doc(db, 'tasks', customId);
      
      await setDoc(taskRef, {
        ...taskData,
        userId,
        ownerUid: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        emergencyCreated: true,
        creationMethod: 'fallback',
        customId
      });
      
      console.log('✅ Task created via fallback method with ID:', customId);
      return { success: true, id: customId, method: 'fallback', attempt: 'fallback' };
      
    } catch (fallbackError: any) {
      console.error('❌ Fallback creation failed:', fallbackError);
      lastError = fallbackError;
    }
  }
  
  // Method 3: Local storage backup (last resort)
  try {
    const localTasks = JSON.parse(localStorage.getItem('emergency_tasks') || '[]');
    const localTask = {
      ...taskData,
      id: `local_${Date.now()}`,
      userId,
      createdAt: new Date().toISOString(),
      emergencyCreated: true,
      creationMethod: 'localStorage',
      needsSync: true
    };
    
    localTasks.push(localTask);
    localStorage.setItem('emergency_tasks', JSON.stringify(localTasks));
    
    console.log('💾 Task saved to localStorage for later sync:', localTask.id);
    return { 
      success: true, 
      id: localTask.id, 
      method: 'localStorage', 
      needsSync: true,
      warning: 'Task saved locally - will sync when connection is stable'
    };
    
  } catch (localError: any) {
    console.error('💥 All task creation methods failed:', localError);
  }
  
  return { 
    success: false, 
    error: lastError?.message || 'Unknown error',
    allMethodsFailed: true
  };
};

// Sync local tasks when connection is restored
export const syncEmergencyTasks = async (userId: string) => {
  try {
    const localTasks = JSON.parse(localStorage.getItem('emergency_tasks') || '[]');
    const unsynced = localTasks.filter((task: any) => task.needsSync && task.userId === userId);
    
    if (unsynced.length === 0) return { synced: 0 };
    
    console.log(`🔄 Syncing ${unsynced.length} emergency tasks...`);
    
    const results = await Promise.allSettled(
      unsynced.map(async (task: any) => {
        const { id, needsSync, ...taskData } = task;
        return await addDoc(collection(db, 'tasks'), {
          ...taskData,
          ownerUid: userId,
          syncedAt: new Date(),
          originalLocalId: id
        });
      })
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    // Remove synced tasks from localStorage
    const remaining = localTasks.filter((task: any) => 
      !(task.needsSync && task.userId === userId)
    );
    localStorage.setItem('emergency_tasks', JSON.stringify(remaining));
    
    console.log(`✅ Synced ${successful}/${unsynced.length} emergency tasks`);
    return { synced: successful, failed: unsynced.length - successful };
    
  } catch (error) {
    console.error('❌ Emergency task sync failed:', error);
    return { synced: 0, error: error };
  }
};

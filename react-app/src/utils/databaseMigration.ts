import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { ChoiceMigration } from '../config/migration';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';

export class DatabaseMigration {
  
  /**
   * Migrate all existing data from string choices to integer choices
   * This should be run once during deployment to convert existing data
   */
  static async migrateAllData(userId: string, personaId: string): Promise<void> {
    console.log('Starting database migration from string to integer choice values...');
    
    try {
      // Migrate Goals
      await this.migrateCollection('goals', userId, personaId, ChoiceMigration.migrateGoal);
      
      // Migrate Stories  
      await this.migrateCollection('stories', userId, personaId, ChoiceMigration.migrateStory);
      
      // Migrate Tasks
      await this.migrateCollection('tasks', userId, personaId, ChoiceMigration.migrateTask);
      
      // Migrate Sprints
      await this.migrateCollection('sprints', userId, personaId, ChoiceMigration.migrateSprint);
      
      console.log('Database migration completed successfully!');
      
    } catch (error) {
      console.error('Database migration failed:', error);
      throw error;
    }
  }
  
  private static async migrateCollection(
    collectionName: string, 
    userId: string, 
    personaId: string,
    migrationFn: (item: any) => any
  ): Promise<void> {
    console.log(`Migrating ${collectionName}...`);
    
    const collectionRef = collection(db, collectionName);
    const snapshot = await getDocs(collectionRef);
    
    const updatePromises = snapshot.docs.map(async (docSnapshot) => {
      const data = docSnapshot.data();
      
      // Only migrate data that belongs to this user/persona
      if (data.userId === userId && data.personaId === personaId) {
        const migratedData = migrationFn(data);
        
        // Only update if data actually changed
        if (JSON.stringify(data) !== JSON.stringify(migratedData)) {
          const docRef = doc(db, collectionName, docSnapshot.id);
          await updateDoc(docRef, migratedData);
          console.log(`Migrated ${collectionName} document: ${docSnapshot.id}`);
        }
      }
    });
    
    await Promise.all(updatePromises);
    console.log(`Completed migration of ${collectionName}`);
  }
  
  /**
   * Check if migration is needed by looking for string values in the data
   */
  static async checkMigrationNeeded(userId: string, personaId: string): Promise<boolean> {
    try {
      // Check Goals for string status values
      const goalsRef = collection(db, 'goals');
      const goalsSnapshot = await getDocs(goalsRef);
      
      for (const doc of goalsSnapshot.docs) {
        const data = doc.data();
        if (data.userId === userId && data.personaId === personaId) {
          if (typeof data.status === 'string' || typeof data.theme === 'string') {
            return true;
          }
        }
      }
      
      // Check Tasks for string values
      const tasksRef = collection(db, 'tasks');
      const tasksSnapshot = await getDocs(tasksRef);
      
      for (const doc of tasksSnapshot.docs) {
        const data = doc.data();
        if (data.userId === userId && data.personaId === personaId) {
          if (typeof data.status === 'string' || typeof data.priority === 'string' || typeof data.theme === 'string') {
            return true;
          }
        }
      }
      
      return false;
      
    } catch (error) {
      console.error('Error checking migration status:', error);
      return true; // Assume migration needed if check fails
    }
  }
}

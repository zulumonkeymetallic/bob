// Migration helper for converting string-based choice values to integers
// This ensures backwards compatibility during the transition

import { ChoiceHelper } from './choices';

export class ChoiceMigration {
  
  // Goal status migration
  static migrateGoalStatus(value: any): number {
    if (typeof value === 'number') return value; // Already migrated
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'new': 0,
      'work in progress': 1,
      'in progress': 1,
      'complete': 2,
      'completed': 2,
      'done': 2,
      'blocked': 3,
      'deferred': 4,
      'paused': 4 // Map old 'paused' to 'deferred'
    };
    
    return mapping[stringValue] ?? 0; // Default to 'New'
  }

  // Goal theme migration
  static migrateGoalTheme(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'general': 0,
      'health': 1,
      'health & fitness': 1,
      'health and fitness': 1,
      'fitness': 1,
      'career': 2,
      'professional': 2,
      'career & professional': 2,
      'career and professional': 2,
      'finance': 3,
      'wealth': 3,
      'finance & wealth': 3,
      'finance and wealth': 3,
      'learning': 4,
      'education': 4,
      'learning & education': 4,
      'learning and education': 4,
      'family': 5,
      'relationships': 5,
      'family & relationships': 5,
      'family and relationships': 5,
      'tribe': 5,
      'hobbies': 6,
      'hobby': 6,
      'interests': 6,
      'hobbies & interests': 6,
      'hobbies and interests': 6,
      'travel': 7,
      'adventure': 7,
      'travel & adventure': 7,
      'travel and adventure': 7,
      'home': 8,
      'home & living': 8,
      'home and living': 8,
      'growth': 9,
      'spiritual': 9,
      'spiritual & personal growth': 9,
      'spiritual and personal growth': 9,
      'personal growth': 9,
      'chores': 10,
      'rest': 11,
      'recovery': 11,
      'rest & recovery': 11,
      'rest and recovery': 11,
      'work': 12,
      'work (main gig)': 12,
      'main gig': 12,
      'side gig': 15,
      'side-gig': 15,
      'sidegig': 15,
      'sleep': 13,
      'random': 14
    };
    
    return mapping[stringValue] ?? 1; // Default to 'Health'
  }

  // Goal size migration
  static migrateGoalSize(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'xs': 1,
      'small': 1,
      's': 1,
      'm': 2,
      'medium': 2,
      'l': 3,
      'large': 3,
      'xl': 3
    };
    
    return mapping[stringValue] ?? 2; // Default to 'Medium'
  }

  // Goal confidence migration
  static migrateGoalConfidence(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'low': 1,
      'medium': 2,
      'high': 3,
      'very high': 3
    };
    
    return mapping[stringValue] ?? 2; // Default to 'Medium'
  }

  // Story status migration
  static migrateStoryStatus(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'backlog': 0,
      'draft': 0,
      'planned': 1,
      'active': 2,
      'in progress': 2,
      'in-progress': 2,
      'testing': 3,
      'review': 3,
      'done': 4,
      'complete': 4,
      'completed': 4,
      'defect': 0 // Map defects back to backlog
    };
    
    return mapping[stringValue] ?? 0; // Default to 'Backlog'
  }

  // Story priority migration
  static migrateStoryPriority(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'p0': 4,
      'critical': 4,
      'urgent': 4,
      'p1': 4,
      'high': 3,
      'p2': 3,
      'medium': 2,
      'med': 2,
      'normal': 2,
      'p3': 2,
      'low': 1,
      'p4': 1
    };
    
    return mapping[stringValue] ?? 3; // Default to 'P3'
  }

  // Task status migration
  static migrateTaskStatus(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'todo': 0,
      'to do': 0,
      'planned': 0,
      'in-progress': 1,
      'in progress': 1,
      'active': 1,
      'done': 2,
      'complete': 2,
      'completed': 2,
      'blocked': 3
    };
    
    return mapping[stringValue] ?? 0; // Default to 'To Do'
  }

  // Task priority migration
  static migrateTaskPriority(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'high': 1,
      'critical': 1,
      'urgent': 1,
      'medium': 2,
      'med': 2,
      'normal': 2,
      'low': 3
    };
    
    return mapping[stringValue] ?? 2; // Default to 'Medium'
  }

  // Sprint status migration
  static migrateSprintStatus(value: any): number {
    if (typeof value === 'number') return value;
    
    const stringValue = String(value).toLowerCase();
    const mapping: Record<string, number> = {
      'planned': 0,
      'planning': 0,
      'active': 1,
      'in progress': 1,
      'complete': 2,
      'completed': 2,
      'closed': 2,
      'done': 2,
      'cancelled': 3,
      'canceled': 3
    };
    
    return mapping[stringValue] ?? 0; // Default to 'Planning'
  }

  // Pre-defined object migrations
  static migrateGoal(goal: any): any {
    const migrated = { ...goal };
    
    // Migrate status field
    if (goal.status !== undefined) {
      migrated.status = ChoiceMigration.migrateGoalStatus(goal.status);
    }
    
    // Migrate theme field
    if (goal.theme !== undefined) {
      migrated.theme = ChoiceMigration.migrateGoalTheme(goal.theme);
    }
    
    // Migrate size field
    if (goal.size !== undefined) {
      migrated.size = ChoiceMigration.migrateGoalSize(goal.size);
    }
    
    // Migrate confidence field
    if (goal.confidence !== undefined) {
      migrated.confidence = ChoiceMigration.migrateGoalConfidence(goal.confidence);
    }
    
    return migrated;
  }

  static migrateStory(story: any): any {
    const migrated = { ...story };
    
    // Migrate status field
    if (story.status !== undefined) {
      migrated.status = ChoiceMigration.migrateStoryStatus(story.status);
    }
    
    // Migrate priority field
    if (story.priority !== undefined) {
      migrated.priority = ChoiceMigration.migrateStoryPriority(story.priority);
    }
    
    // Migrate theme field (stories use goal theme)
    if (story.theme !== undefined) {
      migrated.theme = ChoiceMigration.migrateGoalTheme(story.theme);
    }
    
    return migrated;
  }

  static migrateTask(task: any): any {
    const migrated = { ...task };
    
    // Migrate status field
    if (task.status !== undefined) {
      migrated.status = ChoiceMigration.migrateTaskStatus(task.status);
    }
    
    // Migrate priority field
    if (task.priority !== undefined) {
      migrated.priority = ChoiceMigration.migrateTaskPriority(task.priority);
    }
    
    // Migrate theme field (tasks use goal theme)
    if (task.theme !== undefined) {
      migrated.theme = ChoiceMigration.migrateGoalTheme(task.theme);
    }
    
    return migrated;
  }

  static migrateSprint(sprint: any): any {
    const migrated = { ...sprint };
    
    // Migrate status field
    if (sprint.status !== undefined) {
      migrated.status = ChoiceMigration.migrateSprintStatus(sprint.status);
    }
    
    return migrated;
  }
}

export default ChoiceMigration;

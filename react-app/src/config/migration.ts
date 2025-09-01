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
      'health': 1,
      'growth': 2,
      'wealth': 3,
      'tribe': 4,
      'home': 5
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
      'p1': 1,
      'high': 1,
      'critical': 1,
      'p2': 2,
      'medium': 2,
      'med': 2,
      'normal': 2,
      'p3': 3,
      'low': 3
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
      migrated.status = this.migrateGoalStatus(goal.status);
    }
    
    // Migrate theme field
    if (goal.theme !== undefined) {
      migrated.theme = this.migrateGoalTheme(goal.theme);
    }
    
    // Migrate size field
    if (goal.size !== undefined) {
      migrated.size = this.migrateGoalSize(goal.size);
    }
    
    // Migrate confidence field
    if (goal.confidence !== undefined) {
      migrated.confidence = this.migrateGoalConfidence(goal.confidence);
    }
    
    return migrated;
  }

  static migrateStory(story: any): any {
    const migrated = { ...story };
    
    // Migrate status field
    if (story.status !== undefined) {
      migrated.status = this.migrateStoryStatus(story.status);
    }
    
    // Migrate priority field
    if (story.priority !== undefined) {
      migrated.priority = this.migrateStoryPriority(story.priority);
    }
    
    // Migrate theme field (stories use goal theme)
    if (story.theme !== undefined) {
      migrated.theme = this.migrateGoalTheme(story.theme);
    }
    
    return migrated;
  }

  static migrateTask(task: any): any {
    const migrated = { ...task };
    
    // Migrate status field
    if (task.status !== undefined) {
      migrated.status = this.migrateTaskStatus(task.status);
    }
    
    // Migrate priority field
    if (task.priority !== undefined) {
      migrated.priority = this.migrateTaskPriority(task.priority);
    }
    
    // Migrate theme field (tasks use goal theme)
    if (task.theme !== undefined) {
      migrated.theme = this.migrateGoalTheme(task.theme);
    }
    
    return migrated;
  }

  static migrateSprint(sprint: any): any {
    const migrated = { ...sprint };
    
    // Migrate status field
    if (sprint.status !== undefined) {
      migrated.status = this.migrateSprintStatus(sprint.status);
    }
    
    return migrated;
  }
}

export default ChoiceMigration;

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

  // Generic migration function
  static migrateChoiceValue(table: string, field: string, value: any): number {
    const methodName = `migrate${table.charAt(0).toUpperCase() + table.slice(1)}${field.charAt(0).toUpperCase() + field.slice(1)}`;
    
    // Try to call specific migration method
    if (typeof (this as any)[methodName] === 'function') {
      return (this as any)[methodName](value);
    }
    
    // Fallback: try to find by label
    if (typeof value === 'string') {
      const numericValue = ChoiceHelper.getValueByLabel(table, field, value);
      if (numericValue !== undefined) {
        return numericValue;
      }
    }
    
    // Last resort: return as-is if already a number, or 0
    return typeof value === 'number' ? value : 0;
  }

  // Migrate an entire object's choice fields
  static migrateObject(obj: any, fieldMappings: Record<string, {table: string, field: string}>): any {
    const migrated = { ...obj };
    
    for (const [objField, {table, field}] of Object.entries(fieldMappings)) {
      if (obj[objField] !== undefined) {
        migrated[objField] = this.migrateChoiceValue(table, field, obj[objField]);
      }
    }
    
    return migrated;
  }

  // Pre-defined object migrations
  static migrateGoal(goal: any): any {
    return this.migrateObject(goal, {
      status: { table: 'goal', field: 'status' },
      theme: { table: 'goal', field: 'theme' },
      size: { table: 'goal', field: 'size' }
    });
  }

  static migrateStory(story: any): any {
    return this.migrateObject(story, {
      status: { table: 'story', field: 'status' },
      priority: { table: 'story', field: 'priority' },
      theme: { table: 'goal', field: 'theme' }
    });
  }

  static migrateTask(task: any): any {
    return this.migrateObject(task, {
      status: { table: 'task', field: 'status' },
      priority: { table: 'task', field: 'priority' },
      theme: { table: 'goal', field: 'theme' }
    });
  }

  static migrateSprint(sprint: any): any {
    return this.migrateObject(sprint, {
      status: { table: 'sprint', field: 'status' }
    });
  }
}

export default ChoiceMigration;

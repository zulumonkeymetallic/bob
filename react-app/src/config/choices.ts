// BOB Choice Configuration - ServiceNow style sys_choice approach
// All database values stored as integers, labels configured here
import { themeVars } from '../utils/themeVars';
import { GLOBAL_THEMES } from '../constants/globalThemes';

export interface Choice {
  value: number;
  label: string;
  color?: string;
  description?: string;
}

export interface ChoiceTable {
  [table: string]: {
    [field: string]: Choice[];
  };
}

// Central choice configuration
export const CHOICES: ChoiceTable = {
  // Goal choices
  goal: {
    status: [
      { value: 0, label: 'New', color: themeVars.muted as string, description: 'Newly created goal' },
      { value: 1, label: 'Work in Progress', color: themeVars.brand as string, description: 'Actively being worked on' },
      { value: 2, label: 'Complete', color: 'var(--green)', description: 'Successfully completed' },
      { value: 3, label: 'Blocked', color: 'var(--red)', description: 'Blocked by external dependency' },
      { value: 4, label: 'Deferred', color: 'var(--orange)', description: 'Postponed to future sprint' }
    ],
    size: [
      { value: 1, label: 'Small', color: 'var(--green)', description: '1-2 weeks effort' },
      { value: 2, label: 'Medium', color: 'var(--orange)', description: '3-4 weeks effort' },
      { value: 3, label: 'Large', color: 'var(--red)', description: '5+ weeks effort' }
    ],
    confidence: [
      { value: 1, label: 'Low', color: 'var(--red)', description: 'High uncertainty' },
      { value: 2, label: 'Medium', color: 'var(--orange)', description: 'Some uncertainty' },
      { value: 3, label: 'High', color: 'var(--green)', description: 'Very confident' }
    ],
    theme: GLOBAL_THEMES.map(theme => ({
      value: theme.id,
      label: theme.label,
      color: theme.color,
      description: theme.description
    }))
  },

  // Story choices
  story: {
    status: [
      // Canonical lanes only: Backlog, In Progress, Done
      { value: 0, label: 'Backlog', color: themeVars.muted as string, description: 'Not yet planned' },
      { value: 2, label: 'In Progress', color: 'var(--orange)', description: 'Currently being worked' },
      { value: 4, label: 'Done', color: 'var(--green)', description: 'Completed successfully' }
    ],
    priority: [
      { value: 4, label: 'Critical', color: 'var(--danger)', description: 'Critical priority — LLM assigned' },
      { value: 1, label: 'P1', color: 'var(--red)', description: 'Critical - must do' },
      { value: 2, label: 'P2', color: 'var(--orange)', description: 'Important - should do' },
      { value: 3, label: 'P3', color: themeVars.muted as string, description: 'Nice to have - could do' }
    ]
  },

  // Task choices
  task: {
    status: [
      // Standardize to three states; blocked is a separate flag where needed
      { value: 0, label: 'To Do', color: themeVars.muted as string, description: 'Not started' },
      { value: 1, label: 'In Progress', color: themeVars.brand as string, description: 'Currently working' },
      { value: 2, label: 'Done', color: 'var(--green)', description: 'Completed' }
    ],
    priority: [
      { value: 4, label: 'Critical', color: 'var(--danger)', description: 'Critical priority — LLM assigned' },
      { value: 1, label: 'High', color: 'var(--red)', description: 'Urgent priority' },
      { value: 2, label: 'Medium', color: 'var(--orange)', description: 'Normal priority' },
      { value: 3, label: 'Low', color: themeVars.muted as string, description: 'Low priority' }
    ]
  },

  // Sprint choices
  sprint: {
    status: [
      { value: 0, label: 'Planning', color: themeVars.muted as string, description: 'Sprint being planned' },
      { value: 1, label: 'Active', color: themeVars.brand as string, description: 'Sprint in progress' },
      { value: 2, label: 'Complete', color: 'var(--green)', description: 'Sprint completed' },
      { value: 3, label: 'Cancelled', color: 'var(--red)', description: 'Sprint cancelled' }
    ]
  }
};

// Helper functions to work with choices
export class ChoiceHelper {
  
  // Get choice by value
  static getChoice(table: string, field: string, value: number): Choice | undefined {
    return CHOICES[table]?.[field]?.find(choice => choice.value === value);
  }

  // Get label by value
  static getLabel(table: string, field: string, value: number): string {
    const choice = this.getChoice(table, field, value);
    return choice?.label || `Unknown (${value})`;
  }

  // Get color by value
  static getColor(table: string, field: string, value: number): string {
    const choice = this.getChoice(table, field, value);
    return choice?.color || (themeVars.muted as string);
  }

  // Get all choices for a field
  static getChoices(table: string, field: string): Choice[] {
    return CHOICES[table]?.[field] || [];
  }

  // Get choices as options for dropdowns
  static getOptions(table: string, field: string): Array<{value: number, label: string}> {
    return this.getChoices(table, field).map(choice => ({
      value: choice.value,
      label: choice.label
    }));
  }

  // Find value by label (for migration/backwards compatibility)
  static getValueByLabel(table: string, field: string, label: string): number | undefined {
    const choice = CHOICES[table]?.[field]?.find(c => 
      c.label.toLowerCase() === label.toLowerCase()
    );
    return choice?.value;
  }

  // Validate that a value exists for a field
  static isValidValue(table: string, field: string, value: number): boolean {
    return this.getChoice(table, field, value) !== undefined;
  }
}

// Export commonly used choice getters for convenience
export const GoalStatus = {
  NEW: 0,
  WORK_IN_PROGRESS: 1,
  COMPLETE: 2,
  BLOCKED: 3,
  DEFERRED: 4,
  
  getLabel: (value: number) => ChoiceHelper.getLabel('goal', 'status', value),
  getColor: (value: number) => ChoiceHelper.getColor('goal', 'status', value),
  getOptions: () => ChoiceHelper.getOptions('goal', 'status')
};

export const StoryStatus = {
  BACKLOG: 0,
  // Map removed states to nearest canonical bucket
  PLANNED: 0,
  IN_PROGRESS: 2,
  TESTING: 2,
  DONE: 4,
  
  getLabel: (value: number) => ChoiceHelper.getLabel('story', 'status', value),
  getColor: (value: number) => ChoiceHelper.getColor('story', 'status', value),
  getOptions: () => ChoiceHelper.getOptions('story', 'status')
};

export const StoryPriority = {
  CRITICAL: 4,
  P1: 1,
  P2: 2,
  P3: 3,
  
  getLabel: (value: number) => ChoiceHelper.getLabel('story', 'priority', value),
  getColor: (value: number) => ChoiceHelper.getColor('story', 'priority', value),
  getOptions: () => ChoiceHelper.getOptions('story', 'priority')
};

export const TaskPriority = {
  CRITICAL: 4,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  
  getLabel: (value: number) => ChoiceHelper.getLabel('task', 'priority', value),
  getColor: (value: number) => ChoiceHelper.getColor('task', 'priority', value),
  getOptions: () => ChoiceHelper.getOptions('task', 'priority')
};

export default CHOICES;

import { Task, Story, Sprint } from '../types';

/**
 * Utility functions for managing task deadlines that inherit from story due dates
 * and sprint end dates for the active sprint
 */

export interface DeadlineInheritance {
  dueDate: number;
  source: 'task' | 'story' | 'sprint';
  inherited: boolean;
}

/**
 * Calculate the effective due date for a task, inheriting from story or sprint
 */
export const getEffectiveDueDate = (
  task: Task,
  story?: Story,
  sprint?: Sprint
): DeadlineInheritance => {
  // If task has explicit due date, use it
  if (task.dueDate) {
    return {
      dueDate: task.dueDate,
      source: 'task',
      inherited: false
    };
  }

  // If story has due date, inherit from story
  if (story?.dueDate) {
    return {
      dueDate: story.dueDate,
      source: 'story',
      inherited: true
    };
  }

  // If story is in an active sprint, inherit from sprint end date
  if (sprint && story?.sprintId === sprint.id && sprint.status === 1) {
    return {
      dueDate: sprint.endDate,
      source: 'sprint',
      inherited: true
    };
  }

  // Default to sprint end date if available
  if (sprint && sprint.status === 1) {
    return {
      dueDate: sprint.endDate,
      source: 'sprint',
      inherited: true
    };
  }

  // No due date available
  throw new Error('No due date available for task');
};

/**
 * Check if a task is overdue based on inherited deadlines
 */
export const isTaskOverdue = (
  task: Task,
  story?: Story,
  sprint?: Sprint
): boolean => {
  try {
    const deadline = getEffectiveDueDate(task, story, sprint);
    const now = new Date().getTime();
    return now > deadline.dueDate && task.status !== 2; // Not done and past due
  } catch {
    return false; // No deadline means not overdue
  }
};

/**
 * Get days until task deadline
 */
export const getDaysUntilDeadline = (
  task: Task,
  story?: Story,
  sprint?: Sprint
): number | null => {
  try {
    const deadline = getEffectiveDueDate(task, story, sprint);
    const now = new Date().getTime();
    const daysUntil = Math.ceil((deadline.dueDate - now) / (1000 * 60 * 60 * 24));
    return daysUntil;
  } catch {
    return null; // No deadline
  }
};

/**
 * Get a formatted deadline string with inheritance info
 */
export const getDeadlineInfo = (
  task: Task,
  story?: Story,
  sprint?: Sprint
): {
  text: string;
  color: 'success' | 'warning' | 'danger' | 'secondary';
  inherited: boolean;
  source: string;
} => {
  try {
    const deadline = getEffectiveDueDate(task, story, sprint);
    const daysUntil = getDaysUntilDeadline(task, story, sprint);
    
    if (daysUntil === null) {
      return {
        text: 'No deadline',
        color: 'secondary',
        inherited: false,
        source: 'none'
      };
    }

    let color: 'success' | 'warning' | 'danger' | 'secondary' = 'success';
    let text = '';

    if (daysUntil < 0) {
      color = 'danger';
      text = `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`;
    } else if (daysUntil === 0) {
      color = 'danger';
      text = 'Due today';
    } else if (daysUntil <= 3) {
      color = 'warning';
      text = `${daysUntil} day${daysUntil !== 1 ? 's' : ''} left`;
    } else {
      color = 'success';
      text = `${daysUntil} day${daysUntil !== 1 ? 's' : ''} left`;
    }

    if (deadline.inherited) {
      text += ` (from ${deadline.source})`;
    }

    return {
      text,
      color,
      inherited: deadline.inherited,
      source: deadline.source
    };
  } catch {
    return {
      text: 'No deadline',
      color: 'secondary',
      inherited: false,
      source: 'none'
    };
  }
};

/**
 * Get tasks that are approaching deadlines (within specified days)
 */
export const getTasksApproachingDeadlines = (
  tasks: Task[],
  stories: Story[],
  sprints: Sprint[],
  withinDays: number = 7
): Array<Task & { deadlineInfo: ReturnType<typeof getDeadlineInfo> }> => {
  return tasks
    .map(task => {
      const story = stories.find(s => s.id === task.parentId && task.parentType === 'story');
      const sprint = story ? sprints.find(s => s.id === story.sprintId) : undefined;
      const deadlineInfo = getDeadlineInfo(task, story, sprint);
      
      return {
        ...task,
        deadlineInfo
      };
    })
    .filter(task => {
      const daysUntil = getDaysUntilDeadline(task, 
        stories.find(s => s.id === task.parentId && task.parentType === 'story'),
        sprints.find(s => s.id === stories.find(story => story.id === task.parentId)?.sprintId)
      );
      return daysUntil !== null && daysUntil <= withinDays && task.status !== 2;
    });
};

/**
 * Auto-set task due dates based on sprint and story inheritance
 */
export const updateTaskDeadlinesFromSprint = async (
  tasks: Task[],
  stories: Story[],
  sprint: Sprint,
  updateFunction: (taskId: string, updates: Partial<Task>) => Promise<void>
): Promise<void> => {
  const sprintStories = stories.filter(story => story.sprintId === sprint.id);
  
  for (const story of sprintStories) {
    const storyTasks = tasks.filter(task => 
      task.parentType === 'story' && 
      task.parentId === story.id && 
      !task.dueDate // Only update tasks without explicit due dates
    );
    
    for (const task of storyTasks) {
      try {
        const effectiveDueDate = story.dueDate || sprint.endDate;
        await updateFunction(task.id, {
          dueDate: effectiveDueDate
        });
      } catch (error) {
        console.error(`Failed to update task ${task.id} deadline:`, error);
      }
    }
  }
};

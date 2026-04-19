import React from 'react';
import { Goal, Sprint, Story } from './types';

interface Props {
  goals: Goal[];
  stories: Story[];
  sprints: Sprint[];
  themes: Array<{ id: string; name: string; color: string }>;
  zoomLevel: 'month' | 'quarter' | 'half' | 'year';
  collapsedGoals: Set<string>;
  onGoalCollapse: (goalId: string) => void;
  onGoalDateChange: (goalId: string, startDate: number, endDate: number) => void;
}

const GoalTimelineGrid: React.FC<Props> = ({
  goals,
  stories,
  sprints,
  themes,
  zoomLevel,
  collapsedGoals,
  onGoalCollapse,
  onGoalDateChange
}) => {
  // Calculate timeline range based on zoom level
  const getTimelineRange = () => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    
    switch (zoomLevel) {
      case 'month':
        start.setMonth(start.getMonth() - 1);
        end.setMonth(end.getMonth() + 1);
        break;
      case 'quarter':
        start.setMonth(start.getMonth() - 3);
        end.setMonth(end.getMonth() + 3);
        break;
      case 'half':
        start.setMonth(start.getMonth() - 6);
        end.setMonth(end.getMonth() + 6);
        break;
      case 'year':
        start.setFullYear(start.getFullYear() - 1);
        end.setFullYear(end.getFullYear() + 1);
        break;
    }
    
    return { start: start.getTime(), end: end.getTime() };
  };

  const timelineRange = getTimelineRange();
  
  // Group goals by theme
  const goalsByTheme = goals.reduce((acc, goal) => {
    const theme = themes.find(t => t.id === goal.themeId);
    const themeName = theme?.name || 'Uncategorized';
    
    if (!acc[themeName]) {
      acc[themeName] = [];
    }
    acc[themeName].push(goal);
    return acc;
  }, {} as Record<string, Goal[]>);

  const getGoalPosition = (goal: Goal) => {
    const { start, end } = timelineRange;
    const totalDuration = end - start;
    
    const goalStart = goal.startDate || start;
    const goalEnd = goal.endDate || end;
    
    const leftPercent = ((goalStart - start) / totalDuration) * 100;
    const widthPercent = ((goalEnd - goalStart) / totalDuration) * 100;
    
    return {
      left: Math.max(0, Math.min(100, leftPercent)),
      width: Math.max(5, Math.min(100 - leftPercent, widthPercent))
    };
  };

  return (
    <div className="goal-timeline-grid">
      {/* Timeline Header */}
      <div className="timeline-header p-4 border-b">
        <div className="timeline-scale flex justify-between text-sm text-gray-500">
          {/* TODO: Generate date markers based on zoom level */}
          <span>{new Date(timelineRange.start).toLocaleDateString()}</span>
          <span>Today</span>
          <span>{new Date(timelineRange.end).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Goals by Theme */}
      <div className="timeline-content">
        {Object.entries(goalsByTheme).map(([themeName, themeGoals]) => {
          const theme = themes.find(t => t.name === themeName);
          
          return (
            <div key={themeName} className="theme-section border-b">
              <div 
                className="theme-header p-3 bg-gray-50 font-medium"
                style={{ borderLeft: `4px solid ${theme?.color || '#gray'}` }}
              >
                {themeName} ({themeGoals.length} goals)
              </div>
              
              {themeGoals.map(goal => {
                const position = getGoalPosition(goal);
                const isCollapsed = collapsedGoals.has(goal.id);
                const goalStories = stories.filter(s => s.goalId === goal.id);
                
                return (
                  <div key={goal.id} className="goal-row border-b border-gray-100">
                    {/* Goal Timeline Bar */}
                    <div className="goal-timeline-row p-4 min-h-[60px] relative">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => onGoalCollapse(goal.id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          {isCollapsed ? '▶' : '▼'}
                        </button>
                        
                        <div className="goal-info flex-shrink-0 w-64">
                          <div className="font-medium text-sm">{goal.ref}</div>
                          <div className="text-sm text-gray-600 truncate">{goal.title}</div>
                          {goal.progress !== undefined && (
                            <div className="text-xs text-gray-500">{goal.progress}% complete</div>
                          )}
                        </div>
                        
                        <div className="goal-timeline flex-1 relative h-8 bg-gray-100 rounded">
                          <div
                            className="goal-bar absolute top-0 h-full rounded"
                            style={{
                              left: `${position.left}%`,
                              width: `${position.width}%`,
                              backgroundColor: theme?.color || '#1890ff',
                              opacity: 0.8
                            }}
                            draggable
                            onDragEnd={(e) => {
                              // TODO: Calculate new dates and call onGoalDateChange
                              console.log('Goal dragged:', goal.ref);
                            }}
                          >
                            <div className="goal-bar-content p-1 text-xs text-white truncate">
                              {goal.title}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Collapsible Stories/Tasks Tables */}
                    {!isCollapsed && goalStories.length > 0 && (
                      <div className="goal-details bg-gray-50 p-4">
                        <div className="mb-3">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">
                            Stories ({goalStories.length})
                          </h4>
                          <div className="space-y-2">
                            {goalStories.map(story => (
                              <div key={story.id} className="flex items-center gap-3 text-sm">
                                <span className="font-mono text-xs text-gray-500">{story.ref}</span>
                                <span className="flex-1">{story.title}</span>
                                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                  {story.status}
                                </span>
                                {story.plannedSprintId && (
                                  <span className="text-xs text-gray-500">
                                    Sprint: {sprints.find(s => s.id === story.plannedSprintId)?.ref}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GoalTimelineGrid;

import React from 'react';
import { Sprint } from './types';

interface Props {
  sprints: Sprint[];
  zoomLevel: 'month' | 'quarter' | 'half' | 'year';
}

const SprintMarkers: React.FC<Props> = ({ sprints, zoomLevel }) => {
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
  
  const getSprintPosition = (sprint: Sprint) => {
    const { start, end } = timelineRange;
    const totalDuration = end - start;
    
    const sprintStart = sprint.startDate;
    const sprintEnd = sprint.endDate;
    
    const leftPercent = ((sprintStart - start) / totalDuration) * 100;
    const widthPercent = ((sprintEnd - sprintStart) / totalDuration) * 100;
    
    return {
      left: Math.max(0, Math.min(100, leftPercent)),
      width: Math.max(2, Math.min(100 - leftPercent, widthPercent))
    };
  };

  const getSprintColor = (status: string) => {
    switch (status) {
      case 'active': return '#52c41a';
      case 'planned': return '#1890ff';
      case 'completed': return '#722ed1';
      default: return '#d9d9d9';
    }
  };

  return (
    <div className="sprint-markers bg-white border-b p-4">
      <div className="sprint-timeline relative h-8 bg-gray-50 rounded">
        {/* Current time indicator */}
        <div 
          className="absolute top-0 w-0.5 h-full bg-red-500 z-10"
          style={{
            left: `${((Date.now() - timelineRange.start) / (timelineRange.end - timelineRange.start)) * 100}%`
          }}
        >
          <div className="absolute -top-2 -left-6 text-xs text-red-500 font-medium">
            Now
          </div>
        </div>
        
        {/* Sprint markers */}
        {sprints.map(sprint => {
          const position = getSprintPosition(sprint);
          
          if (position.left >= 100 || position.left + position.width <= 0) {
            return null; // Sprint is outside visible timeline
          }
          
          return (
            <div
              key={sprint.id}
              className="absolute top-0 h-full rounded cursor-pointer hover:opacity-80 transition-opacity"
              style={{
                left: `${position.left}%`,
                width: `${position.width}%`,
                backgroundColor: getSprintColor(sprint.status),
                minWidth: '2px'
              }}
              title={`${sprint.ref}: ${sprint.title}\n${new Date(sprint.startDate).toLocaleDateString()} - ${new Date(sprint.endDate).toLocaleDateString()}`}
            >
              <div className="sprint-label absolute top-0 left-1 text-xs text-white font-medium truncate max-w-full px-1">
                {sprint.ref}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Sprint legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-gray-600">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#52c41a' }}></div>
          Active
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#1890ff' }}></div>
          Planned
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#722ed1' }}></div>
          Completed
        </div>
      </div>
    </div>
  );
};

export default SprintMarkers;

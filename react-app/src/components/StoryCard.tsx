import React from 'react';
import { Story } from '../types';
import { useTheme } from '../contexts/ModernThemeContext';

interface StoryCardProps {
  story: Story;
  index: number;
}

const StoryCard: React.FC<StoryCardProps> = ({ story, index }) => {
  const { theme } = useTheme();
  // Handle both Story and EnhancedStory types
  const storyRef = (story as any).ref || `STRY-${String(index + 1).padStart(3, '0')}`;
  
  return (
    <div className="card story-card mb-2" data-theme={story.theme}>
      <div className="card-body p-2">
        <div className="d-flex justify-content-between align-items-start mb-1">
          <div>
            <small className="text-muted fw-bold">{storyRef}</small>
            <h6 className="card-title mb-0 mt-1" style={{ fontSize: '0.9rem' }}>{story.title}</h6>
          </div>
          {story.theme && (
            <span className={`badge theme-badge ${story.theme}`} style={{ fontSize: '0.7rem' }}>
              {story.theme}
            </span>
          )}
        </div>
        <small className="text-muted">
          Status: {story.status} | Priority: {(story as any).priority || 'P3'}
        </small>
      </div>
    </div>
  );
};

export default StoryCard;

export {};

import React from 'react';
import { Story } from '../types';

interface StoryCardProps {
  story: Story;
  index: number;
}

const StoryCard: React.FC<StoryCardProps> = ({ story, index }) => {
  return (
    <div className="card story-card mb-2" data-theme={story.theme}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <h6 className="card-title mb-0">{story.title}</h6>
          {story.theme && (
            <span className={`badge theme-badge ${story.theme}`}>
              {story.theme}
            </span>
          )}
        </div>
        <small className="text-muted">
          Status: {story.status}
        </small>
      </div>
    </div>
  );
};

export default StoryCard;

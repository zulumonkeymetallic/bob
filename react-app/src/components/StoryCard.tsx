import React from 'react';
import { Story } from '../types';

interface StoryCardProps {
  story: Story;
  index: number;
}

const StoryCard: React.FC<StoryCardProps> = ({ story, index }) => {
  return (
    <div className="card story-card mb-2">
      <div className="card-body">
        <h6 className="card-title">{story.title}</h6>
        <small className="text-muted">
          Status: {story.status}
        </small>
      </div>
    </div>
  );
};

export default StoryCard;

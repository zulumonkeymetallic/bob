import React from 'react';
import { Story } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { Activity } from 'lucide-react';

interface StoryCardProps {
  story: Story;
  index: number;
}

const StoryCard: React.FC<StoryCardProps> = ({ story, index }) => {
  const { showSidebar } = useSidebar();
  // Handle both Story and EnhancedStory types
  const storyRef = (story as any).ref || `STRY-${String(index + 1).padStart(3, '0')}`;
  
  return (
    <div
      className="card story-card mb-2"
      data-theme={story.theme}
      onClick={(e) => {
        // avoid button click duplication
        if ((e.target as HTMLElement).closest('button')) return;
        try { showSidebar(story as any, 'story'); } catch {}
      }}
      style={{ cursor: 'pointer' }}
    >
      <div className="card-body p-2">
        <div className="d-flex justify-content-between align-items-start mb-1">
          <div>
            <small className="text-muted fw-bold">{storyRef}</small>
            <h6 className="card-title mb-0 mt-1" style={{ fontSize: '0.9rem' }}>{story.title}</h6>
          </div>
          <div className="d-flex align-items-center gap-1">
            {story.theme && (
              <span className={`badge theme-badge ${story.theme}`} style={{ fontSize: '0.7rem' }}>
                {story.theme}
              </span>
            )}
            <button
              className="btn btn-sm btn-outline-secondary"
              style={{ padding: '2px 6px' }}
              onClick={(e) => { e.stopPropagation(); try { showSidebar(story as any, 'story'); } catch {} }}
              title="Activity"
            >
              <Activity size={14} />
            </button>
          </div>
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

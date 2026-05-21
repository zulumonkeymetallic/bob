import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { Target } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Story, Goal } from '../types';
import { themeVars } from '../utils/themeVars';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import KanbanCardV2 from './KanbanCardV2';
import '../styles/KanbanCards.css';

interface StoriesCardViewProps {
  stories: Story[];
  goals: Goal[];
  onStoryUpdate: (storyId: string, updates: any) => void | Promise<void>;
  onStoryDelete: (storyId: string) => void;
  onStorySelect: (story: Story) => void;
  onEditStory: (story: Story) => void;
  selectedStoryId: string | null;
}

type DetailLevel = 'minimal' | 'compact' | 'full';
const DETAIL_LEVELS: DetailLevel[] = ['minimal', 'compact', 'full'];

const StoriesCardView: React.FC<StoriesCardViewProps> = ({
  stories,
  goals,
  onStoryUpdate,
  onStoryDelete,
  onStorySelect,
  onEditStory,
  selectedStoryId,
}) => {
  const { currentUser } = useAuth();
  const { themes: globalThemes } = useGlobalThemes();

  const [latestActivities, setLatestActivities] = useState<Record<string, any>>({});
  const [nextBlocks, setNextBlocks] = useState<Record<string, any | null>>({});
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(() => {
    try {
      const stored = localStorage.getItem('bob_stories_detail_level') as DetailLevel | null;
      return stored && DETAIL_LEVELS.includes(stored) ? stored : 'compact';
    } catch {
      return 'compact';
    }
  });
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem('bob_stories_detail_level', detailLevel); } catch { /* noop */ }
  }, [detailLevel]);

  const themePalette = useMemo(
    () => (globalThemes && globalThemes.length ? globalThemes : GLOBAL_THEMES),
    [globalThemes]
  );

  const getGoalForStory = (goalId: string): Goal | undefined =>
    goals.find((g) => g.id === goalId);

  const loadLatestActivityForStory = useCallback(async (storyId: string) => {
    if (!currentUser) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'activity_stream'),
          where('ownerUid', '==', currentUser.uid),
          where('entityId', '==', storyId),
          where('entityType', '==', 'story'),
          orderBy('timestamp', 'desc'),
          limit(1)
        )
      );
      if (!snap.empty) {
        setLatestActivities((prev) => ({ ...prev, [storyId]: snap.docs[0].data() }));
      }
    } catch (error: any) {
      if (error?.code !== 'permission-denied') {
        console.error('[StoriesCardView] activity load error', storyId, error);
      }
    }
  }, [currentUser]);

  const loadNextBlockForStory = useCallback(async (storyId: string) => {
    if (!currentUser) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'calendar_blocks'),
          where('ownerUid', '==', currentUser.uid),
          where('storyId', '==', storyId),
        )
      );
      const nowMs = Date.now();
      const upcoming = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((b) => typeof b.start === 'number' && b.start >= nowMs)
        .sort((a, b) => a.start - b.start);
      setNextBlocks((prev) => ({ ...prev, [storyId]: upcoming[0] ?? null }));
    } catch {
      // ignore calendar_blocks errors silently
    }
  }, [currentUser]);

  useEffect(() => {
    stories.forEach((story) => {
      loadLatestActivityForStory(story.id);
      loadNextBlockForStory(story.id);
    });
  }, [stories, currentUser, loadLatestActivityForStory, loadNextBlockForStory]);

  useLayoutEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl || typeof ResizeObserver === 'undefined') return;

    const style = getComputedStyle(gridEl);
    const rowGap = parseFloat(style.rowGap || '0');
    const rowHeight = parseFloat(style.gridAutoRows || '0');
    if (!rowHeight) return;

    const updateSpans = (updates: Record<string, number>) => {
      if (!Object.keys(updates).length) return;
      setRowSpans((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, span] of Object.entries(updates)) {
          if (next[id] !== span) { next[id] = span; changed = true; }
        }
        return changed ? next : prev;
      });
    };

    const observer = new ResizeObserver((entries) => {
      const updates: Record<string, number> = {};
      entries.forEach((entry) => {
        const tile = entry.target as HTMLElement;
        const id = tile.dataset.storyId;
        if (!id) return;
        const span = Math.max(1, Math.ceil((entry.contentRect.height + rowGap) / (rowHeight + rowGap)));
        updates[id] = span;
      });
      updateSpans(updates);
    });

    const tiles = Array.from(gridEl.querySelectorAll<HTMLElement>('.goals-card-tile'));
    tiles.forEach((tile) => observer.observe(tile));
    return () => observer.disconnect();
  }, [stories, detailLevel]);

  if (stories.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: themeVars.muted as string }}>
        <Target size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <h4>No Stories Found</h4>
        <p>Start by creating your first story to track progress.</p>
      </div>
    );
  }

  return (
    <div className="goals-card-view" style={{ padding: '20px' }}>
      <div className="d-flex justify-content-end align-items-center gap-2 mb-3">
        <span style={{ fontSize: 12, color: themeVars.muted as string, fontWeight: 600 }}>Detail:</span>
        {DETAIL_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setDetailLevel(level)}
            style={{
              padding: '3px 11px',
              borderRadius: 999,
              border: `1px solid ${detailLevel === level ? 'var(--brand)' : 'var(--line)'}`,
              background: detailLevel === level ? 'var(--brand)' : 'transparent',
              color: detailLevel === level ? '#fff' : 'var(--muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {level}
          </button>
        ))}
      </div>

      <div className="goals-card-grid goals-card-grid--grid" ref={gridRef}>
        {stories.map((story) => {
          const parentGoal = getGoalForStory(story.goalId);
          const latestActivity = latestActivities[story.id];
          const latestNote = latestActivity
            ? String(latestActivity.noteContent || latestActivity.description || '').trim()
            : '';
          const nextBlock = nextBlocks[story.id] ?? undefined;
          const rowSpan = rowSpans[story.id];

          return (
            <div
              key={story.id}
              className="goals-card-tile"
              data-story-id={story.id}
              style={{
                ...(rowSpan ? { gridRowEnd: `span ${rowSpan}` } : {}),
                ...(selectedStoryId === story.id ? { outline: '2px solid var(--brand)', outlineOffset: 2, borderRadius: 10 } : {}),
              }}
            >
              <KanbanCardV2
                item={story}
                type="story"
                goal={parentGoal}
                themes={themePalette}
                latestNote={latestNote}
                showLatestNote={true}
                scheduledBlock={nextBlock}
                detailLevel={detailLevel}
                onEdit={(item) => onEditStory(item as Story)}
                onDelete={(item) => {
                  if (window.confirm('Delete this story? This cannot be undone.')) {
                    onStoryDelete(item.id);
                  }
                }}
                onItemSelect={(item) => onStorySelect(item as Story)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StoriesCardView;

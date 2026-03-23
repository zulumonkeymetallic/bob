import React, { useState } from 'react';
import { Button } from 'react-bootstrap';
import { GripVertical, Activity, Wand2, Clock3 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { functions, db } from '../firebase';
import { Story } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { getPriorityBadge } from '../utils/statusHelpers';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { themeVars } from '../utils/themeVars';
import { colorWithAlpha } from '../utils/storyCardFormatting';
import DeferItemModal from './DeferItemModal';

interface StoryCardProps {
  story: Story;
  index: number;
}

const statusBadgeMap: Record<number, { bg: string; text: string }> = {
  0: { bg: 'secondary', text: 'Backlog' },
  1: { bg: 'info', text: 'Planned' },
  2: { bg: 'primary', text: 'In progress' },
  3: { bg: 'warning', text: 'Testing' },
  4: { bg: 'success', text: 'Done' },
};

const StoryCard: React.FC<StoryCardProps> = ({ story, index }) => {
  const { showSidebar } = useSidebar();
  const [aiBusy, setAiBusy] = useState(false);
  const [showDeferModal, setShowDeferModal] = useState(false);
  const [priorityValue, setPriorityValue] = useState<number>(Number((story as any).priority ?? 0));
  const [statusValue, setStatusValue] = useState<number>(Number((story as any).status ?? 0));
  const [dueInputValue, setDueInputValue] = useState<string>(() => {
    const raw = (story as any).dueDate ?? (story as any).targetDate ?? null;
    if (!raw) return '';
    const d = typeof raw === 'number' ? new Date(raw) : raw?.toDate?.() ?? new Date(raw);
    if (!d || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [updatingField, setUpdatingField] = useState<'priority' | 'status' | 'dueDate' | null>(null);

  const storyRef = (story as any).ref || (story as any).referenceNumber || `STRY-${String(index + 1).padStart(3, '0')}`;

  // Resolve theme color from theme id
  const themeId = (story as any).theme ?? null;
  const resolvedTheme = themeId != null ? GLOBAL_THEMES.find(t => t.id === themeId) : null;
  const themeColor = resolvedTheme?.color || '#2563eb';

  // Deferred
  const deferredUntilRaw = (story as any).deferredUntil ?? null;
  const deferredUntilMs = typeof deferredUntilRaw === 'number'
    ? deferredUntilRaw
    : deferredUntilRaw?.toDate?.()?.getTime() ?? null;
  const isDeferred = typeof deferredUntilMs === 'number' && deferredUntilMs > Date.now();
  const deferredLabel = isDeferred
    ? `Deferred to ${new Date(deferredUntilMs!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null;

  // Due date / overdue
  const dueDateRaw = (story as any).dueDate ?? (story as any).targetDate ?? null;
  const dueDateMs = typeof dueDateRaw === 'number' ? dueDateRaw
    : dueDateRaw?.toDate?.()?.getTime() ?? null;
  const overdueDays = dueDateMs && dueDateMs < Date.now()
    ? Math.max(1, Math.floor((Date.now() - dueDateMs) / 86400000))
    : 0;

  // Progress
  const progressPct = (() => {
    const raw = (story as any).progressPct ?? (story as any).progress ?? null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  })();

  const priorityBadge = getPriorityBadge(priorityValue);
  const statusBadge = statusBadgeMap[statusValue] ?? { bg: 'secondary', text: 'Backlog' };

  const applyPatch = async (patch: Record<string, any>) => {
    await updateDoc(doc(db, 'stories', (story as any).id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  };

  const handlePriorityChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const prev = priorityValue;
    const next = Number(e.target.value);
    setPriorityValue(next);
    setUpdatingField('priority');
    try { await applyPatch({ priority: next }); }
    catch { setPriorityValue(prev); }
    finally { setUpdatingField(null); }
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const prev = statusValue;
    const next = Number(e.target.value);
    setStatusValue(next);
    setUpdatingField('status');
    try { await applyPatch({ status: next }); }
    catch { setStatusValue(prev); }
    finally { setUpdatingField(null); }
  };

  const handleDueDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const prev = dueInputValue;
    const next = e.target.value;
    setDueInputValue(next);
    setUpdatingField('dueDate');
    try {
      const dueMs = next ? new Date(`${next}T12:00:00`).getTime() : null;
      await applyPatch({ targetDate: dueMs, dueDate: dueMs, dueDateLocked: dueMs != null });
    } catch { setDueInputValue(prev); }
    finally { setUpdatingField(null); }
  };

  const handleStyle: React.CSSProperties = {
    color: themeColor,
    borderColor: colorWithAlpha(themeColor, 0.45),
    backgroundColor: colorWithAlpha(themeColor, 0.12),
  };

  return (
    <>
      <div
        className={`kanban-card kanban-card--story kanban-card__clickable`}
        style={{
          borderLeft: `3px solid ${themeColor}`,
          marginBottom: '8px',
        }}
        role="button"
        tabIndex={0}
        onClick={() => { try { showSidebar(story as any, 'story'); } catch {} }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            try { showSidebar(story as any, 'story'); } catch {}
          }
        }}
      >
        <button
          type="button"
          className="kanban-card__handle"
          style={handleStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>

        <div className="kanban-card__content">
          <div className="kanban-card__header">
            <span className="kanban-card__ref" style={{ color: themeColor }}>
              {storyRef}
            </span>
            <div className="kanban-card__actions">
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="AI: Generate Tasks for Story"
                disabled={aiBusy}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    setAiBusy(true);
                    await httpsCallable(functions, 'generateTasksForStory')({ storyId: (story as any).id });
                  } catch {}
                  finally { setAiBusy(false); }
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Wand2 size={12} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="Activity stream"
                onClick={(e) => {
                  e.stopPropagation();
                  try { showSidebar(story as any, 'story'); } catch {}
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Activity size={12} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{
                  width: 24,
                  height: 24,
                  color: isDeferred ? '#b45309' : themeVars.muted,
                }}
                title={deferredLabel ?? 'Defer intelligently'}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeferModal(true);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Clock3 size={12} />
              </Button>
            </div>
          </div>

          <div className="kanban-card__title" title={story.title}>
            {story.title}
          </div>

          <div className="kanban-card__quick-edit">
            <select
              className="kanban-card__chip-select"
              value={priorityValue}
              onChange={handlePriorityChange}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={updatingField === 'priority'}
              title="Priority"
              style={{
                backgroundColor: `var(--bs-${priorityBadge.bg})`,
                color: priorityBadge.bg === 'warning' || priorityBadge.bg === 'light' ? '#000' : '#fff',
              }}
            >
              <option value={0}>None</option>
              <option value={1}>Low</option>
              <option value={2}>Medium</option>
              <option value={3}>High</option>
              <option value={4}>Critical</option>
            </select>
            <input
              type="date"
              className="kanban-card__chip-date"
              value={dueInputValue}
              onChange={handleDueDateChange}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={updatingField === 'dueDate'}
              title="Due date"
            />
            <select
              className="kanban-card__chip-select"
              value={statusValue}
              onChange={handleStatusChange}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={updatingField === 'status'}
              title="Status"
              style={{
                backgroundColor: `var(--bs-${statusBadge.bg})`,
                color: statusBadge.bg === 'warning' || statusBadge.bg === 'light' ? '#000' : '#fff',
              }}
            >
              <option value={0}>Backlog</option>
              <option value={1}>Planned</option>
              <option value={2}>In progress</option>
              <option value={3}>Testing</option>
              <option value={4}>Done</option>
            </select>
          </div>

          <div className="kanban-card__meta">
            {overdueDays > 0 && (
              <span className="kanban-card__meta-badge" style={{ color: 'var(--red)' }} title="Overdue">
                {overdueDays}d overdue
              </span>
            )}
            {deferredLabel && (
              <span
                className="kanban-card__meta-badge"
                style={{
                  borderColor: 'rgba(245, 158, 11, 0.45)',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  color: '#b45309',
                }}
                title={deferredLabel}
              >
                <Clock3 size={11} style={{ marginRight: 4, marginTop: -1 }} />
                Deferred
              </span>
            )}
            <span className="kanban-card__meta-badge" title="Story points">
              {((story as any).points ?? 0)} pts
            </span>
            {progressPct != null && progressPct > 0 && (
              <span className="kanban-card__meta-badge" title="Progress">
                {progressPct}%
              </span>
            )}
            {(story as any).aiCriticalityScore != null && (
              <span className="kanban-card__meta-badge" title="AI score">
                AI {Math.round(Number((story as any).aiCriticalityScore))}
              </span>
            )}
          </div>
        </div>
      </div>

      {showDeferModal && (
        <DeferItemModal
          show={showDeferModal}
          onHide={() => setShowDeferModal(false)}
          itemType="story"
          itemId={(story as any).id}
          itemTitle={story.title || ''}
          onApply={async ({ dateMs, rationale, source }) => {
            await applyPatch({
              targetDate: dateMs,
              deferredUntil: dateMs,
              deferredReason: rationale,
              deferredBy: source,
            });
            setDueInputValue(
              `${new Date(dateMs).getFullYear()}-${String(new Date(dateMs).getMonth() + 1).padStart(2, '0')}-${String(new Date(dateMs).getDate()).padStart(2, '0')}`
            );
            setShowDeferModal(false);
          }}
        />
      )}
    </>
  );
};

export default StoryCard;

export {};

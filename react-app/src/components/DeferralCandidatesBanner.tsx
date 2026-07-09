/**
 * DeferralCandidatesBanner
 *
 * Compact, persistent entry in the banner panel. Surfaces the top 3 deferral
 * candidates from useDeferralCandidates (over-capacity moves first, then the
 * largest-effort in-sprint items that aren't top-3/manual/focus priority),
 * each with a one-tap "move it out of the way" action. "View all" navigates
 * to the full /sprints/deferrals page (mark complete / delete / schedule / move).
 */
import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightCircle } from 'lucide-react';
import { useDeferralCandidates, type DeferralCandidate, type OverCapacityMove } from '../hooks/useDeferralCandidates';
import { applyPlannerDefer, applyPlannerMoveToSprint, applyStoryDueDate } from '../utils/plannerDeferral';

type PinnedItem =
  | { kind: 'overcap'; data: OverCapacityMove }
  | { kind: 'candidate'; data: DeferralCandidate };

function formatDate(dateMs: number | null): string {
  if (!dateMs) return 'soon';
  return new Date(dateMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const DeferralCandidatesBanner: React.FC = () => {
  const { candidates, overCapacityMoves, currentSprint, nextSprint, loading } = useDeferralCandidates();
  const navigate = useNavigate();

  const [actionedIds, setActionedIds] = useState<Set<string>>(() => new Set());
  const [actioningId, setActioningId] = useState<string | null>(null);

  const markActioned = useCallback((id: string) => {
    setActionedIds((prev) => new Set(prev).add(id));
  }, []);

  const visibleOverCap = useMemo(
    () => overCapacityMoves.filter((m) => !actionedIds.has(m.id)),
    [overCapacityMoves, actionedIds],
  );
  const visibleCandidates = useMemo(
    () => candidates.filter((c) => !actionedIds.has(c.id)),
    [candidates, actionedIds],
  );

  const totalCount = visibleOverCap.length + visibleCandidates.length;

  const pinnedItems = useMemo<PinnedItem[]>(() => {
    const overcap: PinnedItem[] = visibleOverCap.map((data) => ({ kind: 'overcap', data }));
    const rest: PinnedItem[] = [...visibleCandidates]
      .sort((a, b) => b.effortHours - a.effortHours)
      .map((data) => ({ kind: 'candidate', data }));
    return [...overcap, ...rest].slice(0, 3);
  }, [visibleOverCap, visibleCandidates]);

  const handleMove = useCallback(async (item: PinnedItem) => {
    setActioningId(item.data.id);
    try {
      if (item.kind === 'overcap') {
        if (!nextSprint) return;
        await applyPlannerMoveToSprint({
          itemType: 'story',
          item: { id: item.data.id, title: item.data.title },
          sprintId: item.data.suggestedSprintId,
          sprintStartMs: Number((nextSprint as any).startDate || Date.now()),
          rationale: 'Sprint over capacity — priority-ordered fill plan',
          source: 'deferral_candidates_banner',
        });
      } else {
        const c = item.data;
        if (c.recommendedAction === 'set_due_date') {
          if (!c.targetDateMs) return;
          await applyStoryDueDate(c.id, c.targetDateMs);
        } else if (c.type === 'story') {
          if (!nextSprint) return;
          await applyPlannerMoveToSprint({
            itemType: 'story',
            item: { id: c.id, title: c.title },
            sprintId: nextSprint.id,
            sprintStartMs: Number((nextSprint as any).startDate || Date.now()),
            rationale: `Deferral recommendation: ${c.reasonSummary}`,
            source: 'deferral_candidates_banner',
          });
        } else {
          if (!c.targetDateMs) return;
          await applyPlannerDefer({
            itemType: 'task',
            item: { id: c.id, title: c.title },
            payload: {
              dateMs: c.targetDateMs,
              rationale: `Deferral recommendation: ${c.reasonSummary}`,
              source: 'deferral_candidates_banner',
              targetBucket: null,
              exactTargetStartMs: null,
              exactTargetEndMs: null,
            },
            sourceFallback: 'deferral_candidates_banner',
          });
        }
      }
      markActioned(item.data.id);
    } catch {
      // Best-effort quick action; user can retry from "View all" for a full error message.
    } finally {
      setActioningId(null);
    }
  }, [nextSprint, markActioned]);

  if (loading || !currentSprint || totalCount === 0) return null;

  return (
    <div style={{ minWidth: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Deferral candidates
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pinnedItems.map((item) => {
          const isActioning = actioningId === item.data.id;
          const disabled = isActioning
            || (item.kind === 'overcap' && !nextSprint)
            || (item.kind === 'candidate' && item.data.recommendedAction === 'next_sprint_pending');

          const title =
            item.kind === 'overcap'
              ? `Move to ${item.data.suggestedSprintName}`
              : item.data.recommendedAction === 'set_due_date'
                ? `Schedule by ${formatDate(item.data.targetDateMs)}`
                : item.data.recommendedAction === 'next_free_day'
                  ? `Defer to ${formatDate(item.data.targetDateMs)}`
                  : item.data.recommendedAction === 'next_sprint_pending'
                    ? 'Create next sprint to enable'
                    : `Move to ${nextSprint ? (nextSprint as any).name || 'next sprint' : 'next sprint'}`;

          const meta = item.kind === 'overcap'
            ? `${item.data.points}pt${item.data.points !== 1 ? 's' : ''}`
            : `${Math.round(item.data.effortHours * 10) / 10}h`;

          return (
            <div
              key={item.data.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: 'var(--notion-hover, rgba(0,0,0,0.04))',
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
                padding: '5px 6px 5px 8px',
              }}
            >
              <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.data.title}>
                {item.data.title}
              </span>
              <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{meta}</span>
              <button
                onClick={() => handleMove(item)}
                disabled={disabled}
                title={title}
                aria-label={title}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, flexShrink: 0, padding: 0,
                  background: 'transparent', border: 'none', borderRadius: 6,
                  color: disabled ? 'var(--muted)' : 'var(--brand, #5f77dc)',
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled && !isActioning ? 0.4 : 1,
                }}
              >
                {isActioning ? <span style={{ fontSize: 11 }}>···</span> : <ArrowRightCircle size={16} />}
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => navigate('/sprints/deferrals')}
        style={{
          marginTop: 6, background: 'none', border: 'none', padding: 0,
          fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        View all ({totalCount})
      </button>
    </div>
  );
};

export default DeferralCandidatesBanner;

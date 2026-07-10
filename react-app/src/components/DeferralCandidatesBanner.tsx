/**
 * DeferralCandidatesBanner
 *
 * Compact, persistent entry in the banner panel. Surfaces the top 3 deferral
 * candidates from useDeferralCandidates (over-capacity moves first, then the
 * largest-effort in-sprint items that aren't top-3/manual/focus priority),
 * each with quick actions — move it out of the way, mark it done, or delete
 * it — without opening the sidebar. "View all" navigates to the full
 * /sprints/deferrals page, alongside a live capacity available vs required
 * readout for the current sprint.
 */
import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightCircle, CheckCircle, Trash2 } from 'lucide-react';
import { doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useDeferralCandidates, type DeferralCandidate, type OverCapacityMove } from '../hooks/useDeferralCandidates';
import { applyPlannerDefer, applyPlannerMoveToSprint, applyStoryDueDate } from '../utils/plannerDeferral';

type PinnedItem =
  | { kind: 'overcap'; data: OverCapacityMove }
  | { kind: 'candidate'; data: DeferralCandidate };

function itemType(item: PinnedItem): 'story' | 'task' {
  return item.kind === 'overcap' ? 'story' : item.data.type;
}

function formatDate(dateMs: number | null): string {
  if (!dateMs) return 'soon';
  return new Date(dateMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const DeferralCandidatesBanner: React.FC = () => {
  const { candidates, overCapacityMoves, capacitySummary, currentSprint, nextSprint, loading } = useDeferralCandidates();
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

  const handleMarkComplete = useCallback(async (item: PinnedItem) => {
    setActioningId(item.data.id);
    try {
      const type = itemType(item);
      const collectionName = type === 'task' ? 'tasks' : 'stories';
      const doneStatus = type === 'task' ? 2 : 4;
      await updateDoc(doc(db, collectionName, item.data.id), { status: doneStatus, updatedAt: serverTimestamp() });
      markActioned(item.data.id);
    } catch {
      // Best-effort quick action; user can retry from "View all" for a full error message.
    } finally {
      setActioningId(null);
    }
  }, [markActioned]);

  const handleDelete = useCallback(async (item: PinnedItem) => {
    setActioningId(item.data.id);
    try {
      const type = itemType(item);
      const collectionName = type === 'task' ? 'tasks' : 'stories';
      await deleteDoc(doc(db, collectionName, item.data.id));
      markActioned(item.data.id);
    } catch {
      // Best-effort quick action; user can retry from "View all" for a full error message.
    } finally {
      setActioningId(null);
    }
  }, [markActioned]);

  if (loading || !currentSprint || totalCount === 0) return null;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Deferral candidates
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pinnedItems.map((item) => {
          const isActioning = actioningId === item.data.id;
          const moveDisabled = isActioning
            || (item.kind === 'overcap' && !nextSprint)
            || (item.kind === 'candidate' && item.data.recommendedAction === 'next_sprint_pending');

          const moveTitle =
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

          const score = item.data.aiCriticalityScore;

          return (
            <div
              key={item.data.id}
              style={{
                background: 'var(--notion-hover, rgba(0,0,0,0.04))',
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
                padding: '5px 6px 5px 8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.data.title}>
                  {item.data.title}
                </span>
                <span
                  style={{
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                    background: 'var(--panel)', border: '1px solid var(--border, #e5e7eb)',
                    borderRadius: 10, padding: '1px 6px', color: 'var(--muted)',
                  }}
                >
                  {score != null ? `AI ${score}` : 'AI —'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1 }}>{meta}</span>
                <button
                  onClick={() => handleMarkComplete(item)}
                  disabled={isActioning}
                  title="Mark complete"
                  aria-label="Mark complete"
                  style={quickActionButtonStyle('var(--text-success, #15803d)', isActioning)}
                >
                  <CheckCircle size={14} />
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  disabled={isActioning}
                  title="Delete"
                  aria-label="Delete"
                  style={quickActionButtonStyle('var(--text-danger, #dc2626)', isActioning)}
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => handleMove(item)}
                  disabled={moveDisabled}
                  title={moveTitle}
                  aria-label={moveTitle}
                  style={{
                    ...quickActionButtonStyle('var(--brand, #5f77dc)', isActioning),
                    opacity: moveDisabled && !isActioning ? 0.4 : 1,
                    cursor: moveDisabled ? 'default' : 'pointer',
                  }}
                >
                  {isActioning ? <span style={{ fontSize: 11 }}>···</span> : <ArrowRightCircle size={14} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
        {capacitySummary && (
          <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {capacitySummary.availablePoints}pt available · {capacitySummary.requiredPoints}pt required
          </span>
        )}
        <button
          onClick={() => navigate('/sprints/deferrals')}
          style={{
            background: 'none', border: 'none', padding: 0, flexShrink: 0,
            fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          View all ({totalCount})
        </button>
      </div>
    </div>
  );
};

function quickActionButtonStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, flexShrink: 0, padding: 0,
    background: 'transparent', border: 'none', borderRadius: 6,
    color: disabled ? 'var(--muted)' : color,
    cursor: disabled ? 'default' : 'pointer',
  };
}

export default DeferralCandidatesBanner;

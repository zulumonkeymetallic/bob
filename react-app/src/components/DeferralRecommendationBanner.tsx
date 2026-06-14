import React, { useCallback, useState } from 'react';
import { Alert, Badge, Button } from 'react-bootstrap';
import { CalendarClock, CheckCircle, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useDeferralCandidates, type DeferralCandidate, type OverCapacityMove } from '../hooks/useDeferralCandidates';
import { applyPlannerDefer, applyPlannerMoveToSprint, applyStoryDueDate } from '../utils/plannerDeferral';

function formatDate(dateMs: number | null): string {
  if (!dateMs) return 'tomorrow';
  return new Date(dateMs).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function reasonLabel(codes: string[]): string {
  if (codes.includes('not_priority')) return 'Not in top priorities';
  if (codes.includes('low_relative_priority')) return 'Lower priority';
  if (codes.includes('large_effort')) return 'High effort';
  if (codes.includes('no_goal_link')) return 'No goal link';
  return 'Lower priority';
}

interface Props {
  compact?: boolean;
}

const DeferralRecommendationBanner: React.FC<Props> = ({ compact = false }) => {
  const { candidates, overCapacityMoves, loading, currentSprint, nextSprint } = useDeferralCandidates();

  const [expanded, setExpanded] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [actioned, setActioned] = useState<Set<string>>(() => new Set());

  const markActioned = (id: string) => setActioned((prev) => new Set(prev).add(id));

  const visibleCandidates = candidates.filter((c) => !actioned.has(c.id));

  const handleStoryMove = useCallback(async (candidate: DeferralCandidate) => {
    if (!nextSprint) return;
    setActioningId(candidate.id);
    setStatusMsg(null);
    try {
      await applyPlannerMoveToSprint({
        itemType: 'story',
        item: { id: candidate.id, title: candidate.title },
        sprintId: nextSprint.id,
        sprintStartMs: Number((nextSprint as any).startDate || Date.now()),
        rationale: `Deferral recommendation: ${candidate.reasonSummary}`,
        source: 'deferral_recommendation_banner',
      });
      markActioned(candidate.id);
      setStatusMsg(`Moved to ${(nextSprint as any).name || 'next sprint'}.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to move story.');
    } finally {
      setActioningId(null);
    }
  }, [nextSprint]);

  const handleSetDueDate = useCallback(async (candidate: DeferralCandidate) => {
    if (!candidate.targetDateMs) return;
    setActioningId(candidate.id);
    setStatusMsg(null);
    try {
      await applyStoryDueDate(candidate.id, candidate.targetDateMs);
      markActioned(candidate.id);
      setStatusMsg(`Due date set — nightly planner will schedule after top priorities.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to set due date.');
    } finally {
      setActioningId(null);
    }
  }, []);

  const handleTaskDefer = useCallback(async (candidate: DeferralCandidate) => {
    if (!candidate.targetDateMs) return;
    setActioningId(candidate.id);
    setStatusMsg(null);
    try {
      await applyPlannerDefer({
        itemType: 'task',
        item: { id: candidate.id, title: candidate.title },
        payload: {
          dateMs: candidate.targetDateMs,
          rationale: `Deferral recommendation: ${candidate.reasonSummary}`,
          source: 'deferral_recommendation_banner',
          targetBucket: null,
          exactTargetStartMs: null,
          exactTargetEndMs: null,
        },
        sourceFallback: 'deferral_recommendation_banner',
      });
      markActioned(candidate.id);
      setStatusMsg('Task deferred.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to defer task.');
    } finally {
      setActioningId(null);
    }
  }, []);

  const handleBulkOverCapacity = useCallback(async () => {
    if (!nextSprint || overCapacityMoves.length === 0) return;
    setBulkApplying(true);
    setStatusMsg(null);
    let moved = 0;
    for (const move of overCapacityMoves) {
      if (actioned.has(move.id)) continue;
      try {
        await applyPlannerMoveToSprint({
          itemType: 'story',
          item: { id: move.id, title: move.title },
          sprintId: move.suggestedSprintId,
          sprintStartMs: Number((nextSprint as any).startDate || Date.now()),
          rationale: 'Sprint over capacity — priority-ordered fill plan',
          source: 'deferral_recommendation_banner',
        });
        markActioned(move.id);
        moved++;
      } catch {
        // continue best-effort
      }
    }
    setBulkApplying(false);
    setStatusMsg(`Moved ${moved} ${moved === 1 ? 'story' : 'stories'} to ${(nextSprint as any).name || 'next sprint'}.`);
  }, [nextSprint, overCapacityMoves, actioned]);

  const handleMarkComplete = useCallback(async (candidate: DeferralCandidate) => {
    setActioningId(candidate.id);
    setStatusMsg(null);
    try {
      const col = candidate.type === 'task' ? 'tasks' : 'stories';
      await updateDoc(doc(db, col, candidate.id), { status: 3 });
      markActioned(candidate.id);
      setStatusMsg('Marked as complete.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to mark complete.');
    } finally {
      setActioningId(null);
    }
  }, []);

  const handleDelete = useCallback(async (candidate: DeferralCandidate) => {
    setActioningId(candidate.id);
    setStatusMsg(null);
    try {
      const col = candidate.type === 'task' ? 'tasks' : 'stories';
      await deleteDoc(doc(db, col, candidate.id));
      markActioned(candidate.id);
      setStatusMsg('Deleted.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to delete.');
    } finally {
      setActioningId(null);
    }
  }, []);

  const visibleOverCapacity = overCapacityMoves.filter((m) => !actioned.has(m.id));

  if (dismissed) return null;
  if (!currentSprint || loading) return null;
  if (visibleCandidates.length === 0 && visibleOverCapacity.length === 0) return null;

  const focusStoryCandidates = visibleCandidates.filter((c) => c.type === 'story' && c.recommendedAction === 'set_due_date');
  const deferStoryCandidates = visibleCandidates.filter((c) => c.type === 'story' && c.recommendedAction !== 'set_due_date');
  const taskCandidates = visibleCandidates.filter((c) => c.type === 'task');

  if (compact) {
    return (
      <Alert variant="info" className="py-2 px-3 mb-2 small d-flex align-items-center justify-content-between gap-2" dismissible onClose={() => setDismissed(true)}>
        <span>
          <strong>{visibleCandidates.length}</strong> deferral{visibleCandidates.length !== 1 ? 's' : ''} suggested
          {focusStoryCandidates.length > 0 && ` · ${focusStoryCandidates.length} focus ${focusStoryCandidates.length === 1 ? 'story' : 'stories'}`}
          {deferStoryCandidates.length > 0 && ` · ${deferStoryCandidates.length} ${deferStoryCandidates.length === 1 ? 'story' : 'stories'}`}
          {taskCandidates.length > 0 && ` · ${taskCandidates.length} ${taskCandidates.length === 1 ? 'task' : 'tasks'}`}
        </span>
        <Button size="sm" variant="outline-primary" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Less' : 'Show'}
        </Button>
        {expanded && (
          <div className="w-100 mt-2">
            {visibleCandidates.slice(0, 3).map((c) => (
              <div key={c.id} className="d-flex align-items-center justify-content-between gap-2 mb-1">
                <span className="text-truncate flex-grow-1">{c.title}</span>
                {c.recommendedAction === 'set_due_date' ? (
                  <Button size="sm" variant="outline-primary" disabled={!c.targetDateMs || actioningId === c.id} onClick={() => handleSetDueDate(c)}>
                    {actioningId === c.id ? '…' : 'Schedule'}
                  </Button>
                ) : c.type === 'story' ? (
                  <Button size="sm" variant={nextSprint ? 'outline-dark' : 'outline-secondary'} disabled={!nextSprint || actioningId === c.id} onClick={() => handleStoryMove(c)}>
                    {actioningId === c.id ? '…' : 'Move'}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline-dark" disabled={!c.targetDateMs || actioningId === c.id} onClick={() => handleTaskDefer(c)}>
                    {actioningId === c.id ? '…' : 'Defer'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Alert>
    );
  }

  const totalSuggestions = visibleCandidates.length + visibleOverCapacity.length;

  return (
    <Alert
      variant="info"
      className="border-0 shadow-sm mb-3"
      dismissible
      onClose={() => setDismissed(true)}
    >
      <div className="d-flex align-items-center gap-2">
        <CalendarClock size={20} />
        <div>
          <div className="fw-semibold">
            {totalSuggestions} deferral suggestion{totalSuggestions !== 1 ? 's' : ''}
            <Badge bg="secondary" className="ms-2" style={{ fontSize: 11 }}>
              {(currentSprint as any).name || 'Current sprint'}
            </Badge>
            {visibleOverCapacity.length > 0 && (
              <Badge bg="warning" text="dark" className="ms-1" style={{ fontSize: 11 }}>
                Over capacity
              </Badge>
            )}
          </div>
          <div className="text-muted small">
            {visibleOverCapacity.length > 0 && `${visibleOverCapacity.length} over capacity → next sprint`}
            {visibleOverCapacity.length > 0 && focusStoryCandidates.length > 0 && ' · '}
            {focusStoryCandidates.length > 0 && `${focusStoryCandidates.length} focus ${focusStoryCandidates.length === 1 ? 'story' : 'stories'} → schedule within sprint`}
            {focusStoryCandidates.length > 0 && (deferStoryCandidates.length > 0 || taskCandidates.length > 0) && ' · '}
            {deferStoryCandidates.length > 0 && `${deferStoryCandidates.length} ${deferStoryCandidates.length === 1 ? 'story' : 'stories'} → next sprint`}
            {deferStoryCandidates.length > 0 && taskCandidates.length > 0 && ' · '}
            {taskCandidates.length > 0 && `${taskCandidates.length} ${taskCandidates.length === 1 ? 'task' : 'tasks'} → next free slot`}
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2 border-top">
        <Button
          size="sm"
          variant="link"
          className="p-0 text-dark d-inline-flex align-items-center gap-1 mb-2"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="fw-semibold" style={{ fontSize: 13 }}>
            {expanded ? 'Hide details' : 'Show details'}
          </span>
        </Button>

        {statusMsg && <div className="text-muted small mb-2">{statusMsg}</div>}

        {expanded && (
          <div className="d-flex flex-column gap-2">
            {visibleOverCapacity.length > 0 && (
              <>
                <div className="d-flex align-items-center justify-content-between">
                  <div className="text-muted small fw-semibold" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Sprint over capacity — move to next sprint
                  </div>
                  {nextSprint && (
                    <Button
                      size="sm"
                      variant="warning"
                      style={{ minWidth: 160 }}
                      disabled={bulkApplying}
                      onClick={handleBulkOverCapacity}
                    >
                      {bulkApplying ? 'Applying…' : `Apply all (${visibleOverCapacity.length})`}
                    </Button>
                  )}
                </div>
                {visibleOverCapacity.map((m) => (
                  <div
                    key={m.id}
                    className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                    style={{ background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.4)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <div className="small flex-grow-1 me-2">
                      <Badge bg="warning" text="dark" className="me-1" style={{ fontSize: 10 }}>Over cap</Badge>
                      <strong>{m.title}</strong>
                      <span className="text-muted ms-1">· {m.points}pt{m.points !== 1 ? 's' : ''}</span>
                    </div>
                    {nextSprint ? (
                      <Button
                        size="sm"
                        variant="outline-warning"
                        style={{ minWidth: 140 }}
                        disabled={actioningId === m.id}
                        onClick={async () => {
                          setActioningId(m.id);
                          try {
                            await applyPlannerMoveToSprint({
                              itemType: 'story',
                              item: { id: m.id, title: m.title },
                              sprintId: m.suggestedSprintId,
                              sprintStartMs: Number((nextSprint as any).startDate || Date.now()),
                              rationale: 'Sprint over capacity — priority-ordered fill plan',
                              source: 'deferral_recommendation_banner',
                            });
                            markActioned(m.id);
                          } catch (err: any) {
                            setStatusMsg(err?.message || 'Failed to move story.');
                          } finally {
                            setActioningId(null);
                          }
                        }}
                      >
                        {actioningId === m.id ? 'Moving…' : `Move to ${m.suggestedSprintName}`}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline-secondary" disabled>Create next sprint</Button>
                    )}
                  </div>
                ))}
              </>
            )}

            {focusStoryCandidates.length > 0 && (
              <>
                <div className="text-muted small fw-semibold" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Focus stories — schedule within sprint
                </div>
                {focusStoryCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                    style={{ background: 'rgba(13,110,253,0.05)', border: '1px solid rgba(13,110,253,0.2)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <div className="small flex-grow-1 me-2">
                      <Badge bg="primary" className="me-1" style={{ fontSize: 10 }}>Focus</Badge>
                      <strong>{c.title}</strong>
                      <span className="text-muted ms-1">· {Math.round(c.effortHours * 10) / 10}h</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline-primary"
                      style={{ minWidth: 170 }}
                      disabled={!c.targetDateMs || actioningId === c.id}
                      onClick={() => handleSetDueDate(c)}
                    >
                      {actioningId === c.id ? 'Scheduling…' : `Schedule by ${formatDate(c.targetDateMs)}`}
                    </Button>
                    <button title="Mark complete" disabled={actioningId === c.id} onClick={() => handleMarkComplete(c)} style={{ border: 'none', background: 'transparent', color: 'var(--bs-success)', padding: '2px 4px', cursor: 'pointer' }}><CheckCircle size={14} /></button>
                    <button title="Delete" disabled={actioningId === c.id} onClick={() => handleDelete(c)} style={{ border: 'none', background: 'transparent', color: 'var(--bs-danger)', padding: '2px 4px', cursor: 'pointer' }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </>
            )}

            {deferStoryCandidates.length > 0 && (
              <>
                <div className="text-muted small fw-semibold mt-1" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Stories — move to next sprint</div>
                {deferStoryCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                    style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <div className="small flex-grow-1 me-2">
                      <strong>{c.title}</strong>
                      <span className="text-muted ms-1">· {reasonLabel(c.reasonCodes)} · {Math.round(c.effortHours * 10) / 10}h</span>
                    </div>
                    {nextSprint ? (
                      <Button
                        size="sm"
                        variant="outline-dark"
                        style={{ minWidth: 140 }}
                        disabled={actioningId === c.id}
                        onClick={() => handleStoryMove(c)}
                      >
                        {actioningId === c.id ? 'Moving…' : `Move to ${(nextSprint as any).name || 'next sprint'}`}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline-warning" disabled>
                        Create next sprint to enable
                      </Button>
                    )}
                    <button title="Mark complete" disabled={actioningId === c.id} onClick={() => handleMarkComplete(c)} style={{ border: 'none', background: 'transparent', color: 'var(--bs-success)', padding: '2px 4px', cursor: 'pointer' }}><CheckCircle size={14} /></button>
                    <button title="Delete" disabled={actioningId === c.id} onClick={() => handleDelete(c)} style={{ border: 'none', background: 'transparent', color: 'var(--bs-danger)', padding: '2px 4px', cursor: 'pointer' }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </>
            )}

            {taskCandidates.length > 0 && (
              <>
                <div className="text-muted small fw-semibold mt-1" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tasks — defer to free slot</div>
                {taskCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                    style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <div className="small flex-grow-1 me-2">
                      <strong>{c.title}</strong>
                      <span className="text-muted ms-1">· {reasonLabel(c.reasonCodes)} · {Math.round(c.effortHours * 10) / 10}h</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline-dark"
                      style={{ minWidth: 140 }}
                      disabled={!c.targetDateMs || actioningId === c.id}
                      onClick={() => handleTaskDefer(c)}
                    >
                      {actioningId === c.id ? 'Deferring…' : `Defer to ${formatDate(c.targetDateMs)}`}
                    </Button>
                    <button title="Mark complete" disabled={actioningId === c.id} onClick={() => handleMarkComplete(c)} style={{ border: 'none', background: 'transparent', color: 'var(--bs-success)', padding: '2px 4px', cursor: 'pointer' }}><CheckCircle size={14} /></button>
                    <button title="Delete" disabled={actioningId === c.id} onClick={() => handleDelete(c)} style={{ border: 'none', background: 'transparent', color: 'var(--bs-danger)', padding: '2px 4px', cursor: 'pointer' }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Alert>
  );
};

export default DeferralRecommendationBanner;

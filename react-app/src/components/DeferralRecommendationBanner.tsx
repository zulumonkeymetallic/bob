import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button } from 'react-bootstrap';
import { CalendarClock, ChevronDown, ChevronRight } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { useFocusGoals } from '../hooks/useFocusGoals';
import { getActiveFocusLeafGoalIds } from '../utils/goalHierarchy';
import { applyPlannerDefer, applyPlannerMoveToSprint } from '../utils/plannerDeferral';

interface DeferralCandidate {
  id: string;
  type: 'story' | 'task';
  title: string;
  reasonCodes: string[];
  reasonSummary: string;
  protectedBy: string | null;
  recommendedAction: 'next_sprint' | 'next_sprint_pending' | 'next_free_day';
  targetDateMs: number | null;
  targetSprintId: string | null;
  exactTargetStartMs: number | null;
  exactTargetEndMs: number | null;
  targetBucket: string | null;
  focusAligned: boolean;
  manualPriorityRank: number | null;
  aiTop3: boolean;
  effortHours: number;
}

function formatSlot(dateMs: number | null, bucket: string | null): string {
  if (!dateMs) return 'tomorrow';
  const date = new Date(dateMs);
  const dateStr = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return bucket && bucket !== 'anytime' ? `${dateStr} ${timeStr}` : dateStr;
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
  const { currentUser } = useAuth();
  const { sprints } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);

  const currentSprint = useMemo(() => {
    const now = Date.now();
    const sorted = [...sprints].sort((a, b) => Number((a as any).startDate || 0) - Number((b as any).startDate || 0));
    const active = sorted.find((s) => {
      const status = String((s as any).status || '').toLowerCase();
      return ['active', 'current', 'in-progress', 'in progress'].includes(status);
    });
    if (active) return active;
    return sorted.find((s) => {
      const start = Number((s as any).startDate || 0);
      const end = Number((s as any).endDate || 0);
      return start > 0 && end > 0 && now >= start && now <= end;
    }) || sorted[0] || null;
  }, [sprints]);

  const nextSprint = useMemo(() => {
    if (!currentSprint) return null;
    const sorted = [...sprints].sort((a, b) => Number((a as any).startDate || 0) - Number((b as any).startDate || 0));
    return sorted.find((s) => Number((s as any).startDate || 0) > Number((currentSprint as any).startDate || 0)) || null;
  }, [currentSprint, sprints]);

  const [candidates, setCandidates] = useState<DeferralCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!currentUser?.uid || !currentSprint?.id) {
      setCandidates([]);
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const focusGoalIds = Array.from(getActiveFocusLeafGoalIds(activeFocusGoals));
      const fn = httpsCallable<object, { ok: boolean; candidates: DeferralCandidate[] }>(
        functions,
        'suggestDeferralCandidates',
      );
      const result = await fn({
        sprintId: currentSprint.id,
        nextSprintId: nextSprint?.id || null,
        focusGoalIds,
      });
      setCandidates(result.data?.candidates || []);
    } catch (err: any) {
      console.error('DeferralRecommendationBanner: load failed', err);
      setCandidates([]);
      setStatusMsg(err?.message || 'Failed to load deferral recommendations.');
    } finally {
      setLoading(false);
    }
  }, [activeFocusGoals, currentSprint?.id, currentUser?.uid, nextSprint?.id]);

  useEffect(() => {
    setDismissed(false);
    setCandidates([]);
    void load();
  }, [load]);

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
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      setStatusMsg(`Moved to ${(nextSprint as any).name || 'next sprint'}.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to move story.');
    } finally {
      setActioningId(null);
    }
  }, [nextSprint]);

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
          targetBucket: (candidate.targetBucket as any) || null,
          exactTargetStartMs: candidate.exactTargetStartMs || null,
          exactTargetEndMs: candidate.exactTargetEndMs || null,
        },
        sourceFallback: 'deferral_recommendation_banner',
      });
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      setStatusMsg('Task deferred.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to defer task.');
    } finally {
      setActioningId(null);
    }
  }, []);

  if (dismissed) return null;
  if (!currentSprint || candidates.length === 0) {
    if (loading) return null;
    return null;
  }

  const storyCandidates = candidates.filter((c) => c.type === 'story');
  const taskCandidates = candidates.filter((c) => c.type === 'task');

  if (compact) {
    return (
      <Alert variant="info" className="py-2 px-3 mb-2 small d-flex align-items-center justify-content-between gap-2" dismissible onClose={() => setDismissed(true)}>
        <span>
          <strong>{candidates.length}</strong> deferral{candidates.length !== 1 ? 's' : ''} suggested
          {storyCandidates.length > 0 && ` · ${storyCandidates.length} ${storyCandidates.length === 1 ? 'story' : 'stories'}`}
          {taskCandidates.length > 0 && ` · ${taskCandidates.length} ${taskCandidates.length === 1 ? 'task' : 'tasks'}`}
        </span>
        <Button size="sm" variant="outline-primary" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Less' : 'Show'}
        </Button>
        {expanded && (
          <div className="w-100 mt-2">
            {candidates.slice(0, 3).map((c) => (
              <div key={c.id} className="d-flex align-items-center justify-content-between gap-2 mb-1">
                <span className="text-truncate flex-grow-1">{c.title}</span>
                {c.type === 'story' ? (
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

  return (
    <Alert
      variant="info"
      className="border-0 shadow-sm mb-3"
      dismissible
      onClose={() => setDismissed(true)}
    >
      <div className="d-flex align-items-center justify-content-between gap-3">
        <div className="d-flex align-items-center gap-2">
          <CalendarClock size={20} />
          <div>
            <div className="fw-semibold">
              {candidates.length} deferral suggestion{candidates.length !== 1 ? 's' : ''}
              <Badge bg="secondary" className="ms-2" style={{ fontSize: 11 }}>
                {currentSprint.name || 'Current sprint'}
              </Badge>
            </div>
            <div className="text-muted small">
              {storyCandidates.length > 0 && `${storyCandidates.length} ${storyCandidates.length === 1 ? 'story' : 'stories'} → next sprint`}
              {storyCandidates.length > 0 && taskCandidates.length > 0 && ' · '}
              {taskCandidates.length > 0 && `${taskCandidates.length} ${taskCandidates.length === 1 ? 'task' : 'tasks'} → next free slot`}
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button size="sm" variant="outline-secondary" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
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
            {storyCandidates.length > 0 && (
              <>
                <div className="text-muted small fw-semibold" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Stories</div>
                {storyCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                    style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <div className="small flex-grow-1 me-2">
                      <strong>{c.title}</strong>
                      <span className="text-muted ms-1">· {reasonLabel(c.reasonCodes)} · {Math.round(c.effortHours * 10) / 10}h</span>
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-nowrap">
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
                    </div>
                  </div>
                ))}
              </>
            )}

            {taskCandidates.length > 0 && (
              <>
                <div className="text-muted small fw-semibold mt-1" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tasks</div>
                {taskCandidates.map((c) => {
                  const slotLabel = formatSlot(c.exactTargetStartMs ?? c.targetDateMs, c.targetBucket);
                  return (
                    <div
                      key={c.id}
                      className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                      style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: '8px 10px' }}
                    >
                      <div className="small flex-grow-1 me-2">
                        <strong>{c.title}</strong>
                        <span className="text-muted ms-1">· {reasonLabel(c.reasonCodes)} · {Math.round(c.effortHours * 10) / 10}h</span>
                      </div>
                      <div className="d-flex align-items-center gap-2 flex-nowrap">
                        <Button
                          size="sm"
                          variant="outline-dark"
                          style={{ minWidth: 140 }}
                          disabled={!c.targetDateMs || actioningId === c.id}
                          onClick={() => handleTaskDefer(c)}
                        >
                          {actioningId === c.id ? 'Deferring…' : `Defer to ${slotLabel}`}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </Alert>
  );
};

export default DeferralRecommendationBanner;

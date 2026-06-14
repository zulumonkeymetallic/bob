import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Form, Badge, Spinner, Alert } from 'react-bootstrap';
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  Target,
  BookOpen,
  CalendarDays,
  BarChart2,
  Eye,
  ClipboardCheck,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import { expandFocusGoalIdsToLeafGoalIds } from '../../utils/goalHierarchy';
import { goalThemeColor } from '../../utils/storyCardFormatting';
import { getThemeName } from '../../utils/statusHelpers';
import { GLOBAL_THEMES } from '../../constants/globalThemes';
import GoalKpiLivePanel from '../goals/GoalKpiLivePanel';
import type { Goal, Story, Sprint } from '../../types';
import type { IHabit } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardState {
  selectedGoalIds: Set<string>;
  selectedStoryIds: Set<string>;
  name: string;
  objective: string;
  startDate: string; // ISO date string for input
  endDate: string;
  alignmentMode: 'warn' | 'strict';
}

interface SprintPlannerWizardProps {
  show: boolean;
  onHide: () => void;
  /** When provided: edit/plan an existing sprint instead of creating a new one */
  existingSprint?: Sprint | null;
  currentUserId?: string;
  /** Called after the sprint is created/updated */
  onComplete?: (sprintId: string) => void;
}

type StepId = 1 | 2 | 3 | 4 | 5 | 6;

const STEPS: { id: StepId; label: string; icon: React.ReactNode }[] = [
  { id: 1, label: 'Focus Goals', icon: <Target size={13} /> },
  { id: 2, label: 'Stories', icon: <BookOpen size={13} /> },
  { id: 3, label: 'Dates', icon: <CalendarDays size={13} /> },
  { id: 4, label: 'Metrics', icon: <BarChart2 size={13} /> },
  { id: 5, label: 'Deferral', icon: <Eye size={13} /> },
  { id: 6, label: 'Review', icon: <ClipboardCheck size={13} /> },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function priorityLabel(p: any): string {
  const n = Number(p);
  if (n === 4) return 'Critical';
  if (n === 3) return 'High';
  if (n === 2) return 'Medium';
  if (n === 1) return 'Low';
  return String(p ?? '');
}

function priorityVariant(p: any): string {
  const n = Number(p);
  if (n === 4) return 'danger';
  if (n === 3) return 'warning';
  if (n === 2) return 'info';
  return 'secondary';
}

// Chunk array into groups of `size`
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Main Component ───────────────────────────────────────────────────────────

const SprintPlannerWizard: React.FC<SprintPlannerWizardProps> = ({
  show,
  onHide,
  existingSprint,
  currentUserId,
  onComplete,
}) => {
  const { currentUser } = useAuth();
  const uid = currentUserId || currentUser?.uid || '';

  const { activeFocusGoals } = useFocusGoals(uid);

  // ── All goals (for step 1 extra-selection) ─────────────────────────────────
  const [allGoals, setAllGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);

  // ── Stories for selected goals ─────────────────────────────────────────────
  const [stories, setStories] = useState<Story[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(false);

  // ── Habits ─────────────────────────────────────────────────────────────────
  const [habits, setHabits] = useState<IHabit[]>([]);
  const [habitsLoading, setHabitsLoading] = useState(false);

  // ── Submit state ───────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Goal search ────────────────────────────────────────────────────────────
  const [goalSearch, setGoalSearch] = useState('');

  // ── Wizard state ───────────────────────────────────────────────────────────
  const today = new Date();
  const twoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  const defaultState = useCallback((): WizardState => {
    const startStr = toDateInputValue(today);
    const endStr = toDateInputValue(twoWeeks);
    if (existingSprint) {
      const s = existingSprint;
      const sDate = s.startDate ? new Date(typeof s.startDate === 'number' && s.startDate < 1e11 ? s.startDate * 1000 : s.startDate) : today;
      const eDate = s.endDate ? new Date(typeof s.endDate === 'number' && s.endDate < 1e11 ? s.endDate * 1000 : s.endDate) : twoWeeks;
      return {
        selectedGoalIds: new Set(s.focusGoalIds || []),
        selectedStoryIds: new Set(),
        name: s.name || '',
        objective: s.objective || '',
        startDate: toDateInputValue(sDate),
        endDate: toDateInputValue(eDate),
        alignmentMode: (s.alignmentMode as 'warn' | 'strict') || 'warn',
      };
    }
    return {
      selectedGoalIds: new Set(activeFocusGoals.flatMap(fg => fg.goalIds || [])),
      selectedStoryIds: new Set(),
      name: `Sprint — w/c ${today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
      objective: '',
      startDate: startStr,
      endDate: endStr,
      alignmentMode: 'warn',
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingSprint, activeFocusGoals]);

  const [step, setStep] = useState<StepId>(1);
  const [wiz, setWiz] = useState<WizardState>(defaultState);

  // Reset when modal opens
  useEffect(() => {
    if (show) {
      setStep(1);
      setWiz(defaultState());
      setGoalSearch('');
      setStories([]);
      setHabits([]);
      setSubmitError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Update pre-selected goals when activeFocusGoals loads
  useEffect(() => {
    if (show && !existingSprint && activeFocusGoals.length > 0 && wiz.selectedGoalIds.size === 0) {
      setWiz(prev => ({
        ...prev,
        selectedGoalIds: new Set(activeFocusGoals.flatMap(fg => fg.goalIds || [])),
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFocusGoals, show]);

  // Load all goals once on open
  useEffect(() => {
    if (!show || !uid) return;
    setGoalsLoading(true);
    getDocs(query(collection(db, 'goals'), where('ownerUid', '==', uid)))
      .then(snap => setAllGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal))))
      .catch(() => setAllGoals([]))
      .finally(() => setGoalsLoading(false));
  }, [show, uid]);

  // ── Leaf goal IDs for story queries ────────────────────────────────────────
  const leafGoalIds = useMemo(
    () => expandFocusGoalIdsToLeafGoalIds(wiz.selectedGoalIds, allGoals),
    [wiz.selectedGoalIds, allGoals],
  );

  // Load stories when entering step 2
  const loadStories = useCallback(async () => {
    if (!uid || leafGoalIds.length === 0) { setStories([]); return; }
    setStoriesLoading(true);
    try {
      const batches = chunks(leafGoalIds, 30);
      const results = await Promise.all(
        batches.map(ids =>
          getDocs(query(
            collection(db, 'stories'),
            where('ownerUid', '==', uid),
            where('goalId', 'in', ids),
          ))
        )
      );
      const loaded = results.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
      // Filter: not done (status < 4)
      const active = loaded.filter(s => {
        const st = typeof s.status === 'number' ? s.status : parseInt(String(s.status), 10);
        return st < 4;
      });
      setStories(active);
      // Pre-select all stories in step 2
      setWiz(prev => ({ ...prev, selectedStoryIds: new Set(active.map(s => s.id)) }));
    } catch {
      setStories([]);
    } finally {
      setStoriesLoading(false);
    }
  }, [uid, leafGoalIds]);

  // Load habits + KPI data when entering step 4
  const loadHabits = useCallback(async () => {
    if (!uid) return;
    setHabitsLoading(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'habits'),
        where('ownerUid', '==', uid),
        where('isActive', '==', true),
      ));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as IHabit));
      setHabits(all.filter(h => h.linkedGoalId && wiz.selectedGoalIds.has(h.linkedGoalId)));
    } catch {
      setHabits([]);
    } finally {
      setHabitsLoading(false);
    }
  }, [uid, wiz.selectedGoalIds]);

  // ── Step navigation ─────────────────────────────────────────────────────────
  const goNext = async () => {
    if (step === 1) { await loadStories(); }
    if (step === 3) { await loadHabits(); }
    setStep(s => Math.min(6, s + 1) as StepId);
  };

  const goBack = () => setStep(s => Math.max(1, s - 1) as StepId);

  // ── Derived: stories by goal ────────────────────────────────────────────────
  const storiesByGoal = useMemo((): Map<string, { goal: Goal; stories: Story[] }> => {
    const map = new Map<string, { goal: Goal; stories: Story[] }>();
    for (const s of stories) {
      const goal = allGoals.find(g => g.id === s.goalId);
      if (!goal) continue;
      if (!map.has(goal.id)) map.set(goal.id, { goal, stories: [] });
      map.get(goal.id)!.stories.push(s);
    }
    return map;
  }, [stories, allGoals]);

  const selectedStories = useMemo(
    () => stories.filter(s => wiz.selectedStoryIds.has(s.id)),
    [stories, wiz.selectedStoryIds],
  );

  const deferredStories = useMemo(
    () => stories.filter(s => !wiz.selectedStoryIds.has(s.id)),
    [stories, wiz.selectedStoryIds],
  );

  const selectedGoalObjects = useMemo(
    () => allGoals.filter(g => wiz.selectedGoalIds.has(g.id)),
    [allGoals, wiz.selectedGoalIds],
  );

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!uid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const startMs = new Date(wiz.startDate).getTime();
      const endMs = new Date(wiz.endDate).getTime();
      const isActive = startMs <= Date.now() && Date.now() <= endMs;

      let sprintId: string;

      if (existingSprint) {
        await updateDoc(doc(db, 'sprints', existingSprint.id), {
          name: wiz.name,
          objective: wiz.objective,
          startDate: startMs,
          endDate: endMs,
          focusGoalIds: [...wiz.selectedGoalIds],
          alignmentMode: wiz.alignmentMode,
          updatedAt: serverTimestamp(),
        });
        sprintId = existingSprint.id;
      } else {
        const sprintRef = await addDoc(collection(db, 'sprints'), {
          name: wiz.name,
          objective: wiz.objective,
          startDate: startMs,
          endDate: endMs,
          planningDate: startMs,
          retroDate: endMs,
          status: isActive ? 1 : 0,
          focusGoalIds: [...wiz.selectedGoalIds],
          alignmentMode: wiz.alignmentMode,
          ownerUid: uid,
          persona: 'personal',
          capacityPoints: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        sprintId = sprintRef.id;
      }

      // Assign selected stories to sprint
      if (selectedStories.length > 0) {
        const batch = writeBatch(db);
        for (const s of selectedStories) {
          batch.update(doc(db, 'stories', s.id), {
            sprintId,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // Defer deselected stories back to backlog
      if (deferredStories.length > 0) {
        const batch = writeBatch(db);
        for (const s of deferredStories) {
          batch.update(doc(db, 'stories', s.id), {
            sprintId: null,
            status: 0,
            deferredReason: 'Excluded during sprint planning',
            deferredBy: 'sprint_planner_wizard',
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      onComplete?.(sprintId);
      onHide();
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to create sprint');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Filtered goals for step 1 ───────────────────────────────────────────────
  const filteredGoals = useMemo(() => {
    const search = goalSearch.toLowerCase();
    return allGoals
      .filter(g => {
        const st = typeof g.status === 'number' ? g.status : parseInt(String(g.status ?? 0));
        return st < 4; // not done
      })
      .filter(g => !search || (g.title || '').toLowerCase().includes(search))
      .sort((a, b) => {
        const aSelected = wiz.selectedGoalIds.has(a.id) ? 0 : 1;
        const bSelected = wiz.selectedGoalIds.has(b.id) ? 0 : 1;
        return aSelected - bSelected || (a.title || '').localeCompare(b.title || '');
      });
  }, [allGoals, goalSearch, wiz.selectedGoalIds]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Modal show={show} onHide={onHide} centered size="xl" fullscreen="lg-down" scrollable>
      <Modal.Header closeButton style={{ borderBottom: '1px solid var(--notion-border)' }}>
        <Modal.Title style={{ fontSize: 16, fontWeight: 600 }}>
          {existingSprint ? `Plan: ${existingSprint.name}` : 'New Sprint Planner'}
        </Modal.Title>
      </Modal.Header>

      {/* Step indicator */}
      <div style={{ display: 'flex', padding: '10px 20px', gap: 4, borderBottom: '1px solid var(--notion-border)', background: 'var(--notion-bg-secondary, #f9fafb)' }}>
        {STEPS.map(({ id, label, icon }) => {
          const done = id < step;
          const active = id === step;
          return (
            <div
              key={id}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20,
                fontSize: 12, fontWeight: active ? 600 : 400,
                background: active ? 'var(--bs-primary)' : done ? 'var(--bs-success-subtle)' : 'transparent',
                color: active ? '#fff' : done ? 'var(--bs-success-text)' : 'var(--bs-secondary-color)',
                cursor: 'default',
              }}
            >
              {done ? <CheckCircle2 size={12} /> : icon}
              <span className="d-none d-sm-inline">{label}</span>
              <span className="d-sm-none">{id}</span>
            </div>
          );
        })}
      </div>

      <Modal.Body style={{ minHeight: 400, padding: '20px 24px' }}>
        {/* ── Step 1: Focus Goals ── */}
        {step === 1 && (
          <div>
            <h6 className="mb-1">Select focus goals for this sprint</h6>
            <p className="text-muted small mb-3">Your active focus goals are pre-selected. Add or remove as needed.</p>

            <Form.Control
              placeholder="Search goals..."
              size="sm"
              className="mb-3"
              value={goalSearch}
              onChange={e => setGoalSearch(e.target.value)}
            />

            {goalsLoading ? (
              <div className="text-center py-4"><Spinner size="sm" /> Loading goals...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto' }}>
                {filteredGoals.map(goal => {
                  const checked = wiz.selectedGoalIds.has(goal.id);
                  const color = goalThemeColor(goal);
                  const isFocusGoal = activeFocusGoals.some(fg => (fg.goalIds || []).includes(goal.id));
                  const kindLabel = goal.goalKind === 'umbrella' ? 'Program' : goal.goalKind === 'milestone' ? 'Phase' : goal.goalKind === 'execution' ? 'Leaf' : goal.goalKind || '';
                  return (
                    <div
                      key={goal.id}
                      onClick={() => setWiz(prev => {
                        const next = new Set(prev.selectedGoalIds);
                        checked ? next.delete(goal.id) : next.add(goal.id);
                        return { ...prev, selectedGoalIds: next };
                      })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        border: `1px solid ${checked ? color : 'var(--notion-border)'}`,
                        borderLeft: `4px solid ${color}`,
                        borderRadius: 8, cursor: 'pointer',
                        background: checked ? `${color}10` : 'var(--notion-bg, #fff)',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      {checked ? <CheckCircle2 size={16} color={color} /> : <Circle size={16} color="var(--bs-secondary-color)" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.3 }}>{goal.title || 'Untitled'}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                          {goal.theme != null && (
                            <span style={{ fontSize: 11, color: color, background: `${color}15`, padding: '1px 6px', borderRadius: 10 }}>
                              {getThemeName(goal.theme)}
                            </span>
                          )}
                          {kindLabel && (
                            <span style={{ fontSize: 11, color: 'var(--bs-secondary-color)', background: 'var(--bs-secondary-bg)', padding: '1px 6px', borderRadius: 10 }}>
                              {kindLabel}
                            </span>
                          )}
                          {isFocusGoal && (
                            <span style={{ fontSize: 11, color: '#d97706', background: '#fef3c7', padding: '1px 6px', borderRadius: 10 }}>
                              Focus
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredGoals.length === 0 && (
                  <div className="text-center text-muted py-4">No goals match your search</div>
                )}
              </div>
            )}
            <div className="mt-2 text-muted small">{wiz.selectedGoalIds.size} goal{wiz.selectedGoalIds.size !== 1 ? 's' : ''} selected</div>
          </div>
        )}

        {/* ── Step 2: Stories ── */}
        {step === 2 && (
          <div>
            <h6 className="mb-1">Stories linked to your selected goals</h6>
            <p className="text-muted small mb-3">Untick any stories you don't want in this sprint — they'll be returned to backlog.</p>

            {storiesLoading ? (
              <div className="text-center py-4"><Spinner size="sm" /> Loading stories...</div>
            ) : stories.length === 0 ? (
              <Alert variant="info">No active stories found for the selected goals. You can still create the sprint.</Alert>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Array.from(storiesByGoal.entries()).map(([goalId, { goal, stories: gs }]) => {
                  const color = goalThemeColor(goal);
                  return (
                    <div key={goalId}>
                      <div style={{ fontWeight: 600, fontSize: 12, color, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                        {goal.title}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {gs.map(story => {
                          const checked = wiz.selectedStoryIds.has(story.id);
                          return (
                            <div
                              key={story.id}
                              onClick={() => setWiz(prev => {
                                const next = new Set(prev.selectedStoryIds);
                                checked ? next.delete(story.id) : next.add(story.id);
                                return { ...prev, selectedStoryIds: next };
                              })}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                                border: `1px solid ${checked ? color : 'var(--notion-border)'}`,
                                borderRadius: 6, cursor: 'pointer',
                                background: checked ? `${color}08` : 'transparent',
                                opacity: checked ? 1 : 0.6,
                              }}
                            >
                              {checked ? <CheckCircle2 size={14} color={color} /> : <Circle size={14} color="var(--bs-secondary-color)" />}
                              <span style={{ fontSize: 11, color: 'var(--bs-secondary-color)', minWidth: 60 }}>{story.ref || '—'}</span>
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{story.title}</span>
                              {story.priority && (
                                <Badge bg={priorityVariant(story.priority)} style={{ fontSize: 10 }}>
                                  {priorityLabel(story.priority)}
                                </Badge>
                              )}
                              {story.points != null && (
                                <span style={{ fontSize: 11, color: 'var(--bs-secondary-color)' }}>{story.points}pt</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 text-muted small">
              {wiz.selectedStoryIds.size} of {stories.length} stories selected
              {deferredStories.length > 0 && ` · ${deferredStories.length} will be deferred`}
            </div>
          </div>
        )}

        {/* ── Step 3: Dates & Name ── */}
        {step === 3 && (
          <div style={{ maxWidth: 520 }}>
            <h6 className="mb-3">Sprint details</h6>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontWeight: 500, fontSize: 13 }}>Sprint name</Form.Label>
              <Form.Control
                value={wiz.name}
                onChange={e => setWiz(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Sprint — w/c 14 Jun"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontWeight: 500, fontSize: 13 }}>Objective <span className="text-muted fw-normal">(optional)</span></Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={wiz.objective}
                onChange={e => setWiz(prev => ({ ...prev, objective: e.target.value }))}
                placeholder="What does winning this sprint look like?"
              />
            </Form.Group>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="mb-3">
              <Form.Group>
                <Form.Label style={{ fontWeight: 500, fontSize: 13 }}>Start date</Form.Label>
                <Form.Control
                  type="date"
                  value={wiz.startDate}
                  onChange={e => setWiz(prev => ({ ...prev, startDate: e.target.value }))}
                />
              </Form.Group>
              <Form.Group>
                <Form.Label style={{ fontWeight: 500, fontSize: 13 }}>End date</Form.Label>
                <Form.Control
                  type="date"
                  value={wiz.endDate}
                  onChange={e => setWiz(prev => ({ ...prev, endDate: e.target.value }))}
                />
              </Form.Group>
            </div>
            <Form.Group>
              <Form.Label style={{ fontWeight: 500, fontSize: 13 }}>Alignment mode</Form.Label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['warn', 'strict'] as const).map(mode => (
                  <div
                    key={mode}
                    onClick={() => setWiz(prev => ({ ...prev, alignmentMode: mode }))}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                      border: `2px solid ${wiz.alignmentMode === mode ? 'var(--bs-primary)' : 'var(--notion-border)'}`,
                      background: wiz.alignmentMode === mode ? 'var(--bs-primary-subtle)' : 'transparent',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>{mode}</div>
                    <div style={{ fontSize: 11, color: 'var(--bs-secondary-color)', marginTop: 2 }}>
                      {mode === 'warn' ? 'Shows a warning when adding out-of-focus stories' : 'Blocks adding stories not aligned to focus goals'}
                    </div>
                  </div>
                ))}
              </div>
            </Form.Group>
          </div>
        )}

        {/* ── Step 4: Metrics & Habits ── */}
        {step === 4 && (
          <div>
            <h6 className="mb-1">Metrics & habits</h6>
            <p className="text-muted small mb-3">KPIs and active habits linked to your selected goals.</p>

            {selectedGoalObjects.length === 0 ? (
              <Alert variant="warning">No goals selected — go back to step 1.</Alert>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {selectedGoalObjects.map(goal => {
                  const color = goalThemeColor(goal);
                  const kpisV2 = (goal as any).kpisV2 || [];
                  const linkedHabits = habits.filter(h => h.linkedGoalId === goal.id);
                  return (
                    <div key={goal.id} style={{ border: `1px solid ${color}40`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: 14 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{goal.title}</div>

                      {kpisV2.length > 0 ? (
                        <GoalKpiLivePanel goalId={goal.id} ownerUid={uid} kpisV2={kpisV2} />
                      ) : (
                        <div className="text-muted small mb-2">No KPIs configured for this goal.</div>
                      )}

                      {habitsLoading ? (
                        <div className="small text-muted"><Spinner size="sm" className="me-1" />Loading habits...</div>
                      ) : linkedHabits.length > 0 ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bs-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Habits</div>
                          {linkedHabits.map(h => (
                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: h.color || color, flexShrink: 0 }} />
                              <span style={{ flex: 1 }}>{h.name}</span>
                              <span className="text-muted" style={{ fontSize: 11 }}>{h.frequency}</span>
                              {h.targetValue > 1 && <span className="text-muted" style={{ fontSize: 11 }}>{h.targetValue}× {h.unit || ''}</span>}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Deferral Preview ── */}
        {step === 5 && (
          <div>
            <h6 className="mb-1">Deferral preview</h6>
            <p className="text-muted small mb-3">The following stories were unchecked in step 2 and will be returned to backlog when the sprint is created.</p>

            {deferredStories.length === 0 ? (
              <Alert variant="success">All stories will be included in this sprint — nothing to defer.</Alert>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {deferredStories.map(s => {
                  const goal = allGoals.find(g => g.id === s.goalId);
                  const color = goal ? goalThemeColor(goal) : '#6b7280';
                  return (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--notion-border)', borderLeft: `4px solid ${color}`, borderRadius: 6, background: 'var(--notion-bg, #fff)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</div>
                        {goal && <div style={{ fontSize: 11, color: 'var(--bs-secondary-color)' }}>{goal.title}</div>}
                      </div>
                      <Badge bg="secondary" style={{ fontSize: 10 }}>Backlog</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Step 6: Review & Create ── */}
        {step === 6 && (
          <div style={{ maxWidth: 560 }}>
            <h6 className="mb-3">Review & create sprint</h6>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SummaryRow label="Sprint name" value={wiz.name || '—'} />
              <SummaryRow label="Dates" value={`${formatDate(new Date(wiz.startDate))} → ${formatDate(new Date(wiz.endDate))}`} />
              <SummaryRow label="Alignment" value={wiz.alignmentMode === 'strict' ? 'Strict (blocks off-focus stories)' : 'Warn (flags off-focus stories)'} />
              {wiz.objective && <SummaryRow label="Objective" value={wiz.objective} />}

              <div style={{ borderTop: '1px solid var(--notion-border)', paddingTop: 12, marginTop: 4 }}>
                <SummaryRow label="Focus goals" value={`${wiz.selectedGoalIds.size} selected`} />
                <SummaryRow label="Stories in sprint" value={`${wiz.selectedStoryIds.size}`} />
                {deferredStories.length > 0 && <SummaryRow label="Stories to defer" value={`${deferredStories.length} → backlog`} />}
                <SummaryRow label="Habits tracked" value={`${habits.length}`} />
              </div>
            </div>

            {submitError && <Alert variant="danger" className="mt-3">{submitError}</Alert>}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer style={{ borderTop: '1px solid var(--notion-border)', gap: 8 }}>
        <Button variant="outline-secondary" size="sm" onClick={onHide} disabled={submitting}>Cancel</Button>
        {step > 1 && (
          <Button variant="outline-secondary" size="sm" onClick={goBack} disabled={submitting}>
            <ChevronLeft size={14} className="me-1" />Back
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {step < 6 ? (
          <Button
            variant="primary"
            size="sm"
            onClick={goNext}
            disabled={step === 1 && wiz.selectedGoalIds.size === 0}
          >
            Next<ChevronRight size={14} className="ms-1" />
          </Button>
        ) : (
          <Button variant="success" size="sm" onClick={handleCreate} disabled={submitting || !wiz.name.trim()}>
            {submitting ? <><Spinner size="sm" className="me-1" />Creating...</> : existingSprint ? 'Update Sprint' : 'Create Sprint'}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

// ─── Summary row helper ───────────────────────────────────────────────────────

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
    <span style={{ minWidth: 140, color: 'var(--bs-secondary-color)', fontWeight: 500 }}>{label}</span>
    <span style={{ flex: 1 }}>{value}</span>
  </div>
);

export default SprintPlannerWizard;

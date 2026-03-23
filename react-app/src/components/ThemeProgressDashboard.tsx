import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Container, Row, Col, Card, Badge, Button, Alert, Form } from 'react-bootstrap';
import { TrendingUp } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Story, Task, FocusGoal } from '../types';
import { GLOBAL_THEMES, LEGACY_THEME_MAP, type GlobalTheme } from '../constants/globalThemes';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { themeVars } from '../utils/themeVars';
import { computeWindowExpectedProgress, evaluateGoalTargetStatus } from '../utils/goalKpiStatus';
import { triggerFocusGoalDataRefresh } from '../services/focusGoalsService';
import FocusGoalsWidget from './FocusGoalsWidget';
import { isGoalInHierarchySet } from '../utils/goalHierarchy';

// ── Status helpers ─────────────────────────────────────────────────────────────

const isTaskDone = (status: any): boolean => {
  if (typeof status === 'number') return status === 2 || status >= 4;
  return ['done', 'complete', 'completed', 'finished', 'closed'].includes(
    String(status ?? '').trim().toLowerCase()
  );
};

const isStoryDone = (status: any): boolean => {
  if (typeof status === 'number') return status >= 4;
  return ['done', 'complete', 'completed', 'finished', 'closed', 'archived'].includes(
    String(status ?? '').trim().toLowerCase()
  );
};

const isGoalDone = (status: any): boolean => {
  if (typeof status === 'number') return status >= 2;
  return ['done', 'complete', 'completed', 'closed', 'archived'].includes(
    String(status ?? '').trim().toLowerCase()
  );
};

const toMs = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

// ── Types ──────────────────────────────────────────────────────────────────────

type PotInfo = { name: string; balance: number; currency: string };
type PotTransferInfo = { transferredInPence: number; transferredOutPence: number; currency: string };

interface ThemeGoalRow {
  id: string;
  title: string;
  status: any;
  statusLabel: string;
  statusBg: string;
  storiesDone: number;
  storiesTotal: number;
  storiesProgressPct: number;
  tasksDone: number;
  tasksTotal: number;
  pointsDone: number;
  pointsTotal: number;
  pointsProgressPct: number;
  progressPct: number;
  dueThisSprint: boolean;
  dueDateMs: number | null;
  potTransferredInPence: number;
  potTransferredOutPence: number;
  potNetTransferredPence: number;
  potTarget: number;
  potCurrency: string;
  isFocusGoal: boolean;
}

interface ThemeRow {
  themeKey: string;
  themeId: number;
  themeLabel: string;
  color: string;
  textColor: string;
  goalsDone: number;
  goalsTotal: number;
  storiesDone: number;
  storiesTotal: number;
  storiesProgressPct: number;
  tasksDone: number;
  tasksTotal: number;
  pointsDone: number;
  pointsTotal: number;
  completedItems: number;
  totalItems: number;
  progressPct: number;
  goalRows: ThemeGoalRow[];
  potTransferredInPence: number;
  potTransferredOutPence: number;
  potNetTransferredPence: number;
  potTarget: number;
  potCurrency: string;
}

// ── Mini widget component ──────────────────────────────────────────────────────

interface ThemeProgressWidgetProps {
  title: string;
  rows: ThemeRow[];
  lowProgressAlert?: ThemeGoalRow[];
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  formatCurrency: (pence: number, currency: string) => string;
  emptyMessage: string;
  overallPct: number | null;
  overallBreakdown: string;
}

const ThemeProgressWidget: React.FC<ThemeProgressWidgetProps> = ({
  title,
  rows,
  lowProgressAlert,
  expanded,
  onToggle,
  formatCurrency,
  emptyMessage,
  overallPct,
  overallBreakdown,
}) => (
  <Card className="shadow-sm border-0 h-100">
    <Card.Header className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
      <div className="fw-semibold d-flex align-items-center gap-2">
        <TrendingUp size={16} /> {title}
      </div>
      <div className="d-flex align-items-center gap-2">
        {overallPct !== null && (
          <span
            title={overallBreakdown || undefined}
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {overallPct}% complete
          </span>
        )}
        <Badge bg={rows.length > 0 ? 'info' : 'secondary'} pill>
          {rows.length}
        </Badge>
      </div>
    </Card.Header>
    <Card.Body className="p-3" style={{ overflowY: 'auto', maxHeight: 'clamp(300px, 58vh, 800px)' }}>
      {lowProgressAlert && lowProgressAlert.length > 0 && (
        <Alert variant="warning" className="py-2 mb-3">
          <div className="fw-semibold small mb-1">
            Goals due this sprint with low progress (&lt;25% points complete)
          </div>
          <ul className="mb-0 small">
            {lowProgressAlert.slice(0, 5).map((goalRow) => (
              <li key={goalRow.id}>
                {goalRow.title}
                {' · '}
                {goalRow.pointsDone}/{goalRow.pointsTotal} pts ({goalRow.pointsProgressPct}%)
              </li>
            ))}
            {lowProgressAlert.length > 5 && (
              <li className="text-muted">+{lowProgressAlert.length - 5} more</li>
            )}
          </ul>
        </Alert>
      )}

      {rows.length === 0 ? (
        <div className="text-muted small">{emptyMessage}</div>
      ) : (
        rows.map((row) => {
          const isOpen = !!expanded[row.themeKey];
          const pointsPct = row.pointsTotal > 0
            ? Math.round((row.pointsDone / row.pointsTotal) * 100)
            : 0;
          const transferPct = row.potTarget > 0
            ? Math.max(0, Math.min(100, Math.round(((row.potNetTransferredPence / 100) / row.potTarget) * 100)))
            : 0;
          return (
            <div key={row.themeKey} className="border rounded p-2 mb-2">
              <div className="d-flex align-items-start justify-content-between gap-2">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: row.color,
                      border: '1px solid rgba(0,0,0,0.12)',
                      display: 'inline-block',
                    }}
                  />
                  <span className="fw-semibold small">{row.themeLabel}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    {row.completedItems}/{row.totalItems} complete ({row.progressPct}%)
                  </span>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  className="text-decoration-none p-0"
                  onClick={() => onToggle(row.themeKey)}
                >
                  {isOpen ? 'Hide goals' : 'Show goals'}
                </Button>
              </div>

              <div
                style={{
                  height: 6,
                  background: 'rgba(0,0,0,0.08)',
                  borderRadius: 999,
                  overflow: 'hidden',
                  marginTop: 8,
                }}
              >
                <div
                  style={{ width: `${row.progressPct}%`, height: '100%', background: row.color }}
                />
              </div>

              <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
                <Badge bg="secondary">{row.goalsDone}/{row.goalsTotal} goals</Badge>
                <Badge bg="secondary">{row.storiesDone}/{row.storiesTotal} stories ({row.storiesProgressPct}%)</Badge>
                <Badge bg="secondary">{row.tasksDone}/{row.tasksTotal} tasks</Badge>
                {row.pointsTotal > 0 && (
                  <Badge bg="primary">{row.pointsDone}/{row.pointsTotal} pts ({pointsPct}%)</Badge>
                )}
                {row.potTarget > 0 && (
                  <Badge bg="success">
                    Pot net {formatCurrency(row.potNetTransferredPence, row.potCurrency)} ({transferPct}%)
                    {' '}· In {formatCurrency(row.potTransferredInPence, row.potCurrency)} · Out {formatCurrency(row.potTransferredOutPence, row.potCurrency)}
                  </Badge>
                )}
              </div>

              {isOpen && (
                <div className="mt-2">
                  {row.goalRows.length === 0 ? (
                    <div className="text-muted small">No goals in this theme for the selected scope.</div>
                  ) : (
                    row.goalRows.map((goalRow) => (
                      <div key={goalRow.id} className="border rounded p-2 mb-2">
                        <div className="d-flex align-items-start justify-content-between gap-2">
                          <div className="fw-semibold small flex-grow-1 d-flex align-items-center gap-2 flex-wrap">
                            <span>{goalRow.title}</span>
                            {goalRow.isFocusGoal && (
                              <Badge bg="warning" text="dark">Focus</Badge>
                            )}
                          </div>
                          <Badge bg={goalRow.statusBg}>{goalRow.statusLabel}</Badge>
                        </div>
                        <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            Stories {goalRow.storiesDone}/{goalRow.storiesTotal} ({goalRow.storiesProgressPct}%)
                          </span>
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            Tasks {goalRow.tasksDone}/{goalRow.tasksTotal}
                          </span>
                          {goalRow.pointsTotal > 0 && (
                            <span className="text-muted" style={{ fontSize: 11 }}>
                              Points {goalRow.pointsDone}/{goalRow.pointsTotal}
                            </span>
                          )}
                          {goalRow.dueThisSprint && (
                            <span className="text-warning-emphasis" style={{ fontSize: 11 }}>
                              Due this sprint
                            </span>
                          )}
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            Progress {goalRow.progressPct}%
                          </span>
                        </div>
                        <div
                          style={{
                            height: 5,
                            background: 'rgba(0,0,0,0.08)',
                            borderRadius: 999,
                            overflow: 'hidden',
                            marginTop: 6,
                          }}
                        >
                          <div
                            style={{
                              width: `${goalRow.progressPct}%`,
                              height: '100%',
                              background: row.color,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </Card.Body>
  </Card>
);

// ── Main component ─────────────────────────────────────────────────────────────

const ThemeProgressDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId, setSelectedSprintId, sprints, sprintsById } = useSprint();
  const { themes: globalThemes } = useGlobalThemes();

  const selectedSprint = selectedSprintId ? (sprintsById[selectedSprintId] ?? null) : (sprints[0] ?? null);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [pots, setPots] = useState<Record<string, PotInfo>>({});
  const [potTransfers, setPotTransfers] = useState<Record<string, PotTransferInfo>>({});
  const [goalKpiMetrics, setGoalKpiMetrics] = useState<Record<string, { resolvedKpis?: any[]; updatedAt?: any }>>({});
  const [focusGoals, setFocusGoals] = useState<FocusGoal[]>([]);
  const [focusGoalsLoading, setFocusGoalsLoading] = useState(true);
  const [focusGoalsRefreshing, setFocusGoalsRefreshing] = useState(false);

  const [sprintExpanded, setSprintExpanded] = useState<Record<string, boolean>>({});
  const [overallExpanded, setOverallExpanded] = useState<Record<string, boolean>>({});

  // KPI section scope (kept at bottom)
  const [kpiScope, setKpiScope] = useState<'sprint' | 'year' | 'goal'>('sprint');

  const [goalsLoading, setGoalsLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);

  // Goals + stories + focus goals subscriptions
  useEffect(() => {
    if (!currentUser) {
      setGoals([]);
      setAllStories([]);
      setFocusGoals([]);
      setGoalsLoading(false);
      setStoriesLoading(false);
      setFocusGoalsLoading(false);
      return;
    }
    setGoalsLoading(true);
    setStoriesLoading(true);
    setFocusGoalsLoading(true);

    const goalsUnsub = onSnapshot(
      query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => { setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[]); setGoalsLoading(false); },
      () => setGoalsLoading(false),
    );
    const storiesUnsub = onSnapshot(
      query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => { setAllStories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Story[]); setStoriesLoading(false); },
      () => setStoriesLoading(false),
    );
    const focusGoalsUnsub = onSnapshot(
      query(collection(db, 'focusGoals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => { setFocusGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FocusGoal[]); setFocusGoalsLoading(false); },
      () => setFocusGoalsLoading(false),
    );
    return () => { goalsUnsub(); storiesUnsub(); focusGoalsUnsub(); };
  }, [currentUser, currentPersona]);

  const handleManualFocusGoalsRefresh = useCallback(async () => {
    if (!currentUser?.uid) return;
    setFocusGoalsRefreshing(true);
    try {
      await triggerFocusGoalDataRefresh({ forceSnapshotRefresh: true });
    } catch (error) {
      console.error('Failed to manually refresh focus goals:', error);
    } finally {
      setFocusGoalsRefreshing(false);
    }
  }, [currentUser?.uid]);

  // Tasks subscription (filtered by selected sprint)
  useEffect(() => {
    if (!currentUser || !selectedSprintId) {
      setSprintTasks([]);
      setTasksLoading(false);
      return;
    }
    setTasksLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('sprintId', '==', selectedSprintId),
      ),
      (snap) => { setSprintTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Task[]); setTasksLoading(false); },
      () => setTasksLoading(false),
    );
    return () => unsub();
  }, [currentUser, selectedSprintId]);

  // Pots subscription
  useEffect(() => {
    if (!currentUser) { setPots({}); return; }
    const unsub = onSnapshot(
      query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid)),
      (snap) => {
        const map: Record<string, PotInfo> = {};
        snap.docs.forEach((doc) => {
          const data = doc.data() as any;
          const baseId = data.potId || doc.id;
          if (!baseId) return;
          const info: PotInfo = { name: data.name || baseId, balance: Number(data.balance || 0), currency: data.currency || 'GBP' };
          const register = (id: string) => { if (id) map[id] = info; };
          register(baseId);
          if (currentUser?.uid) {
            if (baseId.startsWith(`${currentUser.uid}_`)) register(baseId.replace(`${currentUser.uid}_`, ''));
            else register(`${currentUser.uid}_${baseId}`);
          }
        });
        setPots(map);
      },
      () => {},
    );
    return () => unsub();
  }, [currentUser]);

  // Pot transfer subscription (monzo transactions)
  useEffect(() => {
    if (!currentUser) {
      setPotTransfers({});
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'monzo_transactions'), where('ownerUid', '==', currentUser.uid)),
      (snap) => {
        const map: Record<string, PotTransferInfo> = {};
        const registerTransfer = (id: string | null | undefined, direction: 'in' | 'out', amountPence: number, currency: string) => {
          if (!id || amountPence <= 0) return;
          const existing = map[id] || { transferredInPence: 0, transferredOutPence: 0, currency };
          if (direction === 'in') existing.transferredInPence += amountPence;
          if (direction === 'out') existing.transferredOutPence += amountPence;
          existing.currency = existing.currency || currency;
          map[id] = existing;
        };
        const registerAliases = (baseId: string | null | undefined, direction: 'in' | 'out', amountPence: number, currency: string) => {
          if (!baseId) return;
          registerTransfer(baseId, direction, amountPence, currency);
          if (currentUser?.uid) {
            if (baseId.startsWith(`${currentUser.uid}_`)) {
              registerTransfer(baseId.replace(`${currentUser.uid}_`, ''), direction, amountPence, currency);
            } else {
              registerTransfer(`${currentUser.uid}_${baseId}`, direction, amountPence, currency);
            }
          }
        };

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const metadata = (data.metadata || {}) as any;
          const amountPence = Math.abs(Number(data.amount || 0));
          if (!amountPence) return;
          const currency = String(data.currency || 'GBP');

          const destinationPotId = metadata.destination_pot_id ? String(metadata.destination_pot_id) : null;
          const sourcePotId = metadata.source_pot_id ? String(metadata.source_pot_id) : null;
          const fallbackPotId = metadata.pot_id ? String(metadata.pot_id) : null;

          if (destinationPotId) {
            registerAliases(destinationPotId, 'in', amountPence, currency);
          }
          if (sourcePotId) {
            registerAliases(sourcePotId, 'out', amountPence, currency);
          }

          if (!destinationPotId && !sourcePotId && fallbackPotId) {
            const direction: 'in' | 'out' = Number(data.amount || 0) < 0 ? 'in' : 'out';
            registerAliases(fallbackPotId, direction, amountPence, currency);
          }
        });

        setPotTransfers(map);
      },
      () => setPotTransfers({}),
    );
    return () => unsub();
  }, [currentUser]);

  // Goal KPI metrics subscription
  useEffect(() => {
    if (!currentUser) { setGoalKpiMetrics({}); setKpiLoading(false); return; }
    setKpiLoading(true);
    const unsub = onSnapshot(
      query(collection(db, 'goal_kpi_metrics'), where('ownerUid', '==', currentUser.uid)),
      (snap) => {
        const map: Record<string, { resolvedKpis?: any[]; updatedAt?: any }> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const goalId = String(data.goalId || '').trim();
          if (!goalId) return;
          map[goalId] = { resolvedKpis: Array.isArray(data.resolvedKpis) ? data.resolvedKpis : [], updatedAt: data.updatedAt || null };
        });
        setGoalKpiMetrics(map);
        setKpiLoading(false);
      },
      () => { setGoalKpiMetrics({}); setKpiLoading(false); },
    );
    return () => unsub();
  }, [currentUser]);

  // ── Theme palette & resolver ───────────────────────────────────────────────

  const themePalette = useMemo(
    () => (globalThemes && globalThemes.length ? globalThemes : GLOBAL_THEMES),
    [globalThemes],
  );

  const themeFor = useCallback((value: any): GlobalTheme | undefined => {
    if (value == null) return undefined;
    const idNum = Number(value);
    if (Number.isFinite(idNum)) {
      const match = themePalette.find((t) => t.id === idNum);
      if (match) return match;
    }
    const asString = String(value).trim();
    const lower = asString.toLowerCase();
    const direct = themePalette.find(
      (t) => t.label === asString || t.name === asString || String(t.id) === asString || t.label.toLowerCase() === lower || t.name.toLowerCase() === lower,
    );
    if (direct) return direct;
    const legacyEntry = Object.entries(LEGACY_THEME_MAP).find(([key]) => key.toLowerCase() === lower);
    if (legacyEntry) {
      const legacyId = Number(legacyEntry[1]);
      return themePalette.find((t) => t.id === legacyId);
    }
    return undefined;
  }, [themePalette]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const resolveThemeId = useCallback((value: any): number => {
    const match = themeFor(value);
    return typeof match?.id === 'number' ? match.id : 0;
  }, [themeFor]);

  const activeFocusGoalIds = useMemo(() => {
    const ids = new Set<string>();
    focusGoals
      .filter((entry) => Boolean((entry as any)?.isActive))
      .forEach((entry) => {
        (entry.goalIds || []).forEach((goalId) => {
          if (goalId) ids.add(String(goalId));
        });
      });
    return ids;
  }, [focusGoals]);

  const resolveGoalPotTransfers = useCallback((goal: Goal) => {
    const target = Number((goal as any).estimatedCost || 0);
    const rawPotId = (goal as any).linkedPotId || (goal as any).potId || null;
    if (!rawPotId) {
      return {
        potTransferredInPence: 0,
        potTransferredOutPence: 0,
        potNetTransferredPence: 0,
        potTarget: Number.isFinite(target) ? target : 0,
        potCurrency: 'GBP',
      };
    }
    const base = String(rawPotId);
    const candidates = [base];
    if (currentUser?.uid && base.startsWith(`${currentUser.uid}_`)) candidates.push(base.replace(`${currentUser.uid}_`, ''));
    else if (currentUser?.uid) candidates.push(`${currentUser.uid}_${base}`);
    const transferKey = candidates.find((id) => potTransfers[id]);
    const transfer = transferKey ? potTransfers[transferKey] : null;
    const potKey = candidates.find((id) => pots[id]);
    const pot = potKey ? pots[potKey] : null;
    const transferredInPence = Number(transfer?.transferredInPence || 0);
    const transferredOutPence = Number(transfer?.transferredOutPence || 0);
    return {
      potTransferredInPence: transferredInPence,
      potTransferredOutPence: transferredOutPence,
      potNetTransferredPence: transferredInPence - transferredOutPence,
      potTarget: Number.isFinite(target) ? target : 0,
      potCurrency: transfer?.currency || pot?.currency || 'GBP',
    };
  }, [currentUser?.uid, potTransfers, pots]);

  const formatCurrency = useCallback((pence: number, currency = 'GBP') => {
    return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency });
  }, []);

  const resolveGoalStatus = (goal: Goal) => {
    const statusNum = Number((goal as any).status);
    const statusLabel = Number.isFinite(statusNum)
      ? (statusNum === 2 ? 'Complete' : statusNum === 1 ? 'In Progress' : statusNum === 3 ? 'Blocked' : statusNum === 4 ? 'Deferred' : 'New')
      : String((goal as any).status || 'New');
    const statusBg = Number.isFinite(statusNum)
      ? (statusNum === 2 ? 'success' : statusNum === 1 ? 'primary' : statusNum === 3 ? 'warning' : statusNum === 4 ? 'secondary' : 'dark')
      : 'secondary';
    return { statusLabel, statusBg };
  };

  // ── Sprint stories (filtered from allStories) ──────────────────────────────

  const sprintStories = useMemo(() => {
    if (!selectedSprintId) return [];
    return allStories.filter((s) => String((s as any).sprintId || '') === selectedSprintId);
  }, [allStories, selectedSprintId]);

  // ── Sprint theme rows (Dashboard-style: includes tasks) ───────────────────

  const sprintThemeRows = useMemo<ThemeRow[]>(() => {
    if (!selectedSprint) return [];

    const sprintStartMs = toMs((selectedSprint as any).startDate || (selectedSprint as any).start || null);
    const sprintEndMs = toMs((selectedSprint as any).endDate || (selectedSprint as any).end || null);

    const resolveGoalDueMs = (goal: Goal): number | null => {
      const candidate = (goal as any).dueDate ?? (goal as any).endDate ?? (goal as any).targetDate ?? null;
      if (!candidate) return null;
      const ms = toMs(candidate);
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    };

    const isGoalDueThisSprint = (goal: Goal): boolean => {
      if (!Number.isFinite(sprintStartMs) || !Number.isFinite(sprintEndMs) || !sprintStartMs || !sprintEndMs) return false;
      const dueMs = resolveGoalDueMs(goal);
      if (!dueMs) return false;
      return dueMs >= sprintStartMs && dueMs <= sprintEndMs;
    };

    const storyById = new Map<string, Story>();
    sprintStories.forEach((s) => { if (s?.id) storyById.set(s.id, s); });

    const storiesByGoal = new Map<string, Story[]>();
    sprintStories.forEach((s) => {
      const gId = String((s as any).goalId || '').trim();
      if (!gId) return;
      const list = storiesByGoal.get(gId) || [];
      list.push(s);
      storiesByGoal.set(gId, list);
    });

    const tasksByGoal = new Map<string, Task[]>();
    sprintTasks.forEach((task) => {
      let gId = String((task as any).goalId || '').trim();
      if (!gId && task.storyId) gId = String(storyById.get(task.storyId)?.goalId || '').trim();
      if (!gId) return;
      const list = tasksByGoal.get(gId) || [];
      list.push(task);
      tasksByGoal.set(gId, list);
    });

    const sprintGoalIds = new Set<string>();
    storiesByGoal.forEach((_, gId) => sprintGoalIds.add(gId));
    tasksByGoal.forEach((_, gId) => sprintGoalIds.add(gId));

    const isGoalInSprintContext = (goal: Goal): boolean =>
      sprintGoalIds.has(goal.id) || isGoalDueThisSprint(goal);

    const rows: ThemeRow[] = [];
    themePalette.forEach((theme) => {
      const themeId = Number(theme.id);
      const themeGoals = goals.filter((g) => resolveThemeId((g as any).theme) === themeId && isGoalInSprintContext(g));
      const themeGoalIds = new Set(themeGoals.map((g) => g.id));

      const themeStories = sprintStories.filter((s) => {
        if (resolveThemeId((s as any).theme) === themeId) return true;
        return !!(s.goalId && themeGoalIds.has(s.goalId));
      });
      const themeStoryIds = new Set(themeStories.map((s) => s.id));

      const themeTasks = sprintTasks.filter((t) => {
        if (resolveThemeId((t as any).theme) === themeId) return true;
        if ((t as any).goalId && themeGoalIds.has((t as any).goalId)) return true;
        if (t.storyId && themeStoryIds.has(t.storyId)) return true;
        if (t.storyId) {
          const storyGoalId = String(storyById.get(t.storyId)?.goalId || '').trim();
          if (storyGoalId && themeGoalIds.has(storyGoalId)) return true;
        }
        return false;
      });

      const totalItems = themeGoals.length + themeStories.length + themeTasks.length;
      if (totalItems === 0) return;

      const goalRows: ThemeGoalRow[] = themeGoals.map((goal) => {
        const goalStories = storiesByGoal.get(goal.id) || [];
        const goalTasks = tasksByGoal.get(goal.id) || [];
        const storiesDone = goalStories.filter((s) => isStoryDone((s as any).status)).length;
        const storiesProgressPct = goalStories.length > 0 ? Math.round((storiesDone / goalStories.length) * 100) : 0;
        const tasksDone = goalTasks.filter((t) => isTaskDone((t as any).status)).length;
        const pointsTotal = goalStories.reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
        const pointsDone = goalStories.filter((s) => isStoryDone((s as any).status)).reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
        const pointsProgressPct = pointsTotal > 0 ? Math.round((pointsDone / pointsTotal) * 100) : (isGoalDone((goal as any).status) ? 100 : 0);
        const totalChildItems = goalStories.length + goalTasks.length;
        const progressPct = pointsTotal > 0 ? pointsProgressPct : totalChildItems > 0 ? Math.round(((storiesDone + tasksDone) / totalChildItems) * 100) : (isGoalDone((goal as any).status) ? 100 : 0);
        const dueDateMs = resolveGoalDueMs(goal);
        const dueThisSprint = !!(dueDateMs && sprintStartMs && sprintEndMs && dueDateMs >= sprintStartMs && dueDateMs <= sprintEndMs);
        const { statusLabel, statusBg } = resolveGoalStatus(goal);
        const transfer = resolveGoalPotTransfers(goal);
        return { id: goal.id, title: goal.title || goal.id, status: (goal as any).status, statusLabel, statusBg, storiesDone, storiesTotal: goalStories.length, storiesProgressPct, tasksDone, tasksTotal: goalTasks.length, pointsDone, pointsTotal, pointsProgressPct, progressPct, dueDateMs, dueThisSprint, isFocusGoal: isGoalInHierarchySet(goal.id, goals, activeFocusGoalIds), ...transfer };
      }).sort((a, b) => {
        if (a.dueThisSprint !== b.dueThisSprint) return a.dueThisSprint ? -1 : 1;
        if (a.pointsProgressPct !== b.pointsProgressPct) return a.pointsProgressPct - b.pointsProgressPct;
        return a.title.localeCompare(b.title);
      });

      const goalsDone = themeGoals.filter((g) => isGoalDone((g as any).status)).length;
      const storiesDone = themeStories.filter((s) => isStoryDone((s as any).status)).length;
      const storiesProgressPct = themeStories.length > 0 ? Math.round((storiesDone / themeStories.length) * 100) : 0;
      const tasksDone = themeTasks.filter((t) => isTaskDone((t as any).status)).length;
      const pointsTotal = themeStories.reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
      const pointsDone = themeStories.filter((s) => isStoryDone((s as any).status)).reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
      const completedItems = goalsDone + storiesDone + tasksDone;
      const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      const potTransferredInPence = goalRows.reduce((sum, r) => sum + r.potTransferredInPence, 0);
      const potTransferredOutPence = goalRows.reduce((sum, r) => sum + r.potTransferredOutPence, 0);
      const potNetTransferredPence = goalRows.reduce((sum, r) => sum + r.potNetTransferredPence, 0);
      const potTarget = goalRows.reduce((sum, r) => sum + r.potTarget, 0);
      const potCurrency = goalRows.find((r) => r.potCurrency)?.potCurrency || 'GBP';

      rows.push({ themeKey: String(theme.id), themeId, themeLabel: theme.label || theme.name || `Theme ${theme.id}`, color: theme.color || '#6c757d', textColor: theme.textColor || '#ffffff', goalsDone, goalsTotal: themeGoals.length, storiesDone, storiesTotal: themeStories.length, storiesProgressPct, tasksDone, tasksTotal: themeTasks.length, pointsDone, pointsTotal, completedItems, totalItems, progressPct, goalRows, potTransferredInPence, potTransferredOutPence, potNetTransferredPence, potTarget, potCurrency });
    });

    return rows.sort((a, b) => b.pointsTotal !== a.pointsTotal ? b.pointsTotal - a.pointsTotal : b.totalItems - a.totalItems);
  }, [goals, sprintStories, sprintTasks, selectedSprint, themePalette, resolveThemeId, resolveGoalPotTransfers, activeFocusGoalIds]);

  // ── Low progress goals due this sprint (for sprint widget alert) ───────────

  const lowProgressGoals = useMemo(() => {
    const result: ThemeGoalRow[] = [];
    sprintThemeRows.forEach((themeRow) => {
      themeRow.goalRows.forEach((goalRow) => {
        if (!goalRow.dueThisSprint) return;
        if (goalRow.pointsProgressPct >= 25) return;
        result.push(goalRow);
      });
    });
    return result.sort((a, b) => {
      if (a.pointsProgressPct !== b.pointsProgressPct) return a.pointsProgressPct - b.pointsProgressPct;
      return a.title.localeCompare(b.title);
    });
  }, [sprintThemeRows]);

  // ── Overall theme rows (all goals + stories, no sprint filter) ────────────

  const overallThemeRows = useMemo<ThemeRow[]>(() => {
    const storiesByGoal = new Map<string, Story[]>();
    allStories.forEach((s) => {
      const gId = String((s as any).goalId || '').trim();
      if (!gId) return;
      const list = storiesByGoal.get(gId) || [];
      list.push(s);
      storiesByGoal.set(gId, list);
    });

    const rows: ThemeRow[] = [];
    themePalette.forEach((theme) => {
      const themeId = Number(theme.id);
      const themeGoals = goals.filter((g) => resolveThemeId((g as any).theme) === themeId);
      const themeGoalIds = new Set(themeGoals.map((g) => g.id));
      const themeStories = allStories.filter((s) => {
        if (resolveThemeId((s as any).theme) === themeId) return true;
        return !!(s.goalId && themeGoalIds.has(s.goalId));
      });
      const totalItems = themeGoals.length + themeStories.length;
      if (totalItems === 0) return;

      const goalRows: ThemeGoalRow[] = themeGoals.map((goal) => {
        const goalStories = storiesByGoal.get(goal.id) || [];
        const storiesDone = goalStories.filter((s) => isStoryDone((s as any).status)).length;
        const storiesProgressPct = goalStories.length > 0 ? Math.round((storiesDone / goalStories.length) * 100) : 0;
        const pointsTotal = goalStories.reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
        const pointsDone = goalStories.filter((s) => isStoryDone((s as any).status)).reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
        const pointsProgressPct = pointsTotal > 0 ? Math.round((pointsDone / pointsTotal) * 100) : (isGoalDone((goal as any).status) ? 100 : 0);
        const progressPct = pointsTotal > 0 ? pointsProgressPct : goalStories.length > 0 ? Math.round((storiesDone / goalStories.length) * 100) : (isGoalDone((goal as any).status) ? 100 : 0);
        const { statusLabel, statusBg } = resolveGoalStatus(goal);
        const transfer = resolveGoalPotTransfers(goal);
        return { id: goal.id, title: goal.title || goal.id, status: (goal as any).status, statusLabel, statusBg, storiesDone, storiesTotal: goalStories.length, storiesProgressPct, tasksDone: 0, tasksTotal: 0, pointsDone, pointsTotal, pointsProgressPct, progressPct, dueDateMs: null, dueThisSprint: false, isFocusGoal: isGoalInHierarchySet(goal.id, goals, activeFocusGoalIds), ...transfer };
      }).sort((a, b) => a.progressPct - b.progressPct || a.title.localeCompare(b.title));

      const goalsDone = themeGoals.filter((g) => isGoalDone((g as any).status)).length;
      const storiesDone = themeStories.filter((s) => isStoryDone((s as any).status)).length;
      const storiesProgressPct = themeStories.length > 0 ? Math.round((storiesDone / themeStories.length) * 100) : 0;
      const pointsTotal = themeStories.reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
      const pointsDone = themeStories.filter((s) => isStoryDone((s as any).status)).reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
      const completedItems = goalsDone + storiesDone;
      const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      const potTransferredInPence = goalRows.reduce((sum, r) => sum + r.potTransferredInPence, 0);
      const potTransferredOutPence = goalRows.reduce((sum, r) => sum + r.potTransferredOutPence, 0);
      const potNetTransferredPence = goalRows.reduce((sum, r) => sum + r.potNetTransferredPence, 0);
      const potTarget = goalRows.reduce((sum, r) => sum + r.potTarget, 0);
      const potCurrency = goalRows.find((r) => r.potCurrency)?.potCurrency || 'GBP';

      rows.push({ themeKey: String(theme.id), themeId, themeLabel: theme.label || theme.name || `Theme ${theme.id}`, color: theme.color || '#6c757d', textColor: theme.textColor || '#ffffff', goalsDone, goalsTotal: themeGoals.length, storiesDone, storiesTotal: themeStories.length, storiesProgressPct, tasksDone: 0, tasksTotal: 0, pointsDone, pointsTotal, completedItems, totalItems, progressPct, goalRows, potTransferredInPence, potTransferredOutPence, potNetTransferredPence, potTarget, potCurrency });
    });

    return rows.sort((a, b) => b.pointsTotal !== a.pointsTotal ? b.pointsTotal - a.pointsTotal : b.totalItems - a.totalItems);
  }, [goals, allStories, themePalette, resolveThemeId, resolveGoalPotTransfers, activeFocusGoalIds]);

  // ── Goal KPI rows (bottom section) ────────────────────────────────────────

  const currentYear = new Date().getFullYear();
  const yearStartMs = new Date(currentYear, 0, 1).getTime();
  const yearEndMs = new Date(currentYear, 11, 31, 23, 59, 59, 999).getTime();

  const kpiScopedStories = useMemo(() => {
    if (kpiScope === 'sprint') {
      return sprintStories;
    }
    if (kpiScope === 'year') {
      return allStories.filter((s) => {
        const candidates = [(s as any).targetDate, (s as any).dueDate, (s as any).plannedStartDate, (s as any).createdAt, (s as any).updatedAt].map(toMs);
        return candidates.some((ms) => ms > 0 && ms >= yearStartMs && ms <= yearEndMs);
      });
    }
    return allStories;
  }, [kpiScope, sprintStories, allStories, yearStartMs, yearEndMs]);

  const kpiScopedGoals = useMemo(() => {
    const storiesGoalIds = new Set(kpiScopedStories.map((s) => s.goalId).filter(Boolean) as string[]);
    if (kpiScope === 'sprint') return goals.filter((g) => storiesGoalIds.has(g.id));
    if (kpiScope === 'year') {
      return goals.filter((g) => {
        if (storiesGoalIds.has(g.id)) return true;
        if (Number((g as any).targetYear) === currentYear) return true;
        const candidates = [(g as any).startDate, (g as any).targetDate, (g as any).endDate, (g as any).createdAt, (g as any).updatedAt].map(toMs);
        return candidates.some((ms) => ms > 0 && ms >= yearStartMs && ms <= yearEndMs);
      });
    }
    return goals;
  }, [kpiScope, goals, kpiScopedStories, currentYear, yearStartMs, yearEndMs]);

  const kpiScopeLabel = useMemo(() => {
    if (kpiScope === 'sprint') return selectedSprint?.name || 'active sprint';
    if (kpiScope === 'year') return String(currentYear);
    return 'goal timeline';
  }, [kpiScope, selectedSprint, currentYear]);

  const kpiExpectedProgress = useMemo(() => {
    if (kpiScope === 'sprint') {
      const startMs = toMs((selectedSprint as any)?.startDate || (selectedSprint as any)?.start || null);
      const endMs = toMs((selectedSprint as any)?.endDate || (selectedSprint as any)?.end || null);
      return computeWindowExpectedProgress(startMs > 0 ? startMs : null, endMs > 0 ? endMs : null);
    }
    if (kpiScope === 'year') return computeWindowExpectedProgress(yearStartMs, yearEndMs);
    return null;
  }, [kpiScope, selectedSprint, yearStartMs, yearEndMs]);

  const goalKpiRows = useMemo(() => {
    const storiesByGoal = new Map<string, Story[]>();
    kpiScopedStories.forEach((s) => {
      const gId = String(s.goalId || '').trim();
      if (!gId) return;
      const list = storiesByGoal.get(gId) || [];
      list.push(s);
      storiesByGoal.set(gId, list);
    });

    return kpiScopedGoals.map((goal) => {
      const goalStories = storiesByGoal.get(goal.id) || [];
      const totalPoints = goalStories.reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
      const donePoints = goalStories.filter((s) => isStoryDone((s as any).status)).reduce((sum, s) => sum + (Number((s as any).points || 0) || 0), 0);
      const doneCount = goalStories.filter((s) => isStoryDone((s as any).status)).length;
      const storyProgressPct = goalStories.length
        ? (totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : Math.round((doneCount / goalStories.length) * 100))
        : null;
      const transfer = resolveGoalPotTransfers(goal);
      const netTransferMajor = transfer.potNetTransferredPence / 100;
      const transferPct = transfer.potTarget > 0
        ? Math.max(0, Math.min(100, Math.round((netTransferMajor / transfer.potTarget) * 100)))
        : null;
      const fallbackParts = [storyProgressPct, transferPct].filter((v): v is number => v != null);
      const fallbackProgressPct = fallbackParts.length ? Math.round(fallbackParts.reduce((sum, v) => sum + v, 0) / fallbackParts.length) : null;
      const startMs = toMs((goal as any).startDate || goal.createdAt || null);
      const endMs = toMs((goal as any).endDate || (goal as any).targetDate || null);
      const expectedProgressPct = kpiScope === 'goal'
        ? computeWindowExpectedProgress(startMs > 0 ? startMs : null, endMs > 0 ? endMs : null)
        : kpiExpectedProgress;
      const resolvedKpis = Array.isArray(goalKpiMetrics[goal.id]?.resolvedKpis) ? goalKpiMetrics[goal.id]?.resolvedKpis || [] : [];
      const status = evaluateGoalTargetStatus({ resolvedKpis, fallbackProgressPct, expectedProgressPct, scopeLabel: kpiScopeLabel });
      return { goalId: goal.id, goalTitle: goal.title || goal.id, progressPct: status.progressPct, expectedProgressPct, statusLabel: status.label, statusTone: status.tone, reason: status.reason, kpiSummary: status.kpiSummary };
    }).sort((a, b) => {
      const order: Record<string, number> = { Behind: 0, 'On target': 1, 'No KPI': 2 };
      const byStatus = (order[a.statusLabel] ?? 9) - (order[b.statusLabel] ?? 9);
      if (byStatus !== 0) return byStatus;
      return (a.progressPct ?? -1) - (b.progressPct ?? -1);
    });
  }, [kpiScopedStories, kpiScopedGoals, goalKpiMetrics, kpiScope, kpiExpectedProgress, kpiScopeLabel, resolveGoalPotTransfers]);

  const loading = goalsLoading || storiesLoading || tasksLoading || kpiLoading;

  const sprintOverallPct = useMemo(() => {
    const totalPts = sprintThemeRows.reduce((s, r) => s + r.pointsTotal, 0);
    const donePts = sprintThemeRows.reduce((s, r) => s + r.pointsDone, 0);
    const totalTransfers = sprintThemeRows.reduce((s, r) => s + r.potTarget, 0);
    const doneTransfers = sprintThemeRows.reduce((s, r) => s + r.potNetTransferredPence / 100, 0);
    const parts: number[] = [];
    if (totalPts > 0) parts.push(Math.round((donePts / totalPts) * 100));
    if (totalTransfers > 0) parts.push(Math.max(0, Math.min(100, Math.round((doneTransfers / totalTransfers) * 100))));
    return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  }, [sprintThemeRows]);

  const sprintOverallBreakdown = useMemo(() => {
    const parts: string[] = [];
    const totalPts = sprintThemeRows.reduce((s, r) => s + r.pointsTotal, 0);
    const donePts = sprintThemeRows.reduce((s, r) => s + r.pointsDone, 0);
    const totalTransfers = sprintThemeRows.reduce((s, r) => s + r.potTarget, 0);
    const doneTransfers = sprintThemeRows.reduce((s, r) => s + r.potNetTransferredPence / 100, 0);
    if (totalPts > 0) parts.push(`Story points ${Math.round((donePts / totalPts) * 100)}%`);
    if (totalTransfers > 0) parts.push(`Net transfers ${Math.max(0, Math.min(100, Math.round((doneTransfers / totalTransfers) * 100)))}%`);
    return parts.join(' • ');
  }, [sprintThemeRows]);

  const overallOverallPct = useMemo(() => {
    const totalPts = overallThemeRows.reduce((s, r) => s + r.pointsTotal, 0);
    const donePts = overallThemeRows.reduce((s, r) => s + r.pointsDone, 0);
    const totalTransfers = overallThemeRows.reduce((s, r) => s + r.potTarget, 0);
    const doneTransfers = overallThemeRows.reduce((s, r) => s + r.potNetTransferredPence / 100, 0);
    const parts: number[] = [];
    if (totalPts > 0) parts.push(Math.round((donePts / totalPts) * 100));
    if (totalTransfers > 0) parts.push(Math.max(0, Math.min(100, Math.round((doneTransfers / totalTransfers) * 100))));
    return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  }, [overallThemeRows]);

  const overallOverallBreakdown = useMemo(() => {
    const parts: string[] = [];
    const totalPts = overallThemeRows.reduce((s, r) => s + r.pointsTotal, 0);
    const donePts = overallThemeRows.reduce((s, r) => s + r.pointsDone, 0);
    const totalTransfers = overallThemeRows.reduce((s, r) => s + r.potTarget, 0);
    const doneTransfers = overallThemeRows.reduce((s, r) => s + r.potNetTransferredPence / 100, 0);
    if (totalPts > 0) parts.push(`Story points ${Math.round((donePts / totalPts) * 100)}%`);
    if (totalTransfers > 0) parts.push(`Net transfers ${Math.max(0, Math.min(100, Math.round((doneTransfers / totalTransfers) * 100)))}%`);
    return parts.join(' • ');
  }, [overallThemeRows]);

  return (
    <Container fluid className="py-2 py-lg-4" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2 mb-lg-4">
        <div>
          <h3 className="mb-1">Theme &amp; Goal Progress</h3>
          <div className="text-muted small">
            Sprint widget shows goals and themes active in the selected sprint. Overall widget shows all themes across all sprints.
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted small">Sprint:</span>
          <Form.Select
            size="sm"
            value={selectedSprintId || ''}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            style={{ minWidth: 200 }}
          >
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.id}</option>
            ))}
          </Form.Select>
        </div>
      </div>

      {/* Focus Goals Widget */}
      <FocusGoalsWidget
        focusGoals={focusGoals}
        goals={goals}
        loading={focusGoalsLoading}
        onManualRefresh={handleManualFocusGoalsRefresh}
        refreshing={focusGoalsRefreshing}
      />

      {/* Two widgets side by side */}
      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : (
        <Row className="g-2 g-lg-3 mb-2 mb-lg-4">
          <Col sm={6}>
            <ThemeProgressWidget
              title={`Sprint: ${selectedSprint?.name || 'No sprint selected'}`}
              rows={sprintThemeRows}
              lowProgressAlert={lowProgressGoals}
              expanded={sprintExpanded}
              onToggle={(key) => setSprintExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
              formatCurrency={formatCurrency}
              emptyMessage={selectedSprintId ? 'No sprint-linked goals, stories, or tasks are mapped to themes for the selected sprint.' : 'Select a sprint to see sprint progress.'}
              overallPct={sprintOverallPct}
              overallBreakdown={sprintOverallBreakdown}
            />
          </Col>
          <Col sm={6}>
            <ThemeProgressWidget
              title="Overall progress"
              rows={overallThemeRows}
              expanded={overallExpanded}
              onToggle={(key) => setOverallExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
              formatCurrency={formatCurrency}
              emptyMessage="No goals or stories found."
              overallPct={overallOverallPct}
              overallBreakdown={overallOverallBreakdown}
            />
          </Col>
        </Row>
      )}

      {/* Goal KPI Status (bottom) */}
      {!loading && (
        <div
          style={{
            border: `1px solid ${themeVars.border}`,
            borderRadius: 12,
            padding: 16,
            background: themeVars.card as string,
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          }}
        >
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <strong>Goal KPI Status</strong>
            <div className="d-flex align-items-center gap-2">
              <span className="text-muted small">Scope:</span>
              <div style={{ display: 'inline-flex', border: `1px solid ${themeVars.border}`, borderRadius: 999, overflow: 'hidden' }}>
                {([{ key: 'sprint', label: 'Sprint' }, { key: 'year', label: 'Year' }, { key: 'goal', label: 'Goal' }] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setKpiScope(opt.key)}
                    style={{
                      border: 'none',
                      padding: '4px 10px',
                      background: kpiScope === opt.key ? (themeVars.card as string) : 'transparent',
                      color: kpiScope === opt.key ? (themeVars.text as string) : (themeVars.muted as string),
                      fontSize: 12,
                      fontWeight: kpiScope === opt.key ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-muted small">{kpiScopeLabel}</span>
            </div>
          </div>
          {goalKpiRows.length === 0 ? (
            <div className="text-muted small">No goals found for this scope.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: themeVars.muted as string }}>
                  <th style={{ padding: '6px 8px' }}>Goal</th>
                  <th style={{ padding: '6px 8px' }}>KPI attached</th>
                  <th style={{ padding: '6px 8px' }}>Progress</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Why</th>
                </tr>
              </thead>
              <tbody>
                {goalKpiRows.map((row) => {
                  const statusColor = row.statusTone === 'success' ? '#059669' : row.statusTone === 'danger' ? '#dc2626' : '#6b7280';
                  const progressLabel = row.progressPct != null
                    ? `${Math.round(row.progressPct)}%${row.expectedProgressPct != null ? ` (exp ${Math.round(row.expectedProgressPct)}%)` : ''}`
                    : 'n/a';
                  return (
                    <tr key={row.goalId} style={{ borderTop: `1px solid ${themeVars.border}` }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{row.goalTitle}</td>
                      <td style={{ padding: '6px 8px' }}>{row.kpiSummary || 'No KPI attached'}</td>
                      <td style={{ padding: '6px 8px' }}>{progressLabel}</td>
                      <td style={{ padding: '6px 8px', color: statusColor, fontWeight: 700 }}>{row.statusLabel}</td>
                      <td style={{ padding: '6px 8px' }}>{row.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Container>
  );
};

export default ThemeProgressDashboard;

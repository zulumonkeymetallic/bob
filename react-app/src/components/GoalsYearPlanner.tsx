import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Col, Container, Dropdown, Form, InputGroup, Modal, Row } from 'react-bootstrap';
import { dropTargetForElements, monitorForElements, draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal } from '../types';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { getStatusName, getThemeName, isStatus } from '../utils/statusHelpers';
import { goalThemeColor, colorWithAlpha } from '../utils/storyCardFormatting';
import { themeVars } from '../utils/themeVars';
import SprintSelector from './SprintSelector';
import EditGoalModal from './EditGoalModal';
import { useSidebar } from '../contexts/SidebarContext';
import '../styles/KanbanCards.css';

interface GoalYearColumnProps {
  year: number | null;
  goals: Goal[];
  pots: Record<string, { name: string; balance: number }>;
  themePalette: any[];
  droppableId: string;
  showDescriptions: boolean;
  onEdit: (goal: Goal) => void;
}

const parseDateInput = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateInput = (date: Date) => date.toISOString().slice(0, 10);

const calculateDurationDays = (start?: string, end?: string) => {
  const startDate = parseDateInput(start || '');
  const endDate = parseDateInput(end || '');
  if (!startDate || !endDate) return '';
  const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  return diff >= 0 ? diff : '';
};

const addDaysToStart = (start: string, days: number) => {
  const startDate = parseDateInput(start);
  if (!startDate) return '';
  const next = new Date(startDate);
  next.setDate(next.getDate() + days);
  return formatDateInput(next);
};

const resolveGoalYear = (goal: Goal): number | null => {
  const explicit = (goal as any).targetYear;
  if (explicit) {
    const parsed = Number(explicit);
    if (Number.isFinite(parsed)) return parsed;
  }
  const endDate = (goal as any).endDate;
  if (endDate) {
    const ms = typeof endDate === 'number' ? endDate : endDate?.toDate?.()?.getTime?.();
    if (ms) return new Date(ms).getFullYear();
  }
  const targetDate = (goal as any).targetDate;
  if (targetDate) {
    const ms = typeof targetDate === 'number' ? targetDate : targetDate?.toDate?.()?.getTime?.();
    if (ms) return new Date(ms).getFullYear();
  }
  return null;
};

const formatMoney = (v: number) => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

const GoalYearCard: React.FC<{
  goal: Goal;
  themePalette: any[];
  pots: Record<string, { name: string; balance: number }>;
  showDescription: boolean;
  onEdit: (goal: Goal) => void;
}> = ({ goal, themePalette, pots, showDescription, onEdit }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({ type: 'goal', item: goal, id: goal.id }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [goal]);

  const themeColor = goalThemeColor(goal, themePalette) || (themeVars.brand as string);
  const estimated = Number((goal as any).estimatedCost || 0);
  const potId = (goal as any).linkedPotId || (goal as any).potId;
  const potInfo = potId ? pots[String(potId)] : undefined;
  const potBalance = potInfo?.balance || 0;
  const savingsPct = estimated > 0 ? Math.min(100, Math.round(((potBalance / 100) / estimated) * 100)) : 0;
  const statusLabel = getStatusName(goal.status);

  return (
    <Card
      ref={ref}
      style={{
        border: `1px solid ${colorWithAlpha(themeColor, 0.35)}`,
        background: colorWithAlpha(themeColor, 0.12),
        boxShadow: '0 6px 12px var(--glass-shadow-color)',
        cursor: 'grab',
        opacity: dragging ? 0.6 : 1,
      }}
      onClick={() => onEdit(goal)}
    >
      <div style={{ height: 4, background: themeColor }} />
      <Card.Body style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: themeVars.text as string }}>{goal.title || 'Untitled goal'}</div>
          <Badge bg="light" text="dark" style={{ fontSize: 10 }}>{statusLabel}</Badge>
        </div>
        {showDescription && goal.description && (
          <div style={{ fontSize: 11, color: themeVars.muted as string }}>
            {goal.description}
          </div>
        )}
        {estimated > 0 && (
          <div style={{ fontSize: 11, color: themeVars.muted as string }}>
            Savings: {formatMoney(potBalance / 100)} of {formatMoney(estimated)} ({savingsPct}%)
          </div>
        )}
        {estimated > 0 && (
          <div style={{ height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 999 }}>
            <div
              style={{
                width: `${savingsPct}%`,
                height: '100%',
                background: themeColor,
                borderRadius: 999,
              }}
            />
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

const GoalYearColumn: React.FC<GoalYearColumnProps> = ({
  year,
  goals,
  pots,
  themePalette,
  droppableId,
  showDescriptions,
  onEdit,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ targetYear: year, droppableId }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [year, droppableId]);

  const totals = useMemo(() => {
    let estimated = 0;
    let savedPence = 0;
    const seen = new Set<string>();
    goals.forEach((goal) => {
      const est = Number((goal as any).estimatedCost || 0);
      if (Number.isFinite(est)) estimated += est;
      const potId = (goal as any).linkedPotId || (goal as any).potId;
      if (!potId) return;
      const raw = String(potId);
      const id = raw;
      if (seen.has(id)) return;
      seen.add(id);
      savedPence += Number(pots[id]?.balance || 0);
    });
    return { estimated, savedPence };
  }, [goals, pots]);

  const savingsPct = totals.estimated > 0
    ? Math.min(100, Math.round(((totals.savedPence / 100) / totals.estimated) * 100))
    : 0;

  return (
    <div className={`sprint-column${isOver ? ' is-over' : ''}`} style={{ minWidth: 260 }}>
      <div className="sprint-column__header">
        <div className="sprint-column__header-top">
          <h5 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: themeVars.text as string }}>
            {year ? year : 'No Year'}
          </h5>
          <Badge
            bg="light"
            text="dark"
            style={{
              backgroundColor: 'var(--notion-border)',
              color: 'var(--notion-text)',
              fontSize: 10,
              padding: '3px 8px',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase'
            }}
          >
            {goals.length} goals
          </Badge>
        </div>
        {totals.estimated > 0 && (
          <div className="sprint-column__stats" style={{ display: 'flex', gap: 10 }}>
            <span>{formatMoney(totals.savedPence / 100)} / {formatMoney(totals.estimated)}</span>
            <span>{savingsPct}%</span>
          </div>
        )}
      </div>
      <div
        ref={ref}
        className={`drop-lane${isOver ? ' is-over' : ''}`}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, minHeight: 220 }}
      >
        {goals.map(goal => (
          <GoalYearCard
            key={goal.id}
            goal={goal}
            themePalette={themePalette}
            pots={pots}
            showDescription={showDescriptions}
            onEdit={onEdit}
          />
        ))}
        {goals.length === 0 && (
          <div className="sprint-column__placeholder">
            <div>
              <Calendar size={20} style={{ marginBottom: 8 }} />
              <div>No goals assigned</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Drag goals here to assign
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const YearDateAdjustModal: React.FC<{
  show: boolean;
  goal: Goal | null;
  targetYear: number | null;
  onClose: () => void;
  onSave: (payload: { startDate?: number | null; endDate?: number | null }) => Promise<void>;
}> = ({ show, goal, targetYear, onClose, onSave }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [durationDays, setDurationDays] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!show || !goal) return;
    const startRaw = (goal as any).startDate;
    const endRaw = (goal as any).endDate;
    const startMs = typeof startRaw === 'number' ? startRaw : startRaw?.toDate?.()?.getTime?.();
    const endMs = typeof endRaw === 'number' ? endRaw : endRaw?.toDate?.()?.getTime?.();
    const startStr = startMs ? new Date(startMs).toISOString().slice(0, 10) : '';
    const endStr = endMs ? new Date(endMs).toISOString().slice(0, 10) : '';
    setStartDate(startStr);
    setEndDate(endStr);
  }, [show, goal]);

  useEffect(() => {
    const derived = calculateDurationDays(startDate, endDate);
    setDurationDays(derived);
  }, [startDate, endDate]);

  const handleStartChange = (value: string) => {
    setStartDate(value);
    if (value && durationDays !== '') {
      const days = Number(durationDays);
      if (Number.isFinite(days)) {
        setEndDate(addDaysToStart(value, days));
      }
    }
  };

  const handleDurationChange = (value: string) => {
    const parsed = value ? Math.max(0, Number(value)) : '';
    setDurationDays(parsed === '' || Number.isNaN(parsed) ? '' : parsed);
    if (startDate && parsed !== '' && Number.isFinite(parsed)) {
      setEndDate(addDaysToStart(startDate, Number(parsed)));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const payload: { startDate?: number | null; endDate?: number | null } = {};
    payload.startDate = startDate ? new Date(startDate).getTime() : null;
    payload.endDate = endDate ? new Date(endDate).getTime() : null;
    try {
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const yearLabel = targetYear ? String(targetYear) : 'No Year';

  return (
    <Modal show={show} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Adjust Goal Dates</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p style={{ fontSize: 13, color: themeVars.muted as string }}>
          This goal was moved to {yearLabel}. Update start/end dates to fit within that year.
        </p>
        <div className="row">
          <div className="col-md-4">
            <Form.Group className="mb-3">
              <Form.Label>Start Date</Form.Label>
              <Form.Control
                type="date"
                value={startDate}
                onChange={(e) => handleStartChange(e.target.value)}
              />
            </Form.Group>
          </div>
          <div className="col-md-4">
            <Form.Group className="mb-3">
              <Form.Label>End Date</Form.Label>
              <Form.Control
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Form.Group>
          </div>
          <div className="col-md-4">
            <Form.Group className="mb-3">
              <Form.Label>Duration (days)</Form.Label>
              <Form.Control
                type="number"
                min={0}
                value={durationDays}
                onChange={(e) => handleDurationChange(e.target.value)}
              />
              <Form.Text className="text-muted">Updates end date from start date.</Form.Text>
            </Form.Group>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          Save Dates
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

const GoalsYearPlanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints, selectedSprintId, setSelectedSprintId } = useSprint();
  const { themes } = useGlobalThemes();
  const { isCollapsed, toggleCollapse } = useSidebar();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTheme, setFilterTheme] = useState('all');
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [allYears, setAllYears] = useState(false);
  const [selectedYears, setSelectedYears] = useState<number[]>([currentYear]);
  const [showNoYear, setShowNoYear] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showGoalDescriptions, setShowGoalDescriptions] = useState(true);
  const [showNoPotOnly, setShowNoPotOnly] = useState(false);
  const [activeSprintGoalIds, setActiveSprintGoalIds] = useState<Set<string>>(new Set());
  const [applyActiveSprintFilter, setApplyActiveSprintFilter] = useState(true);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [dateAdjustGoal, setDateAdjustGoal] = useState<{ goal: Goal; year: number | null } | null>(null);
  const [pots, setPots] = useState<Record<string, { name: string; balance: number }>>({});
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const rawGoals = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
          targetDate: data.targetDate?.toDate
            ? data.targetDate.toDate().getTime()
            : (typeof data.targetDate === 'object' && data.targetDate?.seconds != null
              ? (data.targetDate.seconds * 1000 + Math.floor((data.targetDate.nanoseconds || 0) / 1e6))
              : data.targetDate)
        } as Goal;
      });
      const normalizedGoals = rawGoals
        .map((goal, index) => ({
          ...goal,
          orderIndex:
            typeof (goal as any).orderIndex === 'number'
              ? (goal as any).orderIndex
              : ((goal as any).priority !== undefined ? Number((goal as any).priority) * 1000 : index * 1000),
        }))
        .sort((a, b) => ((a as any).orderIndex ?? 0) - ((b as any).orderIndex ?? 0));
      setGoals(normalizedGoals);
      setLoading(false);
    });
    return () => unsubscribeGoals();
  }, [currentUser, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const potQuery = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(potQuery, (snap) => {
      const map: Record<string, { name: string; balance: number }> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        const id = data.potId || d.id;
        if (!id) return;
        map[id] = { name: data.name || id, balance: data.balance || 0 };
      });
      setPots(map);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const activeSprintId = useMemo(() => {
    const active = sprints.find((s) => s.status === 1);
    return active?.id || null;
  }, [sprints]);

  const isCurrentYearOnly = useMemo(() => {
    return !allYears && !showNoYear && selectedYears.length === 1 && selectedYears[0] === currentYear;
  }, [allYears, showNoYear, selectedYears, currentYear]);

  useEffect(() => {
    if (!allYears && selectedYears.length === 0) {
      setSelectedYears([currentYear]);
    }
  }, [allYears, selectedYears, currentYear]);

  useEffect(() => {
    if (!isCurrentYearOnly) {
      if (applyActiveSprintFilter) setApplyActiveSprintFilter(false);
      if (selectedSprintId !== '') setSelectedSprintId('');
      return;
    }
    if (!applyActiveSprintFilter) setApplyActiveSprintFilter(true);
    const hasSavedPreference = (() => {
      try {
        const saved = localStorage.getItem('bob_selected_sprint');
        return saved !== null && saved !== undefined;
      } catch {
        return false;
      }
    })();
    if (selectedSprintId === '' && activeSprintId && !hasSavedPreference) {
      setSelectedSprintId(activeSprintId);
    }
  }, [isCurrentYearOnly, applyActiveSprintFilter, selectedSprintId, setSelectedSprintId, activeSprintId]);

  useEffect(() => {
    const sprintId = selectedSprintId === '' ? null : (selectedSprintId || activeSprintId);
    if (!currentUser || !sprintId) {
      setActiveSprintGoalIds(new Set());
      return;
    }
    const storiesQ = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const unsub = onSnapshot(storiesQ, (snap) => {
      const setIds = new Set<string>();
      snap.docs.forEach(d => {
        const s = d.data() as any;
        if (s.sprintId === sprintId && s.goalId) setIds.add(s.goalId);
      });
      setActiveSprintGoalIds(setIds);
    });
    return () => unsub();
  }, [currentUser, currentPersona, selectedSprintId, activeSprintId]);

  const filteredGoals = goals.filter(goal => {
    const sprintFilterId = selectedSprintId === '' ? null : (selectedSprintId || activeSprintId);
    if (applyActiveSprintFilter && sprintFilterId) {
      if (goal.status === 2) return false;
      if (!activeSprintGoalIds.has(goal.id)) return false;
    }
    if (filterStatus !== 'all' && !isStatus(goal.status, filterStatus)) return false;
    if (filterTheme !== 'all' && getThemeName(goal.theme) !== filterTheme) return false;
    if (showNoPotOnly) {
      const potId = (goal as any).linkedPotId || (goal as any).potId;
      if (potId) return false;
    }
    const derivedYear = resolveGoalYear(goal);
    if (allYears) {
      if (!derivedYear && !showNoYear) return false;
    } else {
      const yearMatch = derivedYear != null && selectedYears.includes(derivedYear);
      const noYearMatch = derivedYear == null && showNoYear;
      if (!yearMatch && !noYearMatch) return false;
    }
    if (searchTerm && !goal.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const orderedFilteredGoals = [...filteredGoals].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  const goalCounts = {
    total: orderedFilteredGoals.length,
    active: orderedFilteredGoals.filter(g => g.status === 1).length,
    done: orderedFilteredGoals.filter(g => g.status === 2).length,
    paused: orderedFilteredGoals.filter(g => g.status === 3).length
  };

  const savingsMetrics = useMemo(() => {
    let totalEstimated = 0;
    let totalSavedPence = 0;
    const seenPotIds = new Set<string>();

    orderedFilteredGoals.forEach((goal) => {
      const est = Number((goal as any).estimatedCost || 0);
      totalEstimated += Number.isFinite(est) ? est : 0;

      const rawPotId = (goal as any).linkedPotId || (goal as any).potId;
      if (!rawPotId) return;
      const raw = String(rawPotId);
      const potId = raw;
      if (!potId || seenPotIds.has(potId)) return;
      seenPotIds.add(potId);
      const balance = Number(pots[potId]?.balance || 0);
      totalSavedPence += Number.isFinite(balance) ? balance : 0;
    });

    return {
      totalEstimated,
      totalSavedPence,
      linkedPotCount: seenPotIds.size
    };
  }, [orderedFilteredGoals, pots]);

  const savingsPct = savingsMetrics.totalEstimated > 0
    ? Math.min(100, Math.round(((savingsMetrics.totalSavedPence / 100) / savingsMetrics.totalEstimated) * 100))
    : 0;

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    goals.forEach(g => {
      const yr = resolveGoalYear(g);
      if (yr) years.add(yr);
    });
    years.add(currentYear);
    return Array.from(years).sort((a, b) => a - b);
  }, [goals, currentYear]);

  const yearColumns = useMemo(() => {
    let years = allYears ? [...availableYears] : [...selectedYears];
    if (!years.length) years = [currentYear];
    years.sort((a, b) => a - b);
    const cols: Array<number | null> = [...years];
    if (showNoYear) cols.push(null);
    return cols;
  }, [allYears, availableYears, selectedYears, showNoYear, currentYear]);

  const yearFilterLabel = useMemo(() => {
    if (allYears) return showNoYear ? 'All + No Year' : 'All years';
    const sorted = [...selectedYears].sort((a, b) => a - b);
    const label = sorted.length ? sorted.join(', ') : 'Select years';
    return showNoYear ? `${label} + No Year` : label;
  }, [allYears, selectedYears, showNoYear]);

  const goalsByYear = useMemo(() => {
    const map = new Map<string, Goal[]>();
    orderedFilteredGoals.forEach(goal => {
      const year = resolveGoalYear(goal);
      const key = year ? String(year) : 'none';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(goal);
    });
    return map;
  }, [orderedFilteredGoals]);

  useEffect(() => {
    return monitorForElements({
      onDrop: async ({ source, location }) => {
        try {
          const destination = location.current.dropTargets[0];
          if (!destination) return;
          const targetYear = (destination.data as any)?.targetYear ?? null;
          const goal = source.data.item as Goal | undefined;
          if (!goal || !currentUser) return;

          const currentYear = resolveGoalYear(goal);
          if ((currentYear ?? null) === (targetYear ?? null)) return;

          setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, targetYear: targetYear ?? null } as any : g));
          setMoveError(null);

          await updateDoc(doc(db, 'goals', goal.id), {
            targetYear: targetYear ?? null,
            updatedAt: serverTimestamp(),
          });

          if (targetYear) {
            const startRaw = (goal as any).startDate;
            const endRaw = (goal as any).endDate;
            const startMs = typeof startRaw === 'number' ? startRaw : startRaw?.toDate?.()?.getTime?.();
            const endMs = typeof endRaw === 'number' ? endRaw : endRaw?.toDate?.()?.getTime?.();
            const startYear = startMs ? new Date(startMs).getFullYear() : null;
            const endYear = endMs ? new Date(endMs).getFullYear() : null;
            const outOfYear = (startYear && startYear !== targetYear) || (endYear && endYear !== targetYear);
            if (outOfYear) {
              setDateAdjustGoal({ goal, year: targetYear });
            }
          }
        } catch (error) {
          console.error('Error moving goal:', error);
          setMoveError('Failed to move goal. Please try again.');
        }
      },
    });
  }, [currentUser]);

  if (loading) {
    return (
      <Container fluid className="p-4">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div className="spinner-border text-primary" />
          <p style={{ marginTop: '16px', color: themeVars.muted as string }}>Loading goals...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: themeVars.bg as string, minHeight: '100vh' }}>
      <Row className="mb-4">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: themeVars.text as string }}>
                Goals by Year
              </h2>
              <Badge bg="primary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona
              </Badge>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button
                size="sm"
                variant="outline-secondary"
                title={isCollapsed ? 'Expand details panel' : 'Collapse details panel'}
                onClick={toggleCollapse}
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      <Row className="mb-1">
        <Col lg={3} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {goalCounts.total}
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Total Goals
              </p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {goalCounts.active}
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Active
              </p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {goalCounts.done}
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Done
              </p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {goalCounts.paused}
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Paused
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="mb-1">
        <Col lg={4} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {formatMoney(savingsMetrics.totalEstimated)}
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Total Estimated Cost (Filtered)
              </p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {formatMoney(savingsMetrics.totalSavedPence / 100)}
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Total Saved (Linked Pots{`${savingsMetrics.linkedPotCount ? ` • ${savingsMetrics.linkedPotCount}` : ''}`})
              </p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4} md={6} className="mb-3">
          <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '6px' }}>
              <h3 style={{ margin: '0 0 2px 0', fontSize: '18px', fontWeight: '700', color: 'var(--notion-text)' }}>
                {savingsPct}%
              </h3>
              <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '11px', fontWeight: '500' }}>
                Savings Progress
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {moveError && (
        <div className="alert alert-danger" role="alert">
          {moveError}
        </div>
      )}

      <Card style={{ marginBottom: '8px', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
        <Card.Body style={{ padding: '8px', color: 'var(--notion-text)' }}>
          <Row className="g-2 align-items-end">
            <Col md={3}>
              <Form.Group>
                <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Search Goals</Form.Label>
                <InputGroup>
                  <Form.Control
                    size="sm"
                    type="text"
                    placeholder="Search by title..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
                  />
                </InputGroup>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Status</Form.Label>
                <Form.Select
                  size="sm"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
                >
                  <option value="all">All Status</option>
                  <option value="New">New</option>
                  <option value="Work in Progress">Work in Progress</option>
                  <option value="Complete">Complete</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Deferred">Deferred</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Theme</Form.Label>
                <Form.Select
                  size="sm"
                  value={filterTheme}
                  onChange={(e) => setFilterTheme(e.target.value)}
                  style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
                >
                  <option value="all">All Themes</option>
                  {themes.map(t => (
                    <option key={t.id} value={t.label}>{t.label}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Year</Form.Label>
                <Dropdown autoClose="outside">
                  <Dropdown.Toggle
                    size="sm"
                    variant="outline-secondary"
                    style={{
                      border: '1px solid var(--notion-border)',
                      background: 'var(--notion-bg)',
                      color: 'var(--notion-text)',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    {yearFilterLabel}
                  </Dropdown.Toggle>
                  <Dropdown.Menu style={{ padding: 8, minWidth: 220 }}>
                    <Form.Check
                      type="checkbox"
                      id="year-filter-all"
                      label="All years"
                      checked={allYears}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAllYears(checked);
                        if (!checked && selectedYears.length === 0) {
                          setSelectedYears([currentYear]);
                        }
                      }}
                      className="mb-1"
                    />
                    <Form.Check
                      type="checkbox"
                      id="year-filter-no-year"
                      label="Include no year"
                      checked={showNoYear}
                      onChange={(e) => setShowNoYear(e.target.checked)}
                      className="mb-2"
                    />
                    <Dropdown.Divider />
                    {availableYears.map((y) => {
                      const checked = selectedYears.includes(y);
                      return (
                        <Form.Check
                          key={y}
                          type="checkbox"
                          id={`year-filter-${y}`}
                          label={String(y)}
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selectedYears, y]
                              : selectedYears.filter((val) => val !== y);
                            setSelectedYears(next);
                            setAllYears(false);
                          }}
                          className="mb-1"
                        />
                      );
                    })}
                  </Dropdown.Menu>
                </Dropdown>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Sprint</Form.Label>
                <div>
                  <SprintSelector
                    selectedSprintId={selectedSprintId}
                    onSprintChange={(id) => setSelectedSprintId(id)}
                  />
                </div>
              </Form.Group>
            </Col>
            <Col md="auto">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterTheme('all');
                    setSearchTerm('');
                  }}
                  style={{ borderColor: 'var(--notion-border)', color: 'var(--notion-text)' }}
                >
                  Clear Filters
                </Button>
                <Form.Check
                  type="switch"
                  id="toggle-goal-descriptions"
                  label="Show goal descriptions"
                  checked={showGoalDescriptions}
                  onChange={(e) => setShowGoalDescriptions(e.target.checked)}
                  className="text-muted"
                />
                <Form.Check
                  type="switch"
                  id="toggle-goals-no-pots"
                  label="Only goals without pots"
                  checked={showNoPotOnly}
                  onChange={(e) => setShowNoPotOnly(e.target.checked)}
                  className="text-muted"
                />
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16 }}>
        {yearColumns.map((year) => (
          <GoalYearColumn
            key={year}
            year={year}
            goals={goalsByYear.get(String(year)) || []}
            pots={pots}
            themePalette={themes}
            droppableId={`year-${year}`}
            showDescriptions={showGoalDescriptions}
            onEdit={(g) => setEditGoal(g)}
          />
        ))}
      </div>

      <EditGoalModal
        goal={editGoal}
        show={!!editGoal}
        onClose={() => setEditGoal(null)}
        currentUserId={currentUser?.uid || ''}
        allGoals={goals}
      />

      <YearDateAdjustModal
        show={!!dateAdjustGoal}
        goal={dateAdjustGoal?.goal || null}
        targetYear={dateAdjustGoal?.year ?? null}
        onClose={() => setDateAdjustGoal(null)}
        onSave={async (payload) => {
          if (!dateAdjustGoal?.goal) return;
          await updateDoc(doc(db, 'goals', dateAdjustGoal.goal.id), {
            ...payload,
            updatedAt: serverTimestamp(),
          });
          setDateAdjustGoal(null);
        }}
      />
    </Container>
  );
};

export default GoalsYearPlanner;

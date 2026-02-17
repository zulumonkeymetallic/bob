import React, { useState, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import { startOfWeek, endOfWeek, startOfDay, subDays, format } from 'date-fns';
import { Card, Badge, Button, Modal, Alert, Toast, ToastContainer } from 'react-bootstrap';
import { Edit3, Target, Calendar, User, CalendarPlus, Wand2, Activity } from 'lucide-react';
import { Goal, Story } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, deleteDoc, doc, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import EditGoalModal from './EditGoalModal';
import AddStoryModal from './AddStoryModal';
import { ChoiceMigration } from '../config/migration';
import { ChoiceHelper } from '../config/choices';
import { getStatusName } from '../utils/statusHelpers';
import { themeVars, rgbaCard } from '../utils/themeVars';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { toDate, formatDate } from '../utils/firestoreAdapters';
import type { GlobalTheme } from '../constants/globalThemes';
import { GLOBAL_THEMES, migrateThemeValue } from '../constants/globalThemes';
import './GoalsCardView.css';

interface GoalsCardViewProps {
  goals: Goal[];
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => void;
  onGoalDelete: (goalId: string) => void;
  onGoalPriorityChange: (goalId: string, newPriority: number) => void;
  onGoalSelect?: (goalId: string) => void; // New prop for goal selection
  selectedGoalId?: string | null; // New prop for highlighting selected goal
  themes?: GlobalTheme[];
  cardLayout?: 'grid' | 'comfortable';
  showDescriptions?: boolean;
}

const GoalsCardView: React.FC<GoalsCardViewProps> = ({
  goals,
  onGoalUpdate,
  onGoalDelete,
  onGoalPriorityChange,
  onGoalSelect,
  selectedGoalId,
  themes,
  cardLayout = 'grid',
  showDescriptions
}) => {
  const { showSidebar } = useSidebar();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [pots, setPots] = useState<Record<string, { name: string; balance: number }>>({});
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState<Goal | null>(null);
  const [showAddStoryModal, setShowAddStoryModal] = useState<string | null>(null); // Store goalId
  const [latestActivities, setLatestActivities] = useState<{ [goalId: string]: any }>({});
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<{ [goalId: string]: string }>({});
  const [isSchedulingGoal, setIsSchedulingGoal] = useState<string | null>(null);
  const [goalTimeAllocations, setGoalTimeAllocations] = useState<{ [goalId: string]: number }>({});
  const [generatingForGoal, setGeneratingForGoal] = useState<string | null>(null);
  const [habitAdherenceData, setHabitAdherenceData] = useState<Record<string, { planned: number; completed: number; progress: number }>>({});
  const [goalHabitMetrics, setGoalHabitMetrics] = useState<Record<string, { count: number; adherence: number; streak: number }>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<'success' | 'danger' | 'info'>('success');
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);
  const showDescriptionsResolved = typeof showDescriptions === 'boolean' ? showDescriptions : true;

  const themePalette = useMemo(() => (themes && themes.length ? themes : GLOBAL_THEMES), [themes]);
  const themeMap = useMemo(() => {
    const map = new Map<number, GlobalTheme>();
    themePalette.forEach(theme => map.set(theme.id, theme));
    return map;
  }, [themePalette]);
  const defaultTheme = themePalette[0] || GLOBAL_THEMES[0];
  const resolveTheme = (value: any): GlobalTheme => {
    if (value == null) return defaultTheme;
    if (typeof value === 'number') {
      const direct = themeMap.get(value);
      if (direct) return direct;
      const legacy = themeMap.get(migrateThemeValue(value));
      return legacy || defaultTheme;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return defaultTheme;
      const normalize = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const normalized = normalize(trimmed);
      const directMatch = themePalette.find((theme) => {
        const label = theme.label || '';
        const name = theme.name || '';
        return (
          normalize(label) === normalized ||
          normalize(name) === normalized ||
          normalize(String(theme.id)) === normalized
        );
      });
      if (directMatch) return directMatch;
      const numeric = Number.parseInt(trimmed, 10);
      if (Number.isFinite(numeric)) {
        const numericMatch = themeMap.get(numeric);
        if (numericMatch) return numericMatch;
        const legacyMatch = themeMap.get(migrateThemeValue(numeric));
        if (legacyMatch) return legacyMatch;
      }
      const legacyByName = themeMap.get(migrateThemeValue(trimmed));
      return legacyByName || defaultTheme;
    }
    return defaultTheme;
  };

  const hexToRgb = (hex: string) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b]
    .map(v => {
      const clamped = Math.max(0, Math.min(255, Math.round(v)));
      return clamped.toString(16).padStart(2, '0');
    })
    .join('')}`;

  const withAlpha = (color: string, alpha: number) => {
    const pct = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
    if (pct <= 0) return 'transparent';
    if (pct >= 100) return color;
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  };

  const lightenColor = (hex: string, amount: number) => {
    const { r, g, b } = hexToRgb(hex);
    const factor = Math.max(0, Math.min(1, amount));
    const nr = r + (255 - r) * factor;
    const ng = g + (255 - g) * factor;
    const nb = b + (255 - b) * factor;
    return rgbToHex(nr, ng, nb);
  };

  const showDetailed = cardLayout === 'comfortable';
  const gridClassName = showDetailed
    ? 'goals-card-grid goals-card-grid--comfortable'
    : 'goals-card-grid goals-card-grid--grid';

  const compactBodyPadding = showDetailed ? '24px' : '14px 12px';
  const compactBodyGap = showDetailed ? '16px' : '10px';
  const headerMargin = showDetailed ? '12px' : '8px';
  const titleFontSize = showDetailed ? '18px' : '16px';
  const badgeFontSize = showDetailed ? '12px' : '11px';

  const sortedGoals = useMemo(() => {
    const getTargetMillis = (goal: Goal) => {
      const raw = (goal as any).targetDate;
      if (!raw) return Number.POSITIVE_INFINITY;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') {
        const parsed = Date.parse(raw);
        return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
      }
      if (raw?.toDate) {
        try {
          return raw.toDate().getTime();
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      }
      return Number.POSITIVE_INFINITY;
    };

    return [...goals].sort((a, b) => getTargetMillis(a) - getTargetMillis(b));
  }, [goals]);

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
          if (next[id] !== span) {
            next[id] = span;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const measureTile = (tile: HTMLElement) => {
      const id = tile.dataset.goalId;
      if (!id) return;
      const height = tile.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
      updateSpans({ [id]: span });
    };

    const observer = new ResizeObserver((entries) => {
      const updates: Record<string, number> = {};
      entries.forEach((entry) => {
        const tile = entry.target as HTMLElement;
        const id = tile.dataset.goalId;
        if (!id) return;
        const height = entry.contentRect.height;
        const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
        updates[id] = span;
      });
      updateSpans(updates);
    });

    const tiles = Array.from(gridEl.querySelectorAll<HTMLElement>('.goals-card-tile'));
    tiles.forEach((tile) => {
      observer.observe(tile);
      measureTile(tile);
    });

    return () => observer.disconnect();
  }, [sortedGoals, showDescriptionsResolved, showDetailed, gridClassName]);

  // Theme colors mapping via CSS variables (no hardcoded hex)
  // Status colors via tokens
  const statusColors = {
    New: 'var(--muted)',
    'Work in Progress': 'var(--green)',
    Complete: 'var(--brand)',
    Blocked: 'var(--red)',
    Deferred: 'var(--orange)'
  } as const;

  
  // Load latest activities once and reuse similar logic to Gantt/Roadmap
  useEffect(() => {
    if (!currentUser?.uid) {
      setLatestActivities({});
      return;
    }

    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('timestamp', 'desc'),
      limit(300)
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, any> = {};
        for (const docSnap of snap.docs) {
          const data = docSnap.data() as any;
          if (data.entityType !== 'goal') continue;
          if (!data.activityType) continue;

          // Respect only meaningful activity entries
          const type = String(data.activityType).toLowerCase();
          if (['clicked', 'viewed', 'exported', 'imported'].includes(type)) continue;

          const goalId = data.entityId as string;
          if (!goalId || map[goalId]) continue;

          const isMeaningfulUpdate =
            (type === 'note_added' && data.noteContent) ||
            type === 'status_changed' ||
            (type === 'updated' && data.fieldName) ||
            type === 'created';

          if (isMeaningfulUpdate) {
            map[goalId] = { id: docSnap.id, ...data };
          }
        }
        setLatestActivities(map);
      },
      (error) => {
        console.error('GoalsCardView activity stream error:', error);
        setLatestActivities({});
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // Load Monzo pots for linked pot badge + savings progress
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

  // Aggregate habit/chore/routine adherence per goal for the current week
  useEffect(() => {
    if (!currentUser?.uid) return;
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const startKey = format(weekStart, 'yyyyMMdd');
    const endKey = format(weekEnd, 'yyyyMMdd');
    const q = query(
      collection(db, 'daily_checkins'),
      where('ownerUid', '==', currentUser.uid),
      where('dateKey', '>=', startKey),
      where('dateKey', '<=', endKey),
    );
    const unsub = onSnapshot(q, (snap) => {
      const adherence: Record<string, { planned: number; completed: number; progress: number }> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        (data.items || []).forEach((item: any) => {
          const goalId = item.goalId;
          if (!goalId) return;
          const type = String(item.type || '').toLowerCase();
          const taskType = String(item.taskType || '').toLowerCase();
          const isHabitLike = ['habit', 'chore', 'routine'].includes(type)
            || (type === 'task' && ['habit', 'chore', 'routine', 'habitual'].includes(taskType));
          if (!isHabitLike) return;
          if (!adherence[goalId]) adherence[goalId] = { planned: 0, completed: 0, progress: 0 };
          adherence[goalId].planned += 1;
          if (item.completed) adherence[goalId].completed += 1;
        });
      });
      Object.keys(adherence).forEach((gid) => {
        const row = adherence[gid];
        row.progress = row.planned > 0 ? (row.completed / row.planned) * 100 : 0;
      });
      setHabitAdherenceData(adherence);
    }, (err) => {
      console.warn('GoalsCardView: habit adherence load failed', err);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Compute 100-day habit/routine metrics per goal from calendar_blocks
  useEffect(() => {
    if (!currentUser?.uid || !goals.length) return;
    const goalIds = goals.map((g) => g.id);
    const startMs = startOfDay(subDays(new Date(), 100)).getTime();
    const endMs = Date.now();
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', startMs),
      where('start', '<=', endMs),
    );
    const unsub = onSnapshot(q, (snap) => {
      // Group occurrences by goalId → taskId → sorted days
      const goalTaskDays: Record<string, Record<string, { dayMs: number; done: boolean }[]>> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const entityType = String(data.entityType || '').toLowerCase();
        if (!['routine', 'habit', 'chore'].includes(entityType)) return;
        const goalId = String(data.goalId || '').trim();
        if (!goalId || !goalIds.includes(goalId)) return;
        const taskId = String(data.taskId || '').trim();
        if (!taskId) return;
        const start = typeof data.start === 'number' ? data.start : null;
        if (!start) return;
        const status = String(data.status || '').toLowerCase();
        const done = ['done', 'complete', 'completed'].includes(status);
        const dayMs = startOfDay(new Date(start)).getTime();
        if (!goalTaskDays[goalId]) goalTaskDays[goalId] = {};
        if (!goalTaskDays[goalId][taskId]) goalTaskDays[goalId][taskId] = [];
        // Only keep one entry per day per task
        const existing = goalTaskDays[goalId][taskId].find((d) => d.dayMs === dayMs);
        if (existing) {
          if (done) existing.done = true;
        } else {
          goalTaskDays[goalId][taskId].push({ dayMs, done });
        }
      });
      const metrics: Record<string, { count: number; adherence: number; streak: number }> = {};
      for (const goalId of Object.keys(goalTaskDays)) {
        const taskMap = goalTaskDays[goalId];
        const taskIds = Object.keys(taskMap);
        let totalPlanned = 0;
        let totalCompleted = 0;
        let minStreak = Infinity;
        for (const tid of taskIds) {
          const days = taskMap[tid].sort((a, b) => b.dayMs - a.dayMs); // newest first
          totalPlanned += days.length;
          totalCompleted += days.filter((d) => d.done).length;
          let streak = 0;
          for (const d of days) {
            if (d.done) streak++;
            else break;
          }
          minStreak = Math.min(minStreak, streak);
        }
        const adherence = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0;
        metrics[goalId] = {
          count: taskIds.length,
          adherence,
          streak: minStreak === Infinity ? 0 : minStreak,
        };
      }
      setGoalHabitMetrics(metrics);
    }, (err) => {
      console.warn('GoalsCardView: habit metrics load failed', err);
    });
    return () => unsub();
  }, [currentUser?.uid, goals]);

  // Fetch time allocations for goals from calendar blocks
  useEffect(() => {
    if (!currentUser || !goals.length) return;

    const fetchTimeAllocations = async () => {
      try {
        const now = new Date();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        const allocations: { [goalId: string]: number } = {};

        for (const goal of goals) {
          // Query calendar blocks for this goal - simplified to avoid complex index
          const blocksQuery = query(
            collection(db, 'calendar_blocks'),
            where('ownerUid', '==', currentUser.uid),
            where('goalId', '==', goal.id)
          );

          const blocksSnapshot = await getDocs(blocksQuery);
          let totalMinutes = 0;

          // Filter by date range in JavaScript to avoid complex Firestore index
          blocksSnapshot.docs.forEach(doc => {
            const block = doc.data();
            if (block.start && block.end) {
              const blockStart = block.start;
              if (blockStart >= weekStart.getTime() && blockStart <= weekEnd.getTime()) {
                totalMinutes += (block.end - block.start) / (1000 * 60);
              }
            }
          });

          allocations[goal.id] = totalMinutes;
        }

        setGoalTimeAllocations(allocations);
      } catch (error) {
        console.error('Failed to fetch time allocations:', error);
      }
    };

    fetchTimeAllocations();
  }, [currentUser, goals]);

  // Schedule time for a specific goal
  const scheduleGoalTime = async (goal: Goal) => {
    if (!currentUser) return;

    try {
      setIsSchedulingGoal(goal.id);
      setCalendarSyncStatus(prev => ({ 
        ...prev, 
        [goal.id]: '🤖 AI is analyzing and scheduling time for this goal...' 
      }));

      // Unified planner: focus on this goal then schedule
      const runPlanner = httpsCallable(functions, 'runPlanner');
      const result = await runPlanner({
        startDate: new Date().toISOString().split('T')[0],
        days: 7,
        persona: currentPersona || 'personal',
        focusGoalId: goal.id,
        goalTimeRequest: goal.timeToMasterHours ? Math.min(goal.timeToMasterHours * 60, 300) : 120
      });

      const planResult = result.data as any;
      
      const blocksCreated = planResult?.llm?.blocksCreated || (Array.isArray(planResult?.llm?.blocks) ? planResult.llm.blocks.length : 0);
      if (blocksCreated > 0) {
        setCalendarSyncStatus(prev => ({ 
          ...prev, 
          [goal.id]: `✅ Scheduled ${blocksCreated} time blocks for "${goal.title}"` 
        }));

        // Toast success
        setToastVariant('success');
        setToastMsg(`Scheduled ${blocksCreated} blocks for "${goal.title}"`);

        // Track activity
        await addDoc(collection(db, 'activity_stream'), {
          entityType: 'goal',
          entityId: goal.id,
          ownerUid: currentUser.uid,
          activityType: 'calendar_scheduled',
          description: `Scheduled ${planResult.blocksCreated} time blocks`,
          metadata: { blocksCreated: planResult.blocksCreated, timeRequested: goal.timeToMasterHours },
          timestamp: serverTimestamp()
        });
      } else {
        setCalendarSyncStatus(prev => ({ 
          ...prev, 
          [goal.id]: '⚠️ No available time slots found for scheduling' 
        }));
        setToastVariant('info');
        setToastMsg('No available time slots found');
      }
    } catch (error) {
      console.error('Failed to schedule goal time:', error);
      setCalendarSyncStatus(prev => ({ 
        ...prev, 
        [goal.id]: '❌ Failed to schedule time: ' + (error as Error).message 
      }));
      setToastVariant('danger');
      setToastMsg('Failed to schedule time');
    } finally {
      setIsSchedulingGoal(null);
      // Clear status after 5 seconds
      setTimeout(() => {
        setCalendarSyncStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[goal.id];
          return newStatus;
        });
      }, 5000);
    }
  };

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    try {
      // Convert number back to priority string format
      const priorityMap = { 1: 'P1', 2: 'P2', 3: 'P3' } as const;
      const priorityString = priorityMap[newPriority as keyof typeof priorityMap] || 'P3';
      
      await updateDoc(doc(db, 'stories', storyId), {
        priority: priorityString,
        updatedAt: new Date()
      });
      console.log('✅ Story priority updated successfully');
    } catch (error) {
      console.error('❌ Error updating story priority:', error);
    }
  };

  const handleViewActivityStream = (goal: Goal, event: React.MouseEvent) => {
    event.stopPropagation();
    console.log('🎯 Opening goal activity stream:', goal.id);
    showSidebar(goal, 'goal');
  };

  const handleStatusChange = (goalId: string, newStatus: 'New' | 'Work in Progress' | 'Complete' | 'Blocked' | 'Deferred') => {
    const numericStatus = ChoiceMigration.migrateGoalStatus(newStatus);
    onGoalUpdate(goalId, { status: numericStatus });
  };

  const handlePriorityChange = (goalId: string, newPriority: number) => {
    onGoalPriorityChange(goalId, newPriority);
  };

  const handleDeleteConfirm = (goalId: string) => {
    onGoalDelete(goalId);
    setShowDeleteModal(null);
  };

  const handleAutoGenerateStories = async (goal: Goal) => {
    if (!currentUser) return;
    try {
      setGeneratingForGoal(goal.id);
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      const resp: any = await callable({ goalId: goal.id });
      const created = resp?.data?.created ?? 0;
      // Lightweight feedback via alert for now
      alert(created > 0 ? `Generated ${created} stories for "${goal.title}"` : 'No stories generated');
    } catch (e: any) {
      console.error('Auto-generate stories failed', e);
      alert('Failed to generate stories: ' + (e?.message || 'Unknown error'));
    } finally {
      setGeneratingForGoal(null);
    }
  };

  if (goals.length === 0) {
    return (
      <div style={{ 
        textAlign: 'center', 
        padding: '60px 20px',
        color: themeVars.muted as string
      }}>
        <Target size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <h4>No Goals Found</h4>
        <p>Start by creating your first goal to track your progress.</p>
      </div>
    );
  }

  return (
    <div className="goals-card-view" style={{ padding: '12px 16px', height: '100%' }}>
      <ToastContainer position="bottom-end" className="p-3">
        <Toast bg={toastVariant === 'success' ? 'success' : toastVariant === 'danger' ? 'danger' : 'info'} onClose={() => setToastMsg(null)} show={!!toastMsg} delay={2200} autohide>
          <Toast.Body style={{ color: toastVariant === 'info' ? themeVars.text : themeVars.onAccent }}>
            {toastMsg}
          </Toast.Body>
        </Toast>
      </ToastContainer>
      <div className={gridClassName} ref={gridRef}>
        {sortedGoals.map((goal) => {
          const goalThemeValue = (goal as any).theme ?? (goal as any).themeId ?? (goal as any).theme_id;
          const themeDef = resolveTheme(goalThemeValue);
          const themeColor = themeDef.color || 'var(--brand)';
          const themeTextColor = themeDef.textColor || 'var(--on-accent)';
          const isSelected = selectedGoalId === goal.id;
          const gradientStart = lightenColor(themeColor, showDetailed ? 0.35 : 0.55);
          const gradientEnd = lightenColor(themeColor, showDetailed ? 0.6 : 0.78);
          const cardBackground = `linear-gradient(165deg, ${gradientStart} 0%, ${gradientEnd} 100%)`;
          const defaultText = themeVars.text as string;
          const defaultMuted = themeVars.muted as string;
          const textColor = showDetailed ? (themeDef.textColor || (themeVars.onAccent as string)) : defaultText;
          const mutedTextColor = showDetailed ? withAlpha(themeColor, 0.75) : defaultMuted;
          const totalStories = (goal as any).storyCount ?? (goal as any).storiesCount ?? (goal as any).story_counts ?? null;
          const doneStories = (goal as any).doneStories ?? (goal as any).completedStories ?? null;
          const allocatedMinutes = goalTimeAllocations[goal.id];
          const latestActivity = latestActivities[goal.id];
          const potId = (goal as any).linkedPotId || (goal as any).potId;
          const potInfo = potId ? pots[potId] : undefined;
          const potBalance = potInfo?.balance || 0;
          const estimated = (goal as any).estimatedCost || 0;
          const savingsPct = estimated > 0 ? Math.min(100, Math.round(((potBalance / 100) / estimated) * 100)) : 0;
          const formatMoney = (v: number) => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
          const storyProgress = totalStories && totalStories > 0
            ? Math.max(0, Math.min(100, Math.round(((doneStories ?? 0) / totalStories) * 100)))
            : 0;
          const habitData = habitAdherenceData[goal.id];
          const habitProgress = habitData && habitData.planned > 0
            ? Math.max(0, Math.min(100, Math.round(habitData.progress)))
            : 0;
          const components = [storyProgress, habitProgress].filter((v, idx) => (idx === 0 ? (totalStories && totalStories > 0) : (habitData && habitData.planned > 0)));
          const progressPercent = components.length
            ? Math.round(components.reduce((a, b) => a + b, 0) / components.length)
            : 0;
          const shouldShowDescription = showDescriptionsResolved && !!goal.description;
          const latestActivityLabel = latestActivity
            ? latestActivity.activityType === 'note_added'
              ? 'Latest Comment'
              : latestActivity.activityType === 'status_changed'
              ? 'Latest Status'
              : latestActivity.activityType === 'updated' && latestActivity.fieldName
              ? 'Latest Update'
              : latestActivity.activityType === 'created'
              ? 'Goal created'
              : 'Latest Activity'
            : '';
          const latestActivityText = latestActivity
            ? latestActivity.activityType === 'note_added'
              ? `"${latestActivity.noteContent}"`
              : latestActivity.activityType === 'status_changed'
              ? `Status changed to: ${ChoiceHelper.getLabel('goal', 'status', parseInt(latestActivity.newValue) || latestActivity.newValue)}`
              : latestActivity.activityType === 'updated' && latestActivity.fieldName
              ? `${latestActivity.fieldName} changed to: ${latestActivity.newValue}`
              : latestActivity.activityType === 'created'
              ? 'Goal created'
              : latestActivity.description || 'Activity logged'
            : '';
          const latestActivityTimestamp = latestActivity?.timestamp
            ? ActivityStreamService.formatTimestamp(latestActivity.timestamp)
            : '';
          const latestActivityUser = latestActivity?.userEmail ? latestActivity.userEmail.split('@')[0] : '';
          const rowSpan = rowSpans[goal.id];
          return (
            <div
              key={goal.id}
              className="goals-card-tile"
              data-goal-id={goal.id}
              style={rowSpan ? { gridRowEnd: `span ${rowSpan}` } : undefined}
            >
              <Card
                className={`h-100 goals-card goals-card--${showDetailed ? 'comfortable' : 'grid'}`}
                style={{
                height: '100%',
                minHeight: showDetailed ? 300 : 220,
                border: isSelected ? `3px solid ${themeColor}` : `1px solid ${rgbaCard(0.06)}`,
                boxShadow: isSelected ? '0 0 0 0 transparent' : '0 10px 24px var(--glass-shadow-color)',
                borderRadius: showDetailed ? '16px' : '14px',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                background: cardBackground,
                color: textColor,
                flex: '1 1 auto',
                display: 'flex',
                flexDirection: 'column'
                }}
                onClick={() => onGoalSelect?.(goal.id)}
                onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 18px var(--glass-shadow-color)';
                }
              }}
                onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 12px var(--glass-shadow-color)';
                }
                }}
              >
              {/* Theme Bar */}
              <div 
                style={{
                  height: '6px',
                  backgroundColor: themeColor
                }}
              />

              <Card.Body
                style={{
                  padding: compactBodyPadding,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: compactBodyGap
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: headerMargin }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5 style={{ 
                      margin: '0 0 6px 0', 
                      fontSize: titleFontSize, 
                      fontWeight: '600',
                      lineHeight: '1.3',
                      wordBreak: 'break-word'
                  }}>
                      {goal.title}
                    </h5>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      style={{ width: 24, height: 24, color: textColor }}
                      title="View activity stream"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewActivityStream(goal, e);
                      }}
                    >
                      <Activity size={14} />
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      style={{ width: 24, height: 24, color: textColor }}
                      title="Edit goal"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowEditModal(goal);
                      }}
                    >
                      <Edit3 size={14} />
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      style={{ width: 24, height: 24, color: textColor }}
                      title="Auto-generate stories"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoGenerateStories(goal);
                      }}
                      disabled={generatingForGoal === goal.id}
                    >
                      <Wand2 size={14} />
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      style={{ width: 24, height: 24, color: textColor }}
                      title="Generate calendar blocks"
                      onClick={(e) => {
                        e.stopPropagation();
                        scheduleGoalTime(goal);
                      }}
                      disabled={isSchedulingGoal === goal.id}
                    >
                      <CalendarPlus size={14} />
                    </Button>
                  </div>
                </div>

                {(shouldShowDescription || latestActivity) && (
                  <div
                    style={{
                      marginBottom: showDetailed ? '12px' : '10px',
                      padding: showDetailed ? '12px' : '10px',
                      backgroundColor: withAlpha(themeColor, showDetailed ? 0.18 : 0.12),
                      border: `1px solid ${withAlpha(themeColor, showDetailed ? 0.35 : 0.28)}`,
                      borderRadius: showDetailed ? '12px' : '10px',
                      color: textColor,
                    }}
                  >
                    {shouldShowDescription && (
                      <p
                        className="goals-card-description"
                        style={{
                          margin: latestActivity ? '0 0 8px 0' : 0,
                          color: mutedTextColor,
                          fontSize: '14px',
                          lineHeight: '1.5',
                          display: '-webkit-box',
                          WebkitLineClamp: showDetailed ? 4 : 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {goal.description}
                      </p>
                    )}
                    {latestActivity && (
                      <div>
                        <div style={{ 
                          fontSize: '11px', 
                          fontWeight: '700', 
                          color: textColor, 
                          marginBottom: '4px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          {latestActivityLabel}
                        </div>
                        <div style={{ 
                          fontSize: '12px', 
                          color: textColor, 
                          fontStyle: 'italic',
                          lineHeight: '1.4'
                        }}>
                          {latestActivityText}
                        </div>
                        {(latestActivityTimestamp || latestActivityUser) && (
                          <div style={{ 
                            fontSize: '10px', 
                            color: mutedTextColor, 
                            marginTop: '6px'
                          }}>
                            {latestActivityTimestamp}
                            {latestActivityUser && ` • ${latestActivityUser}`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!showDetailed && (
                  <div className="goals-card-quick-stats">
                    <div className="goals-card-progress">
                      <div className="goals-card-progress__header">
                        <span>Progress</span>
                        <span>{progressPercent}%</span>
                      </div>
                    <div className="goals-card-progress__bar" style={{ background: withAlpha(themeColor, 0.18) }}>
                        <div
                          className="goals-card-progress__bar-fill"
                          style={{ width: `${progressPercent}%`, background: withAlpha(themeColor, 0.45) }}
                        />
                      </div>
                      <div className="goals-card-progress__footer">
                        {totalStories && totalStories > 0
                          ? `${doneStories ?? 0} of ${totalStories} stories`
                          : 'No stories yet'}
                      </div>
                      {estimated > 0 && (
                        <>
                          <div className="goals-card-progress__header">
                            <span>Savings</span>
                            <span>{savingsPct}%</span>
                          </div>
                          <div className="goals-card-progress__bar" style={{ background: withAlpha(themeColor, 0.12) }}>
                            <div
                              className="goals-card-progress__bar-fill"
                              style={{ width: `${savingsPct}%`, background: withAlpha(themeColor, 0.6) }}
                            />
                          </div>
                          <div className="goals-card-progress__footer">
                            {formatMoney(potBalance / 100)} of {formatMoney(estimated)}
                          </div>
                        </>
                      )}
                    </div>
                    {/* Removed Priority and This Week per request */}
                  </div>
                )}

                {showDetailed && (
                  <>
                    <div className="goals-card-progress goals-card-progress--detailed">
                      <div className="goals-card-progress__header">
                        <span>Progress</span>
                        <span>{progressPercent}%</span>
                      </div>
                    <div className="goals-card-progress__bar" style={{ background: withAlpha(themeColor, 0.2) }}>
                        <div
                          className="goals-card-progress__bar-fill"
                          style={{ width: `${progressPercent}%`, background: withAlpha(themeColor, 0.5) }}
                        />
                      </div>
                      <div className="goals-card-progress__footer" style={{ color: textColor }}>
                        {totalStories && totalStories > 0
                          ? `${doneStories ?? 0} of ${totalStories} stories`
                          : 'No stories yet'}
                      </div>
                      {estimated > 0 && (
                        <>
                          <div className="goals-card-progress__header">
                            <span>Savings</span>
                            <span>{savingsPct}%</span>
                          </div>
                          <div className="goals-card-progress__bar" style={{ background: withAlpha(themeColor, 0.16) }}>
                            <div
                              className="goals-card-progress__bar-fill"
                              style={{ width: `${savingsPct}%`, background: withAlpha(themeColor, 0.7) }}
                            />
                          </div>
                          <div className="goals-card-progress__footer" style={{ color: textColor }}>
                            {formatMoney(potBalance / 100)} of {formatMoney(estimated)}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="goals-card-stats-detailed">
                      <div className="goals-card-stat-block">
                        <div className="label">Total Stories</div>
                        <div className="value">{totalStories ?? '—'}</div>
                      </div>
                    {/* Priority removed */}
                    <div className="goals-card-stat-block">
                      <div className="label">Confidence</div>
                      <div className="value">{goal.confidence ? `${goal.confidence}/10` : '—'}</div>
                    </div>
                    {/* This Week removed */}
                    </div>
                    {(() => {
                      const hm = goalHabitMetrics[goal.id];
                      if (!hm || hm.count === 0) return null;
                      return (
                        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: withAlpha(themeColor, 0.08) }}>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: textColor }}>
                            Habits &amp; Routines ({hm.count})
                          </div>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                            <div>
                              <span style={{ color: mutedTextColor }}>100-day adherence: </span>
                              <span style={{ fontWeight: 600, color: hm.adherence >= 80 ? '#16a34a' : hm.adherence >= 50 ? '#ca8a04' : '#dc2626' }}>
                                {hm.adherence}%
                              </span>
                            </div>
                            <div>
                              <span style={{ color: mutedTextColor }}>Streak: </span>
                              <span style={{ fontWeight: 600, color: textColor }}>{hm.streak} day{hm.streak !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}

                {/* Goal Details */}
                {showDetailed && (
                  <div style={{ marginBottom: '16px', color: mutedTextColor, display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                      <Target size={14} />
                      <span style={{ fontWeight: '500' }}>Size:</span>
                      <span>{goal.size}</span>
                    </div>
                    {/* Priority removed from details */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                      <User size={14} />
                      <span style={{ fontWeight: '500' }}>Owner:</span>
                      <span>{goal.ownerUid?.split('@')[0] || '—'}</span>
                    </div>
                    {goal.confidence && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                        <User size={14} />
                        <span style={{ fontWeight: '500' }}>Confidence:</span>
                        <span>{goal.confidence}/10</span>
                      </div>
                    )}
                    {/* This Week allocation hidden in details per request */}
                  </div>
                )}

                {/* Footer */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: showDetailed ? '16px' : '8px',
                    borderTop: showDetailed ? `1px solid ${withAlpha(themeColor, 0.25)}` : `1px solid ${withAlpha('var(--on-accent)', 0.18)}`,
                    fontSize: '12px',
                    color: mutedTextColor,
                    gap: '12px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Badge
                        style={{
                          backgroundColor: themeColor,
                          color: themeTextColor,
                          fontSize: badgeFontSize
                        }}
                      >
                        {themeDef.label}
                      </Badge>
                      <Badge 
                        style={{ 
                          backgroundColor: statusColors[getStatusName(goal.status) as keyof typeof statusColors] || 'var(--muted)',
                          color: 'var(--on-accent)',
                          fontSize: badgeFontSize
                        }}
                      >
                        {getStatusName(goal.status)}
                      </Badge>
                      {(() => {
                        const potId = (goal as any).linkedPotId || (goal as any).potId;
                        const potInfo = potId ? pots[potId] : undefined;
                        return potInfo ? (
                          <Badge bg="light" text="dark" className="border">
                            {potInfo.name}
                          </Badge>
                        ) : null;
                      })()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Calendar size={12} style={{ marginRight: '4px' }} />
                        {(() => {
                          const d = toDate(goal.createdAt);
                          return (
                            <span>Created: {d ? formatDate(d) : '—'}</span>
                          );
                        })()}
                      </div>
                      {(() => {
                        const d = toDate(goal.updatedAt);
                        return d ? (
                          <div style={{ display: 'flex', alignItems: 'center', color: textColor, fontWeight: '500' }}>
                            <Calendar size={12} style={{ marginRight: '4px' }} />
                            <span>
                              Updated: {formatDate(d)} at {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <div />
                </div>
              </Card.Body>
            </Card>

            {/* Calendar Sync Status */}
            {calendarSyncStatus[goal.id] && (
              <Alert 
                variant={calendarSyncStatus[goal.id].startsWith('✅') ? 'success' : 
                        calendarSyncStatus[goal.id].startsWith('❌') ? 'danger' : 
                        calendarSyncStatus[goal.id].startsWith('⚠️') ? 'warning' : 'info'}
                style={{ 
                  marginTop: '8px',
                  fontSize: '12px',
                  padding: '8px 12px',
                  marginBottom: 0
                }}
                dismissible
                onClose={() => setCalendarSyncStatus(prev => {
                  const newStatus = { ...prev };
                  delete newStatus[goal.id];
                  return newStatus;
                })}
              >
                {calendarSyncStatus[goal.id]}
              </Alert>
            )}

          </div>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal show={!!showDeleteModal} onHide={() => setShowDeleteModal(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete Goal</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this goal? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(null)}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={() => showDeleteModal && handleDeleteConfirm(showDeleteModal)}
          >
            Delete Goal
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Goal Modal */}
      <EditGoalModal
        goal={showEditModal}
        show={!!showEditModal}
        onClose={() => setShowEditModal(null)}
        currentUserId={currentUser?.uid || ''}
      />

      {/* Add Story Modal */}
      <AddStoryModal
        show={!!showAddStoryModal}
        onClose={() => setShowAddStoryModal(null)}
        goalId={showAddStoryModal || undefined}
      />
    </div>
  );
};

export default GoalsCardView;

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Calendar, 
  ZoomIn, 
  ZoomOut, 
  Home, 
  Printer, 
  Share2,
  Filter,
  Search,
  ChevronDown,
  ChevronRight,
  Move,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Target,
  Edit3,
  Wand2,
  MessageSquareText,
  List as ListIcon,
  Maximize2,
  Minimize2,
  BookOpen
} from 'lucide-react';
import { Card, Container, Row, Col, Button, Form, Badge, Alert, Modal } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useSprint } from '../../contexts/SprintContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import SprintSelector from '../SprintSelector';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import EditGoalModal from '../../components/EditGoalModal';
import ModernStoriesTable from '../../components/ModernStoriesTable';
import { Goal, Sprint, Story, Task } from '../../types';
import './EnhancedGanttChart.css';
import logger from '../../utils/logger';
import ThemeRoadmap from './ThemeRoadmap';
import { useRoadmapStore, useTimelineScale } from '../../stores/roadmapStore';
import RoadmapAxis from './RoadmapAxis';
import VirtualThemeLane from './VirtualThemeLane';
// RoadmapV2 fully removed; timeline uses native implementation below
import { useSidebar } from '../../contexts/SidebarContext';
import GLOBAL_THEMES, { getThemeById, migrateThemeValue } from '../../constants/globalThemes';
import { scaleTime } from '@visx/scale';
import {
  DndContext,
  DragStartEvent,
  DragMoveEvent,
  DragEndEvent,
  DragCancelEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

interface GanttItem {
  id: string;
  title: string;
  type: 'goal' | 'story' | 'sprint';
  theme: number;
  startDate: Date;
  endDate: Date;
  status: number;
  goalId?: string;
  sprintId?: string;
  linkedItems?: GanttItem[];
  priority?: number;
  confidence?: number;
}

type RoadmapDragType = 'move' | 'resize-start' | 'resize-end';

type ActiveDrag = {
  goalId: string;
  dragType: RoadmapDragType;
  originStart: Date;
  originEnd: Date;
  themeId: number;
};

const EnhancedGanttChart: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId, setSelectedSprintId } = useSprint();
  const { theme } = useTheme();
  const { showSidebar } = useSidebar();
  
  // View mode toggle (timeline vs roadmap)
  const [viewMode, setViewMode] = useState<'timeline' | 'roadmap'>('timeline');

  // Core data
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [zoomLevel, setZoomLevel] = useState<'week' | 'month' | 'quarter' | 'half' | 'year'>('quarter');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedThemes, setSelectedThemes] = useState<number[]>([]);
  const [showLinks, setShowLinks] = useState<boolean>(true);
  const [autoFitSprintGoals, setAutoFitSprintGoals] = useState<boolean>(true);
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());
  const [groupByTheme, setGroupByTheme] = useState<boolean>(true);
  const [showEmptyThemes, setShowEmptyThemes] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [storiesByGoal, setStoriesByGoal] = useState<Record<string, number>>({});
  const [doneStoriesByGoal, setDoneStoriesByGoal] = useState<Record<string, number>>({});
  const [activityGoalId, setActivityGoalId] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<any[]>([]);
  const [noteGoalId, setNoteGoalId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [lastNotes, setLastNotes] = useState<Record<string, string>>({});
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [dragOverlay, setDragOverlay] = useState<{ left: number; width: number; text: string } | null>(null);
  const dragTooltipRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const renderCountRef = useRef(0);
  const dragLogRef = useRef<{ lastMoveLogAt: number; lastDeltaX: number; lastPointerX: number; lastPointerY: number }>({
    lastMoveLogAt: 0,
    lastDeltaX: 0,
    lastPointerX: Number.NaN,
    lastPointerY: Number.NaN,
  });
  const isSpaceDownRef = useRef(false);
  const panRef = useRef<{ active: boolean; startX: number; startStart: Date; startEnd: Date } | null>(null);
  const panInertiaRef = useRef<{ vx: number; lastX: number; lastT: number; raf?: number } | null>(null);
  const isShiftDownRef = useRef(false);
  const pinchRef = useRef<{ active: boolean; startDist: number; startStart: Date; startEnd: Date; anchor: Date } | null>(null);
  
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const storiesPanelRef = useRef<HTMLDivElement>(null);

  // When a goal is selected, scroll its stories panel into view
  useEffect(() => {
    if (selectedGoalId && storiesPanelRef.current) {
      // Defer to allow panel to render
      setTimeout(() => {
        storiesPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }, [selectedGoalId]);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  
  // Modals
  const [showImpactModal, setShowImpactModal] = useState(false);
  const [impactedItems, setImpactedItems] = useState<(Story | Task)[]>([]);
  const [pendingGoalUpdate, setPendingGoalUpdate] = useState<{ goalId: string; startDate: Date; endDate: Date } | null>(null);
  const [tasksModalGoalId, setTasksModalGoalId] = useState<string | null>(null);
  const [tasksForModal, setTasksForModal] = useState<Task[]>([]);
  
  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const headerMonthsRef = useRef<HTMLDivElement>(null);
  const [visibleRangeText, setVisibleRangeText] = useState<string>('');
  
  // Theme definitions adopt V2 global theme system
  const themes = useMemo(() => GLOBAL_THEMES.map(t => ({ id: t.id, name: t.name || t.label, color: t.color })), []);

  // Time range calculation
  const timeRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1); // 1 year ago
    const end = new Date(now.getFullYear() + 2, 11, 31); // 2 years ahead
    return { start, end };
  }, []);

  // Sync timeline range to store for axis
  const setRange = useRoadmapStore(s => s.setRange);
  const setWidth = useRoadmapStore(s => s.setWidth);
  const scale = useTimelineScale();
  useEffect(() => { setRange(timeRange.start, timeRange.end); }, [timeRange.start, timeRange.end]);
  useEffect(() => {
    const updateWidth = () => {
      const w = canvasRef.current?.scrollWidth || containerRef.current?.clientWidth || 1200;
      setWidth(w);
      // Also refresh visible range indicator
      updateVisibleRange();
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Fullscreen handlers
  const enterFullscreen = useCallback(async () => {
    try {
      document.body.classList.add('gantt-full-active');
      if (containerRef.current && (containerRef.current as any).requestFullscreen) {
        await (containerRef.current as any).requestFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch (e) {
      console.error('Enter fullscreen failed', e);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      document.body.classList.remove('gantt-full-active');
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error('Exit fullscreen failed', e);
    } finally {
      setIsFullscreen(false);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) exitFullscreen(); else enterFullscreen();
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Quick presets for fixed-span windows
  const setSpanYears = useCallback((years: number) => {
    const today = new Date();
    const startYear = today.getFullYear() - Math.floor((years - 1) / 2);
    const endYear = startYear + years - 1;
    const s = new Date(startYear, 0, 1);
    const e = new Date(endYear, 11, 31);
    useRoadmapStore.getState().setRange(s, e);
    setZoomLevel('year');
  }, []);

  // Latest goal notes for tooltip/row preview (week/month views)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', currentUser.uid),
      where('entityType', '==', 'goal'),
      where('activityType', '==', 'note_added'),
      orderBy('timestamp', 'desc'),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, string> = {};
      for (const d of snap.docs) {
        const data = d.data() as any;
        const gid = data.entityId as string;
        if (!map[gid] && data.noteContent) map[gid] = String(data.noteContent);
      }
      setLastNotes(map);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Auto-fit once when goals arrive
  const didAutoFitRef = useRef(false);
  useEffect(() => {
    if (didAutoFitRef.current) return;
    if (!goals || goals.length === 0) return;
    didAutoFitRef.current = true;
    fitAll();
  }, [goals]);

  // Navigation helpers
  const jumpToToday = useCallback(() => {
    const today = new Date();
    try {
      useRoadmapStore.getState().setZoom(zoomLevel, today);
    } catch {}
    // Also center scroll approximately
    const el = containerRef.current;
    if (el) {
      const left = 250 + scale(today) - el.clientWidth * 0.3;
      el.scrollLeft = Math.max(0, left);
      updateVisibleRange();
    }
  }, [zoomLevel]);

  const jumpToSelectedSprint = useCallback(() => {
    if (!selectedSprintId) return;
    const sprint = sprints.find(s => s.id === selectedSprintId);
    if (!sprint) return;
    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);
    // Add a margin around sprint
    const margin = 7 * 24 * 60 * 60 * 1000; // 1 week
    useRoadmapStore.getState().setRange(new Date(start.getTime() - margin), new Date(end.getTime() + margin));
    // Adjust zoom based on sprint length
    const diff = end.getTime() - start.getTime();
    const week = 7 * 24 * 60 * 60 * 1000;
    const newZoom: typeof zoomLevel = diff <= 6 * week ? 'week' : diff <= 20 * week ? 'month' : 'quarter';
    setZoomLevel(newZoom);
    useRoadmapStore.getState().setZoom(newZoom, new Date((start.getTime() + end.getTime()) / 2));
    // Scroll roughly into view
    const el = containerRef.current;
    if (el) {
      const left = 250 + scale(start) - el.clientWidth * 0.2;
      el.scrollLeft = Math.max(0, left);
      updateVisibleRange();
    }
  }, [selectedSprintId, sprints, setZoomLevel, scale]);

  const fitAll = useCallback(() => {
    // Determine min start and max end across current goals
    const dates: number[] = [];
    goals.forEach((g) => {
      const s = g.startDate ? Number(g.startDate) : undefined;
      const e = g.endDate ? Number(g.endDate) : g.targetDate ? new Date(g.targetDate).getTime() : undefined;
      if (s) dates.push(s);
      if (e) dates.push(e);
    });
    if (dates.length < 2) return;
    let min = Math.min(...dates);
    let max = Math.max(...dates);
    if (min === max) max = min + 30 * 24 * 60 * 60 * 1000; // ensure non-zero span
    const margin = Math.round((max - min) * 0.08); // 8% padding either side
    const newStart = new Date(min - margin);
    const newEnd = new Date(max + margin);
    useRoadmapStore.getState().setRange(newStart, newEnd);

    // Pick an approximate zoom label by span
    const span = max - min;
    const day = 24 * 60 * 60 * 1000;
    let z: typeof zoomLevel = 'quarter';
    if (span <= 60 * day) z = 'week';
    else if (span <= 180 * day) z = 'month';
    else if (span <= 540 * day) z = 'quarter';
    else if (span <= 720 * day) z = 'half';
    else z = 'year';
    setZoomLevel(z);
    // Keep domain from setRange; no need to call setZoom here.

    // Scroll to start
    const el = containerRef.current;
    if (el) {
      const left = 250 + scale(newStart) - el.clientWidth * 0.05;
      el.scrollLeft = Math.max(0, left);
    }
  }, [goals, setZoomLevel, scale]);

  useEffect(() => {
    renderCountRef.current += 1;
    if (logger.isEnabled('debug', 'gantt')) {
      logger.debug('gantt', 'Render', { count: renderCountRef.current });
    }
  });

  useEffect(() => {
    logger.info('gantt', 'EnhancedGanttChart mounted');
    return () => logger.info('gantt', 'EnhancedGanttChart unmounted');
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) {
        document.body.classList.remove('gantt-full-active');
      } else {
        document.body.classList.add('gantt-full-active');
      }
      logger.debug('gantt', 'Fullscreen change', { active });
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Track spacebar for panning
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (e.type === 'keydown') isSpaceDownRef.current = true;
        else isSpaceDownRef.current = false;
      }
      if (e.key === 'Shift') {
        if (e.type === 'keydown') isShiftDownRef.current = true;
        else isShiftDownRef.current = false;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => onKey(e);
    const onKeyUp = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Scroll to today's date on mount and when zoom/data changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const today = new Date();
    const left = 250 + getDatePosition(today) - el.clientWidth * 0.3;
    el.scrollLeft = Math.max(0, left);
    logger.debug('gantt', 'Auto-scroll to today', { left: el.scrollLeft, width: el.clientWidth });
    updateVisibleRange();
  }, [zoomLevel, goals.length, sprints.length]);

  // Visible range indicator (left/right of viewport)
  const updateVisibleRange = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const s = useRoadmapStore.getState();
    const sc: any = scaleTime<number>({ domain: [s.start, s.end], range: [0, Math.max(1, s.width)] });
    const invert = sc.invert ? (x: number) => sc.invert(x) as Date : (x: number) => new Date(s.start.getTime() + (x / Math.max(1, s.width)) * (s.end.getTime() - s.start.getTime()));
    const leftX = Math.max(0, el.scrollLeft - 250);
    const rightX = Math.max(0, leftX + Math.max(0, el.clientWidth - 250));
    const sd = invert(leftX);
    const ed = invert(rightX);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    setVisibleRangeText(`${fmt(sd)} – ${fmt(ed)}`);
  }, []);

  useEffect(() => {
    const onScroll = () => updateVisibleRange();
    const el = containerRef.current;
    if (el) el.addEventListener('scroll', onScroll);
    updateVisibleRange();
    return () => { if (el) el.removeEventListener('scroll', onScroll); };
  }, [updateVisibleRange]);

  // Map stories per goal for quick indicators
  useEffect(() => {
    const total: Record<string, number> = {};
    const done: Record<string, number> = {};
    stories.forEach((s) => {
      if (!s.goalId) return;
      total[s.goalId] = (total[s.goalId] || 0) + 1;
      if (s.status === 4) {
        done[s.goalId] = (done[s.goalId] || 0) + 1;
      }
    });
    setStoriesByGoal(total);
    setDoneStoriesByGoal(done);
  }, [stories]);

  // Subscribe to activity when opening modal
  useEffect(() => {
    if (!activityGoalId) return;
    const unsub = ActivityStreamService.subscribeToActivityStream(activityGoalId, setActivityItems);
    return () => unsub();
  }, [activityGoalId]);

  // Load data with real-time subscriptions
  useEffect(() => {
    if (!currentUser?.uid) return;

    const unsubscribes: (() => void)[] = [];

    // Subscribe to goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal));
      setGoals(goalsData);
      logger.debug('gantt', 'Goals snapshot', { count: goalsData.length });
    });
    unsubscribes.push(unsubGoals);

    // Subscribe to sprints
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sprint));
      setSprints(sprintsData);
      logger.debug('gantt', 'Sprints snapshot', { count: sprintsData.length });
    });
    unsubscribes.push(unsubSprints);

    // Subscribe to stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
      setStories(storiesData);
      logger.debug('gantt', 'Stories snapshot', { count: storiesData.length });
    });
    unsubscribes.push(unsubStories);

    // Subscribe to tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(tasksData);
      logger.debug('gantt', 'Tasks snapshot', { count: tasksData.length });
    });
    unsubscribes.push(unsubTasks);

    setLoading(false);
    logger.info('gantt', 'Realtime subscriptions established');

    return () => {
      unsubscribes.forEach(unsub => unsub());
      logger.info('gantt', 'Realtime subscriptions cleaned up');
    };
  }, [currentUser?.uid]);

  // Generate timeline data
  const ganttItems = useMemo<GanttItem[]>(() => {
    const t = logger.time('gantt', 'build-gantt-items');
    const items: GanttItem[] = [];

    // Add goals
    goals.forEach(goal => {
      const themeId = migrateThemeValue(goal.theme);
      if (selectedThemes.length > 0 && !selectedThemes.includes(themeId)) return;
      if (searchTerm && !goal.title.toLowerCase().includes(searchTerm.toLowerCase())) return;

      const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
      const endDate = goal.endDate ? new Date(goal.endDate) : 
        goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      items.push({
        id: goal.id,
        title: goal.title,
        type: 'goal',
        theme: themeId,
        startDate,
        endDate,
        status: goal.status,
        priority: (goal as any).priority,
        confidence: (goal as any).confidence
      });
    });

    // Add sprints
    sprints.forEach(sprint => {
      items.push({
        id: sprint.id,
        title: sprint.name,
        type: 'sprint',
        theme: 0, // Neutral for sprints
        startDate: new Date(sprint.startDate),
        endDate: new Date(sprint.endDate),
        status: sprint.status
      });
    });

    const result = items.sort((a, b) => {
      if (a.type !== b.type) {
        const order = { goal: 0, story: 1, sprint: 2 };
        return order[a.type] - order[b.type];
      }
      const ta = migrateThemeValue(a.theme as any);
      const tb = migrateThemeValue(b.theme as any);
      if (ta !== tb) return ta - tb;
      return a.startDate.getTime() - b.startDate.getTime();
    });
    t.end();
    logger.debug('gantt', 'Gantt items built', { total: result.length });
    return result;
  }, [goals, sprints, stories, selectedThemes, searchTerm]);

  // Group goals by theme for rendering bands/headers
  const goalsByTheme = useMemo(() => {
    const grouped: Record<number, GanttItem[]> = {};
    ganttItems.filter(i => i.type === 'goal').forEach(g => {
      const k = migrateThemeValue(g.theme);
      grouped[k] = grouped[k] || [];
      grouped[k].push({ ...g, theme: k });
    });
    return grouped;
  }, [ganttItems]);

  // Handle item click for activity stream
  const handleItemClick = useCallback(async (item: GanttItem) => {
    if (item.type === 'goal') {
      const goal = goals.find(g => g.id === item.id);
      if (goal) {
        showSidebar(goal, 'goal');
        setSelectedGoalId(goal.id);
      }
    } else if (item.type === 'story') {
      const story = stories.find(s => s.id === item.id);
      if (story) {
        showSidebar(story, 'story');
      }
    }

    // Prepare open tasks modal for goals
    if (item.type === 'goal') {
      const goalStories = stories.filter(story => story.goalId === item.id);
      const storyIds = new Set(goalStories.map(s => s.id));
      const open = tasks.filter(t => (t.goalId === item.id) || (t.parentType === 'story' && storyIds.has(t.parentId)));
      const openOnly = open.filter(t => t.status !== 2);
      setTasksForModal(openOnly);
      setTasksModalGoalId(item.id);
    }

    // Do not log view-only interactions to the activity stream
  }, [goals, stories, tasks, currentUser, showSidebar]);

  const openActivitySidebar = useCallback(() => {
    const targetId = selectedGoalId ?? goals[0]?.id;
    if (!targetId) return;
    const goal = goals.find(g => g.id === targetId);
    if (!goal) return;

    showSidebar(goal, 'goal');

    // Do not log "opened activity" as an activity entry
  }, [goals, selectedGoalId, showSidebar, currentUser]);

  // Handle drag start
  const computeDragDates = useCallback((drag: ActiveDrag, deltaX: number) => {
    const msPerPixel = getMillisecondsPerPixel(zoomLevel);
    const timeDelta = deltaX * msPerPixel;
    let nextStart = new Date(drag.originStart.getTime());
    let nextEnd = new Date(drag.originEnd.getTime());

    if (drag.dragType === 'move') {
      nextStart = new Date(drag.originStart.getTime() + timeDelta);
      nextEnd = new Date(drag.originEnd.getTime() + timeDelta);
    } else if (drag.dragType === 'resize-start') {
      nextStart = new Date(Math.min(drag.originStart.getTime() + timeDelta, drag.originEnd.getTime() - 24 * 60 * 60 * 1000));
    } else if (drag.dragType === 'resize-end') {
      nextEnd = new Date(Math.max(drag.originEnd.getTime() + timeDelta, drag.originStart.getTime() + 24 * 60 * 60 * 1000));
    }

    nextStart.setHours(0, 0, 0, 0);
    nextEnd.setHours(0, 0, 0, 0);

    if (isShiftDownRef.current) {
      const snappedStart = snapToWeek(nextStart);
      const snappedEnd = snapToWeek(nextEnd);
      if (snappedEnd.getTime() <= snappedStart.getTime()) {
        snappedEnd.setDate(snappedStart.getDate() + 7);
      }
      nextStart = snappedStart;
      nextEnd = snappedEnd;
    }

    return { nextStart, nextEnd };
  }, [zoomLevel]);

  const updateDragVisual = useCallback((goalId: string, nextStart: Date, nextEnd: Date) => {
    const goalElement = document.querySelector(`[data-goal-id="${goalId}"]`) as HTMLElement | null;
    const startPos = getDatePosition(nextStart);
    const endPos = getDatePosition(nextEnd);
    const tooltipText = `${nextStart.toLocaleDateString()} → ${nextEnd.toLocaleDateString()}`;
    if (goalElement) {
      goalElement.style.left = `${startPos}px`;
      goalElement.style.width = `${Math.max(4, endPos - startPos)}px`;
    }
    const tooltip = dragTooltipRef.current;
    if (tooltip) {
      tooltip.style.left = `${250 + startPos}px`;
      tooltip.textContent = tooltipText;
    }
    setDragOverlay({ left: 250 + startPos, width: endPos - startPos, text: tooltipText });
  }, [getDatePosition]);

  const resetDragVisual = useCallback(() => {
    setDragOverlay(null);
    const tooltip = dragTooltipRef.current;
    if (tooltip) {
      tooltip.style.left = `-9999px`;
      tooltip.textContent = '';
    }
    try {
      document.body.classList.remove('rv2-dragging');
      delete (document.body as any).dataset.rv2Dragging;
    } catch {}
  }, []);

  const extractPointer = (evt?: DragStartEvent | DragMoveEvent | DragEndEvent | DragCancelEvent) => {
    if (!evt) return { x: undefined as number | undefined, y: undefined as number | undefined };
    const source: any = (evt as any).activatorEvent;
    if (!source) return { x: undefined, y: undefined };
    if (typeof source.clientX === 'number' && typeof source.clientY === 'number') {
      return { x: source.clientX as number, y: source.clientY as number };
    }
    if (source.touches && source.touches[0]) {
      return { x: source.touches[0].clientX as number, y: source.touches[0].clientY as number };
    }
    if (source.changedTouches && source.changedTouches[0]) {
      return { x: source.changedTouches[0].clientX as number, y: source.changedTouches[0].clientY as number };
    }
    return { x: undefined, y: undefined };
  };

  const handleRoadmapDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { kind?: string; goalId: string; dragType: RoadmapDragType; start: number; end: number; themeId: number } | undefined;
    if (!data || data.kind !== 'roadmap-card') return;

    const originStart = new Date(data.start);
    const originEnd = new Date(data.end);
    setActiveDrag({ goalId: data.goalId, dragType: data.dragType, originStart, originEnd, themeId: data.themeId });
    const pointer = extractPointer(event);
    dragLogRef.current = {
      lastMoveLogAt: performance.now(),
      lastDeltaX: 0,
      lastPointerX: pointer.x ?? Number.NaN,
      lastPointerY: pointer.y ?? Number.NaN,
    };
    logger.debug('gantt', 'Drag start', {
      id: data.goalId,
      dragType: data.dragType,
      start: originStart,
      end: originEnd,
      pointerX: pointer.x,
      pointerY: pointer.y,
    });
    logger.perfMark('gantt-drag-start');
    try {
      document.body.classList.add('rv2-dragging');
      (document.body as any).dataset.rv2Dragging = '1';
    } catch {}
    updateDragVisual(data.goalId, originStart, originEnd);
  }, [updateDragVisual]);

  const handleRoadmapDragMove = useCallback((event: DragMoveEvent) => {
    if (!activeDrag) return;
    const { nextStart, nextEnd } = computeDragDates(activeDrag, event.delta.x);
    updateDragVisual(activeDrag.goalId, nextStart, nextEnd);

    const pointer = extractPointer(event);
    const now = performance.now();
    const deltaChange = event.delta.x - dragLogRef.current.lastDeltaX;
    const pointerDeltaX =
      pointer.x !== undefined && !Number.isNaN(dragLogRef.current.lastPointerX)
        ? pointer.x - dragLogRef.current.lastPointerX
        : undefined;
    const pointerDeltaY =
      pointer.y !== undefined && !Number.isNaN(dragLogRef.current.lastPointerY)
        ? pointer.y - dragLogRef.current.lastPointerY
        : undefined;
    const msPerPixel = getMillisecondsPerPixel(zoomLevel);
    const shouldLog =
      now - dragLogRef.current.lastMoveLogAt > 80 ||
      Math.abs(deltaChange) > 6 ||
      (pointerDeltaX !== undefined && Math.abs(pointerDeltaX) > 10);

    if (shouldLog) {
      dragLogRef.current.lastMoveLogAt = now;
      logger.debug('gantt', 'Drag sample', {
        id: activeDrag.goalId,
        dragType: activeDrag.dragType,
        deltaX: event.delta.x,
        deltaChange,
        pointerX: pointer.x,
        pointerY: pointer.y,
        pointerDeltaX,
        pointerDeltaY,
        msPerPixel,
        projectedStart: nextStart.toISOString(),
        projectedEnd: nextEnd.toISOString(),
      });
    }

    dragLogRef.current.lastDeltaX = event.delta.x;
    dragLogRef.current.lastPointerX = pointer.x ?? dragLogRef.current.lastPointerX;
    dragLogRef.current.lastPointerY = pointer.y ?? dragLogRef.current.lastPointerY;
  }, [activeDrag, computeDragDates, updateDragVisual, zoomLevel]);

  const handleRoadmapDragEnd = useCallback(async (event: DragEndEvent) => {
    if (!activeDrag) return;

    const { nextStart, nextEnd } = computeDragDates(activeDrag, event.delta.x);

    const pointer = extractPointer(event);
    logger.debug('gantt', 'Drag end', {
      id: activeDrag.goalId,
      dragType: activeDrag.dragType,
      deltaX: event.delta.x,
      newStart: nextStart.toISOString(),
      newEnd: nextEnd.toISOString(),
      pointerX: pointer.x,
      pointerY: pointer.y,
    });
    logger.perfMark('gantt-drag-end');
    logger.perfMeasure('gantt-drag', 'gantt-drag-start', 'gantt-drag-end');

    resetDragVisual();

    const goal = goals.find(g => g.id === activeDrag.goalId);
    const overData = event.over?.data.current as { kind?: string; themeId?: number } | undefined;
    const dropThemeId = overData?.kind === 'lane' ? overData.themeId ?? null : null;

    if (goal) {
      const impacted = checkImpactedItems(goal.id, nextStart, nextEnd);
      if (impacted.length > 0) {
        logger.warn('gantt', 'Drag impact detected', { goalId: goal.id, impacted: impacted.length });
        setImpactedItems(impacted);
        setPendingGoalUpdate({ goalId: goal.id, startDate: nextStart, endDate: nextEnd });
        setShowImpactModal(true);
      } else {
        await updateGoalDates(goal.id, nextStart, nextEnd);
      }

      if (dropThemeId && dropThemeId !== goal.theme) {
        try {
          await updateDoc(doc(db, 'goals', goal.id), { theme: dropThemeId, updatedAt: Date.now() });
          if (currentUser) {
            await ActivityStreamService.logFieldChange(
              goal.id,
              'goal',
              currentUser.uid,
              currentUser.email || '',
              'theme',
              goal.theme,
              dropThemeId,
              'personal',
              (goal as any).ref || '',
              'human'
            );
          }
        } catch (err) {
          console.error('Failed to update theme on drop', err);
        }
      }
    }

    setActiveDrag(null);
  }, [activeDrag, computeDragDates, currentUser, goals, resetDragVisual, updateGoalDates]);

  const handleRoadmapDragCancel = useCallback((event: DragCancelEvent | undefined) => {
    if (!activeDrag) return;
    const pointer = extractPointer(event);
    logger.debug('gantt', 'Drag cancel', {
      id: activeDrag.goalId,
      dragType: activeDrag.dragType,
      pointerX: pointer.x,
      pointerY: pointer.y,
    });
    const goalElement = document.querySelector(`[data-goal-id="${activeDrag.goalId}"]`) as HTMLElement | null;
    if (goalElement) {
      const startPos = getDatePosition(activeDrag.originStart);
      const endPos = getDatePosition(activeDrag.originEnd);
      goalElement.style.left = `${startPos}px`;
      goalElement.style.width = `${Math.max(4, endPos - startPos)}px`;
    }
    resetDragVisual();
    setActiveDrag(null);
  }, [activeDrag, getDatePosition, resetDragVisual]);

  // Trigger AI story generation for a goal via Cloud Function
  const handleGenerateStories = useCallback(async (goal: GanttItem) => {
    try {
      if (!currentUser) return;
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      await callable({ goalId: goal.id });
    } catch (e: any) {
      console.error('generateStoriesForGoal failed', e);
      alert('Failed to trigger AI story generation: ' + (e?.message || 'unknown'));
    }
  }, [currentUser]);

  // Helper functions
  function getMillisecondsPerPixel(zoom: string): number {
    // Use store domain for precise conversion
    const start = useRoadmapStore.getState().start;
    const end = useRoadmapStore.getState().end;
    const duration = end.getTime() - start.getTime();
    const width = useRoadmapStore.getState().width || canvasRef.current?.scrollWidth || 1000;
    return duration / Math.max(1, Number(width));
  }

  function getDatePosition(date: Date): number {
    try {
      return scale(date);
    } catch {
      const totalDuration = timeRange.end.getTime() - timeRange.start.getTime();
      const itemPosition = date.getTime() - timeRange.start.getTime();
      const canvasWidth = canvasRef.current?.scrollWidth || 1000;
      return (itemPosition / totalDuration) * canvasWidth;
    }
  }

  const snapToWeek = (d: Date): Date => {
    // Snap to Monday of that week when Shift is held
    const out = new Date(d);
    const day = out.getDay(); // 0 Sun - 6 Sat
    const mondayOffset = (day + 6) % 7; // days since Monday
    out.setDate(out.getDate() - mondayOffset);
    out.setHours(0,0,0,0);
    return out;
  };

  // Small util to convert HEX to rgba for theme lane backgrounds
  const hexToRgba = (hex: string, alpha: number) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const checkImpactedItems = (goalId: string, newStartDate: Date, newEndDate: Date): (Story | Task)[] => {
    const impacted: (Story | Task)[] = [];
    
    // Find stories linked to this goal
    const goalStories = stories.filter(story => story.goalId === goalId);
    
    goalStories.forEach(story => {
      // Check if story is in an active sprint
      const sprint = sprints.find(s => s.id === story.sprintId && s.status === 1); // Active sprint
      if (sprint) {
        const sprintStart = new Date(sprint.startDate);
        const sprintEnd = new Date(sprint.endDate);
        
        // Check if goal dates conflict with sprint dates
        if (newStartDate > sprintEnd || newEndDate < sprintStart) {
          impacted.push(story);
          
          // Also check tasks in this story
          const storyTasks = tasks.filter(task => task.parentType === 'story' && task.parentId === story.id);
          impacted.push(...storyTasks);
        }
      }
    });
    
    logger.debug('gantt', 'checkImpactedItems', { goalId, count: impacted.length });
    return impacted;
  };

  // Simple undo buffer for last timeline change
  const lastChangeRef = useRef<{ goalId: string; prevStart: number; prevEnd: number } | null>(null);
  async function updateGoalDates(goalId: string, newStart: Date, newEnd: Date) {
    logger.info('gantt', 'Updating goal dates', { goalId, newStart: newStart.toISOString(), newEnd: newEnd.toISOString() });
    const prev = goals.find(g => g.id === goalId);
    if (prev) {
      lastChangeRef.current = { goalId, prevStart: (prev as any).startDate || 0, prevEnd: (prev as any).endDate || 0 };
    }
    try {
      await updateDoc(doc(db, 'goals', goalId), { startDate: newStart.getTime(), endDate: newEnd.getTime(), updatedAt: Date.now() });
      logger.info('gantt', 'Goal dates updated', { goalId });
      // Log activity for start/end changes (two field changes for clarity)
      if (currentUser) {
        const g = goals.find(x => x.id === goalId);
        if (g) {
          const ref = (g as any).ref || g.title || '';
          await ActivityStreamService.logFieldChange(goalId, 'goal', currentUser.uid, currentUser.email || '', 'startDate', (g as any).startDate, newStart.getTime(), 'personal', ref, 'human');
          await ActivityStreamService.logFieldChange(goalId, 'goal', currentUser.uid, currentUser.email || '', 'endDate', (g as any).endDate, newEnd.getTime(), 'personal', ref, 'human');
        }
      }
    } catch (err) {
      logger.error('gantt', 'Failed to update goal dates', { goalId, err });
      throw err;
    }
    setLiveAnnouncement(`Updated ${goals.find(g=>g.id===goalId)?.title || 'goal'} to ${newStart.toLocaleDateString()} – ${newEnd.toLocaleDateString()}`);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        const last = lastChangeRef.current;
        if (last) {
          updateDoc(doc(db, 'goals', last.goalId), { startDate: last.prevStart, endDate: last.prevEnd, updatedAt: Date.now() });
          lastChangeRef.current = null;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // duplicate updateGoalDates removed

  const confirmGoalUpdate = async () => {
    if (pendingGoalUpdate) {
      await updateGoalDates(pendingGoalUpdate.goalId, pendingGoalUpdate.startDate, pendingGoalUpdate.endDate);
      
      // Log impacted items in activity stream
      for (const item of impactedItems) {
        await ActivityStreamService.addNote(
          item.id,
          'type' in item && item.type ? item.type as any : 'story',
          currentUser?.uid || '',
          currentUser?.email || '',
          'personal',
          `Impacted by goal timeline change`
        );
      }
    }
    
    setShowImpactModal(false);
    setPendingGoalUpdate(null);
    setImpactedItems([]);
  };

  // Delete a goal from timeline
  const handleDeleteGoal = useCallback(async (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    const name = goal?.title || 'goal';
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'goals', goalId));
      logger.info('gantt', 'Goal deleted', { goalId });
      // Log deletion
      if (currentUser) {
        const g = goals.find(x => x.id === goalId);
        await ActivityStreamService.logDeletion(goalId, 'goal', g?.title || '', currentUser.uid, currentUser.email || undefined, 'personal', (g as any)?.ref || '', 'human');
      }
    } catch (e) {
      logger.error('gantt', 'Failed to delete goal', { goalId, e });
      alert('Failed to delete goal.');
    }
  }, [goals]);

  // Generate timeline months/quarters
  const generateTimelineHeaders = () => {
    const headers = [];
    const current = new Date(timeRange.start);
    
    while (current <= timeRange.end) {
      if (zoomLevel === 'month') {
        headers.push({
          label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          date: new Date(current),
          width: getDatePosition(new Date(current.getFullYear(), current.getMonth() + 1, 1)) - getDatePosition(current)
        });
        current.setMonth(current.getMonth() + 1);
      } else if (zoomLevel === 'quarter') {
        const quarter = Math.floor(current.getMonth() / 3) + 1;
        headers.push({
          label: `Q${quarter} ${current.getFullYear()}`,
          date: new Date(current),
          width: getDatePosition(new Date(current.getFullYear(), current.getMonth() + 3, 1)) - getDatePosition(current)
        });
        current.setMonth(current.getMonth() + 3);
      }
    }
    
    return headers;
  };

  const zoomLevels: Array<typeof zoomLevel> = ['week', 'month', 'quarter', 'half', 'year'];
  const handleWheelZoom: React.WheelEventHandler<HTMLDivElement> = (e) => {
    // Ctrl/trackpad pinch → continuous zoom around cursor anchor
    if (e.ctrlKey) {
      e.preventDefault();
      const store = useRoadmapStore.getState();
      const { start, end, width } = store;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || width <= 0) return;
      const localX = e.clientX - rect.left - 250; // subtract label column width
      const clampedX = Math.max(0, Math.min(width, localX));
      const domain = end.getTime() - start.getTime();
      const anchor = new Date(start.getTime() + (clampedX / width) * domain);
      const zoomIntensity = 0.0016; // tune zoom speed
      const factor = Math.max(0.2, Math.min(5, 1 + e.deltaY * zoomIntensity));
      const newStart = new Date(anchor.getTime() - (anchor.getTime() - start.getTime()) * factor);
      const newEnd = new Date(anchor.getTime() + (end.getTime() - anchor.getTime()) * factor);
      // Clamp to reasonable window (min 7 days)
      const minSpan = 7 * 24 * 60 * 60 * 1000;
      if (newEnd.getTime() - newStart.getTime() < minSpan) {
        const mid = (newStart.getTime() + newEnd.getTime()) / 2;
        store.setRange(new Date(mid - minSpan / 2), new Date(mid + minSpan / 2));
      } else {
        store.setRange(newStart, newEnd);
      }
      return;
    }
    // Otherwise discrete zoom steps for wheel
    if (Math.abs(e.deltaY) < 35) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    const idx = zoomLevels.indexOf(zoomLevel);
    const next = Math.min(zoomLevels.length - 1, Math.max(0, idx + dir));
    if (next !== idx) {
      setZoomLevel(zoomLevels[next]);
      useRoadmapStore.getState().setZoom(zoomLevels[next]);
    }
  };

  // Drag-to-pan timeline when holding Space or using middle mouse button
  const onContainerMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    // Avoid conflict with goal bar drags (those start on bars, not container). Allow middle click always; left with Space held.
    if (!(e.button === 1 || (e.button === 0 && isSpaceDownRef.current))) return;
    e.preventDefault();
    const startStart = useRoadmapStore.getState().start;
    const startEnd = useRoadmapStore.getState().end;
    panRef.current = { active: true, startX: e.clientX, startStart, startEnd };
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
    panInertiaRef.current = { vx: 0, lastX: e.clientX, lastT: performance.now() };
    const onMove = (ev: MouseEvent) => {
      if (!panRef.current?.active) return;
      const dx = ev.clientX - panRef.current.startX;
      const msPerPx = getMillisecondsPerPixel(zoomLevel);
      const delta = dx * msPerPx * -1; // drag right -> move timeline left
      const newStart = new Date(panRef.current.startStart.getTime() + delta);
      const newEnd = new Date(panRef.current.startEnd.getTime() + delta);
      useRoadmapStore.getState().setRange(newStart, newEnd);
      // update inertia velocity
      const now = performance.now();
      if (panInertiaRef.current) {
        const dt = Math.max(1, now - panInertiaRef.current.lastT);
        const ddx = ev.clientX - panInertiaRef.current.lastX;
        panInertiaRef.current.vx = ddx / dt; // px per ms
        panInertiaRef.current.lastX = ev.clientX;
        panInertiaRef.current.lastT = now;
      }
    };
    const onUp = () => {
      if (containerRef.current) containerRef.current.style.cursor = '';
      panRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Start inertia if velocity is significant
      const state = panInertiaRef.current;
      if (!state) return;
      let vx = state.vx; // px/ms
      if (Math.abs(vx) < 0.02) return; // threshold
      const friction = 0.92;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        const msPerPx = getMillisecondsPerPixel(zoomLevel);
        const delta = vx * dt * msPerPx * -1; // convert to ms domain
        const store = useRoadmapStore.getState();
        const newStart = new Date(store.start.getTime() + delta);
        const newEnd = new Date(store.end.getTime() + delta);
        store.setRange(newStart, newEnd);
        vx *= friction;
        if (Math.abs(vx) >= 0.005) {
          state.raf = requestAnimationFrame(tick);
        }
      };
      state.raf = requestAnimationFrame(tick);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Pinch zoom on touch devices (two fingers)
  const onContainerTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const midX = ((t1.clientX + t2.clientX) / 2) - rect.left - 250;
      const w = useRoadmapStore.getState().width;
      const { start, end } = useRoadmapStore.getState();
      const domain = end.getTime() - start.getTime();
      const anchor = new Date(start.getTime() + (Math.max(0, Math.min(w, midX)) / Math.max(1, w)) * domain);
      pinchRef.current = { active: true, startDist: dist, startStart: start, startEnd: end, anchor };
      e.preventDefault();
    }
  };

  const onContainerTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const pinch = pinchRef.current;
    if (pinch && e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);
      const factor = Math.max(0.2, Math.min(5, pinch.startDist / Math.max(1, dist)));
      const start = pinch.startStart;
      const end = pinch.startEnd;
      const anchor = pinch.anchor;
      const newStart = new Date(anchor.getTime() - (anchor.getTime() - start.getTime()) * factor);
      const newEnd = new Date(anchor.getTime() + (end.getTime() - anchor.getTime()) * factor);
      // Min 7 days
      const minSpan = 7 * 24 * 60 * 60 * 1000;
      if (newEnd.getTime() - newStart.getTime() < minSpan) {
        const mid = (newStart.getTime() + newEnd.getTime()) / 2;
        useRoadmapStore.getState().setRange(new Date(mid - minSpan / 2), new Date(mid + minSpan / 2));
      } else {
        useRoadmapStore.getState().setRange(newStart, newEnd);
      }
      e.preventDefault();
    }
  };

  const onContainerTouchEnd: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (e.touches.length < 2) pinchRef.current = null;
  };

  if (viewMode === 'roadmap') {
    return <ThemeRoadmap onBackToTimeline={() => setViewMode('timeline')} />;
  }

  if (loading) {
    return (
      <Container fluid className="p-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading enhanced Gantt chart...</p>
        </div>
      </Container>
    );
  }

  // V2 removed: native timeline implementation continues below

  return (
    <>
    <Container fluid className="enhanced-gantt-chart p-0">
      {/* Header */}
      <Card className="border-0 shadow-sm">
        <Card.Header style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <Row className="align-items-center">
            <Col md={6}>
              <h4 className="mb-0 d-flex align-items-center">
                <Calendar className="me-2" size={24} />
                Enhanced Goals Timeline
              </h4>
            </Col>
            <Col md={6} className="text-end">
              <div className="d-flex align-items-center justify-content-end gap-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={openActivitySidebar}
                  disabled={goals.length === 0}
                >
                  <Activity size={16} className="me-1" />
                  Activity
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  title="Fit all goals"
                  onClick={fitAll}
                >
                  Fit
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  title="Today"
                  onClick={jumpToToday}
                >
                  Today
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  title="Jump to selected sprint"
                  onClick={jumpToSelectedSprint}
                  disabled={!selectedSprintId}
                >
                  Sprint
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  title="Fit current sprint and overlapping goals"
                  onClick={() => {
                    const selected = selectedSprintId ? sprints.find(s => s.id === selectedSprintId) : sprints.find(s => s.status === 1);
                    if (!selected) return;
                    const sstart = new Date(selected.startDate).getTime();
                    const send = new Date(selected.endDate).getTime();
                    let min = sstart;
                    let max = send;
                    goals.forEach(g => {
                      const gs = g.startDate ? Number(g.startDate) : undefined;
                      const ge = g.endDate ? Number(g.endDate) : g.targetDate ? new Date(g.targetDate).getTime() : undefined;
                      if (!gs || !ge) return;
                      const overlaps = gs <= send && ge >= sstart;
                      if (overlaps) { min = Math.min(min, gs); max = Math.max(max, ge); }
                    });
                    const pad = Math.round((max - min) * 0.08);
                    useRoadmapStore.getState().setRange(new Date(min - pad), new Date(max + pad));
                  }}
                  disabled={sprints.length === 0}
                >
                  Fit Sprint
                </Button>
                {/* Roadmap toggle removed; Card view available via sidebar menu */}
                <Button variant="outline-secondary" size="sm" onClick={() => setZoomLevel('month')} title="Zoom in">
                  <ZoomIn size={16} />
                </Button>
                <Button variant="outline-secondary" size="sm" onClick={() => setZoomLevel('year')} title="Zoom out">
                  <ZoomOut size={16} />
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                >
                  {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </Button>
              </div>
            </Col>
          </Row>
        </Card.Header>
        
        <Card.Body className="p-3">
          <Row className="mb-3 g-3">
            {/* Left sticky controls */}
            <Col md={3} style={{ position: 'sticky', top: 72, alignSelf: 'flex-start' }}>
              <Card className="shadow-sm">
                <Card.Body>
                  <div className="fw-semibold mb-2">Timeline Controls</div>
                  {/* Global sprint selector appears in the top app toolbar; remove duplicate from here */}
                  <div className="mb-3">
                    <div className="small text-muted mb-1">Zoom</div>
                    <div className="d-flex gap-2 align-items-center">
                      <Form.Select value={zoomLevel} onChange={(e) => { const z = e.target.value as any; setZoomLevel(z); useRoadmapStore.getState().setZoom(z); }} size="sm" style={{ maxWidth: 200 }}>
                        <option value="week">Weeks</option>
                        <option value="month">Months</option>
                        <option value="quarter">Quarters</option>
                        <option value="half">Half-year</option>
                        <option value="year">Years</option>
                      </Form.Select>
                      <Button size="sm" variant="outline-secondary" onClick={() => { const i = zoomLevels.indexOf(zoomLevel); const next = Math.max(0, i - 1); setZoomLevel(zoomLevels[next]); useRoadmapStore.getState().setZoom(zoomLevels[next]); }} title="Zoom In"><ZoomIn size={14} /></Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => { const i = zoomLevels.indexOf(zoomLevel); const next = Math.min(zoomLevels.length - 1, i + 1); setZoomLevel(zoomLevels[next]); useRoadmapStore.getState().setZoom(zoomLevels[next]); }} title="Zoom Out"><ZoomOut size={14} /></Button>
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="small text-muted mb-1">Presets</div>
                    <div className="d-flex flex-wrap gap-2">
                      <Button size="sm" variant="outline-secondary" onClick={() => useRoadmapStore.getState().setZoom('week')}>Week</Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => useRoadmapStore.getState().setZoom('month')}>Month</Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => useRoadmapStore.getState().setZoom('quarter')}>Quarter</Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => setSpanYears(1)}>1y</Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => setSpanYears(3)}>3y</Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => setSpanYears(5)}>5y</Button>
                    </div>
                  </div>
                  <Form.Check type="switch" id="toggle-links" label="Show links" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
                  <Form.Check type="switch" id="toggle-autofit" label="Auto-fit sprint goals" checked={autoFitSprintGoals} onChange={(e) => setAutoFitSprintGoals(e.target.checked)} />
                  <Form.Check type="switch" id="toggle-group" label="Group by Theme" checked={groupByTheme} onChange={(e) => setGroupByTheme(e.target.checked)} />
                </Card.Body>
              </Card>
            </Col>
            {/* Right filters */}
            <Col md={9}>
              <Row className="g-2">
                <Col md={6}>
                  <Form.Control type="text" placeholder="Search goals..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </Col>
                <Col md={6}>
                  <div className="d-flex justify-content-end gap-2 flex-wrap">
                    <Button size="sm" variant="outline-secondary" onClick={() => { try { window.print(); } catch {} }} aria-label="Print"><Printer size={14} /></Button>
                    <Button size="sm" variant={copied ? 'success' : 'outline-secondary'} onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(()=>setCopied(false), 1800); } catch {} }} aria-label="Copy Link"><Share2 size={14} /></Button>
                    {themes.map(theme => (
                      <Badge key={theme.id} bg={selectedThemes.includes(theme.id) ? 'primary' : 'outline-secondary'}
                        className="cursor-pointer"
                        onClick={() => setSelectedThemes(prev => prev.includes(theme.id) ? prev.filter(t => t !== theme.id) : [...prev, theme.id])}
                        style={{ backgroundColor: selectedThemes.includes(theme.id) ? theme.color : 'transparent', borderColor: theme.color, color: selectedThemes.includes(theme.id) ? 'white' : theme.color }}>
                        {theme.name}
                      </Badge>
                    ))}
                  </div>
                </Col>
              </Row>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Main Timeline */}
      <div
        ref={containerRef}
        className="timeline-container"
        style={{ height: isFullscreen ? '100vh' : 'calc(100vh - 250px)', overflow: 'auto' }}
        onWheel={handleWheelZoom}
        onMouseDown={onContainerMouseDown}
        onTouchStart={onContainerTouchStart}
        onTouchMove={onContainerTouchMove}
        onTouchEnd={onContainerTouchEnd}
      >
        {/* Live region for a11y announcements */}
        <div aria-live="polite" className="visually-hidden">{liveAnnouncement}</div>
        {/* Timeline Header */}
        <div className="timeline-header sticky-top" style={{ zIndex: 30, backgroundColor: 'var(--bs-body-bg)', borderBottom: '1px solid var(--line)', boxShadow: '0 1px 0 var(--line), 0 6px 16px rgba(0,0,0,0.06)', position: 'sticky', top: 0 }}>
          <div className="d-flex">
            <div style={{ position: 'sticky', left: 0, zIndex: 21, width: '250px', minWidth: '250px', background: 'var(--bs-body-bg)', borderRight: '1px solid var(--line)' }} className="p-2">
              <div className="d-flex flex-column">
                <strong>Goals & Themes</strong>
                <Form.Check
                  type="switch"
                  id="toggle-empty-themes"
                  label="Show empty themes"
                  className="mt-1"
                  checked={showEmptyThemes}
                  onChange={(e) => setShowEmptyThemes(e.currentTarget.checked)}
                />
              </div>
            </div>
            <div ref={headerMonthsRef} className="timeline-months d-flex position-relative" style={{ minWidth: '200%', height: 60 }}>
              {/* Navigation arrows */}
              <div className="position-absolute d-flex align-items-center" style={{ left: 8, top: 12, zIndex: 22, gap: 6 }}>
                <Button size="sm" variant="outline-secondary" aria-label="Scroll left" onClick={() => { const el = containerRef.current; if (el) { el.scrollBy({ left: -Math.floor(el.clientWidth * 0.6), behavior: 'smooth' }); } }}>&lsaquo;</Button>
                <Button size="sm" variant="outline-secondary" aria-label="Scroll right" onClick={() => { const el = containerRef.current; if (el) { el.scrollBy({ left: Math.floor(el.clientWidth * 0.6), behavior: 'smooth' }); } }}>&rsaquo;</Button>
              </div>
              {/* Visible range chip */}
              <div className="position-absolute" style={{ right: 8, top: 12, zIndex: 22, background: 'rgba(0,0,0,0.06)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: 'var(--bs-body-color)' }}>
                {visibleRangeText}
              </div>
              {/* Sprint shading under header months */}
              <div className="position-absolute" style={{ left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'none', zIndex: 0 }}>
                {sprints.map(sprint => (
                  <div
                    key={`hdr-${sprint.id}`}
                    className="position-absolute"
                    style={{
                      left: `${getDatePosition(new Date(sprint.startDate))}px`,
                      width: `${getDatePosition(new Date(sprint.endDate)) - getDatePosition(new Date(sprint.startDate))}px`,
                      top: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(59, 130, 246, 0.05)'
                    }}
                    aria-hidden="true"
                    title={`${sprint.name}: ${new Date(sprint.startDate).toLocaleDateString()} - ${new Date(sprint.endDate).toLocaleDateString()}`}
                  />
                ))}
              </div>
              {/* Months band */}
              <div className="position-absolute" style={{ left: 0, right: 0, top: 0, height: 24, zIndex: 21, background: 'var(--bs-body-bg)', borderBottom: '1px solid var(--line)' }}>
                {(() => {
                  const items: any[] = [];
                  const start = useRoadmapStore.getState().start;
                  const end = useRoadmapStore.getState().end;
                  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
                  while (cur <= end) {
                    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
                    const left = getDatePosition(cur);
                    const width = getDatePosition(next) - getDatePosition(cur);
                    items.push(
                      <div key={`m-${cur.getFullYear()}-${cur.getMonth()}`} className="position-absolute text-center" style={{ left, width, top: 0, bottom: 0, borderRight: '1px solid var(--line)', color: 'var(--bs-body-color)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {cur.toLocaleDateString('en-US', { month: 'long' })} {cur.getMonth() === 0 ? cur.getFullYear() : ''}
                      </div>
                    );
                    cur.setMonth(cur.getMonth() + 1);
                  }
                  return items;
                })()}
              </div>
              {/* Weeks/axis band */}
              <div className="w-100" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, zIndex: 21, background: 'var(--bs-body-bg)' }}>
                <RoadmapAxis height={36} />
                {/* Today chip */}
                <div className="position-absolute" style={{ left: `${getDatePosition(new Date())}px`, top: -22, transform: 'translateX(-50%)', background: 'rgba(16,185,129,0.12)', color: '#059669', border: '1px solid rgba(16,185,129,0.35)', fontSize: 11, padding: '2px 6px', borderRadius: 6 }}>Today</div>
              </div>
            </div>
          </div>
        </div>

        {/* Today marker moved into canvas so it doesn't overlay header */}
        {/* Ghost drag tooltip */}
        {(dragOverlay || true) && (
          <div ref={dragTooltipRef} className="drag-tooltip" style={{ left: dragOverlay?.left ?? -9999, top: 60 }}>
            {dragOverlay?.text}
          </div>
        )}

        {/* Goals Rows */}
        <div ref={canvasRef} className="goals-canvas" style={{ position: 'relative' }}>
          {/* Sprint shading behind canvas rows */}
          <div className="position-absolute" style={{ left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'none', zIndex: 1 }}>
            {sprints.map(sprint => (
              <div
                key={`cnv-${sprint.id}`}
                className="position-absolute"
                style={{
                  left: `${getDatePosition(new Date(sprint.startDate))}px`,
                  width: `${getDatePosition(new Date(sprint.endDate)) - getDatePosition(new Date(sprint.startDate))}px`,
                  top: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(59, 130, 246, 0.05)',
                  borderLeft: '1px solid rgba(59,130,246,0.25)',
                  borderRight: '1px solid rgba(59,130,246,0.25)'
                }}
                aria-hidden="true"
                title={`${sprint.name}: ${new Date(sprint.startDate).toLocaleDateString()} - ${new Date(sprint.endDate).toLocaleDateString()}`}
              />
            ))}
          </div>
          {/* Today marker within canvas */}
          <div className="position-absolute" style={{
            left: `${getDatePosition(new Date())}px`,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: 'var(--red)',
            zIndex: 2
          }} title={`Today: ${new Date().toLocaleDateString()}`} />
          {(
            groupByTheme
              ? (showEmptyThemes ? themes.map(t => t.id) : Object.keys(goalsByTheme).map(k => parseInt(k,10)))
                  .sort((a,b)=>a-b)
              : [null]
            ).map(groupKey => (
            <div key={groupKey === null ? 'all' : `theme-${groupKey}`} data-theme-group={groupKey ?? ''} className="theme-group">
              {groupByTheme && (
                <div className="d-flex align-items-center" style={{ height: 32 }}>
                  <div style={{ position: 'sticky', left: 0, zIndex: 5, background: 'var(--bs-body-bg)', width: 250, minWidth: 250, color: getThemeById(migrateThemeValue(groupKey as number)).color, borderRight: '1px solid var(--line)' }} className="px-2 fw-semibold">{themes.find(t => t.id === groupKey)?.name}</div>
                  <div className="flex-grow-1" style={{ borderBottom: '1px solid var(--line)' }} />
                </div>
              )}
          <VirtualThemeLane
            themeId={(groupKey as number) || 0}
            themeName={themes.find(t => t.id === groupKey)?.name || ''}
            themeColor={getThemeById(migrateThemeValue(groupKey as number)).color || ''}
            items={(groupByTheme ? (goalsByTheme[groupKey as number] || []) : ganttItems.filter(g => g.type==='goal')) as any}
            getDatePosition={getDatePosition}
            storiesByGoal={storiesByGoal}
            doneStoriesByGoal={doneStoriesByGoal}
            lastNotes={lastNotes}
            zoom={zoomLevel}
            onDragStart={() => {}}
            onItemClick={handleItemClick as any}
            setSelectedGoalId={setSelectedGoalId}
            handleGenerateStories={handleGenerateStories as any}
            setActivityGoalId={setActivityGoalId as any}
            setNoteGoalId={setNoteGoalId as any}
            setNoteDraft={setNoteDraft}
            updateGoalDates={updateGoalDates}
            getThemeStyle={(id) => ({ color: getThemeById(migrateThemeValue(id)).color, textColor: getThemeById(migrateThemeValue(id)).textColor }) as any}
          />
          </div>
          ))}
        </div>
      </div>

      {/* Selected Goal Stories Panel */}
      {selectedGoalId && (
        <Card ref={storiesPanelRef} className="border-top rounded-0" style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <div>
              <strong>Stories for goal</strong>
              <span className="ms-2 text-muted">{goals.find(g => g.id === selectedGoalId)?.title}</span>
            </div>
            <Button size="sm" variant="outline-secondary" onClick={() => setSelectedGoalId(null)}>Close</Button>
          </Card.Header>
          <Card.Body>
            <ModernStoriesTable
              stories={stories}
              goals={goals}
              goalId={selectedGoalId}
              onStoryUpdate={async () => {}}
              onStoryDelete={async () => {}}
              onStoryPriorityChange={async () => {}}
              onStoryAdd={() => Promise.resolve()}
            />
          </Card.Body>
        </Card>
      )}

      {/* Impact Modal */}
      <Modal show={showImpactModal} onHide={() => setShowImpactModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center">
            <AlertTriangle className="me-2 text-warning" size={24} />
            Timeline Change Impact
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning">
            <p><strong>Warning:</strong> This goal timeline change will impact the following items in active sprints:</p>
          </Alert>
          
          <div className="space-y-2">
            {impactedItems.map(item => (
              <Card key={item.id} className="border">
                <Card.Body className="p-3">
                  <div className="d-flex justify-content-between align-items-center">
                    <div>
                      <h6 className="mb-1">{item.title}</h6>
                      {'ref' in item && <small className="text-muted">{item.ref}</small>}
                    </div>
                    <Badge bg="warning">{'parentType' in item ? 'Task' : 'Story'}</Badge>
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
          
          <p className="mt-3 text-muted">
            These items will be logged in the activity stream for review.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImpactModal(false)}>
            Cancel
          </Button>
          <Button variant="warning" onClick={confirmGoalUpdate}>
            Proceed with Changes
          </Button>
        </Modal.Footer>
      </Modal>
  </Container>
    {/* Activity Modal */}
    <Modal show={!!activityGoalId} onHide={() => setActivityGoalId(null)} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Goal Activity</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {activityItems.length === 0 && <div className="text-muted">No recent activity.</div>}
        {activityItems.map((a) => (
          <div key={a.id} className="d-flex align-items-center gap-2 py-1 border-bottom">
            <span>{ActivityStreamService.formatActivityIcon(a.activityType)}</span>
            <div className="flex-grow-1">
              <div className="small">{a.description}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{a.userEmail || a.userId}</div>
            </div>
          </div>
        ))}
      </Modal.Body>
    </Modal>

    {/* Add Note Modal */}
    <Modal show={!!noteGoalId} onHide={() => setNoteGoalId(null)}>
      <Modal.Header closeButton>
        <Modal.Title>Add Note</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Control as="textarea" rows={4} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write a quick note about this goal..." />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setNoteGoalId(null)}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          if (!noteGoalId || !currentUser) return;
          try {
            await updateDoc(doc(db, 'goals', noteGoalId), { recentNote: noteDraft, recentNoteAt: Date.now() });
            await ActivityStreamService.addNote(noteGoalId, 'goal', noteDraft, currentUser.uid, currentUser.email || undefined, 'personal', '', 'human');
            setNoteGoalId(null);
            setNoteDraft('');
          } catch (e) {
            console.error('Add note failed', e);
          }
        }}>Save Note</Button>
      </Modal.Footer>
    </Modal>

    {/* Edit Modal outside Container to avoid clipping */}
    <EditGoalModal
      goal={editGoal}
      show={!!editGoal}
      onClose={() => setEditGoal(null)}
      currentUserId={currentUser?.uid || ''}
    />

    {/* Open Tasks Modal */}
    <Modal show={!!tasksModalGoalId} onHide={() => setTasksModalGoalId(null)} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Open Tasks</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {tasksForModal.length === 0 ? (
          <div className="text-muted">No open tasks.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {tasksForModal.map(t => (
                  <tr key={t.id}>
                    <td className="text-muted">{t.ref || '-'}</td>
                    <td>{t.title}</td>
                    <td>{t.status === 2 ? 'Done' : t.status === 1 ? 'In Progress' : t.status === 3 ? 'Blocked' : 'To Do'}</td>
                    <td>P{t.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setTasksModalGoalId(null)}>Close</Button>
      </Modal.Footer>
    </Modal>
    </>
  );
};

export default EnhancedGanttChart;

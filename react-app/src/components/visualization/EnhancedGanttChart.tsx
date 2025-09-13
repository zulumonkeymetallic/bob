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
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
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
import RoadmapV2 from './RoadmapV2';
import { useSidebar } from '../../contexts/SidebarContext';

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

interface DragState {
  isDragging: boolean;
  itemId: string | null;
  dragType: 'move' | 'resize-start' | 'resize-end';
  startX: number;
  startDate: Date;
  endDate: Date;
}

interface ActivityStreamItem {
  id: string;
  type: 'goal' | 'story' | 'sprint' | 'task';
  title: string;
  ref?: string;
  status: number;
  theme?: number;
  linkedTo: string[];
}

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
  const [storiesByGoal, setStoriesByGoal] = useState<Record<string, number>>({});
  const [doneStoriesByGoal, setDoneStoriesByGoal] = useState<Record<string, number>>({});
  const [activityGoalId, setActivityGoalId] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<any[]>([]);
  const [noteGoalId, setNoteGoalId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [dragOverlay, setDragOverlay] = useState<{ left: number; width: number; text: string } | null>(null);
  const dragTooltipRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const renderCountRef = useRef(0);
  const dragLogRef = useRef({ lastMoveLogAt: 0 });
  const isSpaceDownRef = useRef(false);
  const panRef = useRef<{ active: boolean; startX: number; startStart: Date; startEnd: Date } | null>(null);
  const panInertiaRef = useRef<{ vx: number; lastX: number; lastT: number; raf?: number } | null>(null);
  const isShiftDownRef = useRef(false);
  const pinchRef = useRef<{ active: boolean; startDist: number; startStart: Date; startEnd: Date; anchor: Date } | null>(null);
  
  // Drag and drop state
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    itemId: null,
    dragType: 'move',
    startX: 0,
    startDate: new Date(),
    endDate: new Date()
  });
  
  // Activity stream state
  const [showActivityStream, setShowActivityStream] = useState(false);
  const [activityStreamItems, setActivityStreamItems] = useState<ActivityStreamItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
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
  const groupPositionsRef = useRef<Array<{ themeId: number; top: number; bottom: number; el: HTMLElement }>>([]);
  const hoveredThemeRef = useRef<number | null>(null);
  
  // Theme definitions
  const themes = [
    { id: 1, name: 'Health', color: 'var(--theme-health-primary)' },
    { id: 2, name: 'Growth', color: 'var(--theme-growth-primary)' },
    { id: 3, name: 'Wealth', color: 'var(--theme-wealth-primary)' },
    { id: 4, name: 'Tribe', color: 'var(--theme-tribe-primary)' },
    { id: 5, name: 'Home', color: 'var(--theme-home-primary)' }
  ];

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
  }, [zoomLevel, goals.length, sprints.length]);

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
      if (selectedThemes.length > 0 && !selectedThemes.includes(goal.theme)) return;
      if (searchTerm && !goal.title.toLowerCase().includes(searchTerm.toLowerCase())) return;

      const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
      const endDate = goal.endDate ? new Date(goal.endDate) : 
        goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      items.push({
        id: goal.id,
        title: goal.title,
        type: 'goal',
        theme: goal.theme,
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
      if (a.theme !== b.theme) return a.theme - b.theme;
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
      grouped[g.theme] = grouped[g.theme] || [];
      grouped[g.theme].push(g);
    });
    return grouped;
  }, [ganttItems]);

  // Handle item click for activity stream
  const handleItemClick = useCallback(async (item: GanttItem) => {
    setSelectedItemId(item.id);
    if (item.type === 'goal') setSelectedGoalId(item.id);
    setShowActivityStream(true);

    // Find all linked items
    const linkedItems: ActivityStreamItem[] = [];

    if (item.type === 'goal') {
      // Find stories linked to this goal
      const goalStories = stories.filter(story => story.goalId === item.id);
      goalStories.forEach(story => {
        linkedItems.push({
          id: story.id,
          type: 'story',
          title: story.title,
          ref: story.ref,
          status: story.status,
          theme: story.theme,
          linkedTo: [item.id]
        });

        // Find tasks linked to these stories
        const storyTasks = tasks.filter(task => task.parentType === 'story' && task.parentId === story.id);
        storyTasks.forEach(task => {
          linkedItems.push({
            id: task.id,
            type: 'task',
            title: task.title,
            ref: task.ref,
            status: task.status,
            theme: task.theme,
            linkedTo: [item.id, story.id]
          });
        });
      });
    }

    setActivityStreamItems([
      {
        id: item.id,
        type: item.type,
        title: item.title,
        status: item.status,
        theme: item.theme,
        linkedTo: []
      },
      ...linkedItems
    ]);

    // Prepare open tasks modal for goals
    if (item.type === 'goal') {
      const goalStories = stories.filter(story => story.goalId === item.id);
      const storyIds = new Set(goalStories.map(s => s.id));
      const open = tasks.filter(t => (t.goalId === item.id) || (t.parentType === 'story' && storyIds.has(t.parentId)));
      const openOnly = open.filter(t => t.status !== 2);
      setTasksForModal(openOnly);
      setTasksModalGoalId(item.id);
    }

    // Log activity
    await ActivityStreamService.addActivity({
      entityId: item.id,
      entityType: item.type as 'goal' | 'story' | 'task',
      activityType: 'note_added',
      userId: currentUser?.uid || '',
      userEmail: currentUser?.email || '',
      description: `Viewed ${item.type} "${item.title}" in Gantt chart`,
      noteContent: `Gantt view interaction: ${JSON.stringify({ title: item.title, ganttView: true })}`,
      source: 'human'
    });
  }, [stories, tasks, currentUser]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, item: GanttItem, dragType: DragState['dragType']) => {
    if (item.type !== 'goal') return; // Only goals can be dragged
    
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    logger.debug('gantt', 'Drag start', { id: item.id, dragType, clientX, start: item.startDate, end: item.endDate });
    logger.perfMark('gantt-drag-start');
    // Snapshot theme group positions for vertical drop detection
    const groups = Array.from(document.querySelectorAll('[data-theme-group]')) as HTMLElement[];
    groupPositionsRef.current = groups.map((el) => {
      const rect = el.getBoundingClientRect();
      const themeIdAttr = el.getAttribute('data-theme-group') || '0';
      return { themeId: parseInt(themeIdAttr, 10), top: rect.top, bottom: rect.bottom, el };
    });
    
    setDragState({
      isDragging: true,
      itemId: item.id,
      dragType,
      startX: clientX,
      startDate: new Date(item.startDate),
      endDate: new Date(item.endDate)
    });

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);
  }, []);

  // Handle drag move
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragState.isDragging || !dragState.itemId) return;
    
    const isTouch = 'touches' in e;
    const clientX = isTouch ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = isTouch ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
    const deltaX = clientX - dragState.startX;
    
    // Calculate time delta based on zoom level
    const msPerPixel = getMillisecondsPerPixel(zoomLevel);
    const timeDelta = deltaX * msPerPixel;
    
    // Update dates based on drag type
    let newStartDate = new Date(dragState.startDate);
    let newEndDate = new Date(dragState.endDate);
    
    if (dragState.dragType === 'move') {
      newStartDate = new Date(dragState.startDate.getTime() + timeDelta);
      newEndDate = new Date(dragState.endDate.getTime() + timeDelta);
    } else if (dragState.dragType === 'resize-start') {
      newStartDate = new Date(Math.min(dragState.startDate.getTime() + timeDelta, dragState.endDate.getTime() - 24 * 60 * 60 * 1000));
    } else if (dragState.dragType === 'resize-end') {
      newEndDate = new Date(Math.max(dragState.endDate.getTime() + timeDelta, dragState.startDate.getTime() + 24 * 60 * 60 * 1000));
    }

    // Determine hovered theme group for potential reassignment
    const hovered = groupPositionsRef.current.find(g => clientY >= g.top && clientY <= g.bottom)?.themeId ?? null;
    if (hoveredThemeRef.current !== hovered) {
      const prev = groupPositionsRef.current.find(g => g.themeId === hoveredThemeRef.current);
      if (prev) prev.el.classList.remove('theme-group--target');
      hoveredThemeRef.current = hovered;
      const next = groupPositionsRef.current.find(g => g.themeId === hovered);
      if (next) next.el.classList.add('theme-group--target');
    }
    
    // Snap to whole-day boundaries; if Shift held, snap start to Monday of its week and end to following Monday
    newStartDate.setHours(0,0,0,0);
    newEndDate.setHours(0,0,0,0);
    if (isShiftDownRef.current) {
      const s = snapToWeek(newStartDate);
      const e2 = snapToWeek(newEndDate);
      // Ensure at least 7 days
      if (e2.getTime() <= s.getTime()) e2.setDate(s.getDate() + 7);
      newStartDate = s; newEndDate = e2;
    }

    // Update the visual representation
    const goalElement = document.querySelector(`[data-goal-id="${dragState.itemId}"]`) as HTMLElement;
    if (goalElement) {
      const startPos = getDatePosition(newStartDate);
      const endPos = getDatePosition(newEndDate);
      goalElement.style.left = `${startPos}px`;
      goalElement.style.width = `${endPos - startPos}px`;
      // Update tooltip via ref to avoid React re-render on each move
      const tooltip = dragTooltipRef.current;
      if (tooltip) {
        tooltip.style.left = `${250 + startPos}px`;
        tooltip.textContent = `${newStartDate.toLocaleDateString()} → ${newEndDate.toLocaleDateString()}`;
      } else {
        setDragOverlay({ left: 250 + startPos, width: endPos - startPos, text: `${newStartDate.toLocaleDateString()} → ${newEndDate.toLocaleDateString()}` });
      }
    }

    // Throttled logging to avoid spam during drag
    const now = performance.now();
    if (now - dragLogRef.current.lastMoveLogAt > 120) {
      dragLogRef.current.lastMoveLogAt = now;
      logger.debug('gantt', 'Drag move', {
        id: dragState.itemId,
        dragType: dragState.dragType,
        deltaX,
        newStart: newStartDate.toISOString(),
        newEnd: newEndDate.toISOString(),
      });
    }
  }, [dragState, zoomLevel]);

  // Handle drag end
  const handleDragEnd = useCallback(async (e: MouseEvent | TouchEvent) => {
    if (!dragState.isDragging || !dragState.itemId) return;
    
    const clientX = 'touches' in e ? (e as TouchEvent).changedTouches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as TouchEvent).changedTouches[0].clientY : (e as MouseEvent).clientY;
    const deltaX = clientX - dragState.startX;
    const msPerPixel = getMillisecondsPerPixel(zoomLevel);
    const timeDelta = deltaX * msPerPixel;
    
    let newStartDate = new Date(dragState.startDate);
    let newEndDate = new Date(dragState.endDate);
    
    if (dragState.dragType === 'move') {
      newStartDate = new Date(dragState.startDate.getTime() + timeDelta);
      newEndDate = new Date(dragState.endDate.getTime() + timeDelta);
    } else if (dragState.dragType === 'resize-start') {
      newStartDate = new Date(Math.min(dragState.startDate.getTime() + timeDelta, dragState.endDate.getTime() - 24 * 60 * 60 * 1000));
    } else if (dragState.dragType === 'resize-end') {
      newEndDate = new Date(Math.max(dragState.endDate.getTime() + timeDelta, dragState.startDate.getTime() + 24 * 60 * 60 * 1000));
    }

    // Snap to whole-day boundaries; if Shift held, snap to week blocks
    newStartDate.setHours(0,0,0,0);
    newEndDate.setHours(0,0,0,0);
    if (isShiftDownRef.current) {
      const s = snapToWeek(newStartDate);
      const e2 = snapToWeek(newEndDate);
      if (e2.getTime() <= s.getTime()) e2.setDate(s.getDate() + 7);
      newStartDate = s; newEndDate = e2;
    }

    // Clear drag overlay
    setDragOverlay(null);
    const tooltip = dragTooltipRef.current;
    if (tooltip) {
      tooltip.style.left = `-9999px`;
    }

    logger.debug('gantt', 'Drag end', {
      id: dragState.itemId,
      dragType: dragState.dragType,
      deltaX,
      newStart: newStartDate.toISOString(),
      newEnd: newEndDate.toISOString(),
    });
    logger.perfMark('gantt-drag-end');
    logger.perfMeasure('gantt-drag', 'gantt-drag-start', 'gantt-drag-end');
    // Determine drop theme and clear highlight
    const dropThemeId = groupPositionsRef.current.find(g => clientY >= g.top && clientY <= g.bottom)?.themeId ?? null;
    groupPositionsRef.current.forEach(g => g.el.classList.remove('theme-group--target'));

    // Check for impacted stories/tasks in current sprints
    const goal = goals.find(g => g.id === dragState.itemId);
    if (goal) {
      const impacted = checkImpactedItems(goal.id, newStartDate, newEndDate);
      
      if (impacted.length > 0) {
        logger.warn('gantt', 'Drag impact detected', { goalId: goal.id, impacted: impacted.length });
        setImpactedItems(impacted);
        setPendingGoalUpdate({ goalId: goal.id, startDate: newStartDate, endDate: newEndDate });
        setShowImpactModal(true);
      } else {
        await updateGoalDates(goal.id, newStartDate, newEndDate);
      }

      // Theme reassignment if dropped on another theme group
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

    // Clean up
    setDragState({
      isDragging: false,
      itemId: null,
      dragType: 'move',
      startX: 0,
      startDate: new Date(),
      endDate: new Date()
    });

    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);
  }, [dragState, goals, zoomLevel]);

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
  const getMillisecondsPerPixel = (zoom: string): number => {
    // Use store domain for precise conversion
    const start = useRoadmapStore.getState().start;
    const end = useRoadmapStore.getState().end;
    const duration = end.getTime() - start.getTime();
    const width = useRoadmapStore.getState().width || canvasRef.current?.scrollWidth || 1000;
    return duration / Math.max(1, Number(width));
  };

  const getDatePosition = (date: Date): number => {
    try {
      return scale(date);
    } catch {
      const totalDuration = timeRange.end.getTime() - timeRange.start.getTime();
      const itemPosition = date.getTime() - timeRange.start.getTime();
      const canvasWidth = canvasRef.current?.scrollWidth || 1000;
      return (itemPosition / totalDuration) * canvasWidth;
    }
  };

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
  const updateGoalDates = async (goalId: string, newStart: Date, newEnd: Date) => {
    logger.info('gantt', 'Updating goal dates', { goalId, newStart: newStart.toISOString(), newEnd: newEnd.toISOString() });
    const prev = goals.find(g => g.id === goalId);
    if (prev) {
      lastChangeRef.current = { goalId, prevStart: (prev as any).startDate || 0, prevEnd: (prev as any).endDate || 0 };
    }
    try {
      await updateDoc(doc(db, 'goals', goalId), { startDate: newStart.getTime(), endDate: newEnd.getTime(), updatedAt: Date.now() });
      logger.info('gantt', 'Goal dates updated', { goalId });
    } catch (err) {
      logger.error('gantt', 'Failed to update goal dates', { goalId, err });
      throw err;
    }
    setLiveAnnouncement(`Updated ${goals.find(g=>g.id===goalId)?.title || 'goal'} to ${newStart.toLocaleDateString()} – ${newEnd.toLocaleDateString()}`);
  };

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

  // Feature flag to switch to RoadmapV2 timeline implementation
  const USE_ROADMAP_V2 = true;

  if (USE_ROADMAP_V2) {
    return (
      <>
        <RoadmapV2
          goals={goals}
          sprints={sprints}
          stories={stories}
          storiesByGoal={storiesByGoal}
          doneStoriesByGoal={doneStoriesByGoal}
          onDragStart={handleDragStart as any}
          onItemClick={handleItemClick as any}
          updateGoalDates={updateGoalDates}
          handleGenerateStories={handleGenerateStories as any}
          setSelectedGoalId={setSelectedGoalId}
          setActivityGoalId={setActivityGoalId as any}
          setNoteGoalId={setNoteGoalId as any}
          setNoteDraft={setNoteDraft}
          setEditGoal={setEditGoal}
          onDeleteGoal={handleDeleteGoal}
          openGlobalActivity={(goal) => showSidebar(goal as any, 'goal')}
          onWheel={handleWheelZoom}
          onMouseDown={onContainerMouseDown}
          onTouchStart={onContainerTouchStart}
          onTouchMove={onContainerTouchMove}
          onTouchEnd={onContainerTouchEnd}
          onSwitchToRoadmap={() => setViewMode('roadmap')}
          selectedSprintId={selectedSprintId || ''}
        />

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

        {/* Activity Stream Sidebar */}
        {showActivityStream && (
          <div className="activity-stream-sidebar position-fixed end-0 top-0 h-100 shadow-lg border-start" style={{ width: '400px', zIndex: 2000, backgroundColor: 'var(--panel)', borderLeft: '1px solid var(--line)' }}>
          {/* Increase z-index to stay above dropdowns */}
            <div className="p-3 border-bottom d-flex justify-content-between align-items-center">
              <h5 className="mb-0 d-flex align-items-center">
                <Activity className="me-2" size={20} />
                Activity Stream
              </h5>
              <Button variant="outline-secondary" size="sm" onClick={() => setShowActivityStream(false)}>×</Button>
            </div>
            
            <div className="p-3" style={{ height: 'calc(100% - 70px)', overflow: 'auto' }}>
              {activityStreamItems.length === 0 ? (
                <p className="text-muted">Click on any goal to see linked items</p>
              ) : (
                <div className="space-y-3">
                  {activityStreamItems.map(item => {
                    const theme = themes.find(t => t.id === item.theme);
                    return (
                      <Card key={item.id} className="border">
                        <Card.Body className="p-3">
                          <div className="d-flex align-items-start">
                            {theme && (
                              <div
                                className="me-2 mt-1"
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  backgroundColor: theme.color,
                                  borderRadius: '2px'
                                }}
                              />
                            )}
                            <div className="flex-grow-1">
                              <h6 className="mb-1">{item.title}</h6>
                              {item.ref && <small className="text-muted">{item.ref}</small>}
                              <div className="mt-2">
                                {/* Additional details can be shown here */}
                              </div>
                            </div>
                          </div>
                        </Card.Body>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

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

        {/* Edit Modal */}
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
  }

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
                  onClick={() => setShowActivityStream(true)}
                  aria-expanded={showActivityStream}
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
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => setViewMode('roadmap')}
                  title="Switch to Roadmap"
                >
                  Roadmap
                </Button>
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
                  <div className="mb-3">
                    <SprintSelector selectedSprintId={selectedSprintId} onSprintChange={setSelectedSprintId} />
                  </div>
                  <div className="mb-3">
                    <div className="small text-muted mb-1">Zoom</div>
                    <div className="d-flex gap-2 align-items-center">
                      <Form.Select value={zoomLevel} onChange={(e) => { const z = e.target.value as any; setZoomLevel(z); useRoadmapStore.getState().setZoom(z); }} size="sm" style={{ maxWidth: 200 }}>
                        <option value="week">Weeks</option>
                        <option value="month">Months</option>
                        <option value="quarter">Quarter</option>
                        <option value="half">Half Year</option>
                        <option value="year">Year</option>
                      </Form.Select>
                      <Button size="sm" variant="outline-secondary" onClick={() => { const i = zoomLevels.indexOf(zoomLevel); const next = Math.max(0, i - 1); setZoomLevel(zoomLevels[next]); useRoadmapStore.getState().setZoom(zoomLevels[next]); }} title="Zoom In"><ZoomIn size={14} /></Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => { const i = zoomLevels.indexOf(zoomLevel); const next = Math.min(zoomLevels.length - 1, i + 1); setZoomLevel(zoomLevels[next]); useRoadmapStore.getState().setZoom(zoomLevels[next]); }} title="Zoom Out"><ZoomOut size={14} /></Button>
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
        <div className="timeline-header sticky-top" style={{ zIndex: 10, backgroundColor: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <div className="d-flex">
            <div style={{ width: '250px', minWidth: '250px' }} className="bg-light border-end p-2">
              <strong>Goals & Themes</strong>
            </div>
            <div ref={headerMonthsRef} className="timeline-months d-flex position-relative" style={{ minWidth: '200%', height: 60 }}>
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
              <div className="position-absolute" style={{ left: 0, right: 0, top: 0, height: 24, zIndex: 1, background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
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
              <div className="w-100" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, zIndex: 2, background: 'var(--card)' }}>
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
          {(groupByTheme ? Object.keys(goalsByTheme).map(k => parseInt(k,10)).sort((a,b)=>a-b) : [null]).map(groupKey => (
            <div key={groupKey === null ? 'all' : `theme-${groupKey}`} data-theme-group={groupKey ?? ''} className="theme-group">
              {groupByTheme && (
                <div className="d-flex align-items-center" style={{ height: 32 }}>
                  <div style={{ width: 250, minWidth: 250 }} className="px-2 text-muted fw-semibold">{themes.find(t => t.id === groupKey)?.name}</div>
                  <div className="flex-grow-1" style={{ borderBottom: '1px solid var(--line)' }} />
                </div>
              )}
          <VirtualThemeLane
            themeId={(groupKey as number) || 0}
            themeName={themes.find(t => t.id === groupKey)?.name || ''}
            themeColor={themes.find(t => t.id === groupKey)?.color || ''}
            items={(groupByTheme ? (goalsByTheme[groupKey as number] || []) : ganttItems.filter(g => g.type==='goal')) as any}
            getDatePosition={getDatePosition}
            storiesByGoal={storiesByGoal}
            doneStoriesByGoal={doneStoriesByGoal}
            onDragStart={handleDragStart as any}
            onItemClick={handleItemClick as any}
            setSelectedGoalId={setSelectedGoalId}
            handleGenerateStories={handleGenerateStories as any}
            setActivityGoalId={setActivityGoalId as any}
            setNoteGoalId={setNoteGoalId as any}
            setNoteDraft={setNoteDraft}
            updateGoalDates={updateGoalDates}
            getThemeStyle={(id) => themes.find(t => t.id === id) as any}
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

      {/* Activity Stream Sidebar */}
      {showActivityStream && (
        <div className="activity-stream-sidebar position-fixed end-0 top-0 h-100 shadow-lg border-start" style={{ width: '400px', zIndex: 1000, backgroundColor: 'var(--panel)', borderLeft: '1px solid var(--line)' }}>
          <div className="p-3 border-bottom d-flex justify-content-between align-items-center">
            <h5 className="mb-0 d-flex align-items-center">
              <Activity className="me-2" size={20} />
              Activity Stream
            </h5>
            <Button variant="outline-secondary" size="sm" onClick={() => setShowActivityStream(false)}>×</Button>
          </div>
          
          <div className="p-3" style={{ height: 'calc(100% - 70px)', overflow: 'auto' }}>
            {activityStreamItems.length === 0 ? (
              <p className="text-muted">Click on any goal to see linked items</p>
            ) : (
              <div className="space-y-3">
                {activityStreamItems.map(item => {
                  const theme = themes.find(t => t.id === item.theme);
                  return (
                    <Card key={item.id} className="border">
                      <Card.Body className="p-3">
                        <div className="d-flex align-items-start">
                          {theme && (
                            <div
                              className="me-2 mt-1"
                              style={{
                                width: '12px',
                                height: '12px',
                                backgroundColor: theme.color,
                                borderRadius: '2px'
                              }}
                            />
                          )}
                          <div className="flex-grow-1">
                            <h6 className="mb-1">{item.title}</h6>
                            {item.ref && <small className="text-muted">{item.ref}</small>}
                            <div className="mt-2">
                              <Badge bg="secondary" className="me-2">{item.type}</Badge>
                              <Badge bg={item.status === 2 ? 'success' : 'warning'}>
                                {item.status === 2 ? 'Complete' : 'In Progress'}
                              </Badge>
                            </div>
                            {item.linkedTo.length > 0 && (
                              <small className="text-muted mt-1 d-block">
                                Linked to {item.linkedTo.length} item(s)
                              </small>
                            )}
                          </div>
                        </div>
                      </Card.Body>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
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

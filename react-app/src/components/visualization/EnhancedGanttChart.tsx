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
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import SprintSelector from '../SprintSelector';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import EditGoalModal from '../../components/EditGoalModal';
import ModernStoriesTable from '../../components/ModernStoriesTable';
import { Goal, Sprint, Story, Task } from '../../types';
import './EnhancedGanttChart.css';
import logger from '../../utils/logger';

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
  
  // Core data
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [zoomLevel, setZoomLevel] = useState<'month' | 'quarter' | 'half' | 'year'>('quarter');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedThemes, setSelectedThemes] = useState<number[]>([]);
  const [showLinks, setShowLinks] = useState<boolean>(true);
  const [autoFitSprintGoals, setAutoFitSprintGoals] = useState<boolean>(true);
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());
  const [groupByTheme, setGroupByTheme] = useState<boolean>(true);
  const [storiesByGoal, setStoriesByGoal] = useState<Record<string, number>>({});
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
    const counts: Record<string, number> = {};
    stories.forEach((s) => {
      if (!s.goalId) return;
      counts[s.goalId] = (counts[s.goalId] || 0) + 1;
    });
    setStoriesByGoal(counts);
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
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
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
    
    // Snap to whole-day boundaries
    newStartDate.setHours(0,0,0,0);
    newEndDate.setHours(0,0,0,0);

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
    
    const clientX = 'touches' in e ? e.changedTouches[0].clientX : e.clientX;
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

    // Snap to whole-day boundaries
    newStartDate.setHours(0,0,0,0);
    newEndDate.setHours(0,0,0,0);

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
    // Align with getDatePosition: use canvas width vs overall time
    const totalDuration = timeRange.end.getTime() - timeRange.start.getTime();
    const canvasWidth = canvasRef.current?.scrollWidth || 1000;
    const msPerPxBase = totalDuration / canvasWidth;
    // Zoom levels scale
    const scales: Record<string, number> = { month: 0.5, quarter: 1, half: 2, year: 4 };
    const scale = scales[zoom] ?? 1;
    return msPerPxBase * scale;
  };

  const getDatePosition = (date: Date): number => {
    const totalDuration = timeRange.end.getTime() - timeRange.start.getTime();
    const itemPosition = date.getTime() - timeRange.start.getTime();
    const canvasWidth = canvasRef.current?.scrollWidth || 1000;
    return (itemPosition / totalDuration) * canvasWidth;
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

  const zoomLevels: Array<typeof zoomLevel> = ['month', 'quarter', 'half', 'year'];
  const handleWheelZoom: React.WheelEventHandler<HTMLDivElement> = (e) => {
    // Avoid calling preventDefault on passive wheel listeners (noise in console)
    if (!e.ctrlKey && Math.abs(e.deltaY) < 35) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    const idx = zoomLevels.indexOf(zoomLevel);
    const next = Math.min(zoomLevels.length - 1, Math.max(0, idx + dir));
    if (next !== idx) setZoomLevel(zoomLevels[next]);
  };

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
                      <Form.Select value={zoomLevel} onChange={(e) => setZoomLevel(e.target.value as any)} size="sm" style={{ maxWidth: 160 }}>
                        <option value="month">Fit</option>
                        <option value="quarter">Quarter</option>
                        <option value="half">Half Year</option>
                        <option value="year">Year</option>
                      </Form.Select>
                      <Button size="sm" variant="outline-secondary" onClick={() => setZoomLevel('month')} title="Zoom In"><ZoomIn size={14} /></Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => setZoomLevel('year')} title="Zoom Out"><ZoomOut size={14} /></Button>
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
      <div ref={containerRef} className="timeline-container" style={{ height: isFullscreen ? '100vh' : 'calc(100vh - 250px)', overflow: 'auto' }} onWheel={handleWheelZoom}>
        {/* Live region for a11y announcements */}
        <div aria-live="polite" className="visually-hidden">{liveAnnouncement}</div>
        {/* Timeline Header */}
        <div className="timeline-header sticky-top" style={{ zIndex: 10, backgroundColor: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <div className="d-flex">
            <div style={{ width: '250px', minWidth: '250px' }} className="bg-light border-end p-2">
              <strong>Goals & Themes</strong>
            </div>
            <div ref={headerMonthsRef} className="timeline-months d-flex position-relative" style={{ minWidth: '200%' }}>
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
                      backgroundColor: 'rgba(59, 130, 246, 0.08)'
                    }}
                    aria-hidden="true"
                    title={`${sprint.name}: ${new Date(sprint.startDate).toLocaleDateString()} - ${new Date(sprint.endDate).toLocaleDateString()}`}
                  />
                ))}
              </div>
              {generateTimelineHeaders().map((header, index) => (
                <div
                  key={index}
                  className="text-center border-end p-2"
                  style={{ width: `${header.width}px`, minWidth: '80px', position: 'relative', zIndex: 1 }}
                >
                  <small>{header.label}</small>
                </div>
              ))}
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
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
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
            <React.Fragment key={groupKey === null ? 'all' : `theme-${groupKey}`}>
              {groupByTheme && (
                <div className="d-flex align-items-center" style={{ height: 28 }}>
                  <div style={{ width: 250, minWidth: 250 }} className="px-2 text-muted fw-semibold">{themes.find(t => t.id === groupKey)?.name}</div>
                  <div className="flex-grow-1" style={{ borderBottom: '1px solid #eee' }} />
                </div>
              )}
          {(groupByTheme ? (goalsByTheme[groupKey as number] || []) : ganttItems.filter(g => g.type==='goal')).map((goal, index) => {
            const theme = themes.find(t => t.id === goal.theme);
            const startPos = getDatePosition(goal.startDate);
            const endPos = getDatePosition(goal.endDate);
            const width = Math.max(endPos - startPos, 20);

            return (
              <div key={goal.id} className="goal-row d-flex align-items-center border-bottom" style={{ background: groupByTheme && theme ? hexToRgba(theme.color, 0.05) : 'transparent' }}>
                <div 
                  className="goal-label p-2"
                  style={{ width: '250px', minWidth: '250px' }}
                >
                  <div className="d-flex align-items-center">
                    <div
                      className="theme-indicator me-2"
                      style={{
                        width: '12px',
                        height: '12px',
                        backgroundColor: theme?.color,
                        borderRadius: '2px'
                      }}
                    />
                    <span className="fw-medium">{goal.title}</span>
                  </div>
                </div>
                
                <div className="goal-timeline position-relative" style={{ minHeight: '80px', flex: 1 }}>
                  <div
                    data-goal-id={goal.id}
                    className={`goal-bar position-absolute cursor-move d-flex align-items-center ${dragState.isDragging && dragState.itemId === goal.id ? 'dragging' : ''}`}
                    style={{
                      left: `${startPos}px`,
                      width: `${width}px`,
                      height: '60px',
                      backgroundColor: theme?.color,
                      border: (storiesByGoal[goal.id] || 0) === 0 ? '2px solid var(--red)' : 'none',
                      borderRadius: '4px',
                      top: '5px',
                      opacity: dragState.isDragging && dragState.itemId === goal.id ? 0.7 : 1,
                      zIndex: 5
                    }}
                    tabIndex={0}
                    draggable={false}
                    onMouseDown={(e) => handleDragStart(e, goal, 'move')}
                    onTouchStart={(e) => handleDragStart(e, goal, 'move')}
                    onDragStart={(e) => e.preventDefault()}
                    onClick={() => handleItemClick(goal)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        const step = (e.shiftKey ? 7 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
                        const s = new Date(goal.startDate);
                        const en = new Date(goal.endDate);
                        s.setHours(0,0,0,0); en.setHours(0,0,0,0);
                        s.setDate(s.getDate() + step);
                        en.setDate(en.getDate() + step);
                        updateGoalDates(goal.id, s, en);
                      }
                    }}
                    title={`${goal.title}: ${goal.startDate.toLocaleDateString()} - ${goal.endDate.toLocaleDateString()}${(storiesByGoal[goal.id]||0)===0 ? ' • No linked stories' : ''}`}
                  >
                    {/* Resize handles */}
                    <div
                      className="resize-handle resize-start position-absolute"
                      style={{
                        left: '0',
                        top: '0',
                        width: '8px',
                        height: '100%',
                        cursor: 'ew-resize',
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        borderRadius: '4px 0 0 4px'
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, goal, 'resize-start');
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, goal, 'resize-start');
                      }}
                    />
                    
                    <div className="goal-content px-2 text-white flex-grow-1" style={{ fontSize: 13, lineHeight: '16px' }}>
                      <div className="d-flex align-items-center justify-content-between">
                        <div style={{ whiteSpace: 'normal', overflow: 'visible' }}>
                          <strong>{goal.title}</strong>
                          {typeof goal.priority !== 'undefined' && (<span className="ms-2">P{goal.priority}</span>)}
                        </div>
                        <div className="d-flex align-items-center gap-1">
                          <button className="btn btn-light btn-sm py-0 px-1" title="Generate stories with AI" onClick={(e) => { e.stopPropagation(); handleGenerateStories(goal); }}>
                            <Wand2 size={14} />
                          </button>
                          <button className="btn btn-light btn-sm py-0 px-1" title="View activity" onClick={(e) => { e.stopPropagation(); setActivityGoalId(goal.id); }}>
                            <ListIcon size={14} />
                          </button>
                          <button className="btn btn-light btn-sm py-0 px-1" title="View stories" onClick={(e) => { e.stopPropagation(); setSelectedGoalId(goal.id); }}>
                            <BookOpen size={14} />
                          </button>
                          <button className="btn btn-light btn-sm py-0 px-1" title="Add note" onClick={(e) => { e.stopPropagation(); setNoteGoalId(goal.id); setNoteDraft(''); }}>
                            <MessageSquareText size={14} />
                          </button>
                        </div>
                      </div>
                      {(goals.find(g => g.id === goal.id) as any)?.recentNote && (
                        <div className="small">📝 {(goals.find(g => g.id === goal.id) as any)?.recentNote}</div>
                      )}
                      <div className="small">{(storiesByGoal[goal.id] || 0) === 0 ? 'No linked stories' : `${storiesByGoal[goal.id]} stories`}</div>
                    </div>
                    <button
                      className="btn btn-sm btn-light position-absolute"
                      style={{ right: 10, top: 6, padding: '2px 6px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const full = goals.find(g => g.id === goal.id) || null;
                        setEditGoal(full as any);
                      }}
                      title="Edit Goal"
                    >
                      <Edit3 size={12} />
                    </button>
                    
                    <div
                      className="resize-handle resize-end position-absolute"
                      style={{
                        right: '0',
                        top: '0',
                        width: '8px',
                        height: '100%',
                        cursor: 'ew-resize',
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        borderRadius: '0 4px 4px 0'
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, goal, 'resize-end');
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, goal, 'resize-end');
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          </React.Fragment>
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

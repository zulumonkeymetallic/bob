import React, { useState, useEffect, useMemo } from 'react';
import { Badge, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Clock, Target, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Sprint, Story, Task } from '../types';

interface CompactSprintMetricsProps {
  selectedSprintId?: string;
  className?: string;
}

const CompactSprintMetrics: React.FC<CompactSprintMetricsProps> = ({
  selectedSprintId,
  className = ''
}) => {
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints, sprintsById } = useSprint();
  const [resolvedSprintId, setResolvedSprintId] = useState<string | undefined>(undefined);

  // Resolve sprint: use provided ID or auto-detect active sprint using shared context data
  useEffect(() => {
    if (!currentUser) {
      setResolvedSprintId(undefined);
      setSprint(null);
      setLoading(false);
      return;
    }

    if (selectedSprintId === '') {
      setResolvedSprintId(undefined);
      setSprint(null);
      setLoading(false);
      return;
    }

    if (selectedSprintId) {
      setResolvedSprintId(selectedSprintId);
      setSprint(sprintsById[selectedSprintId] ?? null);
      setLoading(false);
      return;
    }

    if (!sprints.length) {
      setResolvedSprintId(undefined);
      setSprint(null);
      setLoading(false);
      return;
    }

    const activeSprint = sprints.find((item) => (item.status ?? 0) === 1) || sprints[0];
    setResolvedSprintId(activeSprint?.id);
    setSprint(activeSprint ?? null);
    setLoading(false);
  }, [selectedSprintId, currentUser, sprints, sprintsById]);

  // Keep sprint reference in sync with shared cache updates
  useEffect(() => {
    if (!resolvedSprintId) return;
    setSprint(sprintsById[resolvedSprintId] ?? null);
  }, [resolvedSprintId, sprintsById]);

  // Load stories: if a sprint is selected, filter by sprint; otherwise load all owner's stories
  useEffect(() => {
    if (!currentUser) { setStories([]); return; }

    const storiesQuery = resolvedSprintId
      ? query(
        collection(db, 'stories'),
        where('sprintId', '==', resolvedSprintId),
        where('ownerUid', '==', currentUser.uid)
      )
      : query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid)
      );

    const unsubscribe = onSnapshot(storiesQuery, (snapshot) => {
      const storyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Story[];
      setStories(storyData);
    });

    return () => unsubscribe();
  }, [resolvedSprintId, currentUser]);

  // Load tasks efficiently: if a sprint is resolved, scope to that sprint via sprint_task_index
  // Avoid loading all tasks when no sprint is selected
  useEffect(() => {
    if (!currentUser) { setTasks([]); return; }
    if (!resolvedSprintId) { setTasks([]); return; }

    const q = query(
      collection(db, 'sprint_task_index'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona || 'personal'),
      where('sprintId', '==', resolvedSprintId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskData = snapshot.docs.map(d => {
        const x = d.data() as any;
        const t: any = {
          id: d.id,
          title: x.title,
          description: x.description || '',
          status: x.status,
          priority: x.priority ?? 2,
          effort: x.effort ?? 'M',
          estimateMin: x.estimateMin ?? 0,
          dueDate: x.dueDate || null,
          parentType: x.parentType || 'story',
          parentId: x.parentId || x.storyId || '',
          storyId: x.storyId || null,
          sprintId: x.sprintId && x.sprintId !== '__none__' ? x.sprintId : null,
          persona: currentPersona || 'personal',
          ownerUid: currentUser.uid,
          ref: x.ref || `TASK-${String(d.id).slice(-4).toUpperCase()}`,
        };
        return t as Task;
      });
      setTasks(taskData);
    });

    return () => unsubscribe();
  }, [currentUser, currentPersona, resolvedSprintId]);

  const [capacity, setCapacity] = useState<{ total: number; used: number; remaining: number } | null>(null);

  // Load calendar blocks for capacity planning
  useEffect(() => {
    if (!currentUser || !sprint) return;

    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);

    // Query blocks within sprint range
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', start.getTime()),
      where('start', '<=', end.getTime())
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let usedMinutes = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        usedMinutes += (data.end - data.start) / (1000 * 60);
      });

      // Calculate total capacity: 8 hours per day * number of days
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const totalMinutes = days * 8 * 60; // 8 hours per day
      const remainingMinutes = Math.max(0, totalMinutes - usedMinutes);

      setCapacity({
        total: Math.round(totalMinutes / 60),
        used: Math.round(usedMinutes / 60),
        remaining: Math.round(remainingMinutes / 60)
      });
    });

    return () => unsubscribe();
  }, [currentUser, sprint]);

  const metrics = useMemo(() => {
    // Aggregated metrics when no sprint is selected
    if (!resolvedSprintId || !sprint) {
      const totalStories = stories.length;
      const completedStories = stories.filter(s => s.status === 4).length;
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 2).length;
      const totalPoints = stories.reduce((sum, s) => sum + (s.points || 0), 0);
      const completedPoints = stories.filter(s => s.status === 4).reduce((sum, s) => sum + (s.points || 0), 0);

      return {
        hasStarted: true,
        hasEnded: false,
        daysLeft: 0,
        daysUntilStart: 0,
        totalStories,
        completedStories,
        totalTasks,
        completedTasks,
        storyProgress: totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0,
        storiesWithOpenTasks: 0,
        standaloneTasksCount: tasks.filter(t => !t.parentId || t.parentType !== 'story').length,
        sprint: null,
        capacity: null
      } as any;
    }

    const now = new Date();
    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);

    // Calculate sprint timing
    const hasStarted = now >= startDate;
    const hasEnded = now > endDate;
    const daysLeft = hasStarted ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
    const daysUntilStart = !hasStarted ? Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

    // Story metrics
    const sprintStories = stories.filter(story => story.sprintId === resolvedSprintId);
    const completedStories = sprintStories.filter(story => story.status === 4).length; // Done status
    const totalStories = sprintStories.length;

    // Task metrics - include both story-linked and standalone tasks
    // Business rules: 
    // 1. Tasks can be added without being linked to stories or goals
    // 2. Can't close a story if there are open tasks linked to it
    const storyLinkedTasks = tasks.filter(task => {
      if (task.parentType === 'story' && task.parentId) {
        const parentStory = sprintStories.find(story => story.id === task.parentId);
        return !!parentStory;
      }
      return false;
    });

    // For now, standalone tasks are those not linked to stories
    // In future, could add sprintId field to tasks for direct sprint association
    const standaloneTasks = tasks.filter(task =>
      !task.parentType || task.parentType !== 'story' || !task.parentId
    );

    // Combined task metrics (story-linked tasks are primary for sprint context)
    const sprintTasks = storyLinkedTasks;
    const completedTasks = sprintTasks.filter(task => task.status === 2).length; // Done status
    const totalTasks = sprintTasks.length;

    // Calculate overall progress based on stories (primary metric)
    const storyProgress = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

    // Check business rule: can't close story if there are open tasks
    const storiesBlockedByTasks = sprintStories.filter(story => {
      if (story.status === 4) return false; // Already closed
      const storyTasks = storyLinkedTasks.filter(task =>
        task.parentType === 'story' && task.parentId === story.id
      );
      return storyTasks.length > 0 && storyTasks.some(task => task.status !== 2); // Has open tasks
    });

    const storiesWithOpenTasks = storiesBlockedByTasks.length;

    return {
      hasStarted,
      hasEnded,
      daysLeft,
      daysUntilStart,
      totalStories,
      completedStories,
      totalTasks,
      completedTasks,
      storyProgress,
      storiesWithOpenTasks,
      standaloneTasksCount: standaloneTasks.length,
      sprint,
      capacity
    };
  }, [sprint, stories, tasks, selectedSprintId, resolvedSprintId, capacity]);

  if (loading) return null;

  if (!metrics) {
    return (
      <div className={`d-flex align-items-center ${className}`}>
        <Badge bg="secondary" className="me-2">No Data</Badge>
      </div>
    );
  }

  const {
    hasStarted,
    hasEnded,
    daysLeft,
    daysUntilStart,
    totalStories,
    completedStories,
    totalTasks,
    completedTasks,
    storyProgress,
    storiesWithOpenTasks,
    standaloneTasksCount,
    capacity: metricCapacity
  } = metrics;

  const getProgressVariant = (progress: number) => {
    if (progress >= 80) return 'success';
    if (progress >= 60) return 'info';
    if (progress >= 40) return 'warning';
    return 'danger';
  };

  const getDaysVariant = (days: number, isStarted: boolean, isEnded: boolean) => {
    if (isEnded) return 'secondary';
    if (!isStarted) return 'info';
    if (days > 7) return 'success';
    if (days > 3) return 'warning';
    return 'danger';
  };

  const getTimeDisplay = () => {
    if (hasEnded) return { text: 'Ended', icon: '⏸️' };
    if (!hasStarted) return { text: `${daysUntilStart}d until start`, icon: '⏳' };
    return { text: `${daysLeft}d left`, icon: '⏰' };
  };

  const timeDisplay = getTimeDisplay();

  return (
    <div className={`d-flex align-items-center gap-2 ${className}`}>
      {/* Sprint Status & Days */}
      <OverlayTrigger
        placement="bottom"
        overlay={
          <Tooltip>
            {hasEnded
              ? 'Sprint has ended'
              : !hasStarted
                ? `Sprint starts in ${daysUntilStart} days`
                : `${daysLeft} days remaining in sprint`
            }
          </Tooltip>
        }
      >
        <Badge bg={getDaysVariant(daysLeft, hasStarted, hasEnded)} className="d-flex align-items-center">
          <Clock size={14} className="me-1" />
          {timeDisplay.text}
        </Badge>
      </OverlayTrigger>

      {/* Capacity Metrics */}
      {metricCapacity && (
        <OverlayTrigger
          placement="bottom"
          overlay={
            <Tooltip>
              Capacity: {metricCapacity.remaining}h free / {metricCapacity.total}h total
              <div className="mt-1 text-muted">
                Based on 8h/day minus scheduled calendar blocks
              </div>
            </Tooltip>
          }
        >
          <Badge bg={metricCapacity.remaining < 10 ? 'danger' : 'success'} className="d-flex align-items-center">
            <TrendingUp size={14} className="me-1" />
            {metricCapacity.remaining}h Free
          </Badge>
        </OverlayTrigger>
      )}

      {/* Story Progress */}
      <OverlayTrigger
        placement="bottom"
        overlay={
          <Tooltip>
            Stories: {completedStories}/{totalStories} completed ({storyProgress}%)
            {storiesWithOpenTasks > 0 && (
              <div className="mt-1 text-warning">
                ⚠️ {storiesWithOpenTasks} stories blocked by open tasks
              </div>
            )}
          </Tooltip>
        }
      >
        <Badge bg={getProgressVariant(storyProgress)} className="d-flex align-items-center">
          <Target size={14} className="me-1" />
          {completedStories}/{totalStories}
        </Badge>
      </OverlayTrigger>

      {/* Task Progress */}
      <OverlayTrigger
        placement="bottom"
        overlay={
          <Tooltip>
            Sprint Tasks: {completedTasks}/{totalTasks} completed (linked to stories)
            {standaloneTasksCount > 0 && (
              <div className="mt-1 text-info">
                📋 {standaloneTasksCount} standalone tasks (not linked to stories)
              </div>
            )}
            <div className="mt-1 text-muted">
              Tasks can be added without being linked to stories or goals
            </div>
          </Tooltip>
        }
      >
        <Badge bg="info" className="d-flex align-items-center">
          <CheckCircle size={14} className="me-1" />
          {completedTasks}/{totalTasks}
        </Badge>
      </OverlayTrigger>

      {/* Overall Progress */}
      <OverlayTrigger
        placement="bottom"
        overlay={
          <Tooltip>
            Overall sprint progress: {storyProgress}%
            <div className="mt-1">
              Based on story completion (primary metric)
            </div>
          </Tooltip>
        }
      >
        <Badge bg={getProgressVariant(storyProgress)} className="d-flex align-items-center">
          <TrendingUp size={14} className="me-1" />
          {storyProgress}%
        </Badge>
      </OverlayTrigger>

      {/* Blocked Stories Warning */}
      {storiesWithOpenTasks > 0 && (
        <OverlayTrigger
          placement="bottom"
          overlay={
            <Tooltip>
              {storiesWithOpenTasks} stories cannot be closed due to open tasks
            </Tooltip>
          }
        >
          <Badge bg="warning" className="d-flex align-items-center">
            <AlertTriangle size={14} className="me-1" />
            {storiesWithOpenTasks}
          </Badge>
        </OverlayTrigger>
      )}
    </div>
  );
};

export default CompactSprintMetrics;

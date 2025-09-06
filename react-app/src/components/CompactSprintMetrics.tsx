import React, { useState, useEffect, useMemo } from 'react';
import { Badge, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Clock, Target, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Sprint, Story, Task } from '../types';
import { useTheme } from '../contexts/ModernThemeContext';

interface CompactSprintMetricsProps {
  selectedSprintId?: string;
  className?: string;
}

const CompactSprintMetrics: React.FC<CompactSprintMetricsProps> = ({
  selectedSprintId,
  className = ''
}) => {
  const { theme } = useTheme();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();

  // Load sprint data
  useEffect(() => {
    if (!selectedSprintId || !currentUser) {
      setSprint(null);
      setLoading(false);
      return;
    }

    const sprintQuery = query(
      collection(db, 'sprints'),
      where('__name__', '==', selectedSprintId),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(sprintQuery, (snapshot) => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        setSprint({ id: doc.id, ...doc.data() } as Sprint);
      } else {
        setSprint(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [selectedSprintId, currentUser]);

  // Load stories for this sprint
  useEffect(() => {
    if (!selectedSprintId || !currentUser) {
      setStories([]);
      return;
    }

    const storiesQuery = query(
      collection(db, 'stories'),
      where('sprintId', '==', selectedSprintId),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(storiesQuery, (snapshot) => {
      const storyData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storyData);
    });

    return () => unsubscribe();
  }, [selectedSprintId, currentUser]);

  // Load tasks (both linked to stories and standalone)
  useEffect(() => {
    if (!currentUser) {
      setTasks([]);
      return;
    }

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
      const taskData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(taskData);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const metrics = useMemo(() => {
    if (!sprint) return null;

    const now = new Date();
    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);
    
    // Calculate sprint timing
    const hasStarted = now >= startDate;
    const hasEnded = now > endDate;
    const daysLeft = hasStarted ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
    const daysUntilStart = !hasStarted ? Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    
    // Story metrics
    const sprintStories = stories.filter(story => story.sprintId === selectedSprintId);
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
      sprint
    };
  }, [sprint, stories, tasks, selectedSprintId]);

  if (!selectedSprintId || loading) {
    return null;
  }

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
    standaloneTasksCount
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

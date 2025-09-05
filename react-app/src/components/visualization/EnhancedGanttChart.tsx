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
  Target
} from 'lucide-react';
import { Card, Container, Row, Col, Button, Form, Badge, Alert, Modal } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import { Goal, Sprint, Story, Task } from '../../types';
import './EnhancedGanttChart.css';

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
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());
  
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
  
  // Modals
  const [showImpactModal, setShowImpactModal] = useState(false);
  const [impactedItems, setImpactedItems] = useState<(Story | Task)[]>([]);
  const [pendingGoalUpdate, setPendingGoalUpdate] = useState<{ goalId: string; startDate: Date; endDate: Date } | null>(null);
  
  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  
  // Theme definitions
  const themes = [
    { id: 1, name: 'Health', color: '#ef4444' },
    { id: 2, name: 'Growth', color: '#8b5cf6' },
    { id: 3, name: 'Wealth', color: '#059669' },
    { id: 4, name: 'Tribe', color: '#f59e0b' },
    { id: 5, name: 'Home', color: '#3b82f6' }
  ];

  // Time range calculation
  const timeRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1); // 1 year ago
    const end = new Date(now.getFullYear() + 2, 11, 31); // 2 years ahead
    return { start, end };
  }, []);

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
    });
    unsubscribes.push(unsubTasks);

    setLoading(false);

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [currentUser?.uid]);

  // Generate timeline data
  const ganttItems = useMemo<GanttItem[]>(() => {
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
        status: goal.status
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

    return items.sort((a, b) => {
      if (a.type !== b.type) {
        const order = { goal: 0, story: 1, sprint: 2 };
        return order[a.type] - order[b.type];
      }
      if (a.theme !== b.theme) return a.theme - b.theme;
      return a.startDate.getTime() - b.startDate.getTime();
    });
  }, [goals, sprints, stories, selectedThemes, searchTerm]);

  // Handle item click for activity stream
  const handleItemClick = useCallback(async (item: GanttItem) => {
    setSelectedItemId(item.id);
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
    
    e.preventDefault();
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
    
    // Update the visual representation
    const goalElement = document.querySelector(`[data-goal-id="${dragState.itemId}"]`) as HTMLElement;
    if (goalElement) {
      const startPos = getDatePosition(newStartDate);
      const endPos = getDatePosition(newEndDate);
      goalElement.style.left = `${startPos}px`;
      goalElement.style.width = `${endPos - startPos}px`;
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

    // Check for impacted stories/tasks in current sprints
    const goal = goals.find(g => g.id === dragState.itemId);
    if (goal) {
      const impacted = checkImpactedItems(goal.id, newStartDate, newEndDate);
      
      if (impacted.length > 0) {
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

  // Helper functions
  const getMillisecondsPerPixel = (zoom: string): number => {
    switch (zoom) {
      case 'month': return 24 * 60 * 60 * 1000 / 30; // 1 day per 30px
      case 'quarter': return 24 * 60 * 60 * 1000 / 10; // 1 day per 10px
      case 'half': return 24 * 60 * 60 * 1000 / 5; // 1 day per 5px
      case 'year': return 24 * 60 * 60 * 1000 / 2; // 1 day per 2px
      default: return 24 * 60 * 60 * 1000 / 10;
    }
  };

  const getDatePosition = (date: Date): number => {
    const totalDuration = timeRange.end.getTime() - timeRange.start.getTime();
    const itemPosition = date.getTime() - timeRange.start.getTime();
    const canvasWidth = canvasRef.current?.scrollWidth || 1000;
    return (itemPosition / totalDuration) * canvasWidth;
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
    
    return impacted;
  };

  const updateGoalDates = async (goalId: string, startDate: Date, endDate: Date) => {
    try {
      await updateDoc(doc(db, 'goals', goalId), {
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
        updatedAt: Date.now()
      });

      // Log activity
      await ActivityStreamService.logFieldChange(
        goalId,
        'goal',
        currentUser?.uid || '',
        currentUser?.email || '',
        'personal',
        'startDate',
        null,
        startDate.toLocaleDateString(),
        `Updated goal timeline: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`
      );
    } catch (error) {
      console.error('Error updating goal dates:', error);
    }
  };

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
    <Container fluid className="enhanced-gantt-chart p-0">
      {/* Header */}
      <Card className="border-0 shadow-sm">
        <Card.Header className="bg-white border-bottom">
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
                  onClick={() => setShowActivityStream(!showActivityStream)}
                >
                  <Activity size={16} className="me-1" />
                  Activity
                </Button>
                <Button variant="outline-secondary" size="sm" onClick={() => setZoomLevel('month')}>
                  <ZoomIn size={16} />
                </Button>
                <Button variant="outline-secondary" size="sm" onClick={() => setZoomLevel('year')}>
                  <ZoomOut size={16} />
                </Button>
              </div>
            </Col>
          </Row>
        </Card.Header>
        
        <Card.Body className="p-3">
          <Row className="mb-3">
            <Col md={4}>
              <Form.Control
                type="text"
                placeholder="Search goals..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </Col>
            <Col md={4}>
              <Form.Select
                value={zoomLevel}
                onChange={(e) => setZoomLevel(e.target.value as any)}
              >
                <option value="month">Month View</option>
                <option value="quarter">Quarter View</option>
                <option value="half">Half Year View</option>
                <option value="year">Year View</option>
              </Form.Select>
            </Col>
            <Col md={4}>
              <div className="d-flex gap-2 flex-wrap">
                {themes.map(theme => (
                  <Badge
                    key={theme.id}
                    bg={selectedThemes.includes(theme.id) ? 'primary' : 'outline-secondary'}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedThemes(prev => 
                        prev.includes(theme.id) 
                          ? prev.filter(t => t !== theme.id)
                          : [...prev, theme.id]
                      );
                    }}
                    style={{ 
                      backgroundColor: selectedThemes.includes(theme.id) ? theme.color : 'transparent',
                      borderColor: theme.color,
                      color: selectedThemes.includes(theme.id) ? 'white' : theme.color
                    }}
                  >
                    {theme.name}
                  </Badge>
                ))}
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Main Timeline */}
      <div className="timeline-container" style={{ height: 'calc(100vh - 250px)', overflow: 'auto' }}>
        {/* Timeline Header */}
        <div className="timeline-header sticky-top bg-white border-bottom" style={{ zIndex: 10 }}>
          <div className="d-flex">
            <div style={{ width: '250px', minWidth: '250px' }} className="bg-light border-end p-2">
              <strong>Goals & Themes</strong>
            </div>
            <div className="timeline-months d-flex" style={{ minWidth: '200%' }}>
              {generateTimelineHeaders().map((header, index) => (
                <div
                  key={index}
                  className="text-center border-end p-2"
                  style={{ width: `${header.width}px`, minWidth: '80px' }}
                >
                  <small>{header.label}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sprint Lines */}
        <div className="sprint-lines position-relative">
          {sprints.map(sprint => (
            <div
              key={sprint.id}
              className="sprint-line position-absolute"
              style={{
                left: `${250 + getDatePosition(new Date(sprint.startDate))}px`,
                width: `${getDatePosition(new Date(sprint.endDate)) - getDatePosition(new Date(sprint.startDate))}px`,
                top: '0',
                height: '100%',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderLeft: '2px solid #3b82f6',
                borderRight: '2px solid #3b82f6',
                pointerEvents: 'none',
                zIndex: 1
              }}
              title={`${sprint.name}: ${new Date(sprint.startDate).toLocaleDateString()} - ${new Date(sprint.endDate).toLocaleDateString()}`}
            />
          ))}
        </div>

        {/* Goals Rows */}
        <div ref={canvasRef} className="goals-canvas">
          {ganttItems.filter(item => item.type === 'goal').map((goal, index) => {
            const theme = themes.find(t => t.id === goal.theme);
            const startPos = getDatePosition(goal.startDate);
            const endPos = getDatePosition(goal.endDate);
            const width = Math.max(endPos - startPos, 20);

            return (
              <div key={goal.id} className="goal-row d-flex align-items-center border-bottom">
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
                
                <div className="goal-timeline position-relative" style={{ height: '40px', flex: 1 }}>
                  <div
                    data-goal-id={goal.id}
                    className="goal-bar position-absolute cursor-move d-flex align-items-center"
                    style={{
                      left: `${startPos}px`,
                      width: `${width}px`,
                      height: '30px',
                      backgroundColor: theme?.color,
                      borderRadius: '4px',
                      top: '5px',
                      opacity: dragState.isDragging && dragState.itemId === goal.id ? 0.7 : 1,
                      zIndex: 5
                    }}
                    onMouseDown={(e) => handleDragStart(e, goal, 'move')}
                    onTouchStart={(e) => handleDragStart(e, goal, 'move')}
                    onClick={() => handleItemClick(goal)}
                    title={`${goal.title}: ${goal.startDate.toLocaleDateString()} - ${goal.endDate.toLocaleDateString()}`}
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
                    
                    <div className="goal-content px-2 text-white text-truncate flex-grow-1">
                      <small>{goal.title}</small>
                    </div>
                    
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
        </div>
      </div>

      {/* Activity Stream Sidebar */}
      {showActivityStream && (
        <div className="activity-stream-sidebar position-fixed end-0 top-0 h-100 bg-white shadow-lg border-start" style={{ width: '400px', zIndex: 1000 }}>
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
  );
};

export default EnhancedGanttChart;

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Calendar, 
  ZoomIn, 
  ZoomOut, 
  Activity,
  AlertTriangle,
  Edit,
  Trash2,
  Plus,
  MoreVertical,
  Archive,
  CheckCircle,
  Copy,
  ExternalLink
} from 'lucide-react';
import { Card, Container, Row, Col, Button, Form, Badge, Alert, Modal, Dropdown } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import { Goal, Sprint, Story, Task } from '../../types';
import EditGoalModal from '../EditGoalModal';
import { GLOBAL_THEMES, getThemeById } from '../../constants/globalThemes';
import useThemeAwareColors, { getThemeAwareGoalColor } from '../../hooks/useThemeAwareColors';
import './EnhancedGanttChart.css';

interface GanttGoal extends Goal {
  width?: number;
  left?: number;
}

interface ThemeRow {
  id: number;
  name: string;
  color: string;
  goals: GanttGoal[];
}

interface DragState {
  isDragging: boolean;
  goalId: string | null;
  dragType: 'move' | 'resize-start' | 'resize-end';
  startX: number;
  startDate: Date;
  endDate: Date;
  originalTheme: number;
  newTheme?: number;
}

const ThemeBasedGanttChart: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const themeColors = useThemeAwareColors();
  
  // Core data
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [zoomLevel, setZoomLevel] = useState<'day' | 'week' | 'month' | 'quarter'>('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedThemes, setSelectedThemes] = useState<number[]>([]);
  
  // Drag and drop state
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    goalId: null,
    dragType: 'move',
    startX: 0,
    startDate: new Date(),
    endDate: new Date(),
    originalTheme: 0
  });
  
  // Modals
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  
  // Timeline refs
  const timelineRef = useRef<HTMLDivElement>(null);
  
  // Theme definitions - now using global themes
  const themes = GLOBAL_THEMES;

  // Load data
  useEffect(() => {
    if (!currentUser) return;

    setLoading(true);

    // Load goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );
    
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        };
      }) as Goal[];
      setGoals(goalsData);
      console.log('🎯 ThemeBasedGanttChart: Loaded goals:', goalsData.length);
      setLoading(false);
    }, (error) => {
      console.error('Error loading goals:', error);
      setLoading(false);
    });

    // Load sprints for timeline markers
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );
    
    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          startDate: data.startDate?.toDate?.() || data.startDate,
          endDate: data.endDate?.toDate?.() || data.endDate,
        };
      }) as Sprint[];
      setSprints(sprintsData);
      console.log('🏃 ThemeBasedGanttChart: Loaded sprints:', sprintsData.length);
    }, (error) => {
      console.error('Error loading sprints:', error);
    });

    // Load stories to get sprint information for goals
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );
    
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        };
      }) as Story[];
      setStories(storiesData);
      console.log('📚 ThemeBasedGanttChart: Loaded stories:', storiesData.length);
    }, (error) => {
      console.error('Error loading stories:', error);
    });

    // Return cleanup function directly from useEffect
    return () => {
      unsubscribeGoals();
      unsubscribeSprints();
      unsubscribeStories();
    };
  }, [currentUser]);

  // Calculate timeline bounds based on zoom level
  const timelineBounds = useMemo(() => {
    const now = new Date();
    let start: Date, end: Date;
    
    switch (zoomLevel) {
      case 'day':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 15);
        break;
      case 'week':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 6, 0);
        break;
      case 'quarter':
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() + 2, 11, 31);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 6, 0);
    }
    
    return { start, end };
  }, [zoomLevel]);

  // Calculate date position
  const getDatePosition = useCallback((date: Date) => {
    const { start, end } = timelineBounds;
    const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const daysSinceStart = (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return (daysSinceStart / totalDays) * 100; // Percentage
  }, [timelineBounds]);

  // Get sprint information for a goal
  const getGoalSprintInfo = useCallback((goalId: string) => {
    const goalStories = stories.filter(story => story.goalId === goalId);
    const sprintIds = [...new Set(goalStories.map(story => story.sprintId).filter(Boolean))];
    
    if (sprintIds.length === 0) return null;
    
    // Get sprint names
    const sprintNames = sprintIds
      .map(sprintId => {
        const sprint = sprints.find(s => s.id === sprintId);
        return sprint ? (sprint.name || sprint.ref || `Sprint ${sprint.id.slice(-3)}`) : null;
      })
      .filter(Boolean);
    
    if (sprintNames.length === 0) return null;
    
    // Return single sprint name or count if multiple
    if (sprintNames.length === 1) {
      return sprintNames[0];
    } else {
      return `${sprintNames.length} sprints`;
    }
  }, [stories, sprints]);

  // Organize goals by theme
  const themeRows: ThemeRow[] = useMemo(() => {
    const filteredGoals = goals.filter(goal => {
      const matchesSearch = !searchTerm || 
        goal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        goal.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesTheme = selectedThemes.length === 0 || selectedThemes.includes(goal.theme || 0);
      
      return matchesSearch && matchesTheme;
    });

    const rows: ThemeRow[] = themes.map(theme => ({
      ...theme,
      goals: filteredGoals
        .filter(goal => (goal.theme || 0) === theme.id)
        .map(goal => {
          const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
          const endDate = goal.endDate ? new Date(goal.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          
          return {
            ...goal,
            left: getDatePosition(startDate),
            width: getDatePosition(endDate) - getDatePosition(startDate)
          };
        })
        .sort((a, b) => {
          const aStart = a.startDate ? new Date(a.startDate) : new Date();
          const bStart = b.startDate ? new Date(b.startDate) : new Date();
          return aStart.getTime() - bStart.getTime();
        })
    }));

    return rows.filter(row => row.goals.length > 0 || selectedThemes.length === 0);
  }, [goals, themes, searchTerm, selectedThemes, getDatePosition]);

  // Handle goal editing
  const handleEditGoal = useCallback((goal: Goal) => {
    setEditingGoal(goal);
    setShowEditModal(true);
  }, []);

  // Handle goal deletion
  const handleDeleteGoal = useCallback((goal: Goal) => {
    setDeletingGoal(goal);
    setShowDeleteConfirm(true);
  }, []);

  // Handle goal archiving
  const handleArchiveGoal = useCallback(async (goal: Goal) => {
    try {
      await updateDoc(doc(db, 'goals', goal.id), {
        status: 4, // 4 = Deferred/Archived
        archivedAt: serverTimestamp()
      });
      await ActivityStreamService.logFieldChange(
        goal.id,
        'goal',
        currentUser?.uid || '',
        currentUser?.email || '',
        'status',
        goal.status.toString(),
        '4',
        'personal',
        JSON.stringify({ action: 'archived', title: goal.title }),
        'human'
      );
    } catch (error) {
      console.error('Error archiving goal:', error);
    }
  }, [currentUser]);

  // Handle goal completion
  const handleCompleteGoal = useCallback(async (goal: Goal) => {
    try {
      await updateDoc(doc(db, 'goals', goal.id), {
        status: 2, // 2 = Complete
        completedAt: serverTimestamp()
      });
      await ActivityStreamService.logFieldChange(
        goal.id,
        'goal',
        currentUser?.uid || '',
        currentUser?.email || '',
        'status',
        goal.status.toString(),
        '2',
        'personal',
        JSON.stringify({ action: 'completed', title: goal.title }),
        'human'
      );
    } catch (error) {
      console.error('Error completing goal:', error);
    }
  }, [currentUser]);

  // Handle goal duplication
  const handleDuplicateGoal = useCallback(async (goal: Goal) => {
    try {
      const { id, createdAt, updatedAt, ...goalData } = goal;
      const duplicatedGoal = {
        ...goalData,
        title: `${goalData.title} (Copy)`,
        status: 0, // 0 = New
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      await addDoc(collection(db, 'goals'), duplicatedGoal);
      await ActivityStreamService.logFieldChange(
        'new-goal',
        'goal',
        currentUser?.uid || '',
        currentUser?.email || '',
        'status',
        '',
        '0',
        'personal',
        JSON.stringify({ action: 'duplicated', originalTitle: goal.title, newTitle: duplicatedGoal.title }),
        'human'
      );
    } catch (error) {
      console.error('Error duplicating goal:', error);
    }
  }, [currentUser]);

  const confirmDeleteGoal = useCallback(async () => {
    if (!deletingGoal) return;

    try {
      await deleteDoc(doc(db, 'goals', deletingGoal.id));
      await ActivityStreamService.logFieldChange(
        deletingGoal.id,
        'goal',
        currentUser?.uid || '',
        currentUser?.email || '',
        'status',
        deletingGoal.status,
        -1,
        'personal',
        JSON.stringify({ action: 'deleted', title: deletingGoal.title }),
        'human'
      );
      setShowDeleteConfirm(false);
      setDeletingGoal(null);
    } catch (error) {
      console.error('Error deleting goal:', error);
    }
  }, [deletingGoal, currentUser]);

  // Handle drag operations
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, goal: GanttGoal, dragType: DragState['dragType']) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    
    setDragState({
      isDragging: true,
      goalId: goal.id,
      dragType,
      startX: clientX,
      startDate: goal.startDate ? new Date(goal.startDate) : new Date(),
      endDate: goal.endDate ? new Date(goal.endDate) : new Date(),
      originalTheme: goal.theme || 0
    });

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove);
    document.addEventListener('touchend', handleDragEnd);
  }, []);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragState.isDragging || !dragState.goalId) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const deltaX = clientX - dragState.startX;
    const timeline = timelineRef.current;
    
    if (!timeline) return;

    const timelineWidth = timeline.offsetWidth;
    const { start, end } = timelineBounds;
    const totalMs = end.getTime() - start.getTime();
    const deltaMs = (deltaX / timelineWidth) * totalMs;

    // Check if dragging over a different theme row
    const target = e.target as Element;
    const themeRow = target.closest('[data-theme-id]');
    const newTheme = themeRow ? parseInt(themeRow.getAttribute('data-theme-id') || '0') : dragState.originalTheme;

    if (dragState.dragType === 'move') {
      setDragState(prev => ({
        ...prev,
        startDate: new Date(prev.startDate.getTime() + deltaMs),
        endDate: new Date(prev.endDate.getTime() + deltaMs),
        newTheme
      }));
    } else if (dragState.dragType === 'resize-start') {
      setDragState(prev => ({
        ...prev,
        startDate: new Date(prev.startDate.getTime() + deltaMs)
      }));
    } else if (dragState.dragType === 'resize-end') {
      setDragState(prev => ({
        ...prev,
        endDate: new Date(prev.endDate.getTime() + deltaMs)
      }));
    }
  }, [dragState, timelineBounds]);

  const handleDragEnd = useCallback(async () => {
    if (!dragState.isDragging || !dragState.goalId) return;

    try {
      const goalRef = doc(db, 'goals', dragState.goalId);
      const updateData: any = {};

      if (dragState.dragType === 'move') {
        updateData.startDate = dragState.startDate.toISOString();
        updateData.endDate = dragState.endDate.toISOString();
        if (dragState.newTheme !== undefined && dragState.newTheme !== dragState.originalTheme) {
          updateData.theme = dragState.newTheme;
        }
      } else if (dragState.dragType === 'resize-start') {
        updateData.startDate = dragState.startDate.toISOString();
      } else if (dragState.dragType === 'resize-end') {
        updateData.endDate = dragState.endDate.toISOString();
      }

      await updateDoc(goalRef, updateData);

      // Log activity
      await ActivityStreamService.logFieldChange(
        dragState.goalId,
        'goal',
        currentUser?.uid || '',
        currentUser?.email || '',
        'timeline',
        `${dragState.originalTheme}`,
        JSON.stringify(updateData),
        'personal',
        JSON.stringify({ dragType: dragState.dragType, ganttView: true }),
        'human'
      );

    } catch (error) {
      console.error('Error updating goal:', error);
    }

    // Cleanup
    setDragState({
      isDragging: false,
      goalId: null,
      dragType: 'move',
      startX: 0,
      startDate: new Date(),
      endDate: new Date(),
      originalTheme: 0
    });

    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);
  }, [dragState, currentUser, handleDragMove]);

  // Generate timeline headers
  const generateTimelineHeaders = () => {
    const { start, end } = timelineBounds;
    const headers = [];
    const current = new Date(start);

    switch (zoomLevel) {
      case 'day':
        while (current <= end) {
          headers.push({
            label: current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            date: new Date(current),
            width: getDatePosition(new Date(current.getTime() + 24 * 60 * 60 * 1000)) - getDatePosition(current)
          });
          current.setDate(current.getDate() + 1);
        }
        break;
      case 'week':
        // Start from the beginning of the week
        const startOfWeek = new Date(current);
        startOfWeek.setDate(current.getDate() - current.getDay());
        current.setTime(startOfWeek.getTime());
        
        while (current <= end) {
          const weekEnd = new Date(current);
          weekEnd.setDate(current.getDate() + 6);
          headers.push({
            label: `${current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            date: new Date(current),
            width: getDatePosition(new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000)) - getDatePosition(current)
          });
          current.setDate(current.getDate() + 7);
        }
        break;
      case 'month':
        while (current <= end) {
          headers.push({
            label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            date: new Date(current),
            width: getDatePosition(new Date(current.getFullYear(), current.getMonth() + 1, 1)) - getDatePosition(current)
          });
          current.setMonth(current.getMonth() + 1);
        }
        break;
      case 'quarter':
        while (current <= end) {
          const quarter = Math.floor(current.getMonth() / 3) + 1;
          headers.push({
            label: `Q${quarter} ${current.getFullYear()}`,
            date: new Date(current),
            width: getDatePosition(new Date(current.getFullYear(), current.getMonth() + 3, 1)) - getDatePosition(current)
          });
          current.setMonth(current.getMonth() + 3);
        }
        break;
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
                Enhanced Goals Timeline by Theme
              </h4>
            </Col>
            <Col md={6} className="text-end">
              <div className="d-flex align-items-center justify-content-end gap-2">
                <Button 
                  variant={zoomLevel === 'day' ? 'primary' : 'outline-secondary'} 
                  size="sm" 
                  onClick={() => setZoomLevel('day')}
                >
                  Day
                </Button>
                <Button 
                  variant={zoomLevel === 'week' ? 'primary' : 'outline-secondary'} 
                  size="sm" 
                  onClick={() => setZoomLevel('week')}
                >
                  Week
                </Button>
                <Button 
                  variant={zoomLevel === 'month' ? 'primary' : 'outline-secondary'} 
                  size="sm" 
                  onClick={() => setZoomLevel('month')}
                >
                  Month
                </Button>
                <Button 
                  variant={zoomLevel === 'quarter' ? 'primary' : 'outline-secondary'} 
                  size="sm" 
                  onClick={() => setZoomLevel('quarter')}
                >
                  Quarter
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
                <option value="day">Day View</option>
                <option value="week">Week View</option>
                <option value="month">Month View</option>
                <option value="quarter">Quarter View</option>
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

      {/* Timeline Container */}
      <div className="timeline-container" style={{ height: 'calc(100vh - 300px)', overflow: 'auto' }}>
        {/* Timeline Header */}
        <div className="timeline-header sticky-top bg-white border-bottom" style={{ zIndex: 5 }}>
          <div className="d-flex">
            <div className="goal-label" style={{ width: '250px', minWidth: '250px' }}>
              <strong>Theme</strong>
            </div>
            <div className="timeline-months flex-grow-1 position-relative" ref={timelineRef}>
              <div className="d-flex">
                {generateTimelineHeaders().map((header, index) => (
                  <div
                    key={index}
                    className="timeline-month border-end text-center py-2"
                    style={{ width: `${header.width}%`, minWidth: '100px' }}
                  >
                    <small><strong>{header.label}</strong></small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Theme Rows */}
        <div className="theme-rows">
          {themeRows.map(themeRow => (
            <div
              key={themeRow.id}
              className="goal-row border-bottom d-flex"
              data-theme-id={themeRow.id}
              style={{ minHeight: '70px' }} // Increased from 60px to accommodate taller goal bars
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                // Handle drop to change theme
              }}
            >
              <div
                className="goal-label d-flex align-items-center px-3"
                style={{ 
                  width: '250px',
                  minWidth: '250px',
                  backgroundColor: themeRow.color + '20',
                  borderLeft: `4px solid ${themeRow.color}`
                }}
              >
                <div
                  className="theme-indicator me-2"
                  style={{
                    width: '12px',
                    height: '12px',
                    backgroundColor: themeRow.color,
                    borderRadius: '2px'
                  }}
                />
                <div>
                  <strong>{themeRow.name}</strong>
                  <div className="text-muted small">{themeRow.goals.length} goal(s)</div>
                </div>
              </div>
              
              <div className="goal-timeline flex-grow-1 position-relative">
                {themeRow.goals.map((goal, goalIndex) => {
                  const isDragging = dragState.isDragging && dragState.goalId === goal.id;
                  const themeAwareColors = getThemeAwareGoalColor(goal.theme || 0, themeColors.isDark);
                  
                  const goalStyle: React.CSSProperties = {
                    left: `${goal.left}%`,
                    width: `${Math.max(goal.width || 10, 5)}%`,
                    top: `${goalIndex * 42 + 8}px`, // Slightly more spacing for better separation
                    minWidth: '140px',
                    height: '36px', // Taller for better text visibility and modern look
                    backgroundColor: themeAwareColors.background,
                    color: themeAwareColors.text,
                    opacity: isDragging ? 0.8 : 1,
                    transform: isDragging ? 'scale(1.01)' : 'scale(1)', // Subtle scaling
                    zIndex: isDragging ? 1000 : 1,
                    borderRadius: '6px', // Slightly less rounded for flatter look
                    border: `1px solid ${themeAwareColors.background === '#fff' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}`, // Theme-aware border
                    boxShadow: themeColors.isDark 
                      ? '0 1px 3px rgba(0,0,0,0.2)' 
                      : '0 1px 3px rgba(0,0,0,0.08)', // Softer shadow for flat design
                    transition: 'all 0.15s ease', // Quicker transitions for responsiveness
                    cursor: 'grab'
                  };

                  return (
                    <div
                      key={goal.id}
                      className={`goal-bar position-absolute d-flex align-items-center cursor-move ${isDragging ? 'dragging' : ''}`}
                      style={goalStyle}
                      onMouseDown={(e) => handleDragStart(e, goal, 'move')}
                      onTouchStart={(e) => handleDragStart(e, goal, 'move')}
                    >
                      {/* Resize handle - start */}
                      <div
                        className="resize-handle resize-start position-absolute"
                        style={{
                          left: '0',
                          top: '0',
                          width: '6px',
                          height: '100%',
                          cursor: 'ew-resize',
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          borderRadius: '3px 0 0 3px',
                          opacity: 0.7,
                          transition: 'opacity 0.2s ease'
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleDragStart(e, goal, 'resize-start');
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleDragStart(e, goal, 'resize-start');
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.7';
                        }}
                      />
                      
                      {/* Goal content */}
                      <div className="goal-content px-3 text-truncate flex-grow-1 d-flex align-items-center justify-content-between"
                           style={{ color: themeAwareColors.text }}>
                        <div className="d-flex flex-column">
                          <span className="text-truncate me-2" style={{ fontSize: '13px', fontWeight: '500' }}>
                            {goal.title}
                          </span>
                          <small className="text-truncate" style={{ 
                            fontSize: '11px', 
                            color: `${themeAwareColors.text}80`,
                            marginTop: '2px'
                          }}>
                            {getGoalSprintInfo(goal.id) || `${getThemeById(goal.theme || 0)?.name || 'General'} Goal`}
                          </small>
                        </div>
                        
                        {/* Action dropdown */}
                        <Dropdown>
                          <Dropdown.Toggle
                            variant="link"
                            size="sm"
                            className="p-0 border-0"
                            style={{ 
                              minWidth: 'auto', 
                              fontSize: '12px',
                              color: themeAwareColors.text,
                              opacity: 0.8,
                              backgroundColor: 'transparent'
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical size={14} />
                          </Dropdown.Toggle>

                          <Dropdown.Menu>
                            <Dropdown.Item onClick={(e) => {
                              e.stopPropagation();
                              handleEditGoal(goal);
                            }}>
                              <Edit size={14} className="me-2" />
                              Edit Goal
                            </Dropdown.Item>
                            
                            {goal.status !== 2 && ( // 2 = Complete
                              <Dropdown.Item onClick={(e) => {
                                e.stopPropagation();
                                handleCompleteGoal(goal);
                              }}>
                                <CheckCircle size={14} className="me-2" />
                                Mark Complete
                              </Dropdown.Item>
                            )}
                            
                            {goal.status !== 4 && ( // 4 = Deferred/Archived
                              <Dropdown.Item onClick={(e) => {
                                e.stopPropagation();
                                handleArchiveGoal(goal);
                              }}>
                                <Archive size={14} className="me-2" />
                                Archive
                              </Dropdown.Item>
                            )}
                            
                            <Dropdown.Item onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateGoal(goal);
                            }}>
                              <Copy size={14} className="me-2" />
                              Duplicate
                            </Dropdown.Item>
                            
                            <Dropdown.Divider />
                            
                            <Dropdown.Item 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteGoal(goal);
                              }}
                              className="text-danger"
                            >
                              <Trash2 size={14} className="me-2" />
                              Delete
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>
                      </div>
                      
                      {/* Resize handle - end */}
                      <div
                        className="resize-handle resize-end position-absolute"
                        style={{
                          right: '0',
                          top: '0',
                          width: '6px',
                          height: '100%',
                          cursor: 'ew-resize',
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          borderRadius: '0 3px 3px 0',
                          opacity: 0.7,
                          transition: 'opacity 0.2s ease'
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleDragStart(e, goal, 'resize-end');
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleDragStart(e, goal, 'resize-end');
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.7';
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sprint bars - positioned below timeline headers */}
        <div className="sprint-bars-container position-absolute" style={{ top: '40px', left: '250px', right: '0', height: '30px', zIndex: 3 }}>
          {sprints.map(sprint => {
            const startDate = sprint.startDate ? new Date(sprint.startDate) : null;
            const endDate = sprint.endDate ? new Date(sprint.endDate) : null;
            
            if (!startDate || !endDate) return null;
            
            const startPos = getDatePosition(startDate);
            const endPos = getDatePosition(endDate);
            const width = Math.max(endPos - startPos, 2); // Minimum 2% width
            
            return (
              <div
                key={sprint.id}
                className="sprint-bar position-absolute"
                style={{
                  left: `${startPos}%`,
                  width: `${width}%`,
                  top: '5px',
                  height: '20px',
                  backgroundColor: '#3b82f6',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: '500',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }}
                title={`${sprint.name || 'Sprint'}: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`}
              >
                {width > 8 ? (sprint.name || `Sprint ${sprint.id.slice(-3)}`) : 'S'}
              </div>
            );
          })}
        </div>

        {/* Today indicator */}
        <div 
          className="today-line position-absolute"
          style={{
            left: `${getDatePosition(new Date())}%`,
            top: '0',
            width: '3px', // Thicker line for better visibility
            height: '100%',
            backgroundColor: '#ef4444',
            zIndex: 4,
            pointerEvents: 'none',
            boxShadow: '0 0 6px rgba(239, 68, 68, 0.4)' // Glow effect
          }}
          title={`Today: ${new Date().toLocaleDateString()}`}
        />
        
        {/* Today label */}
        <div
          className="today-label position-absolute"
          style={{
            left: `${getDatePosition(new Date())}%`,
            top: '-25px',
            transform: 'translateX(-50%)',
            backgroundColor: '#ef4444',
            color: 'white',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '500',
            zIndex: 5,
            pointerEvents: 'none',
            whiteSpace: 'nowrap'
          }}
        >
          TODAY
        </div>
        
        {/* Original sprint markers for goal rows */}
        {sprints.map(sprint => {
          const startPos = getDatePosition(new Date(sprint.startDate));
          const endPos = getDatePosition(new Date(sprint.endDate));
          
          return (
            <div
              key={`marker-${sprint.id}`}
              className="sprint-line position-absolute"
              style={{
                left: `${startPos}%`,
                width: `${endPos - startPos}%`,
                top: '70px', // Below sprint bars
                height: 'calc(100% - 70px)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderLeft: '1px dashed #3b82f6',
                borderRight: '1px dashed #3b82f6',
                pointerEvents: 'none',
                zIndex: 1
              }}
              title={sprint.name}
            />
          );
        })}
      </div>

      {/* Edit Goal Modal */}
      {showEditModal && editingGoal && (
        <EditGoalModal
          show={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditingGoal(null);
          }}
          goal={editingGoal}
          currentUserId={currentUser?.uid || ''}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteConfirm} onHide={() => setShowDeleteConfirm(false)}>
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center">
            <Trash2 className="me-2 text-danger" size={24} />
            Delete Goal
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="danger">
            <p><strong>Warning:</strong> This will permanently delete the goal:</p>
            <p><strong>"{deletingGoal?.title}"</strong></p>
            <p>This action cannot be undone.</p>
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteGoal}>
            Delete Goal
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default ThemeBasedGanttChart;

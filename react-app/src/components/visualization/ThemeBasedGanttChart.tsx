import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Calendar, 
  ZoomIn, 
  ZoomOut, 
  Activity,
  AlertTriangle,
  Edit,
  Trash2,
  Plus
} from 'lucide-react';
import { Card, Container, Row, Col, Button, Form, Badge, Alert, Modal } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import { Goal, Sprint, Story, Task } from '../../types';
import EditGoalModal from '../EditGoalModal';
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
  
  // Core data
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [zoomLevel, setZoomLevel] = useState<'month' | 'quarter' | 'half' | 'year'>('quarter');
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
  
  // Timeline refs
  const timelineRef = useRef<HTMLDivElement>(null);
  
  // Theme definitions
  const themes = [
    { id: 0, name: 'General', color: '#6c757d' },
    { id: 1, name: 'Health & Fitness', color: '#dc3545' },
    { id: 2, name: 'Career & Professional', color: '#fd7e14' },
    { id: 3, name: 'Financial', color: '#ffc107' },
    { id: 4, name: 'Learning & Education', color: '#198754' },
    { id: 5, name: 'Family & Relationships', color: '#20c997' },
    { id: 6, name: 'Hobbies & Interests', color: '#0dcaf0' },
    { id: 7, name: 'Travel & Adventure', color: '#0d6efd' },
    { id: 8, name: 'Home & Living', color: '#6610f2' },
    { id: 9, name: 'Spiritual & Personal Growth', color: '#d63384' }
  ];

  // Load data
  useEffect(() => {
    if (!currentUser) return;

    const loadData = async () => {
      try {
        setLoading(true);

        // Load goals
        const goalsQuery = query(
          collection(db, 'goals'),
          where('uid', '==', currentUser.uid)
        );
        
        const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
          const goalsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Goal[];
          setGoals(goalsData);
        });

        // Load sprints for timeline markers
        const sprintsQuery = query(
          collection(db, 'sprints'),
          where('uid', '==', currentUser.uid)
        );
        
        const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
          const sprintsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Sprint[];
          setSprints(sprintsData);
        });

        setLoading(false);

        return () => {
          unsubscribeGoals();
          unsubscribeSprints();
        };
      } catch (error) {
        console.error('Error loading Gantt data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [currentUser]);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() + 2, 11, 31);
    return { start, end };
  }, []);

  // Calculate date position
  const getDatePosition = useCallback((date: Date) => {
    const { start, end } = timelineBounds;
    const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const daysSinceStart = (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return (daysSinceStart / totalDays) * 100; // Percentage
  }, [timelineBounds]);

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

  const confirmDeleteGoal = useCallback(async () => {
    if (!deletingGoal) return;

    try {
      await deleteDoc(doc(db, 'goals', deletingGoal.id));
      await ActivityStreamService.logFieldChange(
        deletingGoal.id,
        'goal',
        'status',
        deletingGoal.status,
        -1,
        currentUser?.uid || '',
        currentUser?.email || '',
        JSON.stringify({ action: 'deleted', title: deletingGoal.title })
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
        'timeline',
        `${dragState.originalTheme}`,
        JSON.stringify(updateData),
        currentUser?.uid || '',
        currentUser?.email || '',
        JSON.stringify({ dragType: dragState.dragType, ganttView: true })
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

    if (zoomLevel === 'month') {
      while (current <= end) {
        headers.push({
          label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          date: new Date(current),
          width: getDatePosition(new Date(current.getFullYear(), current.getMonth() + 1, 1)) - getDatePosition(current)
        });
        current.setMonth(current.getMonth() + 1);
      }
    } else if (zoomLevel === 'quarter') {
      while (current <= end) {
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
                Enhanced Goals Timeline by Theme
              </h4>
            </Col>
            <Col md={6} className="text-end">
              <div className="d-flex align-items-center justify-content-end gap-2">
                <Button variant="outline-secondary" size="sm" onClick={() => setZoomLevel('month')}>
                  <ZoomIn size={16} />
                </Button>
                <Button variant="outline-secondary" size="sm" onClick={() => setZoomLevel('quarter')}>
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
              style={{ minHeight: '60px' }}
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
                  const goalStyle: React.CSSProperties = {
                    left: `${goal.left}%`,
                    width: `${Math.max(goal.width || 10, 5)}%`,
                    top: `${goalIndex * 35 + 10}px`,
                    minWidth: '100px',
                    height: '30px',
                    backgroundColor: themeRow.color,
                    opacity: isDragging ? 0.7 : 1,
                    transform: isDragging ? 'scale(1.05)' : 'scale(1)',
                    zIndex: isDragging ? 1000 : 1
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
                          width: '8px',
                          height: '100%',
                          cursor: 'ew-resize',
                          backgroundColor: 'rgba(255,255,255,0.3)',
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
                      
                      {/* Goal content */}
                      <div className="goal-content px-2 text-white text-truncate flex-grow-1 d-flex align-items-center justify-content-between">
                        <span className="text-truncate me-2" style={{ fontSize: '13px' }}>
                          {goal.title}
                        </span>
                        
                        {/* Action buttons */}
                        <div className="goal-actions d-flex gap-1">
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 text-white"
                            style={{ minWidth: 'auto', fontSize: '12px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditGoal(goal);
                            }}
                          >
                            <Edit size={12} />
                          </Button>
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 text-white"
                            style={{ minWidth: 'auto', fontSize: '12px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteGoal(goal);
                            }}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                      
                      {/* Resize handle - end */}
                      <div
                        className="resize-handle resize-end position-absolute"
                        style={{
                          right: '0',
                          top: '0',
                          width: '8px',
                          height: '100%',
                          cursor: 'ew-resize',
                          backgroundColor: 'rgba(255,255,255,0.3)',
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
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sprint markers */}
        {sprints.map(sprint => {
          const startPos = getDatePosition(new Date(sprint.startDate));
          const endPos = getDatePosition(new Date(sprint.endDate));
          
          return (
            <div
              key={sprint.id}
              className="sprint-line position-absolute"
              style={{
                left: `${startPos}%`,
                width: `${endPos - startPos}%`,
                top: '0',
                height: '100%',
                borderColor: '#3b82f6',
                pointerEvents: 'none',
                zIndex: 0
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

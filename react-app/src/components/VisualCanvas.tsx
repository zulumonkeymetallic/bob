import React, { useState, useEffect, useRef } from 'react';
import { Container, Card, Button, Modal, Form, Badge, Row, Col } from 'react-bootstrap';
import { ZoomIn, ZoomOut, ArrowClockwise, Plus, Save, Eye } from 'react-bootstrap-icons';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Goal, Story, Task } from '../types';
import { isStatus, isTheme } from '../utils/statusHelpers';

interface CanvasNode {
  id: string;
  type: 'goal' | 'story' | 'task';
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  data: Goal | Story | Task;
  connections: string[];
}

interface CanvasConnection {
  id: string;
  fromId: string;
  toId: string;
  type: 'goal-story' | 'story-task';
}

const VisualCanvas: React.FC = () => {
  const { currentUser } = useAuth();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [connections, setConnections] = useState<CanvasConnection[]>([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = useState<'full' | 'goals-only' | 'active-only'>('full');

  useEffect(() => {
    if (!currentUser) return;

    // Subscribe to data
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
    });

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
    });

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          dueDate: data.dueDate?.toDate?.() || data.dueDate,
        };
      }) as Task[];
      setTasks(tasksData);
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
    };
  }, [currentUser]);

  useEffect(() => {
    const generateCanvas = () => {
      const newNodes: CanvasNode[] = [];
      const newConnections: CanvasConnection[] = [];

      let yOffset = 50;
      const goalSpacing = 300;
      const storySpacing = 200;
      const taskSpacing = 150;

      // Filter data based on view mode
      const filteredGoals = viewMode === 'active-only' 
        ? goals.filter(g => isStatus(g.status, 'Work in Progress'))
        : goals;

      const filteredStories = viewMode === 'active-only'
        ? stories.filter(s => isStatus(s.status, 'active'))
        : stories;

      const filteredTasks = viewMode === 'active-only'
        ? tasks.filter(t => isStatus(t.status, 'in_progress'))
        : tasks;

      // Create goal nodes
      filteredGoals.forEach((goal, index) => {
        const goalNode: CanvasNode = {
          id: goal.id,
          type: 'goal',
          x: 50,
          y: yOffset + (index * goalSpacing),
          width: 200,
          height: 80,
          title: goal.title,
          data: goal,
          connections: []
        };
        newNodes.push(goalNode);

        if (viewMode !== 'goals-only') {
          // Create story nodes for this goal
          const goalStories = filteredStories.filter(s => s.goalId === goal.id);
          goalStories.forEach((story, storyIndex) => {
            const storyNode: CanvasNode = {
              id: story.id,
              type: 'story',
              x: 300,
              y: yOffset + (index * goalSpacing) + (storyIndex * storySpacing),
              width: 180,
              height: 60,
              title: story.title,
              data: story,
              connections: [goal.id]
            };
            newNodes.push(storyNode);

            // Create connection from goal to story
            newConnections.push({
              id: `${goal.id}-${story.id}`,
              fromId: goal.id,
              toId: story.id,
              type: 'goal-story'
            });

            // Create task nodes for this story
            const storyTasks = filteredTasks.filter(t => t.storyId === story.id);
            storyTasks.forEach((task, taskIndex) => {
              const taskNode: CanvasNode = {
                id: task.id!,
                type: 'task',
                x: 520,
                y: yOffset + (index * goalSpacing) + (storyIndex * storySpacing) + (taskIndex * taskSpacing),
                width: 160,
                height: 50,
                title: task.title,
                data: task,
                connections: [story.id]
              };
              newNodes.push(taskNode);

              // Create connection from story to task
              newConnections.push({
                id: `${story.id}-${task.id}`,
                fromId: story.id,
                toId: task.id!,
                type: 'story-task'
              });
            });
          });
        }
      });

      setNodes(newNodes);
      setConnections(newConnections);
    };
    generateCanvas();
  }, [goals, stories, tasks, viewMode]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(prev => Math.max(0.3, Math.min(2, prev + delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const getNodeColor = (node: CanvasNode) => {
    switch (node.type) {
      case 'goal':
        const goal = node.data as Goal;
        const themeColors = {
          Health: 'var(--theme-health-primary)',
          Growth: 'var(--theme-growth-primary)',
          Wealth: 'var(--theme-wealth-primary)',
          Tribe: 'var(--theme-tribe-primary)',
          Home: 'var(--theme-home-primary)'
        } as const;
        return (themeColors as any)[goal.theme] || 'var(--muted)';
      case 'story':
        const story = node.data as Story;
        return isStatus(story.status, 'done') ? 'var(--green)' : isStatus(story.status, 'in-progress') ? 'var(--brand)' : 'var(--muted)';
      case 'task':
        const task = node.data as Task;
        return isStatus(task.status, 'done') ? 'var(--green)' : isStatus(task.status, 'in_progress') ? 'var(--brand)' : 'var(--muted)';
      default:
        return 'var(--muted)';
    }
  };

  const getConnectionPath = (connection: CanvasConnection) => {
    const fromNode = nodes.find(n => n.id === connection.fromId);
    const toNode = nodes.find(n => n.id === connection.toId);
    
    if (!fromNode || !toNode) return '';

    const fromX = fromNode.x + fromNode.width;
    const fromY = fromNode.y + fromNode.height / 2;
    const toX = toNode.x;
    const toY = toNode.y + toNode.height / 2;

    const midX = (fromX + toX) / 2;

    return `M ${fromX} ${fromY} Q ${midX} ${fromY} ${toX} ${toY}`;
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportView = () => {
    // TODO: Implement export functionality
    console.log('Export view:', { nodes, connections, scale, offset });
  };

  return (
    <Container fluid className="visual-canvas-container">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Goal-Story-Task Canvas</h2>
        <div className="d-flex gap-2 align-items-center">
          {/* View Mode Selector */}
          <Form.Select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
            style={{ width: '150px' }}
          >
            <option value="full">Full View</option>
            <option value="goals-only">Goals Only</option>
            <option value="active-only">Active Only</option>
          </Form.Select>
          
          {/* Canvas Controls */}
          <Button variant="outline-secondary" size="sm" onClick={() => setScale(s => Math.min(2, s + 0.2))}>
            <ZoomIn />
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={() => setScale(s => Math.max(0.3, s - 0.2))}>
            <ZoomOut />
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={resetView}>
            <ArrowClockwise />
          </Button>
          <Button variant="outline-primary" size="sm" onClick={exportView}>
            <Save /> Export
          </Button>
          <Badge bg="info">Scale: {Math.round(scale * 100)}%</Badge>
        </div>
      </div>

      <Card className="canvas-container" style={{ height: '70vh', overflow: 'hidden', position: 'relative' }}>
        <div
          ref={canvasRef}
          className="canvas"
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            cursor: isDragging ? 'grabbing' : 'grab',
            // Use themed CSS from .canvas class in App.css
            transform: `scale(${scale}) translate(${offset.x}px, ${offset.y}px)`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 0.1s ease'
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Render connections */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 1
            }}
          >
            {connections.map(connection => (
              <path
                key={connection.id}
                d={getConnectionPath(connection)}
                stroke={connection.type === 'goal-story' ? 'var(--brand)' : 'var(--green)'}
                strokeWidth="2"
                fill="none"
                strokeDasharray={connection.type === 'story-task' ? '5,5' : 'none'}
                opacity="0.7"
              />
            ))}
          </svg>

          {/* Render nodes */}
          {nodes.map(node => (
            <div
              key={node.id}
              className={`canvas-node canvas-node-${node.type}`}
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                backgroundColor: getNodeColor(node),
                color: 'var(--on-accent)',
                borderRadius: '8px',
                padding: '8px',
                cursor: 'pointer',
                boxShadow: selectedNode?.id === node.id ? '0 0 0 3px var(--brand)' : '0 2px 4px rgba(0,0,0,0.1)',
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                fontSize: node.type === 'goal' ? '14px' : node.type === 'story' ? '12px' : '11px',
                fontWeight: 'bold',
                transition: 'all 0.2s ease'
              }}
              onClick={() => setSelectedNode(node)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <div style={{ fontSize: node.type === 'goal' ? '20px' : '16px', marginBottom: '4px' }}>
                {node.type === 'goal' ? '🎯' : node.type === 'story' ? '📋' : '✓'}
              </div>
              <div style={{ 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                lineHeight: '1.2',
                maxHeight: node.type === 'goal' ? '40px' : '30px'
              }}>
                {node.title.length > (node.type === 'goal' ? 25 : 20) 
                  ? `${node.title.substring(0, node.type === 'goal' ? 25 : 20)}...` 
                  : node.title}
              </div>
              
              {/* Status indicator */}
              <div style={{ 
                position: 'absolute', 
                top: '4px', 
                right: '4px', 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%',
                backgroundColor: (() => {
                  if (node.type === 'goal') return isStatus((node.data as Goal).status, 'Work in Progress') ? 'var(--green)' : 'var(--orange)';
                  if (node.type === 'story') return isStatus((node.data as Story).status, 'done') ? 'var(--green)' : 'var(--orange)';
                  return isStatus((node.data as Task).status, 'done') ? 'var(--green)' : 'var(--orange)';
                })()
              }} />
            </div>
          ))}
        </div>
      </Card>

      {/* Legend */}
      <Row className="mt-3">
        <Col md={12}>
          <Card>
            <Card.Body className="p-2">
              <div className="d-flex justify-content-center gap-4 text-sm">
                <div className="d-flex align-items-center">
                  <div style={{ width: '16px', height: '16px', backgroundColor: 'var(--purple)', borderRadius: '4px', marginRight: '8px' }}></div>
                  <span>🎯 Goals</span>
                </div>
                <div className="d-flex align-items-center">
                  <div style={{ width: '16px', height: '16px', backgroundColor: 'var(--brand)', borderRadius: '4px', marginRight: '8px' }}></div>
                  <span>📋 Stories</span>
                </div>
                <div className="d-flex align-items-center">
                  <div style={{ width: '16px', height: '16px', backgroundColor: 'var(--green)', borderRadius: '4px', marginRight: '8px' }}></div>
                  <span>✓ Tasks</span>
                </div>
                <div className="d-flex align-items-center">
                  <div style={{ width: '20px', height: '2px', backgroundColor: 'var(--brand)', marginRight: '8px' }}></div>
                  <span>Goal → Story</span>
                </div>
                <div className="d-flex align-items-center">
                  <div style={{ 
                    width: '20px', 
                    height: '2px', 
                    backgroundColor: 'var(--green)', 
                    marginRight: '8px',
                    backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 3px, var(--on-accent) 3px, var(--on-accent) 6px)'
                  }}></div>
                  <span>Story → Task</span>
                </div>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Node Details Modal */}
      {selectedNode && (
        <Modal show={!!selectedNode} onHide={() => setSelectedNode(null)} size="lg">
          <Modal.Header closeButton>
            <Modal.Title>
              {selectedNode.type === 'goal' ? '🎯' : selectedNode.type === 'story' ? '📋' : '✓'} {selectedNode.title}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedNode.type === 'goal' && (
              <div>
                <p><strong>Theme:</strong> {(selectedNode.data as Goal).theme}</p>
                <p><strong>Status:</strong> {(selectedNode.data as Goal).status}</p>
                <p><strong>Size:</strong> {(selectedNode.data as Goal).size}</p>
                {(selectedNode.data as Goal).description && (
                  <p><strong>Description:</strong> {(selectedNode.data as Goal).description}</p>
                )}
              </div>
            )}
            {selectedNode.type === 'story' && (
              <div>
                <p><strong>Priority:</strong> {(selectedNode.data as Story).priority}</p>
                <p><strong>Status:</strong> {(selectedNode.data as Story).status}</p>
                <p><strong>Points:</strong> {(selectedNode.data as Story).points}</p>
                {(selectedNode.data as Story).description && (
                  <p><strong>Description:</strong> {(selectedNode.data as Story).description}</p>
                )}
              </div>
            )}
            {selectedNode.type === 'task' && (
              <div>
                <p><strong>Priority:</strong> {(selectedNode.data as Task).priority}</p>
                <p><strong>Status:</strong> {(selectedNode.data as Task).status}</p>
                <p><strong>Effort:</strong> {(selectedNode.data as Task).effort}</p>
                {(selectedNode.data as Task).description && (
                  <p><strong>Description:</strong> {(selectedNode.data as Task).description}</p>
                )}
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setSelectedNode(null)}>
              Close
            </Button>
            <Button variant="primary">
              Edit {selectedNode.type}
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </Container>
  );
};

export default VisualCanvas;

export {};

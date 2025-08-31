import React, { useState } from 'react';
import { Card, Row, Col, Badge, Button, Dropdown, Modal } from 'react-bootstrap';
import { Edit3, Trash2, ChevronDown, Target, Calendar, User, Hash, MessageCircle } from 'lucide-react';
import { Goal } from '../types';
import { useSidebar } from '../contexts/SidebarContext';

interface GoalsCardViewProps {
  goals: Goal[];
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => void;
  onGoalDelete: (goalId: string) => void;
  onGoalPriorityChange: (goalId: string, newPriority: number) => void;
}

const GoalsCardView: React.FC<GoalsCardViewProps> = ({
  goals,
  onGoalUpdate,
  onGoalDelete,
  onGoalPriorityChange
}) => {
  const { showSidebar } = useSidebar();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);

  // Theme colors mapping
  const themeColors = {
    'Health': '#ef4444',
    'Growth': '#8b5cf6', 
    'Wealth': '#059669',
    'Tribe': '#f59e0b',
    'Home': '#3b82f6'
  };

  // Status colors
  const statusColors = {
    'Not Started': '#6b7280',
    'Work in Progress': '#059669',
    'Complete': '#2563eb',
    'Paused': '#f59e0b'
  };

  const handleGoalClick = (goal: Goal) => {
    console.log('🎯 Opening goal in sidebar:', goal.id);
    showSidebar(goal, 'goal');
  };

  const handleStatusChange = (goalId: string, newStatus: 'Not Started' | 'Work in Progress' | 'Complete' | 'Paused') => {
    onGoalUpdate(goalId, { status: newStatus });
  };

  const handlePriorityChange = (goalId: string, newPriority: number) => {
    onGoalPriorityChange(goalId, newPriority);
  };

  const handleDeleteConfirm = (goalId: string) => {
    onGoalDelete(goalId);
    setShowDeleteModal(null);
  };

  if (goals.length === 0) {
    return (
      <div style={{ 
        textAlign: 'center', 
        padding: '60px 20px',
        color: '#6b7280'
      }}>
        <Target size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <h4>No Goals Found</h4>
        <p>Start by creating your first goal to track your progress.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <Row className="g-4">
        {goals.map((goal) => (
          <Col key={goal.id} xl={4} lg={6} md={6} sm={12}>
            <Card 
              style={{ 
                height: '100%',
                border: 'none',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                cursor: 'pointer'
              }}
              className="h-100"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 12px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
              }}
              onClick={() => handleGoalClick(goal)}
            >
              {/* Theme Bar */}
              <div 
                style={{ 
                  height: '6px', 
                  backgroundColor: themeColors[goal.theme as keyof typeof themeColors] || '#6b7280'
                }} 
              />

              <Card.Body style={{ padding: '20px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5 style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '18px', 
                      fontWeight: '600',
                      lineHeight: '1.4',
                      wordBreak: 'break-word'
                    }}>
                      {goal.title}
                    </h5>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Badge 
                        style={{ 
                          backgroundColor: themeColors[goal.theme as keyof typeof themeColors] || '#6b7280',
                          color: 'white',
                          fontSize: '12px'
                        }}
                      >
                        {goal.theme}
                      </Badge>
                      <Badge 
                        style={{ 
                          backgroundColor: statusColors[goal.status as keyof typeof statusColors] || '#6b7280',
                          color: 'white',
                          fontSize: '12px'
                        }}
                      >
                        {goal.status}
                      </Badge>
                    </div>
                  </div>
                  
                  <Dropdown onClick={(e) => e.stopPropagation()}>
                    <Dropdown.Toggle 
                      variant="outline-secondary" 
                      size="sm"
                      style={{ border: 'none', padding: '4px 8px' }}
                    >
                      <ChevronDown size={16} />
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Header>Change Status</Dropdown.Header>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Not Started')}>
                        Not Started
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Work in Progress')}>
                        Work in Progress
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Complete')}>
                        Complete
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Paused')}>
                        Paused
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Header>Change Priority</Dropdown.Header>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 1)}>
                        High Priority (1)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 2)}>
                        Medium Priority (2)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 3)}>
                        Low Priority (3)
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item 
                        className="text-danger"
                        onClick={() => setShowDeleteModal(goal.id)}
                      >
                        <Trash2 size={14} className="me-2" />
                        Delete Goal
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </div>

                {/* Description */}
                {goal.description && (
                  <p style={{ 
                    margin: '0 0 16px 0', 
                    color: '#6b7280', 
                    fontSize: '14px',
                    lineHeight: '1.5',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {goal.description}
                  </p>
                )}

                {/* Goal Details */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                    <Target size={14} style={{ marginRight: '8px' }} />
                    <span style={{ fontWeight: '500', marginRight: '8px' }}>Size:</span>
                    <span>{goal.size}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                    <Hash size={14} style={{ marginRight: '8px' }} />
                    <span style={{ fontWeight: '500', marginRight: '8px' }}>Priority:</span>
                    <span>{goal.priority}</span>
                  </div>
                  {goal.confidence && (
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: '#6b7280' }}>
                      <User size={14} style={{ marginRight: '8px' }} />
                      <span style={{ fontWeight: '500', marginRight: '8px' }}>Confidence:</span>
                      <span>{goal.confidence}/10</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  paddingTop: '16px',
                  borderTop: '1px solid #e5e7eb',
                  fontSize: '12px',
                  color: '#9ca3af'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Calendar size={12} style={{ marginRight: '4px' }} />
                    {goal.createdAt && new Date(goal.createdAt.toDate()).toLocaleDateString()}
                  </div>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGoalClick(goal);
                    }}
                    style={{ 
                      fontSize: '12px',
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <MessageCircle size={12} />
                    View Details
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

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
    </div>
  );
};

export default GoalsCardView;

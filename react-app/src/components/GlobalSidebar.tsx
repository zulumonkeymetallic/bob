import React, { useState, useEffect } from 'react';
import { Card, Button, Badge, Form, Row, Col, Modal, ListGroup } from 'react-bootstrap';
import { X, Edit3, Save, Calendar, Target, BookOpen, Clock, Hash, ChevronLeft, ChevronRight, Trash2, Plus, MessageCircle } from 'lucide-react';
import { Story, Goal, Task, Sprint } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useTestMode } from '../contexts/TestModeContext';
import { useAuth } from '../contexts/AuthContext';
import { ActivityStreamService, ActivityEntry } from '../services/ActivityStreamService';
import { useTheme } from '../contexts/ModernThemeContext';

interface GlobalSidebarProps {
  goals: Goal[];
  stories: Story[];
  sprints: Sprint[];
  onEdit?: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal') => void;
  onDelete?: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal') => void;
}

const GlobalSidebar: React.FC<GlobalSidebarProps> = ({
  goals,
  stories,
  sprints,
  onEdit,
  onDelete
}) => {
  const { theme } = useTheme();
  const { selectedItem, selectedType, isVisible, isCollapsed, hideSidebar, toggleCollapse, updateItem } = useSidebar();
  const { isTestMode, testModeLabel } = useTestMode();
  const { currentUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNote, setNewNote] = useState('');

  // Theme colors mapping
  const themeColors = {
    'Health': '#ef4444',
    'Growth': '#8b5cf6', 
    'Wealth': '#059669',
    'Tribe': '#f59e0b',
    'Home': '#3b82f6'
  };

  React.useEffect(() => {
    if (selectedItem) {
      setEditForm({ ...selectedItem });
      setIsEditing(false);
      
      // Subscribe to activity stream for this item
      const unsubscribe = ActivityStreamService.subscribeToActivityStream(
        selectedItem.id,
        setActivities
      );
      
      return unsubscribe;
    } else {
      setActivities([]);
    }
  }, [selectedItem]);

  // Apply margin to main content when sidebar is visible
  React.useEffect(() => {
    const sidebarWidth = isCollapsed ? '60px' : '400px';
    
    if (isVisible) {
      document.body.style.marginRight = sidebarWidth;
      document.body.style.transition = 'margin-right 0.3s ease';
    } else {
      document.body.style.marginRight = '0px';
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.marginRight = '0px';
    };
  }, [isVisible, isCollapsed]);

  if (!isVisible || !selectedItem || !selectedType) {
    return null;
  }

  const handleSave = async () => {
    try {
      // Track field changes for activity stream
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      
      Object.keys(editForm).forEach(key => {
        if (selectedItem && editForm[key] !== selectedItem[key]) {
          changes.push({
            field: key,
            oldValue: selectedItem[key],
            newValue: editForm[key]
          });
        }
      });

      await updateItem(editForm);
      
      // Log activity for each change
      if (currentUser && selectedItem && selectedType) {
        const referenceNumber = generateReferenceNumber();
        
        for (const change of changes) {
          if (change.field === 'status') {
            await ActivityStreamService.logStatusChange(
              selectedItem.id,
              selectedType,
              change.oldValue,
              change.newValue,
              currentUser.uid,
              currentUser.email || undefined,
              undefined, // persona can be added if needed
              referenceNumber
            );
          } else {
            await ActivityStreamService.logFieldChange(
              selectedItem.id,
              selectedType,
              change.field,
              change.oldValue,
              change.newValue,
              currentUser.uid,
              currentUser.email || undefined,
              undefined,
              referenceNumber
            );
          }
        }
      }
      
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(selectedItem, selectedType);
    } else {
      setIsEditing(true);
    }
  };

  const handleDelete = () => {
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (onDelete) {
      onDelete(selectedItem, selectedType);
    }
    setShowDeleteModal(false);
    hideSidebar();
  };

  const handleAddNote = async () => {
    console.log('Adding note...', { 
      hasNote: !!newNote.trim(), 
      hasItem: !!selectedItem, 
      hasType: !!selectedType, 
      hasUser: !!currentUser 
    });
    
    if (!newNote.trim()) {
      alert('Please enter a note');
      return;
    }
    
    if (!selectedItem || !selectedType) {
      alert('No item selected');
      return;
    }
    
    if (!currentUser) {
      alert('You must be logged in to add notes');
      return;
    }
    
    try {
      const referenceNumber = generateReferenceNumber();
      console.log('Calling ActivityStreamService.addNote...', {
        itemId: selectedItem.id,
        itemType: selectedType,
        note: newNote,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        referenceNumber
      });
      
      await ActivityStreamService.addNote(
        selectedItem.id,
        selectedType,
        newNote,
        currentUser.uid,
        currentUser.email || undefined,
        'personal', // Set default persona to 'personal'
        referenceNumber
      );
      
      console.log('Note added successfully');
      setNewNote('');
      setShowAddNote(false);
    } catch (error) {
      console.error('Error adding note:', error);
      alert('Failed to add note: ' + (error as Error).message);
    }
  };

  const getGoalForItem = () => {
    if (selectedType === 'goal') {
      return selectedItem as Goal;
    } else if (selectedType === 'story') {
      const story = selectedItem as Story;
      return goals.find(g => g.id === story.goalId);
    } else if (selectedType === 'task') {
      const task = selectedItem as Task;
      const story = stories.find(s => s.id === task.parentId && task.parentType === 'story');
      return story ? goals.find(g => g.id === story.goalId) : null;
    }
    return null;
  };

  const getStoryForTask = () => {
    if (selectedType === 'task') {
      const task = selectedItem as Task;
      return stories.find(s => s.id === task.parentId && task.parentType === 'story');
    }
    return null;
  };

  const goal = getGoalForItem();
  const story = selectedType === 'task' ? getStoryForTask() : (selectedType === 'story' ? selectedItem as Story : null);
  const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Not set';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const getThemeName = (themeValue: number): string => {
    const themeNames: { [key: number]: string } = {
      1: 'Health',
      2: 'Growth', 
      3: 'Wealth',
      4: 'Tribe',
      5: 'Home'
    };
    return themeNames[themeValue] || 'Home';
  };

  const generateReferenceNumber = () => {
    if (selectedType === 'goal') {
      const goalItem = selectedItem as Goal;
      const themeName = getThemeName(goalItem.theme);
      return `${themeName.substring(0, 2).toUpperCase()}-${goalItem.id.substring(0, 6).toUpperCase()}`;
    } else if (selectedType === 'story') {
      const storyItem = selectedItem as Story;
      const themeName = goal?.theme ? getThemeName(goal.theme) : 'Story';
      const goalPrefix = themeName.substring(0, 2).toUpperCase();
      return `${goalPrefix}-${storyItem.id.substring(0, 6).toUpperCase()}`;
    } else if (selectedType === 'task') {
      const taskItem = selectedItem as Task;
      const storyPrefix = story?.title ? story.title.substring(0, 2).toUpperCase() : 'TK';
      return `${storyPrefix}-${taskItem.id.substring(0, 6).toUpperCase()}`;
    }
    return 'N/A';
  };

  const sidebarWidth = isCollapsed ? '60px' : '400px';

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: sidebarWidth,
          height: '100vh',
          backgroundColor: theme.colors.surface,
          boxShadow: '-4px 0 8px rgba(0,0,0,0.1)',
          zIndex: 1000,
          transition: 'width 0.3s ease',
          overflow: 'hidden',
          borderLeft: `3px solid ${themeColor}`
        }}
      >
        {/* Collapse Toggle */}
        <div
          style={{
            position: 'absolute',
            left: '-15px',
            top: '50%',
            transform: 'translateY(-50%)',
            backgroundColor: themeColor,
            color: 'white',
            borderRadius: '50%',
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            zIndex: 1001
          }}
          onClick={toggleCollapse}
        >
          {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </div>

        {/* Collapsed View */}
        {isCollapsed && (
          <div style={{ padding: '20px 10px', textAlign: 'center' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                backgroundColor: themeColor,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px auto',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              {selectedType === 'goal' ? 'G' : selectedType === 'story' ? 'S' : 'T'}
            </div>
            <div style={{ fontSize: '10px', color: theme.colors.onSurface, transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>
              {selectedItem.title.substring(0, 15)}
            </div>
          </div>
        )}

        {/* Expanded View */}
        {!isCollapsed && (
          <>
            {/* Header */}
            <div
              style={{
                backgroundColor: themeColor,
                color: 'white',
                padding: '20px',
                borderBottom: `1px solid ${theme.colors.border}`
              }}
            >
              {/* Test Mode Indicator */}
              {isTestMode && (
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  backgroundColor: '#ff6b6b',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '12px',
                  fontSize: '10px',
                  fontWeight: '700',
                  letterSpacing: '0.5px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  zIndex: 1002
                }}>
                  {testModeLabel}
                </div>
              )}

              {/* Large Reference Number */}
              <div style={{
                marginBottom: '16px',
                textAlign: 'center',
                padding: '12px',
                backgroundColor: 'rgba(255,255,255,0.15)',
                borderRadius: '8px',
                border: '2px solid rgba(255,255,255,0.3)'
              }}>
                <div style={{ 
                  fontSize: '11px', 
                  opacity: 0.8, 
                  marginBottom: '4px',
                  letterSpacing: '0.5px'
                }}>
                  REFERENCE
                </div>
                <div style={{ 
                  fontSize: '24px', 
                  fontWeight: '900',
                  fontFamily: 'monospace',
                  letterSpacing: '2px',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                }}>
                  {generateReferenceNumber()}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                  {selectedType === 'goal' ? 'Goal Details' : selectedType === 'story' ? 'Story Details' : 'Task Details'}
                </h5>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: 'white', padding: '4px' }}
                    onClick={() => setShowAddNote(true)}
                    title="Add Note"
                  >
                    <MessageCircle size={16} />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: 'white', padding: '4px' }}
                    onClick={handleEdit}
                  >
                    <Edit3 size={16} />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: 'white', padding: '4px' }}
                    onClick={handleDelete}
                  >
                    <Trash2 size={16} />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: 'white', padding: '4px' }}
                    onClick={hideSidebar}
                  >
                    <X size={16} />
                  </Button>
                </div>
              </div>

              {/* Theme Inheritance Chain */}
              {goal && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <Target size={12} />
                  <span>{goal.title}</span>
                  {story && selectedType === 'task' && (
                    <>
                      <span>→</span>
                      <BookOpen size={12} />
                      <span>{story.title}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Content */}
            <div style={{ padding: '20px', maxHeight: 'calc(100vh - 160px)', overflow: 'auto' }}>
              {/* Title */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: theme.colors.onSurface, marginBottom: '6px', display: 'block' }}>
                  Title
                </label>
                {isEditing ? (
                  <Form.Control
                    type="text"
                    value={editForm.title || ''}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    style={{ fontSize: '16px', fontWeight: '600' }}
                  />
                ) : (
                  <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: theme.colors.onBackground }}>
                    {selectedItem.title}
                  </h4>
                )}
              </div>

              {/* Description */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: theme.colors.onSurface, marginBottom: '6px', display: 'block' }}>
                  Description
                </label>
                {isEditing ? (
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                ) : (
                  <p style={{ margin: 0, color: theme.colors.onSurface, lineHeight: '1.5' }}>
                    {selectedItem.description || 'No description provided'}
                  </p>
                )}
              </div>

              {/* Status and Priority */}
              <Row style={{ marginBottom: '20px' }}>
                <Col xs={6}>
                  <label style={{ fontSize: '14px', fontWeight: '500', color: theme.colors.onSurface, marginBottom: '6px', display: 'block' }}>
                    Status
                  </label>
                  {isEditing ? (
                    <Form.Select
                      value={editForm.status || ''}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    >
                      {selectedType === 'goal' && (
                        <>
                          <option value="new">New</option>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="done">Done</option>
                          <option value="dropped">Dropped</option>
                        </>
                      )}
                      {selectedType === 'story' && (
                        <>
                          <option value="backlog">Backlog</option>
                          <option value="active">Active</option>
                          <option value="done">Done</option>
                          <option value="defect">Defect</option>
                        </>
                      )}
                      {selectedType === 'task' && (
                        <>
                          <option value="todo">Todo</option>
                          <option value="planned">Planned</option>
                          <option value="in-progress">In Progress</option>
                          <option value="blocked">Blocked</option>
                          <option value="done">Done</option>
                        </>
                      )}
                    </Form.Select>
                  ) : (
                    <Badge 
                      bg={
                        selectedItem.status === 2 ? 'success' : 
                        selectedItem.status === 1 ? 'primary' : 
                        'secondary'
                      }
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      {selectedItem.status === 0 ? 'New/Backlog' : 
                       selectedItem.status === 1 ? 'Active/In Progress' : 
                       selectedItem.status === 2 ? 'Done/Complete' : 
                       selectedItem.status === 3 ? 'Blocked' : 
                       selectedItem.status === 4 ? 'Deferred' : 
                       'Unknown'}
                    </Badge>
                  )}
                </Col>
                <Col xs={6}>
                  <label style={{ fontSize: '14px', fontWeight: '500', color: theme.colors.onSurface, marginBottom: '6px', display: 'block' }}>
                    Priority
                  </label>
                  {isEditing ? (
                    <Form.Select
                      value={editForm.priority || ''}
                      onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    >
                      {selectedType === 'story' ? (
                        <>
                          <option value="P1">P1 - High</option>
                          <option value="P2">P2 - Medium</option>
                          <option value="P3">P3 - Low</option>
                        </>
                      ) : selectedType === 'task' ? (
                        <>
                          <option value="high">High</option>
                          <option value="med">Medium</option>
                          <option value="low">Low</option>
                        </>
                      ) : (
                        <>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </>
                      )}
                    </Form.Select>
                  ) : selectedItem.priority ? (
                    <Badge 
                      bg={
                        selectedItem.priority === 1 ? 'danger' :
                        selectedItem.priority === 2 ? 'warning' : 
                        'secondary'
                      }
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      {selectedItem.priority === 1 ? 'P1 - High' : 
                       selectedItem.priority === 2 ? 'P2 - Medium' : 
                       selectedItem.priority === 3 ? 'P3 - Low' : 
                       'Unknown'}
                    </Badge>
                  ) : (
                    <span style={{ color: theme.colors.onSurface }}>Not set</span>
                  )}
                </Col>
              </Row>

              {/* Type-specific fields */}
              {selectedType === 'goal' && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '14px', fontWeight: '500', color: theme.colors.onSurface, marginBottom: '6px', display: 'block' }}>
                    Theme
                  </label>
                  <Badge 
                    style={{ 
                      backgroundColor: themeColor, 
                      color: 'white',
                      fontSize: '12px',
                      padding: '6px 12px'
                    }}
                  >
                    {(selectedItem as Goal).theme}
                  </Badge>
                </div>
              )}

              {/* Metadata */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '20px', marginTop: '20px' }}>
                <h6 style={{ fontSize: '14px', fontWeight: '600', color: theme.colors.onSurface, marginBottom: '12px' }}>
                  Metadata
                </h6>
                
                <div style={{ fontSize: '13px', color: theme.colors.onSurface, lineHeight: '1.6' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>ID:</strong> <code style={{ fontSize: '11px' }}>{selectedItem.id}</code>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Created:</strong> {formatDate(selectedItem.createdAt)}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Updated:</strong> {formatDate(selectedItem.updatedAt)}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Owner:</strong> {selectedItem.ownerUid}
                  </div>
                </div>
              </div>

              {/* Activity Stream */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '20px', marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h6 style={{ fontSize: '14px', fontWeight: '600', color: theme.colors.onSurface, margin: 0 }}>
                    Activity Stream
                  </h6>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => setShowAddNote(true)}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  >
                    <Plus size={12} style={{ marginRight: '4px' }} />
                    Note
                  </Button>
                </div>
                
                <div style={{ 
                  maxHeight: '300px', 
                  overflow: 'auto',
                  backgroundColor: theme.colors.background,
                  borderRadius: '6px',
                  padding: '8px'
                }}>
                  {activities.length === 0 ? (
                    <div style={{ 
                      textAlign: 'center', 
                      color: theme.colors.onSurface, 
                      fontSize: '13px',
                      padding: '20px'
                    }}>
                      No activity yet
                    </div>
                  ) : (
                    <ListGroup variant="flush">
                      {activities.map((activity, index) => (
                        <ListGroup.Item 
                          key={activity.id || index}
                          style={{ 
                            border: 'none',
                            backgroundColor: 'transparent',
                            padding: '8px 0',
                            borderBottom: index < activities.length - 1 ? '1px solid #e5e7eb' : 'none'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <span style={{ fontSize: '16px', marginTop: '2px' }}>
                              {ActivityStreamService.formatActivityIcon(activity.activityType)}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '13px', color: theme.colors.onSurface, lineHeight: '1.4' }}>
                                {activity.description}
                              </div>
                              {activity.noteContent && (
                                <div style={{ 
                                  fontSize: '12px', 
                                  color: theme.colors.onSurface, 
                                  fontStyle: 'italic',
                                  marginTop: '4px',
                                  padding: '6px',
                                  backgroundColor: theme.colors.surface,
                                  borderRadius: '4px',
                                  border: `1px solid ${theme.colors.border}`
                                }}>
                                  "{activity.noteContent}"
                                </div>
                              )}
                              <div style={{ fontSize: '11px', color: theme.colors.onSurface, marginTop: '4px' }}>
                                {ActivityStreamService.formatTimestamp(activity.timestamp)}
                                {activity.userEmail && ` • ${activity.userEmail.split('@')[0]}`}
                              </div>
                            </div>
                          </div>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  )}
                </div>
              </div>

              {/* Save Button */}
              {isEditing && (
                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Button variant="primary" onClick={handleSave} style={{ flex: 1 }}>
                      <Save size={16} style={{ marginRight: '6px' }} />
                      Save Changes
                    </Button>
                    <Button variant="outline-secondary" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this {selectedType}? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Add Note Modal */}
      <Modal show={showAddNote} onHide={() => setShowAddNote(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add Note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Note</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Enter your note here..."
              style={{ resize: 'vertical' }}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddNote(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleAddNote}
            disabled={!newNote.trim()}
          >
            Add Note
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default GlobalSidebar;

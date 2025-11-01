import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Badge, 
  Dropdown, 
  Form, 
  Modal, 
  InputGroup,
  OverlayTrigger,
  Tooltip,
  Card
} from 'react-bootstrap';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Play, 
  Square, 
  RotateCcw, 
  Calendar,
  Target,
  Clock,
  CheckCircle,
  AlertTriangle,
  Users
} from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { usePersona } from '../contexts/PersonaContext';
import { Sprint, Story, Task } from '../types';
import { generateRef } from '../utils/referenceGenerator';
import { isStatus, getStatusName } from '../utils/statusHelpers';

// Sprint status helpers with null checking
const getSprintStatusLabel = (status: number | undefined): string => {
  switch (status) {
    case 0: return 'Planning';
    case 1: return 'Active';
    case 2: return 'Complete';
    case 3: return 'Cancelled';
    default: return 'Unknown';
  }
};

const getSprintStatusVariant = (status: number | undefined): string => {
  switch (status) {
    case 0: return 'secondary'; // Planning
    case 1: return 'primary';   // Active
    case 2: return 'success';   // Complete
    case 3: return 'danger';    // Cancelled
    default: return 'secondary';
  }
};

interface ModernSprintsTableProps {
  selectedSprintId?: string;
  onSprintSelect?: (sprintId: string) => void;
  onSprintChange?: (sprint: Sprint) => void;
}

const ModernSprintsTable: React.FC<ModernSprintsTableProps> = ({
  selectedSprintId,
  onSprintSelect,
  onSprintChange
}) => {
  const { currentUser } = useAuth();
  const { sprints, loading } = useSprint();
  const { currentPersona } = usePersona();
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('');
  const [formData, setFormData] = useState({
    name: '',
    objective: '',
    startDate: '',
    endDate: '',
    status: '0'
  });

  // Load stories for metrics
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const storyData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        setStories(storyData);
      },
      (err) => {
        console.warn('ModernSprintsTable: stories subscription error', err?.code || err?.message || err);
        setStories([]);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // Load tasks for metrics
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const taskData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setTasks(taskData);
      },
      (err) => {
        console.warn('ModernSprintsTable: tasks subscription error', err?.code || err?.message || err);
        setTasks([]);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  const handleCreateSprint = async () => {
    if (!currentUser) return;

    try {
      const existingRefs = sprints.map(s => s.ref);
      const statusNumber = parseInt(formData.status, 10);
      const startDateMs = formData.startDate ? new Date(formData.startDate).getTime() : Date.now();
      const endDateMs = formData.endDate ? new Date(formData.endDate).getTime() : startDateMs;

      const sprintData = {
        name: formData.name.trim(),
        objective: formData.objective.trim(),
        startDate: startDateMs,
        endDate: endDateMs,
        status: Number.isFinite(statusNumber) ? statusNumber : 0,
        ref: generateRef('sprint', existingRefs),
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser.email,
        points: 0,
        velocity: 0
      };

      await addDoc(collection(db, 'sprints'), sprintData);
      setShowModal(false);
      resetForm();
    } catch (error) {
      console.error('Error creating sprint:', error);
    }
  };

  const handleUpdateSprint = async () => {
    if (!editingSprint || !currentUser) return;

    try {
      const statusNumber = parseInt(formData.status, 10);
      const startDateMs = formData.startDate ? new Date(formData.startDate).getTime() : editingSprint.startDate;
      const endDateMs = formData.endDate ? new Date(formData.endDate).getTime() : editingSprint.endDate;

      await updateDoc(doc(db, 'sprints', editingSprint.id), {
        name: formData.name.trim(),
        objective: formData.objective.trim(),
        startDate: startDateMs,
        endDate: endDateMs,
        status: Number.isFinite(statusNumber) ? statusNumber : editingSprint.status,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.email
      });
      setShowModal(false);
      setEditingSprint(null);
      resetForm();
    } catch (error) {
      console.error('Error updating sprint:', error);
    }
  };

    const handleDelete = async (sprint: Sprint) => {
    if (window.confirm(`Are you sure you want to delete sprint "${sprint.name}"? This action cannot be undone.`)) {
      try {
        await deleteDoc(doc(db, 'sprints', sprint.id));
        setMessage('Sprint deleted successfully!');
        setMessageType('success');
        setTimeout(() => setMessage(''), 3000);
      } catch (error) {
        console.error('Error deleting sprint:', error);
        setMessage('Error deleting sprint. Please try again.');
        setMessageType('error');
        setTimeout(() => setMessage(''), 3000);
      }
    }
  };

  const handleStatusChange = async (sprintId: string, newStatus: number) => {
    if (!currentUser) return;

    try {
      await updateDoc(doc(db, 'sprints', sprintId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.email
      });
    } catch (error) {
      console.error('Error updating sprint status:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      objective: '',
      startDate: '',
      endDate: '',
      status: '0'
    });
  };

  const openEditModal = (sprint: Sprint) => {
    setEditingSprint(sprint);
    setFormData({
      name: sprint.name,
      objective: sprint.objective || '',
      startDate: new Date(sprint.startDate).toISOString().split('T')[0],
      endDate: new Date(sprint.endDate).toISOString().split('T')[0],
      status: (sprint.status !== undefined ? sprint.status : 0).toString()
    });
    setShowModal(true);
  };

  const openCreateModal = () => {
    setEditingSprint(null);
    resetForm();
    setShowModal(true);
  };

  const getSprintMetrics = (sprint: Sprint) => {
    const sprintStories = stories.filter(story => story.sprintId === sprint.id);
    const sprintTasks = tasks.filter(task => {
      if (task.parentType === 'story' && task.parentId) {
        return sprintStories.some(story => story.id === task.parentId);
      }
      return false;
    });

    const completedStories = sprintStories.filter(story => story.status === 4).length;
    const completedTasks = sprintTasks.filter(task => task.status === 2).length;
    const totalPoints = sprintStories.reduce((sum, story) => sum + (story.points || 0), 0);
    const completedPoints = sprintStories
      .filter(story => story.status === 4)
      .reduce((sum, story) => sum + (story.points || 0), 0);

    return {
      totalStories: sprintStories.length,
      completedStories,
      totalTasks: sprintTasks.length,
      completedTasks,
      totalPoints,
      completedPoints,
      progress: sprintStories.length > 0 ? Math.round((completedStories / sprintStories.length) * 100) : 0
    };
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'planned': return 'info';
      case 'completed': return 'primary';
      case 'cancelled': return 'danger';
      default: return 'secondary';
    }
  };

  const getDaysInfo = (sprint: Sprint) => {
    const now = new Date();
    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);
    
    if (now < startDate) {
      const daysUntilStart = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { text: `Starts in ${daysUntilStart}d`, variant: 'info' };
    } else if (now > endDate) {
      const daysOverdue = Math.ceil((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      return { text: `Ended ${daysOverdue}d ago`, variant: 'secondary' };
    } else {
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { 
        text: `${daysLeft}d left`, 
        variant: daysLeft > 7 ? 'success' : daysLeft > 3 ? 'warning' : 'danger' 
      };
    }
  };

  if (loading) {
    return <div className="text-center p-4">Loading sprints...</div>;
  }

  return (
    <>
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Sprint Management</h5>
          <Button variant="primary" onClick={openCreateModal}>
            <Plus size={16} className="me-1" />
            New Sprint
          </Button>
        </Card.Header>
        <Card.Body className="p-0">
          {sprints.length === 0 ? (
            <div className="text-center p-5">
              <Target size={48} className="text-muted mb-3" />
              <h6 className="text-muted">No sprints found</h6>
              <p className="text-muted mb-3">Create your first sprint to get started</p>
              <Button variant="primary" onClick={openCreateModal}>
                <Plus size={16} className="me-1" />
                Create Sprint
              </Button>
            </div>
          ) : (
            <Table responsive hover className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>Sprint</th>
                  <th>Status</th>
                  <th>Timeline</th>
                  <th>Progress</th>
                  <th>Stories</th>
                  <th>Tasks</th>
                  <th>Points</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sprints.map((sprint) => {
                  const metrics = getSprintMetrics(sprint);
                  const daysInfo = getDaysInfo(sprint);
                  const isSelected = selectedSprintId === sprint.id;

                  return (
                    <tr 
                      key={sprint.id}
                      className={isSelected ? 'table-active' : ''}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSprintSelect?.(sprint.id)}
                    >
                      <td>
                        <div>
                          <strong className="d-block">{sprint.name}</strong>
                          <small className="text-muted">{sprint.ref}</small>
                          {sprint.objective && (
                            <div className="text-muted small mt-1">
                              {sprint.objective.length > 50 
                                ? `${sprint.objective.substring(0, 50)}...` 
                                : sprint.objective
                              }
                            </div>
                          )}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Dropdown>
                          <Dropdown.Toggle 
                            as={Badge} 
                            bg={getSprintStatusVariant(sprint.status)}
                            style={{ cursor: 'pointer' }}
                          >
                            {getSprintStatusLabel(sprint.status)}
                          </Dropdown.Toggle>
                          <Dropdown.Menu>
                            <Dropdown.Item onClick={() => handleStatusChange(sprint.id, 0)}>
                              <Calendar size={14} className="me-2" />
                              Planning
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => handleStatusChange(sprint.id, 1)}>
                              <Play size={14} className="me-2" />
                              Active
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => handleStatusChange(sprint.id, 2)}>
                              <CheckCircle size={14} className="me-2" />
                              Complete
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => handleStatusChange(sprint.id, 3)}>
                              <AlertTriangle size={14} className="me-2" />
                              Cancelled
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                      <td>
                        <div>
                          <Badge bg={daysInfo.variant} className="d-block mb-1">
                            <Clock size={12} className="me-1" />
                            {daysInfo.text}
                          </Badge>
                          <small className="text-muted">
                            {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div>
                          <div className="d-flex align-items-center mb-1">
                            <span className="me-2">{metrics.progress}%</span>
                          </div>
                          <div className="progress" style={{ height: '6px' }}>
                            <div 
                              className={`progress-bar bg-${metrics.progress >= 80 ? 'success' : metrics.progress >= 50 ? 'info' : 'warning'}`}
                              style={{ width: `${metrics.progress}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>{metrics.completedStories} completed, {metrics.totalStories - metrics.completedStories} remaining</Tooltip>}
                        >
                          <Badge bg="outline-primary">
                            {metrics.completedStories}/{metrics.totalStories}
                          </Badge>
                        </OverlayTrigger>
                      </td>
                      <td>
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>{metrics.completedTasks} completed, {metrics.totalTasks - metrics.completedTasks} remaining</Tooltip>}
                        >
                          <Badge bg="outline-info">
                            {metrics.completedTasks}/{metrics.totalTasks}
                          </Badge>
                        </OverlayTrigger>
                      </td>
                      <td>
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>{metrics.completedPoints} completed, {metrics.totalPoints - metrics.completedPoints} remaining</Tooltip>}
                        >
                          <Badge bg="outline-success">
                            {metrics.completedPoints}/{metrics.totalPoints}
                          </Badge>
                        </OverlayTrigger>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="d-flex gap-1">
                          <OverlayTrigger placement="top" overlay={<Tooltip>Edit Sprint</Tooltip>}>
                            <Button 
                              size="sm" 
                              variant="outline-primary"
                              onClick={() => openEditModal(sprint)}
                            >
                              <Edit size={14} />
                            </Button>
                          </OverlayTrigger>
                          <OverlayTrigger placement="top" overlay={<Tooltip>Delete Sprint</Tooltip>}>
                            <Button 
                              size="sm" 
                              variant="outline-danger"
                              onClick={() => handleDelete(sprint)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </OverlayTrigger>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Create/Edit Sprint Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {editingSprint ? 'Edit Sprint' : 'Create New Sprint'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Sprint Name *</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter sprint name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Objective</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="What are the main goals for this sprint?"
                value={formData.objective}
                onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
              />
            </Form.Group>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>Start Date *</Form.Label>
                  <Form.Control
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    required
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>End Date *</Form.Label>
                  <Form.Control
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    required
                  />
                </Form.Group>
              </div>
            </div>

            <Form.Group className="mb-3">
              <Form.Label>Status</Form.Label>
              <Form.Select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="0">Planning</option>
                <option value="1">Active</option>
                <option value="2">Complete</option>
                <option value="3">Cancelled</option>
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={editingSprint ? handleUpdateSprint : handleCreateSprint}
            disabled={!formData.name || !formData.startDate || !formData.endDate}
          >
            {editingSprint ? 'Update Sprint' : 'Create Sprint'}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default ModernSprintsTable;

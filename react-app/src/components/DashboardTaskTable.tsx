import React, { useState, useEffect } from 'react';
import { Card, Table, Badge, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Task } from '../types';
import { Edit2, Save, X, Calendar, Clock } from 'lucide-react';

interface DashboardTaskTableProps {
  maxTasks?: number;
  showDueToday?: boolean;
}

const DashboardTaskTable: React.FC<DashboardTaskTableProps> = ({ maxTasks = 10, showDueToday = false }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  useEffect(() => {
    if (!currentUser || !currentPersona) return;

    let unsubscribeTasks: (() => void) | undefined;

    try {
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );
      
      unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        
        let filteredTasks = tasksData.filter(task => !(task as any).deleted);

        if (showDueToday) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          filteredTasks = filteredTasks.filter(task => {
            if (!(task as any).dueDate) return false;
            const dueDate = new Date((task as any).dueDate);
            return dueDate >= today && dueDate < tomorrow;
          });
        }
        
        // Sort by priority and due date
        filteredTasks.sort((a, b) => {
          const priorityA = (a as any).priority || 0;
          const priorityB = (b as any).priority || 0;
          if (priorityA !== priorityB) return priorityB - priorityA;
          
          const dueDateA = (a as any).dueDate ? new Date((a as any).dueDate) : new Date('9999-12-31');
          const dueDateB = (b as any).dueDate ? new Date((b as any).dueDate) : new Date('9999-12-31');
          return dueDateA.getTime() - dueDateB.getTime();
        });
        
        setTasks(filteredTasks.slice(0, maxTasks));
      }, (error) => {
        console.error('Dashboard tasks subscription error:', error);
      });
    } catch (error) {
      console.error('Error setting up dashboard tasks subscription:', error);
    }

    return () => {
      try {
        unsubscribeTasks?.();
      } catch (error) {
        console.error('Error cleaning up dashboard tasks subscription:', error);
      }
    };
  }, [currentUser, currentPersona, maxTasks, showDueToday]);

  const handleEditStart = (task: Task) => {
    setEditingTask(task.id);
    setEditValues({
      title: task.title,
      status: (task as any).status || 0,
      priority: (task as any).priority || 0,
      progress: (task as any).progress || 0
    });
  };

  const handleEditSave = async (taskId: string) => {
    if (!editValues) return;

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        ...editValues,
        updatedAt: new Date()
      });
      setEditingTask(null);
      setEditValues({});
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleEditCancel = () => {
    setEditingTask(null);
    setEditValues({});
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <Badge bg="secondary">Not Started</Badge>;
      case 1: return <Badge bg="info">In Progress</Badge>;
      case 2: return <Badge bg="warning">Blocked</Badge>;
      case 3: return <Badge bg="success">Complete</Badge>;
      default: return <Badge bg="secondary">Unknown</Badge>;
    }
  };

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 3: return <Badge bg="orange">High</Badge>;
      case 2: return <Badge bg="warning">Medium</Badge>;
      case 1: return <Badge bg="info">Low</Badge>;
      default: return <Badge bg="secondary">None</Badge>;
    }
  };

  const formatDueDate = (dueDate: any) => {
    if (!dueDate) return null;
    const date = new Date(dueDate);
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return <span className="text-danger">Today</span>;
    if (diffDays === 1) return <span className="text-warning">Tomorrow</span>;
    if (diffDays < 0) return <span className="text-danger">Overdue</span>;
    if (diffDays <= 7) return <span className="text-warning">{diffDays} days</span>;
    
    return date.toLocaleDateString();
  };

  return (
    <Card className="h-100">
      <Card.Header>
        <h5 className="mb-0">
          {showDueToday ? 'Tasks Due Today' : 'Upcoming Tasks'}
        </h5>
      </Card.Header>
      <Card.Body className="p-0">
        {tasks.length === 0 ? (
          <div className="p-3 text-center text-muted">
            <Clock size={48} className="mb-2" />
            <div>No {showDueToday ? 'tasks due today' : 'upcoming tasks'}</div>
          </div>
        ) : (
          <Table hover responsive size="sm" className="mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ width: '30%' }}>Task</th>
                <th style={{ width: '15%' }}>Status</th>
                <th style={{ width: '15%' }}>Priority</th>
                <th style={{ width: '15%' }}>Progress</th>
                <th style={{ width: '15%' }}>Due Date</th>
                <th style={{ width: '10%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    {editingTask === task.id ? (
                      <Form.Control
                        size="sm"
                        value={editValues.title || ''}
                        onChange={(e) => setEditValues(prev => ({ ...prev, title: e.target.value }))}
                      />
                    ) : (
                      <div>
                        <div className="fw-bold" style={{ fontSize: '0.9rem' }}>
                          {(task as any).ref || task.id.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: '0.8rem' }}>{task.title}</div>
                      </div>
                    )}
                  </td>
                  <td>
                    {editingTask === task.id ? (
                      <Form.Select
                        size="sm"
                        value={editValues.status || 0}
                        onChange={(e) => setEditValues(prev => ({ ...prev, status: parseInt(e.target.value) }))}
                      >
                        <option value={0}>Not Started</option>
                        <option value={1}>In Progress</option>
                        <option value={2}>Blocked</option>
                        <option value={3}>Complete</option>
                      </Form.Select>
                    ) : (
                      getStatusBadge((task as any).status || 0)
                    )}
                  </td>
                  <td>
                    {editingTask === task.id ? (
                      <Form.Select
                        size="sm"
                        value={editValues.priority || 0}
                        onChange={(e) => setEditValues(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                      >
                        <option value={0}>None</option>
                        <option value={1}>Low</option>
                        <option value={2}>Medium</option>
                        <option value={3}>High</option>
                      </Form.Select>
                    ) : (
                      getPriorityBadge((task as any).priority || 0)
                    )}
                  </td>
                  <td>
                    {editingTask === task.id ? (
                      <InputGroup size="sm">
                        <Form.Control
                          type="number"
                          min="0"
                          max="100"
                          value={editValues.progress || 0}
                          onChange={(e) => setEditValues(prev => ({ ...prev, progress: parseInt(e.target.value) }))}
                        />
                        <InputGroup.Text>%</InputGroup.Text>
                      </InputGroup>
                    ) : (
                      <div>
                        <div style={{ fontSize: '0.8rem' }}>{(task as any).progress || 0}%</div>
                        <div className="progress" style={{ height: '4px' }}>
                          <div 
                            className="progress-bar" 
                            style={{ width: `${(task as any).progress || 0}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    <small>{formatDueDate((task as any).dueDate)}</small>
                  </td>
                  <td>
                    {editingTask === task.id ? (
                      <div className="d-flex gap-1">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handleEditSave(task.id)}
                        >
                          <Save size={12} />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleEditCancel}
                        >
                          <X size={12} />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => handleEditStart(task)}
                      >
                        <Edit2 size={12} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
};

export default DashboardTaskTable;

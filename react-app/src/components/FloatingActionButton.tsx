import React, { useState } from 'react';
import { Modal, Button, Form, Alert, ButtonGroup } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import '../styles/MaterialDesign.css';

interface FloatingActionButtonProps {
  onImportClick: () => void;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onImportClick }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showMenu, setShowMenu] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'goal' | 'story' | 'task'>('task');
  const [quickAddData, setQuickAddData] = useState({
    title: '',
    description: '',
    theme: 'Growth',
    effort: 'M',
    priority: 'med'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  const themes = ['Health', 'Growth', 'Wealth', 'Tribe', 'Home'];
  const efforts = [
    { value: 'S', label: 'Small (15-30 min)', minutes: 20 },
    { value: 'M', label: 'Medium (30-60 min)', minutes: 45 },
    { value: 'L', label: 'Large (1-2 hours)', minutes: 90 }
  ];

  const handleQuickAdd = async () => {
    if (!currentUser || !quickAddData.title.trim()) return;

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const baseData = {
        title: quickAddData.title.trim(),
        description: quickAddData.description.trim(),
        persona: currentPersona,
        ownerUid: currentUser.uid,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (quickAddType === 'goal') {
        await addDoc(collection(db, 'goals'), {
          ...baseData,
          theme: quickAddData.theme,
          size: 'M',
          timeToMasterHours: 40,
          confidence: 0.5,
          status: 'active',
          kpis: []
        });
      } else if (quickAddType === 'story') {
        await addDoc(collection(db, 'stories'), {
          ...baseData,
          goalId: '', // Will need to be linked later
          priority: quickAddData.priority,
          points: 3,
          status: 'backlog',
          orderIndex: 0,
          tags: [],
          acceptanceCriteria: []
        });
      } else if (quickAddType === 'task') {
        const effortData = efforts.find(e => e.value === quickAddData.effort);
        await addDoc(collection(db, 'tasks'), {
          ...baseData,
          parentType: 'story',
          parentId: '', // Will need to be linked later
          effort: quickAddData.effort,
          priority: quickAddData.priority,
          estimateMin: effortData?.minutes || 45,
          status: 'planned',
          theme: quickAddData.theme,
          hasGoal: false,
          alignedToGoal: false,
          source: 'web',
          syncState: 'clean',
          labels: [],
          checklist: []
        });
      }

      setSubmitResult(`✅ ${quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)} created successfully!`);
      setQuickAddData({ title: '', description: '', theme: 'Growth', effort: 'M', priority: 'med' });
      
      // Auto-close after success
      setTimeout(() => {
        setShowQuickAdd(false);
        setSubmitResult(null);
      }, 2000);

    } catch (error) {
      console.error('Quick add error:', error);
      setSubmitResult(`❌ Failed to create ${quickAddType}: ${error.message}`);
    }
    setIsSubmitting(false);
  };

  return (
    <>
      {/* FAB Menu Items */}
      {showMenu && (
        <div className="md-fab-menu">
          <button
            className="md-fab-mini"
            onClick={onImportClick}
            title="Import & Templates"
          >
            ↓
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setQuickAddType('goal');
              setShowQuickAdd(true);
              setShowMenu(false);
            }}
            title="Add Goal"
          >
            G
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setQuickAddType('story');
              setShowQuickAdd(true);
              setShowMenu(false);
            }}
            title="Add Story"
          >
            S
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setQuickAddType('task');
              setShowQuickAdd(true);
              setShowMenu(false);
            }}
            title="Add Task"
          >
            T
          </button>
        </div>
      )}

      {/* Main FAB */}
      <button
        className="md-fab"
        onClick={() => setShowMenu(!showMenu)}
        title="Add new item"
      >
        {showMenu ? '×' : '+'}
      </button>

      {/* Quick Add Modal */}
      <Modal show={showQuickAdd} onHide={() => setShowQuickAdd(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            Add New {quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                type="text"
                value={quickAddData.title}
                onChange={(e) => setQuickAddData({ ...quickAddData, title: e.target.value })}
                placeholder={`Enter ${quickAddType} title...`}
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={quickAddData.description}
                onChange={(e) => setQuickAddData({ ...quickAddData, description: e.target.value })}
                placeholder={`Describe this ${quickAddType}...`}
              />
            </Form.Group>

            {(quickAddType === 'goal' || quickAddType === 'task') && (
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  value={quickAddData.theme}
                  onChange={(e) => setQuickAddData({ ...quickAddData, theme: e.target.value })}
                >
                  {themes.map(theme => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            {quickAddType === 'task' && (
              <Form.Group className="mb-3">
                <Form.Label>Effort</Form.Label>
                <Form.Select
                  value={quickAddData.effort}
                  onChange={(e) => setQuickAddData({ ...quickAddData, effort: e.target.value })}
                >
                  {efforts.map(effort => (
                    <option key={effort.value} value={effort.value}>
                      {effort.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            {(quickAddType === 'story' || quickAddType === 'task') && (
              <Form.Group className="mb-3">
                <Form.Label>Priority</Form.Label>
                <Form.Select
                  value={quickAddData.priority}
                  onChange={(e) => setQuickAddData({ ...quickAddData, priority: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="med">Medium</option>
                  <option value="high">High</option>
                </Form.Select>
              </Form.Group>
            )}
          </Form>

          {submitResult && (
            <Alert variant={submitResult.includes('✅') ? 'success' : 'danger'}>
              {submitResult}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowQuickAdd(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleQuickAdd}
            disabled={isSubmitting || !quickAddData.title.trim()}
          >
            {isSubmitting ? 'Creating...' : `Create ${quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)}`}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default FloatingActionButton;

import React, { useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { generateRef } from '../utils/referenceGenerator';

interface AddGoalModalProps {
  onClose: () => void;
  show: boolean;
}

const AddGoalModal: React.FC<AddGoalModalProps> = ({ onClose, show }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    theme: 'Growth',
    size: 'M',
    timeToMasterHours: 40,
    confidence: 0.5,
    targetDate: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  const themes = ['Health', 'Growth', 'Wealth', 'Tribe', 'Home'];
  const sizes = [
    { value: 'XS', label: 'XS - Quick (1-10 hours)', hours: 5 },
    { value: 'S', label: 'S - Small (10-40 hours)', hours: 25 },
    { value: 'M', label: 'M - Medium (40-100 hours)', hours: 70 },
    { value: 'L', label: 'L - Large (100-250 hours)', hours: 175 },
    { value: 'XL', label: 'XL - Epic (250+ hours)', hours: 400 }
  ];

  const handleSubmit = async () => {
    if (!currentUser || !formData.title.trim()) return;
    if (currentPersona !== 'personal') {
      setSubmitResult('❌ Goals are only available for Personal persona');
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      console.log('🚀 AddGoalModal: Starting GOAL creation', {
        action: 'goal_creation_start',
        user: currentUser.uid,
        persona: currentPersona,
        title: formData.title.trim(),
        theme: formData.theme,
        size: formData.size,
        timestamp: new Date().toISOString()
      });

      // Get existing goal references for unique ref generation
      const existingGoalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid)
      );
      const existingSnapshot = await getDocs(existingGoalsQuery);
      const existingRefs = existingSnapshot.docs
        .map(doc => doc.data().ref)
        .filter(ref => ref);
      
      // Generate unique reference number
      const ref = generateRef('goal', existingRefs);
      console.log('🏷️ AddGoalModal: Generated reference', {
        action: 'reference_generated',
        ref: ref,
        timestamp: new Date().toISOString()
      });
      
      const selectedSize = sizes.find(s => s.value === formData.size);
      
      const goalData = {
        ref: ref, // Add reference number
        title: formData.title.trim(),
        description: formData.description.trim(),
        theme: formData.theme,
        size: formData.size,
        timeToMasterHours: selectedSize?.hours || formData.timeToMasterHours,
        confidence: formData.confidence,
        targetDate: formData.targetDate ? new Date(formData.targetDate) : null,
        status: 'Not Started',
        persona: 'personal',
        ownerUid: currentUser.uid, // Ensure ownerUid is included
        kpis: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      console.log('💾 AddGoalModal: Saving GOAL to database', {
        action: 'goal_save_start',
        data: goalData,
        timestamp: new Date().toISOString()
      });

      await addDoc(collection(db, 'goals'), goalData);
      
      console.log('✅ AddGoalModal: GOAL created successfully', {
        action: 'goal_creation_success',
        ref: ref,
        goalId: 'pending_from_firestore',
        timestamp: new Date().toISOString()
      });

      setSubmitResult(`✅ Goal created successfully! (${ref})`);
      setFormData({
        title: '',
        description: '',
        theme: 'Growth',
        size: 'M',
        timeToMasterHours: 40,
        confidence: 0.5,
        targetDate: ''
      });
      
      // Auto-close after success
      setTimeout(() => {
        onClose();
        setSubmitResult(null);
      }, 1500);

    } catch (error) {
      console.error('❌ AddGoalModal: GOAL creation failed', {
        action: 'goal_creation_error',
        error: error.message,
        formData: formData,
        timestamp: new Date().toISOString()
      });
      setSubmitResult(`❌ Failed to create goal: ${error.message}`);
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setFormData({
      title: '',
      description: '',
      theme: 'Growth',
      size: 'M',
      timeToMasterHours: 40,
      confidence: 0.5,
      targetDate: ''
    });
    setSubmitResult(null);
    onClose();
  };

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Add New Goal</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {currentPersona !== 'personal' && (
          <Alert variant="warning">
            Goals are only available for the Personal persona. Switch to Personal to create goals.
          </Alert>
        )}
        
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Title *</Form.Label>
            <Form.Control
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter goal title..."
              autoFocus
              disabled={currentPersona !== 'personal'}
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Description</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe this goal in detail..."
              disabled={currentPersona !== 'personal'}
            />
          </Form.Group>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  value={formData.theme}
                  onChange={(e) => setFormData({ ...formData, theme: e.target.value })}
                  disabled={currentPersona !== 'personal'}
                >
                  {themes.map(theme => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Size</Form.Label>
                <Form.Select
                  value={formData.size}
                  onChange={(e) => {
                    const size = e.target.value;
                    const sizeData = sizes.find(s => s.value === size);
                    setFormData({ 
                      ...formData, 
                      size, 
                      timeToMasterHours: sizeData?.hours || 40 
                    });
                  }}
                  disabled={currentPersona !== 'personal'}
                >
                  {sizes.map(size => (
                    <option key={size.value} value={size.value}>{size.label}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Confidence Level</Form.Label>
                <Form.Range
                  value={formData.confidence}
                  onChange={(e) => setFormData({ ...formData, confidence: parseFloat(e.target.value) })}
                  min={0}
                  max={1}
                  step={0.1}
                  disabled={currentPersona !== 'personal'}
                />
                <Form.Text className="text-muted">
                  {Math.round(formData.confidence * 100)}% - How confident are you about achieving this?
                </Form.Text>
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Target Date (Optional)</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.targetDate}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                  disabled={currentPersona !== 'personal'}
                />
              </Form.Group>
            </div>
          </div>

          <Form.Group className="mb-3">
            <Form.Label>Estimated Hours to Master</Form.Label>
            <Form.Control
              type="number"
              value={formData.timeToMasterHours}
              onChange={(e) => setFormData({ ...formData, timeToMasterHours: parseInt(e.target.value) })}
              min={1}
              max={1000}
              disabled={currentPersona !== 'personal'}
            />
            <Form.Text className="text-muted">
              Total time you expect to invest in this goal
            </Form.Text>
          </Form.Group>
        </Form>

        {submitResult && (
          <Alert variant={submitResult.includes('✅') ? 'success' : 'danger'}>
            {submitResult}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={isSubmitting || !formData.title.trim() || currentPersona !== 'personal'}
        >
          {isSubmitting ? 'Creating...' : 'Create Goal'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AddGoalModal;

export {};

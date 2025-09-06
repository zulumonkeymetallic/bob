import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Goal } from '../types';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { useTheme } from '../contexts/ModernThemeContext';
import { GLOBAL_THEMES, getThemeById, migrateThemeValue } from '../constants/globalThemes';

interface EditGoalModalProps {
  goal: Goal | null;
  onClose: () => void;
  show: boolean;
  currentUserId: string;
}

const EditGoalModal: React.FC<EditGoalModalProps> = ({ goal, onClose, show, currentUserId }) => {
  const { theme } = useTheme();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    theme: 1, // Default to Health & Fitness theme ID
    size: 'M',
    timeToMasterHours: 40,
    confidence: 0.5,
    startDate: '',
    targetDate: '',
    status: 'New',
    priority: 2,
    kpis: [] as Array<{name: string; target: number; unit: string}>
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  const themes = GLOBAL_THEMES;
  const sizes = [
    { value: 'XS', label: 'XS - Quick (1-10 hours)', hours: 5 },
    { value: 'S', label: 'S - Small (10-40 hours)', hours: 25 },
    { value: 'M', label: 'M - Medium (40-100 hours)', hours: 70 },
    { value: 'L', label: 'L - Large (100-250 hours)', hours: 175 },
    { value: 'XL', label: 'XL - Epic (250+ hours)', hours: 400 }
  ];
  const statuses = ['New', 'Work in Progress', 'Complete', 'Blocked', 'Deferred'];
  const priorities = [
    { value: 1, label: 'High Priority (1)' },
    { value: 2, label: 'Medium Priority (2)' },
    { value: 3, label: 'Low Priority (3)' }
  ];

  // Load goal data when modal opens
  useEffect(() => {
    if (goal && show) {
      // Map database values back to form values
      const sizeMap = { 1: 'XS', 2: 'S', 3: 'M', 4: 'L', 5: 'XL' };
      const statusMap = { 0: 'New', 1: 'Work in Progress', 2: 'Complete', 3: 'Blocked', 4: 'Deferred' };
      
      setFormData({
        title: goal.title || '',
        description: goal.description || '',
        theme: migrateThemeValue(goal.theme) || 1, // Migrate and default to Health & Fitness
        size: sizeMap[goal.size as keyof typeof sizeMap] || 'M',
        timeToMasterHours: goal.timeToMasterHours || 40,
        confidence: goal.confidence || 0.5,
        startDate: goal.startDate ? (typeof goal.startDate === 'string' ? goal.startDate : '') : '',
        targetDate: goal.targetDate ? (typeof goal.targetDate === 'string' ? goal.targetDate : '') : '',
        status: statusMap[goal.status as keyof typeof statusMap] || 'New',
        priority: goal.priority || 2,
        kpis: goal.kpis || []
      });
    }
  }, [goal, show]);

  // KPI Management functions
  const addKPI = () => {
    setFormData({
      ...formData,
      kpis: [...formData.kpis, { name: '', target: 1, unit: '' }]
    });
  };

  const removeKPI = (index: number) => {
    setFormData({
      ...formData,
      kpis: formData.kpis.filter((_, i) => i !== index)
    });
  };

  const updateKPI = (index: number, field: 'name' | 'target' | 'unit', value: string | number) => {
    const updatedKPIs = [...formData.kpis];
    updatedKPIs[index] = { ...updatedKPIs[index], [field]: value };
    setFormData({ ...formData, kpis: updatedKPIs });
  };

  const handleSubmit = async () => {
    if (!goal || !formData.title.trim()) return;

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      console.log('🚀 EditGoalModal: Starting GOAL update', {
        action: 'goal_update_start',
        goalId: goal.id,
        title: formData.title.trim(),
        timestamp: new Date().toISOString()
      });

      // Map form values back to database values
      const sizeMap = { 'XS': 1, 'S': 2, 'M': 3, 'L': 4, 'XL': 5 };
      const statusMap = { 'New': 0, 'Work in Progress': 1, 'Complete': 2, 'Blocked': 3, 'Deferred': 4 };
      
      const selectedSize = sizes.find(s => s.value === formData.size);
      
      const goalUpdates = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        theme: formData.theme, // Use theme ID directly
        size: sizeMap[formData.size as keyof typeof sizeMap] || 3,
        timeToMasterHours: selectedSize?.hours || formData.timeToMasterHours,
        confidence: formData.confidence,
        startDate: formData.startDate ? new Date(formData.startDate) : null,
        targetDate: formData.targetDate ? new Date(formData.targetDate) : null,
        status: statusMap[formData.status as keyof typeof statusMap] || 0,
        priority: formData.priority,
        kpis: formData.kpis,
        updatedAt: serverTimestamp()
      };

      console.log('💾 EditGoalModal: Updating GOAL in database', {
        action: 'goal_update_save',
        goalId: goal.id,
        updates: goalUpdates,
        timestamp: new Date().toISOString()
      });

      await updateDoc(doc(db, 'goals', goal.id), goalUpdates);

      console.log('✅ EditGoalModal: GOAL updated successfully', {
        action: 'goal_update_success',
        goalId: goal.id,
        timestamp: new Date().toISOString()
      });

      setSubmitResult(`✅ Goal updated successfully!`);
      
      // Auto-close after success
      setTimeout(() => {
        onClose();
        setSubmitResult(null);
      }, 1500);

    } catch (error) {
      console.error('❌ EditGoalModal: GOAL update failed', {
        action: 'goal_update_error',
        error: error.message,
        goalId: goal.id,
        timestamp: new Date().toISOString()
      });
      setSubmitResult(`❌ Failed to update goal: ${error.message}`);
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setSubmitResult(null);
    onClose();
  };

  if (!goal) return null;

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header 
        closeButton
        style={{ 
          backgroundColor: theme.colors.surface, 
          color: theme.colors.onSurface,
          borderBottom: `1px solid ${theme.colors.border}`
        }}
      >
        <Modal.Title>Edit Goal: {goal.title}</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ backgroundColor: theme.colors.background, color: theme.colors.onBackground }}>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label style={{ color: theme.colors.onBackground }}>Title *</Form.Label>
            <Form.Control
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter goal title..."
              autoFocus
              style={{
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                color: theme.colors.onSurface
              }}
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label style={{ color: theme.colors.onBackground }}>Description</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe this goal in detail..."
            />
          </Form.Group>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  value={formData.theme}
                  onChange={(e) => setFormData({ ...formData, theme: parseInt(e.target.value) })}
                >
                  {themes.map(theme => (
                    <option key={theme.id} value={theme.id}>{theme.label}</option>
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
                />
                <Form.Text className="text-muted">
                  {Math.round(formData.confidence * 100)}% - How confident are you about achieving this?
                </Form.Text>
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Start Date (Optional)</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Target Date (Optional)</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.targetDate}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                />
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Status</Form.Label>
                <Form.Select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  {statuses.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Priority</Form.Label>
                <Form.Select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                >
                  {priorities.map(priority => (
                    <option key={priority.value} value={priority.value}>{priority.label}</option>
                  ))}
                </Form.Select>
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
            />
            <Form.Text className="text-muted">
              Total time you expect to invest in this goal
            </Form.Text>
          </Form.Group>

          {/* KPIs Section */}
          <Form.Group className="mb-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <Form.Label>Key Performance Indicators (KPIs)</Form.Label>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={addKPI}
              >
                + Add KPI
              </Button>
            </div>
            {formData.kpis.map((kpi, index) => (
              <div key={index} className="border rounded p-3 mb-2">
                <div className="row">
                  <div className="col-md-4">
                    <Form.Control
                      type="text"
                      placeholder="KPI Name (e.g., Weight Lost)"
                      value={kpi.name}
                      onChange={(e) => updateKPI(index, 'name', e.target.value)}
                    />
                  </div>
                  <div className="col-md-3">
                    <Form.Control
                      type="number"
                      placeholder="Target"
                      value={kpi.target}
                      onChange={(e) => updateKPI(index, 'target', parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="col-md-3">
                    <Form.Control
                      type="text"
                      placeholder="Unit (e.g., lbs, books)"
                      value={kpi.unit}
                      onChange={(e) => updateKPI(index, 'unit', e.target.value)}
                    />
                  </div>
                  <div className="col-md-2">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => removeKPI(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Form.Text className="text-muted">
              Add measurable metrics to track progress toward this goal
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
          disabled={isSubmitting || !formData.title.trim()}
        >
          {isSubmitting ? 'Updating...' : 'Update Goal'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EditGoalModal;

import React, { useEffect, useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { generateRef } from '../utils/referenceGenerator';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { normalizeGoalCostType } from '../utils/goalCost';

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
    theme: 1, // Default to Health & Fitness (ID 1)
    size: 'M',
    timeToMasterHours: 40,
    confidence: 0.5,
    startDate: '',
    endDate: '',
    status: 'New',
    priority: 2,
    estimatedCost: '',
    costType: '',
    linkedPotId: '',
    kpis: [] as Array<{name: string; target: number; unit: string}>
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const { themes } = useGlobalThemes();
  const [themeInput, setThemeInput] = useState('');
  const [monzoPots, setMonzoPots] = useState<Array<{ id: string; name: string }>>([]);
  const [potSearch, setPotSearch] = useState('');

  useEffect(() => {
    const loadPots = async () => {
      if (!show || !currentUser) return;
      try {
        const q = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
        const snap = await getDocs(q);
        const list = snap.docs
          .map(d => ({
            id: (d.data() as any).potId || d.id,
            name: (d.data() as any).name || 'Pot',
            deleted: (d.data() as any).deleted,
            closed: (d.data() as any).closed,
            archived: (d.data() as any).archived,
            isArchived: (d.data() as any).isArchived,
          }))
          .filter(p => !p.deleted && !p.closed && !p.archived && !p.isArchived)
          .map(p => ({ id: String(p.id), name: String(p.name) }));
        setMonzoPots(list);
      } catch {
        setMonzoPots([]);
      }
    };
    loadPots();
  }, [show, currentUser]);

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

  // Legacy theme names to new theme IDs
  const sizes = [
    { value: 'XS', label: 'XS - Quick (1-10 hours)', hours: 5 },
    { value: 'S', label: 'S - Small (10-40 hours)', hours: 25 },
    { value: 'M', label: 'M - Medium (40-100 hours)', hours: 70 },
    { value: 'L', label: 'L - Large (100-250 hours)', hours: 175 },
    { value: 'XL', label: 'XL - Epic (250+ hours)', hours: 400 }
  ];
  const statuses = ['New', 'Work in Progress', 'Complete', 'Blocked', 'Deferred'];
  const priorities = [
    { value: 4, label: 'Critical' },
    { value: 3, label: 'High' },
    { value: 2, label: 'Medium' },
    { value: 1, label: 'Low' }
  ];

  const handleSubmit = async () => {
    if (!currentUser || !formData.title.trim()) return;

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
      const normalizedCostType = normalizeGoalCostType(formData.costType);
      const isNoCostGoal = normalizedCostType === 'none';
      const normalizedEstimatedCost = isNoCostGoal
        ? null
        : (formData.estimatedCost.trim() === '' ? null : Number(formData.estimatedCost));
      const normalizedPotId = isNoCostGoal ? null : (formData.linkedPotId || null);
      
      // Map theme names to numbers for database
      const sizeMap = { 'XS': 1, 'S': 2, 'M': 3, 'L': 4, 'XL': 5 };
      const statusMap = { 'New': 0, 'Work in Progress': 1, 'Complete': 2, 'Blocked': 3, 'Deferred': 4 };
      
      const goalData = {
        ref: ref, // Add reference number
        title: formData.title.trim(),
        description: formData.description.trim(),
        theme: formData.theme, // Use the theme ID directly
        size: sizeMap[formData.size as keyof typeof sizeMap] || 3,
        timeToMasterHours: selectedSize?.hours || formData.timeToMasterHours,
        confidence: formData.confidence,
        startDate: formData.startDate ? new Date(formData.startDate).getTime() : Date.now(),
        endDate: formData.endDate ? new Date(formData.endDate).getTime() : (Date.now() + 30*24*60*60*1000),
        status: statusMap[formData.status as keyof typeof statusMap] || 0,
        priority: formData.priority,
        estimatedCost: normalizedEstimatedCost,
        costType: normalizedCostType || null,
        linkedPotId: normalizedPotId,
        potId: normalizedPotId,
        kpis: formData.kpis,
        persona: currentPersona || 'personal',
        ownerUid: currentUser.uid, // Ensure ownerUid is included
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
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
        theme: 1, // Health & Fitness
        size: 'M',
        timeToMasterHours: 40,
        confidence: 0.5,
        startDate: '',
        endDate: '',
        status: 'New',
        priority: 2,
        estimatedCost: '',
        costType: '',
        linkedPotId: '',
        kpis: []
      });
      setPotSearch('');
      
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
      theme: 1, // Health & Fitness
      size: 'M',
      timeToMasterHours: 40,
      confidence: 0.5,
      startDate: '',
      endDate: '',
      status: 'New',
      priority: 2,
      estimatedCost: '',
      costType: '',
      linkedPotId: '',
      kpis: []
    });
      setPotSearch('');
      setSubmitResult(null);
      onClose();
    };

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Add New Goal</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Title *</Form.Label>
            <Form.Control
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter goal title..."
              autoFocus
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
            />
          </Form.Group>

          <div className="row">
            <div className="col-md-4">
              <Form.Group className="mb-3">
                <Form.Label>Cost Type</Form.Label>
                <Form.Select
                  value={formData.costType}
                  onChange={(e) => {
                    const nextCostType = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      costType: nextCostType,
                      estimatedCost: nextCostType === 'none' ? '' : prev.estimatedCost,
                      linkedPotId: nextCostType === 'none' ? '' : prev.linkedPotId,
                    }));
                    if (nextCostType === 'none') setPotSearch('');
                  }}
                >
                  <option value="">Not set</option>
                  <option value="none">None (no cost)</option>
                  <option value="one_off">One-off</option>
                  <option value="recurring">Recurring</option>
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-md-4">
              <Form.Group className="mb-3">
                <Form.Label>Estimated Cost (£)</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.estimatedCost}
                  onChange={(e) => setFormData({ ...formData, estimatedCost: e.target.value })}
                  placeholder="e.g. 1250"
                  disabled={formData.costType === 'none'}
                />
              </Form.Group>
            </div>
            <div className="col-md-4">
              <Form.Group className="mb-3">
                <Form.Label>Linked Pot (optional)</Form.Label>
                <Form.Control
                  list="add-goal-pot-options"
                  value={potSearch}
                  disabled={formData.costType === 'none'}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPotSearch(value);
                    const matched = monzoPots.find((pot) =>
                      pot.id.toLowerCase() === value.trim().toLowerCase() ||
                      pot.name.toLowerCase() === value.trim().toLowerCase()
                    );
                    setFormData((prev) => ({ ...prev, linkedPotId: matched?.id || '' }));
                  }}
                  onBlur={() => {
                    const value = potSearch.trim();
                    if (!value) {
                      setFormData((prev) => ({ ...prev, linkedPotId: '' }));
                      return;
                    }
                    const matched = monzoPots.find((pot) =>
                      pot.id.toLowerCase() === value.toLowerCase() ||
                      pot.name.toLowerCase() === value.toLowerCase()
                    );
                    if (matched) {
                      setFormData((prev) => ({ ...prev, linkedPotId: matched.id }));
                      setPotSearch(matched.name);
                    }
                  }}
                  placeholder={formData.costType === 'none' ? 'Disabled for no-cost goals' : 'Search pot by name...'}
                />
                <datalist id="add-goal-pot-options">
                  {monzoPots.map((pot) => (
                    <option key={`add-pot-name-${pot.id}`} value={pot.name} label={pot.id} />
                  ))}
                  {monzoPots.map((pot) => (
                    <option key={`add-pot-id-${pot.id}`} value={pot.id} />
                  ))}
                </datalist>
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Control
                  list="goal-theme-options"
                  value={themeInput || (themes.find(t => t.id === formData.theme)?.label) || ''}
                  onChange={(e) => setThemeInput(e.target.value)}
                  onBlur={() => {
                    const val = themeInput;
                    const match = themes.find(t => t.label === val || t.name === val || String(t.id) === val);
                    setFormData({ ...formData, theme: match ? match.id : (parseInt(val) || formData.theme) });
                  }}
                  placeholder="Search themes..."
                />
                <datalist id="goal-theme-options">
                  {themes.map(t => (
                    <option key={t.id} value={t.label} />
                  ))}
                </datalist>
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
            <div className="col-md-3">
              <Form.Group className="mb-3">
                <Form.Label>Start Date</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </Form.Group>
            </div>
            <div className="col-md-3">
              <Form.Group className="mb-3">
                <Form.Label>End Date</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Initial Status</Form.Label>
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
          {isSubmitting ? 'Creating...' : 'Create Goal'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AddGoalModal;

export {};

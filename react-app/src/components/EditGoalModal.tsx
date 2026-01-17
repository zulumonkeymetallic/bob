import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Form, Alert, InputGroup, Toast, ToastContainer } from 'react-bootstrap';
import { db } from '../firebase';
import { doc, updateDoc, serverTimestamp, collection, query, where, getDocs, orderBy, limit, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { Goal } from '../types';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { GLOBAL_THEMES, getThemeById, migrateThemeValue } from '../constants/globalThemes';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { toDate } from '../utils/firestoreAdapters';
import TagInput from './common/TagInput';

interface EditGoalModalProps {
  goal: Goal | null;
  onClose: () => void;
  show: boolean;
  currentUserId: string;
  allGoals?: Goal[];
}

const EditGoalModal: React.FC<EditGoalModalProps> = ({ goal, onClose, show, currentUserId, allGoals = [] }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    theme: 1, // Default to Health & Fitness theme ID
    size: 'M',
    timeToMasterHours: 40,
    confidence: 0.5,
    startDate: '',
    endDate: '',
    status: 'New',
    priority: 2,
    estimatedCost: '',
    kpis: [] as Array<{ name: string; target: number; unit: string }>,
    parentGoalId: '',
    linkedPotId: '',
    tags: [] as string[],
    autoCreatePot: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const { themes } = useGlobalThemes();
  const [themeInput, setThemeInput] = useState('');
  const resolveThemeId = useCallback((input: string, fallback: number) => {
    const trimmed = (input || '').trim();
    if (!trimmed) return fallback;
    const match = themes.find(t => t.label === trimmed || t.name === trimmed || String(t.id) === trimmed);
    if (match) return match.id;
    const numeric = Number.parseInt(trimmed, 10);
    return Number.isFinite(numeric) ? numeric : fallback;
  }, [themes]);
  const [parentSearch, setParentSearch] = useState('');
  const [monzoPots, setMonzoPots] = useState<Array<{ id: string; name: string }>>([]);
  const [recentActivity, setRecentActivity] = useState<Array<{ id: string; description?: string; activityType?: string; createdAt?: any }>>([]);
  const [monzoConnected, setMonzoConnected] = useState(false);
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

  const goalIndex = useMemo(() => {
    const map = new Map<string, Goal>();
    allGoals.forEach((g) => map.set(g.id, g));
    return map;
  }, [allGoals]);

  const wouldCreateCycle = useCallback((sourceId: string, targetId: string | null | undefined) => {
    if (!targetId) return false;
    if (sourceId === targetId) return true;
    const visited = new Set<string>();
    let currentId: string | null | undefined = targetId;
    while (currentId) {
      if (currentId === sourceId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      currentId = goalIndex.get(currentId)?.parentGoalId || null;
    }
    return false;
  }, [goalIndex]);

  const parentCandidates = useMemo(() => {
    if (!goal) return [] as Goal[];
    const persona = (goal as any)?.persona;
    return allGoals.filter((candidate) => {
      if (candidate.id === goal.id) return false;
      if (persona && (candidate as any)?.persona && (candidate as any)?.persona !== persona) return false;
      return !wouldCreateCycle(goal.id, candidate.id);
    });
  }, [allGoals, goal, wouldCreateCycle]);

  const filteredParentOptions = useMemo(() => {
    const query = parentSearch.trim().toLowerCase();
    if (!query) return parentCandidates;
    return parentCandidates.filter((candidate) => {
      const title = candidate.title || '';
      const ref = (candidate as any)?.ref || '';
      return title.toLowerCase().includes(query) || ref.toLowerCase().includes(query);
    });
  }, [parentCandidates, parentSearch]);

  // Load goal data when modal opens
  useEffect(() => {
    if (show) {
      if (goal) {
        // EDIT MODE: Map database values back to form values
        const sizeMap = { 1: 'XS', 2: 'S', 3: 'M', 4: 'L', 5: 'XL' };
        const statusMap = { 0: 'New', 1: 'Work in Progress', 2: 'Complete', 3: 'Blocked', 4: 'Deferred' };

        const startDateStr = (() => {
          const d = toDate((goal as any).startDate);
          return d ? d.toISOString().slice(0, 10) : '';
        })();
        const endDateStr = (() => {
          const d = toDate((goal as any).endDate);
          return d ? d.toISOString().slice(0, 10) : '';
        })();

        setFormData({
          title: goal.title || '',
          description: goal.description || '',
          theme: migrateThemeValue(goal.theme) || 1,
          size: sizeMap[goal.size as keyof typeof sizeMap] || 'M',
          timeToMasterHours: goal.timeToMasterHours || 40,
          confidence: goal.confidence || 0.5,
          startDate: startDateStr,
          endDate: endDateStr,
          status: statusMap[goal.status as keyof typeof statusMap] || 'New',
          priority: goal.priority || 2,
          estimatedCost: goal.estimatedCost != null ? String(goal.estimatedCost) : '',
          kpis: goal.kpis || [],
          parentGoalId: goal.parentGoalId || '',
          linkedPotId: (goal as any).linkedPotId || (goal as any).potId || '',
          tags: (goal as any).tags || [],
          autoCreatePot: !!(goal as any).autoCreatePot
        });
        const current = migrateThemeValue(goal.theme);
        const themeObj = themes.find(t => t.id === current);
        setThemeInput(themeObj?.label || '');
        setParentSearch('');
      } else {
        // CREATE MODE: Reset to defaults
        setFormData({
          title: '',
          description: '',
          theme: 1,
          size: 'M',
          timeToMasterHours: 40,
          confidence: 0.5,
          startDate: '',
          endDate: '',
          status: 'New',
          priority: 2,
          estimatedCost: '',
          kpis: [],
          parentGoalId: '',
          linkedPotId: '',
          tags: [],
          autoCreatePot: false
        });
        setThemeInput('');
        setParentSearch('');
      }
    }
  }, [goal, show, themes]);

  // Load user's Monzo pots for optional explicit mapping
  useEffect(() => {
    const loadPots = async () => {
      try {
        const q = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUserId));
        const snap = await getDocs(q);
        const list = snap.docs
          .map(d => ({ id: (d.data() as any).potId || d.id, name: (d.data() as any).name || 'Pot', deleted: (d.data() as any).deleted, closed: (d.data() as any).closed }))
          .filter(p => !p.deleted && !p.closed)
          .map(p => ({ id: p.id, name: p.name }));
        setMonzoPots(list);
      } catch { }
    };
    if (show && currentUserId) loadPots();
  }, [show, currentUserId]);

  // Check Monzo connection status to decide if pot auto-create can run
  useEffect(() => {
    const loadMonzoStatus = async () => {
      if (!show || !currentUserId) return;
      try {
        const snap = await getDoc(doc(db, 'integration_status', `monzo_${currentUserId}`));
        const data = snap.data() as any;
        setMonzoConnected(!!data?.connected);
      } catch {
        setMonzoConnected(false);
      }
    };
    loadMonzoStatus();
  }, [show, currentUserId]);

  // Load recent activity for this goal when modal is open
  useEffect(() => {
    if (!goal || !show) return;
    try {
      const qref = query(
        collection(db, 'activity_stream'),
        where('entityType', '==', 'goal'),
        where('entityId', '==', goal.id),
        orderBy('createdAt', 'desc'),
        limit(15)
      );
      const unsub = onSnapshot(qref, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setRecentActivity(list);
      });
      return () => unsub();
    } catch { }
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
    if (!formData.title.trim()) return;

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      // Map form values back to database values
      const sizeMap = { 'XS': 1, 'S': 2, 'M': 3, 'L': 4, 'XL': 5 };
      const statusMap = { 'New': 0, 'Work in Progress': 1, 'Complete': 2, 'Blocked': 3, 'Deferred': 4 };

      const selectedSize = sizes.find(s => s.value === formData.size);
      const themeId = resolveThemeId(themeInput, formData.theme);

      const goalData: any = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        theme: themeId,
        size: sizeMap[formData.size as keyof typeof sizeMap] || 3,
        timeToMasterHours: selectedSize?.hours || formData.timeToMasterHours,
        confidence: formData.confidence,
        startDate: formData.startDate ? new Date(formData.startDate).getTime() : null,
        endDate: formData.endDate ? new Date(formData.endDate).getTime() : null,
        status: statusMap[formData.status as keyof typeof statusMap] || 0,
        priority: formData.priority,
        kpis: formData.kpis,
        estimatedCost: formData.estimatedCost.trim() === '' ? null : Number(formData.estimatedCost),
        parentGoalId: formData.parentGoalId ? formData.parentGoalId : null,
        updatedAt: serverTimestamp(),
        tags: formData.tags,
        autoCreatePot: formData.autoCreatePot
      };

      // Read optional cost metadata and pot mapping from form elements
      const ct = (document.getElementById('goal-cost-type') as HTMLSelectElement | null)?.value || '';
      const rec = (document.getElementById('goal-recurrence') as HTMLSelectElement | null)?.value || '';
      const ty = (document.getElementById('goal-target-year') as HTMLInputElement | null)?.value || '';
      const potSel = (document.getElementById('goal-pot-id') as HTMLSelectElement | null)?.value || '';
      if (ct) goalData.costType = ct;
      else goalData.costType = null;
      if (rec) goalData.recurrence = rec;
      else goalData.recurrence = null;
      goalData.targetYear = ty ? Number(ty) : null;
      goalData.linkedPotId = formData.linkedPotId || null;
      // Backwards compatibility
      goalData.potId = formData.linkedPotId || null;
      const estimatedCostValue = formData.estimatedCost ? Number(formData.estimatedCost) : null;

      const maybeCreateVirtualPot = async (goalId: string | null): Promise<string | null> => {
        if (!goalId) return null;
        if (!formData.autoCreatePot) return null;
        if (!estimatedCostValue || Number.isNaN(estimatedCostValue)) return null;
        if (formData.linkedPotId) return null;
        if (!monzoConnected) {
          setToastMsg('Connect Monzo to auto-create a pot.');
          return null;
        }
        const potDocId = `${currentUserId}_goal_${goalId}`;
        await setDoc(doc(db, 'monzo_pots', potDocId), {
          ownerUid: currentUserId,
          potId: potDocId,
          name: `${goalId} -- ${formData.title || 'Goal pot'}`,
          balance: 0,
          currency: 'GBP',
          goalAmount: Math.round(estimatedCostValue * 100),
          goalCurrency: 'GBP',
          virtual: true,
          goalLinkedId: goalId,
          deleted: false,
          closed: false,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        return potDocId;
      };

      let goalIdForPot: string | null = goal?.id || null;

      if (goal) {
        // UPDATE existing goal
        console.log('🚀 EditGoalModal: Starting GOAL update', { goalId: goal.id });
        await updateDoc(doc(db, 'goals', goal.id), goalData);
        const createdPotId = await maybeCreateVirtualPot(goal.id);
        if (createdPotId) {
          await updateDoc(doc(db, 'goals', goal.id), { linkedPotId: createdPotId, potId: createdPotId });
        }
        setSubmitResult(`✅ Goal updated successfully!`);
        setToastMsg('Goal updated');
      } else {
        // CREATE new goal
        console.log('🚀 EditGoalModal: Creating NEW goal');
        goalData.createdAt = serverTimestamp();
        goalData.ownerUid = currentUserId;
        // Default persona if available, or fetch from context if passed (not available in props currently, assuming currentUserId context)
        // For now, we'll rely on the parent component to handle persona or add it here if needed.
        // Ideally, we should pass persona as a prop.
        // Adding a safe fallback or update later.

        await import('firebase/firestore').then(async ({ addDoc, collection }) => {
          const ref = await addDoc(collection(db, 'goals'), goalData);
          goalIdForPot = ref.id;
        });

        const createdPotId = await maybeCreateVirtualPot(goalIdForPot);
        if (createdPotId && goalIdForPot) {
          await updateDoc(doc(db, 'goals', goalIdForPot), { linkedPotId: createdPotId, potId: createdPotId });
          setFormData(prev => ({ ...prev, linkedPotId: createdPotId }));
        }
        setSubmitResult(`✅ Goal created successfully!`);
        setToastMsg('Goal created');
      }

      setFormData(prev => ({ ...prev, theme: themeId }));

      // Auto-close after success
      setTimeout(() => {
        onClose();
        setSubmitResult(null);
      }, 1500);

    } catch (error: any) {
      console.error('❌ EditGoalModal: Operation failed', error);
      setSubmitResult(`❌ Failed: ${error.message}`);
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setSubmitResult(null);
    onClose();
  };

  // if (!goal) return null; // Removed to allow create mode

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <ToastContainer position="bottom-end" className="p-3">
        <Toast bg="success" onClose={() => setToastMsg(null)} show={!!toastMsg} delay={1800} autohide>
          <Toast.Body className="text-white">{toastMsg}</Toast.Body>
        </Toast>
      </ToastContainer>
      <Modal.Header closeButton>
        <Modal.Title>{goal ? `Edit Goal: ${goal.title}` : 'Create New Goal'}</Modal.Title>
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
            <Form.Label>Estimated Cost (£)</Form.Label>
            <InputGroup>
              <InputGroup.Text>£</InputGroup.Text>
              <Form.Control
                type="number"
                min="0"
                step="0.01"
                value={formData.estimatedCost}
                onChange={(e) => setFormData({ ...formData, estimatedCost: e.target.value })}
                placeholder="e.g. 1250"
              />
            </InputGroup>
            <Form.Text className="text-muted">
              Used for finance projections and Monzo pot alignment.
            </Form.Text>
          </Form.Group>

          <div className="row">
            <div className="col-md-4">
              <Form.Group className="mb-3">
                <Form.Label>Cost Type</Form.Label>
                <Form.Select id="goal-cost-type" defaultValue={(goal as any)?.costType || ''}>
                  <option value="">Not set</option>
                  <option value="one_off">One-off</option>
                  <option value="recurring">Recurring</option>
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-md-4">
              <Form.Group className="mb-3">
                <Form.Label>Recurrence</Form.Label>
                <Form.Select id="goal-recurrence" defaultValue={(goal as any)?.recurrence || ''}>
                  <option value="">Not set</option>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-md-4">
              <Form.Group className="mb-3">
                <Form.Label>Target Year</Form.Label>
                <Form.Control id="goal-target-year" type="number" min="2024" step="1" defaultValue={(goal as any)?.targetYear || ''} placeholder="e.g., 2026" />
              </Form.Group>
            </div>
          </div>

          <Form.Group className="mb-3">
            <Form.Label>Link Monzo Pot (optional)</Form.Label>
            <Form.Select
              value={formData.linkedPotId}
              onChange={(e) => setFormData({ ...formData, linkedPotId: e.target.value })}
            >
              <option value="">No pot linked</option>
              {monzoPots.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">If set, analytics will use this pot rather than name matching.</Form.Text>
          </Form.Group>
          <Form.Check
            className="mb-3"
            type="checkbox"
            label="Auto-create a Monzo pot for this goal (target = estimated cost)"
            checked={formData.autoCreatePot}
            onChange={(e) => setFormData({ ...formData, autoCreatePot: e.target.checked })}
          />

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

          <Form.Group className="mb-3">
            <Form.Label>Tags</Form.Label>
            <TagInput
              value={formData.tags}
              onChange={(tags) => setFormData({ ...formData, tags })}
              placeholder="Add tags..."
            />
          </Form.Group>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Control
                  list="edit-goal-theme-options"
                  value={themeInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setThemeInput(value);
                    setFormData(prev => ({
                      ...prev,
                      theme: resolveThemeId(value, prev.theme)
                    }));
                  }}
                  onBlur={() => {
                    setThemeInput(prevInput => {
                      let nextLabel = prevInput;
                      setFormData(prev => {
                        const nextThemeId = resolveThemeId(prevInput, prev.theme);
                        const match = themes.find(t => t.id === nextThemeId);
                        nextLabel = match?.label ?? prevInput;
                        return { ...prev, theme: nextThemeId };
                      });
                      return nextLabel;
                    });
                  }}
                  placeholder="Search themes..."
                />
                <datalist id="edit-goal-theme-options">
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
            <div className="col-md-12">
              <Form.Group className="mb-3">
                <Form.Label>Parent Goal</Form.Label>
                <Form.Control
                  type="text"
                  size="sm"
                  placeholder="Search parent goals..."
                  value={parentSearch}
                  onChange={(e) => setParentSearch(e.target.value)}
                  className="mb-2"
                />
                <Form.Select
                  value={formData.parentGoalId}
                  onChange={(e) => setFormData({ ...formData, parentGoalId: e.target.value })}
                  size="sm"
                >
                  <option value="">No parent</option>
                  {filteredParentOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.title || 'Untitled goal'}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  Hold Option/Alt while dragging one goal onto another in the roadmap to link quickly.
                </Form.Text>
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>Start Date</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </Form.Group>
            </div>
            <div className="col-md-6">
              <Form.Group className="mb-3">
                <Form.Label>End Date (Planned)</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </Form.Group>
            </div>
          </div>

          <div className="row">
            <div className="col-md-12">
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

        {/* Recent activity */}
        <div className="mt-3">
          <h6 className="mb-2">Recent Activity</h6>
          {recentActivity.length === 0 ? (
            <div className="text-muted small">No recent entries.</div>
          ) : (
            <ul className="list-unstyled small mb-0">
              {recentActivity.map((a) => (
                <li key={a.id} className="border rounded p-2 mb-1">
                  <div><strong>{a.activityType || 'activity'}</strong> – {a.description || ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

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
          {isSubmitting ? (goal ? 'Updating...' : 'Creating...') : (goal ? 'Update Goal' : 'Create Goal')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EditGoalModal;

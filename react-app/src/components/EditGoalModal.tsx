import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Form, Alert, InputGroup, Toast, ToastContainer } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { doc, updateDoc, serverTimestamp, collection, query, where, getDocs, setDoc, getDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { Goal, Story, Task } from '../types';
import { generateRef } from '../utils/referenceGenerator';
import { httpsCallable } from 'firebase/functions';
import { migrateThemeValue } from '../constants/globalThemes';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { toDate } from '../utils/firestoreAdapters';
import TagInput from './common/TagInput';
import ActivityStreamPanel from './common/ActivityStreamPanel';
import ModernStoriesTable from './ModernStoriesTable';
import ModernTaskTable from './ModernTaskTable';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';

interface EditGoalModalProps {
  goal: Goal | null;
  onClose: () => void;
  show: boolean;
  currentUserId: string;
  allGoals?: Goal[];
}

const EditGoalModal: React.FC<EditGoalModalProps> = ({ goal, onClose, show, currentUserId, allGoals = [] }) => {
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
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
    const normalize = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const normalizedInput = normalize(trimmed);
    const match = themes.find(t => {
      const label = t.label || '';
      const name = t.name || '';
      return (
        normalize(label) === normalizedInput ||
        normalize(name) === normalizedInput ||
        normalize(String(t.id)) === normalizedInput ||
        normalize(label).includes(normalizedInput) ||
        normalize(name).includes(normalizedInput)
      );
    });
    if (match) return match.id;
    const numeric = Number.parseInt(trimmed, 10);
    return Number.isFinite(numeric) ? numeric : fallback;
  }, [themes]);
  const [parentSearch, setParentSearch] = useState('');
  const [monzoPots, setMonzoPots] = useState<Array<{ id: string; name: string }>>([]);
  const [monzoConnected, setMonzoConnected] = useState(false);
  const [linkedStories, setLinkedStories] = useState<Story[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
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

  const activePersona = (goal as any)?.persona || currentPersona;

  useEffect(() => {
    const loadLinkedStories = async () => {
      if (!show || !goal || !currentUserId) {
        setLinkedStories([]);
        return;
      }
      setStoriesLoading(true);
      try {
        let list: Story[] = [];
        try {
          const baseQuery = query(
            collection(db, 'stories'),
            where('ownerUid', '==', currentUserId),
            where('goalId', '==', goal.id)
          );
          const snap = await getDocs(baseQuery);
          list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
        } catch (err) {
          const fallback = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUserId)));
          list = fallback.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
          list = list.filter((story) => story.goalId === goal.id);
        }
        if (activePersona) {
          list = list.filter((story) => !story.persona || story.persona === activePersona);
        }
        setLinkedStories(list);
      } catch (err) {
        console.error('Failed to load linked stories', err);
        setLinkedStories([]);
      } finally {
        setStoriesLoading(false);
      }
    };
    loadLinkedStories();
  }, [show, goal?.id, currentUserId, activePersona]);

  useEffect(() => {
    const loadLinkedTasks = async () => {
      if (!show || !goal || !currentUserId) {
        setLinkedTasks([]);
        return;
      }
      setTasksLoading(true);
      try {
        const tasksSnap = await getDocs(query(collection(db, 'tasks'), where('ownerUid', '==', currentUserId)));
        let list = tasksSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Task[];
        const storyIds = new Set(linkedStories.map((story) => story.id));
        list = list.filter((task) => {
          if (activePersona && task.persona && task.persona !== activePersona) return false;
          if (task.goalId === goal.id) return true;
          if (task.storyId && storyIds.has(task.storyId)) return true;
          if (task.parentId && storyIds.has(task.parentId)) return true;
          return false;
        });
        setLinkedTasks(list);
      } catch (err) {
        console.error('Failed to load linked tasks', err);
        setLinkedTasks([]);
      } finally {
        setTasksLoading(false);
      }
    };
    loadLinkedTasks();
  }, [show, goal?.id, currentUserId, activePersona, linkedStories]);

  const handleStoryUpdate = async (storyId: string, updates: Partial<Story>) => {
    await updateDoc(doc(db, 'stories', storyId), { ...updates, updatedAt: serverTimestamp() } as any);
    setLinkedStories((prev) => prev.map((story) => (story.id === storyId ? { ...story, ...updates } as Story : story)));
    if (updates.goalId && goal && updates.goalId !== goal.id) {
      setLinkedStories((prev) => prev.filter((story) => story.id !== storyId));
    }
  };

  const handleStoryDelete = async (storyId: string) => {
    await deleteDoc(doc(db, 'stories', storyId));
    setLinkedStories((prev) => prev.filter((story) => story.id !== storyId));
  };

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    await updateDoc(doc(db, 'stories', storyId), { priority: newPriority, updatedAt: serverTimestamp() } as any);
    setLinkedStories((prev) => prev.map((story) => (story.id === storyId ? { ...story, priority: newPriority } as Story : story)));
  };

  const handleStoryAdd = async (storyData: Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>) => {
    if (!goal) return;
    const payload: any = {
      ...storyData,
      goalId: storyData.goalId || goal.id,
      ownerUid: currentUserId,
      persona: activePersona || 'personal',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'stories'), payload);
    setLinkedStories((prev) => [...prev, { id: ref.id, ...(payload as any) } as Story]);
  };

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    const payload: any = { ...updates, updatedAt: serverTimestamp() };
    if ((updates as any).storyId) {
      payload.parentType = 'story';
      payload.parentId = (updates as any).storyId;
      const linkedStory = linkedStories.find((story) => story.id === (updates as any).storyId);
      if (linkedStory?.goalId) payload.goalId = linkedStory.goalId;
    }
    await updateDoc(doc(db, 'tasks', taskId), payload);
    setLinkedTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...updates } as Task : task)));
  };

  const handleTaskDelete = async (taskId: string) => {
    await deleteDoc(doc(db, 'tasks', taskId));
    setLinkedTasks((prev) => prev.filter((task) => task.id !== taskId));
  };

  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() } as any);
    setLinkedTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, priority: newPriority } as Task : task)));
  };

  const handleTaskCreate = async (newTask: Partial<Task>) => {
    if (!goal) return;
    const storyId = (newTask as any).storyId || null;
    const linkedStory = storyId ? linkedStories.find((story) => story.id === storyId) : null;
    const payload: any = {
      title: newTask.title || '',
      description: newTask.description || '',
      status: (newTask as any).status ?? 0,
      priority: (newTask as any).priority ?? 2,
      effort: (newTask as any).effort ?? 'M',
      dueDate: (newTask as any).dueDate || null,
      points: (newTask as any).points ?? 1,
      ownerUid: currentUserId,
      persona: activePersona || 'personal',
      goalId: linkedStory?.goalId || goal.id,
      storyId: storyId || null,
      parentType: storyId ? 'story' : 'project',
      parentId: storyId || goal.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'tasks'), payload);
    setLinkedTasks((prev) => [...prev, { id: ref.id, ...(payload as any) } as Task]);
  };

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
        theme_id: themeId,
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

      const maybeCreateMonzoPot = async (goalId: string | null, goalRef?: string | null): Promise<string | null> => {
        if (!goalId) return null;
        if (!formData.autoCreatePot) return null;
        if (!estimatedCostValue || Number.isNaN(estimatedCostValue)) return null;
        if (formData.linkedPotId) return null;
        if (!monzoConnected) {
          setToastMsg('Connect Monzo to auto-create a pot.');
          return null;
        }
        const refLabel = (goalRef || '').trim();
        const titleLabel = (formData.title || 'Goal pot').trim();
        const potName = refLabel ? `${refLabel} - ${titleLabel}` : titleLabel;
        const callable = httpsCallable(functions, 'monzoCreatePot');
        const resp: any = await callable({ name: potName, goalId });
        const created = resp?.data?.pot || null;
        return created?.potId || created?.id || null;
      };

      let goalIdForPot: string | null = goal?.id || null;
      let goalRefForPot: string | null = (goal as any)?.ref || (goal as any)?.referenceNumber || null;

      if (goal) {
        // UPDATE existing goal
        console.log('🚀 EditGoalModal: Starting GOAL update', { goalId: goal.id });
        await updateDoc(doc(db, 'goals', goal.id), goalData);
        const createdPotId = await maybeCreateMonzoPot(goal.id, goalRefForPot);
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
        if (!goalData.ref) {
          let existingRefs = allGoals.map((g) => (g as any).ref).filter(Boolean) as string[];
          if (existingRefs.length === 0) {
            try {
              const snap = await getDocs(query(collection(db, 'goals'), where('ownerUid', '==', currentUserId)));
              existingRefs = snap.docs.map((d) => (d.data() as any).ref).filter(Boolean) as string[];
            } catch {
              existingRefs = [];
            }
          }
          goalData.ref = generateRef('goal', existingRefs);
        }
        // Default persona if available, or fetch from context if passed (not available in props currently, assuming currentUserId context)
        // For now, we'll rely on the parent component to handle persona or add it here if needed.
        // Ideally, we should pass persona as a prop.
        // Adding a safe fallback or update later.

        await import('firebase/firestore').then(async ({ addDoc, collection }) => {
          const ref = await addDoc(collection(db, 'goals'), goalData);
          goalIdForPot = ref.id;
        });

        goalRefForPot = goalData.ref || goalRefForPot;
        const createdPotId = await maybeCreateMonzoPot(goalIdForPot, goalRefForPot);
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
    <Modal show={show} onHide={handleClose} centered size="xl" fullscreen="lg-down" scrollable>
      <ToastContainer position="bottom-end" className="p-3">
        <Toast bg="success" onClose={() => setToastMsg(null)} show={!!toastMsg} delay={1800} autohide>
          <Toast.Body className="text-white">{toastMsg}</Toast.Body>
        </Toast>
      </ToastContainer>
      <Modal.Header closeButton>
        <Modal.Title>{goal ? `Edit Goal: ${goal.title}` : 'Create New Goal'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="row g-3">
          <div className="col-lg-8">
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

            {submitResult && (
              <Alert variant={submitResult.includes('✅') ? 'success' : 'danger'}>
                {submitResult}
              </Alert>
            )}
          </div>
          <div className="col-lg-4">
            <ActivityStreamPanel
              entityId={goal?.id}
              entityType="goal"
              referenceNumber={(goal as any)?.ref || (goal as any)?.referenceNumber}
            />
          </div>
        </div>

        {goal && (
          <div className="mt-4">
            <div className="mb-4">
              <h5 className="mb-2">Linked Stories</h5>
              {storiesLoading ? (
                <div className="text-muted small">Loading stories…</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <ModernStoriesTable
                    stories={linkedStories}
                    goals={allGoals.length ? allGoals : (goal ? [goal] : [])}
                    goalId={goal.id}
                    onStoryUpdate={handleStoryUpdate}
                    onStoryDelete={handleStoryDelete}
                    onStoryPriorityChange={handleStoryPriorityChange}
                    onStoryAdd={handleStoryAdd}
                  />
                </div>
              )}
            </div>

            <div>
              <h5 className="mb-2">Linked Tasks</h5>
              {tasksLoading ? (
                <div className="text-muted small">Loading tasks…</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <ModernTaskTable
                    tasks={linkedTasks}
                    stories={linkedStories}
                    goals={allGoals.length ? allGoals : (goal ? [goal] : [])}
                    sprints={sprints as any}
                    compact
                    defaultColumns={['ref', 'title', 'status', 'priority', 'dueDate', 'points', 'storyTitle']}
                    onTaskCreate={handleTaskCreate}
                    onTaskUpdate={handleTaskUpdate}
                    onTaskDelete={handleTaskDelete}
                    onTaskPriorityChange={handleTaskPriorityChange}
                  />
                </div>
              )}
            </div>
          </div>
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

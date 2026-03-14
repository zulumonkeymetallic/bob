import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Form, Alert, Row, Col } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import type { Goal } from '../types';
import { generateRef } from '../utils/referenceGenerator';
import { parsePointsValue } from '../utils/points';
import TagInput from './common/TagInput';
import { planningSprints, pickDefaultPlanningSprintId } from '../utils/sprintFilter';
import { evaluateStorySprintAlignment } from '../utils/sprintAlignment';
import { getGoalDisplayPath, getLeafGoalOptions, isGoalInHierarchySet, resolveLeafGoalSelection } from '../utils/goalHierarchy';

interface AddStoryModalProps {
  onClose: () => void;
  show: boolean;
  goalId?: string; // Optional goalId to pre-select the goal
}

interface SprintLike {
  id: string;
  name?: string;
  alignmentMode?: 'warn' | 'strict';
  focusGoalIds?: string[];
}

const AddStoryModal: React.FC<AddStoryModalProps> = ({ onClose, show, goalId }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints: allSprints } = useSprint();
  const sprints = planningSprints(allSprints);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeFocusGoalIds, setActiveFocusGoalIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    url: '',
    goalId: goalId || '', // Pre-select goal if provided
    sprintId: '',
    priority: 2,
    points: 3,
    persona: (currentPersona || 'personal') as 'personal' | 'work',
    dueDate: '',
    dueTime: '',
    timeOfDay: '' as 'morning' | 'afternoon' | 'evening' | '',
    tags: [] as string[]
  });
  const [goalInput, setGoalInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const selectedSprint = formData.sprintId
    ? (allSprints.find((sprint) => sprint.id === formData.sprintId) as SprintLike | undefined)
    : null;
  const sprintAlignment = evaluateStorySprintAlignment(selectedSprint as any, formData.goalId || '');
  const leafGoalOptions = useMemo(() => getLeafGoalOptions(goals), [goals]);
  const selectedGoalResolution = useMemo(
    () => resolveLeafGoalSelection(formData.goalId || null, goals),
    [formData.goalId, goals],
  );

  // Update goalId when prop changes
  useEffect(() => {
    if (goalId) {
      const resolved = resolveLeafGoalSelection(goalId, goals);
      const nextGoalId = resolved.goalId || goalId;
      setFormData(prev => ({
        ...prev,
        goalId: nextGoalId
      }));
      const g = goals.find((gl) => gl.id === nextGoalId) || goals.find((gl) => gl.id === goalId);
      setGoalInput(g ? getGoalDisplayPath(g.id, goals) : '');
    }
  }, [goalId, goals]);

  // Log modal open/close state changes
  useEffect(() => {
    if (show) {
      console.log('📱 AddStoryModal: Modal opened', {
        action: 'modal_opened',
        element: 'add_story_modal',
        user: currentUser?.uid,
        persona: currentPersona,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('📱 AddStoryModal: Modal closed', {
        action: 'modal_closed',
        element: 'add_story_modal',
        timestamp: new Date().toISOString()
      });
    }
  }, [show, currentUser, currentPersona]);

  // Keep persona prefilled from the currently selected app persona when opening.
  useEffect(() => {
    if (show) {
      const defaultSprintId = pickDefaultPlanningSprintId(allSprints);
      setFormData(prev => ({
        ...prev,
        persona: (currentPersona || 'personal') as 'personal' | 'work',
        sprintId: prev.sprintId || defaultSprintId,
      }));
    }
  }, [show, currentPersona, allSprints]);

  useEffect(() => {
    if (!show || !currentUser) {
      setActiveFocusGoalIds(new Set());
      return;
    }
    let mounted = true;
    const loadFocusGoals = async () => {
      try {
        const focusQuery = query(
          collection(db, 'focusGoals'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', (formData.persona || currentPersona || 'personal')),
          where('isActive', '==', true),
        );
        const snapshot = await getDocs(focusQuery);
        const ids = new Set<string>();
        snapshot.docs.forEach((docSnap) => {
          const goalIds = (docSnap.data() as any)?.goalIds;
          if (!Array.isArray(goalIds)) return;
          goalIds.forEach((goalId: any) => {
            const id = String(goalId || '').trim();
            if (id) ids.add(id);
          });
        });
        if (mounted) setActiveFocusGoalIds(ids);
      } catch {
        if (mounted) setActiveFocusGoalIds(new Set());
      }
    };
    loadFocusGoals();
    return () => {
      mounted = false;
    };
  }, [show, currentUser, currentPersona, formData.persona]);

  // Load goals and sprints when modal opens
  useEffect(() => {
    if (show && currentUser) {
      let mounted = true;
      const loadData = async () => {
        try {
          console.log('🔄 AddStoryModal: Starting data load for modal', {
            action: 'modal_data_load_start',
            user: currentUser.uid,
            persona: currentPersona,
            timestamp: new Date().toISOString()
          });

          // Load goals (filter by persona on client so personal includes legacy nulls)
          const goalsQuery = query(
            collection(db, 'goals'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('priority', 'desc')
          );

          console.log('📊 AddStoryModal: Loading goals...', {
            action: 'goals_query_start',
            user: currentUser.uid
          });

          const goalsSnapshot = await getDocs(goalsQuery);
          const selectedPersona = (formData.persona || currentPersona || 'personal') as 'personal' | 'work';
          const goalsData = goalsSnapshot.docs
            .map(doc => ({
              id: doc.id,
              title: doc.data().title,
              theme: doc.data().theme as number,
              persona: doc.data().persona as any,
              parentGoalId: doc.data().parentGoalId || null,
              goalKind: doc.data().goalKind,
              timeHorizon: doc.data().timeHorizon,
              rollupMode: doc.data().rollupMode,
              ref: doc.data().ref || null,
            }))
            .filter(goal => {
              if (selectedPersona === 'work') return goal.persona === 'work';
              return goal.persona == null || goal.persona === 'personal';
            }) as Goal[];

          console.log('✅ AddStoryModal: Goals loaded successfully', {
            action: 'goals_loaded',
            count: goalsData.length,
            goals: goalsData.map(g => ({ id: g.id, title: g.title }))
          });

          if (mounted) setGoals(goalsData);

          console.log('🎉 AddStoryModal: All data loaded successfully', {
            action: 'modal_data_load_complete',
            goalsCount: goalsData.length,
          });

        } catch (error) {
          console.error('❌ AddStoryModal: Error loading data', {
            action: 'modal_data_load_error',
            error: error.message,
            stack: error.stack,
            user: currentUser?.uid,
            persona: currentPersona
          });
        }
      };
      loadData();
      return () => { mounted = false; };
    }
  }, [show, currentUser, currentPersona, formData.persona]);

  const handleClose = () => {
    console.log('🖱️ AddStoryModal: Cancel button clicked', {
      action: 'cancel_button_click',
      element: 'cancel_button',
      formData: formData,
      timestamp: new Date().toISOString()
    });
    setFormData({ title: '', description: '', url: '', goalId: '', sprintId: '', priority: 2, points: 3, persona: (currentPersona || 'personal') as 'personal' | 'work', dueDate: '', dueTime: '', timeOfDay: '', tags: [] });
    setSubmitResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    console.log('🖱️ AddStoryModal: Create Story button clicked', {
      action: 'create_story_button_click',
      element: 'create_button',
      formData: formData,
      selectedGoal: goals.find(g => g.id === formData.goalId),
      selectedSprint: sprints.find(s => s.id === formData.sprintId),
      timestamp: new Date().toISOString()
    });

    if (!currentUser || !formData.title.trim()) {
      console.log('⚠️ AddStoryModal: Create Story validation failed', {
        action: 'create_story_validation_failed',
        hasUser: !!currentUser,
        hasTitle: !!formData.title.trim(),
        formData: formData,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (
      activeFocusGoalIds.size > 0
      && formData.goalId
      && !isGoalInHierarchySet(String(formData.goalId), goals as any, activeFocusGoalIds)
    ) {
      const proceed = window.confirm(
        'This goal is not in your active focus goals. Work linked here will be deferred until after the current focus period ends. Continue?'
      );
      if (!proceed) {
        return;
      }
    }

    if (formData.sprintId && sprintAlignment.hasRule && !sprintAlignment.aligned) {
      if (sprintAlignment.blocking) {
        setSubmitResult(`❌ ${sprintAlignment.message}`);
        return;
      }
      const proceed = window.confirm(`${sprintAlignment.message} Continue anyway?`);
      if (!proceed) {
        return;
      }
    }

    const resolvedGoalSelection = resolveLeafGoalSelection(formData.goalId || null, goals);
    if (formData.goalId && !resolvedGoalSelection.goalId) {
      if (resolvedGoalSelection.reason === 'ambiguous_parent') {
        setSubmitResult('❌ Stories must link to a specific leaf goal. Select the child goal you want this story to execute against.');
      } else {
        setSubmitResult('❌ Please select a valid leaf goal before creating the story.');
      }
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      console.log('🚀 AddStoryModal: Starting STORY creation', {
        action: 'story_creation_start',
        user: currentUser.uid,
        persona: currentPersona,
        title: formData.title.trim(),
        goalId: formData.goalId,
        priority: formData.priority,
        timestamp: new Date().toISOString()
      });

      // Get existing story references for unique ref generation
      const existingStoriesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid)
      );
      const existingSnapshot = await getDocs(existingStoriesQuery);
      const existingRefs = existingSnapshot.docs
        .map(doc => doc.data().ref)
        .filter(ref => ref);

      // Generate unique reference number
      const ref = generateRef('story', existingRefs);
      console.log('🏷️ AddStoryModal: Generated reference', {
        action: 'reference_generated',
        ref: ref,
        timestamp: new Date().toISOString()
      });

      const resolvedGoalId = resolvedGoalSelection.goalId || '';
      const linkedGoal = goals.find((g) => g.id === resolvedGoalId) || goals.find((g) => g.id === formData.goalId);
      const parsedPoints = parsePointsValue(formData.points);
      const storyData = {
        ref: ref, // Add reference number
        title: formData.title.trim(),
        description: formData.description.trim(),
          url: formData.url.trim() || null,
        goalId: resolvedGoalId || null,
        sprintId: formData.sprintId || null,
        priority: formData.priority,
        points: parsedPoints == null ? 1 : parsedPoints,
        dueDate: formData.dueDate ? new Date(`${formData.dueDate}T00:00:00`).getTime() : null,
        dueTime: formData.dueTime || null,
        timeOfDay: formData.timeOfDay || null,
        status: 0,
        theme: linkedGoal?.theme ?? 1,
          persona: formData.persona || currentPersona || 'personal',
        ownerUid: currentUser.uid, // Ensure ownerUid is included
        orderIndex: Date.now(), // Simple ordering by creation time
        tags: formData.tags,
        acceptanceCriteria: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      console.log('💾 AddStoryModal: Saving STORY to database', {
        action: 'story_save_start',
        data: storyData,
        timestamp: new Date().toISOString()
      });

      await addDoc(collection(db, 'stories'), storyData);

      console.log('✅ AddStoryModal: STORY created successfully', {
        action: 'story_creation_success',
        ref: ref,
        storyId: 'pending_from_firestore',
        goalId: resolvedGoalId || 'none',
        timestamp: new Date().toISOString()
      });

      setSubmitResult(`✅ Story created successfully! (${ref})`);
      setFormData({ title: '', description: '', url: '', goalId: '', sprintId: '', priority: 2, points: 3, persona: (currentPersona || 'personal') as 'personal' | 'work', dueDate: '', dueTime: '', timeOfDay: '', tags: [] });

      // Auto-close after success
      setTimeout(() => {
        onClose();
        setSubmitResult(null);
      }, 1500);

    } catch (error) {
      console.error('❌ AddStoryModal: STORY creation failed', {
        action: 'story_creation_error',
        error: error.message,
        formData: formData,
        timestamp: new Date().toISOString()
      });
      setSubmitResult(`❌ Failed to create story: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Add New Story</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Title *</Form.Label>
            <Form.Control
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter story title..."
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
              placeholder="Describe this story..."
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Source URL</Form.Label>
            <Form.Control
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://..."
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Persona</Form.Label>
            <Form.Select
              value={formData.persona}
              onChange={(e) => {
                setGoalInput('');
                setFormData({ ...formData, persona: e.target.value as 'personal' | 'work', goalId: '', sprintId: '' });
              }}
            >
              <option value="personal">Personal</option>
              <option value="work">Work</option>
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Tags</Form.Label>
            <TagInput
              value={formData.tags}
              onChange={(tags) => setFormData({ ...formData, tags })}
              placeholder="Add tags..."
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Link to Goal</Form.Label>
            <Form.Control
              list="add-story-goal-options"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onBlur={() => {
                const val = goalInput.trim();
                const match = leafGoalOptions.find((g) => {
                  const displayPath = getGoalDisplayPath(g.id, goals);
                  return displayPath === val || g.id === val || g.title === val;
                });
                setGoalInput(match ? getGoalDisplayPath(match.id, goals) : val);
                setFormData({ ...formData, goalId: match ? match.id : '' });
              }}
              placeholder="Search leaf goals by title..."
            />
            <datalist id="add-story-goal-options">
              {leafGoalOptions.map(g => (
                <option key={g.id} value={getGoalDisplayPath(g.id, goals)} />
              ))}
            </datalist>
            <Form.Text className="text-muted">
              Stories must link to a leaf goal so sprint work maps to an executable milestone.
            </Form.Text>
          </Form.Group>

          {selectedGoalResolution.reason === 'auto_descendant' && selectedGoalResolution.leafGoal && (
            <Alert variant="info" className="mb-3">
              Parent goal selection auto-resolved to leaf goal <strong>{getGoalDisplayPath(selectedGoalResolution.leafGoal.id, goals)}</strong>.
            </Alert>
          )}

          {selectedGoalResolution.reason === 'ambiguous_parent' && (
            <Alert variant="warning" className="mb-3">
              That parent goal has multiple leaf goals. Select the exact leaf goal you want this story to execute against.
            </Alert>
          )}

          {activeFocusGoalIds.size > 0 && formData.goalId && !isGoalInHierarchySet(String(formData.goalId), goals as any, activeFocusGoalIds) && (
            <Alert variant="warning" className="mb-3">
              This goal is outside your active focus set. If you continue, this work will be deferred until after the current focus period.
            </Alert>
          )}

          {formData.sprintId && sprintAlignment.hasRule && !sprintAlignment.aligned && (
            <Alert variant={sprintAlignment.blocking ? 'danger' : 'warning'} className="mb-3">
              {sprintAlignment.message}
            </Alert>
          )}

          <Form.Group className="mb-3">
            <Form.Label>Assign to Sprint</Form.Label>
            <Form.Select
              value={formData.sprintId}
              onChange={(e) => {
                console.log('🏃‍♂️ AddStoryModal: Sprint selection changed', {
                  action: 'sprint_select_change',
                  element: 'sprint_dropdown',
                  previousValue: formData.sprintId,
                  newValue: e.target.value,
                  selectedSprint: sprints.find(s => s.id === e.target.value),
                  availableSprints: sprints.length,
                  timestamp: new Date().toISOString()
                });
                setFormData({ ...formData, sprintId: e.target.value });
              }}
              onClick={() => {
                console.log('🖱️ AddStoryModal: Sprint dropdown clicked', {
                  action: 'sprint_dropdown_click',
                  element: 'sprint_select',
                  currentValue: formData.sprintId,
                  availableOptions: sprints.length,
                  timestamp: new Date().toISOString()
                });
              }}
            >
              <option value="">No sprint (backlog)</option>
              {sprints.map(sprint => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">
              Assign to a sprint for sprint planning
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Priority</Form.Label>
            <Form.Select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) })}
            >
              <option value={4}>Critical</option>
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </Form.Select>
          </Form.Group>

          <Row>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Due Date</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Due Time</Form.Label>
                <Form.Control
                  type="time"
                  value={formData.dueTime}
                  onChange={(e) => setFormData({ ...formData, dueTime: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Time of Day</Form.Label>
                <Form.Select
                  value={formData.timeOfDay}
                  onChange={(e) => setFormData({ ...formData, timeOfDay: e.target.value as any as any })}
                >
                  <option value="">Auto/None</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label>Story Points</Form.Label>
            <Form.Control
              type="number"
              step="any"
              inputMode="decimal"
              value={formData.points}
              onChange={(e) => setFormData({
                ...formData,
                points: e.target.value as any,
              })}
            />
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
          {isSubmitting ? 'Creating...' : 'Create Story'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AddStoryModal;

export { };

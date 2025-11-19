import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Alert, Spinner, ListGroup } from 'react-bootstrap';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { generateRef } from '../utils/referenceGenerator';
import { emergencyCreateTask } from '../utils/emergencyTaskCreation';

type BulkEntityType = 'story' | 'task' | 'goal';

interface BulkCreateModalProps {
  show: boolean;
  onHide: () => void;
  onComplete?: () => void;
}

interface GoalOption {
  id: string;
  title: string;
  theme: string | number;
}

interface BulkResult {
  item: string;
  status: 'success' | 'error';
  message?: string;
}

const tomorrowAt = (hour = 17, minute = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const BulkCreateModal: React.FC<BulkCreateModalProps> = ({ show, onHide, onComplete }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const [itemType, setItemType] = useState<BulkEntityType>('story');
  const [itemsText, setItemsText] = useState('');
  const [autoAcceptanceCriteria, setAutoAcceptanceCriteria] = useState(true);
  const [autoEnhanceTasks, setAutoEnhanceTasks] = useState(true);
  const [autoGenerateGoalStories, setAutoGenerateGoalStories] = useState(true);
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('Growth');
  const [selectedPriority, setSelectedPriority] = useState<'low' | 'med' | 'high'>('med');
  const [taskPoints, setTaskPoints] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [goals, setGoals] = useState<GoalOption[]>([]);

  const themes = useMemo(() => GLOBAL_THEMES.map(theme => theme.name), []);

  const resolveGoalTheme = (goalId: string): number => {
    const goal = goals.find(item => item.id === goalId);
    const rawTheme = goal?.theme;
    if (typeof rawTheme === 'number') {
      return rawTheme;
    }
    if (typeof rawTheme === 'string') {
      const mapped = GLOBAL_THEMES.find(theme => theme.name === rawTheme || theme.label === rawTheme);
      if (mapped) {
        return mapped.id;
      }
    }
    return 1;
  };

  useEffect(() => {
    if (!show || !currentUser) return;

    const loadGoals = async () => {
      try {
        const goalsQuery = query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid)
        );
        const snapshot = await getDocs(goalsQuery);
        const options = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          title: docSnap.data().title || 'Untitled Goal',
          theme: docSnap.data().theme ?? 'Growth'
        }));
        setGoals(options);
      } catch (loadError) {
        console.error('BulkCreateModal: failed to load goals', loadError);
      }
    };

    loadGoals();
  }, [show, currentUser]);

  useEffect(() => {
    if (!show) {
      setResults([]);
      setError(null);
      setItemsText('');
      setTaskPoints(1);
    }
  }, [show]);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setItemsText(text.trim());
      }
    } catch (clipboardError) {
      setError('Unable to access clipboard. Paste manually instead.');
    }
  };

  const fetchExistingRefs = async (collectionName: 'stories' | 'tasks' | 'goals') => {
    if (!currentUser) return [] as string[];
    const snapshot = await getDocs(
      query(collection(db, collectionName), where('ownerUid', '==', currentUser.uid))
    );
    return snapshot.docs
      .map(docSnap => docSnap.data().ref)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
  };

  const callAcceptanceCriteria = async (storyId: string, title: string, description: string) => {
    const callable = httpsCallable(functions, 'generateStoryAcceptanceCriteria');
    const response: any = await callable({ title, description, persona: currentPersona, maxItems: 5 });
    const criteria = Array.isArray(response?.data?.acceptanceCriteria)
      ? response.data.acceptanceCriteria
      : [];
    if (criteria.length > 0) {
      await updateDoc(doc(db, 'stories', storyId), {
        acceptanceCriteria: criteria,
        updatedAt: serverTimestamp(),
        aiGeneratedAcceptanceCriteria: true
      });
    }
    return criteria;
  };

  const callEnhanceTask = async (title: string, description: string) => {
    const callable = httpsCallable(functions, 'enhanceTaskDescription');
    const response: any = await callable({ title, description, persona: currentPersona });
    const enhancedDescription = response?.data?.description ? String(response.data.description) : description;
    const checklist = Array.isArray(response?.data?.checklist)
      ? response.data.checklist
      : [];
    return { description: enhancedDescription, checklist };
  };

  const callGenerateStoriesForGoal = async (goalId: string) => {
    const callable = httpsCallable(functions, 'generateStoriesForGoal');
    await callable({ goalId });
  };

  const handleSubmit = async () => {
    if (!currentUser) {
      setError('You must be signed in to create items.');
      return;
    }

    const lines = itemsText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      setError('Add at least one line – each line becomes an item.');
      return;
    }

    setIsProcessing(true);
    setResults([]);
    setError(null);

    try {
      const resultAccumulator: BulkResult[] = [];

      if (itemType === 'goal') {
        let existingGoalRefs = await fetchExistingRefs('goals');

        for (const line of lines) {
          try {
            const ref = generateRef('goal', existingGoalRefs);
            existingGoalRefs = [...existingGoalRefs, ref];

            const goalDoc = await addDoc(collection(db, 'goals'), {
              title: line,
              description: '',
              ref,
              theme: selectedTheme,
              size: 'M',
              timeToMasterHours: 40,
              confidence: 0.5,
              status: 'active',
              persona: currentPersona,
              ownerUid: currentUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              labels: [],
              kpis: [],
              aiBulkCreated: true
            });

            if (autoGenerateGoalStories) {
              try {
                await callGenerateStoriesForGoal(goalDoc.id);
                resultAccumulator.push({
                  item: line,
                  status: 'success',
                  message: 'Goal created; story generation requested.'
                });
              } catch (storyError) {
                console.error('Bulk goal story generation failed', storyError);
                resultAccumulator.push({
                  item: line,
                  status: 'success',
                  message: 'Goal created, but story generation failed.'
                });
              }
            } else {
              resultAccumulator.push({ item: line, status: 'success', message: 'Goal created.' });
            }
          } catch (goalError: any) {
            console.error('Bulk goal creation failed', goalError);
            resultAccumulator.push({
              item: line,
              status: 'error',
              message: goalError?.message || 'Failed to create goal'
            });
          }
        }
      }

      if (itemType === 'story') {
        let existingStoryRefs = await fetchExistingRefs('stories');

        for (const line of lines) {
          try {
            const ref = generateRef('story', existingStoryRefs);
            existingStoryRefs = [...existingStoryRefs, ref];

            const storyDoc = await addDoc(collection(db, 'stories'), {
              title: line,
              description: '',
              ref,
              persona: currentPersona,
              ownerUid: currentUser.uid,
              goalId: selectedGoalId || '',
              sprintId: '',
              priority: selectedPriority,
              points: 3,
              status: 'backlog',
              theme: selectedGoalId ? resolveGoalTheme(selectedGoalId) : 1,
              orderIndex: Date.now(),
              tags: [],
              acceptanceCriteria: [],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              aiBulkCreated: true
            });

            if (autoAcceptanceCriteria) {
              try {
                const criteria = await callAcceptanceCriteria(storyDoc.id, line, '');
                resultAccumulator.push({
                  item: line,
                  status: 'success',
                  message: criteria.length > 0
                    ? 'Story created with AI acceptance criteria.'
                    : 'Story created; no criteria returned.'
                });
              } catch (criteriaError) {
                console.error('Bulk story acceptance criteria failed', criteriaError);
                resultAccumulator.push({
                  item: line,
                  status: 'success',
                  message: 'Story created; acceptance criteria request failed.'
                });
              }
            } else {
              resultAccumulator.push({ item: line, status: 'success', message: 'Story created.' });
            }
          } catch (storyError: any) {
            console.error('Bulk story creation failed', storyError);
            resultAccumulator.push({
              item: line,
              status: 'error',
              message: storyError?.message || 'Failed to create story'
            });
          }
        }
      }

      if (itemType === 'task') {
        let existingTaskRefs = await fetchExistingRefs('tasks');
        const dueDateMs = tomorrowAt();

        for (const line of lines) {
          try {
            const ref = generateRef('task', existingTaskRefs);
            existingTaskRefs = [...existingTaskRefs, ref];

            let descriptionText = '';
            let checklist: string[] = [];
            if (autoEnhanceTasks) {
              try {
                const aiResult = await callEnhanceTask(line, '');
                descriptionText = aiResult.description || '';
                checklist = aiResult.checklist || [];
              } catch (enhanceError) {
                console.error('Bulk task enhancement failed', enhanceError);
                descriptionText = '';
                checklist = [];
              }
            }

            const taskData = {
              title: line,
              description: descriptionText,
              ref,
              persona: currentPersona,
              ownerUid: currentUser.uid,
              goalId: selectedGoalId || '',
              parentType: 'story',
              parentId: '',
              effort: 'M',
              priority: selectedPriority,
              estimateMin: 45,
              estimatedHours: 0.75,
              points: Math.max(1, Math.min(8, Math.round(taskPoints))),
              status: 0,
              theme: selectedTheme,
              hasGoal: !!selectedGoalId,
              alignedToGoal: !!selectedGoalId,
              source: 'web',
              syncState: 'clean',
              labels: [],
              checklist,
              dueDate: dueDateMs,
              aiBulkCreated: true
            };

            const result = await emergencyCreateTask(taskData, currentUser.uid, {
              maxRetries: 3,
              retryDelay: 750,
              fallbackMethod: true
            });

            if (!result.success) {
              throw new Error(result.error || 'Emergency task creation failed');
            }

            resultAccumulator.push({
              item: line,
              status: 'success',
              message: checklist.length > 0
                ? 'Task created with AI-enhanced description.'
                : 'Task created.'
            });
          } catch (taskError: any) {
            console.error('Bulk task creation failed', taskError);
            resultAccumulator.push({
              item: line,
              status: 'error',
              message: taskError?.message || 'Failed to create task'
            });
          }
        }
      }

      setResults(resultAccumulator);
      if (resultAccumulator.every(result => result.status === 'success')) {
        setItemsText('');
        if (onComplete) onComplete();
      }
    } catch (runError: any) {
      console.error('BulkCreateModal submission error', runError);
      setError(runError?.message || 'Bulk creation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const successCount = results.filter(result => result.status === 'success').length;
  const errorCount = results.filter(result => result.status === 'error').length;

  const renderOptions = () => {
    if (itemType === 'goal') {
      return (
        <>
          <Form.Group className="mb-3">
            <Form.Label>Theme</Form.Label>
            <Form.Select value={selectedTheme} onChange={(event) => setSelectedTheme(event.target.value)}>
              {themes.map(theme => (
                <option key={theme} value={theme}>{theme}</option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Check
            type="checkbox"
            id="bulk-goal-autostories"
            className="mb-3"
            checked={autoGenerateGoalStories}
            onChange={(event) => setAutoGenerateGoalStories(event.target.checked)}
            label="Ask AI to generate supporting stories for each goal"
          />
        </>
      );
    }

    if (itemType === 'story') {
      return (
        <>
          <Form.Group className="mb-3">
            <Form.Label>Link to Goal (optional)</Form.Label>
            <Form.Select value={selectedGoalId} onChange={(event) => setSelectedGoalId(event.target.value)}>
              <option value="">No goal link</option>
              {goals.map(goal => (
                <option key={goal.id} value={goal.id}>{goal.title}</option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Priority</Form.Label>
            <Form.Select value={selectedPriority} onChange={(event) => setSelectedPriority(event.target.value as 'low' | 'med' | 'high')}>
              <option value="low">Low</option>
              <option value="med">Medium</option>
              <option value="high">High</option>
            </Form.Select>
          </Form.Group>
          <Form.Check
            type="checkbox"
            id="bulk-story-acceptance"
            className="mb-3"
            checked={autoAcceptanceCriteria}
            onChange={(event) => setAutoAcceptanceCriteria(event.target.checked)}
            label="Generate acceptance criteria with AI"
          />
        </>
      );
    }

    return (
      <>
        <Form.Group className="mb-3">
          <Form.Label>Theme</Form.Label>
          <Form.Select value={selectedTheme} onChange={(event) => setSelectedTheme(event.target.value)}>
            {themes.map(theme => (
              <option key={theme} value={theme}>{theme}</option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Priority</Form.Label>
          <Form.Select value={selectedPriority} onChange={(event) => setSelectedPriority(event.target.value as 'low' | 'med' | 'high')}>
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Align to Goal (optional)</Form.Label>
          <Form.Select value={selectedGoalId} onChange={(event) => setSelectedGoalId(event.target.value)}>
            <option value="">No goal link</option>
            {goals.map(goal => (
              <option key={goal.id} value={goal.id}>{goal.title}</option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Default Points (1–8)</Form.Label>
          <Form.Control
            type="number"
            min={1}
            max={8}
            value={taskPoints}
            onChange={(event) => {
              const value = Number(event.target.value);
              const normalized = Math.max(1, Math.min(8, Number.isNaN(value) ? 1 : Math.round(value)));
              setTaskPoints(normalized);
            }}
          />
        </Form.Group>
        <Form.Check
          type="checkbox"
          id="bulk-task-enhance"
          className="mb-3"
          checked={autoEnhanceTasks}
          onChange={(event) => setAutoEnhanceTasks(event.target.checked)}
          label="Enhance descriptions with AI and set deadline to tomorrow"
        />
      </>
    );
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Bulk Create Items</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small mb-3">
          Paste items from your clipboard – each line becomes a new {itemType}. Adjust options below before creating.
        </p>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Item Type</Form.Label>
            <Form.Select value={itemType} onChange={(event) => setItemType(event.target.value as BulkEntityType)} disabled={isProcessing}>
              <option value="story">Stories</option>
              <option value="task">Tasks</option>
              <option value="goal">Goals</option>
            </Form.Select>
          </Form.Group>

          {renderOptions()}

          <Form.Group className="mb-2">
            <Form.Label>Items (one per line)</Form.Label>
            <Form.Control
              as="textarea"
              rows={8}
              value={itemsText}
              onChange={(event) => setItemsText(event.target.value)}
              disabled={isProcessing}
              placeholder="Paste from clipboard or write items manually..."
            />
          </Form.Group>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <Button variant="link" className="p-0" onClick={handlePasteFromClipboard} disabled={isProcessing}>
              Paste from clipboard
            </Button>
            <div className="text-muted small">
              {itemsText.split(/\r?\n/).filter(line => line.trim().length > 0).length} items queued
            </div>
          </div>
        </Form>

        {error && (
          <Alert variant="danger" className="mt-2">
            {error}
          </Alert>
        )}

        {results.length > 0 && (
          <Alert variant={errorCount ? 'warning' : 'success'} className="mt-3">
            <div className="fw-semibold mb-2">
              {successCount} created, {errorCount} failed
            </div>
            <ListGroup variant="flush">
              {results.map((result, index) => (
                <ListGroup.Item key={`${index}-${result.item}`} className="px-0 py-1">
                  <span className={result.status === 'success' ? 'text-success' : 'text-danger'}>
                    {result.status === 'success' ? '✓' : '✗'}
                  </span>
                  <span className="ms-2 fw-semibold">{result.item}</span>
                  {result.message && <span className="ms-2 text-muted">{result.message}</span>}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={isProcessing}>
          Close
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={isProcessing || !itemsText.trim()}>
          {isProcessing ? (
            <>
              <Spinner as="span" animation="border" size="sm" role="status" className="me-2" />
              Creating...
            </>
          ) : (
            'Create Items'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default BulkCreateModal;

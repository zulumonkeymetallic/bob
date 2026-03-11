import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Form, Alert, ProgressBar, ListGroup, Badge, Spinner, Card, Row, Col } from 'react-bootstrap';
import { ChevronRight, CheckCircle, AlertCircle, Zap, DollarSign, BookOpen, Calendar } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { Goal, FocusGoal } from '../types';
import { FocusWizardPrefill } from '../services/focusGoalsService';

interface FocusGoalWizardProps {
  show: boolean;
  onHide: () => void;
  goals: Goal[];
  existingFocusGoals: FocusGoal[];
  initialPrefill?: FocusWizardPrefill;
  onSave: (focusGoal: FocusGoal) => Promise<void>;
  onAutoCreateStories: (goalIds: string[]) => Promise<string[]>;
  onAutoCreateSavingsBuckets: (goals: Goal[]) => Promise<{ [goalId: string]: string }>;
}

type WizardStep = 'select' | 'timeframe' | 'vision' | 'review' | 'confirm';

interface IntentPrompt {
  id: string;
  text: string;
}

interface IntentMatch {
  goalId: string;
  title: string;
  score: number;
  tag?: string;
}

interface IntentProposal {
  tag: string;
  title: string;
  rationale: string;
  confidence: number;
}

interface IntentResult {
  intakeId?: string;
  snapshotMeta?: {
    stale?: boolean;
    snapshotVersion?: string;
    goalsScanned?: number;
  };
  matches?: IntentMatch[];
  proposals?: IntentProposal[];
}

/**
 * Multi-step wizard for creating focus goal sets
 * - Step 1: Select goals to focus on
 * - Step 2: Choose timeframe (sprint/quarter/year)
 * - Step 3: Review & auto-create stories + savings buckets
 * - Step 4: Confirm and save
 */
export const FocusGoalWizard: React.FC<FocusGoalWizardProps> = ({
  show,
  onHide,
  goals,
  existingFocusGoals,
  initialPrefill,
  onSave,
  onAutoCreateStories,
  onAutoCreateSavingsBuckets
}) => {
  const [step, setStep] = useState<WizardStep>('select');
  const [selectedGoalIds, setSelectedGoalIds] = useState<Set<string>>(new Set());
  const [timeframe, setTimeframe] = useState<'sprint' | 'quarter' | 'year'>('sprint');
  const [loading, setLoading] = useState(false);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState('');
  const [storiesCreated, setStoriesCreated] = useState<string[]>([]);
  const [bucketsCreated, setBucketsCreated] = useState<{ [key: string]: string }>({});
  const [visionText, setVisionText] = useState('');
  const [prompts, setPrompts] = useState<IntentPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [useModernStoryTableHandoff, setUseModernStoryTableHandoff] = useState(true);
  const [goalSearchTerm, setGoalSearchTerm] = useState('');
  const [prefillMatchTriggered, setPrefillMatchTriggered] = useState(false);

  // Reset on modal open
  useEffect(() => {
    if (show) {
      setStep('select');
      setSelectedGoalIds(new Set());
      setTimeframe('sprint');
      setError('');
      setStoriesCreated([]);
      setBucketsCreated({});
      setVisionText('');
      setPrompts([]);
      setSelectedPromptId('');
      setIntentResult(null);
      setUseModernStoryTableHandoff(true);
      setGoalSearchTerm('');
      setPrefillMatchTriggered(false);
    }
  }, [show]);

  useEffect(() => {
    if (!show || !initialPrefill) return;
    if (initialPrefill.timeframe) setTimeframe(initialPrefill.timeframe);
    if (initialPrefill.visionText) setVisionText(initialPrefill.visionText);
    if (initialPrefill.searchTerm) setGoalSearchTerm(initialPrefill.searchTerm);
  }, [show, initialPrefill]);

  const loadPrompts = async () => {
    setLoadingPrompts(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'getIntentBrokerPrompts');
      const res: any = await fn({});
      const nextPrompts = Array.isArray(res?.data?.prompts) ? res.data.prompts : [];
      setPrompts(nextPrompts);
      setSelectedPromptId(nextPrompts[0]?.id || '');
    } catch (e: any) {
      setError(e?.message || 'Failed to load Intent Broker prompts');
    } finally {
      setLoadingPrompts(false);
    }
  };

  useEffect(() => {
    if (!show) return;
    loadPrompts();
  }, [show]);

  // Calculate timeframe dates
  const timeframeInfo = useMemo(() => {
    const now = new Date();
    const daysInMs = {
      sprint: 14 * 24 * 60 * 60 * 1000,
      quarter: 91 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000
    };
    const endDate = new Date(now.getTime() + daysInMs[timeframe]);
    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    return {
      label:
        timeframe === 'sprint'
          ? `2 weeks (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`
          : timeframe === 'quarter'
            ? `13 weeks (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`
            : `1 year (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`,
      startDate: now,
      endDate,
      daysRemaining
    };
  }, [timeframe]);

  // Get selected goals
  const selectedGoals = useMemo(
    () => goals.filter(g => selectedGoalIds.has(g.id)),
    [goals, selectedGoalIds]
  );

  // Count goals needing stories
  const goalsNeedingStories = useMemo(
    () => selectedGoals.filter(g => (g as any).storyCount === undefined || (g as any).storyCount === 0),
    [selectedGoals]
  );

  // Count goals with costs needing savings buckets
  const goalsWithCosts = useMemo(
    () =>
      selectedGoals.filter(
        g =>
          g.estimatedCost && g.estimatedCost > 0 && (g.costType === 'one_off' || g.costType === 'recurring')
      ),
    [selectedGoals]
  );

  const gapAnalysis = useMemo(() => {
    const missingKpis = selectedGoals.filter((g) => !Array.isArray(g.kpis) || g.kpis.length === 0);
    const missingStories = goalsNeedingStories;
    const missingBuckets = goalsWithCosts.filter((g) => !g.linkedPotId && !g.potId);
    return {
      missingKpis,
      missingStories,
      missingBuckets,
    };
  }, [selectedGoals, goalsNeedingStories, goalsWithCosts]);

  const handleSelectGoal = (goalId: string) => {
    const newSet = new Set(selectedGoalIds);
    if (newSet.has(goalId)) {
      newSet.delete(goalId);
    } else {
      newSet.add(goalId);
    }
    setSelectedGoalIds(newSet);
  };

  const handleNext = async () => {
    if (step === 'select') {
      if (selectedGoalIds.size === 0) {
        setError('Please select at least 1 goal');
        return;
      }
      setStep('timeframe');
    } else if (step === 'timeframe') {
      setStep('vision');
    } else if (step === 'vision') {
      if (!visionText.trim()) {
        setError('Please provide a short vision before continuing.');
        return;
      }
      setStep('review');
      // Auto-create stories and buckets
      setLoading(true);
      try {
        const goalIds = Array.from(selectedGoalIds);

        // Auto-create stories
        if (goalsNeedingStories.length > 0) {
          const created = await onAutoCreateStories(goalsNeedingStories.map(g => g.id));
          setStoriesCreated(created);
        }

        // Auto-create savings buckets
        if (goalsWithCosts.length > 0) {
          const buckets = await onAutoCreateSavingsBuckets(goalsWithCosts);
          setBucketsCreated(buckets);
        }
      } catch (e) {
        setError(`Failed to create stories/buckets: ${(e as any)?.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    } else if (step === 'review') {
      setStep('confirm');
    }
  };

  const runIntentMatching = async () => {
    if (!visionText.trim()) {
      setError('Add your vision text first.');
      return;
    }

    setMatching(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'intentBrokerSuggestFocus');
      const res: any = await fn({
        visionText: visionText.trim(),
        selectedPromptId,
        promptIds: prompts.map((p) => p.id),
      });
      const nextResult = (res?.data || null) as IntentResult;
      setIntentResult(nextResult);

      const matchedGoalIds = (nextResult?.matches || [])
        .map((match) => String(match.goalId || '').trim())
        .filter(Boolean);
      if (matchedGoalIds.length > 0) {
        setSelectedGoalIds((prev) => {
          const next = new Set(prev);
          matchedGoalIds.forEach((goalId) => next.add(goalId));
          return next;
        });
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to run intent matching');
    } finally {
      setMatching(false);
    }
  };

  useEffect(() => {
    if (!show) return;
    if (!initialPrefill?.autoRunMatch) return;
    if (prefillMatchTriggered) return;
    if (!visionText.trim()) return;
    if (!selectedPromptId) return;
    if (loadingPrompts || matching) return;
    setPrefillMatchTriggered(true);
    runIntentMatching();
  }, [
    show,
    initialPrefill?.autoRunMatch,
    prefillMatchTriggered,
    visionText,
    selectedPromptId,
    loadingPrompts,
    matching,
  ]);

  const handleBack = () => {
    if (step === 'timeframe') setStep('select');
    else if (step === 'vision') setStep('timeframe');
    else if (step === 'review') setStep('vision');
    else if (step === 'confirm') setStep('review');
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const focusGoal: FocusGoal = {
        id: `focus-${Date.now()}`,
        ownerUid: '', // Will be set by Firestore trigger
        persona: 'personal',
        goalIds: Array.from(selectedGoalIds),
        timeframe: timeframe,
        startDate: timeframeInfo.startDate,
        endDate: timeframeInfo.endDate,
        daysRemaining: timeframeInfo.daysRemaining,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        storiesCreatedFor: storiesCreated,
        potIdsCreatedFor: bucketsCreated,
        visionText: visionText.trim() || undefined,
        intentBrokerIntakeId: intentResult?.intakeId || undefined,
        intentMatches: intentResult?.matches || [],
        intentProposals: intentResult?.proposals || [],
        storyTableHandoff: useModernStoryTableHandoff,
      };

      await onSave(focusGoal);
      if (useModernStoryTableHandoff && typeof window !== 'undefined') {
        window.localStorage.setItem('focusWizardStoryTableHandoff', '1');
      }
      onHide();
    } catch (e) {
      setError(`Failed to save focus goals: ${(e as any)?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const progressPercent = {
    select: 20,
    timeframe: 40,
    vision: 60,
    review: 80,
    confirm: 100
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <Zap size={20} className="me-2" style={{ display: 'inline', color: '#ffc107' }} />
          Focus Goals Wizard
        </Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {/* Progress bar */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
            <span style={{ fontWeight: '600' }}>
              {step === 'select'
                ? 'Step 1: Select Goals'
                : step === 'timeframe'
                  ? 'Step 2: Choose Timeframe'
                  : step === 'vision'
                    ? 'Step 3: Define Vision + Match'
                  : step === 'review'
                    ? 'Step 4: Review Checklist'
                    : 'Step 5: Confirm'}
            </span>
            <span style={{ color: '#666' }}>{progressPercent[step]}%</span>
          </div>
          <ProgressBar now={progressPercent[step]} />
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        {/* Step 1: Select Goals */}
        {step === 'select' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              Select which goals you want to focus on. You can choose 1 or more goals to track together.
            </p>

            {goals.length === 0 ? (
              <Alert variant="info">
                <AlertCircle size={16} className="me-2" style={{ display: 'inline' }} />
                No goals found. Create some goals first!
              </Alert>
            ) : (
              <>
              <Form.Group className="mb-2">
                <Form.Control
                  type="text"
                  value={goalSearchTerm}
                  onChange={(e) => setGoalSearchTerm(e.target.value)}
                  placeholder="Search goals by title..."
                />
              </Form.Group>
              <ListGroup>
                {goals
                  .filter(g => g.status !== 2) // Hide completed goals
                  .filter(g => {
                    if (!goalSearchTerm.trim()) return true;
                    return String(g.title || '').toLowerCase().includes(goalSearchTerm.toLowerCase());
                  })
                  .map(goal => (
                    <ListGroup.Item
                      key={goal.id}
                      style={{
                        cursor: 'pointer',
                        background: selectedGoalIds.has(goal.id) ? '#e7f5ff' : undefined,
                        borderColor: selectedGoalIds.has(goal.id) ? '#0066cc' : undefined
                      }}
                      onClick={() => handleSelectGoal(goal.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Form.Check
                          type="checkbox"
                          checked={selectedGoalIds.has(goal.id)}
                          readOnly
                          style={{ margin: 0 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '500' }}>{goal.title}</div>
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            Theme: {goal.theme || 'Not set'} • Status: {goal.status || 'New'}
                          </div>
                        </div>
                        {selectedGoalIds.has(goal.id) && (
                          <CheckCircle size={20} style={{ color: '#0066cc' }} />
                        )}
                      </div>
                    </ListGroup.Item>
                  ))}
              </ListGroup>
              </>
            )}

            <div style={{ marginTop: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
              <strong>{selectedGoalIds.size}</strong> goal{selectedGoalIds.size !== 1 ? 's' : ''} selected
            </div>
          </div>
        )}

        {/* Step 2: Choose Timeframe */}
        {step === 'timeframe' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              How long do you want to focus on these goals?
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              {(['sprint', 'quarter', 'year'] as const).map(tf => (
                <Card
                  key={tf}
                  style={{
                    cursor: 'pointer',
                    border: timeframe === tf ? '2px solid #0066cc' : '1px solid #ddd',
                    background: timeframe === tf ? '#e7f5ff' : undefined
                  }}
                  onClick={() => setTimeframe(tf)}
                >
                  <Card.Body style={{ padding: '12px', textAlign: 'center' }}>
                    <Calendar size={24} style={{ marginBottom: '8px', color: timeframe === tf ? '#0066cc' : '#666' }} />
                    <div style={{ fontWeight: '600', textTransform: 'capitalize' }}>{tf}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {tf === 'sprint' ? '2 weeks' : tf === 'quarter' ? '13 weeks' : '52 weeks'}
                    </div>
                  </Card.Body>
                </Card>
              ))}
            </div>

            <Alert variant="info" style={{ marginTop: '16px' }}>
              <div style={{ fontWeight: '600', marginBottom: '6px' }}>📅 {timeframeInfo.label}</div>
              <div style={{ fontSize: '12px' }}>
                That's <strong>{timeframeInfo.daysRemaining} days</strong> to achieve your focus goals
              </div>
            </Alert>
          </div>
        )}

        {/* Step 3: Vision + Intent Broker */}
        {step === 'vision' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              Capture the outcome you want, then run AI matching against your current goal snapshot.
            </p>

            <Form.Group className="mb-3">
              <Form.Label>Vision (free text)</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder="Describe the result you want and why it matters now..."
                value={visionText}
                onChange={(e) => setVisionText(e.target.value)}
              />
            </Form.Group>

            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>Intent prompt</strong>
              <Button size="sm" variant="outline-secondary" onClick={loadPrompts} disabled={loadingPrompts}>
                {loadingPrompts ? 'Refreshing...' : 'Refresh prompts'}
              </Button>
            </div>

            {loadingPrompts ? (
              <div className="py-2"><Spinner animation="border" size="sm" /> Loading prompts...</div>
            ) : (
              <Form.Select
                className="mb-3"
                value={selectedPromptId}
                onChange={(e) => setSelectedPromptId(e.target.value)}
              >
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.text}</option>
                ))}
              </Form.Select>
            )}

            <div className="d-flex justify-content-end mb-3">
              <Button variant="primary" onClick={runIntentMatching} disabled={!visionText.trim() || matching}>
                {matching ? 'Analyzing...' : 'Run AI Match'}
              </Button>
            </div>

            {intentResult?.snapshotMeta && (
              <Alert variant={intentResult.snapshotMeta.stale ? 'warning' : 'success'}>
                Snapshot {intentResult.snapshotMeta.stale ? 'stale' : 'fresh'} • v{intentResult.snapshotMeta.snapshotVersion || 'n/a'} • goals scanned: {intentResult.snapshotMeta.goalsScanned || 0}
              </Alert>
            )}

            {(intentResult?.matches || []).length > 0 && (
              <Alert variant="info">
                <strong>Existing goal matches</strong>
                <div style={{ fontSize: 12, marginTop: 4, marginBottom: 6 }}>
                  Matched goals are auto-selected in Step 1.
                </div>
                <ul style={{ marginBottom: 0, marginTop: 8 }}>
                  {(intentResult?.matches || []).slice(0, 5).map((m) => (
                    <li key={m.goalId}>{m.title} (score {m.score})</li>
                  ))}
                </ul>
              </Alert>
            )}

            {(intentResult?.proposals || []).length > 0 && (
              <Alert variant="warning">
                <strong>New-goal proposals</strong>
                <ul style={{ marginBottom: 0, marginTop: 8 }}>
                  {(intentResult?.proposals || []).slice(0, 3).map((p, idx) => (
                    <li key={`${p.title}-${idx}`}>{p.title} ({Math.round((p.confidence || 0) * 100)}% confidence)</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}

        {/* Step 4: Review Changes */}
        {step === 'review' && (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <h6 style={{ fontWeight: '600', marginBottom: '12px' }}>
                <Zap size={16} className="me-2" style={{ display: 'inline' }} />
                Strict Stage Checklist
              </h6>
              <ListGroup>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Goals selected: <strong>{selectedGoals.length}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Timeframe locked: <strong>{timeframeInfo.label}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Vision captured: <strong>{visionText.trim() ? 'Yes' : 'No'}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Intent matching run: <strong>{intentResult?.intakeId ? 'Yes' : 'Pending'}</strong>
                </ListGroup.Item>
              </ListGroup>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h6 style={{ fontWeight: 600 }}>Story planning matrix handoff</h6>
              <Form.Check
                type="switch"
                id="wizard-modern-story-toggle"
                label="Enable modern story table handoff after save"
                checked={useModernStoryTableHandoff}
                onChange={(e) => setUseModernStoryTableHandoff(e.target.checked)}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h6 style={{ fontWeight: 600 }}>AI gap analysis</h6>
              <ul style={{ marginBottom: 0, fontSize: '13px' }}>
                <li>{gapAnalysis.missingStories.length} selected goals currently have no stories</li>
                <li>{gapAnalysis.missingKpis.length} selected goals currently have no KPI definitions</li>
                <li>{gapAnalysis.missingBuckets.length} cost-based goals currently have no linked savings bucket</li>
              </ul>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Spinner animation="border" className="me-2" />
                Setting up your focus goals...
              </div>
            ) : (
              <>
                {/* Stories to Create */}
                {goalsNeedingStories.length > 0 && (
                  <Alert variant="warning" style={{ marginBottom: '12px' }}>
                    <BookOpen size={16} className="me-2" style={{ display: 'inline' }} />
                    <strong>{goalsNeedingStories.length} goals have no stories yet.</strong>
                    <br />
                    We'll auto-create a story for each to track progress.
                    <ul style={{ marginTop: '8px', marginBottom: 0, fontSize: '12px' }}>
                      {goalsNeedingStories.map(g => (
                        <li key={g.id}>{g.title}</li>
                      ))}
                    </ul>
                  </Alert>
                )}

                {/* Savings Buckets to Create */}
                {goalsWithCosts.length > 0 && (
                  <Alert variant="warning">
                    <DollarSign size={16} className="me-2" style={{ display: 'inline' }} />
                    <strong>{goalsWithCosts.length} goals have costs.</strong>
                    <br />
                    We'll auto-create Monzo savings buckets to track spending.
                    <ul style={{ marginTop: '8px', marginBottom: 0, fontSize: '12px' }}>
                      {goalsWithCosts.map(g => (
                        <li key={g.id}>
                          {g.title}: £
                          {(g.estimatedCost || 0).toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                )}

                {/* Already Created */}
                {storiesCreated.length > 0 && (
                  <Alert variant="success" style={{ marginBottom: '12px' }}>
                    <CheckCircle size={16} className="me-2" style={{ display: 'inline' }} />
                    ✓ Created <strong>{storiesCreated.length}</strong> stories
                  </Alert>
                )}

                {Object.keys(bucketsCreated).length > 0 && (
                  <Alert variant="success">
                    <CheckCircle size={16} className="me-2" style={{ display: 'inline' }} />
                    ✓ Created <strong>{Object.keys(bucketsCreated).length}</strong> savings buckets
                  </Alert>
                )}

                {goalsNeedingStories.length === 0 && goalsWithCosts.length === 0 && (
                  <Alert variant="info">
                    <CheckCircle size={16} className="me-2" style={{ display: 'inline' }} />
                    All goals already have stories and savings buckets set up!
                  </Alert>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 5: Confirm */}
        {step === 'confirm' && (
          <div>
            <Alert variant="success">
              <h6>🎯 Ready to Focus!</h6>
              <p style={{ marginBottom: '12px' }}>
                You're all set. Your focus goals will be:
              </p>
              <ul style={{ marginBottom: '12px' }}>
                {selectedGoals.map(g => (
                  <li key={g.id}>{g.title}</li>
                ))}
              </ul>
              <p style={{ marginBottom: 0 }}>
                <strong>Timeframe:</strong> {timeframeInfo.label}
                <br />
                <strong>Vision:</strong> {visionText.trim() || 'Not provided'}
                <br />
                <strong>Intent Intake:</strong> {intentResult?.intakeId || 'Not run'}
                <br />
                <strong>Updates:</strong> Your KPIs will sync nightly, and progress will show in your daily email.
              </p>
            </Alert>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={loading}>
          Cancel
        </Button>

        {step !== 'select' && (
          <Button variant="outline-secondary" onClick={handleBack} disabled={loading}>
            ← Back
          </Button>
        )}

        {step !== 'confirm' ? (
          <Button
            variant="primary"
            onClick={handleNext}
            disabled={
              loading || (step === 'select' && selectedGoalIds.size === 0)
            }
          >
            Next <ChevronRight size={16} style={{ display: 'inline', marginLeft: '6px' }} />
          </Button>
        ) : (
          <Button
            variant="success"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Saving...
              </>
            ) : (
              <>
                ✓ Save Focus Goals
              </>
            )}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default FocusGoalWizard;

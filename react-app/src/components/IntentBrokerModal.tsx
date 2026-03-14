import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface PromptItem {
  id: string;
  text: string;
}

interface IntentBrokerModalProps {
  show: boolean;
  onHide: () => void;
  ownerUid: string | null | undefined;
  persona: string | null | undefined;
}

const IntentBrokerModal: React.FC<IntentBrokerModalProps> = ({ show, onHide, ownerUid, persona }) => {
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [visionText, setVisionText] = useState('');
  const [result, setResult] = useState<any>(null);
  const [savingGoal, setSavingGoal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId) || null,
    [prompts, selectedPromptId]
  );

  const loadPrompts = async () => {
    setLoadingPrompts(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getIntentBrokerPrompts');
      const res: any = await fn({});
      const nextPrompts = res?.data?.prompts || [];
      setPrompts(nextPrompts);
      setSelectedPromptId(nextPrompts[0]?.id || '');
    } catch (e: any) {
      setError(e?.message || 'Failed to load prompts');
    } finally {
      setLoadingPrompts(false);
    }
  };

  useEffect(() => {
    if (!show) return;
    setVisionText('');
    setResult(null);
    setError(null);
    loadPrompts();
  }, [show]);

  const runMatch = async () => {
    if (!visionText.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'intentBrokerSuggestFocus');
      const res: any = await fn({
        visionText: visionText.trim(),
        selectedPromptId,
        promptIds: prompts.map((p) => p.id),
      });
      setResult(res?.data || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to run intent matching');
    } finally {
      setAnalyzing(false);
    }
  };

  const createGoalFromProposal = async (proposal: any) => {
    if (!ownerUid) return;
    setSavingGoal(true);
    setError(null);
    try {
      await addDoc(collection(db, 'goals'), {
        ownerUid,
        persona: persona || 'personal',
        title: String(proposal?.title || 'New Focus Goal').slice(0, 120),
        description: `Created via Intent Broker. ${proposal?.rationale || ''}`.trim(),
        status: 'new',
        priority: 2,
        intentBrokerTag: 'NEW',
        intentBrokerIntakeId: result?.intakeId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'intent_broker_events'), {
        ownerUid,
        type: 'created_goal_from_proposal',
        intakeId: result?.intakeId || null,
        proposal,
        createdAt: serverTimestamp(),
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to create goal from proposal');
    } finally {
      setSavingGoal(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Intent Broker</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Start with a guided prompt, capture your vision, and match it against your current goals using your latest snapshot.
        </p>

        {error && <Alert variant="danger">{error}</Alert>}

        <div className="d-flex align-items-center justify-content-between mb-2">
          <strong>Prompt</strong>
          <Button size="sm" variant="outline-secondary" onClick={loadPrompts} disabled={loadingPrompts}>
            {loadingPrompts ? 'Refreshing…' : 'Refresh prompts'}
          </Button>
        </div>

        {loadingPrompts ? (
          <div className="py-2"><Spinner animation="border" size="sm" /> Loading prompts…</div>
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

        {selectedPrompt && (
          <Alert variant="light" className="border">
            <small className="text-muted">Selected prompt</small>
            <div>{selectedPrompt.text}</div>
          </Alert>
        )}

        <Form.Group className="mb-3">
          <Form.Label>Vision / intake</Form.Label>
          <Form.Control
            as="textarea"
            rows={4}
            placeholder="Describe what you want to achieve and why now..."
            value={visionText}
            onChange={(e) => setVisionText(e.target.value)}
          />
        </Form.Group>

        <div className="d-flex justify-content-end mb-3">
          <Button variant="primary" onClick={runMatch} disabled={!visionText.trim() || analyzing}>
            {analyzing ? 'Analyzing…' : 'Match to goals'}
          </Button>
        </div>

        {result?.snapshotMeta && (
          <div className="mb-3">
            <Badge bg={result.snapshotMeta.stale ? 'warning' : 'success'}>
              Snapshot {result.snapshotMeta.stale ? 'stale' : 'fresh'}
            </Badge>
            <small className="text-muted ms-2">
              v{result.snapshotMeta.snapshotVersion || 'n/a'} • goals scanned: {result.snapshotMeta.goalsScanned || 0}
            </small>
          </div>
        )}

        {result?.matches?.length > 0 && (
          <div className="mb-3">
            <h6>Goal matches</h6>
            <ul className="mb-0">
              {result.matches.map((m: any) => (
                <li key={m.goalId}>
                  {m.title} <Badge bg="info">score {m.score}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result?.proposals?.length > 0 && (
          <div>
            <h6>New proposals</h6>
            {result.proposals.map((p: any, idx: number) => (
              <Alert key={`${p.title}-${idx}`} variant="warning" className="d-flex justify-content-between align-items-start">
                <div>
                  <div>
                    <Badge bg="dark" className="me-2">{p.tag || 'NEW'}</Badge>
                    <strong>{p.title}</strong>
                  </div>
                  <div className="text-muted" style={{ fontSize: 13 }}>{p.rationale}</div>
                </div>
                <Button size="sm" variant="primary" disabled={savingGoal} onClick={() => createGoalFromProposal(p)}>
                  {savingGoal ? 'Saving…' : 'Create goal'}
                </Button>
              </Alert>
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default IntentBrokerModal;

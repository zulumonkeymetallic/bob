import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Spinner, ListGroup, Badge, Form } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface ResearchDocModalProps {
  show: boolean;
  onHide: () => void;
  goalId?: string | null;
  storyId?: string | null;
}

type ResearchDoc = {
  id: string;
  title: string;
  createdAt?: any;
  updatedAt?: any;
  docMd?: string;
};

const ResearchDocModal: React.FC<ResearchDocModalProps> = ({ show, onHide, goalId, storyId }) => {
  const [docs, setDocs] = useState<ResearchDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [provider, setProvider] = useState<'gemini'|'openai'>('gemini');
  const [model, setModel] = useState<string>('gemini-1.5-flash');
  // functions imported from firebase has region preset

  useEffect(() => {
    if (!show) return;
    const clauses = [] as any[];
    if (goalId) clauses.push(where('goalId', '==', goalId));
    if (storyId) clauses.push(where('storyId', '==', storyId));
    if (clauses.length === 0) return;
    const q = query(collection(db, 'research_docs'), ...clauses, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ResearchDoc[];
      setDocs(rows);
      if (rows.length && !selectedId) setSelectedId(rows[0].id);
    });
    return () => unsub();
  }, [show, goalId, storyId]);

  const selected = useMemo(() => docs.find((d) => d.id === selectedId) || null, [docs, selectedId]);

  const rerun = async () => {
    try {
      setRunning(true);
      if (goalId) {
        const callable = httpsCallable(functions, 'orchestrateGoalPlanning');
        await callable({ goalId, researchOnly: true, researchProvider: provider, researchModel: model });
      } else if (storyId) {
        const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
        await callable({ storyId, researchOnly: true, researchProvider: provider, researchModel: model });
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to run research');
    } finally {
      setRunning(false);
    }
  };

  const generate = async () => {
    try {
      setRunning(true);
      const callable = httpsCallable(functions, 'generateStoriesFromResearch');
      await callable({ goalId, storyId, researchDocId: selectedId, generationProvider: provider, generationModel: model });
      alert('Generated stories/tasks from research');
    } catch (e: any) {
      alert(e?.message || 'Failed to generate from research');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered fullscreen="sm-down">
      <Modal.Header closeButton>
        <Modal.Title>Research</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex" style={{ gap: 16, minHeight: '50vh' }}>
          <div style={{ width: 260, flexShrink: 0 }}>
            <div className="mb-2">
              <Form.Label>LLM Provider</Form.Label>
              <Form.Select value={provider} onChange={(e) => {
                const p = e.target.value as 'gemini'|'openai';
                setProvider(p);
                setModel(p==='gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
              }}>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
              </Form.Select>
            </div>
            <div className="mb-2">
              <Form.Label>Model</Form.Label>
              <Form.Select value={model} onChange={(e) => setModel(e.target.value)}>
                {provider === 'gemini' ? (
                  <>
                    <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                    <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                  </>
                ) : (
                  <>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4o">gpt-4o</option>
                  </>
                )}
              </Form.Select>
            </div>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>Documents</strong>
              <Badge bg="secondary">{docs.length}</Badge>
            </div>
            <ListGroup>
              {docs.map((d) => (
                <ListGroup.Item
                  key={d.id}
                  action
                  active={d.id === selectedId}
                  onClick={() => setSelectedId(d.id)}
                >
                  {d.title || 'Research'}
                </ListGroup.Item>
              ))}
              {docs.length === 0 && (
                <ListGroup.Item disabled>No research documents yet</ListGroup.Item>
              )}
            </ListGroup>
          </div>
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            {selected ? (
              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial', lineHeight: 1.5 }}>
                <h5 className="mb-3">{selected.title}</h5>
                {selected.docMd || 'No content available.'}
              </div>
            ) : (
              <div className="text-muted">Select a document to view its content.</div>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Close</Button>
        <Button variant="outline-primary" onClick={rerun} disabled={running || (!goalId && !storyId)}>
          {running ? <Spinner animation="border" size="sm" /> : 'Re-run Research'}
        </Button>
        <Button variant="primary" onClick={generate} disabled={running || (!goalId && !storyId) || !selectedId}>
          {running ? <Spinner animation="border" size="sm" /> : 'Generate Stories & Tasks'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ResearchDocModal;

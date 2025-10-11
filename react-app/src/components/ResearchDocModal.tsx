import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Spinner, ListGroup, Badge } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

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
  const functions = useMemo(() => getFunctions(), []);

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
        await callable({ goalId, researchOnly: true });
      } else if (storyId) {
        const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
        await callable({ storyId, researchOnly: true });
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to run research');
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
        <Button variant="primary" onClick={rerun} disabled={running || (!goalId && !storyId)}>
          {running ? <Spinner animation="border" size="sm" /> : 'Re-run Research'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ResearchDocModal;

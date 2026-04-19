import React, { useMemo, useState } from 'react';
import { Modal, Button, Form, ListGroup, Badge, Alert } from 'react-bootstrap';
import { Goal } from '../types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ActivityStreamService } from '../services/ActivityStreamService';

interface Props {
  show: boolean;
  onClose: () => void;
  goal: Goal | null;
  goals: Goal[];
  currentUserId?: string;
  currentUserEmail?: string;
}

const LinkGoalModal: React.FC<Props> = ({ show, onClose, goal, goals, currentUserId, currentUserEmail }) => {
  const [search, setSearch] = useState('');
  const [selectedParent, setSelectedParent] = useState<string | null>(goal?.parentGoalId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build quick lookup map
  const goalMap = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);

  // Check if choosing candidate as parent would create a cycle
  const createsCycle = (candidateId: string, currentId: string) => {
    let cursor: string | undefined | null = candidateId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) break; // guard
      visited.add(cursor);
      if (cursor === currentId) return true;
      const parent = goalMap.get(cursor)?.parentGoalId;
      cursor = parent ?? null;
    }
    return false;
  };

  const candidates = useMemo(() => {
    if (!goal) return [] as Goal[];
    return goals
      .filter(g => g.id !== goal.id)
      .filter(g => !search || g.title.toLowerCase().includes(search.toLowerCase()))
      .filter(g => !createsCycle(g.id, goal.id));
  }, [goals, goal, search]);

  const handleSave = async () => {
    if (!goal) return;
    try {
      setSaving(true);
      setError(null);
      await updateDoc(doc(db, 'goals', goal.id), {
        parentGoalId: selectedParent ?? null,
        updatedAt: Date.now()
      });

      // Activity log
      try {
        await ActivityStreamService.addNote(
          goal.id,
          'goal',
          selectedParent
            ? `Linked to parent goal: ${goalMap.get(selectedParent)?.title ?? selectedParent}`
            : 'Cleared parent goal link',
          currentUserId || '',
          currentUserEmail || '',
          'personal'
        );
      } catch {}

      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save link');
    } finally {
      setSaving(false);
    }
  };

  // Reset selection when opening/goal changes
  React.useEffect(() => {
    setSelectedParent(goal?.parentGoalId ?? null);
    setSearch('');
    setError(null);
  }, [goal?.id, show]);

  return (
    <Modal show={show} onHide={onClose} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Link Goal {goal ? `– ${goal.title}` : ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger" className="mb-2">{error}</Alert>}
        <div className="d-flex align-items-center gap-2 mb-3">
          <Form.Control
            placeholder="Search goals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            variant="outline-secondary"
            onClick={() => setSelectedParent(null)}
          >
            Clear Parent
          </Button>
        </div>
        <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
          <ListGroup>
            {candidates.map(c => (
              <ListGroup.Item
                key={c.id}
                action
                active={selectedParent === c.id}
                onClick={() => setSelectedParent(c.id)}
                className="d-flex justify-content-between align-items-center"
              >
                <div>
                  <div className="fw-medium">{c.title}</div>
                  <small className="text-muted">{c.id}</small>
                </div>
                <Badge bg="light" text="dark">Theme {c.theme}</Badge>
              </ListGroup.Item>
            ))}
            {candidates.length === 0 && (
              <ListGroup.Item className="text-muted">No goals match your search</ListGroup.Item>
            )}
          </ListGroup>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Link'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default LinkGoalModal;

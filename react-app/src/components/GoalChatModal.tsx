import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface GoalChatModalProps {
  goalId: string;
  show: boolean;
  onHide: () => void;
}

const GoalChatModal: React.FC<GoalChatModalProps> = ({ goalId, show, onHide }) => {
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user'|'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const functions = useMemo(() => getFunctions(), []);

  useEffect(() => {
    if (!goalId || !show) return;
    const ref = query(collection(db, 'goal_chats', goalId, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(ref, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [goalId, show]);

  const send = async () => {
    if (!draft.trim() || !goalId) return;
    setSending(true);
    try {
      const callable = httpsCallable(functions, 'sendGoalChatMessage');
      await callable({ goalId, message: draft.trim() });
      setDraft('');
    } catch (e: any) {
      alert(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>AI Goal Assistant</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <div style={{
                background: m.role === 'user' ? 'var(--bs-primary)' : 'var(--bs-secondary-bg)',
                color: m.role === 'user' ? 'white' : 'inherit',
                padding: '8px 12px', borderRadius: 12
              }}>
                {m.content}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-muted">Start by asking a question about your goal. The assistant will propose next steps as tasks where helpful.</div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Form.Control
          placeholder="Type a message..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <Button variant="primary" onClick={send} disabled={sending || !draft.trim()}>
          {sending ? <Spinner animation="border" size="sm" /> : 'Send'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default GoalChatModal;


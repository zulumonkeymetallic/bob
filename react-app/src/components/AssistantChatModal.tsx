import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const AssistantChatModal: React.FC<{ show: boolean; onHide: () => void }> = ({ show, onHide }) => {
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user'|'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const functions = useMemo(() => getFunctions(), []);

  useEffect(() => {
    if (!currentUser?.uid || !show) return;
    const ref = query(collection(db, 'assistant_chats', currentUser.uid, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(ref, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [currentUser?.uid, show]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      const callable = httpsCallable(functions, 'sendAssistantMessage');
      await callable({ message: content, persona: 'personal', days: 2 });
      setDraft('');
    } catch (e: any) {
      alert(e?.message || 'Failed to send');
    } finally { setSending(false); }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered fullscreen="sm-down">
      <Modal.Header closeButton>
        <Modal.Title>Assistant</Modal.Title>
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
            <div className="text-muted">Ask the assistant to plan today or suggest next steps.</div>
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

export default AssistantChatModal;


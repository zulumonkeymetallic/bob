import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useProcessTextActivity } from '../contexts/ProcessTextActivityContext';
import AgentResponsePanel from './AgentResponsePanel';
import { AgentResponse, buildRequestId, submitAssistantAgentRequest } from '../services/agentClient';

interface AssistantChatModalProps {
  show: boolean;
  onHide: () => void;
}

const AssistantChatModal: React.FC<AssistantChatModalProps> = ({ show, onHide }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { reportAgentResult } = useProcessTextActivity();
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user'|'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [latestResult, setLatestResult] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.uid || !show) return;
    const ref = query(collection(db, 'assistant_chats', currentUser.uid, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(ref, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [currentUser?.uid, show]);

  const send = async (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content) return;
    setSending(true);
    setError(null);
    const requestId = buildRequestId('assistant_ui');
    try {
      const data = await submitAssistantAgentRequest({
        text: content,
        persona: currentPersona || 'personal',
        sourceProvidedId: requestId,
      });
      setLatestResult(data);
      if (data?.mode === 'write') {
        reportAgentResult({
          requestId,
          submittedText: content,
          result: data,
          source: 'assistant_ui',
        });
      }
      if (!text) setDraft('');
    } catch (e: any) {
      setError(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered fullscreen="sm-down">
      <Modal.Header closeButton>
        <Modal.Title>Assistant</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <div className="d-flex flex-wrap gap-2 mb-3">
          <Button variant="outline-secondary" size="sm" onClick={() => send('What are my top 3 priorities today?')} disabled={sending}>Top 3</Button>
          <Button variant="outline-secondary" size="sm" onClick={() => send('What is next on my calendar?')} disabled={sending}>Next Calendar</Button>
          <Button variant="outline-secondary" size="sm" onClick={() => send('Replan my day')} disabled={sending}>Replan Day</Button>
          <Button variant="outline-secondary" size="sm" onClick={() => send('Replan my week')} disabled={sending}>Replan Week</Button>
        </div>
        {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
        {latestResult && (
          <div className="mb-3">
            <AgentResponsePanel result={latestResult} />
          </div>
        )}
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
          {messages.length === 0 && !latestResult && (
            <div className="text-muted">Ask what is next on your calendar, what your top priorities are, paste a transcript, or ask for a replan.</div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Form.Control
          placeholder="Ask about calendar, sprint focus, or tasks..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <Button variant="primary" onClick={() => send()} disabled={sending || !draft.trim()}>
          {sending ? <Spinner animation="border" size="sm" /> : 'Send'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AssistantChatModal;

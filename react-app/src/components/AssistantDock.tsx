import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import AgentResponsePanel from './AgentResponsePanel';
import { AgentResponse, submitAssistantAgentRequest } from '../services/agentClient';

interface AssistantDockProps {
  open: boolean;
  onClose: () => void;
}

const AssistantDock: React.FC<AssistantDockProps> = ({ open, onClose }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user'|'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [latestResult, setLatestResult] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const ref = query(collection(db, 'assistant_chats', currentUser.uid, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(ref, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const send = async (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const data = await submitAssistantAgentRequest({
        text: content,
        persona: currentPersona || 'personal',
      });
      setLatestResult(data);
      if (!text) setDraft('');
    } catch (e: any) {
      setError(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const quickMenu = (
    <div className="d-flex flex-wrap gap-2 mb-2">
      <Button size="sm" variant="primary" onClick={() => send('What are my top 3 priorities today?')} disabled={sending}>Top 3</Button>
      <Button size="sm" variant="outline-secondary" onClick={() => send('What is next on my calendar?')} disabled={sending}>Next Calendar</Button>
      <Button size="sm" variant="outline-secondary" onClick={() => send('Replan my day')} disabled={sending}>Replan Day</Button>
      <Button size="sm" variant="outline-secondary" onClick={() => send('Replan my week')} disabled={sending}>Replan Week</Button>
    </div>
  );

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, background: 'var(--bs-body-bg)', borderLeft: '1px solid var(--bs-border-color)', zIndex: 1040, display: 'flex', flexDirection: 'column' }}>
      <div className="d-flex align-items-center justify-content-between p-2" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
        <div>
          <strong>Assistant</strong>
          {!!latestResult?.topPriorities?.length && (
            <Badge bg="info" className="ms-2">{latestResult.topPriorities.length} pri</Badge>
          )}
        </div>
        <Button size="sm" variant="outline-secondary" onClick={onClose}>Close</Button>
      </div>
      <div className="p-2" style={{ flex: 1, overflow: 'auto' }}>
        {quickMenu}
        {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
        {latestResult && (
          <div className="mb-3" style={{ borderBottom: '1px solid var(--bs-border-color)', paddingBottom: 12 }}>
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
      </div>
      <div className="p-2" style={{ borderTop: '1px solid var(--bs-border-color)' }}>
        <Form.Control
          placeholder="Ask about calendar, sprint focus, or tasks..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <div className="d-flex justify-content-end mt-2">
          <Button variant="primary" size="sm" onClick={() => send()} disabled={sending || !draft.trim()}>
            {sending ? <Spinner animation="border" size="sm" /> : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AssistantDock;

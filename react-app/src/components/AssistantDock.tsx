import React, { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { submitAssistantAgentRequestV2 } from '../services/agentClient';
import { useAuth } from '../contexts/AuthContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
}

interface AssistantDockProps {
  open: boolean;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  { label: 'Top 3', text: 'What are my top 3 priorities right now?' },
  { label: 'Daily plan', text: 'Give me my daily plan for today.' },
  { label: 'Finance', text: 'Summarise my spending this month.' },
  { label: 'Goals', text: 'List my active goals.' },
];

const AssistantDock: React.FC<AssistantDockProps> = ({ open, onClose }) => {
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the failure is a credential problem the user can fix in Settings → AI, rather
  // than a transient provider fault.
  const [needsKey, setNeedsKey] = useState(false);
  const [source, setSource] = useState<'vertex' | 'gemini' | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content || sending) return;

    const userMsg: Message = { role: 'user', content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    setError(null);

    try {
      const data = await submitAssistantAgentRequestV2({
        text: content,
        history: messages.slice(-10),
      });

      setSource(data.source ?? null);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.reply, toolsUsed: data.toolsUsed },
      ]);
    } catch (e: any) {
      // The callable carries a `code` in its details for credential failures
      // (see functions/utils/llmCredentials.js CODES).
      const code = e?.details?.code;
      setNeedsKey(
        code === 'missing_key' || code === 'invalid_key' || code === 'no_credit' ||
        e?.code === 'functions/failed-precondition',
      );
      setError(e?.message || 'Failed to get a response.');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
      background: 'var(--bs-body-bg)', borderLeft: '1px solid var(--bs-border-color)',
      zIndex: 1040, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between p-3" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
        <div className="d-flex align-items-center gap-2">
          <strong>BOB Assistant</strong>
          {/* Reflects what actually answered rather than a hardcoded 'Vertex AI': under
              bring-your-own-key most users now run on their own Gemini key. */}
          {source && (
            <Badge bg="success" style={{ fontSize: '0.65rem' }}>
              {source === 'vertex' ? 'Vertex AI' : 'Your Gemini key'}
            </Badge>
          )}
        </div>
        <div className="d-flex gap-2">
          {messages.length > 0 && (
            <Button size="sm" variant="outline-secondary" onClick={() => setMessages([])}>Clear</Button>
          )}
          <Button size="sm" variant="outline-secondary" onClick={onClose}>✕</Button>
        </div>
      </div>

      {/* Messages */}
      <div className="p-3" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <>
            <div className="text-muted small mb-2">
              Ask about your priorities, goals, finances, or create stories and tasks.
            </div>
            <div className="d-flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(q => (
                <Button key={q.label} size="sm" variant="outline-primary" onClick={() => send(q.text)} disabled={sending}>
                  {q.label}
                </Button>
              ))}
            </div>
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div style={{
              background: m.role === 'user' ? 'var(--bs-primary)' : 'var(--bs-secondary-bg)',
              color: m.role === 'user' ? 'white' : 'inherit',
              padding: '8px 12px',
              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              fontSize: '0.875rem',
            }}>
              {m.role === 'assistant' ? (
                <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
              ) : (
                m.content
              )}
            </div>
            {m.toolsUsed && m.toolsUsed.length > 0 && (
              <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                tools: {m.toolsUsed.join(', ')}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div style={{ alignSelf: 'flex-start' }}>
            <Spinner animation="grow" size="sm" className="text-muted" />
          </div>
        )}

        {error && (
          <Alert
            variant={needsKey ? 'warning' : 'danger'}
            className="py-2 px-3 mb-0"
            style={{ fontSize: '0.825rem' }}
          >
            {error}
            {/* A missing or rejected key is fixed in one place, so link straight there rather
                than leaving the user to find it. */}
            {needsKey && (
              <div className="mt-2">
                <Button size="sm" variant="outline-secondary" onClick={() => navigate('/settings?tab=ai')}>
                  Open AI settings
                </Button>
              </div>
            )}
          </Alert>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3" style={{ borderTop: '1px solid var(--bs-border-color)' }}>
        <Form.Control
          as="textarea"
          rows={2}
          placeholder="Ask about priorities, goals, finance, or create stories..."
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ resize: 'none', fontSize: '0.875rem' }}
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

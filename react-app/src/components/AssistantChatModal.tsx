import React, { useEffect, useState } from 'react';
import { Modal, Button, Form, Spinner, Badge } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface AssistantChatModalProps {
  show: boolean;
  onHide: () => void;
}

const AssistantChatModal: React.FC<AssistantChatModalProps> = ({ show, onHide }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user'|'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actions, setActions] = useState<any[] | null>(null);
  const [insights, setInsights] = useState<{ priorities?: string[]; warnings?: string[] } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

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
    try {
      const callable = httpsCallable(functions, 'sendAssistantMessage');
      const res = await callable({ message: content, persona: 'personal', days: 2 });
      const data = res.data as any;
      if (data?.suggested_actions) setActions(data.suggested_actions);
      if (data?.insights) setInsights(data.insights);
      if (!text) setDraft('');
    } catch (e: any) {
      alert(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const planToday = async () => {
    setWorking('plan');
    try {
      const callable = httpsCallable(functions, 'runPlanner');
      const startDate = new Date().toISOString().slice(0,10);
      const result = await callable({ persona: 'personal', startDate, days: 1 });
      const data:any = result.data || {};
      const blocksCreated = data?.llm?.blocksCreated || 0;
      const planned = Array.isArray(data?.schedule?.planned) ? data.schedule.planned.length : (data?.schedule?.plannedCount || 0);
      alert(`Planner updated. AI blocks: ${blocksCreated}, scheduled instances: ${planned}`);
      setActions(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to plan');
    } finally {
      setWorking(null);
    }
  };

  const createTask = async (title: string, estimateMin?: number) => {
    if (!currentUser?.uid) return;
    setWorking('task');
    try {
      const col = collection(db, 'tasks');
      // Lazy import to avoid tree-shaking issues
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const ref = doc(col);
      await setDoc(ref, {
        id: ref.id,
        ownerUid: currentUser.uid,
        persona: 'personal',
        title,
        description: 'Created via Assistant',
        status: 0,
        priority: 2,
        effort: 'S',
        estimated_duration: typeof estimateMin === 'number' ? estimateMin : 30,
        entry_method: 'assistant_chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
      alert('Task created');
      setActions(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to create task');
    } finally {
      setWorking(null);
    }
  };

  const handleAction = async (a: any) => {
    const t = String(a?.type || '').toLowerCase();
    if (t === 'plan_today') return planToday();
    if (t === 'open_approvals') return navigate('/planning/approvals');
    if (t === 'create_task') return createTask(String(a?.title || 'Next step'), Number(a?.estimateMin || 30));
    if (t === 'open_goal' && a?.goalId) return navigate(`/goals/roadmap?goalId=${a.goalId}`);
  };

  useEffect(() => {
    if (show && messages.length === 0) {
      // On first open, offer a Daily Summary generator
      setInsights(null);
      setActions([
        { type: 'plan_today' },
        { type: 'open_approvals' },
      ]);
    }
  }, [show, messages.length]);

  return (
    <Modal show={show} onHide={onHide} size="lg" centered fullscreen="sm-down">
      <Modal.Header closeButton>
        <Modal.Title>Assistant</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {insights && (
          <div className="mb-3">
            {insights.priorities && insights.priorities.length > 0 && (
              <div className="mb-2">
                <strong>Top Priorities</strong>
                <ul className="mb-0">
                  {insights.priorities.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {insights.warnings && insights.warnings.length > 0 && (
              <div className="mb-2" style={{ color: '#92400e' }}>
                <strong>Warnings</strong>
                <ul className="mb-0">
                  {insights.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
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
          {messages.length === 0 && (
            <div className="text-muted">Ask for a Daily Summary, priorities for today, or to plan the afternoon.</div>
          )}
          {actions && actions.length > 0 && (
            <div style={{ borderTop: '1px solid var(--bs-border-color)', paddingTop: 12 }}>
              <div className="mb-2" style={{ fontWeight: 600 }}>Suggested actions</div>
              <div className="d-flex flex-wrap gap-2">
                {actions.map((a, i) => {
                  const t = String(a?.type || '').toLowerCase();
                  const label = t === 'plan_today' ? 'Plan Today' : t === 'open_approvals' ? 'Open Approvals' : t === 'create_task' ? `Create Task: ${a?.title || 'Next step'}` : t === 'open_goal' ? 'Open Goal' : 'Action';
                  return (
                    <Button key={i} size="sm" variant={t === 'plan_today' ? 'primary' : 'outline-secondary'} onClick={() => handleAction(a)} disabled={!!working}>
                      {working ? <Spinner animation="border" size="sm" /> : label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={() => send('Daily summary for today')}>Daily Summary</Button>
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

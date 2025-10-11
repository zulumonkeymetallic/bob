import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Spinner, Badge } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { addDoc, doc, setDoc } from 'firebase/firestore';

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
  const [actions, setActions] = useState<any | null>(null);
  const [working, setWorking] = useState<string | null>(null);
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
      const res = await callable({ goalId, message: draft.trim() });
      const data = res.data as any;
      if (data?.actions) setActions(data.actions);
      setDraft('');
    } catch (e: any) {
      alert(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleCreateStory = async () => {
    if (!currentUser?.uid || !goalId) return;
    const title = actions?.create_story?.title || 'AI Story';
    const description = actions?.create_story?.description || 'Created from AI Goal Chat';
    setWorking('story');
    try {
      const ref = doc(collection(db, 'stories'));
      await setDoc(ref, {
        id: ref.id,
        ownerUid: currentUser.uid,
        persona: 'personal',
        goalId,
        title,
        description,
        status: 'backlog',
        priority: 'P2',
        entry_method: 'ai_chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
      setActions(null);
      alert('Story created');
    } catch (err: any) {
      alert('Failed to create story: ' + (err?.message || 'unknown'));
    } finally {
      setWorking(null);
    }
  };

  const handlePlanTime = async () => {
    if (!goalId) return;
    setWorking('plan');
    try {
      const callable = httpsCallable(functions, 'planCalendar');
      const minutes = Number(actions?.plan_minutes || 120);
      const result = await callable({ persona: 'personal', focusGoalId: goalId, goalTimeRequest: minutes, horizonDays: 1 });
      const data = result.data as any;
      alert(`Planned ${data?.blocksCreated || 0} blocks`);
      setActions(null);
    } catch (err: any) {
      alert('Failed to plan: ' + (err?.message || 'unknown'));
    } finally {
      setWorking(null);
    }
  };

  const handleOrchestrate = async () => {
    if (!goalId) return;
    setWorking('orchestrate');
    try {
      const callable = httpsCallable(functions, 'orchestrateGoalPlanning');
      await callable({ goalId });
      alert('Orchestration complete: research, stories, tasks, and schedule prepared.');
      setActions(null);
    } catch (err: any) {
      alert('Failed to orchestrate: ' + (err?.message || 'unknown'));
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered fullscreen="sm-down">
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
          {actions && (
            <div style={{ borderTop: '1px solid var(--bs-border-color)', paddingTop: 12 }}>
              <div className="mb-2" style={{ fontWeight: 600 }}>Suggested actions</div>
              <div className="d-flex flex-wrap gap-2">
                {actions?.create_story?.title && (
                  <Button size="sm" variant="outline-primary" onClick={handleCreateStory} disabled={working==="story"}>
                    {working==="story" ? <Spinner animation="border" size="sm" /> : 'Create Story'}
                  </Button>
                )}
                {typeof actions?.plan_minutes === 'number' && (
                  <Button size="sm" variant="outline-secondary" onClick={handlePlanTime} disabled={working==="plan"}>
                    {working==="plan" ? <Spinner animation="border" size="sm" /> : `AI Plan ${actions.plan_minutes}m`}
                  </Button>
                )}
                {actions?.orchestrate && (
                  <Button size="sm" variant="primary" onClick={handleOrchestrate} disabled={working==="orchestrate"}>
                    {working==="orchestrate" ? <Spinner animation="border" size="sm" /> : 'AI Orchestrate (Research + Plan)'}
                  </Button>
                )}
              </div>
            </div>
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

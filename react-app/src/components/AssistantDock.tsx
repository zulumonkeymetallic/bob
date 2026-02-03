import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Spinner, Badge } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { usePersona } from '../contexts/PersonaContext';

interface AssistantDockProps {
  open: boolean;
  onClose: () => void;
}

const AssistantDock: React.FC<AssistantDockProps> = ({ open, onClose }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedItem, selectedType } = useSidebar();
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user'|'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actions, setActions] = useState<any[] | null>(null);
  const [insights, setInsights] = useState<{ priorities?: string[]; warnings?: string[] } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

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
    try {
      const callable = httpsCallable(functions, 'sendAssistantMessage');
      const res = await callable({ message: content, persona: currentPersona || 'personal', days: 2 });
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
      const result = await callable({ persona: currentPersona || 'personal', startDate, days: 1 });
      const data:any = result.data || {};
      const blocksCreated = data?.llm?.blocksCreated || (Array.isArray(data?.llm?.blocks) ? data.llm.blocks.length : 0);
      const planned = Array.isArray(data?.schedule?.planned) ? data.schedule.planned.length : (data?.schedule?.plannedCount || 0);
      alert(`Planner updated. AI blocks: ${blocksCreated}, scheduled instances: ${planned}`);
      setActions(null);
    } catch (e: any) { alert(e?.message || 'Failed to plan'); }
    finally { setWorking(null); }
  };

  const orchestrateSelected = async () => {
    if (!selectedItem || selectedType !== 'goal') return;
    setWorking('orchestrate');
    try {
      const callable = httpsCallable(functions, 'orchestrateGoalPlanning');
      await callable({ goalId: (selectedItem as any).id });
      alert('Orchestration complete.');
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setWorking(null); }
  };

  const generateStoriesSelected = async () => {
    try {
      setWorking('stories');
      if (selectedType === 'story') {
        const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
        await callable({ storyId: (selectedItem as any).id, research: false });
        alert('Generated tasks and scheduled time.');
      } else if (selectedType === 'goal') {
        // use generate from research if available; otherwise orchestrate fast
        const callable = httpsCallable(functions, 'orchestrateGoalPlanning');
        await callable({ goalId: (selectedItem as any).id, researchOnly: false });
        alert('Generated stories/tasks and scheduled time.');
      } else {
        alert('Select a goal or story to generate from.');
      }
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setWorking(null); }
  };

  const quickMenu = (
    <div className="d-flex flex-wrap gap-2 mb-2">
      <Button size="sm" variant="primary" onClick={() => send('Start goal intake')}>New Goal (AI Intake)</Button>
      <Button size="sm" variant="outline-secondary" onClick={planToday} disabled={working==='plan'}>
        {working==='plan' ? <Spinner animation="border" size="sm" /> : 'Plan Today'}
      </Button>
      <Button size="sm" variant="outline-secondary" onClick={generateStoriesSelected} disabled={!!working}>Generate Stories</Button>
      <Button size="sm" variant="outline-secondary" onClick={orchestrateSelected} disabled={!!working}>Orchestrate Goal</Button>
    </div>
  );

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, background: 'var(--bs-body-bg)', borderLeft: '1px solid var(--bs-border-color)', zIndex: 1040, display: 'flex', flexDirection: 'column' }}>
      <div className="d-flex align-items-center justify-content-between p-2" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
        <div>
          <strong>Assistant</strong>
          {insights && insights.priorities && insights.priorities.length > 0 && (
            <Badge bg="info" className="ms-2">{insights.priorities.length} pri</Badge>
          )}
        </div>
        <Button size="sm" variant="outline-secondary" onClick={onClose}>Close</Button>
      </div>
      <div className="p-2" style={{ flex: 1, overflow: 'auto' }}>
        {quickMenu}
        {insights && (
          <div className="mb-2">
            {insights.priorities && insights.priorities.length > 0 && (
              <div className="mb-2">
                <div className="fw-semibold">Top Priorities</div>
                <ul className="mb-0">
                  {insights.priorities.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            {insights.warnings && insights.warnings.length > 0 && (
              <div className="mb-2" style={{ color: '#92400e' }}>
                <div className="fw-semibold">Warnings</div>
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
            <div className="text-muted">Ask for a Daily Summary, plan your afternoon, or generate stories from the selected goal/story.</div>
          )}
          {actions && actions.length > 0 && (
            <div style={{ borderTop: '1px solid var(--bs-border-color)', paddingTop: 12 }}>
              <div className="mb-2" style={{ fontWeight: 600 }}>Suggested actions</div>
              <div className="d-flex flex-wrap gap-2">
                {actions.map((a, i) => (
                  <Badge key={i} bg="secondary">{String(a?.type || 'action')}</Badge>
                ))}
              </div>
            </div>
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

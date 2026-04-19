import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Alert, Row, Col } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const DEFAULT_PROMPT = `You are an assistant generating concise agile user stories and KPIs for a single goal.
Return JSON only with fields:
{
  "kpis": [ { "name": string, "target": number, "unit": string } ],
  "stories": [ { "title": string, "description": string, "points": number, "priority": 1|2|3 } ]
}
Constraints:
- 3-6 stories, Mostly small/medium.
- KPIs measurable, aligned with the goal.
Tone: clear, actionable, user-centric.`;

const AIStoryKPISettings: React.FC = () => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [model, setModel] = useState<string>('gemini-2.5-flash-lite');
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPT);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'user_settings', currentUser.uid));
        if (snap.exists()) {
          const d: any = snap.data();
          setModel(d.storyGenModel || 'gemini-2.5-flash-lite');
          setPrompt(d.storyGenPrompt || DEFAULT_PROMPT);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load AI settings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser]);

  const save = async () => {
    if (!currentUser) return;
    setLoading(true);
    setSaved(false);
    setError(null);
    try {
      await setDoc(doc(db, 'user_settings', currentUser.uid), {
        storyGenModel: model.trim() || 'gemini-2.5-flash-lite',
        storyGenPrompt: prompt,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Failed to save AI settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Card.Header>
        <h4 className="mb-0">AI: Story & KPI Generation</h4>
        <small className="text-muted">Configure model and prompt used by goal story generation</small>
      </Card.Header>
      <Card.Body>
        {saved && <Alert variant="success">Settings saved</Alert>}
        {error && <Alert variant="danger">{error}</Alert>}

        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Model</Form.Label>
              <Form.Control value={model} onChange={e => setModel(e.target.value)} placeholder="gemini-2.5-flash-lite" disabled={loading} />
              <Form.Text className="text-muted">Examples: gemini-2.5-flash-lite, gemini-1.5-flash, gpt-4o-mini</Form.Text>
            </Form.Group>
          </Col>
        </Row>

        <Form.Group className="mb-3">
          <Form.Label>Prompt</Form.Label>
          <Form.Control as="textarea" rows={8} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={loading} />
          <Form.Text className="text-muted">Used to steer story and KPI generation. Must output JSON as documented.</Form.Text>
        </Form.Group>

        <Button variant="primary" onClick={save} disabled={loading}>
          {loading ? 'Saving…' : 'Save Settings'}
        </Button>
      </Card.Body>
    </Card>
  );
};

export default AIStoryKPISettings;

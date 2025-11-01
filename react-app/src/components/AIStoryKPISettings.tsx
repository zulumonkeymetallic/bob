import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Alert, Row, Col } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

type Provider = 'openai' | 'vertex';

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

  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState<string>('gpt-4o-mini');
  const [vertexLocation, setVertexLocation] = useState<string>('us-central1');
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPT);
  const [applyByDefault, setApplyByDefault] = useState<boolean>(true);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'ai_settings', currentUser.uid));
        if (snap.exists()) {
          const d: any = snap.data();
          setProvider((d.provider || 'openai') as Provider);
          setModel(d.model || (d.provider === 'vertex' ? 'gemini-1.5-flash' : 'gpt-4o-mini'));
          setVertexLocation(d.vertexLocation || 'us-central1');
          setPrompt(d.prompt || DEFAULT_PROMPT);
          setApplyByDefault(Boolean(d.applyByDefault ?? true));
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
      await setDoc(doc(db, 'ai_settings', currentUser.uid), {
        provider,
        model,
        vertexLocation,
        prompt,
        applyByDefault,
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
        <small className="text-muted">Configure provider, model, and prompt used by the Generate button</small>
      </Card.Header>
      <Card.Body>
        {saved && <Alert variant="success">Settings saved</Alert>}
        {error && <Alert variant="danger">{error}</Alert>}

        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Provider</Form.Label>
              <Form.Select value={provider} onChange={e => setProvider(e.target.value as Provider)} disabled={loading}>
                <option value="openai">OpenAI</option>
                <option value="vertex">Google Vertex AI</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Model</Form.Label>
              <Form.Control value={model} onChange={e => setModel(e.target.value)} placeholder={provider === 'vertex' ? 'gemini-1.5-flash' : 'gpt-4o-mini'} disabled={loading} />
              <Form.Text className="text-muted">Examples: gpt-4o-mini, gpt-4o, gemini-1.5-flash, gemini-1.5-pro</Form.Text>
            </Form.Group>
          </Col>
          {provider === 'vertex' && (
            <Col md={4}>
              <Form.Group>
                <Form.Label>Vertex Location</Form.Label>
                <Form.Control value={vertexLocation} onChange={e => setVertexLocation(e.target.value)} disabled={loading} />
                <Form.Text className="text-muted">e.g., us-central1, europe-west2</Form.Text>
              </Form.Group>
            </Col>
          )}
        </Row>

        <Form.Group className="mb-3">
          <Form.Label>Prompt</Form.Label>
          <Form.Control as="textarea" rows={8} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={loading} />
          <Form.Text className="text-muted">Used to steer story and KPI generation. Must output JSON as documented.</Form.Text>
        </Form.Group>

        <Form.Check
          type="switch"
          id="apply-by-default"
          label="Apply generated stories/KPIs automatically"
          checked={applyByDefault}
          onChange={e => setApplyByDefault(e.target.checked)}
          className="mb-3"
        />

        <Button variant="primary" onClick={save} disabled={loading}>
          {loading ? 'Saving…' : 'Save Settings'}
        </Button>
      </Card.Body>
    </Card>
  );
};

export default AIStoryKPISettings;


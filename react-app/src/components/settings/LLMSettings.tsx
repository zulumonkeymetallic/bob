import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert, Badge, Button, Card, Col, Form,
  Row, Spinner, Tab, Tabs,
} from 'react-bootstrap';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Provider = 'gemini' | 'openai' | 'anthropic';

interface ModelOption {
  id: string;
  name: string;
  contextWindow: number | null;
  tier: string;
  description: string | null;
}

interface Personality {
  intelligence: number;
  humour: number;
  sarcasm: number;
  directness: number;
  warmth: number;
  verbosity: number;
}

interface TestResult {
  ok: boolean;
  response?: string;
  latencyMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PERSONALITY: Personality = {
  intelligence: 5,
  humour: 5,
  sarcasm: 5,
  directness: 7,
  warmth: 5,
  verbosity: 5,
};

const PROVIDERS: { id: Provider; label: string; color: string; logo: string }[] = [
  { id: 'gemini',    label: 'Google Gemini',    color: '#4285F4', logo: '🔵' },
  { id: 'openai',    label: 'OpenAI / ChatGPT', color: '#10A37F', logo: '🟢' },
  { id: 'anthropic', label: 'Anthropic (Claude)', color: '#D97706', logo: '🟠' },
];

const PERSONALITY_DIMS: { key: keyof Personality; label: string; low: string; high: string }[] = [
  { key: 'intelligence', label: 'Intelligence',  low: 'Plain language',     high: 'Expert vocabulary' },
  { key: 'humour',       label: 'Humour',        low: 'None',               high: 'Witty' },
  { key: 'sarcasm',      label: 'Sarcasm',       low: 'None',               high: 'Dry & sarcastic' },
  { key: 'directness',   label: 'Directness',    low: 'Explanatory',        high: 'Blunt' },
  { key: 'warmth',       label: 'Warmth',        low: 'Neutral',            high: 'Warm & encouraging' },
  { key: 'verbosity',    label: 'Verbosity',     low: 'Terse',              high: 'Detailed' },
];

const TIER_BADGE: Record<string, string> = {
  premium:   'warning',
  standard:  'primary',
  fast:      'success',
  reasoning: 'info',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Per-provider API keys — each provider can have its own key
type ApiKeys = Record<Provider, string>;
const EMPTY_KEYS: ApiKeys = { gemini: '', openai: '', anthropic: '' };

// Per-feature model routing
type FeatureKey = 'telegram' | 'journal' | 'digest' | 'story' | 'taskEnrich' | 'planning' | 'finance';
interface FeatureConfig { provider: Provider | ''; model: string; }
type FeatureConfigMap = Partial<Record<FeatureKey, FeatureConfig>>;

const FEATURES: { key: FeatureKey; label: string; description: string; tip?: string }[] = [
  {
    key: 'telegram',
    label: 'Telegram / Agent',
    description: 'Telegram messages, task capture, and agent-driven actions.',
    tip: 'claude-haiku-3-5 is great here — fast, conversational, cheap.',
  },
  {
    key: 'journal',
    label: 'Journal Processing',
    description: 'Voice and text transcript analysis into journal entries.',
    tip: 'A fast model works well; journal processing runs frequently.',
  },
  {
    key: 'digest',
    label: 'Daily / Weekly Digest',
    description: 'Morning briefing, weekly review, and email digest generation.',
    tip: 'Worth using a premium model — this is the summary you read every day.',
  },
  {
    key: 'story',
    label: 'Story & Goal Chat',
    description: 'Agile story generation, acceptance criteria, goal chat, and research docs.',
    tip: 'Standard or premium model recommended for quality output.',
  },
  {
    key: 'taskEnrich',
    label: 'Task Enrichment',
    description: 'Auto-enrichment of new tasks: spell-check, point estimation, tagging, story-point sizing.',
    tip: 'A fast/cheap model is ideal — this runs on every task you create.',
  },
  {
    key: 'planning',
    label: 'Planning & Prioritisation',
    description: 'Day replanning, nightly priority scoring, backlog triage, and calendar block generation.',
    tip: 'Nightly scoring runs for all your tasks — use a fast model to keep costs low.',
  },
  {
    key: 'finance',
    label: 'Finance & Categorisation',
    description: 'Monzo transaction categorisation and monthly spend commentary.',
    tip: 'Transaction categorisation runs frequently; a fast model keeps costs minimal.',
  },
];

const LLMSettings: React.FC = () => {
  const { currentUser } = useAuth();

  // Provider + keys + model
  const [provider, setProvider] = useState<Provider>('gemini');
  const [apiKeys, setApiKeys] = useState<ApiKeys>({ ...EMPTY_KEYS }); // per-provider
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Convenience: key for the currently selected provider
  const apiKey = apiKeys[provider] ?? '';

  // Model list
  const [modelList, setModelList] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSource, setModelsSource] = useState<'live' | 'fallback' | null>(null);

  // Connection test
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Personality
  const [personality, setPersonality] = useState<Personality>({ ...DEFAULT_PERSONALITY });

  // Prompts
  const [journalPrompt, setJournalPrompt] = useState('');
  const [systemPromptOverride, setSystemPromptOverride] = useState('');

  // Per-feature routing overrides
  const [featureConfig, setFeatureConfig] = useState<FeatureConfigMap>({});

  // Story & KPI generation (stored in user_settings/{uid})
  const [storyGenModel, setStoryGenModel] = useState('gemini-2.5-flash-lite');
  const [storyGenPrompt, setStoryGenPrompt] = useState(
    `You are an assistant generating concise agile user stories and KPIs for a single goal.\nReturn JSON only with fields:\n{\n  "kpis": [ { "name": string, "target": number, "unit": string } ],\n  "stories": [ { "title": string, "description": string, "points": number, "priority": 1|2|3 } ]\n}\nConstraints:\n- 3-6 stories, mostly small/medium.\n- KPIs measurable, aligned with the goal.\nTone: clear, actionable, user-centric.`
  );

  // Save states
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Fetch model list from backend (live if key supplied, curated fallback otherwise)
  const fetchModels = useCallback(async (prov: Provider, key: string) => {
    setModelsLoading(true);
    setModelsSource(null);
    setTestResult(null);
    try {
      const fn = httpsCallable<{ provider: string; apiKey: string }, { ok: boolean; source: string; models: ModelOption[] }>(
        functions, 'getAIModels',
      );
      const result = await fn({ provider: prov, apiKey: key });
      setModelList(result.data.models || []);
      setModelsSource(result.data.source as 'live' | 'fallback');
      // Keep saved model if it's in the list; otherwise default to first
      const ids = (result.data.models || []).map((m) => m.id);
      setModel((prev) => (ids.includes(prev) ? prev : (ids[0] || '')));
    } catch (e: any) {
      console.warn('getAIModels failed:', e?.message);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Load profile + user_settings, then fetch live models if a key is saved
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      const [profileSnap, settingsSnap] = await Promise.all([
        getDoc(doc(db, 'profiles', currentUser.uid)),
        getDoc(doc(db, 'user_settings', currentUser.uid)),
      ]);

      let resolvedProvider: Provider = 'gemini';
      let resolvedKey = '';
      let resolvedModel = '';

      if (profileSnap.exists()) {
        const data = profileSnap.data() || {};
        if (data.aiProvider)             { resolvedProvider = data.aiProvider as Provider; setProvider(resolvedProvider); }
        if (data.aiModel)                { resolvedModel = data.aiModel;                   setModel(resolvedModel); }
        if (data.aiPersonality)          setPersonality({ ...DEFAULT_PERSONALITY, ...data.aiPersonality });
        if (data.journalEditorPrompt)    setJournalPrompt(data.journalEditorPrompt);
        if (data.aiSystemPromptOverride) setSystemPromptOverride(data.aiSystemPromptOverride);
        if (data.aiFeatureConfig)        setFeatureConfig(data.aiFeatureConfig as FeatureConfigMap);

        // Per-provider keys (new schema) with fallback to legacy single-key field
        const savedKeys: ApiKeys = { ...EMPTY_KEYS };
        if (data.aiApiKeys && typeof data.aiApiKeys === 'object') {
          Object.assign(savedKeys, data.aiApiKeys);
        } else if (data.aiApiKey) {
          // Migrate: old single key → assign to the saved provider
          savedKeys[resolvedProvider] = data.aiApiKey;
        }
        setApiKeys(savedKeys);
        resolvedKey = savedKeys[resolvedProvider] ?? '';
      }
      if (settingsSnap.exists()) {
        const sd = settingsSnap.data() || {};
        if (sd.storyGenModel)  setStoryGenModel(sd.storyGenModel);
        if (sd.storyGenPrompt) setStoryGenPrompt(sd.storyGenPrompt);
      }

      // Fetch models with the resolved values (bypasses stale closure on apiKey)
      await fetchModels(resolvedProvider, resolvedKey);

      // Re-apply saved model after list loads (fetchModels may have overwritten it)
      if (resolvedModel) setModel((prev) => prev || resolvedModel);
    })();
  }, [currentUser, fetchModels]);

  // Re-fetch curated list whenever provider changes (key stays the same)
  useEffect(() => {
    setTestResult(null);
    fetchModels(provider, apiKey);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleTestConnection = async () => {
    if (!apiKey || !model) return;
    setTesting(true);
    setTestResult(null);
    try {
      const fn = httpsCallable<{ provider: string; apiKey: string; model: string }, TestResult>(
        functions, 'testLLMConnection',
      );
      const result = await fn({ provider, apiKey, model });
      setTestResult(result.data);
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAll = async () => {
    if (!currentUser) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      // Serialise per-provider keys (store null for empty entries)
      const serialisedKeys: Record<string, string | null> = {};
      for (const p of ['gemini', 'openai', 'anthropic'] as Provider[]) {
        serialisedKeys[p] = apiKeys[p]?.trim() || null;
      }

      await Promise.all([
        setDoc(doc(db, 'profiles', currentUser.uid), {
          aiProvider:             provider,
          aiApiKeys:              serialisedKeys,  // per-provider keys
          aiApiKey:               null,             // clear legacy field
          aiModel:                model || null,
          aiPersonality:          personality,
          journalEditorPrompt:    journalPrompt.trim() || null,
          aiSystemPromptOverride: systemPromptOverride.trim() || null,
          aiFeatureConfig:        featureConfig,
        }, { merge: true }),
        setDoc(doc(db, 'user_settings', currentUser.uid), {
          storyGenModel:  storyGenModel.trim() || 'gemini-2.5-flash-lite',
          storyGenPrompt: storyGenPrompt,
          updatedAt:      serverTimestamp(),
        }, { merge: true }),
      ]);
      setSavedMsg('All AI settings saved.');
    } catch (e: any) {
      setSavedMsg(`Error: ${e?.message || 'Save failed'}`);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container py-4" style={{ maxWidth: 800 }}>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h2 className="mb-0">AI Settings</h2>
          <p className="text-muted mb-0 mt-1">
            Choose your AI provider, supply your own API key, and personalise how BOB communicates with you.
          </p>
        </div>
        <Button variant="primary" disabled={saving} onClick={handleSaveAll}>
          {saving ? <><Spinner size="sm" animation="border" className="me-2" />Saving…</> : 'Save all changes'}
        </Button>
      </div>

      {savedMsg && (
        <Alert
          variant={savedMsg.startsWith('Error') ? 'danger' : 'success'}
          dismissible
          onClose={() => setSavedMsg(null)}
        >
          {savedMsg}
        </Alert>
      )}

      <Tabs defaultActiveKey="provider" className="mb-3" fill>

        {/* ------------------------------------------------------------------ */}
        {/* TAB 1: Provider & Model                                              */}
        {/* ------------------------------------------------------------------ */}
        <Tab eventKey="provider" title="Provider & Model">

          {/* Provider selector */}
          <Card className="mb-3">
            <Card.Header><strong>AI Provider</strong></Card.Header>
            <Card.Body>
              <Row className="g-2">
                {PROVIDERS.map((p) => (
                  <Col key={p.id} md={4}>
                    <div
                      className={`p-3 rounded border text-center cursor-pointer ${provider === p.id ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setProvider(p.id)}
                    >
                      <div style={{ fontSize: '1.8rem' }}>{p.logo}</div>
                      <div className="fw-semibold mt-1" style={{ fontSize: '0.9rem' }}>{p.label}</div>
                    </div>
                  </Col>
                ))}
              </Row>
            </Card.Body>
          </Card>

          {/* Per-provider API Key */}
          <Card className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <div>
                <strong>API Key — {PROVIDERS.find((p) => p.id === provider)?.label}</strong>
                <small className="text-muted ms-2">Each provider stores its own key independently.</small>
              </div>
              {(['gemini', 'openai', 'anthropic'] as Provider[]).map((p) => (
                apiKeys[p] ? (
                  <Badge key={p} bg="success" className="ms-1" style={{ fontSize: '0.65rem' }}>
                    {p} ✓
                  </Badge>
                ) : null
              ))}
            </Card.Header>
            <Card.Body>
              <div className="d-flex gap-2">
                <Form.Control
                  type={showKey ? 'text' : 'password'}
                  placeholder={`Paste your ${PROVIDERS.find((p) => p.id === provider)?.label} API key`}
                  value={apiKey}
                  onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
                  style={{ fontFamily: apiKey ? 'monospace' : 'inherit' }}
                />
                <Button
                  variant="outline-secondary"
                  onClick={() => setShowKey((v) => !v)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {showKey ? 'Hide' : 'Show'}
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => fetchModels(provider, apiKey)}
                  disabled={modelsLoading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {modelsLoading ? <Spinner size="sm" animation="border" /> : '↻ Refresh'}
                </Button>
              </div>
              <Form.Text className="text-muted">
                {provider === 'gemini'    && <>Get a key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>. Leave blank to use BOB's shared Gemini key.</>}
                {provider === 'openai'    && <>Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a></>}
                {provider === 'anthropic' && <>Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a></>}
              </Form.Text>
            </Card.Body>
          </Card>

          {/* Model selector */}
          <Card className="mb-3">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <strong>Model</strong>
              {modelsSource && (
                <Badge bg={modelsSource === 'live' ? 'success' : 'secondary'}>
                  {modelsSource === 'live' ? '✓ Live from provider' : 'Curated list'}
                </Badge>
              )}
            </Card.Header>
            <Card.Body>
              {modelsLoading ? (
                <div className="text-center py-3"><Spinner animation="border" size="sm" /> <span className="ms-2 text-muted">Loading models…</span></div>
              ) : modelList.length === 0 ? (
                <p className="text-muted mb-0">No models loaded yet. Click "↻ Refresh" above.</p>
              ) : (
                <Row className="g-2">
                  {modelList.map((m) => (
                    <Col key={m.id} md={6}>
                      <div
                        className={`p-2 rounded border small d-flex align-items-start gap-2 ${model === m.id ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setModel(m.id)}
                      >
                        <Form.Check
                          type="radio"
                          checked={model === m.id}
                          onChange={() => setModel(m.id)}
                          className="mt-0 flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="d-flex align-items-center gap-1 flex-wrap">
                            <span className="fw-semibold">{m.name}</span>
                            <Badge bg={TIER_BADGE[m.tier] || 'secondary'} style={{ fontSize: '0.65rem' }}>
                              {m.tier}
                            </Badge>
                            {m.contextWindow && (
                              <Badge bg="light" text="dark" style={{ fontSize: '0.65rem' }}>
                                {Math.round(m.contextWindow / 1000)}k ctx
                              </Badge>
                            )}
                          </div>
                          {m.description && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{m.description}</div>}
                        </div>
                      </div>
                    </Col>
                  ))}
                </Row>
              )}
            </Card.Body>
          </Card>

          {/* Test connection */}
          <Card className="mb-3">
            <Card.Header><strong>Test Connection</strong></Card.Header>
            <Card.Body>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <Button
                  variant="outline-primary"
                  disabled={!apiKey || !model || testing}
                  onClick={handleTestConnection}
                >
                  {testing
                    ? <><Spinner size="sm" animation="border" className="me-2" />Testing…</>
                    : '▶ Test connection'}
                </Button>
                {!apiKey && <small className="text-muted">Enter your API key first</small>}
                {!model && apiKey && <small className="text-muted">Select a model first</small>}
              </div>

              {testResult && (
                <Alert
                  variant={testResult.ok ? 'success' : 'danger'}
                  className="mt-3 mb-0"
                >
                  {testResult.ok ? (
                    <>
                      <strong>✓ Connected</strong> · {testResult.latencyMs}ms
                      {testResult.response && (
                        <div className="mt-1 font-monospace small">{testResult.response}</div>
                      )}
                    </>
                  ) : (
                    <>
                      <strong>✗ Failed</strong>
                      {testResult.latencyMs && <span> · {testResult.latencyMs}ms</span>}
                      <div className="mt-1 small">{testResult.error}</div>
                    </>
                  )}
                </Alert>
              )}
            </Card.Body>
          </Card>

        </Tab>

        {/* ------------------------------------------------------------------ */}
        {/* TAB 2: Personality                                                   */}
        {/* ------------------------------------------------------------------ */}
        <Tab eventKey="personality" title="Personality">
          <Card className="mb-3">
            <Card.Header>
              <strong>AI Personality</strong>
              <small className="text-muted ms-2">
                Personalise the tone and style of all AI responses across transcripts, tasks, digest, and more.
              </small>
            </Card.Header>
            <Card.Body>
              <Row className="g-4">
                {PERSONALITY_DIMS.map(({ key, label, low, high }) => (
                  <Col key={key} md={6}>
                    <Form.Label className="d-flex justify-content-between mb-1">
                      <span>{label}</span>
                      <Badge bg="secondary">{personality[key]}</Badge>
                    </Form.Label>
                    <Form.Range
                      min={0}
                      max={10}
                      step={1}
                      value={personality[key]}
                      onChange={(e) =>
                        setPersonality((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                      }
                    />
                    <div className="d-flex justify-content-between">
                      <small className="text-muted">{low}</small>
                      <small className="text-muted">{high}</small>
                    </div>
                  </Col>
                ))}
              </Row>
              <Button
                variant="link"
                size="sm"
                className="mt-3 ps-0"
                onClick={() => setPersonality({ ...DEFAULT_PERSONALITY })}
              >
                Reset to defaults
              </Button>
              <Form.Text className="d-block text-muted mt-1">
                Values at 5 are neutral and produce no change. These feed into every AI prompt — transcripts,
                daily digest, task enrichment, stories, and more.
              </Form.Text>
            </Card.Body>
          </Card>
        </Tab>

        {/* ------------------------------------------------------------------ */}
        {/* TAB 3: Prompts                                                       */}
        {/* ------------------------------------------------------------------ */}
        <Tab eventKey="prompts" title="Prompts">

          {/* Global system prompt override */}
          <Card className="mb-3">
            <Card.Header>
              <strong>Global System Prompt Override</strong>
              <small className="text-muted ms-2">Prepended to every AI call, across all features.</small>
            </Card.Header>
            <Card.Body>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder={`e.g. "Always respond in British English. Treat tasks related to swimming training as high priority."`}
                value={systemPromptOverride}
                onChange={(e) => setSystemPromptOverride(e.target.value)}
              />
              <Form.Text className="text-muted">
                Use this for global preferences — house style, domain context, or standing instructions.
                Keep it concise; overly long overrides can crowd out task-specific prompts.
              </Form.Text>
            </Card.Body>
          </Card>

          {/* Journal editor prompt */}
          <Card className="mb-3">
            <Card.Header>
              <strong>Journal Editor Prompt</strong>
              <small className="text-muted ms-2">Appended to the journal transcript processing prompt only.</small>
            </Card.Header>
            <Card.Body>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder={`e.g. "Pay special attention to mood and energy patterns. Flag any mentions of sleep quality."`}
                value={journalPrompt}
                onChange={(e) => setJournalPrompt(e.target.value)}
              />
              <Form.Text className="text-muted">
                This only affects journal and mixed transcript entries. Use it for deltas — extra
                analytical emphasis, tone, or tagging rules — not to replicate the full base prompt.
              </Form.Text>
            </Card.Body>
          </Card>

          {/* Cost guidance */}
          <Card className="mb-3 border-warning">
            <Card.Header className="bg-warning bg-opacity-10">
              <strong>⚠️ Cost awareness</strong>
            </Card.Header>
            <Card.Body>
              <p className="mb-2">
                When you supply your own API key, all AI calls in BOB use your quota and billing.
                BOB's daily quota system still applies (capping calls per day per feature) but you
                control the per-call cost by choosing your model.
              </p>
              <table className="table table-sm mb-0">
                <thead>
                  <tr><th>Tier</th><th>Examples</th><th>Best for</th></tr>
                </thead>
                <tbody>
                  <tr><td><Badge bg="warning" text="dark">premium</Badge></td><td>Gemini Pro, GPT-4o, Claude Opus</td><td>Weekly reviews, complex planning</td></tr>
                  <tr><td><Badge bg="primary">standard</Badge></td><td>Gemini Flash, GPT-4o Mini, Claude Sonnet</td><td>Daily digest, task enrichment</td></tr>
                  <tr><td><Badge bg="success">fast</Badge></td><td>Gemini Flash Lite, Claude Haiku</td><td>Quick capture, triage, voice</td></tr>
                </tbody>
              </table>
            </Card.Body>
          </Card>

        </Tab>

        {/* ------------------------------------------------------------------ */}
        {/* Story & KPI Generation                                               */}
        {/* ------------------------------------------------------------------ */}
        <Tab eventKey="story" title="Story & KPI">

          <Card className="mb-3">
            <Card.Header>
              <strong>Story & KPI Generation</strong>
              <small className="text-muted ms-2">Prompt and model used when generating stories and KPIs from a goal.</small>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Model override <small className="text-muted">(leave blank to use your selected model above)</small></Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g. gemini-2.5-flash-lite"
                  value={storyGenModel}
                  onChange={(e) => setStoryGenModel(e.target.value)}
                />
                <Form.Text className="text-muted">
                  Story & KPI generation works best with a fast model since it produces structured JSON.
                  Using a cheap model here keeps costs low even when your primary model is premium.
                </Form.Text>
              </Form.Group>
              <Form.Group>
                <Form.Label>Generation prompt</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={10}
                  value={storyGenPrompt}
                  onChange={(e) => setStoryGenPrompt(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <Form.Text className="text-muted">
                  Must instruct the model to return JSON with <code>kpis</code> and <code>stories</code> arrays.
                  Modifying the structure may break goal generation — test after any changes.
                </Form.Text>
              </Form.Group>
            </Card.Body>
          </Card>

        </Tab>

        {/* ------------------------------------------------------------------ */}
        {/* Per-Feature routing                                                  */}
        {/* ------------------------------------------------------------------ */}
        <Tab eventKey="features" title="Per Feature">

          <Card className="mb-3">
            <Card.Header>
              <strong>Per-Feature Model Routing</strong>
              <small className="text-muted ms-2">
                Override the provider and model for specific BOB features. Leave blank to use your global default.
              </small>
            </Card.Header>
            <Card.Body className="p-0">
              <table className="table table-hover mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: '30%' }}>Feature</th>
                    <th style={{ width: '22%' }}>Provider override</th>
                    <th>Model override</th>
                    <th style={{ width: '5%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map(({ key, label, description, tip }) => {
                    const cfg = featureConfig[key] || { provider: '' as const, model: '' };
                    const setField = (field: keyof FeatureConfig, val: string) =>
                      setFeatureConfig((prev) => ({
                        ...prev,
                        [key]: { ...cfg, [field]: val },
                      }));
                    return (
                      <tr key={key}>
                        <td>
                          <div className="fw-semibold">{label}</div>
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>{description}</div>
                          {tip && <div className="text-info" style={{ fontSize: '0.7rem', marginTop: 2 }}>💡 {tip}</div>}
                        </td>
                        <td>
                          <Form.Select
                            size="sm"
                            value={cfg.provider || ''}
                            onChange={(e) => setField('provider', e.target.value)}
                          >
                            <option value="">— global default —</option>
                            {PROVIDERS.map((p) => (
                              <option key={p.id} value={p.id}>{p.logo} {p.label}</option>
                            ))}
                          </Form.Select>
                        </td>
                        <td>
                          <Form.Control
                            size="sm"
                            type="text"
                            placeholder="e.g. claude-haiku-3-5 (blank = default)"
                            value={cfg.model || ''}
                            onChange={(e) => setField('model', e.target.value)}
                          />
                        </td>
                        <td>
                          {(cfg.provider || cfg.model) && (
                            <Button
                              variant="link"
                              size="sm"
                              className="text-muted p-0"
                              title="Clear override"
                              onClick={() =>
                                setFeatureConfig((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                })
                              }
                            >
                              ✕
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card.Body>
          </Card>

          <Card className="border-info">
            <Card.Body className="py-2 px-3">
              <small className="text-muted">
                <strong>How it works:</strong> When BOB processes a Telegram message, journal entry, or daily digest,
                it checks your feature override first. If set, it uses that provider and model (with your API key
                for that provider). If not set, it falls back to your global default above.
                <br />
                <strong>Tip:</strong> Set Telegram to <code>anthropic · claude-haiku-3-5</code> for conversational
                responses, keep Journal on fast Gemini for speed, and use a premium model for your weekly digest.
              </small>
            </Card.Body>
          </Card>

        </Tab>

      </Tabs>

      <div className="d-flex justify-content-end mt-3">
        <Button variant="primary" disabled={saving} onClick={handleSaveAll}>
          {saving ? <><Spinner size="sm" animation="border" className="me-2" />Saving…</> : 'Save all changes'}
        </Button>
      </div>
    </div>
  );
};

export default LLMSettings;

import React, { useMemo, useState } from 'react';
import { Card, Button, Alert, Badge } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

const SettingsDiagnostics: React.FC = () => {
  // functions from firebase is region-configured
  const [status, setStatus] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runStatus = async () => {
    setBusy('status'); setMsg(null); setErr(null);
    try {
      const callable = httpsCallable(functions, 'diagnosticsStatus');
      const res = await callable({});
      setStatus(res.data);
      setMsg('Diagnostics status fetched.');
    } catch (e: any) {
      setErr(e?.message || 'Failed to fetch diagnostics');
    } finally { setBusy(null); }
  };

  const testLLM = async () => {
    setBusy('llm'); setMsg(null); setErr(null);
    try {
      const callable = httpsCallable(functions, 'testLLM');
      const res = await callable({});
      setMsg('LLM test succeeded.');
    } catch (e: any) {
      setErr(e?.message || 'LLM test failed');
    } finally { setBusy(null); }
  };

  const testEmail = async () => {
    setBusy('email'); setMsg(null); setErr(null);
    try {
      const callable = httpsCallable(functions, 'sendTestEmail');
      const res = await callable({});
      setMsg('Sent test email to your profile address.');
    } catch (e: any) {
      setErr(e?.message || 'Test email failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="container py-3">
      <h1 className="h4 mb-3">Diagnostics</h1>
      {err && <Alert variant="danger">{err}</Alert>}
      {msg && <Alert variant="success">{msg}</Alert>}

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <div className="mb-1"><strong>Environment</strong></div>
              <div className="text-muted" style={{ fontSize: 13 }}>Check configured secrets and endpoints.</div>
            </div>
            <Button variant="outline-primary" size="sm" onClick={runStatus} disabled={busy==='status'}>
              {busy==='status' ? 'Checking…' : 'Check Status'}
            </Button>
          </div>
          {status && (
            <div className="mt-3 d-flex gap-3 flex-wrap">
              <span>Gemini: <Badge bg={status.hasGemini ? 'success' : 'secondary'}>{String(!!status.hasGemini)}</Badge></span>
              <span>Nylas: <Badge bg={status.hasNylas ? 'success' : 'secondary'}>{String(!!status.hasNylas)}</Badge></span>
              <span>OpenAI: <Badge bg={status.hasOpenAI ? 'success' : 'secondary'}>{String(!!status.hasOpenAI)}</Badge></span>
              <span>App Base URL: <Badge bg={status.appBaseUrl ? 'info' : 'secondary'}>{status.appBaseUrl || 'not set'}</Badge></span>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <div className="mb-1"><strong>Test LLM</strong></div>
              <div className="text-muted" style={{ fontSize: 13 }}>Runs a minimal Gemini call to verify connectivity.</div>
            </div>
            <Button variant="outline-secondary" size="sm" onClick={testLLM} disabled={busy==='llm'}>
              {busy==='llm' ? 'Testing…' : 'Run LLM Test'}
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <div className="mb-1"><strong>Test Email</strong></div>
              <div className="text-muted" style={{ fontSize: 13 }}>Sends a test message to your profile email via Nylas.</div>
            </div>
            <Button variant="outline-secondary" size="sm" onClick={testEmail} disabled={busy==='email'}>
              {busy==='email' ? 'Sending…' : 'Send Test Email'}
            </Button>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default SettingsDiagnostics;

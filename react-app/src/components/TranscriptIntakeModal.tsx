import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';

import { usePersona } from '../contexts/PersonaContext';
import AgentResponsePanel from './AgentResponsePanel';
import {
  AgentResponse,
  buildRequestId,
  submitTranscriptAgentRequest,
} from '../services/agentClient';

interface TranscriptIntakeModalProps {
  show: boolean;
  onHide: () => void;
}

const TranscriptIntakeModal: React.FC<TranscriptIntakeModalProps> = ({ show, onHide }) => {
  const { currentPersona } = usePersona();
  const [transcript, setTranscript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!show) {
      setTranscript('');
      setSubmitting(false);
      setError(null);
      setResult(null);
      setRequestId(null);
    }
  }, [show]);

  const handleSubmit = async () => {
    const value = transcript.trim();
    if (!value) return;
    const nextRequestId = buildRequestId();
    setSubmitting(true);
    setError(null);
    setResult(null);
    setRequestId(nextRequestId);
    try {
      const body = await submitTranscriptAgentRequest({
        text: value,
        persona: currentPersona,
        source: 'web_fab',
        sourceProvidedId: nextRequestId,
      });
      console.info('[TranscriptIntakeModal] ingest success', {
        requestId: nextRequestId,
        ingestionId: body?.ingestionId || null,
        resultType: body?.resultType || null,
        entryType: body?.entryType || null,
      });
      setResult((body || {}) as AgentResponse);
    } catch (submissionError: any) {
      console.error('[TranscriptIntakeModal] ingest failed', {
        requestId: nextRequestId,
        error: submissionError,
      });
      setError(submissionError?.message || 'Text processing failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Process Text</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {result?.duplicate && (
          <Alert variant="info">
            {result.message || 'This text was already processed. No new ingestion was started.'}
          </Alert>
        )}
        {result && !result.duplicate && (
          <Alert variant="success">
            Text processed successfully.
          </Alert>
        )}

      <Form.Group className="mb-3">
        <Form.Label>Text or URLs</Form.Label>
        <Form.Control
            as="textarea"
            rows={10}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Paste a transcript, journal entry, notes, or URLs here. Exact duplicate submissions are ignored before they reach the model."
            disabled={submitting || !!result}
          />
          <Form.Text className="text-muted">
            The input is classified first. Journal entries append to your Google Doc and create a journal record. Task lists or URL-only inputs skip Google Docs and create top-level tasks/stories only.
          </Form.Text>
        </Form.Group>

        {requestId && (
          <div className="mb-1 text-muted small">
            Request ID: {requestId}
          </div>
        )}

        {result?.ingestionId && (
          <div className="mb-3 text-muted small">
            Ingestion ID: {result.ingestionId}
          </div>
        )}
        {result && <AgentResponsePanel result={result} />}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result && (
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || !transcript.trim()}>
            {submitting ? (
              <>
                <Spinner size="sm" animation="border" className="me-2" />
                Processing…
              </>
            ) : (
              'Process Text'
            )}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default TranscriptIntakeModal;

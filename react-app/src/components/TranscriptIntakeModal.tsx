import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, ListGroup, Modal, Spinner } from 'react-bootstrap';

import { auth, firebaseConfig } from '../firebase';
import { usePersona } from '../contexts/PersonaContext';

interface TranscriptEntityLink {
  id: string;
  ref: string;
  title: string;
  deepLink: string;
  existing?: boolean;
}

interface TranscriptIngestionResult {
  ok: boolean;
  duplicate?: boolean;
  message?: string;
  ingestionId?: string | null;
  entryType?: string | null;
  hasJournal?: boolean;
  resultType?: string;
  journalId?: string | null;
  docUrl?: string | null;
  dateHeading?: string | null;
  oneLineSummary?: string | null;
  structuredEntry?: string | null;
  advice?: string | null;
  fullTranscript?: string | null;
  createdTasks?: TranscriptEntityLink[];
  createdStories?: TranscriptEntityLink[];
}

interface TranscriptIntakeModalProps {
  show: boolean;
  onHide: () => void;
}

const TRANSCRIPT_REGION = 'europe-west2';

function buildTranscriptEndpoint() {
  return `https://${TRANSCRIPT_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/ingestTranscriptHttp`;
}

function buildRequestId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `web_fab_${Date.now()}_${rand}`;
}

function extractErrorMessage(errorBody: any, fallback: string) {
  const details = errorBody?.details || errorBody?.error?.details || {};
  const message = (
    errorBody?.error?.message ||
    errorBody?.message ||
    fallback
  );
  const pieces = [
    message,
    details?.ingestionId ? `Ingestion ID: ${details.ingestionId}` : null,
  ].filter(Boolean);
  return pieces.join(' ');
}

const TranscriptIntakeModal: React.FC<TranscriptIntakeModalProps> = ({ show, onHide }) => {
  const { currentPersona } = usePersona();
  const [transcript, setTranscript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptIngestionResult | null>(null);
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
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sign in required');
      }
      const token = await user.getIdToken();
      const response = await fetch(buildTranscriptEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          transcript: value,
          persona: currentPersona,
          source: 'web_fab',
          sourceProvidedId: nextRequestId,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, 'Text processing failed'));
      }
      console.info('[TranscriptIntakeModal] ingest success', {
        requestId: nextRequestId,
        ingestionId: body?.ingestionId || null,
        resultType: body?.resultType || null,
        entryType: body?.entryType || null,
      });
      setResult((body || {}) as TranscriptIngestionResult);
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

        {result?.oneLineSummary && (
          <div className="mb-3">
            <h6>Summary</h6>
            <div>{result.oneLineSummary}</div>
          </div>
        )}

        {result?.structuredEntry && (
          <div className="mb-3">
            <h6>Processed Text</h6>
            <div style={{ whiteSpace: 'pre-wrap' }}>{result.structuredEntry}</div>
          </div>
        )}

        {result?.advice && (
          <div className="mb-3">
            <h6>Advice</h6>
            <div style={{ whiteSpace: 'pre-wrap' }}>{result.advice}</div>
          </div>
        )}

        {!!result?.createdStories?.length && (
          <div className="mb-3">
            <h6>Stories</h6>
            <ListGroup>
              {result.createdStories.map((story) => (
                <ListGroup.Item key={story.id}>
                  <a href={story.deepLink}>{story.ref}</a>
                  {' — '}
                  {story.title}
                  {story.existing ? ' (existing)' : ''}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}

        {!!result?.createdTasks?.length && (
          <div className="mb-3">
            <h6>Tasks</h6>
            <ListGroup>
              {result.createdTasks.map((task) => (
                <ListGroup.Item key={task.id}>
                  <a href={task.deepLink}>{task.ref}</a>
                  {' — '}
                  {task.title}
                  {task.existing ? ' (existing)' : ''}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}

        {result?.journalId && (
          <div className="mb-2">
            <a href={`/journals/${result.journalId}`}>
              Open journal entry
            </a>
          </div>
        )}

        {result?.docUrl && (
          <div className="mb-1">
            <a href={result.docUrl} target="_blank" rel="noreferrer">
              Open Google Doc
            </a>
          </div>
        )}
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

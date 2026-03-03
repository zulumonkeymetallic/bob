import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, ListGroup, Modal, Spinner } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';
import { usePersona } from '../contexts/PersonaContext';

interface TranscriptEntityLink {
  id: string;
  ref: string;
  title: string;
  deepLink: string;
}

interface TranscriptIngestionResult {
  ok: boolean;
  duplicate?: boolean;
  message?: string;
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

const TranscriptIntakeModal: React.FC<TranscriptIntakeModalProps> = ({ show, onHide }) => {
  const { currentPersona } = usePersona();
  const [transcript, setTranscript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptIngestionResult | null>(null);

  useEffect(() => {
    if (!show) {
      setTranscript('');
      setSubmitting(false);
      setError(null);
      setResult(null);
    }
  }, [show]);

  const handleSubmit = async () => {
    const value = transcript.trim();
    if (!value) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const ingestTranscript = httpsCallable(functions, 'ingestTranscript');
      const response: any = await ingestTranscript({
        transcript: value,
        persona: currentPersona,
        source: 'web_fab',
      });
      setResult((response?.data || response) as TranscriptIngestionResult);
    } catch (submissionError: any) {
      console.error('[TranscriptIntakeModal] ingest failed', submissionError);
      setError(submissionError?.message || 'Transcript ingestion failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Transcript Intake</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {result?.duplicate && (
          <Alert variant="info">
            {result.message || 'This transcript was already processed. No new ingestion was started.'}
          </Alert>
        )}
        {result && !result.duplicate && (
          <Alert variant="success">
            Transcript processed successfully.
          </Alert>
        )}

        <Form.Group className="mb-3">
          <Form.Label>Transcript or URLs</Form.Label>
          <Form.Control
            as="textarea"
            rows={10}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Paste a transcript, notes, or URLs here. Exact duplicate submissions are ignored before they reach the model."
            disabled={submitting || !!result}
          />
          <Form.Text className="text-muted">
            The journal entry is cleaned, appended to your configured Google Doc, then any extracted tasks or stories are created as top-level items.
          </Form.Text>
        </Form.Group>

        {result?.oneLineSummary && (
          <div className="mb-3">
            <h6>Summary</h6>
            <div>{result.oneLineSummary}</div>
          </div>
        )}

        {result?.structuredEntry && (
          <div className="mb-3">
            <h6>Journal Entry</h6>
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
                </ListGroup.Item>
              ))}
            </ListGroup>
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
              'Process Transcript'
            )}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default TranscriptIntakeModal;

import React from 'react';
import { Button, Form, Modal } from 'react-bootstrap';

interface TranscriptIntakeModalProps {
  show: boolean;
  onHide: () => void;
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onSubmit: () => void;
}

const TranscriptIntakeModal: React.FC<TranscriptIntakeModalProps> = ({
  show,
  onHide,
  transcript,
  onTranscriptChange,
  onSubmit,
}) => {
  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Process Text</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>Paste the transcription from your voice note</Form.Label>
          <Form.Control
            as="textarea"
            rows={12}
            value={transcript}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="Paste a voice-note transcript, task list, journal entry, notes, or URLs here."
            autoFocus
          />
          <Form.Text className="text-muted">
            The same backend classifies the text, extracts tasks or stories, and only appends Google Docs when the content is genuinely a journal entry.
          </Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={!transcript.trim()}>
          Process Text
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default TranscriptIntakeModal;

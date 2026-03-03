import React from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';

import { usePersona } from '../contexts/PersonaContext';
import { useProcessTextActivity } from '../contexts/ProcessTextActivityContext';
import type { AgentResponse } from '../services/agentClient';
import AgentResponsePanel from './AgentResponsePanel';
import TranscriptIntakeModal from './TranscriptIntakeModal';

function buildTranscriptBannerPayload(result: AgentResponse) {
  return {
    ok: result.ok,
    duplicate: result.duplicate || false,
    mode: result.mode || null,
    intent: result.intent || null,
    confidence: result.confidence ?? null,
    resultType: result.resultType || null,
    entryType: result.entryType || null,
    spokenResponse: result.spokenResponse || null,
    request: {
      ingestionId: result.ingestionId || null,
      journalId: result.journalId || null,
      docUrl: result.docUrl || null,
      processedAt: result.processedAt || null,
    },
    processedDocument: result.processedDocument || {
      dateHeading: result.dateHeading || null,
      oneLineSummary: result.oneLineSummary || null,
      structuredEntry: result.structuredEntry || null,
      advice: result.advice || null,
      fullTranscript: result.fullTranscript || null,
    },
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    googleDoc: result.googleDoc || null,
    createdTasks: Array.isArray(result.createdTasks) ? result.createdTasks : [],
    createdStories: Array.isArray(result.createdStories) ? result.createdStories : [],
    calendarEvents: Array.isArray(result.calendarEvents) ? result.calendarEvents : [],
    topPriorities: Array.isArray(result.topPriorities) ? result.topPriorities : [],
    replan: result.replan || null,
  };
}

const ProcessTextActivityHost: React.FC = () => {
  const { currentPersona } = usePersona();
  const {
    banner,
    composerOpen,
    composerText,
    closeComposer,
    setComposerText,
    dismissBanner,
    submitComposer,
    reopenComposerFromBanner,
  } = useProcessTextActivity();

  const warnings = Array.isArray(banner?.result?.warnings) ? banner?.result?.warnings : [];
  const variant = banner?.status === 'processing'
    ? 'info'
    : banner?.status === 'success'
      ? (banner?.result?.duplicate ? 'info' : (warnings.length ? 'warning' : 'success'))
      : 'danger';

  return (
    <>
      {banner && (
        <div className="px-3 pt-3">
          <Alert variant={variant} dismissible onClose={dismissBanner} className="mb-0 shadow-sm">
            <div className="d-flex align-items-center gap-2 mb-2">
              {banner.status === 'processing' && <Spinner animation="border" size="sm" />}
              <strong>
                {banner.status === 'processing'
                  ? 'Processing text'
                  : banner.status === 'success'
                    ? (banner.result?.duplicate ? 'Text already processed' : 'Text processed')
                    : 'Text processing failed'}
              </strong>
            </div>

            <div className="small text-muted mb-2">
              Request ID: {banner.requestId}
              {banner.result?.ingestionId ? ` · Ingestion ID: ${banner.result.ingestionId}` : ''}
            </div>

            {banner.status === 'processing' && (
              <div className="small">
                The composer has closed. This banner will update with the journal, task, and story links when processing completes.
              </div>
            )}

            {banner.status === 'success' && banner.result && (
              <>
                <AgentResponsePanel result={banner.result} />
                <details className="mt-3">
                  <summary style={{ cursor: 'pointer' }}>Response JSON</summary>
                  <pre
                    className="mt-2 mb-0 p-2 rounded"
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 280,
                      overflowY: 'auto',
                      background: 'rgba(0, 0, 0, 0.04)',
                      fontSize: 12,
                    }}
                  >
                    {JSON.stringify(buildTranscriptBannerPayload(banner.result), null, 2)}
                  </pre>
                </details>
              </>
            )}

            {banner.status === 'error' && (
              <>
                <div className="mb-2">{banner.error || 'Text processing failed'}</div>
                <Button variant="link" className="p-0" onClick={reopenComposerFromBanner}>
                  Resubmit in Process Text
                </Button>
              </>
            )}
          </Alert>
        </div>
      )}

      <TranscriptIntakeModal
        show={composerOpen}
        onHide={closeComposer}
        transcript={composerText}
        onTranscriptChange={setComposerText}
        onSubmit={() => submitComposer(currentPersona || 'personal')}
      />
    </>
  );
};

export default ProcessTextActivityHost;

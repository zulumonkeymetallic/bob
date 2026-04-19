import React from 'react';
import { Alert, Badge, ListGroup } from 'react-bootstrap';

import { AgentResponse } from '../services/agentClient';

interface AgentResponsePanelProps {
  result: AgentResponse;
}

const AgentResponsePanel: React.FC<AgentResponsePanelProps> = ({ result }) => {
  if (!result) return null;

  return (
    <>
      {result.duplicate && (
        <Alert variant="info">
          {result.message || 'This text was already processed. No new ingestion was started.'}
        </Alert>
      )}

      {!!result.warnings?.length && (
        <Alert variant="warning">
          <div className="fw-semibold mb-1">Warnings</div>
          <ul className="mb-0 ps-3">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code || warning.scope || 'warning'}_${index}`}>
                {warning.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {result.spokenResponse && (
        <div className="mb-3">
          <h6>Response</h6>
          <div>{result.spokenResponse}</div>
        </div>
      )}

      {!!result.topPriorities?.length && (
        <div className="mb-3">
          <h6>Top Priorities</h6>
          <ListGroup>
            {result.topPriorities.map((item) => (
              <ListGroup.Item key={`${item.entityType}:${item.id}`}>
                <div style={{ fontWeight: 600 }}>
                  <a href={item.deepLink}>{item.ref}</a>
                  {' — '}
                  {item.title}
                </div>
                <div className="text-muted small">
                  {item.entityType === 'story' ? 'Story' : 'Task'}
                  {typeof item.priorityRank === 'number' ? ` · Rank ${item.priorityRank}` : ''}
                  {item.existing ? ' · Existing' : ''}
                </div>
                {item.reason && (
                  <div className="text-muted small" style={{ whiteSpace: 'pre-wrap' }}>
                    {item.reason}
                  </div>
                )}
              </ListGroup.Item>
            ))}
          </ListGroup>
        </div>
      )}

      {result.replan && (
        <div className="mb-3">
          <h6>Replan</h6>
          <div className="text-muted small">
            Window: {result.replan.days} day{result.replan.days === 1 ? '' : 's'} from {result.replan.startDate}
          </div>
          <div className="text-muted small">
            AI blocks: {result.replan.llmBlocksCreated} · Scheduled: {result.replan.plannedCount} · Unscheduled: {result.replan.unscheduledCount}
          </div>
          {result.replan.pushSummary && (
            <div className="text-muted small">
              Google sync: {result.replan.pushSummary.created || 0} created, {result.replan.pushSummary.updated || 0} updated, {result.replan.pushSummary.deleted || 0} deleted
            </div>
          )}
        </div>
      )}

      {result.oneLineSummary && (
        <div className="mb-3">
          <h6>Summary</h6>
          <div>{result.oneLineSummary}</div>
        </div>
      )}

      {!!result.aiSummaryBullets?.length && (
        <div className="mb-3">
          <h6>AI Summary</h6>
          <ul className="mb-0 ps-3">
            {result.aiSummaryBullets.map((bullet, index) => (
              <li key={`ai_summary_${index}`}>{bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {!!result.calendarEvents?.length && (
        <div className="mb-3">
          <h6>Calendar</h6>
          <ListGroup>
            {result.calendarEvents.map((event) => (
              <ListGroup.Item key={event.id}>
                <div style={{ fontWeight: 600 }}>
                  {event.htmlLink ? (
                    <a href={event.htmlLink} target="_blank" rel="noreferrer">{event.title}</a>
                  ) : event.title}
                </div>
                <div className="text-muted small">{event.when || 'Time unavailable'}</div>
                {event.location && <div className="text-muted small">{event.location}</div>}
              </ListGroup.Item>
            ))}
          </ListGroup>
        </div>
      )}

      {result.structuredEntry && (
        <div className="mb-3">
          <h6>Processed Text</h6>
          <div style={{ whiteSpace: 'pre-wrap' }}>{result.structuredEntry}</div>
        </div>
      )}

      {result.advice && (
        <div className="mb-3">
          <h6>Advice</h6>
          <div style={{ whiteSpace: 'pre-wrap' }}>{result.advice}</div>
        </div>
      )}

      {result.mindsetAnalysis && (
        <div className="mb-3">
          <h6>Mindset Analysis</h6>
          {result.mindsetAnalysis.emotionalTone && (
            <div className="mb-2">
              <div className="fw-semibold small">Emotional Tone</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.mindsetAnalysis.emotionalTone}</div>
            </div>
          )}
          {result.mindsetAnalysis.cognitiveStyle && (
            <div className="mb-2">
              <div className="fw-semibold small">Cognitive Style</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.mindsetAnalysis.cognitiveStyle}</div>
            </div>
          )}
          {result.mindsetAnalysis.motivationsAndDrivers && (
            <div className="mb-2">
              <div className="fw-semibold small">Motivations and Internal Drivers</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.mindsetAnalysis.motivationsAndDrivers}</div>
            </div>
          )}
          {result.mindsetAnalysis.psychologicalStrengths && (
            <div className="mb-2">
              <div className="fw-semibold small">Psychological Strengths Observed</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.mindsetAnalysis.psychologicalStrengths}</div>
            </div>
          )}
          {result.mindsetAnalysis.potentialStressors && (
            <div className="mb-2">
              <div className="fw-semibold small">Potential Stressors or Pressures</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.mindsetAnalysis.potentialStressors}</div>
            </div>
          )}
        </div>
      )}

      {result.entryMetadata && (
        <div className="mb-3">
          <h6>Entry Metadata</h6>
          <div className="d-flex flex-wrap gap-2 mb-2">
            {typeof result.entryMetadata.moodScore === 'number' && (
              <Badge bg="light" text="dark">Mood {result.entryMetadata.moodScore}</Badge>
            )}
            {typeof result.entryMetadata.stressLevel === 'number' && (
              <Badge bg="light" text="dark">Stress {result.entryMetadata.stressLevel}</Badge>
            )}
            {typeof result.entryMetadata.energyLevel === 'number' && (
              <Badge bg="light" text="dark">Energy {result.entryMetadata.energyLevel}</Badge>
            )}
            {result.entryMetadata.sentiment && (
              <Badge bg="secondary">{result.entryMetadata.sentiment}</Badge>
            )}
            {result.entryMetadata.cognitiveState && (
              <Badge bg="info">{result.entryMetadata.cognitiveState}</Badge>
            )}
          </div>
          {!!result.entryMetadata.primaryThemes?.length && (
            <div className="text-muted small">
              Themes: {result.entryMetadata.primaryThemes.join(', ')}
            </div>
          )}
        </div>
      )}

      {!!result.createdStories?.length && (
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

      {!!result.createdTasks?.length && (
        <div className="mb-3">
          <h6>Tasks</h6>
          <ListGroup>
            {result.createdTasks.map((task) => (
              <ListGroup.Item key={task.id}>
                <a href={task.deepLink}>{task.ref}</a>
                {' — '}
                {task.title}
                {task.existing ? (task as any).updated ? ' (updated existing)' : ' (existing)' : ''}
              </ListGroup.Item>
            ))}
          </ListGroup>
        </div>
      )}

      {result.journalId && (
        <div className="mb-2">
          <a href={`/journals/${result.journalId}`}>Open journal entry</a>
        </div>
      )}

      {result.docUrl && (
        <div className="mb-1">
          <a href={result.docUrl} target="_blank" rel="noreferrer">Open Google Doc</a>
          {result.googleDoc?.appended === false ? (
            <span className="text-muted small"> {' '}(not updated)</span>
          ) : null}
        </div>
      )}
    </>
  );
};

export default AgentResponsePanel;

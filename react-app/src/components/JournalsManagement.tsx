import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, ListGroup, Row, Spinner } from 'react-bootstrap';
import { BookOpen } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import type { JournalEntry } from '../types';
import EmptyState from './common/EmptyState';
import PageHeader from './common/PageHeader';

type LinkedEntitySummary = {
  id: string;
  ref?: string;
  title?: string;
  url?: string | null;
  deepLink?: string | null;
  existing?: boolean;
  updated?: boolean;
  inaccessible?: boolean;
  source?: 'live' | 'journal';
};

type JournalLinkedSummary = NonNullable<JournalEntry['linkedStories']>[number];

function timestampToMillis(value: any): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value?.seconds != null) {
    return (Number(value.seconds) * 1000) + Math.round((Number(value.nanoseconds || 0) || 0) / 1e6);
  }
  return 0;
}

function formatJournalDate(entry: JournalEntry): string {
  const explicit = String(entry?.dateHeading || '').trim();
  if (explicit) return explicit;
  const millis = timestampToMillis(entry?.createdAt || entry?.updatedAt);
  if (!millis) return 'Journal entry';
  return new Date(millis).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function formatProcessedAt(entry: JournalEntry): string {
  const millis = timestampToMillis(entry?.updatedAt || entry?.createdAt);
  if (!millis) return 'Unknown time';
  return new Date(millis).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getGoogleDocBadge(entry: JournalEntry): { label: string; bg: string; text?: 'dark' } | null {
  if (!entry?.docUrl && !entry?.googleDoc) return null;
  const status = String(entry?.googleDoc?.status || '').trim().toLowerCase();
  if (entry?.googleDoc?.appended === true || status === 'done') {
    return { label: 'Doc synced', bg: 'success' };
  }
  if (status === 'failed') {
    return { label: 'Doc not updated', bg: 'warning', text: 'dark' };
  }
  if (status === 'not_configured') {
    return { label: 'Doc not configured', bg: 'secondary' };
  }
  if (status === 'pending') {
    return { label: 'Doc pending', bg: 'info' };
  }
  return entry?.docUrl ? { label: 'Doc linked', bg: 'secondary' } : null;
}

function sentimentBadgeVariant(sentiment?: string | null): { bg: string; text?: 'dark' } {
  const normalized = String(sentiment || '').trim().toLowerCase();
  if (normalized === 'positive') return { bg: 'success' };
  if (normalized === 'negative') return { bg: 'danger' };
  if (normalized === 'neutral') return { bg: 'secondary' };
  return { bg: 'warning', text: 'dark' };
}

function formatMetricValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}` : '—';
}

function normalizeLinkedSummary(
  collectionName: 'stories' | 'tasks',
  item: any,
  fallbackId: string,
  source: 'live' | 'journal',
  inaccessible = false
): LinkedEntitySummary {
  const id = String(item?.id || fallbackId || '').trim();
  const ref = String(item?.ref || id).trim();
  const title = String(item?.title || (collectionName === 'tasks' ? 'Task' : 'Story')).trim();
  const entityType = collectionName === 'tasks' ? 'task' : 'story';
  return {
    id,
    ref,
    title,
    url: item?.url || null,
    deepLink: item?.deepLink || `/${entityType === 'task' ? 'tasks' : 'stories'}/${encodeURIComponent(ref || id)}`,
    existing: item?.existing === true,
    updated: item?.updated === true,
    inaccessible,
    source,
  };
}

function mergeLinkedEntities(primaryDocs: LinkedEntitySummary[], fallbackDocs: LinkedEntitySummary[]): LinkedEntitySummary[] {
  const merged = new Map<string, LinkedEntitySummary>();
  primaryDocs.forEach((item) => {
    if (!item?.id) return;
    merged.set(String(item.id), item);
  });
  fallbackDocs.forEach((item) => {
    if (!item?.id) return;
    if (!merged.has(String(item.id))) {
      merged.set(String(item.id), item);
    }
  });
  return Array.from(merged.values());
}

function buildJournalLinkedEntities(
  collectionName: 'stories' | 'tasks',
  ids: string[],
  items: JournalLinkedSummary[] | undefined
): LinkedEntitySummary[] {
  const embedded = Array.isArray(items)
    ? items
      .filter((item) => item?.id)
      .map((item) => normalizeLinkedSummary(collectionName, item, String(item.id), 'journal', true))
    : [];

  const embeddedIds = new Set(embedded.map((item) => String(item.id)));
  const genericFallbacks = ids
    .filter(Boolean)
    .map((id) => String(id).trim())
    .filter((id) => id && !embeddedIds.has(id))
    .map((id) => normalizeLinkedSummary(collectionName, { id }, id, 'journal', true));

  return mergeLinkedEntities(embedded, genericFallbacks);
}

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1.2rem',
  fontWeight: 700,
  margin: '1.75rem 0 0.75rem',
};

const sectionBodyStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  lineHeight: 1.7,
  color: 'var(--text)',
};

const JournalsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const { id: routeJournalId } = useParams();

  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(routeJournalId || null);
  const [linkedStories, setLinkedStories] = useState<LinkedEntitySummary[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<LinkedEntitySummary[]>([]);
  const [linkedError, setLinkedError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedJournalId(routeJournalId || null);
  }, [routeJournalId]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setJournals([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const journalsQuery = query(
      collection(db, 'journals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribe = onSnapshot(
      journalsQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as JournalEntry)
          .sort((a, b) => timestampToMillis(b.updatedAt || b.createdAt) - timestampToMillis(a.updatedAt || a.createdAt));

        setJournals(rows);
        setLoading(false);
      },
      (error) => {
        console.warn('[JournalsManagement] journals subscribe error', error?.message || error);
        setLoadError(error?.message || 'Failed to load journal entries.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (routeJournalId || !journals.length) return;
    if (selectedJournalId && journals.some((journal) => journal.id === selectedJournalId)) return;
    const nextId = journals[0].id;
    setSelectedJournalId(nextId);
    navigate(`/journals/${encodeURIComponent(nextId)}`, { replace: true });
  }, [journals, routeJournalId, selectedJournalId, navigate]);

  const selectedJournal =
    journals.find((journal) => journal.id === (routeJournalId || selectedJournalId || '')) || null;

  useEffect(() => {
    if (!selectedJournal) {
      setLinkedStories([]);
      setLinkedTasks([]);
      setLinkedError(null);
      return undefined;
    }

    const storyIds = Array.isArray(selectedJournal.storyIds)
      ? selectedJournal.storyIds.filter(Boolean)
      : [];
    const taskIds = Array.isArray(selectedJournal.taskIds)
      ? selectedJournal.taskIds.filter(Boolean)
      : [];
    const embeddedStoryCount = Array.isArray(selectedJournal.linkedStories)
      ? selectedJournal.linkedStories.filter((item) => item?.id).length
      : 0;
    const embeddedTaskCount = Array.isArray(selectedJournal.linkedTasks)
      ? selectedJournal.linkedTasks.filter((item) => item?.id).length
      : 0;
    const fallbackStoryDocs = buildJournalLinkedEntities('stories', storyIds, selectedJournal.linkedStories);
    const fallbackTaskDocs = buildJournalLinkedEntities('tasks', taskIds, selectedJournal.linkedTasks);

    if (!fallbackStoryDocs.length && !fallbackTaskDocs.length) {
      setLinkedStories(fallbackStoryDocs);
      setLinkedTasks(fallbackTaskDocs);
      setLinkedError(null);
      return undefined;
    }

    setLinkedStories(fallbackStoryDocs);
    setLinkedTasks(fallbackTaskDocs);
    const usedGenericFallback =
      storyIds.length > embeddedStoryCount
      || taskIds.length > embeddedTaskCount;
    setLinkedError(
      usedGenericFallback
        ? 'Some linked items only have stored journal references available. Reprocess a fresh transcript to capture richer task and story metadata.'
        : null
    );
  }, [selectedJournal]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const selectedGoogleDocBadge = selectedJournal ? getGoogleDocBadge(selectedJournal) : null;
  const filteredJournals = journals.filter((journal) => {
    if (!normalizedSearch) return true;
    const haystack = [
      formatJournalDate(journal),
      journal.oneLineSummary,
      Array.isArray(journal.aiSummaryBullets) ? journal.aiSummaryBullets.join(' ') : '',
      journal.structuredEntry,
      journal.mindsetAnalysis?.emotionalTone,
      journal.mindsetAnalysis?.cognitiveStyle,
      journal.mindsetAnalysis?.motivationsAndDrivers,
      journal.mindsetAnalysis?.psychologicalStrengths,
      journal.mindsetAnalysis?.potentialStressors,
      Array.isArray(journal.entryMetadata?.primaryThemes) ? journal.entryMetadata?.primaryThemes.join(' ') : '',
      journal.entryMetadata?.cognitiveState,
      journal.entryMetadata?.sentiment,
      journal.originalTranscript,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  const handleSelectJournal = (journalId: string) => {
    setSelectedJournalId(journalId);
    navigate(`/journals/${encodeURIComponent(journalId)}`);
  };

  const hasLinkedEntities = linkedStories.length > 0 || linkedTasks.length > 0;

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: 'var(--bg)', minHeight: '100vh' }}>
      <PageHeader
        title="Journals"
        subtitle="Review processed journal entries and the tasks or stories extracted from each intake."
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Journals' },
        ]}
        badge={{ label: `${currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona`, variant: 'primary' }}
        actions={
          selectedJournal?.docUrl ? (
            <Button
              variant="outline-primary"
              href={selectedJournal.docUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Google Doc
            </Button>
          ) : undefined
        }
      />

      <Row className="g-4">
        <Col lg={4}>
          <Card style={{ border: 'none', boxShadow: 'var(--glass-shadow, 0 1px 3px var(--glass-shadow-color))' }}>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Search journal entries</Form.Label>
                <Form.Control
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search summary, entry text, or transcript..."
                />
              </Form.Group>

              {loadError && <Alert variant="danger">{loadError}</Alert>}

              {loading ? (
                <div className="text-center py-5">
                  <Spinner animation="border" role="status" />
                </div>
              ) : filteredJournals.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No journal entries yet"
                  description="Journal and mixed transcript ingestions will appear here once they are processed successfully."
                />
              ) : (
                <ListGroup variant="flush">
                  {filteredJournals.map((journal) => {
                    const isSelected = journal.id === selectedJournal?.id;
                    const taskCount = Array.isArray(journal.taskIds) ? journal.taskIds.length : 0;
                    const storyCount = Array.isArray(journal.storyIds) ? journal.storyIds.length : 0;
                    const googleDocBadge = getGoogleDocBadge(journal);
                    const sentimentBadge = journal.entryMetadata?.sentiment
                      ? sentimentBadgeVariant(journal.entryMetadata.sentiment)
                      : null;

                    return (
                      <ListGroup.Item
                        key={journal.id}
                        action
                        onClick={() => handleSelectJournal(journal.id)}
                        style={{
                          cursor: 'pointer',
                          border: 'none',
                          borderBottom: '1px solid var(--line)',
                          backgroundColor: isSelected ? 'rgba(36, 99, 235, 0.08)' : 'transparent',
                        }}
                      >
                        <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                          <div style={{ fontWeight: 700 }}>{formatJournalDate(journal)}</div>
                          <Badge bg="secondary" pill>
                            {String(journal.entryType || 'journal')}
                          </Badge>
                        </div>
                        <div style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>
                          {String(journal.oneLineSummary || 'Transcript summary')}
                        </div>
                        <div className="d-flex flex-wrap gap-2 align-items-center">
                          <Badge bg="light" text="dark">{taskCount} task{taskCount === 1 ? '' : 's'}</Badge>
                          <Badge bg="light" text="dark">{storyCount} stor{storyCount === 1 ? 'y' : 'ies'}</Badge>
                          {sentimentBadge && (
                            <Badge bg={sentimentBadge.bg} text={sentimentBadge.text}>
                              {String(journal.entryMetadata?.sentiment || '')}
                            </Badge>
                          )}
                          {typeof journal.entryMetadata?.moodScore === 'number' && (
                            <Badge bg="info">Mood {journal.entryMetadata.moodScore}</Badge>
                          )}
                          {googleDocBadge ? (
                            <Badge bg={googleDocBadge.bg} text={googleDocBadge.text}>
                              {googleDocBadge.label}
                            </Badge>
                          ) : null}
                          <span className="text-muted small">{formatProcessedAt(journal)}</span>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col lg={8}>
          <Card style={{ border: 'none', boxShadow: 'var(--glass-shadow, 0 1px 3px var(--glass-shadow-color))' }}>
            <Card.Body style={{ padding: '1.5rem 1.75rem' }}>
              {loading ? (
                <div className="text-center py-5">
                  <Spinner animation="border" role="status" />
                </div>
              ) : routeJournalId && !selectedJournal ? (
                <Alert variant="warning" className="mb-0">
                  We couldn&apos;t find a journal entry matching <code>{routeJournalId}</code>.
                </Alert>
              ) : !selectedJournal ? (
                <EmptyState
                  icon={BookOpen}
                  title="Choose a journal entry"
                  description="Select an entry from the list to inspect the cleaned journal text and any linked tasks or stories."
                />
              ) : (
                <>
                  <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-4">
                    <div className="d-flex flex-wrap gap-2 align-items-center">
                      <Badge bg="dark">{String(selectedJournal.entryType || 'journal')}</Badge>
                      <Badge bg="light" text="dark">
                        {formatProcessedAt(selectedJournal)}
                      </Badge>
                      {selectedGoogleDocBadge ? (
                        <Badge bg={selectedGoogleDocBadge.bg} text={selectedGoogleDocBadge.text}>
                          {selectedGoogleDocBadge.label}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      {selectedJournal.docUrl && (
                        <Button
                          variant="outline-primary"
                          size="sm"
                          href={selectedJournal.docUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Google Doc
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedJournal.googleDoc?.appended === false && selectedJournal.googleDoc?.message ? (
                    <Alert variant="warning">
                      {selectedJournal.googleDoc.message}
                    </Alert>
                  ) : null}

                  <article>
                    <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.75rem' }}>
                      {formatJournalDate(selectedJournal)}
                    </h1>
                    <p style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
                      {String(selectedJournal.oneLineSummary || 'Transcript summary')}
                    </p>

                    {!!selectedJournal.aiSummaryBullets?.length && (
                      <>
                        <h2 style={sectionHeadingStyle}>AI Summary of the Entry</h2>
                        <ul style={{ marginBottom: '1.5rem', paddingLeft: '1.25rem' }}>
                          {selectedJournal.aiSummaryBullets.map((bullet, index) => (
                            <li key={`journal_ai_summary_${index}`} style={{ marginBottom: '0.35rem' }}>{bullet}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    <h2 style={sectionHeadingStyle}>The Entry</h2>
                    <div style={sectionBodyStyle}>
                      {String(selectedJournal.structuredEntry || 'No structured entry available.')}
                    </div>

                    {selectedJournal.mindsetAnalysis && (
                      <>
                        <h2 style={sectionHeadingStyle}>Analysis of the Author&apos;s Mindset</h2>
                        {selectedJournal.mindsetAnalysis.emotionalTone && (
                          <>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>Emotional Tone</h3>
                            <div style={sectionBodyStyle}>{selectedJournal.mindsetAnalysis.emotionalTone}</div>
                          </>
                        )}
                        {selectedJournal.mindsetAnalysis.cognitiveStyle && (
                          <>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>Cognitive Style</h3>
                            <div style={sectionBodyStyle}>{selectedJournal.mindsetAnalysis.cognitiveStyle}</div>
                          </>
                        )}
                        {selectedJournal.mindsetAnalysis.motivationsAndDrivers && (
                          <>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>Motivations and Internal Drivers</h3>
                            <div style={sectionBodyStyle}>{selectedJournal.mindsetAnalysis.motivationsAndDrivers}</div>
                          </>
                        )}
                        {selectedJournal.mindsetAnalysis.psychologicalStrengths && (
                          <>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>Psychological Strengths Observed</h3>
                            <div style={sectionBodyStyle}>{selectedJournal.mindsetAnalysis.psychologicalStrengths}</div>
                          </>
                        )}
                        {selectedJournal.mindsetAnalysis.potentialStressors && (
                          <>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '1rem 0 0.5rem' }}>Potential Stressors or Pressures</h3>
                            <div style={sectionBodyStyle}>{selectedJournal.mindsetAnalysis.potentialStressors}</div>
                          </>
                        )}
                      </>
                    )}

                    <h2 style={sectionHeadingStyle}>Advice</h2>
                    <div style={sectionBodyStyle}>
                      {String(selectedJournal.advice || 'No additional advice generated.')}
                    </div>

                    {selectedJournal.entryMetadata && (
                      <>
                        <h2 style={sectionHeadingStyle}>Entry Metadata</h2>
                        <div className="d-flex flex-wrap gap-2 mb-2">
                          <Badge bg="light" text="dark">Mood {formatMetricValue(selectedJournal.entryMetadata.moodScore)}</Badge>
                          <Badge bg="light" text="dark">Stress {formatMetricValue(selectedJournal.entryMetadata.stressLevel)}</Badge>
                          <Badge bg="light" text="dark">Energy {formatMetricValue(selectedJournal.entryMetadata.energyLevel)}</Badge>
                          {selectedJournal.entryMetadata.sentiment ? (
                            <Badge
                              bg={sentimentBadgeVariant(selectedJournal.entryMetadata.sentiment).bg}
                              text={sentimentBadgeVariant(selectedJournal.entryMetadata.sentiment).text}
                            >
                              {selectedJournal.entryMetadata.sentiment}
                            </Badge>
                          ) : null}
                          {selectedJournal.entryMetadata.cognitiveState ? (
                            <Badge bg="info">{selectedJournal.entryMetadata.cognitiveState}</Badge>
                          ) : null}
                        </div>
                        {!!selectedJournal.entryMetadata.primaryThemes?.length && (
                          <div className="text-muted" style={{ marginBottom: '1rem' }}>
                            Themes: {selectedJournal.entryMetadata.primaryThemes.join(', ')}
                          </div>
                        )}
                      </>
                    )}

                    <h2 style={sectionHeadingStyle}>Full Transcript</h2>
                    <div style={sectionBodyStyle}>
                      {String(selectedJournal.originalTranscript || 'No transcript available.')}
                    </div>

                    <h2 style={sectionHeadingStyle}>Actionable items</h2>
                    <>
                      {linkedError ? (
                        <Alert variant={hasLinkedEntities ? 'warning' : 'danger'}>{linkedError}</Alert>
                      ) : null}
                      {!hasLinkedEntities ? (
                      <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
                        No tasks or stories were linked to this journal entry.
                      </p>
                      ) : (
                      <>
                        {linkedStories.length > 0 && (
                          <div className="mb-3">
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Stories</h3>
                            <ListGroup>
                              {linkedStories.map((story) => (
                                <ListGroup.Item key={story.id} className="d-flex justify-content-between align-items-center gap-3">
                                  <div>
                                    <RouterLink to={`/stories/${encodeURIComponent(String(story.ref || story.id))}`} style={{ fontWeight: 700, textDecoration: 'none' }}>
                                      {String(story.ref || story.id)}
                                    </RouterLink>
                                    <div>{story.title}</div>
                                    {story.inaccessible ? (
                                      <div className="text-muted small">Loaded from journal snapshot</div>
                                    ) : null}
                                  </div>
                                  <Badge bg="secondary">Story</Badge>
                                </ListGroup.Item>
                              ))}
                            </ListGroup>
                          </div>
                        )}

                        {linkedTasks.length > 0 && (
                          <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Tasks</h3>
                            <ListGroup>
                              {linkedTasks.map((task) => (
                                <ListGroup.Item key={task.id} className="d-flex justify-content-between align-items-center gap-3">
                                  <div>
                                    <RouterLink to={`/tasks/${encodeURIComponent(String(task.ref || task.id))}`} style={{ fontWeight: 700, textDecoration: 'none' }}>
                                      {String(task.ref || task.id)}
                                    </RouterLink>
                                    <div>{task.title}</div>
                                    {task.inaccessible ? (
                                      <div className="text-muted small">Loaded from journal snapshot</div>
                                    ) : null}
                                  </div>
                                  <Badge bg="primary">Task</Badge>
                                </ListGroup.Item>
                              ))}
                            </ListGroup>
                          </div>
                        )}
                      </>
                      )}
                    </>

                    {!!selectedJournal.sourceUrls?.length && (
                      <>
                        <h2 style={sectionHeadingStyle}>Source URLs</h2>
                        <ListGroup>
                          {selectedJournal.sourceUrls.map((url) => (
                            <ListGroup.Item key={url}>
                              <a href={url} target="_blank" rel="noreferrer">
                                {url}
                              </a>
                            </ListGroup.Item>
                          ))}
                        </ListGroup>
                      </>
                    )}
                  </article>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default JournalsManagement;

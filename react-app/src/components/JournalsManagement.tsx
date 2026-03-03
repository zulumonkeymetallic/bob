import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, ListGroup, Row, Spinner } from 'react-bootstrap';
import { BookOpen } from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import type { JournalEntry, Story, Task } from '../types';
import EmptyState from './common/EmptyState';
import PageHeader from './common/PageHeader';

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

async function loadDocsById<T>(collectionName: 'stories' | 'tasks', ids: string[]): Promise<T[]> {
  const docs = await Promise.all(
    ids.map(async (id) => {
      const snap = await getDoc(doc(db, collectionName, id));
      if (!snap.exists()) return null;
      return { id: snap.id, ...(snap.data() as T) };
    })
  );

  return docs.filter(Boolean) as T[];
}

function buildStoryPath(story: Story): string {
  return `/stories/${encodeURIComponent(String(story.ref || story.id))}`;
}

function buildTaskPath(task: Task): string {
  return `/tasks/${encodeURIComponent(String(task.ref || task.id))}`;
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
  const [linkedStories, setLinkedStories] = useState<Story[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [linkedLoading, setLinkedLoading] = useState(false);
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
    let cancelled = false;

    if (!selectedJournal) {
      setLinkedStories([]);
      setLinkedTasks([]);
      setLinkedLoading(false);
      setLinkedError(null);
      return undefined;
    }

    const storyIds = Array.isArray(selectedJournal.storyIds) ? selectedJournal.storyIds.filter(Boolean) : [];
    const taskIds = Array.isArray(selectedJournal.taskIds) ? selectedJournal.taskIds.filter(Boolean) : [];

    if (!storyIds.length && !taskIds.length) {
      setLinkedStories([]);
      setLinkedTasks([]);
      setLinkedLoading(false);
      setLinkedError(null);
      return undefined;
    }

    setLinkedLoading(true);
    setLinkedError(null);

    (async () => {
      try {
        const [storyDocs, taskDocs] = await Promise.all([
          loadDocsById<Story>('stories', storyIds),
          loadDocsById<Task>('tasks', taskIds),
        ]);

        if (cancelled) return;
        setLinkedStories(storyDocs);
        setLinkedTasks(taskDocs);
      } catch (error: any) {
        if (cancelled) return;
        console.warn('[JournalsManagement] linked entity load error', error?.message || error);
        setLinkedError(error?.message || 'Failed to load linked tasks and stories.');
        setLinkedStories([]);
        setLinkedTasks([]);
      } finally {
        if (!cancelled) {
          setLinkedLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedJournal]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredJournals = journals.filter((journal) => {
    if (!normalizedSearch) return true;
    const haystack = [
      formatJournalDate(journal),
      journal.oneLineSummary,
      journal.structuredEntry,
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

                  <article>
                    <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.75rem' }}>
                      {formatJournalDate(selectedJournal)}
                    </h1>
                    <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '1rem' }}>
                      {String(selectedJournal.oneLineSummary || 'Transcript summary')}
                    </h2>
                    <div style={sectionBodyStyle}>
                      {String(selectedJournal.structuredEntry || 'No structured entry available.')}
                    </div>

                    <h2 style={sectionHeadingStyle}>Advice</h2>
                    <div style={sectionBodyStyle}>
                      {String(selectedJournal.advice || 'No additional advice generated.')}
                    </div>

                    <h2 style={sectionHeadingStyle}>Full transcript</h2>
                    <div style={sectionBodyStyle}>
                      {String(selectedJournal.originalTranscript || 'No transcript available.')}
                    </div>

                    <h2 style={sectionHeadingStyle}>Actionable items</h2>
                    {linkedLoading ? (
                      <div className="py-3">
                        <Spinner animation="border" role="status" size="sm" className="me-2" />
                        Loading linked tasks and stories…
                      </div>
                    ) : linkedError ? (
                      <Alert variant="danger">{linkedError}</Alert>
                    ) : !hasLinkedEntities ? (
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
                                    <RouterLink to={buildStoryPath(story)} style={{ fontWeight: 700, textDecoration: 'none' }}>
                                      {String(story.ref || story.id)}
                                    </RouterLink>
                                    <div>{story.title}</div>
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
                                    <RouterLink to={buildTaskPath(task)} style={{ fontWeight: 700, textDecoration: 'none' }}>
                                      {String(task.ref || task.id)}
                                    </RouterLink>
                                    <div>{task.title}</div>
                                  </div>
                                  <Badge bg="primary">Task</Badge>
                                </ListGroup.Item>
                              ))}
                            </ListGroup>
                          </div>
                        )}
                      </>
                    )}

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

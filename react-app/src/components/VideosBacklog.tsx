import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, ButtonGroup, Form, Badge, Row, Col, Table, Modal } from 'react-bootstrap';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Sprint } from '../types';
import { findSprintForDate } from '../utils/taskSprintHelpers';
import { generateRef } from '../utils/referenceGenerator';

interface YouTubeItem {
  id: string;
  videoId?: string | null;
  title?: string | null;
  channelTitle?: string | null;
  publishedAt?: number | string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  durationMs?: number | null;
  durationMinutes?: number | null;
  watchTimeSec?: number | null;
  watchTimeMinutes?: number | null;
  watchLater?: boolean | null;
  list?: string | null;
  longformCandidate?: boolean | null;
  lastConvertedStoryId?: string;
  lastConvertedAt?: number;
  rating?: number | null;
}

interface ConvertPayload {
  sprintId: string | null;
  targetDate: string;
  rating: number;
}

const LONGFORM_THRESHOLD_SEC = 20 * 60;

const formatDuration = (seconds?: number | null) => {
  if (!seconds || Number.isNaN(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
};

const VideosBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();

  const [videos, setVideos] = useState<YouTubeItem[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'watch-later' | 'longform' | 'converted' | 'unconverted'>('all');
  const [selected, setSelected] = useState<YouTubeItem | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertPayload>({ sprintId: null, targetDate: '', rating: 3 });
  const [savingConversion, setSavingConversion] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    const qRef = query(collection(db, 'youtube'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as YouTubeItem[];
      const toMillis = (value?: number | string | null) => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const parsed = Date.parse(value);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };
      rows.sort((a, b) => toMillis(b.publishedAt) - toMillis(a.publishedAt));
      setVideos(rows);
    });
    return unsub;
  }, [currentUser]);

  const getDurationSec = (item: YouTubeItem) => {
    if (typeof item.durationSec === 'number') return item.durationSec;
    if (typeof item.durationMs === 'number') return Math.round(item.durationMs / 1000);
    if (typeof item.durationMinutes === 'number') return Math.round(item.durationMinutes * 60);
    return null;
  };

  const getWatchTimeSec = (item: YouTubeItem) => {
    if (typeof item.watchTimeSec === 'number') return item.watchTimeSec;
    if (typeof item.watchTimeMinutes === 'number') return Math.round(item.watchTimeMinutes * 60);
    return null;
  };

  const isWatchLater = (item: YouTubeItem) => {
    return Boolean(item.watchLater || String(item.list || '').toLowerCase() === 'watch-later');
  };

  const isLongform = (item: YouTubeItem) => {
    if (item.longformCandidate) return true;
    const duration = getDurationSec(item);
    return !!duration && duration >= LONGFORM_THRESHOLD_SEC;
  };

  const filteredVideos = useMemo(() => {
    return videos.filter((video) => {
      const title = String(video.title || '').toLowerCase();
      const channel = String(video.channelTitle || '').toLowerCase();
      const matchesSearch = !search || title.includes(search.toLowerCase()) || channel.includes(search.toLowerCase());
      const converted = !!video.lastConvertedStoryId;
      const matchesStatus = (() => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'converted') return converted;
        if (statusFilter === 'unconverted') return !converted;
        if (statusFilter === 'watch-later') return isWatchLater(video);
        if (statusFilter === 'longform') return isLongform(video);
        return true;
      })();
      return matchesSearch && matchesStatus;
    });
  }, [videos, search, statusFilter]);

  const openConvert = (video: YouTubeItem) => {
    setSelected(video);
    setConvertForm({ sprintId: null, targetDate: '', rating: video.rating ?? 3 });
  };

  const handleConvert = async () => {
    if (!currentUser || !selected) return;
    if (selected.lastConvertedStoryId) {
      window.alert('A story has already been generated for this item.');
      return;
    }
    setSavingConversion(true);
    try {
      const dueDateMs = convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null;
      const sprintId = convertForm.sprintId || (dueDateMs ? findSprintForDate(sprints, dueDateMs)?.id || null : null);
      const storyRef = generateRef('story', []);
      const durationSec = getDurationSec(selected);
      const watchTimeSec = getWatchTimeSec(selected);
      const title = String(selected.title || 'YouTube video');
      const channel = selected.channelTitle ? `\nChannel: ${selected.channelTitle}` : '';
      const durationLine = durationSec ? `\nDuration: ${formatDuration(durationSec)}` : '';
      const watchTimeLine = watchTimeSec ? `\nWatch time: ${formatDuration(watchTimeSec)}` : '';

      const storyPayload: any = {
        ref: storyRef,
        title,
        description: `Watch ${title}.${channel}${durationLine}${watchTimeLine}`,
        goalId: '',
        sprintId: sprintId || null,
        dueDate: dueDateMs || null,
        status: 0,
        priority: 2,
        points: 3,
        wipLimit: 3,
        tags: ['youtube', 'video'],
        persona: currentPersona,
        personaKey: currentPersona,
        ownerPersona: currentPersona,
        ownerUid: currentUser.uid,
        orderIndex: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        metadata: {
          youtubeVideoId: selected.videoId || null,
          youtubeUrl: selected.videoId ? `https://www.youtube.com/watch?v=${selected.videoId}` : null,
          youtubeChannel: selected.channelTitle || null,
          durationSec: durationSec ?? null,
          watchTimeSec: watchTimeSec ?? null,
          watchLater: isWatchLater(selected),
          rating: convertForm.rating,
        }
      };

      const storyDoc = await addDoc(collection(db, 'stories'), storyPayload);
      await updateDoc(doc(db, 'youtube', selected.id), {
        lastConvertedStoryId: storyDoc.id,
        lastConvertedAt: serverTimestamp(),
        completedAt: dueDateMs || null,
        rating: convertForm.rating,
        persona: currentPersona,
      });
      setSelected(null);
    } catch (e) {
      console.error('Failed to generate story from video', e);
      window.alert('Could not generate a story for this video.');
    } finally {
      setSavingConversion(false);
    }
  };

  const renderRatingStars = (item: YouTubeItem) => {
    const rating = item.rating ?? 0;
    return (
      <ButtonGroup size="sm">
        {[1,2,3,4,5].map((value) => (
          <Button key={value} variant={value <= rating ? 'warning' : 'outline-secondary'} onClick={() => {
            if (!currentUser) return;
            updateDoc(doc(db, 'youtube', item.id), { rating: value, updatedAt: serverTimestamp() });
          }}>★</Button>
        ))}
      </ButtonGroup>
    );
  };

  const renderListView = () => (
    <Table striped hover responsive size="sm" className="mb-0">
      <thead>
        <tr>
          <th>Video</th>
          <th>Duration</th>
          <th>Watch Time</th>
          <th>Rating</th>
          <th style={{ width: 220 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filteredVideos.map((video) => {
          const converted = !!video.lastConvertedStoryId;
          const duration = getDurationSec(video);
          const watchTime = getWatchTimeSec(video);
          return (
            <tr key={video.id}>
              <td>
                <div className="d-flex align-items-center gap-2">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt={video.title || ''} style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4 }} />
                  ) : <div style={{ width: 80, height: 45, background: '#ddd', borderRadius: 4 }} />}
                  <div>
                    <div className="fw-semibold">{video.title || 'Untitled video'}</div>
                    <div className="text-muted small">
                      {video.channelTitle || 'YouTube'}{' '}
                      {isWatchLater(video) && <Badge bg="warning" text="dark" className="ms-1">Watch Later</Badge>}
                      {isLongform(video) && <Badge bg="info" className="ms-1">Longform</Badge>}
                    </div>
                  </div>
                </div>
              </td>
              <td>{formatDuration(duration)}</td>
              <td>{formatDuration(watchTime)}</td>
              <td>{renderRatingStars(video)}</td>
              <td>
                <div className="d-flex gap-2">
                  <Button size="sm" variant="outline-primary" onClick={() => openConvert(video)} disabled={converted}>Generate Story</Button>
                  {converted && <Button size="sm" variant="outline-secondary" href={`/stories/${video.lastConvertedStoryId}`}>View story</Button>}
                  {video.videoId && (
                    <Button size="sm" variant="outline-secondary" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">
                      Open
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {filteredVideos.length === 0 && (
          <tr><td colSpan={5} className="text-center text-muted py-4">No videos match the current filters.</td></tr>
        )}
      </tbody>
    </Table>
  );

  const renderCardView = () => (
    <Row xs={1} md={2} lg={3} className="g-3">
      {filteredVideos.map((video) => {
        const converted = !!video.lastConvertedStoryId;
        const duration = getDurationSec(video);
        return (
          <Col key={video.id}>
            <Card className="h-100 shadow-sm">
              <div style={{ height: 160, overflow: 'hidden', borderTopLeftRadius: '0.5rem', borderTopRightRadius: '0.5rem' }}>
                {video.thumbnailUrl ? (
                  <img src={video.thumbnailUrl} alt={video.title || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#ddd' }} />
                )}
              </div>
              <Card.Body className="d-flex flex-column">
                <Card.Title className="mb-1">{video.title || 'Untitled video'}</Card.Title>
                <Card.Subtitle className="mb-2 text-muted">{video.channelTitle || 'YouTube'}</Card.Subtitle>
                <div className="d-flex gap-2 mb-2 flex-wrap">
                  {isWatchLater(video) && <Badge bg="warning" text="dark">Watch Later</Badge>}
                  {isLongform(video) && <Badge bg="info">Longform</Badge>}
                  {duration ? <Badge bg="secondary">{formatDuration(duration)}</Badge> : null}
                </div>
                <div className="mb-3">{renderRatingStars(video)}</div>
                <div className="d-flex justify-content-between align-items-center mt-auto">
                  {converted ? <Badge bg="success">Story Linked</Badge> : <Badge bg="secondary">Incoming</Badge>}
                  <div className="d-flex gap-2">
                    <Button size="sm" variant="outline-primary" onClick={() => openConvert(video)} disabled={converted}>Generate</Button>
                    {video.videoId && (
                      <Button size="sm" variant="outline-secondary" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">
                        Open
                      </Button>
                    )}
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        );
      })}
      {filteredVideos.length === 0 && (
        <Col><div className="text-center text-muted py-4">No videos match the current filters.</div></Col>
      )}
    </Row>
  );

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <div>
          <h5 className="mb-1">Videos Backlog</h5>
          <div className="text-muted small">Incoming from YouTube Watch Later and longform picks — generate stories and link goals later.</div>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <Form.Control size="sm" placeholder="Search videos" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
          <Form.Select size="sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">All</option>
            <option value="watch-later">Watch Later</option>
            <option value="longform">Longform</option>
            <option value="unconverted">Backlog only</option>
            <option value="converted">Story linked</option>
          </Form.Select>
          <ButtonGroup size="sm">
            <Button variant={viewMode === 'list' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('list')}>List</Button>
            <Button variant={viewMode === 'card' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('card')}>Cards</Button>
          </ButtonGroup>
        </div>
      </Card.Header>
      <Card.Body>
        {viewMode === 'list' ? renderListView() : renderCardView()}
      </Card.Body>

      <Modal show={!!selected} onHide={() => setSelected(null)} centered>
        <Modal.Header closeButton><Modal.Title>Generate Story</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Sprint (optional)</Form.Label>
              <Form.Select value={convertForm.sprintId || ''} onChange={(e) => setConvertForm(prev => ({ ...prev, sprintId: e.target.value || null }))}>
                <option value="">No sprint</option>
                {sprints.map((s: Sprint) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Target / Completed date</Form.Label>
              <Form.Control type="date" value={convertForm.targetDate} onChange={(e) => setConvertForm(prev => ({ ...prev, targetDate: e.target.value }))} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Personal rating</Form.Label>
              <Form.Select value={convertForm.rating} onChange={(e) => setConvertForm(prev => ({ ...prev, rating: Number(e.target.value) }))}>
                {[1,2,3,4,5].map(star => (<option key={star} value={star}>{`${'★'.repeat(star)}${'☆'.repeat(5-star)}`}</option>))}
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleConvert} disabled={savingConversion}>{savingConversion ? 'Generating…' : 'Generate'}</Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};

export default VideosBacklog;

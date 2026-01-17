import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, ButtonGroup, Form, Badge, Row, Col, Table, Modal, Alert } from 'react-bootstrap';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Sprint } from '../types';
import { findSprintForDate } from '../utils/taskSprintHelpers';
import { generateRef } from '../utils/referenceGenerator';

interface TraktIds {
  trakt?: number;
  slug?: string;
  tmdb?: number;
  imdb?: string;
  [key: string]: any;
}

interface TraktShowItem {
  id: string;
  title: string;
  year?: number | null;
  slug?: string | null;
  traktId?: number | null;
  ids?: TraktIds;
  listedAt?: number | null;
  lastWatchedAt?: number | null;
  rating?: number | null;
  runtime?: number | null;
  network?: string | null;
  overview?: string | null;
  lastConvertedStoryId?: string;
  lastConvertedAt?: number;
}

interface ConvertPayload {
  goalId: string;
  sprintId: string | null;
  targetDate: string;
  rating: number;
}

const ShowsBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();

  const [shows, setShows] = useState<TraktShowItem[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'converted' | 'unconverted'>('all');
  const [selected, setSelected] = useState<TraktShowItem | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertPayload>({ goalId: '', sprintId: null, targetDate: '', rating: 3 });
  const [savingConversion, setSavingConversion] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const qRef = query(
      collection(db, 'trakt'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TraktShowItem[];
      const filtered = rows.filter((r: any) => {
        if (r.category) return r.category === 'watchlist';
        return (r.type === 'show' || r.traktId || (r.ids && r.ids.trakt));
      });
      filtered.sort((a, b) => (b.listedAt || b.lastWatchedAt || 0) - (a.listedAt || a.lastWatchedAt || 0));
      setShows(filtered);
    });
    return unsub;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona));
    const unsub = onSnapshot(goalsQuery, snap => setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[]));
    return unsub;
  }, [currentUser, currentPersona]);

  const filteredShows = useMemo(() => {
    return shows.filter(show => {
      const matchesSearch = !search || (show.title || '').toLowerCase().includes(search.toLowerCase());
      const converted = !!show.lastConvertedStoryId;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'converted' ? converted : !converted);
      return matchesSearch && matchesStatus;
    });
  }, [shows, search, statusFilter]);

  const handleRatingChange = async (show: TraktShowItem, rating: number) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'trakt', show.id), { rating, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('Failed to update rating', e);
      window.alert('Could not save rating.');
    }
  };

  const openConvert = (show: TraktShowItem) => {
    setSelected(show);
    setConvertForm({ goalId: goals[0]?.id || '', sprintId: null, targetDate: '', rating: show.rating ?? 3 });
  };

  const handleConvert = async () => {
    if (!currentUser || !selected) return;
    if (!convertForm.goalId) { window.alert('Choose a goal.'); return; }
    setSavingConversion(true);
    try {
      const dueDateMs = convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null;
      const sprintId = convertForm.sprintId || (dueDateMs ? findSprintForDate(sprints, dueDateMs)?.id || null : null);
      const storyRef = generateRef('story', []);
      const ids = selected.ids || {};
      const storyPayload: any = {
        ref: storyRef,
        title: selected.title,
        description: `Watch ${selected.title}${selected.year ? ` (${selected.year})` : ''}. Imported from Trakt watchlist.`,
        goalId: convertForm.goalId,
        sprintId: sprintId || null,
        dueDate: dueDateMs || null,
        status: 0,
        priority: 2,
        points: 3,
        wipLimit: 3,
        tags: ['trakt', 'tv'],
        persona: currentPersona,
        personaKey: currentPersona,
        ownerPersona: currentPersona,
        ownerUid: currentUser.uid,
        orderIndex: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        source: 'trakt',
        entry_method: 'import:trakt-watchlist',
        metadata: {
          traktShowId: selected.traktId || ids.trakt || null,
          traktSlug: selected.slug || ids.slug || null,
          traktIds: ids,
          rating: convertForm.rating
        }
      };

      const storyDoc = await addDoc(collection(db, 'stories'), storyPayload);
      await updateDoc(doc(db, 'trakt', selected.id), {
        lastConvertedStoryId: storyDoc.id,
        lastConvertedAt: serverTimestamp(),
        completedAt: dueDateMs || null,
        rating: convertForm.rating,
        persona: currentPersona,
      });
      setSelected(null);
    } catch (e) {
      console.error('Failed to convert show', e);
      window.alert('Could not convert this show to a story.');
    } finally {
      setSavingConversion(false);
    }
  };

  const markWatched = async (show: TraktShowItem) => {
    if (!currentUser) return;
    try {
      const defaultDate = new Date().toISOString().slice(0, 10);
      const inputDate = window.prompt('Watched date (yyyy-mm-dd, leave blank for today)', defaultDate) || defaultDate;
      const watchedAt = inputDate ? new Date(inputDate).getTime() : Date.now();
      const showId = show.traktId || show.ids?.trakt || null;
      const slug = show.slug || show.ids?.slug || null;
      if (!showId && !slug) {
        window.alert('No Trakt identifier found for this show. Please sync again.');
        return;
      }
      const fn = httpsCallable(functions, 'traktMarkWatched');
      await fn({
        showId,
        slug,
        watchedAt,
        rating: show.rating ?? null,
      });
      await updateDoc(doc(db, 'trakt', show.id), {
        lastWatchedAt: watchedAt,
        rating: show.rating ?? null,
        updatedAt: serverTimestamp(),
      });
      setMsg(`Pushed watched date for "${show.title}" to Trakt.`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      console.error('traktMarkWatched failed', e);
      window.alert(e?.message || 'Failed to update Trakt');
    }
  };

  const renderRatingStars = (item: TraktShowItem) => {
    const rating = item.rating ?? 0;
    return (
      <ButtonGroup size="sm">
        {[1,2,3,4,5].map((value) => (
          <Button key={value} variant={value <= rating ? 'warning' : 'outline-secondary'} onClick={() => handleRatingChange(item, value)}>★</Button>
        ))}
      </ButtonGroup>
    );
  };

  const renderListView = () => (
    <Table striped hover responsive size="sm" className="mb-0">
      <thead>
        <tr>
          <th>Show</th>
          <th>Added</th>
          <th>Last watched</th>
          <th>Rating</th>
          <th style={{ width: 260 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {filteredShows.map((s) => {
          const converted = !!s.lastConvertedStoryId;
          return (
            <tr key={s.id}>
              <td>
                <div className="d-flex flex-column">
                  <span className="fw-semibold">{s.title}</span>
                  <span className="text-muted small">{s.year || ''} {s.network ? `· ${s.network}` : ''}</span>
                </div>
              </td>
              <td>{s.listedAt ? new Date(s.listedAt).toLocaleDateString() : '—'}</td>
              <td>{s.lastWatchedAt ? new Date(s.lastWatchedAt).toLocaleString() : '—'}</td>
              <td>{renderRatingStars(s)}</td>
              <td>
                <div className="d-flex gap-2">
                  <Button size="sm" variant="outline-primary" onClick={() => openConvert(s)}>Convert to Story</Button>
                  {converted && <Button size="sm" variant="outline-secondary" href={`/stories/${s.lastConvertedStoryId}`}>View story</Button>}
                  <Button size="sm" variant="outline-success" onClick={() => markWatched(s)}>Mark watched</Button>
                </div>
              </td>
            </tr>
          );
        })}
        {filteredShows.length === 0 && (
          <tr><td colSpan={5} className="text-center text-muted py-4">No shows match the current filters.</td></tr>
        )}
      </tbody>
    </Table>
  );

  const renderCardView = () => (
    <Row xs={1} md={2} lg={3} className="g-3">
      {filteredShows.map((s) => {
        const converted = !!s.lastConvertedStoryId;
        return (
          <Col key={s.id}>
            <Card className="h-100 shadow-sm">
              <Card.Body className="d-flex flex-column">
                <Card.Title>{s.title}</Card.Title>
                <Card.Subtitle className="mb-2 text-muted">{s.year || 'Year unknown'} {s.network ? `· ${s.network}` : ''}</Card.Subtitle>
                {s.overview && <div className="small text-muted mb-2">{s.overview.slice(0, 140)}{s.overview.length > 140 ? '…' : ''}</div>}
                <div className="mb-3">{renderRatingStars(s)}</div>
                <div className="d-flex justify-content-between align-items-center mt-auto">
                  {converted ? <Badge bg="success">Story Linked</Badge> : <Badge bg="secondary">Watchlist</Badge>}
                  <div className="d-flex gap-2">
                    <Button size="sm" variant="outline-primary" onClick={() => openConvert(s)}>Convert</Button>
                    <Button size="sm" variant="outline-success" onClick={() => markWatched(s)}>Watched</Button>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        );
      })}
      {filteredShows.length === 0 && (
        <Col><div className="text-center text-muted py-4">No shows match the current filters.</div></Col>
      )}
    </Row>
  );

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <div>
          <h5 className="mb-1">Shows Backlog</h5>
          <div className="text-muted small">Imported from Trakt watchlist — convert into stories or push watched status.</div>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <Form.Control size="sm" placeholder="Search shows" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
          <Form.Select size="sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">All</option>
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
        {msg && <Alert variant="success">{msg}</Alert>}
        {viewMode === 'list' ? renderListView() : renderCardView()}
      </Card.Body>

      <Modal show={!!selected} onHide={() => setSelected(null)} centered>
        <Modal.Header closeButton><Modal.Title>Convert to Story</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Goal</Form.Label>
              <Form.Select value={convertForm.goalId} onChange={(e) => setConvertForm(prev => ({ ...prev, goalId: e.target.value }))}>
                <option value="">Select goal…</option>
                {goals.map(g => (<option key={g.id} value={g.id}>{g.title}</option>))}
              </Form.Select>
            </Form.Group>
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
          <Button variant="primary" onClick={handleConvert} disabled={savingConversion}>{savingConversion ? 'Converting…' : 'Convert'}</Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};

export default ShowsBacklog;
